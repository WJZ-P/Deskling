import { useCallback, useEffect, useRef, useState } from "react";
import { styled } from "@linaria/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../styles/theme";
import { useTheme } from "../hooks/useTheme";
import Titlebar from "../components/pixel/Titlebar";
import { PixelFrame } from "../components/pixel/PixelFrame";
import { WINDOW_FRAME } from "../components/pixel/palettes";
import { HistorySidebar } from "../chat/components/HistorySidebar";
import { ChatBackdrop } from "../chat/components/ChatBackdrop";
import { MessageList } from "../chat/components/MessageList";
import { ChatComposer } from "../chat/components/ChatComposer";
import { getConversations, persistConversations } from "../chat/store";
import { streamChat, toHistory, type ChatTurn, type ChatStream } from "../chat/api";
import { SpeechSplitter } from "../chat/speech";
import {
  getActivePet,
  getActiveProfile,
  getPetVoice,
  getSetting,
  setSetting,
  type PetVoice,
} from "../settings";
import type {
  ChatMessage,
  Conversation,
  MessageSegment,
  ToolCallSegment,
} from "../chat/types";

/**
 * AI 对话窗口（label="chat"）：自绘标题栏 + 左历史栏 + 右主对话区。
 *
 * 发送后走真实流式：handleSend 把用户消息落库 → 取当前激活 provider →
 * streamChat 经 Rust provider_chat 命令发起 SSE 请求，逐条 delta 追加进
 * assistant 消息的文本段。首个 delta 到达前显示输入指示器；出错则把错误
 * 文案作为一条 assistant 文本回落展示。
 *
 * 关闭按钮 = 隐藏窗口（w.hide()），配合 Pet 页 / 托盘的 chat_toggle 再唤出，
 * 这样会话状态在一次运行内保留（不销毁窗口）。
 */

// 电子拟声（beep）收尾：AI 回复结束后再随机叨叨这么久才闭嘴（ms 区间）——
// 「AI 说完过一会才收声」的那个「一会儿」，可调
const BEEP_TAIL_MIN_MS = 0;
const BEEP_TAIL_MAX_MS = 1000;

// 说话卡顿看门狗阈值：正文流式时超过这么久没有新正文，桌宠就从「说话」切回
// 「思考」——AI 卡住时不至于一直张嘴说话对不上（有真实语音在播时不干预）
const TALK_STALL_MS = 1000;

// web 搜索类工具名判定（如将来的内置 web_search 工具）：命中则桌宠举放大镜端详
const isSearchTool = (name: string) => /search|web/i.test(name);

/**
 * 按一次工具调用挑桌宠演出：web 搜索 → 举放大镜端详（searching），其余 → 敲电脑（typing）。
 * web 搜索现在是技能（skill），没有专门工具名——它走 load_skill(web-search) 加载说明书
 * 再 run_command 跑 search.js，所以除了工具名，还看 args：加载搜索类技能、或跑搜索脚本时
 * 都演 searching。args 是 JSON 串（解析失败按敲电脑兜底）。
 */
function petToolState(call: { name: string; args: string }): "searching" | "typing" {
  if (isSearchTool(call.name)) return "searching";
  // args 是 JSON 串。注意 JSON.parse("null")/("1")/('"x"') 不抛错但返回非对象——
  // 必须显式判「是对象且非 null」，否则后面取 .name/.command 会抛 TypeError 逃出
  // 本函数、连累 onToolStart 吞掉整张工具卡片
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.args || "{}");
  } catch {
    parsed = null;
  }
  const a: { name?: unknown; command?: unknown } =
    parsed && typeof parsed === "object" ? parsed : {};
  if (call.name === "load_skill" && isSearchTool(String(a.name ?? ""))) return "searching";
  if (
    call.name === "run_command" &&
    /search\.c?js|web-search|duckduckgo/i.test(String(a.command ?? ""))
  ) {
    return "searching";
  }
  return "typing";
}

// 消息 id：必须跨会话唯一。若只用运行内自增计数器，程序重启后计数器归零、
// 重新发号会和上次持久化的旧消息 id 相撞——新一轮 replyId 恰好等于某条旧消息 id 时，
// appendDelta 会误命中那条旧消息、把新回复接到它尾部（表现为「AI 回复追加在上次消息结尾」）。
// 故 id 用「启动时间戳基址 + 自增」，确保每次运行发出的 id 段互不重叠。
let seq = 0;
const idBase = Date.now();
const nextId = () => `local-${idBase}-${seq++}`;

/** 取一条消息的纯文本预览（拼接文本段，截断给列表副标题用） */
function previewOf(segments: MessageSegment[]): string {
  const text = segments
    .filter((s): s is Extract<MessageSegment, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text)
    .join("");
  return text.slice(0, 40) || "…";
}

/** setConversations 的类型别名（helper 里复用） */
type SetConvs = React.Dispatch<React.SetStateAction<Conversation[]>>;

/**
 * 把一段增量文本追加进指定会话里的某条 assistant 消息。
 * 该消息不存在则先创建（惰性：首个 delta 到达才落一条空助手消息），
 * 存在则接到它最后一个文本段尾部。同时刷新会话预览/时间。
 */
