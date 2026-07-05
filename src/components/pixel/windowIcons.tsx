/**
 * 窗口控制图标（最小化 / 最大化 / 还原 / 关闭）。
 *
 * 来源：Google Material Symbols（原 public/*.svg 设计导出）。内联成组件而非
 * 放 public 用 <img>，是为了保留 fill="currentColor" —— 标题栏每个红绿灯按钮
 * 的图标色各不相同（见 palettes 的 CONTROL_*.icon），靠 currentColor 跟随。
 *
 * 与 components/icons.tsx 的区别：那套是描边线条风（viewBox 0 0 16、stroke），
 * 这套是 Material 填充风（viewBox 0 -960 960 960、fill），故独立成文件。
 */

interface WinIconProps {
  size?: number;
}

function WinSvg({ size = 16, children }: WinIconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 -960 960 960"
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** 最小化：一条横线（wght600）。原图横条在底部 y=-100.78~-206.78（高 106），这里上移到 viewBox 垂直中心（-480）居中。 */
export function WinMinimizeIcon(props: WinIconProps) {
  return (
    <WinSvg {...props}>
      <path d="M227-427v-106h506v106H227Z" />
    </WinSvg>
  );
}

/** 最大化：单个方角空心方块（crop_square, wght600） */
export function WinMaximizeIcon(props: WinIconProps) {
  return (
    <WinSvg {...props}>
      <path d="M206.78-100.78q-44.3 0-75.15-30.85-30.85-30.85-30.85-75.15v-546.44q0-44.3 30.85-75.15 30.85-30.85 75.15-30.85h546.44q44.3 0 75.15 30.85 30.85 30.85 30.85 75.15v546.44q0 44.3-30.85 75.15-30.85 30.85-75.15 30.85H206.78Zm0-106h546.44v-546.44H206.78v546.44Zm0 0v-546.44 546.44Z" />
    </WinSvg>
  );
}

/** 还原（窗口化）：两窗叠放（select_window_2, wght600） */
export function WinRestoreIcon(props: WinIconProps) {
  return (
    <WinSvg {...props}>
      <path d="M630.39-166.78v-341.35H166.78v341.35h463.61Zm106-179.09V-451.3h56.83v-341.92H329.61v179.09h-106v-179.09q0-44.3 30.85-75.15 30.84-30.85 75.15-30.85h463.61q44.3 0 75.15 30.85 30.85 30.85 30.85 75.15v341.35q0 44.3-30.85 75.15-30.85 30.85-75.15 30.85h-56.83ZM166.78-60.78q-44.3 0-75.15-30.85-30.85-30.85-30.85-75.15v-341.35q0-44.3 30.85-75.15 30.85-30.85 75.15-30.85h476.05q38.59 0 66.08 27.48 27.48 27.49 27.48 66.08v353.79q0 44.3-30.85 75.15-30.84 30.85-75.15 30.85H166.78ZM561.7-670ZM398.87-337.74Z" />
    </WinSvg>
  );
}

/** 关闭：叉号（wght600） */
export function WinCloseIcon(props: WinIconProps) {
  return (
    <WinSvg {...props}>
      <path d="M256-181.91 181.91-256l224-224-224-224L256-778.09l224 224 224-224L778.09-704l-224 224 224 224L704-181.91l-224-224-224 224Z" />
    </WinSvg>
  );
}
