import { useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame, type PixelPalette } from "../../components/pixel/PixelFrame";
import { PixelButton } from "../../components/pixel/PixelButton";
import { PRIORITY_PAL } from "../../components/pixel/palettes";
import type { ToolCallSegment } from "../types";

/**
 * 工具调用段：agent 操作电脑的「一步」。
 * 一个内嵌凹槽小卡（PixelFrame sunken + 低噪，与主面板凹槽同风），
 * 左侧状态点 + 工具名（等宽），右侧一句摘要；有 detail 时整行可点开/收起看细节。
 * 配色随状态：待审批(琥珀) / 进行中(青) / 成功(绿) / 出错(红)。
 *
 * pending（写/命令类危险工具，Rust 侧 loop 阻塞等审批）：
 * 卡片默认展开参数预览——审批前必须能看到要执行什么；底部出现「同意 / 拒绝」
 * 按钮行，作答经 onApprove 上抛（ChatWindow → provider_tool_approve 唤醒 loop）。
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
  /** 审批作答：pending 段「同意 / 拒绝」按钮上抛（不传则按钮不渲染） */
  onApprove?: (toolCallId: string, approved: boolean) => void;
}

const STATUS_LABEL: Record<ToolCallSegment["status"], string> = {
  pending: "待审批",
  running: "执行中",
  success: "完成",
  error: "失败",
};

/** 把参数 JSON 串排版成可读预览（对象美化缩进；空对象/解析失败回落原串） */
function formatArgs(args?: string): string | undefined {
  if (!args) return undefined;
  try {
    const pretty = JSON.stringify(JSON.parse(args), null, 2);
    return pretty === "{}" ? undefined : pretty;
  } catch {
    return args;
  }
}

export function ToolCallBlock({ seg, onApprove }: ToolCallBlockProps) {
  // 待审批的段挂载即展开：审批前必须能看到参数（要执行的命令 / 要写的内容）
  const [open, setOpen] = useState(seg.status === "pending");
  const [hovered, setHovered] = useState(false);
  // 展开区内容：定稿后是执行结果 detail；未定稿（pending/running）时先给参数预览
  const detailText =
    seg.detail && seg.detail.length > 0 ? seg.detail : formatArgs(seg.args);
  const hasDetail = detailText != null && detailText.length > 0;
  const awaiting = seg.status === "pending" && !!seg.needsApproval && !!onApprove;
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
        {hasDetail && open && <Detail>{detailText}</Detail>}
        {awaiting && (
          <ApproveRow>
            <ApproveHint>agent 想执行这一步，放行吗？</ApproveHint>
            <PixelButton
              compact
              variant="primary"
              onClick={() => onApprove(seg.id, true)}
            >
              同意
            </PixelButton>
            <PixelButton compact variant="low" onClick={() => onApprove(seg.id, false)}>
              拒绝
            </PixelButton>
          </ApproveRow>
        )}
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

/* 状态点：待审批(琥珀,慢呼吸) / 进行中(青,呼吸) 都会闪烁 */
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
  &[data-status="pending"] {
    background: ${t.btnMin};
    animation: tool-pulse 1.6s ease-in-out infinite;
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
  &[data-status="pending"] {
    color: ${t.btnMin};
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

/* 审批按钮行：提示语靠左，按钮靠右；只在 pending 且需审批时渲染 */
const ApproveRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 9px;
  border-top: 1px solid ${t.colorBorder};
`;

const ApproveHint = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  font: ${t.textXs};
  color: ${t.colorTextMuted};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
