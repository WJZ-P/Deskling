import type { ReactNode } from "react";

/**
 * 像素线条风图标集。
 * 统一 16×16 视图盒、方角描边、跟随 currentColor，视觉与 Titlebar 的 CSS 图标一致。
 * 尺寸通过 size 控制，颜色由父级 color 决定。
 */

interface IconProps {
  size?: number;
}

function Svg({ size = 22, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** 主页：屋顶 + 墙体 + 门 */
export function HomeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 8 L8 3 L13.5 8" />
      <path d="M4 7 V13.5 H12 V7" />
      <path d="M6.75 13.5 V10.25 H9.25 V13.5" />
    </Svg>
  );
}

/** 设置：三条滑杆 + 方形滑块 */
export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 4 H13.5" />
      <rect x="9" y="2.6" width="2.8" height="2.8" />
      <path d="M2.5 8 H13.5" />
      <rect x="4" y="6.6" width="2.8" height="2.8" />
      <path d="M2.5 12 H13.5" />
      <rect x="9" y="10.6" width="2.8" height="2.8" />
    </Svg>
  );
}

/** 关于：方框 + “i” */
export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="2.5" width="11" height="11" />
      <rect x="7.2" y="5" width="1.6" height="1.6" fill="currentColor" stroke="none" />
      <path d="M8 8 V11" />
    </Svg>
  );
}

/** 折叠箭头：默认 “<”（收起）；折叠态由父级旋转 180° 变 “>”（展开） */
export function ChevronIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 4 L6 8 L10 12" />
    </Svg>
  );
}

/** 调试：代码尖括号 “</>” */
export function DebugIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 4 L2.5 8 L6 12" />
      <path d="M10 4 L13.5 8 L10 12" />
      <path d="M9 3 L7 13" />
    </Svg>
  );
}
