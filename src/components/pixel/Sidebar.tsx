import { useState, type ComponentType, type ReactNode } from "react";
import { styled } from "@linaria/react";
import { t, type ThemeMode } from "../../styles/theme";
import { PixelSurface, type SurfaceState, type SurfaceTune } from "./PixelSurface";
import { PixelFrame } from "./PixelFrame";
import { SIDEBAR_PAL, SIDEBAR_PANEL } from "./palettes";
import type { PixelPalette } from "./PixelFrame";
import {
  ChevronIcon,
  DebugIcon,
  HomeIcon,
  InfoIcon,
  PetIcon,
  SettingsIcon,
} from "../icons";

/* ============ 侧边栏可调参数喵（改这里即可调手感/尺寸/留白）============ */

/** 每个美术像素占多少 CSS px（越大像素块越粗） */
const NAV_PIXEL = 3.5;
/** 像素切角格数：0 = 直角（侧栏要方角）；>0 会切像素圆角 */
const NAV_RADIUS = 1;
/** 面像素静态底噪强度 0~1（rest 也在，纯质感、不动） */
const NAV_NOISE = 0.06;
/** 选中态的「环境低噪」驱动强度 0~1：让选中项即使静止也持续动态变化（0=只 hover 动） */
const NAV_ACTIVE_AMBIENT = 0.3;

/* ---- 侧栏面板背景（PixelFrame：分层边框 + 慢速动态底噪）---- */
/** 面板底噪强度 0~1（面像素随机明暗质感） */
const PANEL_NOISE = 0.08;
/** 面板底噪颗粒：N×N 像素合成一块（越大越粗块、越复古） */
const PANEL_NOISE_GRAN = 3;
/** 面板底噪动态变化速度（每秒）：慢速缓动，0=静态。比主壁纸克制得多 */
const PANEL_NOISE_SPEED = 1.0;
/** 面板每个美术像素占多少 CSS px */
const PANEL_PIXEL = 4;

/** 导航按钮尺寸 */
const NAV_HEIGHT = 40; // 按钮高度（CSS px）
const NAV_PAD_X = 12; // 展开态水平内边距
const NAV_PAD_Y = 8; // 上下内边距（防止字贴到像素边）
const NAV_GAP = 16; // 图标与文字间距
const NAV_ICON = 24; // 图标尺寸
const NAV_ITEM_GAP = 8; // 相邻按钮的垂直间距

/**
 * 侧边栏按钮手感（弹簧动画调参）—— 抽到顶部方便逐项调喵：
 *  - 投影比默认更浅，一列排开不显吵；
 *  - flickerAmp=0 关掉常驻正弦呼吸；低噪的动态变化统一交给 noiseHoverAmp
 *    （由 hover 进度或选中态 ambient 驱动，见 PixelSurface）。
 */
const NAV_TUNE: Partial<SurfaceTune> = {
  hoverTy: -1, // hover 上抬 px（负=上抬）
  pressTy: 1, // press 下沉 px
  elevRest: 1, // 静止投影高度 px
  elevHover: 2, // hover 投影高度 px
  elevPress: 1, // press 投影高度 px
  flickerAmp: 0, // 正弦呼吸幅度：0=关（低噪只走动态噪声，不做老式呼吸）
  noiseHoverAmp: 0.10, // 动态低噪幅度（hover / 选中态驱动）
  noiseHoverDelay: 0.18, // 动态低噪重掷间隔秒（越大变化越慢越错落）
  noiseGranularity: 2, // 低噪颗粒：N×N 像素合成一块（越大越粗块）
};

/* ============================================================ */

/** 主面板的可导航区域标识 */
export type SectionId = "home" | "pet" | "settings" | "debug" | "about";

interface NavItemDef {
  id: SectionId;
  label: string;
  Icon: ComponentType<{ size?: number }>;
}

/** 主导航（顶部） */
const PRIMARY: NavItemDef[] = [
  { id: "home", label: "主页", Icon: HomeIcon },
  { id: "pet", label: "桌宠", Icon: PetIcon },
  { id: "settings", label: "设置", Icon: SettingsIcon },
];

/** 次级导航（底部） */
const SECONDARY: NavItemDef[] = [
  { id: "debug", label: "调试", Icon: DebugIcon },
  { id: "about", label: "关于", Icon: InfoIcon },
];

