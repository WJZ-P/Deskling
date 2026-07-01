import { styled } from "@linaria/react";
import type { ComponentType } from "react";
import { bevel, t } from "../styles/theme";
import {
  ChevronIcon,
  DebugIcon,
  HomeIcon,
  InfoIcon,
  SettingsIcon,
} from "./icons";

/** 主面板的可导航区域标识 */
export type SectionId = "home" | "settings" | "debug" | "about";

interface NavItemDef {
  id: SectionId;
  label: string;
  Icon: ComponentType<{ size?: number }>;
}

/** 主导航（顶部） */
const PRIMARY: NavItemDef[] = [
  { id: "home", label: "主页", Icon: HomeIcon },
  { id: "settings", label: "设置", Icon: SettingsIcon },
];

/** 次级导航（底部） */
const SECONDARY: NavItemDef[] = [
  { id: "debug", label: "调试", Icon: DebugIcon },
  { id: "about", label: "关于", Icon: InfoIcon },
];

interface SidebarProps {
  active: SectionId;
  collapsed: boolean;
  onSelect: (id: SectionId) => void;
  onToggleCollapse: () => void;
}

function Sidebar({
  active,
  collapsed,
  onSelect,
  onToggleCollapse,
}: SidebarProps) {
  const renderItem = ({ id, label, Icon }: NavItemDef) => (
    <NavBtn
      key={id}
      type="button"
      title={collapsed ? label : undefined}
      data-active={id === active}
      aria-current={id === active ? "page" : undefined}
      onClick={() => onSelect(id)}
    >
      <IconSlot>
        <Icon size={22} />
      </IconSlot>
      {!collapsed && <Label>{label}</Label>}
    </NavBtn>
  );

  return (
    <Aside data-collapsed={collapsed}>
      <Group>{PRIMARY.map(renderItem)}</Group>
      <Spacer />
      <Group>{SECONDARY.map(renderItem)}</Group>
      <CollapseBtn
        type="button"
        title={collapsed ? "展开侧边栏" : "收起侧边栏"}
        onClick={onToggleCollapse}
      >
        <IconSlot data-flip={collapsed}>
          <ChevronIcon size={22} />
        </IconSlot>
        {!collapsed && <Label>收起</Label>}
      </CollapseBtn>
    </Aside>
  );
}

export default Sidebar;

const Aside = styled.aside`
  flex-shrink: 0;
  width: 148px;
  display: flex;
  flex-direction: column;
  padding: calc(${t.unit} * 2);
  gap: ${t.unit};
  background: ${t.colorSurface};
  border-right: ${t.borderW} solid ${t.colorBorderStrong};
  transition: width 0.16s ease;

  &[data-collapsed="true"] {
    width: 52px;
  }
`;

const Group = styled.nav`
  display: flex;
  flex-direction: column;
  gap: ${t.unit};
`;

const Spacer = styled.div`
  flex: 1;
`;

const IconSlot = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
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
`;

/* 导航按钮：hover 凸起（raised）、active（选中）凹陷（sunken）+ 强调色左边条 */
const NavBtn = styled.button`
  display: flex;
  align-items: center;
  gap: calc(${t.unit} * 2);
  width: 100%;
  height: 32px;
  padding: 0 calc(${t.unit} * 2);
  cursor: pointer;
  text-align: left;
  color: ${t.colorText};
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  transition: background 0.1s ease, color 0.1s ease, border-color 0.1s ease;

  &:hover {
    background: ${t.colorControl};
    border-color: ${t.colorBorderStrong};
    box-shadow: ${bevel.raised};
  }

  &[data-active="true"] {
    color: ${t.colorAccent};
    background: ${t.colorControl};
    border-color: ${t.colorBorderStrong};
    box-shadow: ${bevel.sunken}, inset 3px 0 0 ${t.colorAccent};
  }
`;

const CollapseBtn = styled(NavBtn)`
  height: 28px;
  color: ${t.colorTextMuted};
  margin-top: ${t.unit};
`;
