/**
 * 主题单一数据源。
 *
 * Linaria 是零运行时方案，无法使用 styled-components 的 ThemeProvider（运行时 theme 对象）。
 * 这里用「TS 对象 + CSS 变量」实现等价体验：
 *  - colorTokens：集中描述随主题变化的颜色值（light/dark），由 applyTheme 写入 CSS 变量。
 *  - t：组件统一通过 t.xxx 引用，返回静态字符串 "var(--xxx)"，编译期被 Linaria 内联。
 */

export type ThemeMode = "light" | "dark";

/**
 * 随主题变化的颜色 token：单一数据源。
 * 色系：浅色 = 偏白冷调 + 青蓝点缀（初音青 × 天依蓝的二次元感）；
 *       深色 = 深蓝为主 + 明亮青色点缀。
 */
const colorTokens = {
  // 浅色调色板统一以基准青 #7dd1d4（125,209,212）扩展：
  // 背景/表面走极浅青调，边框/文字/阴影走该青色的加深档，控件/凹槽走中浅青档。
  colorBg: { css: "--color-bg", light: "#e6f4f4", dark: "#0a1626" },
  colorSurface: { css: "--color-surface", light: "#ffffff", dark: "#11233b" },
  colorSurface2: { css: "--color-surface-2", light: "#f0fafa", dark: "#183050" },
  colorBorder: { css: "--color-border", light: "#bfe6e7", dark: "#284a6b" },
  colorBorderStrong: {
    css: "--color-border-strong",
    light: "#3f9599",
    dark: "#3d6690",
  },
  colorText: { css: "--color-text", light: "#16323a", dark: "#e6f0fa" },
  colorTextMuted: {
    css: "--color-text-muted",
    light: "#5a8288",
    dark: "#8fa8c2",
  },
  // 主强调色：基准青 #7dd1d4（浅色）；深色仍用明亮青在深蓝上跳脱
  colorAccent: { css: "--color-accent", light: "#7dd1d4", dark: "#3fd2e2" },
  // 强调色的半透明软色（用于选项 hover 高亮等 CSS 场景）
  colorAccentSoft: {
    css: "--color-accent-soft",
    light: "rgba(125, 209, 212, 0.40)",
    dark: "rgba(63, 210, 226, 0.32)",
  },
  // 强调色背景上的文字色：青底上用深青墨，对比更高、更清晰精致
  colorOnAccent: { css: "--color-on-accent", light: "#0a2e30", dark: "#04202a" },
  colorShadow: { css: "--color-shadow", light: "#a9dcdd", dark: "#040e1c" },
  // 像素硬投影色（PixelFrame/PixelSurface 的 drop-shadow 默认色）
  colorShadowPixel: {
    css: "--color-shadow-pixel",
    light: "rgba(31, 106, 111, 0.38)",
    dark: "rgba(2, 8, 20, 0.55)",
  },
  // 柔和投影色（软萌像素风：drop-shadow 的模糊投影，带基准青的半透明调）
  colorShadowSoft: {
    css: "--color-shadow-soft",
    light: "rgba(63, 149, 153, 0.26)",
    dark: "rgba(2, 8, 20, 0.55)",
  },

  // 控件面（按钮等凸起元素）的填充面色
  colorControl: { css: "--color-control", light: "#d6f0f0", dark: "#1e3a5c" },
  // 凹槽/进度槽/输入区的底色：比控件更深，显“内嵌”
  colorWell: { css: "--color-well", light: "#c2e7e8", dark: "#0b1c30" },
  // 像素按钮文字色（青色家族深青墨，非死黑）。按钮面色暂固定浅青，故 light/dark 同值。
  colorTextOnBtn: { css: "--color-text-on-btn", light: "#1f6f75", dark: "#1f6f75" },
  colorTextOnBtnAccent: {
    css: "--color-text-on-btn-accent",
    light: "#13474c",
    dark: "#13474c",
  },
  btnMin: { css: "--btn-min", light: "#f2c14e", dark: "#e0b04a" },
  btnMax: { css: "--btn-max", light: "#6fc27b", dark: "#5fae63" },
  btnClose: { css: "--btn-close", light: "#ec6a6a", dark: "#d65a5a" },
  btnIcon: { css: "--btn-icon", light: "#1b2c3d", dark: "#e6f0fa" },
} as const;