function appendDelta(
  setConversations: SetConvs,
  convId: string,
  replyId: string,
  chunk: string,
): void {
  setConversations((prev) =>
    prev.map((c) => {
      if (c.id !== convId) return c;
      const idx = c.messages.findIndex((m) => m.id === replyId);
      let messages: ChatMessage[];
      if (idx === -1) {
        // 首个 delta：新建一条 assistant 消息
        const reply: ChatMessage = {
          id: replyId,
          role: "assistant",
          ts: Date.now(),
          segments: [{ kind: "text", text: chunk }],
        };
        messages = [...c.messages, reply];
      } else {
        // 续写：接到最后一个文本段（没有则补一个）
        const msg = c.messages[idx];
        const segs = [...msg.segments];
        const last = segs[segs.length - 1];
        if (last && last.kind === "text") {
          segs[segs.length - 1] = { kind: "text", text: last.text + chunk };
        } else {
          segs.push({ kind: "text", text: chunk });
        }
        const updated: ChatMessage = { ...msg, segments: segs };
        messages = [...c.messages];
        messages[idx] = updated;
      }
      const reply = messages[messages.length - 1];
      return {
        ...c,
        preview: previewOf(reply.segments),
        updatedAt: reply.ts,
        messages,
      };
    }),
  );
}

/**
 * 把一段思考增量追加进流式回复消息（推理模型的 reasoning 先于正文到达，
 * 回复消息可能还不存在 → 与 appendDelta 同款惰性创建）。
 * 增量接在最后一个思考段尾部；末段不是 thinking（如工具调用后模型再度思考）
 * 则新起一段。不动 preview——思考不是可读正文，别把列表副标题冲成「…」。
 */
function appendThinking(
  setConversations: SetConvs,
  convId: string,
  replyId: string,
  chunk: string,
): void {
  setConversations((prev) =>
    prev.map((c) => {
      if (c.id !== convId) return c;
      const idx = c.messages.findIndex((m) => m.id === replyId);
      let messages: ChatMessage[];
      if (idx === -1) {
        const reply: ChatMessage = {
          id: replyId,
          role: "assistant",
          ts: Date.now(),
          segments: [{ kind: "thinking", text: chunk }],
        };
        messages = [...c.messages, reply];
      } else {
        const msg = c.messages[idx];
        const segs = [...msg.segments];
        const last = segs[segs.length - 1];
        if (last && last.kind === "thinking") {
          segs[segs.length - 1] = { kind: "thinking", text: last.text + chunk };
        } else {
          segs.push({ kind: "thinking", text: chunk });
        }
        messages = [...c.messages];
        messages[idx] = { ...msg, segments: segs };
      }
      return { ...c, updatedAt: Date.now(), messages };
    }),
  );
}

/** 直接落一条完整的 assistant 文本消息（用于「未配置 provider」等即时提示） */
function appendAssistantText(
  setConversations: SetConvs,
  convId: string,
  replyId: string,
  text: string,
): void {
  appendDelta(setConversations, convId, replyId, text);
}

/**
 * 把一个工具调用段追加进流式回复消息的末尾。
 * toolStart 可能先于任何 delta 到达（模型开口第一件事就是调工具），
 * 此时回复消息还不存在 → 与 appendDelta 同款惰性创建。
 * 不动 preview：工具段没有可读文本，避免把列表副标题冲成「…」。
 */
function appendToolSegment(
  setConversations: SetConvs,
  convId: string,
  replyId: string,
  seg: ToolCallSegment,
): void {
  setConversations((prev) =>
    prev.map((c) => {
      if (c.id !== convId) return c;
      const idx = c.messages.findIndex((m) => m.id === replyId);
      let messages: ChatMessage[];
      if (idx === -1) {
        const reply: ChatMessage = {
          id: replyId,
          role: "assistant",
          ts: Date.now(),
          segments: [seg],
        };
        messages = [...c.messages, reply];
      } else {
        const msg = c.messages[idx];
        messages = [...c.messages];
        messages[idx] = { ...msg, segments: [...msg.segments, seg] };
      }
      return { ...c, updatedAt: Date.now(), messages };
    }),
  );
}

/**
 * 更新回复消息里指定 id 的工具段（toolEnd 回填结果 / 审批放行乐观置 running）。
 * matchId 传 null 表示「所有未定稿（pending/running）的段」——取消/中断时兜底收拢，
 * 避免孤儿工具段永远呼吸闪烁。
 */
function updateToolSegments(
  setConversations: SetConvs,
  convId: string,
  replyId: string,
  matchId: string | null,
  patch: Partial<Omit<ToolCallSegment, "kind" | "id">>,
): void {
  setConversations((prev) =>
    prev.map((c) => {
      if (c.id !== convId) return c;
      const idx = c.messages.findIndex((m) => m.id === replyId);
      if (idx === -1) return c;
      const msg = c.messages[idx];
      let touched = false;
      const segments = msg.segments.map((s) => {
        if (s.kind !== "tool") return s;
        const hit =
          matchId === null
            ? s.status === "pending" || s.status === "running"
            : s.id === matchId;
        if (!hit) return s;
        touched = true;
        return { ...s, ...patch };
      });
      if (!touched) return c;
      const messages = [...c.messages];
      messages[idx] = { ...msg, segments };
      return { ...c, updatedAt: Date.now(), messages };
    }),
  );
}

