import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "./PixelFrame";
import { PixelButton } from "./PixelButton";
import { PRIORITY_PAL } from "./palettes";

/**
 * 像素风浮窗（模态对话框）。全 pixel：
 *  - 遮罩：半透明黑，点击关闭；淡入动画；
 *  - 面板：PixelFrame（raised + 低噪 + 硬投影）铺底，内容浮在其上；
 *    起手带「上浮 + 微缩放」入场动画（同 PixelSelect 弹层手感）；
 *  - 头部：标题 + 右上像素关闭按钮（✕）；底部可选操作区（footer 插槽）；
 *  - Esc 关闭、body 滚动锁定、Portal 挂到 body（避开祖先层叠/裁剪）。
 *
 * 纯壳组件：开合由父级 open 控制，内容/操作按钮由 children/footer 传入。
 */

// ---- 顶层可调常量 ----
const PANEL_PIXEL = 4; // 面板像素大小
const PANEL_RADIUS = 3; // 像素切角
const PANEL_NOISE = 0.05; // 面板静态低噪
const PANEL_ELEV = 6; // 硬投影高度（浮起感）
const PANEL_MAX_W = 460; // 面板最大宽度 px

interface PixelModalProps {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  /** 底部操作区（如取消/确定按钮组） */
  footer?: ReactNode;
  /** 面板宽度（px），默认 PANEL_MAX_W */
  width?: number;
}

export function PixelModal({ open, title, onClose, children, footer, width }: PixelModalProps) {
  // Esc 关闭 + 锁定 body 滚动（仅 open 时挂）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // 挂载一次后常驻：首次打开才建 PixelFrame/PixelSurface 的网格（慢一次），
  // 之后开关只切 visibility —— 再次打开网格已就绪，瞬间显示，不再卡。
  const mountedRef = useRef(false);
  if (open) mountedRef.current = true;
  if (!mountedRef.current) return null; // 从未打开过 → 不占任何 DOM

  return createPortal(
    <Overlay
      data-open={open || undefined}
      onPointerDown={(e) => {
        // 只在点到遮罩本身（非面板内部）时关闭
        if (open && e.target === e.currentTarget) onClose();
      }}
    >
      <Panel role="dialog" aria-modal="true" data-open={open || undefined} style={{ width: width ?? PANEL_MAX_W }}>
        {/* liveResize：内容条件渲染的浮窗（如记忆详情）关着时面板塌成小尺寸，
            打开瞬间内容填入尺寸突变——不开的话首帧还画着旧尺寸的框，入场动画
            期间边框错位撕裂，重绘完才恢复 */}
        <PixelFrame
          palette={PRIORITY_PAL.low}
          variant="raised"
          pixel={PANEL_PIXEL}
          radius={PANEL_RADIUS}
          noise={PANEL_NOISE}
          noiseGranularity={2}
          elevation={PANEL_ELEV}
          liveResize
        />
        <Inner>
          <Head>
            <Title>{title}</Title>
            <PixelButton compact variant="low" onClick={onClose} aria-label="关闭">
              ✕
            </PixelButton>
          </Head>
          <Content>{children}</Content>
          {footer != null && <Footer>{footer}</Footer>}
        </Inner>
      </Panel>
    </Overlay>,
    document.body,
  );
}

/* 关闭态：visibility:hidden + 不拦事件（DOM 常驻但不可见/不可点）；
   打开态：可见 + 播淡入。动画只在 data-open 时挂，避免关闭时倒放。 */
const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(6, 18, 24, 0.42);
  visibility: hidden;
  pointer-events: none;

  &[data-open] {
    visibility: visible;
    pointer-events: auto;
    animation: pmodal-fade 0.16s ease;
  }

  @keyframes pmodal-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

/* 面板整体不超过 90vh：内容装不下时由 Content 内部滚动消化（头/脚常驻可见） */
const Panel = styled.div`
  position: relative;
  min-width: 0;
  max-width: 100%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  transform-origin: center;

  &[data-open] {
    animation: pmodal-pop 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }

  @keyframes pmodal-pop {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

/* 内容层：浮在 PixelFrame 面板之上；随 Panel 的 90vh 上限收缩 */
const Inner = styled.div`
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 18px 18px;
`;

const Head = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const Title = styled.h2`
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font: ${t.textLg};
  font-weight: bold;
  letter-spacing: 1px;
  color: ${t.colorText};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/* 主体：超高时内部滚动（细滚动条与输入框风格一致），头部/底部操作区不动 */
const Content = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: ${t.colorBorderStrong} transparent;
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 2px;
`;
