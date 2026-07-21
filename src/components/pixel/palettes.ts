import { rawColor, t, type ThemeMode } from "../../styles/theme";
import type { PixelPalette, PixelPaletteColors } from "./PixelFrame";

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

/** 给固定浅色调色板挂上稳定引用的深色变体。 */
function withDark(
  light: PixelPaletteColors,
  dark: PixelPaletteColors,
): PixelPalette {
  return { ...light, dark };
}

/**
 * 通用像素调色板（青蓝识别色，内含 light + dark 两套颜色）。
 * 每个 palette = 面色 / 外描边 / 高光 / 暗影，供 PixelFrame 逐格上色。
 * 保持模块级稳定引用，主题选择统一交给三套底层渲染器。
 */
export const PX = {
  default: withDark(
    { face: "#e6f4f4", edge: "#3f9599", hi: "#ffffff", lo: "#a9cfd1" },
    { face: "#21496e", edge: "#4b789f", hi: "#3a668a", lo: "#112c47" },
  ),
  accent: withDark(
    { face: "#7dd1d4", edge: "#1d6a6f", hi: "#d8f4f5", lo: "#3f9ea3" },
    { face: "#3fd2e2", edge: "#16717f", hi: "#9ff2f5", lo: "#2496a6" },
  ),
  well: withDark(
    {
      face: rawColor("colorWell", "light"),
      edge: rawColor("colorPixelWellEdge", "light"),
      hi: "#ffffff",
      lo: "#93c4c6",
    },
    {
      face: rawColor("colorWell", "dark"),
      edge: rawColor("colorPixelWellEdge", "dark"),
      hi: "#1a3854",
      lo: "#040c17",
    },
  ),
  panel: withDark(
    {
      face: rawColor("colorPixelPanelFace", "light"),
      edge: "#3f9599",
      hi: "#ffffff",
      lo: "#cfe8e9",
    },
    {
      face: rawColor("colorPixelPanelFace", "dark"),
      edge: "#3d6690",
      hi: "#315473",
      lo: "#0d1f34",
    },
  ),
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
export const DITHER_ACCENT = t.colorPixelDither;

/**
 * 工具调用卡（ToolCallBlock）hover/展开的扫描目标面色：柔和青蓝，
 * 由强调色 token 提亮推导（比按钮 primary 更浅，适合大面积凹槽底）。
 * PixelFrame 的扫描状态机只读 face；edge/hi/lo 仅为补齐 PixelPalette 类型。
 */
export const TOOL_SWEEP_PAL: PixelPalette = {
  face: shade(rawColor("colorAccent", "light"), 0.62),
  edge: shade(rawColor("colorAccent", "light"), -0.1),
  hi: "#ffffff",
  lo: shade(rawColor("colorAccent", "light"), 0.33),
  dark: {
    face: "#143b51",
    edge: "#33758d",
    hi: "#2b6176",
    lo: "#0c2b3d",
  },
};

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
function themedControlSkin(token: "btnMin" | "btnMax" | "btnClose") {
  const light = skinFromBase(rawColor(token, "light"));
  const dark = skinFromBase(rawColor(token, "dark"));
  return {
    pal: withDark(light.pal, dark.pal),
    icon: light.icon,
  };
}

export const CONTROL_MIN = themedControlSkin("btnMin");
export const CONTROL_MAX = themedControlSkin("btnMax");
export const CONTROL_CLOSE = themedControlSkin("btnClose");

/**
 * 侧边栏面板调色（随主题）。与标题栏同一套分层边框做法（PixelFrame raised），
 * 但面色/边框刻意与 TITLEBAR_PAL 区分一档，让侧栏作为独立模块有自己的层次：
 *  - 浅色：面色取纯白 surface（比标题栏的 surface2 更亮一点），边框走强描边；
 *  - 深色：面色取 surface2（比标题栏 surface 略深），边框走强描边。
 * 高光/暗影按面色推导。
 */
export const SIDEBAR_PANEL: Record<ThemeMode, PixelPalette> = {
  light: {
    face: rawColor("colorSurface", "light"),
    edge: rawColor("colorBorderStrong", "light"),
    hi: shade(rawColor("colorSurface", "light"), 0.5),
    lo: rawColor("colorBorder", "light"),
  },
  dark: {
    face: "#0d1d31",
    edge: "#3d6690",
    hi: "#203d5a",
    lo: "#06101d",
  },
};

/**
 * 侧边栏导航按钮调色（随主题）。与标题栏同一套推导逻辑，色值仍出自 token：
 *  - idle（未选中）：控件面色 colorControl 推导的浅像素面，从纯色侧栏底上轻微浮起；
 *  - active（选中）：强调色 colorAccent 推导的青色像素面。
 * 文字/图标色不进 palette，由 Sidebar 用 token 控制（idle=colorTextOnBtn，active=colorOnAccent）。
 */
export const SIDEBAR_PAL: Record<ThemeMode, { idle: PixelPalette; active: PixelPalette }> = {
  light: {
    idle: skinFromBase(rawColor("colorControl", "light")).pal,
    active: skinFromBase(rawColor("colorAccent", "light")).pal,
  },
  dark: {
    idle: {
      face: "#21496e",
      edge: "#4b789f",
      hi: "#3a668a",
      lo: "#112c47",
    },
    active: {
      face: "#3fd2e2",
      edge: "#16717f",
      hi: "#9ff2f5",
      lo: "#2496a6",
    },
  },
};

/**
 * 窗口外包裹框调色（随主题）。用于 PixelFrame hollow 模式，叠在最上层给整个窗口收口一圈。
 * 描边用最强的 borderStrong，内斜角(hi/lo)按主背景做明暗档，形成一圈精致的分层边。
 * 无面色（hollow），故只用 edge/hi/lo。
 */
export const WINDOW_FRAME: Record<ThemeMode, PixelPalette> = {
  light: {
    face: rawColor("colorBg", "light"), // hollow 下不用，占位
    edge: rawColor("colorBorderStrong", "light"),
    hi: shade(rawColor("colorBorderStrong", "light"), 0.4),
    lo: shade(rawColor("colorBorderStrong", "light"), -0.3),
  },
  dark: {
    face: rawColor("colorBg", "dark"),
    edge: rawColor("colorBorderStrong", "dark"),
    hi: shade(rawColor("colorBorderStrong", "dark"), 0.35),
    lo: shade(rawColor("colorBorderStrong", "dark"), -0.4),
  },
};
