import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { styled } from "@linaria/react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../styles/theme";
import { PixelButton } from "../../components/pixel/PixelButton";
import { PixelSurface, type SurfaceState, type SurfaceTune } from "../../components/pixel/PixelSurface";
import { PRIORITY_PAL } from "../../components/pixel/palettes";
import { PixelTip } from "../../components/pixel/PixelTip";
import { BulbIcon, MicIcon } from "../../components/pixel/icons";
import { getActiveProfile, getSetting, setSetting } from "../../settings";

/**
 * 底部输入区：QQ 式一体输入框——整块像素面里从上到下依次是
 *   功能行（会话级小开关，如「深度思考」）→ 自增高 textarea → 底行
 *   （左：按住说话麦克风 · 右：发送/暂停）。
 *  - Enter 发送，Shift+Enter 换行；
 *  - 空白内容不发送；
 *  - textarea 随内容增高，到上限后内部滚动（不撑爆窗口）。
 *  - 麦克风双模式：点按 = 切换式开录（再点一下结束）；按住 = 说完松手即停。
 *    录音中用 SenseVoice 滚动识别当前整句，临时结果实时替换输入框里的语音
 *    草稿；停止后 stt_stop 最终定稿。落框不直发，识别错了还能改。设备由
 *    设置页「麦克风」项指定。
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

/** 语音按钮状态机：待命 → 录音中 → 识别中（停止后）；出错短暂驻留错误态 */
type VoiceState = "idle" | "rec" | "busy" | "err";
/** 语音错误提示驻留时长（ms），过后自动回待命 */
const VOICE_ERR_MS = 2400;
/** 短于此时长（ms）的按下视为「点按」= 切换式开录；按得更久则是长按 = 松手即停 */
const TAP_MS = 300;
/** 开麦后先攒一点上下文再请求首个临时结果；之后上一轮完成才延迟下一轮，不堆请求。 */
const VOICE_PARTIAL_FIRST_MS = 450;
const VOICE_PARTIAL_INTERVAL_MS = 650;

