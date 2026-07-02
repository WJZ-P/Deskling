import { useState, type ButtonHTMLAttributes } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelSurface, type SurfaceState } from "./PixelSurface";
import { PRIORITY_PAL, type Priority } from "./palettes";

//  可调旋钮
const BTN_PIXEL = 4; // 每个美术像素占多少 CSS px
const BTN_RADIUS = 2; // 像素切角大小
const NOISE = 0.1; // 面像素基准随机明暗强度

interface PixelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 优先级色阶：normal(中间色/默认) · low(白底) · primary(深色) */
  variant?: Priority;
}

export function PixelButton({
  variant = "normal",
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
        pixel={BTN_PIXEL}
        radius={BTN_RADIUS}
        noise={NOISE}
      >
        <Label>{children}</Label>
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
  /* 像素字体加粗：整数 text-shadow 横向 +1px 描粗，笔画由 1px 变 2px，锐利不发虚。
     不用 font-weight（Ark Pixel 只有 Regular，会触发糊掉的伪粗体）。
     想更粗可加四向：0 1px currentColor, 1px 1px currentColor；不想粗则删掉本行。 */
  text-shadow: 1px 0 0 currentColor;
`;
