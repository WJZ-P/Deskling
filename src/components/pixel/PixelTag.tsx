import type { ReactNode } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "./PixelFrame";
import { PRIORITY_PAL, type Priority } from "./palettes";

/**
 * 像素小标签 / 占位徽标。
 *  - PixelTag：实心像素描边小标签（PixelFrame 铺底 + 文字），三种优先级色阶；
 *  - PixelSoonTag：「敬请期待」占位徽标，用 flat + 边缘啃缺做出「虚线/未完成」的粗犷感。
 * 均为 inline-flex，可直接放进标题尾插槽 / 行内。
 */

// ---- 顶层可调常量 ----
const TAG_PIXEL = 3; // 每个美术像素占的 CSS px（标签小，取 3 更精细）
const TAG_RADIUS = 0; // 像素切角（书签形右端已够特征，左端保持方角更利落）
const TAG_NOTCH = 3; // 右端书签缺口深度（美术像素格数）：>0 变书签形，右端内凹三角
const TAG_PAD_L = 12; // 左侧水平内边距
const TAG_PAD_R = 18; // 右侧水平内边距（给书签缺口留出空间，避免压字）
const TAG_PAD_Y = 6; // 垂直内边距
const SOON_EROSION = 0.35; // 占位徽标边缘啃缺概率（越大越"破"，暗示未完成）

interface PixelTagProps {
  /** 优先级色阶：normal(浅青/默认) · low(白底) · primary(青) */
  variant?: Priority;
  children?: ReactNode;
  className?: string;
}

export function PixelTag({ variant = "normal", children, className }: PixelTagProps) {
  return (
    <TagWrap className={className} data-variant={variant}>
      <PixelFrame
        palette={PRIORITY_PAL[variant]}
        variant="raised"
        pixel={TAG_PIXEL}
        radius={TAG_RADIUS}
        notch={TAG_NOTCH}
      />
      <TagLabel>{children}</TagLabel>
    </TagWrap>
  );
}

/** 「敬请期待」占位徽标：低调白底 + 边缘啃缺 + 弱化文字，暗示功能未完成 */
export function PixelSoonTag({ children = "敬请期待", className }: { children?: ReactNode; className?: string }) {
  return (
    <SoonWrap className={className}>
      <PixelFrame
        palette={PRIORITY_PAL.low}
        variant="flat"
        pixel={TAG_PIXEL}
        radius={TAG_RADIUS}
        edgeErosion={SOON_EROSION}
      />
      <SoonLabel>{children}</SoonLabel>
    </SoonWrap>
  );
}

const TagWrap = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
`;

const TagLabel = styled.span`
  position: relative;
  z-index: 1;
  /* 右侧多留白：给书签缺口让出空间，文字不被三角压到 */
  padding: ${TAG_PAD_Y}px ${TAG_PAD_R}px ${TAG_PAD_Y}px ${TAG_PAD_L}px;
  font: ${t.textSm};
  letter-spacing: 1px;
  line-height: 1;
  color: ${t.colorTextOnBtn};

  ${TagWrap}[data-variant="primary"] & {
    color: ${t.colorTextOnBtnAccent};
  }
`;

const SoonWrap = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
`;

const SoonLabel = styled.span`
  position: relative;
  z-index: 1;
  padding: ${TAG_PAD_Y}px ${TAG_PAD_L}px;
  font: ${t.textSm};
  letter-spacing: 1px;
  line-height: 1;
  color: ${t.colorTextMuted};
`;