/** 给某个工具段（按 id）追加一行子步骤日志——subagent 运行中的进展逐行累积 */
function appendSubagentStep(
  setConversations: SetConvs,
  convId: string,
  replyId: string,
  matchId: string,
  line: string,
): void {
  setConversations((prev) =>
    prev.map((c) => {
      if (c.id !== convId) return c;
      const idx = c.messages.findIndex((m) => m.id === replyId);
      if (idx === -1) return c;
      const msg = c.messages[idx];
      let touched = false;
      const segments = msg.segments.map((s) => {
        if (s.kind !== "tool" || s.id !== matchId) return s;
        touched = true;
        return { ...s, steps: [...(s.steps ?? []), line] };
      });
      if (!touched) return c;
      const messages = [...c.messages];
      messages[idx] = { ...msg, segments };
      return { ...c, updatedAt: Date.now(), messages };
    }),
  );
}

export function ChatWindow() {
  const { theme, toggleTheme } = useTheme();
  // 初值同步读会话缓存（bootstrap 已 initConversations 填好），避免闪空
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    getConversations(),
  );
  const [activeId, setActiveId] = useState<string | null>(
    () => getConversations()[0]?.id ?? null,
  );
  // typingConv：首个 delta 到达前显示输入指示器的「会话 id」——必须记会话而非布尔，
  // 否则流式思考中切去/新开别的会话，loading 气泡会跟着串场；sending：整段请求进行中（禁输入框）
  const [typingConv, setTypingConv] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // 正在流式输出的助手消息 id：驱动该条末尾文本段逐字蹦入（StreamingText）
  const [streamingId, setStreamingId] = useState<string | null>(null);
  // 当前在途流式请求的句柄（含 cancel/approve）：暂停按钮据它终止本轮
  const streamRef = useRef<ChatStream | null>(null);
  // 在途流的落点（会话 id + 回复消息 id）：审批回调 / 收尾清扫都按它定位，
  // 不依赖 activeId——用户中途切到别的会话，审批与收尾仍要回填到发起时那条。
  const liveRef = useRef<{ convId: string; replyId: string } | null>(null);

  // 防抖落盘：会话任何变动后 ~500ms 写一次。流式 delta 高频触发，
  // 防抖把整段增量合并成一次写盘，最后一个 delta 落定后统一持久化。
  const persistTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void persistConversations(conversations);
    }, 500);
    return () => window.clearTimeout(persistTimer.current);
  }, [conversations]);

  // 分组相对日期（今天/昨天）用的时间基准：每分钟刷一次即可。
  // 不能挂在 conversations 上——流式期间每个 delta 都会改 conversations，
  // now 一起换新会把 HistorySidebar 的分组 useMemo 和全部卡片一并击穿重渲染。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  // 历史侧栏收起态：改动即持久化（下次打开对话窗保持）
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    getSetting("chatSidebarCollapsed"),
  );
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      void setSetting("chatSidebarCollapsed", !v);
      return !v;
    });
  }, []);

  const closeToTray = useCallback(() => {
    void getCurrentWindow().hide();
  }, []);

  // 删除一段会话：从列表移除；若删的是当前选中项，落到剩余里最新的一条（没有则清空）。
  // 若正删的是正在流式输出的会话，先请求终止在途请求并收尾，避免回填串到已删会话。
  const handleDelete = useCallback(
    (id: string) => {
      // 删的是在途流所属的会话（按 liveRef 判定，与当前选中无关）：
      // 先终止在途请求并收尾，避免后端白跑 / 状态悬空
      if (liveRef.current?.convId === id && streamRef.current) {
        window.clearTimeout(beepTailRef.current);
        void invoke("tts_stop").catch(() => {});
        speechRef.current = null;
        streamRef.current.cancel();
        streamRef.current = null;
        liveRef.current = null;
        setTypingConv(null);
        setSending(false);
        setStreamingId(null);
      }
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        setActiveId((cur) => {
          if (cur !== id) return cur; // 删的不是当前项，选中不变
          // 删的是当前项：选剩余里 updatedAt 最新的一条（无则 null）
          const fallback = next.reduce<Conversation | null>(
            (best, c) => (best === null || c.updatedAt > best.updatedAt ? c : best),
            null,
          );
          return fallback?.id ?? null;
        });
        return next;
      });
    },
    // 依赖为空 = 引用稳定：在途流归属看 liveRef、选中回退用函数式 setActiveId，
    // 都不读 activeId。稳定引用让 HistoryCard 的 memo 不被删除回调击穿。
    [],
  );

  // 删除单条消息（气泡悬浮工具栏）：按 (convId, msgId) 精确定位——老数据存在
  // 跨会话重复 id，必须带会话 id 才不误删别的会话里的同名消息。
  // 顺手用剩余最后一条刷新会话预览（不动 updatedAt，避免列表因删除而重排）。
  const handleDeleteMessage = useCallback((convId: string, msgId: string) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const messages = c.messages.filter((m) => m.id !== msgId);
        if (messages.length === c.messages.length) return c;
        const last = messages[messages.length - 1];
        return {
          ...c,
          messages,
          preview: last ? previewOf(last.segments) : "还没有消息",
        };
      }),
    );
  }, []);

  const handleNew = useCallback(() => {
    const conv: Conversation = {
      id: nextId(),
      title: "新的对话",
      preview: "还没有消息",
      updatedAt: Date.now(),
      messages: [],
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
  }, []);

  // ---- 桌宠事件桥：对话进行到哪一步，桌宠就演哪一出 ----
  // thinking = 等首包/推理中（托腮）；typing = 普通工具执行中（敲电脑）；
  // searching = web 搜索类工具执行中（举放大镜端详）；talking = 正文流式输出
  // （说话）；idle = 一轮收工回待机。去重后 emitTo 桌宠窗（与动画测试按钮同
  // 一条 pet:play 通道；窗口隐藏时播了也无妨）。桌宠被摸会临时插播摸头，下一
  // 次桥状态变化时自动回到对话演出
  const petStateRef = useRef<string | null>(null);
  // 说话卡顿看门狗计时器：见 TALK_STALL_MS
  const talkStallRef = useRef(0);
  const petPlay = useCallback(
    (state: "thinking" | "talking" | "typing" | "searching" | "idle") => {
      // 说话态起看门狗：TALK_STALL_MS 内没再收到正文（没续期）→ 当前还在说话且无
      // 真实语音在播（有语音时嘴型交给 tts:state 主导，不抢）就切回思考
      const armStall = () => {
        window.clearTimeout(talkStallRef.current);
        talkStallRef.current = window.setTimeout(() => {
          // 取消/暂停/收尾后 liveRef 已被清空——此时不再误发 thinking。静音模式下
          // talking 由正文 delta 驱动，用户在 AI 卡住时点停，看门狗还挂着，1s 后 fire
          // 会给已收工的桌宠误播「思考」；用 liveRef 挡掉（各取消路径都会清 liveRef）
          if (!liveRef.current) return;
          if (petStateRef.current === "talking" && !ttsPlayingRef.current) {
            petStateRef.current = "thinking";
            void emitTo("pet", "pet:play", { state: "thinking" }).catch(() => {});
          }
        }, TALK_STALL_MS);
      };
      // 去重：同状态不重发。但「说话」态每个正文 delta 都会重复调进来——此时虽跳过
      // emit，仍要续一下看门狗（有新正文 = 没卡）
      if (petStateRef.current === state) {
        if (state === "talking") armStall();
        return;
      }
      petStateRef.current = state;
      void emitTo("pet", "pet:play", { state }).catch(() => {});
      // 进入说话就起看门狗；切到别的态就撤掉
      if (state === "talking") armStall();
      else window.clearTimeout(talkStallRef.current);
    },
    [],
  );

  // ---- 语音（TTS）：桌宠在桌面上时，AI 回复实时出声 ----
  // 两种嗓音分开做：
  //   neural = 普通音色（Kokoro 等）：分句器逐句真合成，念出实际内容；
  //   beep   = 电子拟声：只模拟发音，开一次 tts_beep_start 持续叨叨，回复
  //            完毕后随机延时 1-2s 再 tts_stop（「AI 说完过一会才闭嘴」）。
  // 发起那刻按当前桌宠嗓音 + 桌宠是否在桌面上决定；null = 本轮不发声。
  // packId → engine 的映射挂载时扫一次缓存（beep 是内置包，必在表里）
  // beep 的 armed = 桌宠在桌面上、已确认可发声（但要等真实正文才开叨）；
  // started = 已开叨（首个正文 delta 触发，避免 loading/思考阶段就出声）
  const speechRef = useRef<
    | { mode: "neural"; splitter: SpeechSplitter; voice: PetVoice }
    | { mode: "beep"; voice: PetVoice; armed: boolean; started: boolean }
    | null
  >(null);
  const engineByPackRef = useRef<Map<string, string>>(new Map());
  // beep 收尾定时器：回复完后延时 tts_stop；新轮/打断要取消它，别误杀新叨叨
  const beepTailRef = useRef(0);
  useEffect(() => {
    void invoke<{ id: string; engine: string; valid: boolean }[]>("tts_packs")
      .then((list) => {
        const m = new Map<string, string>();
        for (const p of list) if (p.valid) m.set(p.id, p.engine);
        engineByPackRef.current = m;
      })
      .catch(() => {});
    return () => window.clearTimeout(beepTailRef.current);
  }, []);
  const speakSentences = useCallback((sentences: string[]) => {
    const s = speechRef.current;
    if (s?.mode !== "neural") return;
    for (const text of sentences) {
      void invoke("tts_speak", {
        text,
        packId: s.voice.packId,
        voiceId: s.voice.voiceId,
        speed: s.voice.speed ?? 1,
        // 扬声器设备来自设置页（"" = 系统默认；变化时 Rust 播放线程热重建）
        device: getSetting("ttsDevice") || null,
      }).catch((err) => console.warn("tts_speak failed:", err));
    }
  }, []);

  // 桌宠嘴型跟真实声音走：tts:state 是 Rust 播放线程的广播（带 300ms 停顿
  // 豁免）。播放中 = 说话；间歇 = 回合内托腮（下一句在合成）/ 回合外回待机。
  // 文字流驱动的 talking 在语音开启时让位（见 onDelta），两个驱动源不打架
  const ttsPlayingRef = useRef(false);
  useEffect(() => {
    const unlisten = listen<{ playing?: boolean }>("tts:state", (e) => {
      const playing = !!e.payload?.playing;
      ttsPlayingRef.current = playing;
      if (playing) petPlay("talking");
      else petPlay(liveRef.current ? "thinking" : "idle");
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [petPlay]);

  // 气泡桥：把当前回复的累积文本推给桌宠窗，头顶气泡逐字长出。
  // kind 区分说话（正文，白面对话泡）与思考（reasoning，想法泡：三个小圆圈
  // 升上去）。高频到达 → 节流 ~100ms 只发最新一版；清空（text=""）与收尾
  // （done）立即发不节流。replyTextRef 累积本轮正文；thinkTextRef 累积当前
  // 思考段（每进入新一段思考清零重来，气泡只演最新一段的心理活动）
  type BubbleKind = "say" | "think";
  const replyTextRef = useRef("");
  const thinkTextRef = useRef("");
  const latestSayRef = useRef<{ text: string; kind: BubbleKind }>({ text: "", kind: "say" });
  const sayThrottleRef = useRef(0);
  const petSay = useCallback((text: string, kind: BubbleKind = "say", done = false) => {
    if (text === "" || done) {
      window.clearTimeout(sayThrottleRef.current);
      sayThrottleRef.current = 0;
      void emitTo("pet", "pet:say", { text, kind, done }).catch(() => {});
      return;
    }
    latestSayRef.current = { text, kind };
    if (sayThrottleRef.current === 0) {
      sayThrottleRef.current = window.setTimeout(() => {
        sayThrottleRef.current = 0;
        const latest = latestSayRef.current;
        void emitTo("pet", "pet:say", {
          text: latest.text,
          kind: latest.kind,
          done: false,
        }).catch(() => {});
      }, 100);
    }
  }, []);

  /**
   * 发起一轮流式请求（handleSend 与「编辑重发」共用）。
   * 前置条件：目标会话的 messages 已更新到位，history 是要发给后端的完整轮次。
   * 未配置 provider 时落一条提示消息收场。
   */
  const startStream = useCallback((convId: string, history: ChatTurn[]) => {
    // 没配置 provider：直接以一条助手提示收场，不发请求
    const profile = getActiveProfile();
    if (!profile) {
      appendAssistantText(
        setConversations,
        convId,
        nextId(),
        "还没配置 AI 服务商喵～去「设置 → AI 服务」加一个并选中，就能聊啦。",
      );
      return;
    }

    // 助手消息 id 惰性创建：首个 delta 到达时才落一条空助手消息，
    // 在此之前保持输入指示器（typing）显示「思考中」。
    // streamingId 提前设成 replyId：待首个 delta 建出该消息时，它一挂载就是 live，
    // 从空基线开始逐字蹦入（连第一段 chunk 也蹦）。
    const replyId = nextId();
    let started = false;
    setSending(true);
    setTypingConv(convId);
    setStreamingId(replyId);
    liveRef.current = { convId, replyId };
    petPlay("thinking"); // 等首包：桌宠托腮想
    replyTextRef.current = "";
    thinkTextRef.current = "";
    petSay(""); // 清掉上一轮残留的气泡
    // 语音：清上一轮残声（清队 + 弃稿 + 取消待收尾的 beep 定时器），按当前桌宠
    // 嗓音挂本轮。beep 走叨叨（异步等确认桌宠在桌面上再开），neural 挂分句器。
    // 桌宠不在桌面上则本轮静音（下面异步 pet_visible 兜底撤销）
    window.clearTimeout(beepTailRef.current);
    void invoke("tts_stop").catch(() => {});
    const voice = getPetVoice(getActivePet());
    const engine = voice ? engineByPackRef.current.get(voice.packId) : undefined;
    if (voice && engine === "beep") {
      speechRef.current = { mode: "beep", voice, armed: false, started: false };
    } else if (voice) {
      speechRef.current = { mode: "neural", splitter: new SpeechSplitter(), voice };
    } else {
      speechRef.current = null;
    }
    // 只在桌宠展示在桌面上时出声：异步查一次可见性，隐藏则撤销本轮语音。
    // 注意 beep 在此只「备好」（armed），真正开叨等首个正文 delta——loading /
    // 思考阶段不出声（pet_visible 是本地 IPC，早于首包返回，armed 先就位）
    if (speechRef.current) {
      const setup = speechRef.current;
      void invoke<boolean>("pet_visible")
        .then((visible) => {
          if (speechRef.current !== setup) return;
          if (!visible) {
            speechRef.current = null;
            void invoke("tts_stop").catch(() => {});
          } else if (setup.mode === "beep") {
            setup.armed = true;
          }
        })
        .catch(() => {});
    }

    // 本轮收尾闭包：正常/出错/暂停共用，幂等收拢 sending/typing/streamingId。
    // 顺手把残留的 pending/running 工具段扫成 error（正常结束时全已定稿，是空转；
    // 取消触发的 Done 则靠它收拢没答完的审批段，不留孤儿转圈）。
    const finish = () => {
      setTypingConv(null);
      setSending(false);
      setStreamingId(null);
      streamRef.current = null;
      liveRef.current = null;
      // 语音收尾：neural 把分句器余量念完（嘴型交给 tts:state 落回 idle）；
      // beep 不是念完就停——随机再叨 1-2s 才 tts_stop（AI 说完过一会才闭嘴）
      const sp = speechRef.current;
      speechRef.current = null;
      if (sp?.mode === "neural") {
        speakSentences(sp.splitter.flush());
        if (!ttsPlayingRef.current) petPlay("idle");
      } else if (sp?.mode === "beep" && sp.started) {
        // 叨叨已在响：随机再叨 BEEP_TAIL 区间才 tts_stop（AI 说完过一会才闭嘴）；
        // 嘴型保持 talking，tts_stop 后 tts:state(false) 落回 idle
        const tail = BEEP_TAIL_MIN_MS + Math.random() * (BEEP_TAIL_MAX_MS - BEEP_TAIL_MIN_MS);
        window.clearTimeout(beepTailRef.current);
        beepTailRef.current = window.setTimeout(
          () => void invoke("tts_stop").catch(() => {}),
          tail,
        );
      } else {
        petPlay("idle"); // 本轮无语音（含 beep 备好却没等到正文）：直接回待机
      }
      petSay(replyTextRef.current, "say", true); // 气泡收尾：驻留一会儿再消失（正文为空则直接清）
      updateToolSegments(setConversations, convId, replyId, null, {
        status: "error",
        detail: "已取消",
      });
    };

    const handle = streamChat(
      profile,
      history,
      {
        onDelta: (chunk) => {
          // 迟到事件守卫：取消/收尾后 liveRef 已被清空或指向新一轮，丢弃本轮残留事件
          // （并发下取消瞬间可能有多达 concurrency 个任务已越过 Rust 侧取消检查、
          //  仍会回推 ToolStart/ToolEnd/Delta——不拦会复活已取消卡、冒出新卡甚至留孤儿）
          if (liveRef.current?.replyId !== replyId) return;
          if (!started) {
            started = true;
            setTypingConv(null);
          }
          // 语音开启时嘴型由 tts:state（真实声音）驱动，文字流不抢；静音才走老路
          if (!speechRef.current) petPlay("talking");
          replyTextRef.current += chunk;
          petSay(replyTextRef.current); // 累积正文推给头顶气泡（节流发送）
          // 只在真实正文输出时发声（loading/思考阶段不出声）：
          //   neural 逐句真合成念出内容；beep 首个正文 delta 才开叨（自主进行）
          const sp = speechRef.current;
          if (sp?.mode === "neural") {
            speakSentences(sp.splitter.push(chunk));
          } else if (sp?.mode === "beep" && sp.armed && !sp.started) {
            sp.started = true;
            void invoke("tts_beep_start", {
              packId: sp.voice.packId,
              voiceId: sp.voice.voiceId,
              device: getSetting("ttsDevice") || null,
            }).catch((err) => console.warn("tts_beep_start failed:", err));
          }
          appendDelta(setConversations, convId, replyId, chunk);
        },
        // 思考增量：推理模型先吐 reasoning 再吐正文——首个思考片段一到就撤下
        // 「思考中」指示器，由气泡里流式展开的思考块接管展示
        onThinking: (chunk) => {
          if (liveRef.current?.replyId !== replyId) return; // 迟到事件守卫（同 onDelta）
          if (!started) {
            started = true;
            setTypingConv(null);
          }
          petPlay("thinking"); // 推理中：继续托腮（去重后高频调用零开销）
          // 新一段思考开始（此前在说正文/刚开场）：清零重新累积，
          // 想法泡只演当前这段心理活动，不把工具往返的历史思考全堆上去
          if (latestSayRef.current.kind !== "think") thinkTextRef.current = "";
          thinkTextRef.current += chunk;
          petSay(thinkTextRef.current, "think"); // 推给头顶想法泡（节流发送）
          appendThinking(setConversations, convId, replyId, chunk);
        },
        // 模型要调一个工具：落成工具段。危险工具进 pending（卡上出现同意/拒绝按钮，
        // Rust 侧 loop 已阻塞等审批）；安全工具直接 running（loop 已在执行）。
        onToolStart: (call) => {
          if (liveRef.current?.replyId !== replyId) return; // 迟到事件守卫（同 onDelta）
          if (!started) {
            started = true;
            setTypingConv(null);
          }
          // 干活了：web 搜索（含技能化的）举放大镜端详，其余工具敲电脑
          petPlay(petToolState(call));
          appendToolSegment(setConversations, convId, replyId, {
            kind: "tool",
            id: call.id,
            name: call.name,
            summary: call.summary,
            args: call.args,
            needsApproval: call.needsApproval,
            status: call.needsApproval ? "pending" : "running",
          });
        },
        // 工具执行收尾：按 id 回填状态与结果预览
        onToolEnd: (end) => {
          if (liveRef.current?.replyId !== replyId) return; // 迟到事件守卫（防复活已取消卡）
          petPlay("thinking"); // 工具跑完模型接着消化结果：回到托腮（开口时切说话）
          updateToolSegments(setConversations, convId, replyId, end.id, {
            status: end.status,
            detail: end.detail,
          });
        },
        // 子 agent 进展：逐行追加进那张 subagent 工具卡的子步骤日志（不驱动桌宠）
        onSubagentStep: (s) => {
          if (liveRef.current?.replyId !== replyId) return; // 迟到事件守卫
          appendSubagentStep(setConversations, convId, replyId, s.id, s.line);
        },
        onDone: finish, // 收尾：末段动画走完后 StreamingText 自动塌成纯文本
        onError: (message) => {
          finish();
          // 把错误落成助手气泡（已开始的续在同一条，否则新起一条）
          appendDelta(
            setConversations,
            convId,
            replyId,
            started ? `\n\n[出错了喵] ${message}` : `[出错了喵] ${message}`,
          );
        },
      },
      // 免审批开关：发送那一刻读取（跨窗口 onKeyChange 已保证缓存新鲜）
      getSetting("autoApproveTools"),
      // 深度思考开关：输入框操作栏切换写入，发送那一刻读取（同窗口缓存即时可见）
      getSetting("chatThinking"),
      // 工具并发上限：一轮多个工具调用最多同时跑几个（设置页可调；Rust 侧再 clamp）
      getSetting("toolConcurrency"),
      // 人设：当前桌宠档案的 prompt（主窗口桌宠页编辑，跨窗口 onKeyChange 同步），
      // 只注入对话开头一次；清空人设则不注入
      getActivePet().prompt.trim() || null,
    );
    streamRef.current = handle;
  }, [petPlay, petSay, speakSentences]);

  const handleSend = useCallback(
    (text: string) => {
      if (!activeId) return;

      const userMsg: ChatMessage = {
        id: nextId(),
        role: "user",
        ts: Date.now(),
        segments: [{ kind: "text", text }],
      };

      // 先落用户消息，更新会话标题/预览；同时算出「含这条」的历史给后端。
      // 注意用 activeId 锁定当前会话，避免流式回填串到别的会话上。
      const convId = activeId;
      let history: ChatTurn[] = [];
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          const messages = [...c.messages, userMsg];
          history = toHistory(messages);
          return {
            ...c,
            title: c.messages.length === 0 ? text.slice(0, 18) : c.title,
            preview: text,
            updatedAt: userMsg.ts,
            messages,
          };
        }),
      );

      startStream(convId, history);
    },
    [activeId, startStream],
  );

  // 编辑单条消息 = 从这个节点「分叉重来」：替换文本、丢弃它之后的全部消息；
  // 编辑的是用户消息时再以截断后的历史重新发起请求（重新进 loading，AI 重答）。
  // 编辑助手消息只截断不重发——没有新的用户提问，重发没有语义。
  const handleEditMessage = useCallback(
    (convId: string, msgId: string, text: string) => {
      // 有在途流先取消收尾（编辑期间输入框虽被 sending 禁用，但工具栏仍可用；
      // 且被截断丢弃的消息里可能正包含流式落点，不取消会写进已删除的消息）
      if (streamRef.current) {
        window.clearTimeout(beepTailRef.current);
        void invoke("tts_stop").catch(() => {});
        speechRef.current = null;
        streamRef.current.cancel();
        streamRef.current = null;
        const live = liveRef.current;
        liveRef.current = null;
        if (live) {
          updateToolSegments(setConversations, live.convId, live.replyId, null, {
            status: "error",
            detail: "已取消",
          });
        }
        setTypingConv(null);
        setSending(false);
        setStreamingId(null);
      }

      let history: ChatTurn[] | null = null;
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          const idx = c.messages.findIndex((m) => m.id === msgId);
          if (idx === -1) return c;
          const msg = c.messages[idx];
          // 文本段收敛为一段（编辑框里是拼接文本），工具调用段原位保留
          const segments: MessageSegment[] = [];
          let inserted = false;
          for (const s of msg.segments) {
            if (s.kind === "text") {
              if (!inserted) {
                segments.push({ kind: "text", text });
                inserted = true;
              }
            } else segments.push(s);
          }
          if (!inserted) segments.push({ kind: "text", text });
          // 截断：编辑的这条成为会话新末尾，之后的消息全部丢弃
          const messages = [...c.messages.slice(0, idx), { ...msg, segments }];
          if (msg.role === "user") history = toHistory(messages);
          return {
            ...c,
            messages,
            preview: previewOf(segments),
            updatedAt: Date.now(),
          };
        }),
      );

      if (history) startStream(convId, history);
    },
    [startStream],
  );

  // 暂停：请求后端终止当前流，并立即本地收尾。已产出的部分回复原样保留在气泡里，
  // 后端随后回推的 Done 因 streamRef 已清空 + 状态已收拢，是无害空转。
  // 没答完的审批段就地扫成「已取消」（Rust 侧 cancel 同时唤醒了阻塞等审批的 loop）。
  const handleStop = useCallback(() => {
    // 语音同步打断：闭嘴（清队弃稿 + 取消 beep 收尾定时器），并撤下本轮语音——
    // 随后触发的 finish 不再把余量送去合成 / 不再排 beep 尾声
    window.clearTimeout(beepTailRef.current);
    void invoke("tts_stop").catch(() => {});
    speechRef.current = null;
    streamRef.current?.cancel();
    streamRef.current = null;
    const live = liveRef.current;
    liveRef.current = null;
    if (live) {
      updateToolSegments(setConversations, live.convId, live.replyId, null, {
        status: "error",
        detail: "已取消",
      });
    }
    setTypingConv(null);
    setSending(false);
    setStreamingId(null);
  }, []);

  // 审批作答：放行/拒绝一次 pending 的工具调用，唤醒 Rust 侧阻塞等待的 agent loop。
  // 放行做乐观更新 pending → running（Rust 对「开始执行」不再发事件，不更 UI 会一直显示待审批）；
  // 拒绝不动段状态——Rust 立即回 ToolEnd(error) 落定，避免双写。
  const handleApproveTool = useCallback((toolCallId: string, approved: boolean) => {
    const stream = streamRef.current;
    const live = liveRef.current;
    if (!stream || !live) return;
    stream.approve(toolCallId, approved);
    if (approved) {
      updateToolSegments(setConversations, live.convId, live.replyId, toolCallId, {
        status: "running",
      });
    }
  }, []);

  return (
    <Shell>
      <Titlebar
        theme={theme}
        onToggleTheme={toggleTheme}
        subtitle="· 对话"
        onClose={closeToTray}
      />
      <Body>
        <HistorySidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={setActiveId}
          onNew={handleNew}
          onDelete={handleDelete}
          now={now}
          theme={theme}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
        />
        <Main>
          {/* 对话区专属像素背景：白底噪+蓝色游动 + 点阵 + 蓝图十字 + 柔光 */}
          <ChatBackdrop theme={theme} />
          <MainInner>
            {active ? (
              <>
                <ConvHeader>
                  <ConvTitle>{active.title}</ConvTitle>
                  <ConvMeta>
                    {active.messages.length} 条消息 · 可操作整台电脑
                  </ConvMeta>
                </ConvHeader>
                <ListArea>
                  <MessageList
                    messages={active.messages}
                    typing={typingConv === active.id}
                    streamingId={streamingId}
                    convId={active.id}
                    onApproveTool={handleApproveTool}
                    onEditMessage={handleEditMessage}
                    onDeleteMessage={handleDeleteMessage}
                  />
                </ListArea>
                <ChatComposer onSend={handleSend} onStop={handleStop} sending={sending} />
              </>
            ) : (
              <NoConv>
                <NoConvFace>(=^･ω･^=)</NoConvFace>
                <NoConvText>选一段历史对话，或者新建一个开始聊天喵～</NoConvText>
              </NoConv>
            )}
          </MainInner>
        </Main>
      </Body>

      {/* 窗口外包裹框：与主窗口一致，给无边框窗口收口一圈 */}
      <WindowFrameLayer aria-hidden>
        <PixelFrame
          palette={WINDOW_FRAME[theme]}
          variant="raised"
          pixel={3}
          radius={0}
          hollow
        />
      </WindowFrameLayer>
    </Shell>
  );
}

