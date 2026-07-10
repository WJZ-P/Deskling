import { memo, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { t } from "../../styles/theme";
import { PixelFrame, type PixelPalette } from "./PixelFrame";
import { useElementSize } from "./useElementSize";
import {
  renderPixelFrameInto,
  glRendererAvailable,
  addAnimatedFrame,
  removeAnimatedFrame,
} from "./glPixelRenderer";

/**
 * GPU 渲染版像素帧：视觉等价于 PixelFrame（raised/sunken/flat + 低噪 + 切角 +
 * hollow 空心框），但把 SVG 的几百个 <rect> 塌成「一张 GPU 渲染的 2D canvas」铺满，
 * image-rendering: pixelated 最近邻放大，逐像素复刻 SVG 的 crispEdges 观感。
 *
 * 渲染路径：全 app 共享一个离屏 WebGL 上下文当引擎，一发着色器画到 cols×rows，
 * 再 blit（drawImage）到本组件自己的 2D <canvas>。为什么不每帧一个 WebGL 上下文：
 * Chromium 单页上限约 16 个，几十个帧直接爆；2D 上下文无此限，可开成百上千。
 * 这正是「页面组件一多，SVG 版几万个 <rect> 就卡」的根治办法。
 *
 *  - 静态帧（noiseSpeed=0 且非 animate）：尺寸/参数变化时渲染一次，之后零开销。
 *  - 游动帧（noiseSpeed>0，如侧栏/标题栏底噪常驻；或 animate 的流式气泡）：挂到
 *    全 app 共享的单条 rAF，逐帧推 u_time 重画，低噪平滑蠕动。无动画帧时 rAF 自停。
 *
 * 异形效果（notch 书签缺口 / edgeErosion 做旧啃边 / dither 抖动 / sweep 扫描态）
 * 着色器暂不复刻 —— 命中这些 props 时自动委托回 SVG 版 PixelFrame，观感零回归。
 * WebGL 整体不可用时同样回退 SVG。绝对定位铺满父级（父级需 position: relative），
 * 只作背景，不拦截事件。故本组件可作为 PixelFrame 的直接替换（drop-in）。
 */

interface GLPixelFrameProps {
  palette: PixelPalette;
  variant?: "raised" | "sunken" | "flat";
  pixel?: number;
  radius?: number;
  noise?: number;
  noiseGranularity?: number;
  /** 低噪随时间游动的速度（每秒重掷次数）：0=静态；>0 底噪常驻慢速游动（侧栏/标题栏用） */
  noiseSpeed?: number;
  /** 像素硬投影高度（CSS px），0=无 */
  elevation?: number;
  shadowColor?: string;
  /** 空心框：只画外圈 2px 环，中心透明（窗口收口框用） */
  hollow?: boolean;
  /** 内容驱动的离散尺寸变化（气泡追加内容）传 true：突发首帧同步测量重渲 */
  liveResize?: boolean;
  /** 低噪随时间蠕动（仅正在流式输出的那条气泡传 true，等价于 noiseSpeed=2.5） */
  animate?: boolean;
  sizeKey?: string | number;
  // ---- 以下异形 props 着色器不复刻：命中即整体回退 SVG（透传给 PixelFrame）----
  dither?: string;
  ditherOpacity?: number;
  edgeErosion?: number;
  notch?: number;
  sweepPalette?: PixelPalette;
  sweepActive?: boolean;
}

export const GLPixelFrame = memo(function GLPixelFrame(props: GLPixelFrameProps) {
  const {
    palette,
    variant = "raised",
    pixel = 3,
    radius = 2,
    noise = 0,
    noiseGranularity = 1,
    noiseSpeed = 0,
    elevation = 0,
    shadowColor = t.colorShadowPixel,
    hollow = false,
    liveResize = false,
    animate = false,
    sizeKey,
    dither,
    edgeErosion = 0,
    notch = 0,
    sweepPalette,
  } = props;

  const ref = useRef<HTMLCanvasElement>(null);
  const { w, h } = useElementSize(ref, { sizeKey, liveResize });

  // WebGL 一次性探测：不可用则整体回退到 SVG 版
  const available = useMemo(() => glRendererAvailable(), []);

  // 异形效果着色器暂不支持：命中任一即回退 SVG（含 WebGL 不可用）。
  // notch/edgeErosion/dither/sweep 用得少，交给功能更全的 SVG 版，观感零回归。
  const forceSvg =
    !available ||
    dither != null ||
    edgeErosion > 0 ||
    notch > 0 ||
    sweepPalette != null;

  // 有效游动速度：显式 noiseSpeed 优先；否则 animate（流式气泡）等价于 2.5Hz。
  const speed = noiseSpeed > 0 ? noiseSpeed : animate ? 2.5 : 0;

  const cols = Math.max(4, Math.round(w / pixel));
  const rows = Math.max(4, Math.round(h / pixel));

  // 渲染参数打包：静态渲染 effect 与动画 tick 共用同一份，变化即重渲/重挂。
  // useMemo 稳定引用，避免每次 render 都触发下面两个 effect。
  const params = useMemo(
    () => ({
      cols,
      rows,
      variant,
      palette,
      radius,
      noise,
      noiseGranularity,
      noiseSpeed: speed,
      hollow,
    }),
    [cols, rows, variant, palette, radius, noise, noiseGranularity, speed, hollow],
  );

  // 静态渲染：尺寸/参数变化时画一帧（time=0）。游动态由下面的 rAF 覆盖，
  // 但这里仍先画一帧，保证 speed 由正转零的收尾帧、以及尺寸突变时立即刷新。
  useEffect(() => {
    if (forceSvg || w === 0 || h === 0) return;
    const canvas = ref.current;
    if (!canvas) return;
    renderPixelFrameInto(canvas, params, 0);
  }, [forceSvg, w, h, params]);

  // 游动动画：仅 speed>0 时挂到共享 rAF，逐帧推时间重画本 canvas。
  // 卸载/speed 转零时注销 —— 无动画帧时共享 rAF 自动停，回到零开销。
  //
  // 网格尺寸每帧现量（clientWidth/Height），不用 React 侧的 w/h：那份状态走
  // 140ms 防抖，流式气泡第一行逐字变宽时它一直滞后 —— 位图停留在旧的小宽度、
  // 被 CSS 拉伸铺满，表现为「边框变粗、切角拉成椭圆」，直到宽度停稳才回弹。
  // 反正动画帧每帧都要重画，量一次布局的开销可忽略；静态帧不受影响仍走防抖。
  useEffect(() => {
    if (forceSvg || speed <= 0 || w === 0 || h === 0) return;
    const canvas = ref.current;
    if (!canvas) return;
    const tick = (timeSec: number) => {
      const liveCols = Math.max(4, Math.round(canvas.clientWidth / pixel));
      const liveRows = Math.max(4, Math.round(canvas.clientHeight / pixel));
      renderPixelFrameInto(canvas, { ...params, cols: liveCols, rows: liveRows }, timeSec);
    };
    addAnimatedFrame(tick);
    return () => removeAnimatedFrame(tick);
  }, [forceSvg, speed, w, h, params, pixel]);

  // 回退 SVG：透传全部 props（含异形效果），行为与直接用 PixelFrame 完全一致
  if (forceSvg) {
    return <PixelFrame {...props} />;
  }

  const style: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    // canvas 缓冲是 cols×rows，CSS 拉满父级 → 最近邻放大保持像素硬边
    imageRendering: "pixelated",
    filter: elevation > 0 ? `drop-shadow(0 ${elevation}px 0 ${shadowColor})` : undefined,
    transition: "filter 0.12s ease",
  };

  // ref 挂在铺满的 canvas 上（它就是被测量的盒子，尺寸=父级内容盒）
  return <canvas ref={ref} aria-hidden style={style} />;
});
