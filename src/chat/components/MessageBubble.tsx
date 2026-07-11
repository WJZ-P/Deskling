import { memo, useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { GLPixelFrame } from "../../components/pixel/GLPixelFrame";
import { PRIORITY_PAL } from "../../components/pixel/palettes";
import { formatClock, type ChatMessage } from "../types";
import { ToolCallBlock } from "./ToolCallBlock";
import { ThinkingBlock } from "./ThinkingBlock";
import { StreamingText } from "./StreamingText";
import { MessageToolbar } from "./MessageToolbar";

/**
 * 一条消息气泡。
 *  - user：右对齐，青色强调气泡（PRIORITY_PAL.primary）；
 *  - assistant：左对齐，带一个像素猫头小头像 + 白面气泡（PRIORITY_PAL.low），
 *    内部按 segments 顺序铺开：文本段 + 工具调用段交替。
 *
 * 气泡底 / 头像底都走 PixelFrame（静态像素帧 + 低噪），与主面板的卡片同款质感——
 * 面像素带随机明暗颗粒，切角由 radius 抠出，不再是平涂 + CSS 圆角。
 */

// ---- 顶层可调常量（与主面板卡片同档）----
const BUBBLE_PIXEL = 3; // 气泡面像素大小
const BUBBLE_RADIUS = 3; // 像素切角格数
const BUBBLE_NOISE = 0.06; // 面像素低噪强度
const BUBBLE_NOISE_GRAN = 2; // 低噪颗粒：N×N 合成一块
const AVATAR_PIXEL = 3; // 头像面像素大小

interface MessageBubbleProps {
  msg: ChatMessage;
  /** 这条消息正在流式输出：其「最后一个文本段」逐字蹦入 */
  live?: boolean;
  /** 审批作答：透传给工具段的同意/拒绝按钮 */
  onApproveTool?: (toolCallId: string, approved: boolean) => void;
  /** 编辑消息文本（悬浮工具栏「编辑」→ 内嵌编辑保存后回调） */
  onEdit?: (msgId: string, text: string) => void;
  /** 删除这条消息（悬浮工具栏「删除」） */
  onDelete?: (msgId: string) => void;
}

/** 拼接消息的纯文本（多个文本段之间以空行分隔，工具段跳过）——复制/编辑共用 */
function plainTextOf(msg: ChatMessage): string {
  return msg.segments
    .filter((s): s is Extract<typeof s, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text)
    .join("\n\n");
}

/**
 * memo：流式期间 MessageList 每个 delta 重渲染一次，但只有正在流式的那条消息
 * 拿到新的 msg 对象（append 走不可变更新，未动的消息引用不变）、live 也只有它在变。
 * 其余可视气泡 props 全等 → 整条跳过，delta 的重渲染开销与会话长度无关。
 */
export const MessageBubble = memo(function MessageBubble({
  msg,
  live,
  onApproveTool,
  onEdit,
  onDelete,
}: MessageBubbleProps) {
  const isUser = msg.role === "user";
  const pal = isUser ? PRIORITY_PAL.primary : PRIORITY_PAL.low;
  // 只让「最后一个文本段」逐字蹦入：流式增量总是接在末尾，前面的段早已定稿。
  const lastTextIdx = msg.segments.reduce(
    (acc, seg, i) => (seg.kind === "text" ? i : acc),
    -1,
  );

  // 悬浮工具栏：hover 整行浮现（工具栏挂在气泡下缘，仍是 Row 子树 ——
  // 指针从气泡移到工具栏不触发 pointerleave）。流式中 / 编辑中不显示。
  const [hovered, setHovered] = useState(false);
  // 内嵌编辑：draft 为编辑框草稿（进入编辑时从消息文本初始化）
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(plainTextOf(msg));
    setEditing(true);
  };
  const saveEdit = () => {
    setEditing(false);
    const text = draft.trim();
    if (text && text !== plainTextOf(msg)) onEdit?.(msg.id, text);
  };
  const copyText = () => {
    void navigator.clipboard?.writeText(plainTextOf(msg));
  };

  return (
    <Row
      data-role={msg.role}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {!isUser && (
        <Avatar aria-hidden>
          <GLPixelFrame
            palette={PRIORITY_PAL.normal}
            variant="raised"
            pixel={AVATAR_PIXEL}
            radius={2}
            noise={0.08}
            noiseGranularity={2}
          />
          <Face>(=^･ω･^=)</Face>
        </Avatar>
      )}
      <Column data-role={msg.role}>
        <Bubble>
          <GLPixelFrame
            palette={pal}
            variant="raised"
            pixel={BUBBLE_PIXEL}
            radius={BUBBLE_RADIUS}
            noise={BUBBLE_NOISE}
            noiseGranularity={BUBBLE_NOISE_GRAN}
            liveResize
            animate={live}
          />
          <BubbleInner>
            {editing ? (
              <EditWrap>
                <EditArea
                  autoFocus
                  data-role={msg.role}
                  value={draft}
                  rows={Math.min(10, Math.max(2, draft.split("\n").length))}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditing(false);
                    else if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      saveEdit();
                    }
                  }}
                />
                <EditHint data-role={msg.role}>
                  Enter 保存 · Shift+Enter 换行 · Esc 取消
                </EditHint>
              </EditWrap>
            ) : (
              msg.segments.map((seg, i) =>
                seg.kind === "text" ? (
                  <Text key={i} data-role={msg.role}>
                    <StreamingText
                      text={seg.text}
                      live={live && i === lastTextIdx}
                    />
                  </Text>
                ) : seg.kind === "tool" ? (
                  <ToolCallBlock key={i} seg={seg} onApprove={onApproveTool} />
                ) : (
                  // 思考段：live 消息且位于末段 = reasoning 仍在流入（正文一来
                  // 就会接一个文本段在后面，本段随即不再是末段 → 自动折叠）
                  <ThinkingBlock
                    key={i}
                    seg={seg}
                    streaming={live && i === msg.segments.length - 1}
                  />
                ),
              )
            )}
          </BubbleInner>
          {/* 悬浮工具栏：气泡下缘弹簧弹出（进/退场动画组件内自理） */}
          <MessageToolbar
            visible={hovered && !live && !editing}
            align={isUser ? "end" : "start"}
            onEdit={startEdit}
            onDelete={() => onDelete?.(msg.id)}
            onCopy={copyText}
          />
        </Bubble>
        <Clock>{formatClock(msg.ts)}</Clock>
      </Column>
    </Row>
  );
});

