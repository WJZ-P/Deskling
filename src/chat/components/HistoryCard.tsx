import { memo, useEffect, useRef, useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame, type PixelPalette } from "../../components/pixel/PixelFrame";
import { PixelIconButton } from "../../components/pixel/PixelIconButton";
import { PixelConfirmModal } from "../../components/pixel/PixelConfirmModal";
import { MoreVertIcon, DeleteIcon } from "../../components/pixel/icons";
import { PRIORITY_PAL } from "../../components/pixel/palettes";

/**
 * 历史会话卡片（对话窗侧栏专用，独立于 PixelCard 的一套新表现）。
 *
 * 和现有像素组件刻意做出区别：
 *  - PixelCard 用弹簧引擎 + 厚像素（pixel 5）+ hover 抬升，偏「陈列卡」；
 *    这里要的是一列能安静排布、又有明确「选中态」的会话项 —— 走静态 PixelFrame，
 *    用「态驱动」换脸，轻量（rest/hover 不跑 rAF）。
 *  - 三态换装：
 *      rest   —— 柔青灰 plate（REST_PAL），不抢戏，让列表安静；
 *      hover  —— 白 plate + 硬投影抬升，浮起来；
 *      active —— 青 plate + 硬投影 + **低噪流动起来（noiseSpeed）**：全场只有
 *               「当前会话」的底噪在动，呼应 agent「这条会话是活的/在跑」。
 *  - 左侧「像素信号脊」：三格硬边小方块，按态逐亮（暗/青/白）——一个新 motif，
 *    区别于 ToolCallBlock 的圆点与旧版 CSS 竖条。
 *  - 右上「⋮」更多按钮：hover（或菜单展开时）显现，点开一个小浮层，提供删除。
 *    删除走 PixelConfirmModal 二次确认（不可撤销）。
 *
 * 纯 UI：选择 / 删除通过 onSelect / onDelete 交给父级。配色走固定浅色
 * （同气泡的 PRIORITY_PAL），不随主题切换，保证卡片在深浅面板上都是同一套识别色。
 *
 * 注意 Card 用 <div role="button"> 而非 <button>：卡片内要嵌「⋮」按钮 + 浮层按钮，
 * button 里套 button 是非法 HTML，故用 div 承载点击 + 键盘（Enter/Space）语义。
 */

// ---- 顶层可调常量（主人改这里即可喵）----
const CARD_PIXEL = 3; // 面像素大小（比 PixelCard 的 5 更细，适合密排列表）
const CARD_RADIUS = 1; // 像素切角格数
const CARD_NOISE = 0.05; // 静息/hover 静态低噪强度
const CARD_NOISE_ACTIVE = 0.07; // 选中态低噪强度（略强，更有存在感）
const CARD_NOISE_GRAN = 2; // 低噪颗粒：N×N 合成一块
const ACTIVE_NOISE_SPEED = 1.25; // 选中态低噪流动速度（>0 才「活」；越小越慢越柔）
const ELEV_HOVER = 3; // hover / active 硬投影高度 px（rest 为 0）

/**
 * 静息态柔调色：比白底更淡的青灰，让长列表安静不刺眼。
 * 固定浅色向（与 MessageBubble 的 PRIORITY_PAL 同策略，不随主题变），
 * 面/描边/高光/暗影四档。
 */
const REST_PAL: PixelPalette = {
  face: "#eef5f5",
  edge: "#c2dadb",
  hi: "#ffffff",
  lo: "#d8e9e9",
  dark: {
    face: "#11263e",
    edge: "#3d6690",
    hi: "#22415e",
    lo: "#081523",
  },
};

