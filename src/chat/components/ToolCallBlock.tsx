import { useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame, type PixelPalette } from "../../components/pixel/PixelFrame";
import { PRIORITY_PAL } from "../../components/pixel/palettes";
import type { ToolCallSegment } from "../types";

/**
 * 工具调用段：agent 操作电脑的「一步」。
 * 一个内嵌凹槽小卡（PixelFrame sunken + 低噪，与主面板凹槽同风），
 * 左侧状态点 + 工具名（等宽），右侧一句摘要；有 detail 时整行可点开/收起看细节。
 * 配色随状态：进行中(青) / 成功(绿) / 出错(红)。
 *
 * hover 或展开时：底色变青蓝、低噪动起来，传达「这一步活了」。
 */

// hover/展开态的扫描目标面色：柔和青蓝（比按钮 primary 更浅，适合大面积凹槽底）。
// 只用 face —— palette 本身始终保持 rest（PRIORITY_PAL.low），描边/斜线不变色，
// 故不会冒出违和白边；颜色变化只发生在铺满面区的噪声块上，由状态机从两边扫向中心。
const SWEEP_PAL: PixelPalette = {
  face: "#cdeced",
  edge: "#7dbfc1",
  hi: "#ffffff",
  lo: "#a8dadc",
};

interface ToolCallBlockProps {
  seg: ToolCallSegment;
}

const STATUS_LABEL: Record<ToolCallSegment["status"], string> = {
  running: "执行中",
  success: "完成",
  error: "失败",
};

export function ToolCallBlock({ seg }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hasDetail = seg.detail != null && seg.detail.length > 0;
  // hover 或展开都激活：底色变青蓝、低噪动起来
  const active = hovered || open;

  return (
    <Root
      data-status={seg.status}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {/* 凹槽底：palette 始终 rest，sweepPalette+sweepActive 驱动状态机从两边扫向中心 */}
      <PixelFrame
        palette={PRIORITY_PAL.low}
        variant="sunken"
        pixel={3}
        radius={2}
        noise={0.05}
        noiseGranularity={2}
        noiseSpeed={active ? 0.9 : 0}
        sweepPalette={SWEEP_PAL}
        sweepActive={active}
        liveResize
      />
      <Inner>
        <Head
          as={hasDetail ? "button" : "div"}
          data-clickable={hasDetail || undefined}
          onClick={hasDetail ? () => setOpen((v) => !v) : undefined}
        >
          <Dot data-status={seg.status} aria-hidden />
          <ToolName>{seg.name}</ToolName>
          <Summary>{seg.summary}</Summary>
          <Status data-status={seg.status}>{STATUS_LABEL[seg.status]}</Status>
          {hasDetail && <Chevron data-open={open || undefined} aria-hidden>▾</Chevron>}
        </Head>
        {hasDetail && open && <Detail>{seg.detail}</Detail>}
      </Inner>
    </Root>
  );
}

const Root = styled.div`
  position: relative;
`;

const Inner = styled.div`
  position: relative;
  z-index: 1;
`;

const Head = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  background: transparent;
  text-align: left;
  color: ${t.colorText};
  font: ${t.textSm};

  /* 左侧像素口音条：hover 时浮出，替代平涂背景 */
  &::before {
    content: "";
    position: absolute;
    left: 0;
    top: 3px;
    bottom: 3px;
    width: 2px;
    background: transparent;
    transition: background-color 0.12s ease;
  }

  &[data-clickable] {
    cursor: pointer;
  }
  &[data-clickable]:hover::before {
    background: ${t.colorAccent};
  }
`;

/* 状态点：进行中会呼吸闪烁 */
const Dot = styled.span`
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  background: ${t.colorAccent};

  &[data-status="success"] {
    background: ${t.btnMax};
  }
  &[data-status="error"] {
    background: ${t.btnClose};
  }
  &[data-status="running"] {
    animation: tool-pulse 1s ease-in-out infinite;
  }

  @keyframes tool-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const ToolName = styled.code`
  flex: 0 0 auto;
  font-family: ${t.fontPixel}, ui-monospace, monospace;
  font-size: 12px;
  letter-spacing: 0.5px;
  color: ${t.colorAccent};
  transition: filter 0.12s ease;

  ${Head}[data-clickable]:hover & {
    filter: brightness(1.25);
  }
`;

const Summary = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${t.colorTextMuted};
`;

const Status = styled.span`
  flex: 0 0 auto;
  font: ${t.textXs};
  letter-spacing: 1px;
  color: ${t.colorTextMuted};

  &[data-status="success"] {
    color: ${t.btnMax};
  }
  &[data-status="error"] {
    color: ${t.btnClose};
  }
  &[data-status="running"] {
    color: ${t.colorAccent};
  }
`;

const Chevron = styled.span`
  flex: 0 0 auto;
  font-size: 10px;
  color: ${t.colorTextMuted};
  transition: transform 0.14s ease, color 0.12s ease;

  &[data-open] {
    transform: rotate(180deg);
  }

  ${Head}[data-clickable]:hover & {
    color: ${t.colorAccent};
  }
`;

const Detail = styled.pre`
  margin: 0;
  padding: 8px 10px 10px 26px;
  border-top: 1px solid ${t.colorBorder};
  font-family: ${t.fontPixel}, ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.6;
  color: ${t.colorTextMuted};
  white-space: pre-wrap;
  word-break: break-word;
`;
