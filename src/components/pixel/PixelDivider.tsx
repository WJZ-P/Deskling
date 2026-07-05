import { styled } from "@linaria/react";
import { t } from "../../styles/theme";

/**
 * 像素虚线分隔：用 repeating-linear-gradient 画等宽像素点，比纯实线更有点阵味。
 * 从 PixelSection 内部那条私有分隔线抽出来公用。对应旧 ui.tsx 的 Divider。
 */

// ---- 顶层可调常量 ----
const DASH = 4; // 实心段长度 px
const GAP = 4; // 间隔长度 px

export const PixelDivider = styled.hr`
  width: 100%;
  height: 2px;
  margin: calc(${t.unit} * 2) 0;
  border: 0;
  background: repeating-linear-gradient(
    to right,
    ${t.colorBorderStrong} 0,
    ${t.colorBorderStrong} ${DASH}px,
    transparent ${DASH}px,
    transparent ${DASH + GAP}px
  );
  opacity: 0.6;
`;
