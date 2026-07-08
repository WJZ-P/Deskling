import type { ReactNode, KeyboardEvent, MouseEvent } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "./PixelFrame";
import { PRIORITY_PAL } from "./palettes";

/**
 * 像素图标按钮（区别于文字 PixelButton 的独立小组件）。
 *  - hover 时浮现一块真正的 PixelFrame（raised + 低噪 + 硬投影）当底 ——
 *    这才是它的「像素 border」，反馈是「浮起一块像素板」而非靠图标变色；
 *  - 默认态（edit）hover 不变图标色（避免和卡片底色撞、看不清），全靠浮起的像素框；
 *    danger 态（delete）hover 图标转红，红在白框上很显眼；
 *  - onActivate 统一收敛点击与键盘（Enter/Space），并 stopPropagation ——
 *    方便嵌在可点击的卡片里，点图标不触发卡片自身的 onClick。
 *
 * 图标由 children 传入（见 icons.tsx 的内联 SVG），用 currentColor 描色。
 */

interface PixelIconButtonProps {
  children: ReactNode;
  onActivate: () => void;
  "aria-label": string;
  /** 语义色调：default（hover 不变色，靠像素框）/ danger（hover 图标转红） */
  tone?: "default" | "danger";
  /** 边长（CSS px），默认 30 */
  size?: number;
  className?: string;
}

export function PixelIconButton({
  children,
  onActivate,
  "aria-label": ariaLabel,
  tone = "default",
  size = 30,
  className,
}: PixelIconButtonProps) {
  const fire = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    onActivate();
  };
  return (
    <Btn
      type="button"
      aria-label={ariaLabel}
      data-tone={tone}
      className={className}
      style={{ width: size, height: size }}
      onClick={fire}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fire(e);
        }
      }}
    >
      {/* hover 浮现的像素框底：给它真正的像素描边 + 抬起感（默认透明，不占视觉） */}
      <FrameLayer aria-hidden>
        <PixelFrame
          palette={PRIORITY_PAL.low}
          variant="raised"
          pixel={3}
          radius={2}
          noise={0.05}
          noiseGranularity={2}
          elevation={2}
        />
      </FrameLayer>
      <Glyph aria-hidden>{children}</Glyph>
    </Btn>
  );
}

const Btn = styled.button`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: ${t.colorText};
  cursor: pointer;
  transition: color 0.12s ease, transform 0.12s ease;

  &:active {
    transform: scale(0.94);
  }
  /* danger：hover 图标转红（红在白像素框上很显眼） */
  &[data-tone="danger"]:hover {
    color: ${t.btnClose};
  }
`;

/* 像素框底层：默认透明、缩一点，hover 淡入 + 归位 —— 浮现一块像素板的反馈 */
const FrameLayer = styled.span`
  position: absolute;
  inset: 0;
  opacity: 0;
  transform: scale(0.8);
  transition: opacity 0.12s ease, transform 0.12s cubic-bezier(0.2, 0.9, 0.3, 1.3);
  pointer-events: none;

  ${Btn}:hover & {
    opacity: 1;
    transform: scale(1);
  }
`;

/* 图标载体：撑成按钮的约 60%，浮在像素框之上；svg 用 currentColor 上色 */
const Glyph = styled.span`
  position: relative;
  z-index: 1;
  display: inline-flex;
  width: 58%;
  height: 58%;

  & > svg {
    width: 100%;
    height: 100%;
    fill: currentColor;
  }
`;
