import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelButton } from "../../components/pixel/PixelButton";
import { PixelSurface, type SurfaceState, type SurfaceTune } from "../../components/pixel/PixelSurface";
import { PRIORITY_PAL } from "../../components/pixel/palettes";

/**
 * 底部输入区：自增高 textarea + 发送按钮。
 *  - Enter 发送，Shift+Enter 换行；
 *  - 空白内容不发送；
 *  - textarea 随内容增高，到上限后内部滚动（不撑爆窗口）。
 * 输入面用 PixelSurface（同 PixelInput 引擎）：静态低噪常驻，
 * 聚焦时外描边逐像素点亮、低噪动起来，和主面板输入框手感一致。
 * 纯 UI：把内容交给 onSend，清空由本组件负责。
 */

// ---- 可调常量 ----
const MIN_H = 20; // textarea 最小高度 px
const MAX_H = 160; // textarea 最大高度 px（超出则内部滚动）
const FIELD_PIXEL = 4; // 面像素大小（同 PixelInput）
const FIELD_RADIUS = 2; // 像素切角（同 PixelInput）
const FIELD_NOISE = 0.1; // 基准低噪强度（同 PixelInput）

/** 输入面手感：沿用输入框（去纵向位移） */
const FIELD_TUNE: Partial<SurfaceTune> = {
  hoverTy: 0,
  pressTy: 0,
};

interface ChatComposerProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function ChatComposer({ onSend, disabled }: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 内容变化时重算高度：先塌到 auto 量 scrollHeight，再夹到 [MIN,MAX]
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(MAX_H, Math.max(MIN_H, ta.scrollHeight))}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // 聚焦或悬停 → hover：边框点亮 + 低噪动起来（同 PixelInput）
  const state: SurfaceState = disabled ? "rest" : focused || hovered ? "hover" : "rest";

  return (
    <Root>
      <Field
        data-disabled={disabled || undefined}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onClick={() => taRef.current?.focus()}
      >
        <PixelSurface
          palette={PRIORITY_PAL.low}
          state={state}
          pixel={FIELD_PIXEL}
          radius={FIELD_RADIUS}
          noise={FIELD_NOISE}
          tune={FIELD_TUNE}
          rootStyle={{ display: "flex", width: "100%" }}
          contentStyle={{
            display: "flex",
            alignItems: "stretch",
            width: "100%",
            padding: "8px 12px",
          }}
        >
          <Textarea
            ref={taRef}
            value={value}
            rows={1}
            placeholder="和 Deskling 说点什么喵～（Enter 发送 · Shift+Enter 换行）"
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </PixelSurface>
      </Field>
      <SendSlot>
        <PixelButton
          variant="primary"
          disabled={disabled || value.trim().length === 0}
          onClick={submit}
        >
          发送
        </PixelButton>
      </SendSlot>
    </Root>
  );
}

const Root = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 12px 14px;
  border-top: 1px solid ${t.colorBorder};
`;

const Field = styled.label`
  flex: 1 1 auto;
  min-width: 0;
  cursor: text;

  &[data-disabled] {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const Textarea = styled.textarea`
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  font: ${t.textMd};
  line-height: 1.6;
  letter-spacing: 0.5px;
  color: ${t.colorText};

  /* 自绘细滚动条（超过 MAX_H 后出现），跟窗口整体像素风一致 */
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

const SendSlot = styled.div`
  flex: 0 0 auto;
  padding-bottom: 2px;
`;
