import type { ReactNode } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "./PixelFrame";
import { PX } from "./palettes";

/**
 * 像素凹陷内嵌区（Well）：sunken 的 PixelFrame 铺底（高光在下、暗影在上，显"凹陷"），
 * 适合放数值 / 说明 / 代码，与凸起的卡片/分区形成层次。对应旧 ui.tsx 的 Well。
 */

// ---- 顶层可调常量 ----
const WELL_PIXEL = 3; // 每个美术像素占的 CSS px
const WELL_RADIUS = 2; // 像素切角
const WELL_PAD = 12; // 内边距

interface PixelWellProps {
  children?: ReactNode;
  className?: string;
}

export function PixelWell({ children, className }: PixelWellProps) {
  return (
    <Well className={className}>
      <PixelFrame palette={PX.well} variant="sunken" pixel={WELL_PIXEL} radius={WELL_RADIUS} />
      <WellInner>{children}</WellInner>
    </Well>
  );
}

const Well = styled.div`
  position: relative;
  display: block;
  width: 100%;
`;

const WellInner = styled.div`
  position: relative;
  z-index: 1;
  padding: ${WELL_PAD}px;
  font: ${t.textSm};
  line-height: 1.7;
  color: ${t.colorText};
`;
