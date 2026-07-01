import type { PixelPalette } from "./PixelFrame";

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

/** 抖动纹理颜色（浅青，用于进度/强调填充的斜向像素条纹） */
export const DITHER_ACCENT = "#d8f4f5";
