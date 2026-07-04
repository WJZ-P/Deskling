import { rawColor, type ThemeMode } from "../../styles/theme";
import type { PixelPalette } from "./PixelFrame";

/* ---- 像素调色的色值运算工具（在字面 hex 上做明暗档，供 JS 逐格上色）---- */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const v = parseInt(n, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function toHex([r, g, b]: [number, number, number]): string {
  const c = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
/** amt>0 向白提亮，amt<0 向黑压暗（线性混合）。 */
function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = amt >= 0 ? 255 : 0;
  const k = Math.abs(amt);
  return toHex([r + (target - r) * k, g + (target - g) * k, b + (target - b) * k]);
}

/** 由单个「面色」基准生成一组像素调色（面/描边/高光/暗影 + 图标色）。 */
function skinFromBase(base: string) {
  return {
    pal: { face: base, edge: shade(base, -0.45), hi: shade(base, 0.5), lo: shade(base, -0.2) },
    icon: shade(base, -0.7),
  };
}

/**
 * 打样用调色板（青蓝识别色，浅色向）。
 * 每个 palette = 面色 / 外描边 / 高光 / 暗影，供 PixelFrame 逐格上色。
 * 之后要接主题可改成 var(--...) 字符串。
 */
export const PX = {
  default: { face: "#e6f4f4", edge: "#3f9599", hi: "#ffffff", lo: "#a9cfd1" },
  accent: { face: "#7dd1d4", edge: "#1d6a6f", hi: "#d8f4f5", lo: "#3f9ea3" },
  well: { face: "#c2e7e8", edge: "#3f9599", hi: "#ffffff", lo: "#93c4c6" },
  panel: { face: "#ffffff", edge: "#3f9599", hi: "#ffffff", lo: "#cfe8e9" },
} satisfies Record<string, PixelPalette>;

/**
 * 统一优先级色阶（所有像素组件通用喵）：
 *  - normal（默认）= 中间色（浅青识别色）
 *  - low（低优先级）= 白底
 *  - primary（强调）= 深色（青）
 */
export type Priority = "normal" | "low" | "primary";

export const PRIORITY_PAL: Record<Priority, PixelPalette> = {
  normal: PX.default, // 中间色（浅青）
  low: PX.panel, // 白底
  primary: PX.accent, // 深色（青）
};

/** 抖动纹理颜色（浅青，用于进度/强调填充的斜向像素条纹） */
export const DITHER_ACCENT = "#d8f4f5";

/**
 * 标题栏面板调色（随主题）。全部由 theme.ts 的颜色 token 推导，
 * 面色/描边直接取表面与强描边 token，高光/暗影按面色做明暗档。
 */
export const TITLEBAR_PAL: Record<ThemeMode, PixelPalette> = {
  light: {
    face: rawColor("colorSurface2", "light"),
    edge: rawColor("colorBorderStrong", "light"),
    hi: shade(rawColor("colorSurface2", "light"), 0.5),
    lo: rawColor("colorBorder", "light"),
  },
  dark: {
    face: rawColor("colorSurface", "dark"),
    edge: rawColor("colorBorderStrong", "dark"),
    hi: shade(rawColor("colorSurface", "dark"), 0.22),
    lo: rawColor("colorBg", "dark"),
  },
};

/**
 * 窗口控制按钮（红绿灯）调色：面色取自 theme.ts 的 btn* token，
 * 描边/高光/暗影/图标色由面色统一推导，避免色值散落。
 */
export const CONTROL_MIN = skinFromBase(rawColor("btnMin", "light"));
export const CONTROL_MAX = skinFromBase(rawColor("btnMax", "light"));
export const CONTROL_CLOSE = skinFromBase(rawColor("btnClose", "light"));
