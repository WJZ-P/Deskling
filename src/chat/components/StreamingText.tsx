import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { styled } from "@linaria/react";

/**
 * 流式文本的「逐字蹦入」渲染。
 *
 * 手感目标：一段增量流回来后，这批字在固定时间窗内错落蹦出——像弹簧一样先冒头、
 * 微微过冲再落定，而不是整段生硬出现。逐 token 流式时每次 batch 常常只有一两个字，
 * 于是几乎即时弹出，连起来就是「带回弹的打字机」，灵动不呆板。
 *
 * 关键点：
 *  - CSS transform 不参与布局 —— 字符盒子挂载即占满最终尺寸，动画只改视觉（缩放/位移/透明度），
 *    所以逐字蹦入不会引起行宽抖动 / 换行跳变；
 *  - 每个字符的入场延迟在「首次出现」时冻结一次（存进 ref map），此后父组件因流式高频
 *    重渲染也不会重算/重播已入场的字（memo 的 Char + useMemo 冻结 style 双保险）；
 *  - 动画整条写在 styled 里（含 @keyframes），延迟只经 CSS 变量 --pop-delay 传入 ——
 *    Linaria 会把 keyframe 名一并 scope，若在内联 style 里写字面名会对不上、动画不触发；
 *  - 只有正在流式输出的那条消息（live）才逐字拆分；历史消息、以及流式收尾一小段时间后，
 *    都回落成整块纯文本，避免长会话里堆积成千上万个 <span>。
 */

// ---- 顶层可调常量 ----
const STAGGER_MS = 250; // 一个 batch 内所有字「铺开蹦出」的总时长窗口
const POP_MS = 300; // 单个字自身的蹦出动画时长
const POP_EASE = "cubic-bezier(.2,.8,.3,1.35)"; // 略过冲→回弹的弹簧感缓动
const COLLAPSE_GRACE_MS = STAGGER_MS + POP_MS + 80; // live 结束后等最后一批走完再收成纯文本

interface StreamingTextProps {
  /** 当前累计文本（流式期间逐次增长） */
  text: string;
  /**
   * 是否为「正在流式输出」的那条消息：
   *  - true  → 从空基线开始，新增字逐个蹦入；
   *  - false → 历史/已收尾，直接整块纯文本（不拆字，省 DOM）。
   */
  live?: boolean;
}

/**
 * 单个字符：挂载时冻结自己的入场延迟（经 CSS 变量），之后不再重算/重播。
 * memo + useMemo([]) 双重冻结，确保父级高频重渲染不会打断已进行的蹦出。
 */
const Char = memo(function Char({ ch, delayMs }: { ch: string; delayMs: number }) {
  const style = useMemo<CSSProperties>(
    () => ({ ["--pop-delay" as string]: `${delayMs}ms` }),
    // 只在挂载时读一次 delayMs：入场延迟一旦定下就不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return <CharSpan style={style}>{ch}</CharSpan>;
});

export const StreamingText = memo(function StreamingText({
  text,
  live,
}: StreamingTextProps) {
  const chars = useMemo(() => Array.from(text), [text]);

  // 是否「曾经 live」：决定要不要走逐字动画（历史消息从头到尾 false）
  const everLiveRef = useRef(!!live);
  if (live) everLiveRef.current = true;

  // 基线：live 从 0 开始（首帧的字也蹦），非 live 以当前长度为基线（全静态）
  const baselineRef = useRef<number | null>(null);
  if (baselineRef.current === null) {
    baselineRef.current = everLiveRef.current ? 0 : chars.length;
  }

  // 每个字符（按绝对下标）的入场延迟，首次出现时冻结
  const delaysRef = useRef<Map<number, number>>(new Map());
  // 已经登记过延迟的长度水位；渲染期读旧值算 batch，提交后由 effect 推进
  const seenRef = useRef(baselineRef.current);

  const prevSeen = seenRef.current;
  if (chars.length > prevSeen) {
    // 这次新增的一批：延迟在 STAGGER_MS 窗口内均匀铺开（batch 越大间隔越密）
    const batchLen = chars.length - prevSeen;
    for (let i = prevSeen; i < chars.length; i += 1) {
      if (!delaysRef.current.has(i)) {
        delaysRef.current.set(i, ((i - prevSeen) / batchLen) * STAGGER_MS);
      }
    }
  }
  useEffect(() => {
    // 提交后推进水位（放 effect 里，StrictMode 双渲染下 batch 计算保持幂等）
    if (chars.length > seenRef.current) seenRef.current = chars.length;
  }, [chars.length]);

  // live 结束后等最后一批动画走完，再把逐字 span 收成整块纯文本（省 DOM）
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (live || !everLiveRef.current || collapsed) return;
    const id = window.setTimeout(() => setCollapsed(true), COLLAPSE_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [live, collapsed]);

  // 历史消息 / 已收尾：整块纯文本，不拆字
  if (!everLiveRef.current || collapsed) {
    return <>{text}</>;
  }

  return (
    <>
      {chars.map((ch, i) => {
        // 换行不能靠 inline-block 承载，单独渲染成断行
        if (ch === "\n") return <br key={i} />;
        const delay = delaysRef.current.get(i);
        // 基线内的字（非 live 情况几乎用不到这条分支）直接实心，不套动画
        return delay === undefined ? (
          <CharSpan key={i} data-static>
            {ch}
          </CharSpan>
        ) : (
          <Char key={i} ch={ch} delayMs={delay} />
        );
      })}
    </>
  );
});

/* 单字盒子：inline-block 才能吃 transform；white-space:pre 保住空格宽度。
   transform 不参与布局，故蹦入不会撑动行宽 / 触发换行跳变。
   动画整条在此定义，延迟经 --pop-delay 注入（默认 0ms）。 */
const CharSpan = styled.span`
  display: inline-block;
  white-space: pre;
  transform-origin: center bottom;
  /* 从下方缩着冒头 → 轻微过冲 → 落定，弹簧感 */
  animation: char-pop ${POP_MS}ms ${POP_EASE} var(--pop-delay, 0ms) both;

  @keyframes char-pop {
    0% {
      opacity: 0;
      transform: translateY(0.45em) scale(0.62);
    }
    62% {
      opacity: 1;
      transform: translateY(-0.1em) scale(1.06);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* 基线字符：不入场动画，直接实心 */
  &[data-static] {
    animation: none;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none !important;
  }
`;
