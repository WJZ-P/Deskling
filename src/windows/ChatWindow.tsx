import { useCallback, useEffect, useRef, useState } from "react";
import { styled } from "@linaria/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
import { getActiveProfile, getSetting } from "../settings";
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

export function ChatWindow() {
  const { theme, toggleTheme } = useTheme();
  // 初值同步读会话缓存（bootstrap 已 initConversations 填好），避免闪空
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    getConversations(),
  );
  const [activeId, setActiveId] = useState<string | null>(
    () => getConversations()[0]?.id ?? null,
  );
  // typing：首个 delta 到达前显示输入指示器；sending：整段请求进行中（禁输入框）
  const [typing, setTyping] = useState(false);
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
        streamRef.current.cancel();
        streamRef.current = null;
        liveRef.current = null;
        setTyping(false);
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

  const handleSend = useCallback(
    (text: string) => {
      if (!activeId) return;

      const profile = getActiveProfile();
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

      // 没配置 provider：直接以一条助手提示收场，不发请求
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
      setTyping(true);
      setStreamingId(replyId);
      liveRef.current = { convId, replyId };

      // 本轮收尾闭包：正常/出错/暂停共用，幂等收拢 sending/typing/streamingId。
      // 顺手把残留的 pending/running 工具段扫成 error（正常结束时全已定稿，是空转；
      // 取消触发的 Done 则靠它收拢没答完的审批段，不留孤儿转圈）。
      const finish = () => {
        setTyping(false);
        setSending(false);
        setStreamingId(null);
        streamRef.current = null;
        liveRef.current = null;
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
            if (!started) {
              started = true;
              setTyping(false);
            }
            appendDelta(setConversations, convId, replyId, chunk);
          },
          // 模型要调一个工具：落成工具段。危险工具进 pending（卡上出现同意/拒绝按钮，
          // Rust 侧 loop 已阻塞等审批）；安全工具直接 running（loop 已在执行）。
          onToolStart: (call) => {
            if (!started) {
              started = true;
              setTyping(false);
            }
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
            updateToolSegments(setConversations, convId, replyId, end.id, {
              status: end.status,
              detail: end.detail,
            });
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
      );
      streamRef.current = handle;
    },
    [activeId],
  );

  // 暂停：请求后端终止当前流，并立即本地收尾。已产出的部分回复原样保留在气泡里，
  // 后端随后回推的 Done 因 streamRef 已清空 + 状态已收拢，是无害空转。
  // 没答完的审批段就地扫成「已取消」（Rust 侧 cancel 同时唤醒了阻塞等审批的 loop）。
  const handleStop = useCallback(() => {
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
    setTyping(false);
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
                    typing={typing}
                    streamingId={streamingId}
                    convId={active.id}
                    onApproveTool={handleApproveTool}
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
