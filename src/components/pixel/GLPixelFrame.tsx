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
 * GPU 渲染版像素帧：视觉等价于 PixelFrame（raised/sunken/flat + 低噪 + 切角），
 * 但把 SVG 的几百个 <rect> 塌成「一张 GPU 渲染的 2D canvas」铺满，
 * image-rendering: pixelated 最近邻放大，逐像素复刻 SVG 的 crispEdges 观感。
 *
 * 渲染路径：全 app 共享一个离屏 WebGL 上下文当引擎，一发着色器画到 cols×rows，
 * 再 blit（drawImage）到本组件自己的 2D <canvas>。为什么不每气泡一个 WebGL 上下文：
 * Chromium 单页上限约 16 个，几十个气泡直接爆；2D 上下文无此限，可开成百上千。
 *
 *  - animate=false（默认，静态气泡/头像）：尺寸/参数变化时渲染一次，之后零开销。
 *  - animate=true（仅正在流式输出的那条气泡）：挂到共享 rAF，逐帧推 u_time 重画，
 *    低噪平滑蠕动。流式结束 animate 转 false，rAF 自动停（无其他动画帧时不转）。
 *
 * WebGL 不可用时自动回退到 SVG 版 PixelFrame，行为不降级。
 * 绝对定位铺满父级（父级需 position: relative），只作背景，不拦截事件。
 */

interface GLPixelFrameProps {
  palette: PixelPalette;
  variant?: "raised" | "sunken" | "flat";
  pixel?: number;
  radius?: number;
  noise?: number;
  noiseGranularity?: number;
  /** 像素硬投影高度（CSS px），0=无 */
  elevation?: number;
  shadowColor?: string;
  /** 内容驱动的离散尺寸变化（气泡追加内容）传 true：突发首帧同步测量重渲 */
  liveResize?: boolean;
  /** 低噪随时间蠕动（仅正在流式输出的那条气泡传 true） */
  animate?: boolean;
  sizeKey?: string | number;
}

export const GLPixelFrame = memo(function GLPixelFrame({
  palette,
  variant = "raised",
  pixel = 3,
  radius = 2,
  noise = 0,
  noiseGranularity = 1,
  elevation = 0,
  shadowColor = t.colorShadowPixel,
  liveResize = false,
  animate = false,
  sizeKey,
}: GLPixelFrameProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { w, h } = useElementSize(ref, { sizeKey, liveResize });

  // WebGL 一次性探测：不可用则整体回退到 SVG 版
  const available = useMemo(() => glRendererAvailable(), []);

  const cols = Math.max(4, Math.round(w / pixel));
  const rows = Math.max(4, Math.round(h / pixel));

  // 渲染参数打包：静态渲染 effect 与动画 tick 共用同一份，变化即重渲/重挂。
  // useMemo 稳定引用，避免每次 render 都触发下面两个 effect。
  const params = useMemo(
    () => ({ cols, rows, variant, palette, radius, noise, noiseGranularity }),
    [cols, rows, variant, palette, radius, noise, noiseGranularity],
  );

  // 静态渲染：尺寸/参数变化时画一帧（不含时间相位）。动画态由下面的 rAF 覆盖，
  // 但这里仍先画一帧，保证 animate 由真转假的收尾帧、以及尺寸突变时立即刷新。
  useEffect(() => {
    if (!available || w === 0 || h === 0) return;
    const canvas = ref.current;
    if (!canvas) return;
    renderPixelFrameInto(canvas, params, 0);
  }, [available, w, h, params]);

  // 动画：仅 animate 时挂到共享 rAF，逐帧推时间重画本 canvas。
  // 卸载/animate 转假时注销 —— 无动画帧时共享 rAF 自动停，回到零开销。
  useEffect(() => {
    if (!available || !animate || w === 0 || h === 0) return;
    const canvas = ref.current;
    if (!canvas) return;
    const tick = (timeSec: number) => {
      renderPixelFrameInto(canvas, { ...params, animate: true }, timeSec);
    };
    addAnimatedFrame(tick);
    return () => removeAnimatedFrame(tick);
  }, [available, animate, w, h, params]);

  // WebGL 不可用：直接渲染 SVG 版，行为与原来完全一致
  if (!available) {
    return (
      <PixelFrame
        palette={palette}
        variant={variant}
        pixel={pixel}
        radius={radius}
        noise={noise}
        noiseGranularity={noiseGranularity}
        elevation={elevation}
        shadowColor={shadowColor}
        liveResize={liveResize}
        sizeKey={sizeKey}
      />
    );
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
