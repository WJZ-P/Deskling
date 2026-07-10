import { useEffect, useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "../../components/pixel/PixelFrame";
import { PRIORITY_PAL } from "../../components/pixel/palettes";
import {
  EditSquareIcon,
  DeleteIcon,
  CopyIcon,
} from "../../components/pixel/icons";

/**
 * 消息悬浮工具栏：hover 气泡时从气泡下方弹簧弹出的一排操作（编辑 / 删除 / 复制）。
 *
 *  - 底板是一块 raised 白面像素板（PixelFrame 低噪，与图标按钮 hover 板同款质感），
 *    三颗图标按钮浮在板上：hover 变色 + 轻抬，删除 hover 转红；
 *  - 进/退场都有动画（弹簧弹入 → 上缩淡出）：visible 转 false 时不立即卸载，
 *    先播 bar-out，animationend 再真正移除 —— 与 MessageList 的滚底按钮同款
 *    render 状态兜底模式；
 *  - 复制成功后图标短暂转强调色作反馈（1.2s 自动复位；工具栏隐藏即随卸载重置）；
 *  - 绝对定位在气泡下缘（父级 Bubble 是 relative），align 决定贴左还是贴右
 *    （assistant 左对齐 / user 右对齐），弹簧的 transform-origin 也随之切换。
 */

interface MessageToolbarProps {
  visible: boolean;
  /** start=贴气泡左缘（助手） / end=贴右缘（用户） */
  align: "start" | "end";
  onEdit: () => void;
  onDelete: () => void;
  /** 执行复制（文本拼接由气泡侧提供）；成功反馈由本组件自理 */
  onCopy: () => void;
}

export function MessageToolbar({
  visible,
  align,
  onEdit,
  onDelete,
  onCopy,
}: MessageToolbarProps) {
  const [render, setRender] = useState(visible);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (visible) setRender(true); // 复现时立即挂载（bar-in 自动播放）
  }, [visible]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  if (!render) return null;

  return (
    <BarWrap
      data-align={align}
      data-out={!visible || undefined}
      onAnimationEnd={(e) => {
        // 只认自己的 bar-out（按钮上的 transition 不派发 animationend，双保险仍判 target）
        if (!visible && e.target === e.currentTarget) setRender(false);
      }}
    >
      <PixelFrame
        palette={PRIORITY_PAL.low}
        variant="raised"
        pixel={3}
        radius={2}
        noise={0.05}
        noiseGranularity={2}
        elevation={2}
      />
      <Btns>
        <ToolBtn type="button" title="编辑" aria-label="编辑" onClick={onEdit}>
          <EditSquareIcon />
        </ToolBtn>
        <ToolBtn
          type="button"
          title="删除"
          aria-label="删除"
          data-tone="danger"
          onClick={onDelete}
        >
          <DeleteIcon />
        </ToolBtn>
        <ToolBtn
          type="button"
          title={copied ? "已复制" : "复制"}
          aria-label="复制"
          data-done={copied || undefined}
          onClick={() => {
            onCopy();
            setCopied(true);
          }}
        >
          <CopyIcon />
        </ToolBtn>
      </Btns>
    </BarWrap>
  );
}

/* 底板外壳：钉在气泡下缘，弹簧弹入（过冲回弹）/ 上缩淡出 */
const BarWrap = styled.div`
  position: absolute;
  top: calc(100% + 2px);
  z-index: 6;
  display: inline-flex;
  animation: bar-in 0.24s ease both;

  &[data-align="start"] {
    left: 0;
    transform-origin: top left;
  }
  &[data-align="end"] {
    right: 0;
    transform-origin: top right;
  }

  /* 退场：缩回气泡方向淡出，forwards 停在终态（等 animationend 才卸载） */
  &[data-out] {
    animation: bar-out 0.14s ease forwards;
    pointer-events: none;
  }

  /* 弹簧感靠关键帧里的过冲（60% 处放大越位再回落），非线性曲线 */
  @keyframes bar-in {
    0% {
      opacity: 0;
      transform: translateY(-6px) scale(0.72);
    }
    60% {
      opacity: 1;
      transform: translateY(1px) scale(1.05);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes bar-out {
    to {
      opacity: 0;
      transform: translateY(-5px) scale(0.82);
    }
  }
`;

/* 按钮排：浮在像素底板之上 */
const Btns = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 4px;
`;

/* 单颗图标按钮：hover 变色 + 轻抬，按下缩一下；删除 hover 转红、复制成功转强调色 */
const ToolBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  background: transparent;
  color: ${t.colorTextOnBtn};
  cursor: pointer;
  transition: color 0.12s ease, transform 0.12s ease;

  &:hover {
    color: ${t.colorTextOnBtnAccent};
    transform: translateY(-1px);
  }
  &:active {
    transform: scale(0.92);
  }
  &[data-tone="danger"]:hover {
    color: ${t.btnClose};
  }
  &[data-done] {
    color: ${t.colorAccent};
  }

  & > svg {
    width: 16px;
    height: 16px;
  }
`;
