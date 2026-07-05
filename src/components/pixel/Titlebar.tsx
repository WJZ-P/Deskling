import { useState, type MouseEvent, type ReactNode } from "react";
import { styled } from "@linaria/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t, type ThemeMode } from "../../styles/theme";
import { PixelFrame, type PixelPalette } from "./PixelFrame";
import { PixelSurface, type SurfaceState, type SurfaceTune } from "./PixelSurface";
import { PRIORITY_PAL, TITLEBAR_PAL, CONTROL_MIN, CONTROL_MAX, CONTROL_CLOSE } from "./palettes";

interface TitlebarProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
}

// 小图标按钮手感：沿用按钮弹簧，只是更小、投影更浅
const ICON_TUNE: Partial<SurfaceTune> = {
  hoverTy: -1,
  pressTy: 1,
  elevRest: 1,
  elevHover: 2,
  elevPress: 1,
  flickerAmp: 0.06,
};

async function runWindow(action: (w: ReturnType<typeof getCurrentWindow>) => Promise<unknown>) {
  try {
    await action(getCurrentWindow());
  } catch (err) {
    // 在非 Tauri 环境（纯浏览器调试）下静默忽略
    console.warn("window control unavailable:", err);
  }
}

/**
 * 标题栏拖拽区的 mousedown 处理（替代 data-tauri-drag-region）。
 * 内建 data-tauri-drag-region 在 Windows + decorations:false 下双击「还原」会失灵，
 * 且已最大化时单击触发拖拽会让无边框窗口「捅穿任务栏往下溢出」（缺少最大化尺寸约束）。
 * 这里自己接管：
 *  - 双击（e.detail===2）→ toggleMaximize（最大化 ⇄ 还原）；
 *  - 单击且「未最大化」→ startDragging（拖动窗口）；
 *  - 单击但「已最大化」→ 忽略（不拖拽，避免溢出任务栏的溢出 bug）。
 * 点到控制按钮则放行，交给按钮自身 onClick。
 */
async function onDragRegionMouseDown(e: MouseEvent) {
  if (e.button !== 0) return; // 只响应鼠标左键
  if ((e.target as HTMLElement).closest("button")) return; // 点在控制按钮上：放行
  if (e.detail === 2) {
    void runWindow((w) => w.toggleMaximize());
    return;
  }
  // 单击：仅在未最大化时才发起拖拽；已最大化时拖拽会导致无边框窗口向下溢出任务栏
  await runWindow(async (w) => {
    if (await w.isMaximized()) return;
    await w.startDragging();
  });
}

interface IconBtnProps {
  palette: PixelPalette;
  iconColor: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
}

function IconBtn({ palette, iconColor, title, onClick, children }: IconBtnProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const state: SurfaceState = pressed ? "press" : hovered ? "hover" : "rest";
  return (
    <BtnWrap
      type="button"
      title={title}
      onClick={onClick}
      style={{ color: iconColor }}
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
        pixel={3}
        radius={1}
        noise={0.08}
        tune={ICON_TUNE}
        rootStyle={{ display: "flex" }}
        contentStyle={{ width: 22, height: 22, padding: 0 }}
      >
        {children}
      </PixelSurface>
    </BtnWrap>
  );
}

function Titlebar({ theme, onToggleTheme }: TitlebarProps) {
  return (
    <Root>
      <Frame>
        <PixelFrame
          palette={TITLEBAR_PAL[theme]}
          variant="raised"
          pixel={4}
          radius={0}
          noise={0.05}
          noiseGranularity={2}
          noiseSpeed={1.0}
        />
        <Content onMouseDown={onDragRegionMouseDown}>
          <Brand>
            <Paw>🐾</Paw>
            <span>Deskling</span>
          </Brand>

          <Controls>
            <IconBtn
              palette={PRIORITY_PAL.normal}
              iconColor={t.colorTextOnBtn}
              title={theme === "light" ? "切换到深色" : "切换到浅色"}
              onClick={onToggleTheme}
            >
              <Glyph>{theme === "light" ? "☾" : "☀"}</Glyph>
            </IconBtn>
            <IconBtn
              palette={CONTROL_MIN.pal}
              iconColor={CONTROL_MIN.icon}
              title=""
              onClick={() => runWindow((w) => w.minimize())}
            >
              <IconMin />
            </IconBtn>
            <IconBtn
              palette={CONTROL_MAX.pal}
              iconColor={CONTROL_MAX.icon}
              title=""
              onClick={() => runWindow((w) => w.toggleMaximize())}
            >
              <IconMax />
            </IconBtn>
            <IconBtn
              palette={CONTROL_CLOSE.pal}
              iconColor={CONTROL_CLOSE.icon}
              title=""
              onClick={() => runWindow((w) => w.close())}
            >
              <IconClose />
            </IconBtn>
          </Controls>
        </Content>
      </Frame>
    </Root>
  );
}

export default Titlebar;

const Root = styled.div`
  position: relative;
  z-index: 10;
  flex: 0 0 auto;
`;

const Frame = styled.div`
  position: relative;
  height: 38px;
  /* 向下的柔和投影，让标题栏浮在内容之上（分层，而非平贴） */
  box-shadow: 0 5px 12px ${t.colorShadowSoft};
`;

const Content = styled.div`
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 calc(${t.unit} * 2);
  user-select: none;
`;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: ${t.unit};
  font: ${t.textMd};
  letter-spacing: 1px;
  color: ${t.colorText};
  /* 像素字体描粗，和其他标题一致 */
  text-shadow: 1px 0 0 currentColor;
`;

const Paw = styled.span`
  font-size: 14px;
  text-shadow: none;
`;

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: calc(${t.unit} * 1.5);
`;

const BtnWrap = styled.button`
  position: relative;
  display: inline-flex;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  line-height: 1;
`;

const Glyph = styled.span`
  font-size: 14px;
  line-height: 1;
`;

/* CSS 绘制的锐利像素图标，跟随 currentColor */
const IconMin = styled.span`
  width: 10px;
  height: ${t.borderW};
  background: currentColor;
`;

const IconMax = styled.span`
  width: 10px;
  height: 10px;
  border: ${t.borderW} solid currentColor;
`;

const IconClose = styled.span`
  position: relative;
  width: 12px;
  height: 12px;

  &::before,
  &::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 0;
    width: 12px;
    height: ${t.borderW};
    background: currentColor;
  }

  &::before {
    transform: rotate(45deg);
  }

  &::after {
    transform: rotate(-45deg);
  }
`;
