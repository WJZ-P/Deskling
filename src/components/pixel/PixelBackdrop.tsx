import { useEffect, useRef } from "react";
import { styled } from "@linaria/react";
import type { ThemeMode } from "../../styles/theme";

/**
 * 主区域像素活壁纸（canvas 版）——沙滩海浪喵～
 *
 * 概念：整个背景 = 一片沙滩，每个像素 = 一粒沙子（固定的轻微明暗，静止不动）。
 * 一条海浪线从下往上「冲刷」再退回：浪线以下是被打湿的沙（略暗），
 * 浪线处有一条明亮的浪花（foam）。
 *
 * 关键（避免全屏抖动）：底沙是「静态」的，不逐帧重算整场；
 * 每帧只有海浪线的位置在动，因此只有浪线附近少量像素在变 → 安静、柔和。
 *
 * 低分辨率缓冲（每美术像素=1 buffer 像素）+ CSS image-rendering:pixelated 放大。
 * 绝对铺满父级（父级需 position: relative），只作背景，不拦截事件。
 */

// ---- 顶层可调常量 ----
const PIXEL = 6; // 每个美术像素占多少 CSS px
const FRAME_MS = 40; // 重绘节流（~25fps）

// 沙子（静态）
const SAND_GRAIN_PX = 8; // 沙粒明暗颗粒幅度（绝对灰度 ±）
const POSTERIZE = 4; // 色阶量化步长（灰度）

// 海浪
const WAVE_PERIOD = 7; // 一次完整冲刷+退回的周期（秒）
const WAVE_REST_FRAC = 0.9; // 静息水线位置（占高度比，越大越靠下）
const WAVE_RISE_FRAC = 0.62; // 冲刷最高能到多高（占高度比，越大冲得越高）
const WAVE_CURVE_AMP = 4; // 水线横向起伏幅度（buffer 像素，避免笔直）
const WAVE_CURVE_WAVES = 1.5; // 水线横向起伏的波数

const WET_PX = 16; // 湿沙变暗幅度
const WET_SOFT = 3; // 湿区上沿软过渡（buffer 像素）
const FOAM_PX = 30; // 浪花提亮幅度
const FOAM_CENTER = 1; // 浪花中心相对水线的偏移（+ 在水线下方一点）
const FOAM_HALF = 3; // 浪花带半宽（buffer 像素）

// 单一底色（比 normal 面色 #e6f4f4 略深，让面板浮起来）
const BASE: Record<ThemeMode, [number, number, number]> = {
  light: [200, 230, 231], // #c8e6e7
  dark: [11, 22, 40], // #0b1628
};

const clampCh = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2);

// 海浪冲刷形状：快速涌上 → 顶部短暂停留 → 缓慢退回 → 静息，返回 0~1（1=涌到最高）
function washShape(p: number): number {
  if (p < 0.22) return easeOut(p / 0.22);
  if (p < 0.34) return 1;
  if (p < 0.78) return 1 - easeInOut((p - 0.34) / 0.44);
  return 0;
}

export function PixelBackdrop({ theme }: { theme: ThemeMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const [baseR, baseG, baseB] = BASE[theme];

    let cols = 0;
    let rows = 0;
    let n = 0;
    let grain = new Float32Array(0); // 静态沙粒明暗
    let curve = new Float32Array(0); // 静态水线横向起伏（每列）
    let img: ImageData | null = null;

    const draw = (time: number) => {
      if (!img) return;
      const restY = rows * WAVE_REST_FRAC;
      const rise = rows * WAVE_RISE_FRAC;
      const h = reduce ? 0 : washShape((time / WAVE_PERIOD) % 1);
      const waterY = restY - rise * h; // 本帧水线基准（不含横向起伏）

      const data = img.data;
      let d = 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          let delta = grain[y * cols + x];
          const line = waterY + curve[x];
          const below = y - line;
          // 湿沙：水线以下变暗，上沿软过渡
          if (below > 0) {
            const wet = below < WET_SOFT ? below / WET_SOFT : 1;
            delta -= WET_PX * wet;
          }
          // 浪花：水线附近一条亮带（三角衰减，便宜）
          const fb = below - FOAM_CENTER;
          if (fb > -FOAM_HALF && fb < FOAM_HALF) {
            const f = 1 - Math.abs(fb) / FOAM_HALF;
            delta += FOAM_PX * f * f;
          }
          const q = Math.round(delta / POSTERIZE) * POSTERIZE;
          data[d] = clampCh(baseR + q);
          data[d + 1] = clampCh(baseG + q);
          data[d + 2] = clampCh(baseB + q);
          data[d + 3] = 255;
          d += 4;
        }
      }
      ctx.putImageData(img, 0, 0);
    };

    const resize = () => {
      const w = canvas.clientWidth;
      const hh = canvas.clientHeight;
      cols = Math.max(1, Math.ceil(w / PIXEL));
      rows = Math.max(1, Math.ceil(hh / PIXEL));
      n = cols * rows;
      canvas.width = cols;
      canvas.height = rows;
      grain = new Float32Array(n);
      for (let c = 0; c < n; c++) grain[c] = (Math.random() * 2 - 1) * SAND_GRAIN_PX;
      curve = new Float32Array(cols);
      const k = (Math.PI * 2 * WAVE_CURVE_WAVES) / cols;
      const ph = Math.random() * Math.PI * 2;
      for (let x = 0; x < cols; x++) curve[x] = Math.sin(x * k + ph) * WAVE_CURVE_AMP;
      img = ctx.createImageData(cols, rows);
      draw(performance.now());
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let timer = 0;
    if (!reduce) {
      const tick = () => {
        raf = requestAnimationFrame((now) => {
          draw(now);
          timer = window.setTimeout(tick, FRAME_MS);
        });
      };
      tick();
    }

    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [theme]);

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
  image-rendering: pixelated;
`;