export function ChatComposer({ onSend, onStop, sending }: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  // 「深度思考」开关：持久化在 settings（发送那一刻由 ChatWindow 读取），这里持有 UI 镜像
  const [thinking, setThinking] = useState<boolean>(() => getSetting("chatThinking"));
  const taRef = useRef<HTMLTextAreaElement>(null);

  // ---- 语音输入：点按 = 切换式开/关，长按 = 说完松手即停 ----
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [voiceErr, setVoiceErr] = useState("");
  // value 只存已经定稿/手打的内容；录音中的临时全文单独放 voiceDraft，渲染时
  // 拼在后面。每轮 partial 直接替换它，避免“你好你好吗”式重复追加。
  const [voiceDraft, setVoiceDraft] = useState("");
  const voiceDraftRef = useRef("");
  voiceDraftRef.current = voiceDraft;
  const composedValue = value + voiceDraft;
  // 每次开始/停止/取消都换 run id；迟到的上一轮 partial 结果据此静默丢弃。
  const voiceRunRef = useRef(0);
  // stt_start 在采集设备就绪前会短暂等待；这期间 pointercancel 也必须能取消，
  // 并阻止第二次按下并发启动另一条录音会话。
  const voiceStartingRef = useRef(false);
  // 本次按下的时刻：松手时用时长区分「点按（切换式开启）」与「长按（松手停）」
  const pressAtRef = useRef(0);
  // 录音中再次按下 = 切换式关闭：这一下的松手直接停止识别
  const stopOnUpRef = useRef(false);
  const errTimerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(errTimerRef.current), []);

  const flashVoiceErr = (msg: string) => {
    setVoiceErr(msg);
    setVoice("err");
    window.clearTimeout(errTimerRef.current);
    errTimerRef.current = window.setTimeout(() => setVoice("idle"), VOICE_ERR_MS);
  };

  // 按下：待命则开麦；录音中则标记「松手即停」（切换式的第二次点按）。
  // setPointerCapture 把后续指针事件锁给按钮：拖出按钮再松手也能正常收尾
  const voiceDown = async (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (voice === "busy" || voiceStartingRef.current) return;
    if (voice === "rec") {
      stopOnUpRef.current = true;
      return;
    }
    pressAtRef.current = Date.now();
    stopOnUpRef.current = false;
    const run = ++voiceRunRef.current;
    voiceStartingRef.current = true;
    setVoiceDraft("");
    e.currentTarget.setPointerCapture(e.pointerId);
    // 你开口它闭嘴：录音期间停掉桌宠的语音播报，免得麦克风收进它自己的声音
    void invoke("tts_stop").catch(() => {});
    try {
      // 麦克风设备来自设置页选择（"" = 系统默认，跨窗口 onKeyChange 保证缓存新鲜）
      await invoke("stt_start", { device: getSetting("sttDevice") || null });
      if (voiceRunRef.current !== run) {
        void invoke("stt_cancel").catch(() => {});
        return;
      }
      voiceStartingRef.current = false;
      // 开麦完成即进录音态：快速点按（哪怕开麦完成前就松了手）= 切换式开启
      setVoice("rec");
    } catch (err) {
      if (voiceRunRef.current === run) {
        voiceStartingRef.current = false;
        flashVoiceErr(String(err));
      }
    }
  };

  // 录音中滚动转写：SenseVoice 是离线整句模型，因此每轮拿“截至当前的全文”并
  // 替换 voiceDraft。严格串行 await + setTimeout，识别变慢时只会降低刷新率，
  // 不会堆积一串过时任务占满 CPU。
  useEffect(() => {
    if (voice !== "rec") return;
    const run = voiceRunRef.current;
    let disposed = false;
    let timer = 0;

    const poll = async () => {
      try {
        const text = await invoke<string | null>("stt_partial");
        if (!disposed && voiceRunRef.current === run && text != null) {
          setVoiceDraft(text);
        }
      } catch {
        // 临时识别失败不终止录音：松手后的最终识别仍可能成功。
      }
      if (!disposed && voiceRunRef.current === run) {
        timer = window.setTimeout(() => void poll(), VOICE_PARTIAL_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(() => void poll(), VOICE_PARTIAL_FIRST_MS);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [voice]);

  // 松手：短按 = 切换式开启，保持录音等下一次点按；长按或切换式第二次点按 =
  // 停止识别，文本追加进输入框（不直发，识别错了还能改）
  const voiceUp = async () => {
    const heldMs = Date.now() - pressAtRef.current;
    if (voice !== "rec") return; // 开麦尚未完成的松手：完成后按切换式保持录音
    if (!stopOnUpRef.current && heldMs < TAP_MS) return; // 点按开启：保持录音
    ++voiceRunRef.current; // 立即作废尚在途的临时识别结果
    setVoice("busy");
    const partialFallback = voiceDraftRef.current;
    try {
      const text = await invoke<string>("stt_stop");
      const finalText = text || partialFallback;
      if (finalText) setValue((v) => v + finalText);
      setVoiceDraft("");
      setVoice("idle");
      taRef.current?.focus();
    } catch (err) {
      // 最终解码失败时保住用户已经看见的临时文本，转成可编辑定稿再报错。
      if (partialFallback) setValue((v) => v + partialFallback);
      setVoiceDraft("");
      flashVoiceErr(String(err));
    }
  };

  // 系统级中断（指针被拖拽劫走等）：丢弃本次录音
  const voiceCancel = () => {
    stopOnUpRef.current = false;
    if (voice !== "rec" && !voiceStartingRef.current) return;
    const run = ++voiceRunRef.current;
    void invoke("stt_cancel")
      .catch(() => {})
      .finally(() => {
        if (voiceRunRef.current === run) voiceStartingRef.current = false;
      });
    setVoiceDraft("");
    setVoice("idle");
  };

  // 内容变化时重算高度：先塌到 auto 量 scrollHeight，再夹到 [MIN,MAX]
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(MAX_H, Math.max(MIN_H, ta.scrollHeight))}px`;
  }, [composedValue]);

  const submit = () => {
    // 生成中不发送（此时按钮是暂停）；输入框仍可继续打字预输入
    if (sending || voice === "rec" || voice === "busy") return;
    const text = composedValue.trim();
    if (!text) return;
    onSend(text);
    setValue("");
    setVoiceDraft("");
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
            value={composedValue}
            rows={1}
            placeholder="和 Deskling 说点什么喵～（Enter 发送 · Shift+Enter 换行）"
            onChange={(e) => setValue(e.target.value)}
            readOnly={voice === "rec" || voice === "busy"}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <SendRow>
            <VoiceGroup>
              {/* 状态提示在左、麦克风贴着发送按钮 */}
              {voice === "rec" && (
                <VoiceHint data-rec>
                  {voiceDraft ? "实时识别中…点按/松手结束" : "正在听…点按/松手结束"}
                </VoiceHint>
              )}
              {voice === "busy" && <VoiceHint>识别中…</VoiceHint>}
              {voice === "err" && <VoiceHint data-err>{voiceErr}</VoiceHint>}
              {/* 语音按钮：与发送同规格（图标 24px + 上下 8px = 40px 齐高），
                  pointer 事件驱动；mousedown preventDefault 防抢 textarea 焦点 */}
              <PixelTip
                tip={
                  voice === "rec"
                    ? "再点一下 / 松开结束"
                    : voice === "busy"
                      ? "识别中…"
                      : "点按开录 · 按住说完松手"
                }
              >
                <PixelButton
                  variant={voice === "rec" ? "primary" : "low"}
                  disabled={voice === "busy"}
                  onMouseDown={(e) => e.preventDefault()}
                  onPointerDown={(e) => void voiceDown(e)}
                  onPointerUp={() => void voiceUp()}
                  onPointerCancel={voiceCancel}
                >
                  {/* 负 margin 收窄默认 18px 横向内边距，图标钮不至于过宽 */}
                  <MicIcon style={{ fontSize: 24, margin: "0 -6px" }} />
                </PixelButton>
              </PixelTip>
            </VoiceGroup>
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
                disabled={composedValue.trim().length === 0 || voice === "rec" || voice === "busy"}
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

/* 发送行：输入面内部底栏——按住说话 + 发送/暂停 一起靠右下角 */
const SendRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 7px;
`;

/* 状态提示（录音中/识别中/错误一闪）+ 麦克风，麦克风贴着发送按钮 */
const VoiceGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const VoiceHint = styled.span`
  font: ${t.textSm};
  color: ${t.colorTextMuted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &[data-rec] {
    color: ${t.colorAccent};
  }
  &[data-err] {
    color: ${t.btnClose};
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
