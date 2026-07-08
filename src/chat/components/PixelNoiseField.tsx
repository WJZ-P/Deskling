import { useEffect, useRef } from "react";
import { styled } from "@linaria/react";
import { rawColor, type ThemeMode } from "../../styles/theme";

/**
 * 像素噪声场（对话主区背景底层，canvas 实现）。
 *
 * 「淡色底噪 + 蓝色低噪游动」：
 *  - 底噪：整片以 colorBg（主题淡色背景）为基色，每个像素块叠一点灰度颗粒 ——
 *    静态 hash 颗粒 + 一层极缓的动态 shimmer（幅度很小），底噪「活」着但克制；
 *  - 蓝色低噪游动：一层随时间漂移的 2D 值噪声「蓝场」，场值高处的像素块渐染成
 *    accent 青蓝 —— 蓝斑随场缓慢移动、聚散，像在底噪里游动。低噪颗粒对底/蓝一致。
 *
 * 性能：canvas 内部分辨率 = 网格 cols×rows（每块仅 1 canvas 像素），CSS 用
 * image-rendering:pixelated 硬边放大 → 几千块也只是一次 putImageData，极轻。
 * 24fps 节流 + document.hidden 暂停，不喧宾夺主也不费电。
 */

// ---- 顶层可调常量（主人改这里即可喵）----
const GRAN = 6; // 每个噪声块占的 CSS px（越大越糊块越复古）
const BASE_AMP = 10; // 底噪灰度振幅（±，越大颗粒越明显）— 改小了,更克制
const BASE_SHIMMER = 1; // 底噪随时间变化速度（每秒；越大抖越快，0=静态）
const BLUE_MAX = 0.42; // 蓝色最大浓度（0~1，越大蓝斑越实）
const BLUE_GATE = 0.58; // 蓝色显现阈值（只有蓝场高于此才显蓝，越大蓝越少越稀）
const BLUE_SCALE = 0.03; // 蓝场空间频率（越小蓝斑越大越舒展）
const BLUE_DRIFT = 0.05; // 蓝场漂移速度（越大游得越快）
const FPS = 24; // 帧率上限

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 伪随机 hash（二维输入）→ [0,1)
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// 2D 平滑值噪声：四角随机值 + smoothstep 双线性插值 → [0,1)
function snoise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

interface PixelNoiseFieldProps {
  theme: ThemeMode;
}

export function PixelNoiseField({ theme }: PixelNoiseFieldProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 基色（主题淡色背景）与蓝色都随主题取自 theme token
    const [br, bg, bb] = hexToRgb(rawColor("colorBg", theme));
    const [ar, ag, ab] = hexToRgb(rawColor("colorAccent", theme));

    let cols = 0;
    let rows = 0;
    let img: ImageData | null = null;
    // 每块的随机相位种子：按格坐标 hash 定一次，尺寸变化才重算。
    // 底噪灰度 = 用此种子 + 时间跑 value-noise → 每块各自缓慢明暗变化（错落不齐步）。
    let seed: Float32Array = new Float32Array(0);

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      cols = Math.max(1, Math.ceil(w / GRAN));
      rows = Math.max(1, Math.ceil(h / GRAN));
      canvas.width = cols;
      canvas.height = rows;
      img = ctx.createImageData(cols, rows);
      seed = new Float32Array(cols * rows);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          seed[y * cols + x] = hash2(x * 1.3 + 0.5, y * 1.7 + 0.5) * 20;
        }
      }
    };
    resize();

    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      if (now - last < 1000 / FPS) return;
      last = now;
      if (!img) return;
      const T = (now - t0) / 1000;
      const dx = T * BLUE_DRIFT;
      const dy = -T * BLUE_DRIFT * 0.6; // 横竖不同速 → 斜向游动不呆板
      const gt = T * BASE_SHIMMER; // 底噪明暗变化的时间进度
      const data = img.data;
      let p = 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          // 漂移蓝场 → 阈值上映射成蓝色浓度
          const bf = snoise2(x * BLUE_SCALE + dx, y * BLUE_SCALE + dy);
          const blue = bf > BLUE_GATE ? ((bf - BLUE_GATE) / (1 - BLUE_GATE)) * BLUE_MAX : 0;
          // 底噪灰度：每块用自己的相位种子跑 1D value-noise，随时间缓慢小幅明暗变化
          const s = seed[p >> 2];
          const g = (snoise2(s, gt + s) - 0.5) * 2 * BASE_AMP;
          // 淡底↔蓝混色后叠同一份低噪颗粒（淡底/蓝质感一致）
          data[p++] = clamp255(br * (1 - blue) + ar * blue + g);
          data[p++] = clamp255(bg * (1 - blue) + ag * blue + g);
          data[p++] = clamp255(bb * (1 - blue) + ab * blue + g);
          data[p++] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };
    raf = requestAnimationFrame(frame);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [theme]);

  return <Canvas ref={ref} aria-hidden />;
}

const Canvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  pointer-events: none;
`;
