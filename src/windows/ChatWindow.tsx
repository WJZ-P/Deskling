import { useCallback, useMemo, useState } from "react";
import { styled } from "@linaria/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "../styles/theme";
import { useTheme } from "../hooks/useTheme";
import Titlebar from "../components/pixel/Titlebar";
import { PixelFrame } from "../components/pixel/PixelFrame";
import { WINDOW_FRAME } from "../components/pixel/palettes";
import { HistorySidebar } from "../chat/components/HistorySidebar";
import { MessageList } from "../chat/components/MessageList";
import { ChatComposer } from "../chat/components/ChatComposer";
import { MOCK_CONVERSATIONS } from "../chat/mockData";
import type { ChatMessage, Conversation } from "../chat/types";

/**
 * AI 对话窗口（label="chat"）：自绘标题栏 + 左历史栏 + 右主对话区。
 *
 * 现阶段是 UI 表现层：会话数据来自 mock，发送后用「假回复 + 输入指示器」
 * 模拟一次流式回答，好让交互跑起来。后续接 Rust 命令 / Anthropic API 时，
 * 只需把 handleSend 换成真实的「emit 流式 token → 拼接 assistant segments」。
 *
 * 关闭按钮 = 隐藏窗口（w.hide()），配合 Pet 页 / 托盘的 chat_toggle 再唤出，
 * 这样会话状态在一次运行内保留（不销毁窗口）。
 */

// 简易自增 id（一次运行内唯一即可）
let seq = 1000;
const nextId = () => `local-${seq++}`;

export function ChatWindow() {
  const { theme, toggleTheme } = useTheme();
  const [conversations, setConversations] = useState<Conversation[]>(MOCK_CONVERSATIONS);
  const [activeId, setActiveId] = useState<string | null>(
    MOCK_CONVERSATIONS[0]?.id ?? null,
  );
  const [typing, setTyping] = useState(false);

  // 分组相对日期用的时间基准：随会话增改刷新
  const now = useMemo(() => Date.now(), [conversations]);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const closeToTray = useCallback(() => {
    void getCurrentWindow().hide();
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

  const handleSend = useCallback(
    (text: string) => {
      if (!activeId) return;
      const userMsg: ChatMessage = {
        id: nextId(),
        role: "user",
        ts: Date.now(),
        segments: [{ kind: "text", text }],
      };
      // 先落用户消息，更新会话标题/预览
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                title: c.messages.length === 0 ? text.slice(0, 18) : c.title,
                preview: text,
                updatedAt: userMsg.ts,
                messages: [...c.messages, userMsg],
              }
            : c,
        ),
      );

      // 模拟助手「思考 → 回答」：UI 阶段的占位，后续换成真实流式
      setTyping(true);
      window.setTimeout(() => {
        const reply: ChatMessage = {
          id: nextId(),
          role: "assistant",
          ts: Date.now(),
          segments: [
            {
              kind: "text",
              text: "收到喵～这里之后会接上真正的 AI agent，能读文件、跑命令、操作整台电脑。现在先把界面跑通的说！",
            },
          ],
        };
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeId
              ? {
                  ...c,
                  preview: "收到喵～这里之后会接上真正的 AI agent…",
                  updatedAt: reply.ts,
                  messages: [...c.messages, reply],
                }
              : c,
          ),
        );
        setTyping(false);
      }, 10000);
    },
    [activeId],
  );

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
          now={now}
          theme={theme}
        />
        <Main>
          {active ? (
            <>
              <ConvHeader>
                <ConvTitle>{active.title}</ConvTitle>
                <ConvMeta>
                  {active.messages.length} 条消息 · 可操作整台电脑
                </ConvMeta>
              </ConvHeader>
              <ListArea>
                <MessageList messages={active.messages} typing={typing} />
              </ListArea>
              <ChatComposer onSend={handleSend} disabled={typing} />
            </>
          ) : (
            <NoConv>
              <NoConvFace>(=^･ω･^=)</NoConvFace>
              <NoConvText>选一段历史对话，或者新建一个开始聊天喵～</NoConvText>
            </NoConv>
          )}
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
  background: ${t.colorBg};
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