interface NavButtonProps {
  palette: PixelPalette;
  active: boolean;
  collapsed: boolean;
  title?: string;
  ariaCurrent?: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** 像素表面驱动的侧栏按钮：外层普通 button 收事件，PixelSurface 只做视觉 */
function NavButton({
  palette,
  active,
  collapsed,
  title,
  ariaCurrent,
  onClick,
  children,
}: NavButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const state: SurfaceState = pressed ? "press" : hovered ? "hover" : "rest";

  return (
    <BtnWrap
      type="button"
      title={title}
      data-active={active}
      aria-current={ariaCurrent ? "page" : undefined}
      onClick={onClick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
    >
      <PixelSurface
        palette={palette}
        state={state}
        pixel={NAV_PIXEL}
        radius={NAV_RADIUS}
        noise={NAV_NOISE}
        ambient={active ? NAV_ACTIVE_AMBIENT : 0}
        tune={NAV_TUNE}
        sizeKey={collapsed ? "c" : "e"}
        rootStyle={{ display: "flex", width: "100%", height: "100%" }}
        contentStyle={{
          width: "100%",
          height: "100%",
          padding: collapsed ? `${NAV_PAD_Y}px 0` : `${NAV_PAD_Y}px ${NAV_PAD_X}px`,
          justifyContent: collapsed ? "center" : "flex-start",
          gap: `${NAV_GAP}px`,
        }}
      >
        {children}
      </PixelSurface>
    </BtnWrap>
  );
}

interface SidebarProps {
  theme: ThemeMode;
  active: SectionId;
  collapsed: boolean;
  onSelect: (id: SectionId) => void;
  onToggleCollapse: () => void;
}

function Sidebar({
  theme,
  active,
  collapsed,
  onSelect,
  onToggleCollapse,
}: SidebarProps) {
  const skin = SIDEBAR_PAL[theme];

  const renderItem = ({ id, label, Icon }: NavItemDef) => {
    const isActive = id === active;
    return (
      <NavButton
        key={id}
        palette={isActive ? skin.active : skin.idle}
        active={isActive}
        collapsed={collapsed}
        title={collapsed ? label : undefined}
        ariaCurrent={isActive}
        onClick={() => onSelect(id)}
      >
        <IconSlot>
          <Icon size={NAV_ICON} />
        </IconSlot>
        {!collapsed && <Label>{label}</Label>}
      </NavButton>
    );
  };

  return (
    <Aside data-collapsed={collapsed}>
      {/* 面板背景：分层像素边框（右边框由 raised 内线 + 外描边形成层次）+ 慢速动态底噪。
          颜色由 SIDEBAR_PANEL 定，刻意与标题栏区分，让侧栏是独立模块。 */}
      <PixelFrame
        palette={SIDEBAR_PANEL[theme]}
        variant="raised"
        pixel={PANEL_PIXEL}
        radius={0}
        noise={PANEL_NOISE}
        noiseGranularity={PANEL_NOISE_GRAN}
        noiseSpeed={PANEL_NOISE_SPEED}
        sizeKey={collapsed ? "c" : "e"}
      />
      <Inner>
        <Group>{PRIMARY.map(renderItem)}</Group>
        <Spacer />
        <Group>{SECONDARY.map(renderItem)}</Group>
        <Collapse>
          <NavButton
            palette={skin.idle}
            active={false}
            collapsed={collapsed}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            onClick={onToggleCollapse}
          >
            <IconSlot data-flip={collapsed}>
              <ChevronIcon size={NAV_ICON} />
            </IconSlot>
            {!collapsed && <Label>收起</Label>}
          </NavButton>
        </Collapse>
      </Inner>
    </Aside>
  );
}

export default Sidebar;

const Aside = styled.aside`
  position: relative;
  flex-shrink: 0;
  width: 148px;
  transition: width 0.16s ease;

  &[data-collapsed="true"] {
    width: 52px;
  }
`;

/* 导航内容层：浮在 PixelFrame 面板之上 */
const Inner = styled.div`
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: calc(${t.unit} * 2);
  gap: ${NAV_ITEM_GAP}px;
`;

const Group = styled.nav`
  display: flex;
  flex-direction: column;
  gap: ${NAV_ITEM_GAP}px;
  padding: 4px 2px;
`;

const Spacer = styled.div`
  flex: 1;
`;

const Collapse = styled.div`
  margin: ${t.unit} 2px;


`;

/* 外层按钮：撑满侧栏、去掉原生外观，视觉与手感全交给内部 PixelSurface */
const BtnWrap = styled.button`
  display: block;
  width: 100%;
  height: ${NAV_HEIGHT}px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  /* 图标/文字色随选中态切换：idle=按钮文字色，active=青底上的深墨 */
  color: ${t.colorTextOnBtn};

  &[data-active="true"] {
    color: ${t.colorOnAccent};
  }
`;

const IconSlot = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: ${NAV_ICON}px;
  height: ${NAV_ICON}px;
  transition: transform 0.16s ease;

  &[data-flip="true"] {
    transform: rotate(180deg);
  }
`;

const Label = styled.span`
  font: ${t.textMd};
  letter-spacing: 1px;
  white-space: nowrap;
  overflow: hidden;
  /* 像素字体描粗，和标题/按钮一致 */
  text-shadow: 1px 0 0 currentColor;
`;
