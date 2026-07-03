import { forwardRef, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelSurface, type SurfaceState, type SurfaceTune } from "./PixelSurface";
import { PRIORITY_PAL, type Priority } from "./palettes";

/**
 * 像素输入框：底层复用按钮的 PixelSurface 弹簧引擎（不是静态 Frame），
 * 所以拥有和按钮一致的持续动效：
 *  - 面像素低噪一直在（rest 静态低噪 + 聚焦时正弦呼吸闪烁）；
 *  - 聚焦（选中态）→ 映射到按钮的 hover：外描边逐像素错落地平滑点亮、低噪动起来；
 *  - 所有高亮/边框变化都走弹簧，任意时刻打断都丝滑（不生硬切换）。
 * 上面浮一个透明原生 <input> 负责实际输入/无障碍/输入法。
 *
 * 手感参数与按钮保持一致（见 INPUT_*），仅关掉纵向位移（文本框跳动会怪）。
 */

// ---- 顶层可调常量（与按钮一致喵）----
const INPUT_PIXEL = 4; // 像素大小（同按钮）
const INPUT_RADIUS = 2; // 像素切角（同按钮）
const INPUT_NOISE = 0.1; // 面像素基准低噪强度（同按钮）

/** 输入框手感：沿用按钮默认低噪/边框动效，仅去掉纵向位移 */
const INPUT_TUNE: Partial<SurfaceTune> = {
  hoverTy: 0, // 聚焦不上抬（文本框跳动会怪）
  pressTy: 0,
};

interface PixelInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** 优先级色阶：normal(浅青) · low(白底/默认) · primary(深色) */
  variant?: Priority;
  /** 前置图标/插槽（如 🔍） */
  leading?: ReactNode;
}

export const PixelInput = forwardRef<HTMLInputElement, PixelInputProps>(function PixelInput(
  { variant = "low", disabled, leading, className, onFocus, onBlur, ...rest },
  ref,
) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const innerRef = useRef<HTMLInputElement>(null);

  // 聚焦（选中态）或悬停 → hover：边框平滑点亮 + 低噪动起来（同按钮 hover 手感）
  const state: SurfaceState = disabled ? "rest" : focused || hovered ? "hover" : "rest";

  const setRef = (el: HTMLInputElement | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as { current: HTMLInputElement | null }).current = el;
  };

  return (
    <Wrap
      className={className}
      data-disabled={disabled || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={() => innerRef.current?.focus()}
    >
      <PixelSurface
        palette={PRIORITY_PAL[variant]}
        state={state}
        pixel={INPUT_PIXEL}
        radius={INPUT_RADIUS}
        noise={INPUT_NOISE}
        tune={INPUT_TUNE}
        rootStyle={{ display: "flex", width: "100%" }}
        contentStyle={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          width: "100%",
          gap: 8,
          minHeight: 34,
          padding: "6px 12px",
        }}
      >
        {leading != null && <Leading aria-hidden>{leading}</Leading>}
        <Field
          ref={setRef}
          disabled={disabled}
          data-variant={variant}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
      </PixelSurface>
    </Wrap>
  );
});

const Wrap = styled.label`
  position: relative;
  display: inline-flex;
  min-width: 180px;
  cursor: text;

  &[data-disabled] {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const Leading = styled.span`
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  color: ${t.colorTextMuted};
  line-height: 1;
`;

const Field = styled.input`
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  outline: none;
  font: ${t.textMd};
  letter-spacing: 1px;
  color: ${t.colorText};

  &[data-variant="primary"] {
    color: ${t.colorTextOnBtnAccent};
  }

  &::placeholder {
    color: ${t.colorTextMuted};
    opacity: 0.8;
  }

  &:disabled {
    cursor: not-allowed;
  }
`;
