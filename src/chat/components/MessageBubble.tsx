import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "../../components/pixel/PixelFrame";
import { PRIORITY_PAL } from "../../components/pixel/palettes";
import { formatClock, type ChatMessage } from "../types";
import { ToolCallBlock } from "./ToolCallBlock";

/**
 * 一条消息气泡。
 *  - user：右对齐，青色强调气泡（PRIORITY_PAL.primary）；
 *  - assistant：左对齐，带一个像素猫头小头像 + 白面气泡（PRIORITY_PAL.low），
 *    内部按 segments 顺序铺开：文本段 + 工具调用段交替。
 *
 * 气泡底 / 头像底都走 PixelFrame（静态像素帧 + 低噪），与主面板的卡片同款质感——
 * 面像素带随机明暗颗粒，切角由 radius 抠出，不再是平涂 + CSS 圆角。
 */

// ---- 顶层可调常量（与主面板卡片同档）----
const BUBBLE_PIXEL = 3; // 气泡面像素大小
const BUBBLE_RADIUS = 3; // 像素切角格数
const BUBBLE_NOISE = 0.06; // 面像素低噪强度
const BUBBLE_NOISE_GRAN = 2; // 低噪颗粒：N×N 合成一块
const AVATAR_PIXEL = 3; // 头像面像素大小

interface MessageBubbleProps {
  msg: ChatMessage;
}

export function MessageBubble({ msg }: MessageBubbleProps) {
  const isUser = msg.role === "user";
  const pal = isUser ? PRIORITY_PAL.primary : PRIORITY_PAL.low;
  return (
    <Row data-role={msg.role}>
      {!isUser && (
        <Avatar aria-hidden>
          <PixelFrame
            palette={PRIORITY_PAL.normal}
            variant="raised"
            pixel={AVATAR_PIXEL}
            radius={2}
            noise={0.08}
            noiseGranularity={2}
          />
          <Face>(=^･ω･^=)</Face>
        </Avatar>
      )}
      <Column data-role={msg.role}>
        <Bubble>
          <PixelFrame
            palette={pal}
            variant="raised"
            pixel={BUBBLE_PIXEL}
            radius={BUBBLE_RADIUS}
            noise={BUBBLE_NOISE}
            noiseGranularity={BUBBLE_NOISE_GRAN}
            liveResize
          />
          <BubbleInner>
            {msg.segments.map((seg, i) =>
              seg.kind === "text" ? (
                <Text key={i} data-role={msg.role}>
                  {seg.text}
                </Text>
              ) : (
                <ToolCallBlock key={i} seg={seg} />
              ),
            )}
          </BubbleInner>
        </Bubble>
        <Clock>{formatClock(msg.ts)}</Clock>
      </Column>
    </Row>
  );
}

const Row = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;

  &[data-role="user"] {
    flex-direction: row-reverse;
  }
`;

/* 助手头像：像素方框（低噪）+ 颜文字，跟桌宠呼应 */
const Avatar = styled.div`
  position: relative;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  margin-top: 2px;
`;

const Face = styled.span`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 9px;
  line-height: 1;
  color: ${t.colorTextOnBtn};
  white-space: nowrap;
`;

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 76%;
  min-width: 0;

  &[data-role="user"] {
    align-items: flex-end;
  }
`;

/* 气泡外壳：只负责定位 + 柔影；面色/切角/低噪都交给内部 PixelFrame */
const Bubble = styled.div`
  position: relative;
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  filter: drop-shadow(0 2px 6px ${t.colorShadowSoft});
`;

const BubbleInner = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 13px;
  min-width: 0;
`;

const Text = styled.p`
  margin: 0;
  font: ${t.textMd};
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${t.colorText};

  &[data-role="user"] {
    color: ${t.colorTextOnBtnAccent};
  }
`;

const Clock = styled.span`
  font: ${t.textXs};
  color: ${t.colorTextMuted};
  padding: 0 2px;
`;