/**
 * 组件使用的 token 引用（值为静态 "var(--xxx)"，Linaria 编译期内联）。
 * 颜色对应 colorTokens；unit/borderW/字体等主题无关常量定义在 theme.css 的 :root。
 */
export const t = {
  colorBg: "var(--color-bg)",
  colorSurface: "var(--color-surface)",
  colorSurface2: "var(--color-surface-2)",
  colorBorder: "var(--color-border)",
  colorBorderStrong: "var(--color-border-strong)",
  colorText: "var(--color-text)",
  colorTextMuted: "var(--color-text-muted)",
  colorAccent: "var(--color-accent)",
  colorAccentSoft: "var(--color-accent-soft)",
  colorOnAccent: "var(--color-on-accent)",
  colorShadow: "var(--color-shadow)",
  colorShadowSoft: "var(--color-shadow-soft)",
  colorShadowPixel: "var(--color-shadow-pixel)",
  colorControl: "var(--color-control)",
  colorWell: "var(--color-well)",
  colorTextOnBtn: "var(--color-text-on-btn)",
  colorTextOnBtnAccent: "var(--color-text-on-btn-accent)",
  btnMin: "var(--btn-min)",
  btnMax: "var(--btn-max)",
  btnClose: "var(--btn-close)",
  btnIcon: "var(--btn-icon)",
  unit: "var(--unit)",
  borderW: "var(--border-w)",
  fontPixel: "var(--font-pixel)",
  fontUi: "var(--font-ui)",
  /* 字号 token：CSS `font` 简写（字号/行高 + 对应原生字体族），用法 `font: ${t.textMd}`。
     xs=10 sm=12 md=16(默认) lg=20 xl=24 2xl=32 */
  textXs: "var(--text-xs)",
  textSm: "var(--text-sm)",
  textMd: "var(--text-md)",
  textLg: "var(--text-lg)",
  textXl: "var(--text-xl)",
  text2xl: "var(--text-2xl)",
} as const;

/**
 * 软萌像素「切角」工具（去 bevel）。
 *
 * pixelCorners：clip-path 多边形，把矩形四角切成一小段像素切角——
 * 「一点点圆角」但保留像素硬边特征（非平滑弧线）。用法 `clip-path: ${pixelCorners};`
 *
 * 描边跟随切角的推荐配方（1px 边沿切角走）：
 *   border: 1px solid transparent;
 *   background:
 *     linear-gradient(<填充色>, <填充色>) padding-box,
 *     linear-gradient(<描边色>, <描边色>) border-box;
 *   clip-path: ${pixelCorners};
 * 柔和投影用 `filter: drop-shadow(0 3px 6px ${t.colorShadowSoft})`（会跟随切角形状）。
 */
export const CORNER = "3px";
export const pixelCorners = `polygon(${CORNER} 0, calc(100% - ${CORNER}) 0, 100% ${CORNER}, 100% calc(100% - ${CORNER}), calc(100% - ${CORNER}) 100%, ${CORNER} 100%, 0 calc(100% - ${CORNER}), 0 ${CORNER})`;

/** 颜色 token 的键名（供 JS 侧取原始色值使用）。 */
export type ColorToken = keyof typeof colorTokens;

/**
 * 取某个颜色 token 在指定主题下的「原始色值」（字面 hex / rgba）。
 * 像素组件需要在 JS 里做颜色运算（hexToRgb 等），无法用 CSS 变量，
 * 因此统一从这里取字面值，保证 theme.ts 仍是唯一色值源。
 */
export function rawColor(token: ColorToken, mode: ThemeMode): string {
  return colorTokens[token][mode];
}

/** 应用主题：把对象里的颜色值写入根元素的 CSS 变量，并标记 data-theme */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  for (const token of Object.values(colorTokens)) {
    root.style.setProperty(token.css, token[mode]);
  }
  root.style.colorScheme = mode;
  root.setAttribute("data-theme", mode);
}
