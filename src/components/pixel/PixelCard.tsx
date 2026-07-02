import { useState, type ReactNode } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelSurface, type SurfaceState, type SurfaceTune } from "./PixelSurface";
import { PRIORITY_PAL, type Priority } from "./palettes";

/**
 * 像素卡片：复用按钮的 PixelSurface 引擎渲染。
 *  - 所有卡片都带「低噪」：面像素叠加随机灰度，不再是死板纯色；
 *  - 静态卡片停在 rest 态（引擎绘制一帧后自动停机，省电）；
 *  - 可交互卡片 hover 时启用「btn 那一套」动态低噪 —— 但速度更慢、颗粒更大。
 *
 * 所有可调项都抽成下面的顶层常量，主人改这里即可喵～
 */

// ---- 顶层可调常量（主人改这里即可喵）----
const CARD_PIXEL = 5; // 像素大小：每个美术像素占的 CSS px（比按钮 4 更大更粗）
const CARD_RADIUS = 3; // 像素切角大小
const CARD_PAD = 16; // 内容内边距 px
const CARD_GAP = 8; // 标题头与正文的间距 px

// ---- 低噪参数（可单独定制喵）----
const CARD_NOISE_STATIC = 0.05; // 静态低噪强度：面像素随机明暗（rest 也在）
const CARD_NOISE_GRANULARITY = 3; // 低噪颗粒度：N×N 像素合成一块噪声（越大越粗块，独立于像素大小）
const CARD_NOISE_HOVER_AMP = 0.1; // hover 动态低噪「变动幅度」（0=关闭动态低噪）
const CARD_NOISE_HOVER_DELAY = 0.9; // hover 动态低噪「重掷间隔/delay」秒（越大越慢越错落）

/** 卡片专用动画调参：关正弦呼吸、改用动态低噪；hover 轻抬升，不做按压反转 */
const CARD_TUNE: Partial<SurfaceTune> = {
  flickerAmp: 0, // 关闭老式正弦呼吸，hover 低噪改由下面的动态低噪承担
  noiseGranularity: CARD_NOISE_GRANULARITY,
  noiseHoverAmp: CARD_NOISE_HOVER_AMP,
  noiseHoverDelay: CARD_NOISE_HOVER_DELAY,
  hoverLiftRole: [0.1, 0.08, 0.08, 0.03], // hover 提亮更含蓄
  pressLiftRole: [0, 0, 0, 0], // 卡片不做按压
  delayMax: 0.2, // border 点亮错落更松散，配合大颗粒
  hoverTy: -2, // hover 轻抬升
  pressTy: 0,
  elevRest: 3,
  elevHover: 4,
  elevPress: 4,
  liftMs: 240, // 抬升过渡更缓
};

interface PixelCardProps {
  /** 标题（可选） */
  title?: ReactNode;
  /** 标题右侧尾插槽（可选，如标签/数值） */
  trailing?: ReactNode;
  /** 优先级色阶：normal(中间色/默认) · low(白底) · primary(深色) */
  variant?: Priority;
  /** 可交互：hover 启用动态低噪 + 轻抬升 */
  interactive?: boolean;
  className?: string;
  children?: ReactNode;
}

export function PixelCard({
  title,
  trailing,
  variant = "normal",
  interactive = false,
  className,
  children,
}: PixelCardProps) {
  const [hovered, setHovered] = useState(false);
  const state: SurfaceState = interactive && hovered ? "hover" : "rest";
  const hasHeader = title != null || trailing != null;

  return (
    <Card
      className={className}
      data-interactive={interactive}
      onPointerEnter={interactive ? () => setHovered(true) : undefined}
      onPointerLeave={interactive ? () => setHovered(false) : undefined}
    >
      <PixelSurface
        palette={PRIORITY_PAL[variant]}
        state={state}
        pixel={CARD_PIXEL}
        radius={CARD_RADIUS}
        noise={CARD_NOISE_STATIC}
        tune={CARD_TUNE}
        rootStyle={{ display: "flex", width: "100%" }}
        contentStyle={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          justifyContent: "flex-start",
          width: "100%",
          gap: CARD_GAP,
          padding: CARD_PAD,
        }}
      >
        {hasHeader && (
          <Header>
            {title != null && <Title data-variant={variant}>{title}</Title>}
            {trailing != null && <Trailing>{trailing}</Trailing>}
          </Header>
        )}
        {children != null && <Body data-variant={variant}>{children}</Body>}
      </PixelSurface>
    </Card>
  );
}

const Card = styled.div`
  position: relative;
  display: flex;
  min-width: 160px;

  &[data-interactive="true"] {
    cursor: pointer;
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(${t.unit} * 2);
`;

const Title = styled.div`
  font: ${t.textMd};
  letter-spacing: 1px;
  color: ${t.colorText};

  &[data-variant="primary"] {
    color: ${t.colorTextOnBtnAccent};
  }
`;

const Trailing = styled.div`
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
`;

const Body = styled.div`
  font: ${t.textSm};
  line-height: 1.7;
  color: ${t.colorTextMuted};

  &[data-variant="primary"] {
    color: ${t.colorTextOnBtnAccent};
  }
`;
