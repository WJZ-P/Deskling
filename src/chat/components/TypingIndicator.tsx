import { styled } from "@linaria/react";
import { t, pixelCorners } from "../../styles/theme";

/**
 * 「对方正在输入」指示器：助手气泡位置上的三个错相位跳动像素点。
 * 流式回复还没吐第一个 token 时占位，手感上告诉主人「在想了喵」。
 */
export function TypingIndicator() {
  return (
    <Row aria-label="正在输入">
      <Avatar aria-hidden>
        <Face>(=^･ω･^=)</Face>
      </Avatar>
      <Bubble>
        <Dot style={{ animationDelay: "0s" }} />
        <Dot style={{ animationDelay: "0.16s" }} />
        <Dot style={{ animationDelay: "0.32s" }} />
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
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  background:
    linear-gradient(${t.colorControl}, ${t.colorControl}) padding-box,
    linear-gradient(${t.colorBorderStrong}, ${t.colorBorderStrong}) border-box;
  clip-path: ${pixelCorners};
  margin-top: 2px;
`;

const Face = styled.span`
  font-size: 9px;
  line-height: 1;
  color: ${t.colorTextOnBtn};
  white-space: nowrap;
`;

const Bubble = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 13px 14px;
  border: 1px solid transparent;
  background:
    linear-gradient(${t.colorSurface}, ${t.colorSurface}) padding-box,
    linear-gradient(${t.colorBorder}, ${t.colorBorder}) border-box;
  clip-path: ${pixelCorners};
  filter: drop-shadow(0 2px 6px ${t.colorShadowSoft});
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
