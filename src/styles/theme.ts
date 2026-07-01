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
  colorBg: { css: "--color-bg", light: "#e8f0f8", dark: "#0a1626" },
  colorSurface: { css: "--color-surface", light: "#ffffff", dark: "#11233b" },
  colorSurface2: { css: "--color-surface-2", light: "#f1f7fc", dark: "#183050" },
  colorBorder: { css: "--color-border", light: "#c2d6e6", dark: "#284a6b" },
  colorBorderStrong: {
    css: "--color-border-strong",
    light: "#5b7d9c",
    dark: "#3d6690",
  },
  colorText: { css: "--color-text", light: "#1b2c3d", dark: "#e6f0fa" },
  colorTextMuted: {
    css: "--color-text-muted",
    light: "#61788e",
    dark: "#8fa8c2",
  },
  // 主强调色：青蓝色（浅色偏深便于在白底做标题文字；深色偏亮在深蓝上跳脱）
  colorAccent: { css: "--color-accent", light: "#12a8bd", dark: "#3fd2e2" },
  // 强调色背景上的文字色：青蓝底上用深藏蓝，比纯白对比更高、更清晰精致
  colorOnAccent: { css: "--color-on-accent", light: "#06222b", dark: "#04202a" },
  colorShadow: { css: "--color-shadow", light: "#b7cadb", dark: "#040e1c" },

  // ---- 立体斜角边（bevel）用色 ----
  // 凸起控件（按钮/填充块）的面色：需中间调，好让高光与暗影都显形
  colorControl: { css: "--color-control", light: "#dbe8f2", dark: "#1e3a5c" },
  // 凹陷凹槽/输入区的底色：比控件更深，显“陷进去”
  colorWell: { css: "--color-well", light: "#c6d8e7", dark: "#0b1c30" },
  // 立体边高光（左上）与暗影（右下）
  colorBevelHi: { css: "--color-bevel-hi", light: "#ffffff", dark: "#3a5c86" },
  colorBevelLo: { css: "--color-bevel-lo", light: "#93aec6", dark: "#060e1e" },
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
  colorOnAccent: "var(--color-on-accent)",
  colorShadow: "var(--color-shadow)",
  colorControl: "var(--color-control)",
  colorWell: "var(--color-well)",
  colorBevelHi: "var(--color-bevel-hi)",
  colorBevelLo: "var(--color-bevel-lo)",
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
 * 立体斜角边（bevel）阴影片段：用分层 inset 硬阴影模拟凸起/凹陷。
 * 用法（可再叠加外投影）：`box-shadow: ${bevel.raised}, 2px 2px 0 ${t.colorShadow};`
 *  - raised：左上高光 + 右下暗影 → 凸起（按钮、填充块）
 *  - sunken：左上暗影 + 右下高光 → 凹陷（凹槽、输入区、按下态）
 */
export const bevel = {
  raised:
    "inset 1px 1px 0 var(--color-bevel-hi), inset -1px -1px 0 var(--color-bevel-lo)",
  sunken:
    "inset 1px 1px 0 var(--color-bevel-lo), inset -1px -1px 0 var(--color-bevel-hi)",
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
