import type { ReactNode } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelScrollArea } from "./PixelScrollArea";

/**
 * 页面骨架 & 排版件（结构为主、无强像素视觉，但字体/间距统一走 token）。
 * 对应旧 ui.tsx 的 Page / PageHeader / PageTitle / PageSubtitle / PanelTitle。
 *
 *  - PixelPage：可滚动的页容器（撑满主区、纵向排列、统一留白）；
 *  - PixelPageHeader / Title / Subtitle：页头三件套；
 *  - PixelPanelTitle：分区内的小标题（像素字体描粗）。
 */

/**
 * 页容器：撑满主区、纵向排列、统一留白，滚动交给像素风覆盖式滚动条 PixelScrollArea。
 * 用覆盖式滚动条（不占布局宽度）→ 左右留白始终一致，不会因出现滚动条而右侧多缩一条。
 */
export function PixelPage({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <PixelScrollArea
      className={className}
      contentStyle={{
        display: "flex",
        flexDirection: "column",
        gap: `calc(${t.unit} * 4)`,
        padding: `calc(${t.unit} * 5) calc(${t.unit} * 6)`,
      }}
    >
      {children}
    </PixelScrollArea>
  );
}

/** 页头：标题 + 副标题的纵向容器 */
export const PixelPageHeader = styled.header`
  display: flex;
  flex-direction: column;
  gap: ${t.unit};
`;

/** 页标题：特大号 + 强调青 + 像素字体描粗 */
export const PixelPageTitle = styled.h1`
  margin: 0;
  font: ${t.textXl};
  letter-spacing: 2px;
  color: ${t.colorAccent};
  /* 像素字体加粗：整数 text-shadow 横向 +1px 描粗 */
  text-shadow: 1px 0 0 currentColor;
`;

/** 页副标题：小号弱化文字 */
export const PixelPageSubtitle = styled.p`
  margin: 0;
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;

/** 分区小标题：中号 + 像素字体描粗 */
export const PixelPanelTitle = styled.h2`
  margin: 0;
  font: ${t.textMd};
  letter-spacing: 1px;
  color: ${t.colorText};
  text-shadow: 1px 0 0 currentColor;
`;
