import { styled } from "@linaria/react";
import { pixelCorners, t } from "../styles/theme";

/**
 * Deskling 专属基础 UI 组件库（软萌像素风）。
 *
 * 手法要点（去复古 bevel）：
 *  - 矩形四角用 clip-path 切成 3px 像素切角（一点点圆角但保留像素硬边特征）。
 *  - 描边用 padding-box/border-box 双层渐变，让 1px 边沿切角走。
 *  - 深度用 filter: drop-shadow 的柔和投影（跟随切角形状），而非硬阴影/立体边。
 * 字号一律用 t.textXx（CSS `font` 简写，含字号/行高/对应原生字体族）。
 */

/* ---------- 页面骨架 ---------- */

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
  padding: calc(${t.unit} * 4);
  display: flex;
  flex-direction: column;
  gap: calc(${t.unit} * 3);
  border: 1px solid transparent;
  background:
    linear-gradient(${t.colorSurface}, ${t.colorSurface}) padding-box,
    linear-gradient(${t.colorBorder}, ${t.colorBorder}) border-box;
  clip-path: ${pixelCorners};
  filter: drop-shadow(0 4px 10px ${t.colorShadowSoft});
`;

export const PanelTitle = styled.h2`
  margin: 0;
  font: ${t.textMd};
  letter-spacing: 1px;
  color: ${t.colorText};
`;

/** 内嵌容器：凹槽底色 + 柔和内阴影，与凸起面板形成层次 */
export const Well = styled.div`
  padding: calc(${t.unit} * 3);
  font: ${t.textSm};
  color: ${t.colorText};
  border: 1px solid transparent;
  background:
    linear-gradient(${t.colorWell}, ${t.colorWell}) padding-box,
    linear-gradient(${t.colorBorder}, ${t.colorBorder}) border-box;
  clip-path: ${pixelCorners};
  box-shadow: inset 0 2px 4px ${t.colorShadowSoft};
`;

/** 分隔线：一条柔和的浅描边线 */
export const Divider = styled.hr`
  width: 100%;
  height: 0;
  margin: calc(${t.unit} * 2) 0;
  border: 0;
  border-top: 1px solid ${t.colorBorder};
`;

/* ---------- 设置行 ---------- */

export const SettingRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(${t.unit} * 3);

  & + & {
    margin-top: calc(${t.unit} * 3);
    padding-top: calc(${t.unit} * 3);
    border-top: 1px solid ${t.colorBorder};
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
 * 软萌像素按钮：切角矩形 + 双层描边 + 柔影。
 * 悬停轻轻抬起 + 投影变大变亮；按下轻轻下沉。
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
  border: 1px solid transparent;
  background: ${(p) =>
    p.variant === "accent"
      ? `linear-gradient(${t.colorAccent}, ${t.colorAccent}) padding-box,
         linear-gradient(${t.colorAccent}, ${t.colorAccent}) border-box`
      : `linear-gradient(${t.colorControl}, ${t.colorControl}) padding-box,
         linear-gradient(${t.colorBorder}, ${t.colorBorder}) border-box`};
  clip-path: ${pixelCorners};
  filter: drop-shadow(0 2px 4px ${t.colorShadowSoft});
  transition: transform 0.08s ease, filter 0.12s ease, background 0.12s ease;

  &:hover:not(:disabled) {
    color: ${t.colorOnAccent};
    background:
      linear-gradient(${t.colorAccent}, ${t.colorAccent}) padding-box,
      linear-gradient(${t.colorAccent}, ${t.colorAccent}) border-box;
    transform: translateY(-2px);
    filter: drop-shadow(0 5px 10px ${t.colorShadowSoft}) brightness(1.04);
  }

  &:active:not(:disabled) {
    transform: translateY(1px);
    filter: drop-shadow(0 1px 2px ${t.colorShadowSoft});
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
    filter: none;
  }
`;

/* ---------- 进度条：内嵌槽 + 青色填充（切角随槽） ---------- */

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
  border: 1px solid transparent;
  background:
    linear-gradient(${t.colorWell}, ${t.colorWell}) padding-box,
    linear-gradient(${t.colorBorder}, ${t.colorBorder}) border-box;
  clip-path: ${pixelCorners};
  box-shadow: inset 0 2px 4px ${t.colorShadowSoft};
  overflow: hidden;
`;

const ProgressFill = styled.div`
  height: 100%;
  min-width: 4px;
  background: ${t.colorAccent};
  clip-path: ${pixelCorners};
  transition: width 0.2s ease;
`;

/* ---------- 小标签 / 徽标 ---------- */

export const Tag = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px calc(${t.unit} * 2);
  font: ${t.textSm};
  color: ${t.colorText};
  border: 1px solid transparent;
  background:
    linear-gradient(${t.colorControl}, ${t.colorControl}) padding-box,
    linear-gradient(${t.colorBorder}, ${t.colorBorder}) border-box;
  clip-path: ${pixelCorners};
`;

/** “敬请期待”占位徽标 */
export const SoonTag = styled.span`
  font: ${t.textSm};
  color: ${t.colorTextMuted};
  padding: 2px calc(${t.unit} * 2);
  border: 1px dashed ${t.colorBorder};
  clip-path: ${pixelCorners};
`;
