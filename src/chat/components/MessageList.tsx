import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { styled } from "@linaria/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { t } from "../../styles/theme";
import { PixelScrollArea } from "../../components/pixel/PixelScrollArea";
import type { ChatMessage } from "../types";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";

/**
 * 主对话区滚动列表：虚拟化渲染。
 *
 * 为什么虚拟化：一条气泡即便已被 GLPixelFrame 塌成 1 个 canvas 节点，几百条
 * 常驻 DOM 时滚动仍要对全部 bubble 做 layout。虚拟列表让 DOM 里只留「可视区 +
 * overscan」，DOM 节点数与滚动开销与会话长度无关，恒定。
 *
 * 三个聊天场景要点：
 *  - 变高：气泡高度随文本/工具调用剧烈变化，用 measureElement 动态实测每条真高
 *    并缓存（getItemKey 用消息 id，追加/重渲不失效）；
 *  - 流式吸底：流式那条边生成边长高 → totalSize 变 → 贴底 effect 重新钉到底；
 *  - 切换归底：换会话强制回到底部（聊天从底往上读）。
 *
 * 纵向 padding / 条间距交给 virtualizer 的 paddingStart/paddingEnd/gap 统一算，
 * 横向 padding 仍留在滚动视口上（contentStyle）。
 */

const GAP = 18; // 条间距 px
const PAD_Y = 20; // 列表上下留白 px（交给 virtualizer，算进 start/总高）
const PAD_X = 22; // 列表左右留白 px（留在视口上）
const ESTIMATE = 90; // 单条气泡估高 px；实测后由 measureElement 校正
const OVERSCAN = 6; // 可视区上下各多挂几条，滚动时不露白
const STICK_EPS = 24; // 距底 <此值 视为「贴底」，容忍 1px 抖动与分数像素

interface MessageListProps {
  messages: ChatMessage[];
  typing?: boolean;
  /** 正在流式输出的那条消息 id：它的末尾文本段逐字蹦入 */
  streamingId?: string | null;
  /** 当前会话 id：切换时强制回到底部 */
  convId?: string | null;
  /** 审批作答：放行/拒绝一次 pending 的工具调用（透传到 ToolCallBlock 按钮） */
  onApproveTool?: (toolCallId: string, approved: boolean) => void;
}

export function MessageList({
  messages,
  typing,
  streamingId,
  convId,
  onApproveTool,
}: MessageListProps) {
  // 真实滚动视口节点由 PixelScrollArea 通过 scrollRef 回传；拿到后 virtualizer 才能挂
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const total = messages.length;
  const atBottomRef = useRef(true); // 用户当前是否贴在底部（决定要不要跟随流式增长）

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollEl,
    estimateSize: () => ESTIMATE,
    overscan: OVERSCAN,
    gap: GAP,
    paddingStart: PAD_Y,
    paddingEnd: PAD_Y,
    // 用数组下标当 key：聊天列表只在末尾追加、从不重排，下标既唯一又稳定
    // （追加不改动已有下标，流式那条靠 resize 重测高）。
    // 不能用 messages[i].id：老数据里存在重复 id（旧版 nextId 计数器每次重启归零，
    // 跨多次运行发出的 id 会互撞），拿来当 key 会导致 React key 冲突 → 同一条气泡叠出多份。
    getItemKey: (i) => i,
  });

  // 跟踪是否贴底：滚动时更新。阈值放宽到 STICK_EPS，避免分数像素误判「离底」。
  useEffect(() => {
    const el = scrollEl;
    if (!el) return;
    const onScroll = () => {
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_EPS;
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollEl]);

  // 切换会话：强制视为贴底并钉到底（聊天从底往上读，进来就停在最新）
  const prevConvRef = useRef(convId);
  useLayoutEffect(() => {
    if (prevConvRef.current !== convId) {
      prevConvRef.current = convId;
      atBottomRef.current = true;
    }
    const el = scrollEl;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [convId, scrollEl]);

  // 贴底跟随：消息增删 / typing / 流式续写都会改变总高 —— 若用户在底部就重新钉底。
  // totalSize 随 measureElement 校正而变（流式那条边生成边测高），故能逐帧跟住。
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    const el = scrollEl;
    if (!el) return;
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [totalSize, typing, scrollEl, messages]);

  const items = virtualizer.getVirtualItems();

  return (
    <PixelScrollArea scrollRef={setScrollEl} contentStyle={{ padding: `0 ${PAD_X}px` }}>
      {total === 0 && !typing ? (
        <Empty>
          <EmptyFace>(=^･ω･^=)</EmptyFace>
          <EmptyText>新的一段对话，想聊点什么喵～</EmptyText>
        </Empty>
      ) : (
        <Sizer style={{ height: totalSize }}>
          {items
            .filter((vi) => messages[vi.index])
            .map((vi) => {
              const m = messages[vi.index]!;
              return (
                <ItemWrap
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <MessageBubble
                    msg={m}
                    live={m.id === streamingId}
                    onApproveTool={onApproveTool}
                  />
                </ItemWrap>
              );
            })}
        </Sizer>
      )}
      {typing && (
        <TypingBelow>
          <TypingIndicator />
        </TypingBelow>
      )}
    </PixelScrollArea>
  );
}

/* 虚拟列表撑高盒：显式高度=totalSize，子项绝对定位靠 translateY 放到各自 start */
const Sizer = styled.div`
  position: relative;
  width: 100%;
`;

/* 单条容器：绝对定位铺满内容宽（左右对齐由 MessageBubble 内部 Row 决定），
   高度由内容自然撑开并被 measureElement 实测；条间距由 virtualizer 的 gap 算进 start */
const ItemWrap = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
`;

/* 输入指示器：跟在撑高盒之后的常规流，其高度自然加进 scrollHeight，贴底跟随能算到 */
const TypingBelow = styled.div`
  padding-bottom: ${PAD_Y}px;
`;

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
