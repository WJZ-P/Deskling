import { useEffect, useRef, useState, type CSSProperties } from "react";
import { styled } from "@linaria/react";
import type { ThemeMode } from "../../styles/theme";
import {
  DEFAULT_BACKDROP,
  getBackdropStyle,
  type BackdropRenderer,
  type BackdropStyleId,
} from "./backdrops";

/**
 * 主区域 WebGL 背景宿主。
 *
 * 本组件只负责通用外壳：拿 WebGL 上下文、RAF 帧循环 + 帧率上限、
 * 降分辨率、鼠标跟随、尺寸变化、失焦/隐藏暂停；具体画什么交给 backdrops/ 里的风格。
 * 通过 `style` 切换风格（湍流 / 卷曲流场 / 反应扩散 / 元胞自动机）。
 *
 * 兜底：无 WebGL、风格创建失败、或系统「减少动态」→ 回退静态 CSS 渐变。
 * 绝对铺满父级（父级需 position: relative），只作背景，不拦截事件。
 */

// ============ 顶部可调参数喵 ============
const RENDER_SCALE = 0.5; // 呈现分辨率倍率（<1 更省更柔）
const FPS_CAP = 60; // 帧率上限
const MOUSE_EASE = 0.1; // 鼠标跟随平滑（越小越跟手）
const MOUSE_OFFSCREEN = -10; // 鼠标「离场」哨兵坐标（远到无影响）
// 尺寸变化防抖：侧栏展开/收起过渡、手动拖窗口时尺寸连续变，若每个中间尺寸都重建
// GPU 缓冲（renderer.resize 会销毁+重建纹理并重播种）会卡顿。这里等尺寸「停下」
// 再真正重建；过渡/拖拽期间画布保持旧分辨率由 CSS 拉伸顶着（0.5 倍柔背景几乎无感）。
const RESIZE_DEBOUNCE_MS = 100;

// 兜底 CSS 渐变配色
const FALLBACK_COLORS: Record<ThemeMode, string> = {
  light:
    "radial-gradient(120% 120% at 25% 20%, #7dd1d455, transparent 55%)," +
    "radial-gradient(120% 120% at 80% 70%, #a8c8ff44, transparent 55%)," +
    "radial-gradient(100% 100% at 60% 90%, #a6e6cf44, transparent 55%),#e9f6f6",
  dark:
    "radial-gradient(120% 120% at 25% 20%, #2ea6ad55, transparent 55%)," +
    "radial-gradient(120% 120% at 80% 70%, #2b5aa044, transparent 55%)," +
    "radial-gradient(100% 100% at 60% 90%, #1d7d8644, transparent 55%),#0a1626",
};

interface FluidBackdropProps {
  theme: ThemeMode;
  style?: BackdropStyleId;
}

export function FluidBackdrop({ theme, style = DEFAULT_BACKDROP }: FluidBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) {
      setFallback(true);
      return;
    }

    // 上下文只取一次（切换风格/主题时复用，避免耗尽 WebGL 上下文）
    if (!glRef.current) {
      glRef.current = canvas.getContext("webgl", {
        antialias: false,
        depth: false,
        alpha: false,
        powerPreference: "low-power",
      });
    }
    const gl = glRef.current;
    if (!gl) {
      setFallback(true);
      return;
    }

    const renderer: BackdropRenderer | null = getBackdropStyle(style).create(gl, theme);
    if (!renderer) {
      setFallback(true);
      return;
    }
    setFallback(false);

    let vw = 0;
    let vh = 0;
    const applyResize = () => {
      const w = Math.max(1, Math.floor(canvas.clientWidth * RENDER_SCALE));
      const h = Math.max(1, Math.floor(canvas.clientHeight * RENDER_SCALE));
      if (w === vw && h === vh) return;
      vw = w;
      vh = h;
      canvas.width = w;
      canvas.height = h;
      renderer.resize(w, h);
    };
    // 首次立即建（拿到正确初始分辨率）；之后每次尺寸变化都重置计时器，停稳 ~140ms 才重建
    applyResize();
    let resizeTimer = 0;
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(applyResize, RESIZE_DEBOUNCE_MS);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(canvas);

    // 鼠标（aspect-centered，y 轴翻转匹配 gl_FragCoord）；未进入前置于「离场」哨兵
    const mouseTarget: [number, number] = [MOUSE_OFFSCREEN, MOUSE_OFFSCREEN];
    const mouseCur: [number, number] = [MOUSE_OFFSCREEN, MOUSE_OFFSCREEN];
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      const aspect = rect.width / rect.height;
      mouseTarget[0] = (nx - 0.5) * aspect;
      mouseTarget[1] = 1.0 - ny - 0.5;
    };
    const onLeave = () => {
      mouseTarget[0] = MOUSE_OFFSCREEN;
      mouseTarget[1] = MOUSE_OFFSCREEN;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerout", onLeave, { passive: true });

    const start = performance.now();
    let lastFrame = start;
    const render = (now: number) => {
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      mouseCur[0] += (mouseTarget[0] - mouseCur[0]) * MOUSE_EASE;
      mouseCur[1] += (mouseTarget[1] - mouseCur[1]) * MOUSE_EASE;
      renderer.frame((now - start) / 1000, dt, mouseCur);
    };

    let raf = 0;
    let timer = 0;
    const tick = () => {
      raf = requestAnimationFrame((now) => {
        if (!document.hidden) render(now);
        timer = window.setTimeout(tick, 1000 / FPS_CAP);
      });
    };
    tick();

    return () => {
      ro.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onLeave);
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      renderer.dispose();
    };
  }, [theme, style]);

  if (fallback) {
    const bg: CSSProperties = { background: FALLBACK_COLORS[theme] };
    return <FallbackBox style={bg} aria-hidden />;
  }

  return <Canvas ref={canvasRef} aria-hidden />;
}

const Canvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  z-index: 0;
  pointer-events: none;
`;

const FallbackBox = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
`;
