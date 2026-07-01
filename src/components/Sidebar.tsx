import { styled } from "@linaria/react";
import type { ComponentType } from "react";
import { pixelCorners, t } from "../styles/theme";
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

/* 导航按钮（软萌像素）：hover 浅填充、active（选中）青色填充药丸 */
const NavBtn = styled.button`
  display: flex;
  align-items: center;
  gap: calc(${t.unit} * 2);
  width: 100%;
  height: 34px;
  padding: 0 calc(${t.unit} * 2);
  cursor: pointer;
  text-align: left;
  color: ${t.colorText};
  background: transparent;
  border: 0;
  clip-path: ${pixelCorners};
  transition: background 0.1s ease, color 0.1s ease;

  &:hover {
    background: ${t.colorControl};
  }

  &[data-active="true"] {
    color: ${t.colorOnAccent};
    background: ${t.colorAccent};
  }
`;

const CollapseBtn = styled(NavBtn)`
  height: 28px;
  color: ${t.colorTextMuted};
  margin-top: ${t.unit};
`;
