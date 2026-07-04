import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { t } from "../../styles/theme";

/**
 * SVG 像素帧渲染器（静态版：进度条 / 面板等非交互元素用）。
 * 交互按钮的弹簧动画版见 PixelSurface。
 *
 * 结构（JS + SVG，放大锐利不糊）：
 *  1. ResizeObserver 测容器尺寸 → 按 `pixel` 换算成整数网格 cols×rows；
 *  2. 逐格画矩形：外描边 / 面色 / 顶左高光 / 底右暗影；
 *  3. 双 <mask> 抠角：外轮廓抠圆 + 面色多缩一档，使圆角处描边连续包边；
 *  4. viewBox + preserveAspectRatio=none + shapeRendering=crispEdges。
 *
 * 绝对定位铺满父级（父级需 position: relative），只作背景，不拦截事件。
 */

export interface PixelPalette {
  /** 面色（填充） */
  face: string;
  /** 外描边（最深轮廓） */
  edge: string;
  /** 高光（凸起时在顶/左） */
  hi: string;
  /** 暗影（凸起时在底/右） */
  lo: string;
}

interface PixelFrameProps {
  palette: PixelPalette;
  /** raised=凸起（高光在上）、sunken=凹陷（高光在下）、flat=只描边 */
  variant?: "raised" | "sunken" | "flat";
  /** 每个美术像素占多少 CSS px（越大越“糊块”越复古） */
  pixel?: number;
  /** 四角抠除的像素格数（切角大小） */
  radius?: number;
  /** 抖动纹理颜色；不传则无纹理 */
  dither?: string;
  ditherOpacity?: number;
  /** 静态底噪强度 0~1（面像素随机明暗，无动画）；0=纯色 */
  noise?: number;
  /** 底噪颗粒度：N×N 个美术像素合成一块（越大越粗块，独立于 pixel） */
  noiseGranularity?: number;
  /**
   * 底噪动态变化速度（每秒）：0=静态（默认，纯质感不动）；
   * >0 时底噪按块随时间用 value-noise 缓慢重掷 —— 值越小变化越慢越柔。
   * 用于「面板底色要活起来但很克制」的场景（如侧边栏）。
   */
  noiseSpeed?: number;
  /** 边缘啃缺概率 0~1：沿四边随机啃掉 1~2px 缺口，形成不规则/做旧的粗犷轮廓；0=规整 */
  edgeErosion?: number;
  /** 像素硬投影高度（CSS px），0=无 */
  elevation?: number;
  shadowColor?: string;
  /**
   * 空心框：只画一圈边（外描边 + raised/sunken 内线斜角），中心透明。
   * 用于「窗口外包裹框」——叠在最上层，只收口一圈，不遮挡内部内容。
   * 此模式下 noise/dither 无意义（无面色）；radius 建议 0（方窗）。
   */
  hollow?: boolean;
}

const asFill = (c: string): CSSProperties => ({ fill: c });

// 底噪灰度增量系数（与 PixelSurface 的 shimmerPx 对齐，浅/深面都可见）
const NOISE_PX = 150;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [230, 244, 244];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clampCh = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

// 伪随机 hash → [0,1)
function hash1(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

// 平滑值噪声（value-noise）：随 x 连续变化，每整数格重掷随机值并 smoothstep 插值 → [0,1)
function vnoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(seed + i * 131.0);
  const b = hash1(seed + (i + 1) * 131.0);
  return a + (b - a) * u;
}

