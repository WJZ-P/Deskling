import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { styled } from "@linaria/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { t } from "../../styles/theme";
import { PixelScrollArea } from "../../components/pixel/PixelScrollArea";
import {
  PixelSurface,
  type SurfaceState,
  type SurfaceTune,
} from "../../components/pixel/PixelSurface";
import { PRIORITY_PAL } from "../../components/pixel/palettes";
import { ChevronDownIcon } from "../../components/pixel/icons";
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
const JUMP_SHOW_DIST = 120; // 距底 >此值 才浮现「滚到底部」按钮（离底一小段不打扰）

// 滚底按钮手感：沿用标题栏小图标按钮的弹簧参数（更小、投影更浅）
const JUMP_TUNE: Partial<SurfaceTune> = {
  hoverTy: -1,
  pressTy: 1,
  elevRest: 1,
  elevHover: 2,
  elevPress: 1,
  flickerAmp: 0.06,
};

/** 滚底按钮边长 px；像素圆 = radius 抠到边长一半（格数 = BTN/2/pixel） */
const JUMP_BTN = 36;
const JUMP_PIXEL = 3;
const JUMP_RADIUS = JUMP_BTN / 2 / JUMP_PIXEL -3; // 6 格 → 整颗像素圆

/**
 * 悬浮「滚到底部」按钮：用户上滚离底后浮现在输入框上方，点击回底并恢复流式跟随。
 * 像素圆造型（PixelSurface radius 抠满半径的阶梯圆弧，非 CSS 平滑圆）。
 * 进/退场都有动画：visible 转 false 时不立即卸载，先播 jump-out（下滑淡出），
 * animationend 再真正移除 —— 挂载/卸载由本组件内部的 render 状态兜底。
 */
function JumpToBottom({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  const [render, setRender] = useState(visible);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    if (visible) setRender(true); // 复现时立即挂载（jump-in 动画自动播放）
  }, [visible]);
  if (!render) return null;
  const state: SurfaceState = pressed ? "press" : hovered ? "hover" : "rest";
  return (
    <JumpWrap
      type="button"
      aria-label="滚到底部"
      data-out={!visible || undefined}
      onAnimationEnd={() => {
        if (!visible) setRender(false); // 退场动画播完才卸载
      }}
      onClick={onClick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
    >
      <PixelSurface
        palette={PRIORITY_PAL.normal}
        state={state}
        pixel={JUMP_PIXEL}
        radius={JUMP_RADIUS}
        noise={0.08}
        tune={JUMP_TUNE}
        rootStyle={{ display: "flex" }}
        contentStyle={{
          width: JUMP_BTN,
          height: JUMP_BTN,
          padding: 0,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ChevronDownIcon width={20} height={20} />
      </PixelSurface>
    </JumpWrap>
  );
}

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
  const [away, setAway] = useState(false); // 离底较远：浮现「滚到底部」按钮

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
  //
  // ⚠️ 只靠 scroll 事件不够：scroll 事件是异步派发的，流式输出高频重渲时，
  // 用户刚上滑、scroll 事件还没来得及把 atBottomRef 置 false，下一个 chunk 的
  // 钉底 effect 就抢先把 scrollTop 写回底部，把用户的滚动吞掉（表现为「滚不上去」）。
  // 所以补一个同步信号：wheel 事件在滚动生效前同步触发，向上滚立刻解除贴底。
  useEffect(() => {
    const el = scrollEl;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      atBottomRef.current = dist < STICK_EPS;
      setAway(dist > JUMP_SHOW_DIST); // 同值 setState 会被 React 跳过，无重渲开销
    };
    const onWheel = (e: WheelEvent) => {
      // 内容根本滚不动时忽略（否则会在短内容上误关贴底，之后长出来不跟随）
      if (e.deltaY >= 0 || el.scrollHeight - el.clientHeight <= 1) return;
      atBottomRef.current = false;
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
    };
  }, [scrollEl]);

  // 切换会话：强制视为贴底并钉到底（聊天从底往上读，进来就停在最新）
  const prevConvRef = useRef(convId);
  useLayoutEffect(() => {
    if (prevConvRef.current !== convId) {
      prevConvRef.current = convId;
      atBottomRef.current = true;
      setAway(false); // 切会话强制回底，按钮一并收起
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

  // 点「滚到底部」：钉底 + 恢复贴底跟随（流式输出继续吸底），按钮即刻收起
  const jumpToBottom = useCallback(() => {
    const el = scrollEl;
    if (!el) return;
    atBottomRef.current = true;
    el.scrollTop = el.scrollHeight;
    setAway(false);
  }, [scrollEl]);

  const items = virtualizer.getVirtualItems();

  return (
    <Wrap>
      <PixelScrollArea
        scrollRef={setScrollEl}
        contentStyle={{ padding: `0 ${PAD_X}px` }}
        // 拖滑块 = 用户接管滚动：立刻解除贴底（拖到底部时 scroll 事件会重新判回贴底）
        onUserScrollIntent={() => {
          atBottomRef.current = false;
        }}
      >
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
      <JumpToBottom visible={away} onClick={jumpToBottom} />
    </Wrap>
  );
}

/* 外层定位容器：给悬浮「滚到底部」按钮当锚点，滚动仍全权交给内部 PixelScrollArea */
const Wrap = styled.div`
  position: relative;
  height: 100%;
`;

/* 悬浮按钮外壳：钉在列表底部中央（正好在输入框上方），浮现时带上滑淡入 */
const JumpWrap = styled.button`
  position: absolute;
  left: 50%;
  bottom: 14px;
  z-index: 5;
  display: inline-flex;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  color: ${t.colorTextOnBtn};
  transform: translateX(-50%);
  animation: jump-in 0.16s ease;

  /* 退场：下滑淡出，forwards 停在终态（组件等 animationend 才卸载） */
  &[data-out] {
    animation: jump-out 0.16s ease forwards;
    pointer-events: none;
  }

  @keyframes jump-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  @keyframes jump-out {
    from {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    to {
      opacity: 0;
      transform: translateX(-50%) translateY(8px);
    }
  }
`;

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
