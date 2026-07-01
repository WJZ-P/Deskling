import { styled } from "@linaria/react";
import { t } from "../styles/theme";

/**
 * Deskling 专属基础 UI 组件库（像素风：方角、2px 硬边框、硬阴影）。
 * 页面统一从这里取件，保证全站视觉一致；需要新样式时在此扩展。
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
  font-family: ${t.fontPixel};
  font-size: 20px;
  letter-spacing: 2px;
  color: ${t.colorAccent};
`;

export const PageSubtitle = styled.p`
  margin: 0;
  font-size: 12px;
  color: ${t.colorTextMuted};
`;

/* ---------- 面板 / 卡片 ---------- */

export const Panel = styled.section`
  background: ${t.colorSurface};
  border: ${t.borderW} solid ${t.colorBorderStrong};
  box-shadow: 4px 4px 0 ${t.colorShadow};
  padding: calc(${t.unit} * 4);
  display: flex;
  flex-direction: column;
  gap: calc(${t.unit} * 3);
`;

export const PanelTitle = styled.h2`
  margin: 0;
  font-family: ${t.fontPixel};
  font-size: 12px;
  letter-spacing: 1px;
  color: ${t.colorText};
`;

/* ---------- 设置行：左标题/描述，右控件 ---------- */

export const SettingRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(${t.unit} * 3);

  & + & {
    padding-top: calc(${t.unit} * 3);
    border-top: ${t.borderW} solid ${t.colorBorder};
  }
`;

export const SettingInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: calc(${t.unit} / 2);
  min-width: 0;
`;

export const SettingLabel = styled.div`
  font-size: 12px;
  color: ${t.colorText};
`;

export const SettingDesc = styled.p`
  margin: 0;
  font-size: 12px;
  color: ${t.colorTextMuted};
`;

/* ---------- 按钮 ---------- */

/**
 * 像素按钮：硬边框 + 硬阴影，hover 抬起、active 陷入。
 * variant：default（描边）/ accent（强调填充）。
 */
export const Button = styled.button<{ variant?: "default" | "accent" }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${t.unit};
  padding: ${t.unit} calc(${t.unit} * 3);
  cursor: pointer;
  font-family: ${t.fontPixel};
  font-size: 12px;
  color: ${(p) => (p.variant === "accent" ? "#fff" : t.btnIcon)};
  background: ${(p) =>
    p.variant === "accent" ? t.colorAccent : t.colorSurface2};
  border: ${t.borderW} solid ${t.colorBorderStrong};
  border-radius: 0;
  box-shadow: 3px 3px 0 ${t.colorShadow};
  transition: transform 0.05s ease, box-shadow 0.05s ease, background 0.1s ease;

  &:hover:not(:disabled) {
    background: ${t.colorAccent};
    color: #fff;
    transform: translate(-1px, -1px);
    box-shadow: 4px 4px 0 ${t.colorShadow};
  }

  &:active:not(:disabled) {
    transform: translate(3px, 3px);
    box-shadow: 0 0 0 ${t.colorShadow};
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
    box-shadow: 2px 2px 0 ${t.colorShadow};
  }
`;

/* ---------- 小标签 / 徽标 ---------- */

export const Tag = styled.span`
  display: inline-flex;
  align-items: center;
  padding: ${t.unit} calc(${t.unit} * 2);
  font-family: ${t.fontPixel};
  font-size: 12px;
  color: ${t.colorText};
  background: ${t.colorSurface2};
  border: ${t.borderW} solid ${t.colorBorder};
`;

/** “敬请期待”占位徽标 */
export const SoonTag = styled.span`
  font-family: ${t.fontPixel};
  font-size: 12px;
  color: ${t.colorTextMuted};
  padding: 2px calc(${t.unit} * 2);
  border: ${t.borderW} dashed ${t.colorBorder};
`;
