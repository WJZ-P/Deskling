/**
 * 主题单一数据源。
 *
 * Linaria 是零运行时方案，无法使用 styled-components 的 ThemeProvider（运行时 theme 对象）。
 * 这里用「TS 对象 + CSS 变量」实现等价体验：
 *  - colorTokens：集中描述随主题变化的颜色值（light/dark），由 applyTheme 写入 CSS 变量。
 *  - t：组件统一通过 t.xxx 引用，返回静态字符串 "var(--xxx)"，编译期被 Linaria 内联。
 */

export type ThemeMode = "light" | "dark";

/** 随主题变化的颜色 token：单一数据源 */
const colorTokens = {
  colorBg: { css: "--color-bg", light: "#e6e4dd", dark: "#0e1124" },
  colorSurface: { css: "--color-surface", light: "#f2f0ea", dark: "#161a33" },
  colorSurface2: { css: "--color-surface-2", light: "#faf8f3", dark: "#1e2342" },
  colorBorder: { css: "--color-border", light: "#c7c3b8", dark: "#2c3257" },
  colorBorderStrong: {
    css: "--color-border-strong",
    light: "#5c584f",
    dark: "#4a4f8a",
  },
  colorText: { css: "--color-text", light: "#36332c", dark: "#e8e8f4" },
  colorTextMuted: {
    css: "--color-text-muted",
    light: "#847f73",
    dark: "#9ca0cc",
  },
  colorAccent: { css: "--color-accent", light: "#c98aa6", dark: "#8b7ae0" },
  colorShadow: { css: "--color-shadow", light: "#b8b4a8", dark: "#05060f" },
  btnMin: { css: "--btn-min", light: "#e6b450", dark: "#d9a441" },
  btnMax: { css: "--btn-max", light: "#8fbc5a", dark: "#6fae57" },
  btnClose: { css: "--btn-close", light: "#e05e5e", dark: "#d65454" },
  btnIcon: { css: "--btn-icon", light: "#36332c", dark: "#e8e8f4" },
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
  colorShadow: "var(--color-shadow)",
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

/** 应用主题：把对象里的颜色值写入根元素的 CSS 变量，并标记 data-theme */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  for (const token of Object.values(colorTokens)) {
    root.style.setProperty(token.css, token[mode]);
  }
  root.style.colorScheme = mode;
  root.setAttribute("data-theme", mode);
}
