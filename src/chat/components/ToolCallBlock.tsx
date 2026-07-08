import { useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "../../components/pixel/PixelFrame";
import { PRIORITY_PAL } from "../../components/pixel/palettes";
import type { ToolCallSegment } from "../types";

/**
 * 工具调用段：agent 操作电脑的「一步」。
 * 一个内嵌凹槽小卡（PixelFrame sunken + 低噪，与主面板凹槽同风），
 * 左侧状态点 + 工具名（等宽），右侧一句摘要；有 detail 时整行可点开/收起看细节。
 * 配色随状态：进行中(青) / 成功(绿) / 出错(红)。
 */

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
  const hasDetail = seg.detail != null && seg.detail.length > 0;

  return (
    <Root data-status={seg.status}>
      {/* 凹槽底：sunken 像素框 + 低噪，和主面板 Well 一致 */}
      <PixelFrame
        palette={PRIORITY_PAL.low}
        variant="sunken"
        pixel={3}
        radius={2}
        noise={0.05}
        noiseGranularity={2}
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

  &[data-clickable] {
    cursor: pointer;
  }
  &[data-clickable]:hover {
    background-color: ${t.colorAccentSoft};
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
  transition: transform 0.14s ease;

  &[data-open] {
    transform: rotate(180deg);
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