interface HistoryCardProps {
  /** 会话 id：回调按它回指（父级传稳定函数引用 + memo，流式期间其余卡片零重渲染） */
  id: string;
  title: string;
  preview: string;
  active?: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * memo：流式输出期间父级（HistorySidebar）每个 delta 都会重渲染，
 * 但除正在更新的那条会话外，其余卡片 props 全部不变（id/title/preview 稳定、
 * onSelect/onDelete 是父级稳定引用）→ 整卡跳过，重渲染风暴只剩 1 张卡。
 */
export const HistoryCard = memo(function HistoryCard({
  id,
  title,
  preview,
  active = false,
  onSelect,
  onDelete,
}: HistoryCardProps) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // 菜单展开时：点卡片外部 / 按 Esc 收起。挂在 document 上一把抓（capture 期先于卡片自身点击）。
  useEffect(() => {
    if (!menuOpen) return;
    const onDocDown = (e: PointerEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDocDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // 态优先级：active > hover > rest（选中时忽略 hover，稳定显示选中样式）
  const stateName = active ? "active" : hovered ? "hover" : "rest";
  const palette = active ? PRIORITY_PAL.primary : hovered ? PRIORITY_PAL.low : REST_PAL;
  // ⋮ 按钮：hover 卡片 或 菜单展开时显现（展开后移出卡片也不消失，否则点不到菜单）
  const showMore = hovered || menuOpen;

  return (
    <>
      <Card
        ref={cardRef}
        role="button"
        tabIndex={0}
        data-state={stateName}
        onClick={() => onSelect(id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(id);
          }
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        {/* plate 底：态驱动换调色 / 抬升 / 选中态低噪流动 */}
        <PixelFrame
          palette={palette}
          variant="raised"
          pixel={CARD_PIXEL}
          radius={CARD_RADIUS}
          noise={active ? CARD_NOISE_ACTIVE : CARD_NOISE}
          noiseGranularity={CARD_NOISE_GRAN}
          noiseSpeed={active ? ACTIVE_NOISE_SPEED : 0}
          elevation={active || hovered ? ELEV_HOVER : 0}
        />
        <Inner>
          {/* 左侧像素信号脊：三格硬边方块，按态逐亮 */}
          <Spine aria-hidden>
            <i />
            <i />
            <i />
          </Spine>
          <Texts>
            <CardTitle>{title}</CardTitle>
            <CardPreview>{preview}</CardPreview>
          </Texts>
        </Inner>

        {/* 右上「⋮」更多按钮：hover / 菜单展开时显现 */}
        <MoreSlot data-show={showMore || undefined}>
          <PixelIconButton
            aria-label="更多操作"
            size={26}
            onActivate={() => setMenuOpen((v) => !v)}
          >
            <MoreVertIcon />
          </PixelIconButton>
        </MoreSlot>

        {/* 小浮层选项面板：贴在 ⋮ 下方，目前只有删除。点项不冒泡到卡片选择 */}
        {menuOpen && (
          <Menu
            role="menu"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <PixelFrame
              palette={PRIORITY_PAL.low}
              variant="raised"
              pixel={3}
              radius={2}
              noise={0.05}
              noiseGranularity={2}
              elevation={5}
            />
            <MenuInner>
              <MenuItem
                type="button"
                role="menuitem"
                data-tone="danger"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirming(true);
                }}
              >
                <MenuIcon aria-hidden>
                  <DeleteIcon />
                </MenuIcon>
                删除对话
              </MenuItem>
            </MenuInner>
          </Menu>
        )}
      </Card>

      <PixelConfirmModal
        open={confirming}
        title="删除对话"
        message={`确定删除「${title}」吗？此操作不可撤销！！！`}
        confirmLabel="删除"
        cancelLabel="取消"
        tone="danger"
        onConfirm={() => {
          setConfirming(false);
          onDelete(id);
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
});

const Card = styled.div`
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
`;

/* 内容层：浮在 plate 之上；hover/active 时整体轻抬 1px 呼应投影 */
const Inner = styled.span`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: stretch;
  gap: 9px;
  padding: 9px 11px 9px 9px;
  transition: transform 0.14s ease;

  /* 裸属性祖先选择器（data-state 只在 Card 上）。勿用 \${Card} 组件插值：
     wyw 生产构建会把 CSS 里的组件引用抽走后摇掉 Card 声明，导致整个 app 白屏。 */
  [data-state="hover"] &,
  [data-state="active"] & {
    transform: translateY(-1px);
  }
`;

/* 像素信号脊：3 格 4px 硬边方块，纵向堆叠；按父级态换色 */
const Spine = styled.span`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;

  & > i {
    width: 4px;
    height: 4px;
    background: ${t.colorBorderStrong};
    transition: background-color 0.14s ease;
  }

  [data-state="hover"] & > i {
    background: ${t.colorAccent};
  }
  /* 选中态在亮青 plate 上：脊改用深墨色，保持清楚的结构对比。 */
  [data-state="active"] & > i {
    background: ${t.colorOnAccent};
  }
`;

const Texts = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const CardTitle = styled.span`
  display: block;
  font: ${t.textSm};
  font-weight: bold;
  letter-spacing: 0.5px;
  color: ${t.colorText};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 给右上 ⋮ 让出位置，标题不被按钮压住 */
  padding-right: 22px;

  [data-state="active"] & {
    color: ${t.colorTextOnBtnAccent};
  }
`;

const CardPreview = styled.span`
  display: block;
  font: ${t.textXs};
  line-height: 1.5;
  color: ${t.colorTextMuted};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  [data-state="active"] & {
    color: ${t.colorTextOnBtnAccent};
    opacity: 0.85;
  }
`;

/* 右上「⋮」按钮位：默认隐藏（透明 + 不拦事件），hover 卡片或菜单展开时淡入 */
const MoreSlot = styled.span`
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 2;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;

  &[data-show] {
    opacity: 1;
    pointer-events: auto;
  }
`;

/* 小浮层选项面板：绝对定位贴在 ⋮ 下方，右对齐；PixelFrame 铺底，选项浮其上 */
const Menu = styled.div`
  position: absolute;
  top: 30px;
  right: 6px;
  z-index: 5;
  min-width: 116px;
`;

const MenuInner = styled.div`
  position: relative;
  z-index: 1;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const MenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 2px;
  background: transparent;
  font: ${t.textSm};
  color: ${t.colorText};
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;

  &:hover {
    background: ${t.colorAccentSoft};
  }
  &[data-tone="danger"]:hover {
    color: ${t.btnClose};
  }
`;

const MenuIcon = styled.span`
  display: inline-flex;
  width: 15px;
  height: 15px;

  & > svg {
    width: 100%;
    height: 100%;
    fill: currentColor;
  }
`;
