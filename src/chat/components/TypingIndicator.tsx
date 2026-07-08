import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "../../components/pixel/PixelFrame";
import { PRIORITY_PAL } from "../../components/pixel/palettes";

/**
 * 「对方正在输入」指示器：助手气泡位置上的三个错相位跳动像素点。
 * 流式回复还没吐第一个 token 时占位，手感上告诉主人「在想了喵」。
 * 头像/气泡底与 MessageBubble 的 assistant 同款（PixelFrame + 低噪）。
 */
export function TypingIndicator() {
  return (
    <Row aria-label="正在输入">
      <Avatar aria-hidden>
        <PixelFrame
          palette={PRIORITY_PAL.normal}
          variant="raised"
          pixel={3}
          radius={2}
          noise={0.08}
          noiseGranularity={2}
        />
        <Face>(=^･ω･^=)</Face>
      </Avatar>
      <Bubble>
        <PixelFrame
          palette={PRIORITY_PAL.low}
          variant="raised"
          pixel={4}
          radius={3}
          noise={0.06}
          noiseGranularity={2}
        />
        <Dots>
          <Dot style={{ animationDelay: "0s" }} />
          <Dot style={{ animationDelay: "0.16s" }} />
          <Dot style={{ animationDelay: "0.32s" }} />
        </Dots>
      </Bubble>
    </Row>
  );
}

const Row = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
`;

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

const Bubble = styled.div`
  position: relative;
  display: inline-flex;
  filter: drop-shadow(0 2px 6px ${t.colorShadowSoft});
`;

const Dots = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 13px 14px;
`;

const Dot = styled.span`
  width: 6px;
  height: 6px;
  background: ${t.colorAccent};
  animation: typing-bounce 0.9s ease-in-out infinite;

  @keyframes typing-bounce {
    0%,
    60%,
    100% {
      transform: translateY(0);
      opacity: 0.5;
    }
    30% {
      transform: translateY(-4px);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
