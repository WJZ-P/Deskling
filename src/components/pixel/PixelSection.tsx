import type { ReactNode } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "./PixelFrame";
import { PRIORITY_PAL, type Priority } from "./palettes";

/**
 * 像素分区容器（Section）：包裹卡片/其他元素的父容器。
 * 纯静态、无动画——基于 PixelFrame 铺底：多重描边 + 高光/暗影 + 像素圆角 + 硬投影。
 * 面色比卡片更「底」一点（浅青），让里面的白色卡片自然浮起来喵～
 *
 * 所有可调项都抽成下面的顶层常量。
 */

// ---- 顶层可调常量 ----
const SECTION_PIXEL = 3; // 像素大小
const SECTION_RADIUS = 2; // 像素切角（比卡片更大更圆润）
const SECTION_PAD = 20; // 内边距 px
const SECTION_GAP = 12; // 标题头与正文间距 px
const SECTION_ELEV = 4; // 硬投影高度 px
const SECTION_NOISE = 0.03; // 静态底噪强度（面像素随机明暗，无动画）
const SECTION_NOISE_GRANULARITY = 2; // 底噪颗粒度：N×N 像素合成一块
const SECTION_EDGE_EROSION = 0.18; // 边缘啃缺概率：沿四边随机抠缺口，形成不规则轮廓（与卡片规整圆角区分）

interface PixelSectionProps {
  /** 分区标题（可选） */
  title?: ReactNode;
  /** 标题右侧尾插槽（可选） */
  trailing?: ReactNode;
  /** 优先级色阶：normal(中间色/默认) · low(白底) · primary(深色) */
  variant?: Priority;
  className?: string;
  children?: ReactNode;
}

export function PixelSection({
  title,
  trailing,
  variant = "normal",
  className,
  children,
}: PixelSectionProps) {
  const hasHeader = title != null || trailing != null;
  return (
    <Section className={className}>
      <PixelFrame
        palette={PRIORITY_PAL[variant]}
        variant="raised"
        pixel={SECTION_PIXEL}
        radius={SECTION_RADIUS}
        noise={SECTION_NOISE}
        noiseGranularity={SECTION_NOISE_GRANULARITY}
        edgeErosion={SECTION_EDGE_EROSION}
        elevation={SECTION_ELEV}
      />
      <Inner>
        {hasHeader && (
          <>
            <Head>
              {title != null && <Title data-variant={variant}>{title}</Title>}
              {trailing != null && <Trailing>{trailing}</Trailing>}
            </Head>
            <Divider />
          </>
        )}
        {children != null && <Body>{children}</Body>}
      </Inner>
    </Section>
  );
}

const Section = styled.section`
  position: relative;
  display: block;
  width: 100%;
`;

const Inner = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: ${SECTION_GAP}px;
  padding: ${SECTION_PAD}px;
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(${t.unit} * 2);
`;

const Title = styled.div`
  font: ${t.textLg};
  letter-spacing: 1px;
  color: ${t.colorText};
  font-weight: bold;

  &[data-variant="primary"] {
    color: ${t.colorTextOnBtnAccent};
  }
`;

const Trailing = styled.div`
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
`;

/* 像素虚线分隔：用 repeating-linear-gradient 画等宽像素点，比纯实线更有点阵味 */
const Divider = styled.div`
  height: 2px;
  margin-top: calc(-1 * ${SECTION_GAP}px + ${t.unit});
  background: repeating-linear-gradient(
    to right,
    ${t.colorBorderStrong} 0,
    ${t.colorBorderStrong} 4px,
    transparent 4px,
    transparent 8px
  );
  opacity: 0.6;
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${SECTION_GAP}px;
`;
