import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelButton } from "../../components/pixel/PixelButton";
import { PixelSurface, type SurfaceState, type SurfaceTune } from "../../components/pixel/PixelSurface";
import { PRIORITY_PAL } from "../../components/pixel/palettes";
import { PixelTip } from "../../components/pixel/PixelTip";
import { BulbIcon } from "../../components/pixel/icons";
import { getActiveProfile, getSetting, setSetting } from "../../settings";

/**
 * 底部输入区：QQ 式一体输入框——整块像素面里从上到下依次是
 *   功能行（会话级小开关，如「深度思考」）→ 自增高 textarea → 右下角发送/暂停。
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
const CHIP_PIXEL = 3; // 功能行小开关的美术像素：比输入面小一号，显精细

/** 输入面手感：沿用输入框（去纵向位移） */
const FIELD_TUNE: Partial<SurfaceTune> = {
  hoverTy: 0,
  pressTy: 0,
};

/** 功能行小开关手感：hover/press 原地不动，只走内部像素点亮 + 按压高光反转 */
const CHIP_TUNE: Partial<SurfaceTune> = {
  hoverTy: 0,
  pressTy: 0,
};

interface ChatComposerProps {
  onSend: (text: string) => void;
  /** 点暂停：终止当前在途回复。sending=true 时发送按钮变暂停按钮 */
  onStop?: () => void;
  /** 是否有回复正在生成中（决定按钮是「发送」还是「暂停」） */
  sending?: boolean;
}

/**
 * 支持「深度思考」开关的协议：Anthropic（thinking 参数）/ Gemini（thinkingConfig）。
 * OpenAI 兼容协议的 reasoning 由模型自身决定（服务端主动下发），没有开关可言。
 */
const THINKING_PROTOCOLS: ReadonlySet<string> = new Set(["anthropic", "gemini"]);

export function ChatComposer({ onSend, onStop, sending }: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  // 「深度思考」开关：持久化在 settings（发送那一刻由 ChatWindow 读取），这里持有 UI 镜像
  const [thinking, setThinking] = useState<boolean>(() => getSetting("chatThinking"));
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 内容变化时重算高度：先塌到 auto 量 scrollHeight，再夹到 [MIN,MAX]
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(MAX_H, Math.max(MIN_H, ta.scrollHeight))}px`;
  }, [value]);

  const submit = () => {
    // 生成中不发送（此时按钮是暂停）；输入框仍可继续打字预输入
    if (sending) return;
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 生成中：Enter 不发送，走默认换行（预输入下一句也能自由分行）
    if (e.key === "Enter" && !e.shiftKey && !sending) {
      e.preventDefault();
      submit();
    }
  };

  // 输入框始终可用（生成中也能预输入下一句），故 hover 态只看聚焦/悬停
  const state: SurfaceState = focused || hovered ? "hover" : "rest";

  // 当前激活服务商是否支持思考开关：每次渲染同步读缓存——聚焦/悬停本就触发
  // 渲染，切换服务商后下一次渲染自然拿到新协议
  const profile = getActiveProfile();
  const canThink = profile != null && THINKING_PROTOCOLS.has(profile.protocol);

  return (
    <Root>
      {/* Field 是 div 而非 label：功能行按钮在 textarea 之前，label 的隐式激活
          会把空白处点击派发给「首个可标记控件」（即按钮）；改为点击回调聚焦 */}
      <Field
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
            flexDirection: "column",
            // Content 基样式是 center（行内小部件用）：列布局下会把子行水平居中，
            // 这里改回 stretch 让功能行/发送行都撑满整行
            alignItems: "stretch",
            width: "100%",
            padding: "7px 10px 8px 12px",
          }}
        >
          {canThink && (
            <ToolRow>
              <PixelTip tip={thinking ? "深度思考 · 已开启" : "深度思考 · 已关闭"}>
                <PixelButton
                  compact
                  pixel={CHIP_PIXEL}
                  tune={CHIP_TUNE}
                  variant={thinking ? "primary" : "low"}
                  // 不抢 textarea 焦点：mousedown 默认行为会先 blur 再由 Field 点击回聚焦，闪一下
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    setThinking((v) => {
                      void setSetting("chatThinking", !v);
                      return !v;
                    })
                  }
                >
                  <BulbIcon style={{ fontSize: 19 }} />
                </PixelButton>
              </PixelTip>
            </ToolRow>
          )}
          <Textarea
            ref={taRef}
            value={value}
            rows={1}
            placeholder="和 Deskling 说点什么喵～（Enter 发送 · Shift+Enter 换行）"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <SendRow>
            {sending ? (
              // 生成中：发送位变暂停。始终可点（终止本轮）
              <PixelButton
                variant="normal"
                onMouseDown={(e) => e.preventDefault()}
                onClick={onStop}
              >
                暂停
              </PixelButton>
            ) : (
              <PixelButton
                variant="primary"
                disabled={value.trim().length === 0}
                onMouseDown={(e) => e.preventDefault()}
                onClick={submit}
              >
                发送
              </PixelButton>
            )}
          </SendRow>
        </PixelSurface>
      </Field>
    </Root>
  );
}

const Root = styled.div`
  flex: 0 0 auto;
  padding: 12px 14px;
  border-top: 1px solid ${t.colorBorder};
`;

const Field = styled.div`
  position: relative;
  min-width: 0;
  cursor: text;
`;

/* 功能行：输入面内部顶栏，一排会话级小开关（当前只有深度思考） */
const ToolRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
`;

/* 发送行：输入面内部底栏，发送/暂停靠右下角 */
const SendRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 7px;
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
