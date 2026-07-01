import { styled } from "@linaria/react";
import { bevel, t } from "../styles/theme";

/**
 * Deskling 专属基础 UI 组件库（像素风）。
 *
 * 精致化要点：不再是「单一 border + 投影」，而是用立体斜角边（bevel）——
 * 1px 深色外框 + 左上高光 + 右下暗影的分层 inset 阴影，做出凸起/凹陷层次（见 theme.ts 的 bevel）。
 * 字号一律用 t.textXx（CSS `font` 简写，含字号/行高/对应原生字体族）。
 */

/* ---------- 页面骨架 ---------- */

/** 单个页面的滚动容器：内边距 + 纵向排布 */
export const Page = styled.div`
  height: 100%;
  overflow-y: auto;
  padding: calc(${t.unit} * 5) calc(${t.unit} * 6);
  display: flex;
  flex-direction: column;
  gap: calc(${t.unit} * 4);
`;

export const PageHeader = styled.header`
  display: flex;
  flex-direction: column;
  gap: ${t.unit};
`;

export const PageTitle = styled.h1`
  margin: 0;
  font: ${t.textXl};
  letter-spacing: 2px;
  color: ${t.colorAccent};
`;

export const PageSubtitle = styled.p`
  margin: 0;
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;

/* ---------- 面板 / 卡片 ---------- */

export const Panel = styled.section`
  background: ${t.colorSurface};
  border: 1px solid ${t.colorBorderStrong};
  box-shadow: ${bevel.raised}, 4px 4px 0 ${t.colorShadow};
  padding: calc(${t.unit} * 4);
  display: flex;
  flex-direction: column;
  gap: calc(${t.unit} * 3);
`;

export const PanelTitle = styled.h2`
  margin: 0;
  font: ${t.textMd};
  letter-spacing: 1px;
  color: ${t.colorText};
`;

/** 凹陷容器：内嵌显示区（如数值、说明、代码），与凸起的 Panel 形成对比 */
export const Well = styled.div`
  background: ${t.colorWell};
  border: 1px solid ${t.colorBorderStrong};
  box-shadow: ${bevel.sunken};
  padding: calc(${t.unit} * 3);
  font: ${t.textSm};
  color: ${t.colorText};
`;

/** 雕刻式分隔线：上暗下亮两色调，像被“刻”进面板 */
export const Divider = styled.hr`
  width: 100%;
  height: 0;
  margin: calc(${t.unit} * 2) 0;
  border: 0;
  border-top: 1px solid ${t.colorBevelLo};
  border-bottom: 1px solid ${t.colorBevelHi};
`;

/* ---------- 设置行：左标题/描述，右控件 ---------- */

export const SettingRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(${t.unit} * 3);

  & + & {
    margin-top: calc(${t.unit} * 3);
    padding-top: calc(${t.unit} * 3);
    border-top: 1px solid ${t.colorBevelLo};
    box-shadow: inset 0 1px 0 ${t.colorBevelHi};
  }
`;

export const SettingInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: calc(${t.unit} / 2);
  min-width: 0;
`;

export const SettingLabel = styled.div`
  font: ${t.textMd};
  color: ${t.colorText};
`;

export const SettingDesc = styled.p`
  margin: 0;
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;

/* ---------- 按钮 ---------- */

/**
 * 像素按钮：静止凸起（raised），按下凹陷（sunken），有真实的“按进去”触感。
 * variant：default（控件面）/ accent（强调填充）。
 */
export const Button = styled.button<{ variant?: "default" | "accent" }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${t.unit};
  padding: calc(${t.unit} * 1.5) calc(${t.unit} * 3);
  cursor: pointer;
  font: ${t.textMd};
  color: ${(p) => (p.variant === "accent" ? t.colorOnAccent : t.btnIcon)};
  background: ${(p) =>
    p.variant === "accent" ? t.colorAccent : t.colorControl};
  border: 1px solid ${t.colorBorderStrong};
  border-radius: 0;
  box-shadow: ${bevel.raised}, 2px 2px 0 ${t.colorShadow};
  transition: transform 0.04s ease, box-shadow 0.04s ease, background 0.1s ease;

  &:hover:not(:disabled) {
    background: ${t.colorAccent};
    color: ${t.colorOnAccent};
    transform: translate(-1px, -1px);
    box-shadow: ${bevel.raised}, 3px 3px 0 ${t.colorShadow};
  }

  &:active:not(:disabled) {
    transform: translate(1px, 1px);
    box-shadow: ${bevel.sunken};
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
    box-shadow: ${bevel.raised}, 2px 2px 0 ${t.colorShadow};
  }
`;

/* ---------- 进度条：凹槽内嵌 + 凸起填充（照 Aseprite 立体条） ---------- */

interface ProgressBarProps {
  /** 0–100 */
  value: number;
}

export function ProgressBar({ value }: ProgressBarProps) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <ProgressTrack
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <ProgressFill style={{ width: `${v}%` }} />
    </ProgressTrack>
  );
}

const ProgressTrack = styled.div`
  height: calc(${t.unit} * 5);
  padding: 2px;
  background: ${t.colorWell};
  border: 1px solid ${t.colorBorderStrong};
  box-shadow: ${bevel.sunken};
  overflow: hidden;
`;

const ProgressFill = styled.div`
  height: 100%;
  min-width: 2px;
  background: ${t.colorAccent};
  border: 1px solid ${t.colorBorderStrong};
  box-shadow: ${bevel.raised};
  transition: width 0.2s ease;
`;

/* ---------- 小标签 / 徽标 ---------- */

export const Tag = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px calc(${t.unit} * 2);
  font: ${t.textSm};
  color: ${t.colorText};
  background: ${t.colorControl};
  border: 1px solid ${t.colorBorder};
  box-shadow: ${bevel.raised};
`;

/** “敬请期待”占位徽标 */
export const SoonTag = styled.span`
  font: ${t.textSm};
  color: ${t.colorTextMuted};
  padding: 2px calc(${t.unit} * 2);
  border: 1px dashed ${t.colorBorder};
`;
