import type { ReactNode } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "./PixelFrame";
import { PRIORITY_PAL } from "./palettes";

/**
 * 像素功能行（Action Row）：侧栏里「每行一个功能」的可点击项。
 * 与现有可点组件刻意差异化：
 *  - HistoryCard 是常驻带框卡片、NavButton 是常驻 PixelSurface 面 —— 这里 rest
 *    完全安静：无框无底，只有 左图标 + 右文案，让功能行退到内容之后；
 *  - hover / 常驻激活（active）时浮现一块 raised 像素板（PixelIconButton 同款
 *    「浮起一块板」反馈），图标文字色同步加深，按下轻微缩一下；
 *  - collapsed 时只剩图标居中，文案转为 title 悬浮提示。
 *
 * 图标由 icon 传入（pixel/icons.tsx 的 Material 填充风，currentColor 上色）。
 */

// ---- 顶层可调常量 ----
const ROW_H = 36; // 行高 px
const ICON_SIZE = 20; // 图标槽边长 px

interface PixelActionRowProps {
  icon: ReactNode;
  label: string;
  onActivate: () => void;
  /** 收起态：只显示图标（label 转 title 提示） */
  collapsed?: boolean;
  /** 常驻激活（如搜索输入框展开中）：像素板常显不等 hover */
  active?: boolean;
  className?: string;
}

export function PixelActionRow({
  icon,
  label,
  onActivate,
  collapsed = false,
  active = false,
  className,
}: PixelActionRowProps) {
  return (
    <Row
      type="button"
      data-collapsed={collapsed || undefined}
      data-active={active || undefined}
      title={collapsed ? label : undefined}
      aria-label={label}
      className={className}
      onClick={onActivate}
    >
      {/* hover/激活浮现的像素板底（默认透明缩小，不占视觉）。
          侧栏收起/展开是宽度瞬切：sizeKey 按态缓存目标尺寸 + liveResize
          兜住首次切换（突发首帧同步重建），点「收起」时正 hover 着的板
          当帧就是新分辨率，不会被 CSS 拉伸出粗边框（气泡拉伸同类问题）。 */}
      <FrameLayer aria-hidden>
        <PixelFrame
          palette={PRIORITY_PAL.low}
          variant="raised"
          pixel={3}
          radius={2}
          noise={0.05}
          noiseGranularity={2}
          elevation={2}
          sizeKey={collapsed ? "c" : "e"}
          liveResize
        />
      </FrameLayer>
      <RowIcon aria-hidden>{icon}</RowIcon>
      {!collapsed && <RowLabel>{label}</RowLabel>}
    </Row>
  );
}

const Row = styled.button`
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: ${ROW_H}px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: ${t.colorTextOnBtn};
  cursor: pointer;
  text-align: left;
  transition: color 0.12s ease, transform 0.12s ease;

  &[data-collapsed] {
    justify-content: center;
    padding: 0;
  }
  &:hover,
  &[data-active] {
    color: ${t.colorTextOnBtnAccent};
  }
  &:active {
    transform: scale(0.97);
  }
`;

/* 像素板底层：默认透明 + 缩一点，hover/激活淡入归位 —— 浮现一块像素板的反馈 */
const FrameLayer = styled.span`
  position: absolute;
  inset: 0;
  opacity: 0;
  transform: scale(0.92);
  transition: opacity 0.12s ease, transform 0.12s cubic-bezier(0.2, 0.9, 0.3, 1.3);
  pointer-events: none;

  /* 直接父级是 button；勿用 \${Row} 组件插值（wyw 生产构建会摇掉声明致白屏） */
  button:hover > &,
  button[data-active] > & {
    opacity: 1;
    transform: scale(1);
  }
`;

const RowIcon = styled.span`
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: ${ICON_SIZE}px;
  height: ${ICON_SIZE}px;

  & > svg {
    width: 100%;
    height: 100%;
  }
`;

const RowLabel = styled.span`
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-width: 0;
  font: ${t.textSm};
  font-weight: bold;
  letter-spacing: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
