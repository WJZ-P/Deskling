import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";

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
  /** 像素硬投影高度（CSS px），0=无 */
  elevation?: number;
  shadowColor?: string;
}

const asFill = (c: string): CSSProperties => ({ fill: c });

export function PixelFrame({
  palette,
  variant = "raised",
  pixel = 3,
  radius = 2,
  dither,
  ditherOpacity = 0.5,
  elevation = 0,
  shadowColor = "rgba(31,106,111,0.35)",
}: PixelFrameProps) {
  const ref = useRef<SVGSVGElement>(null);
  const [{ w, h }, setSize] = useState({ w: 0, h: 0 });
  const rid = useId().replace(/:/g, "");
  const maskId = `pf-m-${rid}`;
  const faceMaskId = `pf-fm-${rid}`;
  const ditherId = `pf-d-${rid}`;

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
  const r = Math.max(1, radius);
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
  const outerCut = cornerCut(r, "o");
  const faceCut = cornerCut(r + 1, "f");

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
        </mask>
        <mask id={faceMaskId}>
          <rect x={0} y={0} width={cols} height={rows} fill="#fff" />
          {faceCut}
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
      </defs>

      <g mask={`url(#${maskId})`}>
        {/* 外描边（整块，圆角外形由 outerCut 决定） */}
        <rect x={0} y={0} width={cols} height={rows} style={asFill(palette.edge)} />
        {/* 面色 + 铺底 + 内线：再套 faceMask 多缩一档，使转角处露出连续描边 */}
        <g mask={`url(#${faceMaskId})`}>
          {/* 面色 */}
          <rect x={1} y={1} width={cols - 2} height={rows - 2} style={asFill(palette.face)} />
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
    </svg>
  );
}
