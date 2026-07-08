import { styled } from "@linaria/react";
import { t, pixelCorners } from "../../styles/theme";
import { formatClock, type ChatMessage } from "../types";
import { ToolCallBlock } from "./ToolCallBlock";

/**
 * 一条消息气泡。
 *  - user：右对齐，青色强调气泡；
 *  - assistant：左对齐，带一个像素猫头小头像 + 白/浅面气泡，
 *    内部按 segments 顺序铺开：文本段 + 工具调用段交替。
 */

interface MessageBubbleProps {
  msg: ChatMessage;
}

export function MessageBubble({ msg }: MessageBubbleProps) {
  const isUser = msg.role === "user";
  return (
    <Row data-role={msg.role}>
      {!isUser && (
        <Avatar aria-hidden>
          <Face>(=^･ω･^=)</Face>
        </Avatar>
      )}
      <Column data-role={msg.role}>
        <Bubble data-role={msg.role}>
          {msg.segments.map((seg, i) =>
            seg.kind === "text" ? (
              <Text key={i} data-role={msg.role}>
                {seg.text}
              </Text>
            ) : (
              <ToolCallBlock key={i} seg={seg} />
            ),
          )}
        </Bubble>
        <Clock>{formatClock(msg.ts)}</Clock>
      </Column>
    </Row>
  );
}

const Row = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;

  &[data-role="user"] {
    flex-direction: row-reverse;
  }
`;

/* 助手头像：小方框 + 颜文字，跟桌宠呼应 */
const Avatar = styled.div`
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  background:
    linear-gradient(${t.colorControl}, ${t.colorControl}) padding-box,
    linear-gradient(${t.colorBorderStrong}, ${t.colorBorderStrong}) border-box;
  clip-path: ${pixelCorners};
  margin-top: 2px;
`;

const Face = styled.span`
  font-size: 9px;
  line-height: 1;
  color: ${t.colorTextOnBtn};
  white-space: nowrap;
`;

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 76%;
  min-width: 0;

  &[data-role="user"] {
    align-items: flex-end;
  }
`;

const Bubble = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 13px;
  border: 1px solid transparent;
  clip-path: ${pixelCorners};

  /* assistant：浅面 + 柔边 + 柔影 */
  &[data-role="assistant"] {
    background:
      linear-gradient(${t.colorSurface}, ${t.colorSurface}) padding-box,
      linear-gradient(${t.colorBorder}, ${t.colorBorder}) border-box;
    filter: drop-shadow(0 2px 6px ${t.colorShadowSoft});
  }
  /* user：青色强调气泡 */
  &[data-role="user"] {
    background:
      linear-gradient(${t.colorAccent}, ${t.colorAccent}) padding-box,
      linear-gradient(${t.colorAccent}, ${t.colorAccent}) border-box;
    filter: drop-shadow(0 2px 6px ${t.colorShadowSoft});
  }
`;

const Text = styled.p`
  margin: 0;
  font: ${t.textMd};
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${t.colorText};

  &[data-role="user"] {
    color: ${t.colorOnAccent};
  }
`;

const Clock = styled.span`
  font: ${t.textXs};
  color: ${t.colorTextMuted};
  padding: 0 2px;
`;
