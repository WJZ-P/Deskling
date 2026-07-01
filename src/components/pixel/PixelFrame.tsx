import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";

/**
 * SVG 像素帧渲染器（软件级像素 UI 的底层）。
 *
 * 纯 CSS 难以表达「多重内描边 + 高光/暗影 + 像素切角 + 抖动纹理」，这里改用 JS + SVG：
 *  1. ResizeObserver 测量容器 CSS 尺寸；
 *  2. 按 `pixel`（每个美术像素占多少 CSS px）换算成整数网格 cols×rows；
 *  3. 在网格坐标里逐格画矩形：外描边 / 面色 / 顶左高光 / 底右暗影 / 抖动纹理；
 *  4. 用 <mask> 抠掉四角若干格，得到「像素切角」（保留硬边的圆角感）；
 *  5. viewBox=cols×rows + preserveAspectRatio=none + shapeRendering=crispEdges，放大后锐利不糊。
 *
 * 该组件绝对定位铺满父级（父级需 position: relative），只作背景，不拦截事件。
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
}

const asFill = (c: string): CSSProperties => ({ fill: c });

export function PixelFrame({
  palette,
  variant = "raised",
  pixel = 4,
  radius = 2,
  dither,
  ditherOpacity = 0.5,
}: PixelFrameProps) {
  const ref = useRef<SVGSVGElement>(null);
  const [{ w, h }, setSize] = useState({ w: 0, h: 0 });
  const rid = useId().replace(/:/g, "");
  const maskId = `pf-m-${rid}`;
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

  // 四角切角：曼哈顿距离 < radius 的角格抠掉（对角阶梯，保留像素感）
  const r = Math.max(1, radius);
  const cut: ReactElement[] = [];
  for (let gx = 0; gx < r; gx++) {
    for (let gy = 0; gy < r; gy++) {
      if (gx + gy < r) {
        cut.push(
          <rect key={`tl-${gx}-${gy}`} x={gx} y={gy} width={1} height={1} fill="#000" />,
          <rect key={`tr-${gx}-${gy}`} x={cols - 1 - gx} y={gy} width={1} height={1} fill="#000" />,
          <rect key={`bl-${gx}-${gy}`} x={gx} y={rows - 1 - gy} width={1} height={1} fill="#000" />,
          <rect key={`br-${gx}-${gy}`} x={cols - 1 - gx} y={rows - 1 - gy} width={1} height={1} fill="#000" />,
        );
      }
    }
  }

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
      }}
    >
      <defs>
        <mask id={maskId}>
          <rect x={0} y={0} width={cols} height={rows} fill="#fff" />
          {cut}
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
        {/* 外描边（整块，随后被面色内缩露出 1 格边） */}
        <rect x={0} y={0} width={cols} height={rows} style={asFill(palette.edge)} />
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
    </svg>
  );
}