const Shell = styled.div`
  position: relative;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: ${t.colorBg};
`;

const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  /* 同主窗口：上移一档塞进标题栏底下，消除双线接缝 */
  margin-top: -8px;
`;

const Main = styled.main`
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  /* 背景交给 ChatBackdrop（绝对铺底），Main 自身透明 */
`;

/* 内容层：浮在 ChatBackdrop 之上，撑满 Main 并沿用其 flex 纵向布局 */
const MainInner = styled.div`
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const ConvHeader = styled.header`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 18px 10px;
  border-bottom: 1px solid ${t.colorBorder};
`;

const ConvTitle = styled.h1`
  margin: 0;
  font: ${t.textMd};
  font-weight: bold;
  letter-spacing: 1px;
  color: ${t.colorText};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ConvMeta = styled.div`
  font: ${t.textXs};
  color: ${t.colorTextMuted};
`;

const ListArea = styled.div`
  flex: 1 1 auto;
  min-height: 0;
`;

const NoConv = styled.div`
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
`;

const NoConvFace = styled.div`
  font: ${t.textXl};
  color: ${t.colorAccent};
`;

const NoConvText = styled.div`
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;

const WindowFrameLayer = styled.div`
  position: absolute;
  inset: 0;
  z-index: 100;
  pointer-events: none;
`;
