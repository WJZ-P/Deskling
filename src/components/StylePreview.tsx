import { styled } from "@linaria/react";
import type { CSSProperties } from "react";
import { t } from "../styles/theme";

/**
 * 自包含的「风格预览器」：用一组局部 CSS 变量（--pv-*）驱动同一套迷你 app 窗口，
 * 从而在不改动全局主题的前提下，并排对比多种 UI 风格。全程使用像素字体。
 */
export type PvVars = Record<`--pv-${string}`, string>;

interface StylePreviewProps {
  vars: PvVars;
}

export function StylePreview({ vars }: StylePreviewProps) {
  return (
    <Frame style={vars as CSSProperties}>
      <Bar>
        <Brand>
          <span>🐾</span>
          <span>Deskling</span>
        </Brand>
        <Dots>
          <Dot />
          <Dot />
          <Dot />
        </Dots>
      </Bar>

      <Body>
        <Card>
          <Title>桌宠状态</Title>
          <Muted>待命中 · 随时准备陪主人喵～</Muted>
          <Track>
            <Fill />
          </Track>
          <Btns>
            <BtnPrimary type="button">召唤</BtnPrimary>
            <BtnGhost type="button">设置</BtnGhost>
          </Btns>
        </Card>
      </Body>
    </Frame>
  );
}

const Frame = styled.div`
  background: var(--pv-bg);
  border: 1px solid var(--pv-outline);
  border-radius: var(--pv-radius);
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--pv-chrome);
  border-bottom: 1px solid var(--pv-outline);
`;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font: ${t.textSm};
  color: var(--pv-text);
`;

const Dots = styled.div`
  display: flex;
  gap: 5px;
`;

const Dot = styled.span`
  width: 9px;
  height: 9px;
  border-radius: var(--pv-dot);
  background: var(--pv-accent);
  opacity: 0.7;
`;

const Body = styled.div`
  padding: 14px;
`;

const Card = styled.div`
  background: var(--pv-surface);
  border: 1px solid var(--pv-outline);
  border-radius: var(--pv-radius);
  box-shadow: var(--pv-card-shadow);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Title = styled.div`
  font: ${t.textMd};
  letter-spacing: 1px;
  color: var(--pv-accent);
`;

const Muted = styled.div`
  font: ${t.textSm};
  color: var(--pv-muted);
`;

const Track = styled.div`
  height: 16px;
  padding: 2px;
  background: var(--pv-well);
  border: 1px solid var(--pv-outline);
  border-radius: var(--pv-radius);
  box-shadow: var(--pv-well-shadow);
  overflow: hidden;
`;

const Fill = styled.div`
  height: 100%;
  width: 62%;
  background: var(--pv-accent);
  border-radius: var(--pv-fill-radius);
  box-shadow: var(--pv-fill-shadow);
`;

const Btns = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

const BtnBase = styled.button`
  font: ${t.textSm};
  padding: 6px 14px;
  cursor: pointer;
  border: 1px solid var(--pv-outline);
  border-radius: var(--pv-radius);
  transition: transform 0.06s ease, filter 0.1s ease;

  &:hover {
    filter: brightness(1.06);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(1px);
  }
`;

const BtnPrimary = styled(BtnBase)`
  color: var(--pv-on-accent);
  background: var(--pv-accent);
  box-shadow: var(--pv-btn-shadow);

  &:active {
    box-shadow: var(--pv-btn-active-shadow);
  }
`;

const BtnGhost = styled(BtnBase)`
  color: var(--pv-text);
  background: var(--pv-surface);
  box-shadow: var(--pv-ghost-shadow);
`;
