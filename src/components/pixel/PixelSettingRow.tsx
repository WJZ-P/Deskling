import { styled } from "@linaria/react";
import { t } from "../../styles/theme";

/**
 * 设置行家族：左侧信息（标签 + 描述）+ 右侧控件，两端对齐。
 * 相邻两行之间自动出现一条像素虚线分隔（点阵味，比实线更有像素感）。
 * 对应旧 ui.tsx 的 SettingRow / SettingInfo / SettingLabel / SettingDesc。
 *
 * 用法：把多个 PixelSettingRow 包进 PixelSettingList —— 它 gap:0，保证行紧贴堆叠，
 * 分隔线（& + &::before 画在行顶边）才能正好落在两行中间、内容垂直居中。
 * 直接把行丢进带 gap 的父容器（如 PixelSection 的 Body）会撑开行距、破坏居中，故用此容器隔离。
 */

/** 设置行列表容器：gap:0 紧贴堆叠，隔离父容器的 gap，保证分隔线与居中正确 */
export const PixelSettingList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0;
`;

// ---- 顶层可调常量 ----
const ROW_GAP = 12; // 左右两块间距 px
const ROW_PAD_Y = 10; // 上下内边距 px（对称，保证内容在两条分隔线之间垂直居中）
const SEP_DASH = 4; // 分隔虚线实心段 px
const SEP_GAP = 4; // 分隔虚线间隔 px

/**
 * 一行设置项：上下对称 padding + align-items:center → 内容稳稳居中在自己这条带里。
 * 相邻两行之间用 ::before 伪元素画一条像素虚线分隔（画在行顶边，故仅出现在行与行之间，首行不画）。
 * 「两条分隔线之间 = 一整行的盒子」，内容天然垂直居中（不再靠上）。
 */
export const PixelSettingRow = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${ROW_GAP}px;
  padding: ${ROW_PAD_Y}px 0;

  /* 相邻行之间的像素虚线分隔：画在当前行顶边（首行无上一个兄弟，故不出现） */
  & + &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: repeating-linear-gradient(
      to right,
      ${t.colorBorderStrong} 0,
      ${t.colorBorderStrong} ${SEP_DASH}px,
      transparent ${SEP_DASH}px,
      transparent ${SEP_DASH + SEP_GAP}px
    );
    opacity: 0.6;
  }
`;

/** 左侧信息块：标签 + 描述纵向排列 */
export const PixelSettingInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: calc(${t.unit} / 2);
  min-width: 0;
`;

/** 设置项标签 */
export const PixelSettingLabel = styled.div`
  font: ${t.textMd};
  color: ${t.colorText};
`;

/** 设置项描述（弱化小字） */
export const PixelSettingDesc = styled.p`
  margin: 0;
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;
