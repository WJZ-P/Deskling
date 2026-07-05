import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type UIEvent,
} from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";

/**
 * 像素风覆盖式滚动区（overlay scrollbar）：
 *  - 隐藏原生滚动条，改用绝对定位的自定义滑块浮在内容上 → 不占布局宽度，
 *    所以启用滚动条不会把内容挤窄（左右间距保持一致，不再有右侧多一条的问题）；
 *  - 滑块位置/高度由 JS 跟随真实 scrollTop/scrollHeight 计算，拖动滑块可滚动；
 *  - 瘦身 + 方角 + 仅 hover/拖动时高亮变色（无描边）。
 *
 * 用法：把可滚动内容塞进来，Root 撑满父级、内部 Viewport 负责实际滚动。
 * contentStyle 透传给 Viewport（页面骨架 PixelPage 用它设 padding/间距/纵向排列）。
 */

// ---- 顶层可调常量 ----
const BAR_W = 6; // 滑块宽度 px（瘦身）
const BAR_INSET_R = 6; // 滑块距右缘的内缩 px（避开窗口外框，值≈外框宽度）
const BAR_MIN_H = 24; // 滑块最小高度 px（内容很长时不至于细成一条）
const BAR_GAP = 3; // 滑块上下留白 px（不顶到容器上下边）

interface PixelScrollAreaProps {
  children?: ReactNode;
  className?: string;
  /** 透传给内部滚动视口的样式（padding / gap / flex 布局等） */
  contentStyle?: CSSProperties;
}

export function PixelScrollArea({ children, className, contentStyle }: PixelScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false); // 拖动中：由 onMove 命令式更新滑块，sync 跳过 React 回路
  const [thumb, setThumb] = useState<{ h: number; top: number; show: boolean }>({
    h: 0,
    top: 0,
    show: false,
  });
  const [active, setActive] = useState(false); // hover 或拖动中 → 高亮

  // 依据视口的 scrollTop/scrollHeight/clientHeight 重算滑块高度与位置
  const sync = useCallback(() => {
    // 拖动期间滑块由 onMove 直接写 DOM（1:1 跟手），跳过 setState 避免 React 回路拖慢/打架
    if (draggingRef.current) return;
    const el = viewportRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 1) {
      setThumb((p) => (p.show ? { ...p, show: false } : p));
      return;
    }
    const trackH = clientHeight - BAR_GAP * 2;
    const h = Math.max(BAR_MIN_H, (clientHeight / scrollHeight) * trackH);
    const maxScroll = scrollHeight - clientHeight;
    const top = BAR_GAP + (maxScroll > 0 ? (scrollTop / maxScroll) * (trackH - h) : 0);
    setThumb({ h, top, show: true });
  }, []);

  useLayoutEffect(() => {
    sync();
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    // 内容高度变化（子节点增删）也要重算
    const mo = new MutationObserver(sync);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [sync]);

  const onScroll = (_e: UIEvent<HTMLDivElement>) => sync();

  // 拖动滑块 → 命令式直接写滑块 transform（1:1 跟手，无段落感）并反推 scrollTop。
  // 期间 draggingRef=true 让 scroll 事件的 sync 跳过 setState，不与命令式更新打架。
  const onThumbPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = viewportRef.current;
    if (!el) return;
    const startY = e.clientY;
    const startTop = thumb.top; // 拖动起点的滑块 top（含 BAR_GAP）
    const { scrollHeight, clientHeight } = el;
    const trackH = clientHeight - BAR_GAP * 2;
    const maxScroll = scrollHeight - clientHeight;
    const range = trackH - thumb.h; // 滑块可移动的像素范围
    draggingRef.current = true;
    setActive(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    const onMove = (me: PointerEvent) => {
      // 目标 top 夹在 [BAR_GAP, BAR_GAP+range]，先动滑块（跟手），再由 top 反推 scrollTop
      const rawTop = startTop + (me.clientY - startY);
      const top = Math.max(BAR_GAP, Math.min(BAR_GAP + range, rawTop));
      const node = thumbRef.current;
      if (node) node.style.transform = `translateY(${top}px)`;
      const ratio = range > 0 ? (top - BAR_GAP) / range : 0;
      el.scrollTop = ratio * maxScroll;
    };
    const onUp = () => {
      draggingRef.current = false;
      setActive(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      sync(); // 松手后对齐 React 状态（top 与最终 scrollTop 一致）
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <Root className={className}>
      <Viewport ref={viewportRef} onScroll={onScroll} style={contentStyle}>
        {children}
      </Viewport>
      {thumb.show && (
        <Thumb
          ref={thumbRef}
          data-active={active || undefined}
          onPointerDown={onThumbPointerDown}
          style={{ height: thumb.h, transform: `translateY(${thumb.top}px)` }}
        />
      )}
    </Root>
  );
}

const Root = styled.div`
  position: relative;
  height: 100%;
  overflow: hidden;
`;

/* 实际滚动视口：铺满 Root，隐藏原生滚动条（改用下面的自定义滑块） */
const Viewport = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;

  /* 隐藏原生滚动条：Firefox */
  scrollbar-width: none;
  /* 隐藏原生滚动条：Chromium/WebView2 */
  &::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
`;

/* 自定义滑块：绝对定位浮在内容上，不占布局宽度；瘦身、方角、仅高亮时变色（无描边） */
const Thumb = styled.div`
  position: absolute;
  right: ${BAR_INSET_R}px;
  top: 0;
  width: ${BAR_W}px;
  background-color: ${t.colorBorderStrong};
  opacity: 0.5;
  cursor: pointer;
  /* 明确过渡 background-color（不用简写 background：其 image/position 等不可动画部分
     会导致颜色瞬间跳变而非平滑过渡）；transform 不过渡（位置跟随滚动，过渡会拖影）。 */
  transition: opacity 0.12s ease, background-color 0.12s ease;
  will-change: transform;

  /* hover 用纯 CSS :hover（即时、不经 React 回路，过渡起点稳定） */
  &:hover {
    background-color: ${t.colorAccent};
    opacity: 1;
  }

  /* 拖动中：优先级更高，鼠标移出滑块也保持高亮 */
  &[data-active] {
    background-color: ${t.colorAccent};
    opacity: 1;
  }
`;