export function PixelFrame({
  palette,
  variant = "raised",
  pixel = 3,
  radius = 2,
  dither,
  ditherOpacity = 0.5,
  noise = 0,
  noiseGranularity = 1,
  noiseSpeed = 0,
  edgeErosion = 0,
  elevation = 0,
  shadowColor = t.colorShadowPixel,
  hollow = false,
}: PixelFrameProps) {
  const ref = useRef<SVGSVGElement>(null);
  const [{ w, h }, setSize] = useState({ w: 0, h: 0 });
  const rid = useId().replace(/:/g, "");
  const maskId = `pf-m-${rid}`;
  const faceMaskId = `pf-fm-${rid}`;
  const ditherId = `pf-d-${rid}`;
  const hollowMaskId = `pf-h-${rid}`;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(4, Math.round(w / pixel));
  const rows = Math.max(4, Math.round(h / pixel));

  // 顶左 / 底右 内线颜色（凹陷则对调）
  const topLeft = variant === "sunken" ? palette.lo : palette.hi;
  const botRight = variant === "sunken" ? palette.hi : palette.lo;

  // 四角切角（曼哈顿阶梯，保留像素硬边）。
  // 双级切角实现「圆角处描边仍连续包住转角」：
  //  - 外轮廓抠掉 gx+gy < r 的角格（透明，得到圆角外形）；
  //  - 面色多抠一档 gx+gy < r+1，使转角对角线上露出 1 格外描边。
  // radius=0 → 直角（不切角），用于窗口边界这类不能有圆角/缺角的场景。
  const r = Math.max(0, Math.round(radius));
  const cornerCut = (R: number, tag: string): ReactElement[] => {
    const out: ReactElement[] = [];
    for (let gx = 0; gx < R; gx++) {
      for (let gy = 0; gy < R; gy++) {
        if (gx + gy < R) {
          out.push(
            <rect key={`${tag}-tl-${gx}-${gy}`} x={gx} y={gy} width={1} height={1} fill="#000" />,
            <rect key={`${tag}-tr-${gx}-${gy}`} x={cols - 1 - gx} y={gy} width={1} height={1} fill="#000" />,
            <rect key={`${tag}-bl-${gx}-${gy}`} x={gx} y={rows - 1 - gy} width={1} height={1} fill="#000" />,
            <rect key={`${tag}-br-${gx}-${gy}`} x={cols - 1 - gx} y={rows - 1 - gy} width={1} height={1} fill="#000" />,
          );
        }
      }
    }
    return out;
  };
  const outerCut = r > 0 ? cornerCut(r, "o") : [];
  const faceCut = r > 0 ? cornerCut(r + 1, "f") : [];

  // 边缘啃缺：沿四边（避开切角）随机抠掉 1~2px 缺口 → 不规则/做旧的粗犷轮廓。
  // 抠在两个 mask 上，缺口处描边+面色一起消失、露出背景，得到真锯齿边。
  const erodeCut = useMemo<ReactElement[]>(() => {
    if (edgeErosion <= 0) return [];
    const p = edgeErosion;
    const out: ReactElement[] = [];
    const bite = () => (Math.random() < 0.3 ? 2 : 1); // 偶尔啃深一点
    for (let x = r; x <= cols - 1 - r; x++) {
      if (Math.random() < p) {
        const d = bite();
        out.push(<rect key={`et-${x}`} x={x} y={0} width={1} height={d} fill="#000" />);
      }
      if (Math.random() < p) {
        const d = bite();
        out.push(<rect key={`eb-${x}`} x={x} y={rows - d} width={1} height={d} fill="#000" />);
      }
    }
    for (let y = r; y <= rows - 1 - r; y++) {
      if (Math.random() < p) {
        const d = bite();
        out.push(<rect key={`el-${y}`} x={0} y={y} width={d} height={1} fill="#000" />);
      }
      if (Math.random() < p) {
        const d = bite();
        out.push(<rect key={`er-${y}`} x={cols - d} y={y} width={d} height={1} fill="#000" />);
      }
    }
    return out;
  }, [cols, rows, r, edgeErosion]);

  // 底噪按块（gran×gran）铺在面色上。
  // 每块记录位置/尺寸 + 随机 seed/phase：静态时首帧即定（seed 用于初值），
  // noiseSpeed>0 时由下面的 RAF effect 按 value-noise 随时间重掷 fill（慢速、错落）。
  // useMemo 依赖尺寸/参数 → 仅在尺寸/参数变化时重建，不随无关渲染乱闪。
  const noiseBlocks = useMemo(() => {
    if (noise <= 0) return [];
    const g = Math.max(1, Math.round(noiseGranularity));
    const blocks: {
      x: number;
      y: number;
      w: number;
      h: number;
      seed: number;
      phase: number;
    }[] = [];
    for (let by = 1; by < rows - 1; by += g) {
      for (let bx = 1; bx < cols - 1; bx += g) {
        blocks.push({
          x: bx,
          y: by,
          w: Math.min(g, cols - 1 - bx),
          h: Math.min(g, rows - 1 - by),
          seed: Math.random() * 1000,
          phase: Math.random(), // 错落相位：各块起点不同，变化不齐步
        });
      }
    }
    return blocks;
  }, [cols, rows, noise, noiseGranularity]);

  const [fr, fg, fb] = hexToRgb(palette.face);
  const noiseGroupRef = useRef<SVGGElement>(null);

  // 首帧 fill：静态用块 seed 定一次随机灰度；动态版会被 RAF 覆盖，这里给个稳定初值
  const noiseRects = noiseBlocks.map((b, i) => {
    const d = (hash1(b.seed) * 2 - 1) * noise * NOISE_PX;
    const fill = `rgb(${clampCh(fr + d)},${clampCh(fg + d)},${clampCh(fb + d)})`;
    return (
      <rect key={`n-${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill={fill} />
    );
  });

  // 动态底噪：noiseSpeed>0 时逐帧按块用 value-noise 缓慢重掷灰度，直接写 rect.fill（不触发 React 重渲染）。
  useEffect(() => {
    const g = noiseGroupRef.current;
    if (!g || noise <= 0 || noiseSpeed <= 0) return;
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const time = ((now - start) / 1000) * noiseSpeed;
      const nodes = g.childNodes as unknown as SVGRectElement[];
      for (let i = 0; i < noiseBlocks.length; i++) {
        const b = noiseBlocks[i];
        const dyn = (vnoise(b.seed, time + b.phase) - 0.5) * 2; // [-1,1)
        const d = dyn * noise * NOISE_PX;
        const rect = nodes[i];
        if (rect) {
          rect.setAttribute(
            "fill",
            `rgb(${clampCh(fr + d)},${clampCh(fg + d)},${clampCh(fb + d)})`,
          );
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [noiseBlocks, noise, noiseSpeed, fr, fg, fb]);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${cols} ${rows}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
        filter: elevation > 0 ? `drop-shadow(0 ${elevation}px 0 ${shadowColor})` : undefined,
        transition: "filter 0.12s ease",
      }}
    >
      <defs>
        <mask id={maskId}>
          <rect x={0} y={0} width={cols} height={rows} fill="#fff" />
          {outerCut}
          {erodeCut}
        </mask>
        <mask id={faceMaskId}>
          <rect x={0} y={0} width={cols} height={rows} fill="#fff" />
          {faceCut}
          {erodeCut}
        </mask>
        {dither && (
          <pattern id={ditherId} width={4} height={4} patternUnits="userSpaceOnUse">
            <rect x={0} y={0} width={1} height={1} style={asFill(dither)} />
            <rect x={1} y={1} width={1} height={1} style={asFill(dither)} />
            <rect x={2} y={2} width={1} height={1} style={asFill(dither)} />
            <rect x={3} y={3} width={1} height={1} style={asFill(dither)} />
            <rect x={3} y={0} width={1} height={1} style={asFill(dither)} />
            <rect x={0} y={3} width={1} height={1} style={asFill(dither)} />
          </pattern>
        )}
        {/* 空心框专用 mask：只保留外圈 2px 环（外描边 1px + 内斜角 1px），中心挖空透明 */}
        {hollow && (
          <mask id={hollowMaskId}>
            <rect x={0} y={0} width={cols} height={rows} fill="#fff" />
            <rect x={2} y={2} width={cols - 4} height={rows - 4} fill="#000" />
            {outerCut}
            {erodeCut}
          </mask>
        )}
      </defs>

      {hollow ? (
        /* 空心框：外描边整块 + 内斜角，套 hollowMask 只留一圈环 */
        <g mask={`url(#${hollowMaskId})`}>
          <rect x={0} y={0} width={cols} height={rows} style={asFill(palette.edge)} />
          {variant !== "flat" && (
            <>
              {/* 顶左内斜角（在外描边内侧 1px 环上） */}
              <rect x={1} y={1} width={cols - 2} height={1} style={asFill(topLeft)} />
              <rect x={1} y={1} width={1} height={rows - 2} style={asFill(topLeft)} />
              {/* 底右内斜角 */}
              <rect x={1} y={rows - 2} width={cols - 2} height={1} style={asFill(botRight)} />
              <rect x={cols - 2} y={1} width={1} height={rows - 2} style={asFill(botRight)} />
            </>
          )}
        </g>
      ) : (
        <g mask={`url(#${maskId})`}>
          {/* 外描边（整块，圆角外形由 outerCut 决定） */}
          <rect x={0} y={0} width={cols} height={rows} style={asFill(palette.edge)} />
          {/* 面色 + 铺底 + 内线：再套 faceMask 多缩一档，使转角处露出连续描边 */}
          <g mask={`url(#${faceMaskId})`}>
            {/* 面色 */}
            <rect x={1} y={1} width={cols - 2} height={rows - 2} style={asFill(palette.face)} />
            {/* 底噪（按块灰度盖在面色上）；noiseSpeed>0 时由 RAF 逐帧改 fill 做慢速动态变化 */}
            <g ref={noiseGroupRef}>{noiseRects}</g>
            {/* 抖动纹理 */}
            {dither && (
              <rect
                x={1}
                y={1}
                width={cols - 2}
                height={rows - 2}
                fill={`url(#${ditherId})`}
                opacity={ditherOpacity}
              />
            )}
            {variant !== "flat" && (
              <>
                {/* 顶左内线 */}
                <rect x={1} y={1} width={cols - 2} height={1} style={asFill(topLeft)} />
                <rect x={1} y={1} width={1} height={rows - 2} style={asFill(topLeft)} />
                {/* 底右内线 */}
                <rect x={1} y={rows - 2} width={cols - 2} height={1} style={asFill(botRight)} />
                <rect x={cols - 2} y={1} width={1} height={rows - 2} style={asFill(botRight)} />
              </>
            )}
          </g>
        </g>
      )}
    </svg>
  );
}
