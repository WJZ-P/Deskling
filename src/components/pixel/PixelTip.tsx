import { useEffect, useRef, useState, type ReactNode } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "./PixelFrame";
import { PRIORITY_PAL } from "./palettes";

/**
 * 像素风 tooltip：接管原生 title —— 悬停片刻后在锚点上方弹出白面像素小签
 * （低噪白底，与消息悬浮工具栏/浮窗同一族质感）。
 *  - 延迟出现（扫过不闪），进/退场都有动画：visible 转 false 先播退场，
 *    animationend 再真正卸载 —— 与消息悬浮工具栏同款 render 状态兜底模式；
 *  - 纯展示：pointer-events 关闭，不参与命中，不影响锚点自身交互；
 *  - tip 内容变化时原地热更（开关类按钮点完提示词立刻跟着变）。
 * 用法：<PixelTip tip="说明文字"><PixelButton … /></PixelTip>
 */

const SHOW_DELAY_MS = 260; // 悬停多久后出现（原生 title 约 500ms，略快一点）

export function PixelTip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [render, setRender] = useState(false);
  const timer = useRef<number | null>(null);

  const clearTimer = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => clearTimer, []);

  return (
    <Anchor
      onPointerEnter={() => {
        clearTimer();
        timer.current = window.setTimeout(() => {
          setVisible(true);
          setRender(true);
        }, SHOW_DELAY_MS);
      }}
      onPointerLeave={() => {
        clearTimer();
        setVisible(false);
      }}
    >
      {children}
      {render && (
        <Tip
          data-out={!visible || undefined}
          onAnimationEnd={(e) => {
            if (!visible && e.target === e.currentTarget) setRender(false);
          }}
        >
          <PixelFrame
            palette={PRIORITY_PAL.low}
            variant="raised"
            pixel={2}
            radius={1}
            noise={0.06}
            noiseGranularity={2}
            elevation={2}
          />
          <TipLabel>{tip}</TipLabel>
        </Tip>
      )}
    </Anchor>
  );
}

const Anchor = styled.span`
  position: relative;
  display: inline-flex;
`;

/* 小签：钉在锚点上缘偏左，向上弹出 / 向下缩回。
   左对齐而非居中——锚点常贴容器左缘（如输入框功能行），居中会探出窗口 */
const Tip = styled.span`
  position: absolute;
  bottom: calc(100% + 7px);
  left: 0;
  z-index: 30;
  display: inline-flex;
  white-space: nowrap;
  pointer-events: none;
  transform-origin: bottom left;
  animation: pixel-tip-in 0.18s ease both;

  &[data-out] {
    animation: pixel-tip-out 0.12s ease forwards;
  }

  /* 轻微过冲的弹簧感，与消息悬浮工具栏同手感 */
  @keyframes pixel-tip-in {
    0% {
      opacity: 0;
      transform: translateY(4px) scale(0.92);
    }
    65% {
      opacity: 1;
      transform: translateY(-1px) scale(1.02);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes pixel-tip-out {
    to {
      opacity: 0;
      transform: translateY(3px) scale(0.92);
    }
  }
`;

const TipLabel = styled.span`
  position: relative;
  z-index: 1;
  padding: 4px 9px;
  font: ${t.textSm};
  /* font 简写会重置字重，其后补回 bold */
  font-weight: bold;
  letter-spacing: 0.5px;
  color: ${t.colorTextOnBtn};
`;
