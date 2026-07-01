import { useState, type ButtonHTMLAttributes } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "./PixelFrame";
import { PX } from "./palettes";

interface PixelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "accent";
}

export function PixelButton({
  variant = "default",
  children,
  disabled,
  ...rest
}: PixelButtonProps) {
  const [pressed, setPressed] = useState(false);
  const pal = variant === "accent" ? PX.accent : PX.default;
  const active = pressed && !disabled;

  return (
    <Btn
      type="button"
      disabled={disabled}
      data-variant={variant}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      {...rest}
    >
      <PixelFrame palette={pal} variant={active ? "sunken" : "raised"} pixel={3} radius={2} />
      <Label style={{ transform: active ? "translateY(1px)" : "none" }}>{children}</Label>
    </Btn>
  );
}

const Btn = styled.button`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 8px 18px;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: ${t.colorText};
  transition: transform 0.08s ease;

  &[data-variant="accent"] {
    color: ${t.colorOnAccent};
  }
  &:hover:not(:disabled) {
    transform: translateY(-1px);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Label = styled.span`
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: ${t.textMd};
  letter-spacing: 1px;
`;