const Row = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;

  &[data-role="user"] {
    flex-direction: row-reverse;
  }
`;

/* 助手头像：像素方框（低噪）+ 颜文字，跟桌宠呼应 */
const Avatar = styled.div`
  position: relative;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  margin-top: 2px;
`;

const Face = styled.span`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
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

/* 气泡外壳：只负责定位 + 柔影；面色/切角/低噪都交给内部 PixelFrame */
const Bubble = styled.div`
  position: relative;
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  filter: drop-shadow(0 2px 6px ${t.colorShadowSoft});
`;

const BubbleInner = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 13px;
  min-width: 0;
`;

const Text = styled.p`
  margin: 0;
  font: ${t.textMd};
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${t.colorText};

  &[data-role="user"] {
    color: ${t.colorTextOnBtnAccent};
  }
`;

const Clock = styled.span`
  font: ${t.textXs};
  color: ${t.colorTextMuted};
  padding: 0 2px;
`;

/* ---- 内嵌编辑态：气泡内直接改文本（气泡框/低噪原样保留）---- */
const EditWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* 撑出一块稳定的编辑宽度：不随草稿字数抖动（上限仍受气泡 max-width 约束） */
  width: min(480px, 62vw);
  max-width: 100%;
`;

const EditArea = styled.textarea`
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  resize: vertical;
  outline: none;
  font: ${t.textMd};
  line-height: 1.7;
  color: ${t.colorText};

  &[data-role="user"] {
    color: ${t.colorTextOnBtnAccent};
  }
`;

/* 快捷键提示：比正文小一档（textSm < 正文 textMd），用深色墨字与气泡底拉开对比 */
const EditHint = styled.div`
  font: ${t.textSm};
  color: ${t.colorTextOnBtn};

  /* 用户气泡是青底：换成青底上的深墨色，不然灰字在青底上看不清 */
  &[data-role="user"] {
    color: ${t.colorTextOnBtnAccent};
  }
`;
