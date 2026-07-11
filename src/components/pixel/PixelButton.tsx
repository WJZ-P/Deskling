import { useState, type ButtonHTMLAttributes } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelSurface, type SurfaceState, type SurfaceTune } from "./PixelSurface";
import { PRIORITY_PAL, type Priority } from "./palettes";

//  可调旋钮
const BTN_PIXEL = 4; // 每个美术像素占多少 CSS px
const BTN_RADIUS = 2; // 像素切角大小
const NOISE = 0.1; // 面像素基准随机明暗强度

interface PixelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 优先级色阶：normal(中间色/默认) · low(白底) · primary(深色) */
  variant?: Priority;
  /** 紧凑尺寸：更小的内边距/高度，用于图标按钮（如浮窗关闭 ✕） */
  compact?: boolean;
  /** 美术像素大小覆写（默认 4）：小按钮配 3 观感更精细 */
  pixel?: number;
  /**
   * 表面手感覆写（透传 PixelSurface）：如 { hoverTy: 0, pressTy: 0 } 做「原地不动」
   * 的开关按钮。请传模块级常量保持引用稳定，避免每次渲染重建像素网格。
   */
  tune?: Partial<SurfaceTune>;
}

export function PixelButton({
  variant = "normal",
  compact = false,
  pixel = BTN_PIXEL,
  tune,
  children,
  disabled,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
  ...rest
}: PixelButtonProps) {
  // 简单状态机：rest → hover → press，指针事件驱动
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const state: SurfaceState = disabled
    ? "rest"
    : pressed
      ? "press"
      : hovered
        ? "hover"
        : "rest";

  return (
    <Btn
      type="button"
      disabled={disabled}
      data-variant={variant}
      onPointerEnter={(e) => {
        setHovered(true);
        onPointerEnter?.(e);
      }}
      onPointerLeave={(e) => {
        setHovered(false);
        setPressed(false);
        onPointerLeave?.(e);
      }}
      onPointerDown={(e) => {
        if (!disabled) setPressed(true);
        onPointerDown?.(e);
      }}
      onPointerUp={(e) => {
        setPressed(false);
        onPointerUp?.(e);
      }}
      {...rest}
    >
      <PixelSurface
        palette={PRIORITY_PAL[variant]}
        state={state}
        pixel={pixel}
        radius={BTN_RADIUS}
        noise={NOISE}
        tune={tune}
      >
        <Label data-compact={compact || undefined}>{children}</Label>
      </PixelSurface>
    </Btn>
  );
}

const Btn = styled.button`
  position: relative;
  display: inline-flex;
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
  /* 文字色统一由 token 管理（青色家族深青墨，非死黑） */
  color: ${t.colorTextOnBtn};

  &[data-variant="primary"] {
    color: ${t.colorTextOnBtnAccent};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const Label = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  min-height: 34px;
  padding: 8px 18px;
  font: ${t.textMd};
  letter-spacing: 1px;
  /* 原生 Bold 字重（@font-face 已注册），非合成粗体 */
  font-weight: bold;

  /* 紧凑：贴合图标的小内边距/高度，用于 ✕ 这类方形图标按钮 */
  &[data-compact] {
    min-height: 0;
    padding: 4px 7px;
    letter-spacing: 0;
  }
`;
