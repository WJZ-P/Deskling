import { useEffect, useRef, useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "../../components/pixel/PixelFrame";
import { PRIORITY_PAL } from "../../components/pixel/palettes";
import { UnfoldMoreIcon } from "../../components/pixel/icons";
import type { ThinkingSegment } from "../types";

/**
 * 思考段：推理模型（DeepSeek R1 等）的 reasoning 过程。
 * 与 ToolCallBlock 同款内嵌凹槽像素小卡（PixelFrame sunken + 低噪）：
 *  - 默认是一个「三行小窗」：只露最新三行，思考增量流入时自动滚底更新，
 *    像终端 tail 一样始终贴着最新内容；
 *  - 头行右侧一颗 unfold 展开按钮：点开全文回看，再点收回三行小窗；
 *  - 流式中状态点呼吸、低噪流动（「脑子在转」），定稿后落成安静的灰。
 */

// 折叠态最多露出的行数
const CLAMP_LINES = 3;

interface ThinkingBlockProps {
  seg: ThinkingSegment;
  /** 思考仍在流入（live 消息且本段是末段）：呼吸点 + 低噪流动 + 滚底跟随 */
  streaming?: boolean;
}

export function ThinkingBlock({ seg, streaming }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 三行小窗滚底跟随：思考增量到达（或从展开收回）时贴到最新一行。
  // 展开态显示全文、无溢出，跳过即可。
  useEffect(() => {
    if (expanded) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [seg.text, expanded]);

  return (
    <Root>
      <PixelFrame
        palette={PRIORITY_PAL.low}
        variant="sunken"
        pixel={3}
        radius={2}
        noise={0.05}
        noiseGranularity={2}
        noiseSpeed={streaming ? 0.9 : 0}
        liveResize
      />
      <Inner>
        <Head>
          <Dot data-streaming={streaming || undefined} aria-hidden />
          <Label>{streaming ? "思考中…" : "已深度思考"}</Label>
          <ExpandBtn
            type="button"
            title={expanded ? "收起" : "展开"}
            aria-label={expanded ? "收起思考过程" : "展开思考过程"}
            data-expanded={expanded || undefined}
            onClick={() => setExpanded((v) => !v)}
          >
            <UnfoldMoreIcon />
          </ExpandBtn>
        </Head>
        <Body ref={bodyRef} data-expanded={expanded || undefined}>
          {seg.text}
        </Body>
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
  padding: 6px 6px 0 10px;
  font: ${t.textSm};
`;

/* 状态点：思考流入中青色呼吸；定稿后落成安静的灰 */
const Dot = styled.span`
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  background: ${t.colorTextMuted};

  &[data-streaming] {
    background: ${t.colorAccent};
    animation: think-pulse 1.2s ease-in-out infinite;
  }

  @keyframes think-pulse {
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

const Label = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  letter-spacing: 1px;
  color: ${t.colorTextMuted};
`;

/* 展开按钮：unfold 双箭头，hover 变色 + 轻抬，按下缩一下；展开态常亮强调色 */
const ExpandBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
  color: ${t.colorTextMuted};
  cursor: pointer;
  transition: color 0.12s ease, transform 0.12s ease;

  &:hover {
    color: ${t.colorTextOnBtnAccent};
    transform: translateY(-1px);
  }
  &:active {
    transform: scale(0.92);
  }
  &[data-expanded] {
    color: ${t.colorAccent};
  }

  & > svg {
    width: 14px;
    height: 14px;
  }
`;

/*
 * 思考正文：比正文小一档的灰字，pre-wrap 原样换行。
 * 折叠态是三行小窗（max-height = 行数 × 行高 + 上下内边距，border-box 一并算入），
 * overflow 隐藏、由 effect 程序化滚底；展开态放开高度显示全文。
 */
const Body = styled.div`
  padding: 6px 10px 9px 20px;
  font: ${t.textSm};
  line-height: 1.7;
  color: ${t.colorTextMuted};
  white-space: pre-wrap;
  word-break: break-word;
  max-height: calc(1.7em * ${CLAMP_LINES} + 15px);
  overflow: hidden;

  &[data-expanded] {
    max-height: none;
  }
`;
