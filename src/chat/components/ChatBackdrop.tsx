import { useId } from "react";
import { styled } from "@linaria/react";
import { t, type ThemeMode } from "../../styles/theme";
import { PixelNoiseField } from "./PixelNoiseField";

/**
 * 对话主区专属像素背景（「数字工作台」风，独立于主窗口的 WebGL FluidBackdrop）。
 *
 * 四层（由下往上）：
 *  0. PixelNoiseField：白底噪 + 蓝色低噪游动 —— 最底层满屏像素噪声场（canvas），
 *     白色底噪（带灰度颗粒）+ 蓝色场按 value-noise 漂移游动，给整个对话区铺上
 *     「活着的像素质感」，比纯色或渐变更有特色、更像素风；
 *  1. 细点阵：CELL 间距的小方点，像终端/坐标纸的网格底 —— agent 的工作画布感；
 *  2. 十字标记：每 4×CELL 一个像素十字，更疏更亮，像蓝图上的锚点，打破纯点阵的单调；
 *  3. 顶部柔光：一层很淡的径向高光，给平面一点纵深，不喧宾夺主。
 *
 * 点阵/十字整层极慢对角漂移（一个十字周期无缝循环），barely perceptible，让底「活」着但克制。
 * 绝对铺满、pointer-events:none、置于内容之下，纯装饰。
 */

// ---- 顶层可调常量（主人改这里即可喵）----
const CELL = 24; // 点阵间距（CSS px）
const DOT = 2; // 像素点/线的粗细（CSS px）
const CROSS_SPAN = CELL * 4; // 十字标记的疏密（每这么多 px 一个）
const DOT_OPACITY = 0.09; // 细点阵不透明度
const CROSS_OPACITY = 0.16; // 十字标记不透明度
const DRIFT_SECONDS = 16; // 对角漂移一圈的时长（越大越慢）

export function ChatBackdrop({ theme }: { theme: ThemeMode }) {
  const rid = useId().replace(/:/g, "");
  const dotId = `cb-dot-${rid}`;
  const crossId = `cb-cross-${rid}`;
  const mid = CROSS_SPAN / 2;

  return (
    <Root aria-hidden>
      {/* 最底层：白底噪 + 蓝色低噪游动（canvas 像素噪声场） */}
      <PixelNoiseField theme={theme} />
      <Drift viewBox={`0 0 ${CROSS_SPAN} ${CROSS_SPAN}`} preserveAspectRatio="xMidYMid slice" shapeRendering="crispEdges">
        <defs>
          {/* 细点阵：每 CELL 一个 DOT×DOT 方点 */}
          <pattern id={dotId} width={CELL} height={CELL} patternUnits="userSpaceOnUse">
            <rect x={0} y={0} width={DOT} height={DOT} fill={t.colorAccent} />
          </pattern>
          {/* 十字标记：每 CROSS_SPAN 一个像素十字（横 + 竖各一段） */}
          <pattern id={crossId} width={CROSS_SPAN} height={CROSS_SPAN} patternUnits="userSpaceOnUse">
            <rect x={mid - DOT / 2} y={mid - DOT * 2} width={DOT} height={DOT * 4} fill={t.colorAccent} />
            <rect x={mid - DOT * 2} y={mid - DOT / 2} width={DOT * 4} height={DOT} fill={t.colorAccent} />
          </pattern>
        </defs>
        {/* 两层图案都铺满、且比 viewBox 大一圈，配合漂移不露边 */}
        <rect x={-CROSS_SPAN} y={-CROSS_SPAN} width={CROSS_SPAN * 3} height={CROSS_SPAN * 3} fill={`url(#${dotId})`} opacity={DOT_OPACITY} />
        <rect x={-CROSS_SPAN} y={-CROSS_SPAN} width={CROSS_SPAN * 3} height={CROSS_SPAN * 3} fill={`url(#${crossId})`} opacity={CROSS_OPACITY} />
      </Drift>
      <Glow />
    </Root>
  );
}

const Root = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
`;

/* 漂移层：比容器大一圈，整层对角平移一个十字周期后无缝复位 */
const Drift = styled.svg`
  position: absolute;
  inset: -${CROSS_SPAN}px;
  width: calc(100% + ${CROSS_SPAN * 2}px);
  height: calc(100% + ${CROSS_SPAN * 2}px);
  animation: cb-drift ${DRIFT_SECONDS}s linear infinite;

  @keyframes cb-drift {
    from {
      transform: translate3d(0, 0, 0);
    }
    to {
      transform: translate3d(${CROSS_SPAN}px, ${CROSS_SPAN}px, 0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

/* 顶部柔光：极淡径向高光，给平面一点纵深 */
const Glow = styled.div`
  position: absolute;
  inset: 0;
  background: radial-gradient(
    120% 80% at 50% -10%,
    ${t.colorAccentSoft} 0%,
    transparent 60%
  );
`;
