import { forwardRef, useRef, useState, type TextareaHTMLAttributes } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelSurface, type SurfaceState, type SurfaceTune } from "./PixelSurface";
import { PRIORITY_PAL, type Priority } from "./palettes";

/**
 * 像素多行文本框：PixelInput 的 textarea 版（同一套 PixelSurface 弹簧引擎）。
 *  - rest 静态低噪，聚焦/悬停外描边逐像素点亮、低噪动起来；
 *  - 固定行数（rows），超出内部滚动，不随内容自增高（表单场景要稳定占位）；
 *  - 上面浮透明原生 <textarea> 负责实际输入/无障碍/输入法。
 * 用于人设 prompt 这类长文本编辑。
 */

// ---- 顶层可调常量（与 PixelInput 一致喵）----
const AREA_PIXEL = 4;
const AREA_RADIUS = 2;
const AREA_NOISE = 0.1;

/** 手感：沿用输入框（去纵向位移） */
const AREA_TUNE: Partial<SurfaceTune> = {
  hoverTy: 0,
  pressTy: 0,
};

interface PixelTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** 优先级色阶：normal(浅青) · low(白底/默认) · primary(深色) */
  variant?: Priority;
}

export const PixelTextarea = forwardRef<HTMLTextAreaElement, PixelTextareaProps>(
  function PixelTextarea(
    { variant = "low", disabled, className, rows = 6, onFocus, onBlur, ...rest },
    ref,
  ) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const innerRef = useRef<HTMLTextAreaElement>(null);

    const state: SurfaceState = disabled ? "rest" : focused || hovered ? "hover" : "rest";

    const setRef = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as { current: HTMLTextAreaElement | null }).current = el;
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
          pixel={AREA_PIXEL}
          radius={AREA_RADIUS}
          noise={AREA_NOISE}
          tune={AREA_TUNE}
          rootStyle={{ display: "flex", width: "100%" }}
          contentStyle={{
            display: "flex",
            alignItems: "stretch",
            width: "100%",
            padding: "8px 12px",
          }}
        >
          <Field
            ref={setRef}
            rows={rows}
            disabled={disabled}
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
  },
);

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

const Field = styled.textarea`
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  outline: none;
  resize: none;
  font: ${t.textMd};
  line-height: 1.7;
  letter-spacing: 0.5px;
  color: ${t.colorText};

  /* 自绘细滚动条（超过 rows 后出现），跟整体像素风一致 */
  scrollbar-width: thin;
  scrollbar-color: ${t.colorBorderStrong} transparent;

  &::placeholder {
    color: ${t.colorTextMuted};
    opacity: 0.8;
  }

  &:disabled {
    cursor: not-allowed;
  }
`;
