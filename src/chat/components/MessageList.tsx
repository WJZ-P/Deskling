import { useEffect, useRef } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelScrollArea } from "../../components/pixel/PixelScrollArea";
import type { ChatMessage } from "../types";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";

/**
 * 主对话区滚动列表：逐条渲染气泡；typing=true 时在末尾追加输入指示器。
 * 新消息 / 开始输入时自动滚到底（用一个末尾锚点 scrollIntoView）。
 */

interface MessageListProps {
  messages: ChatMessage[];
  typing?: boolean;
  /** 正在流式输出的那条消息 id：它的末尾文本段逐字蹦入 */
  streamingId?: string | null;
}

export function MessageList({ messages, typing, streamingId }: MessageListProps) {
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    anchorRef.current?.scrollIntoView({ block: "end" });
  }, [messages, typing]);

  return (
    <PixelScrollArea
      contentStyle={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: "20px 22px",
      }}
    >
      {messages.length === 0 && !typing ? (
        <Empty>
          <EmptyFace>(=^･ω･^=)</EmptyFace>
          <EmptyText>新的一段对话，想聊点什么喵～</EmptyText>
        </Empty>
      ) : (
        <>
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} live={m.id === streamingId} />
          ))}
          {typing && <TypingIndicator />}
        </>
      )}
      <Anchor ref={anchorRef} aria-hidden />
    </PixelScrollArea>
  );
}

const Empty = styled.div`
  height: 100%;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
`;

const EmptyFace = styled.div`
  font: ${t.textXl};
  color: ${t.colorAccent};
  letter-spacing: 1px;
`;

const EmptyText = styled.div`
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;

const Anchor = styled.div`
  height: 1px;
`;
