import { useState, type ReactNode } from "react";
import { styled } from "@linaria/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t, type ThemeMode } from "../styles/theme";
import { PixelFrame, type PixelPalette } from "./pixel/PixelFrame";
import { PixelSurface, type SurfaceState, type SurfaceTune } from "./pixel/PixelSurface";
import { PRIORITY_PAL, TITLEBAR_PAL, CONTROL_MIN, CONTROL_MAX, CONTROL_CLOSE } from "./pixel/palettes";

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
        />
        <Content data-tauri-drag-region>
          <Brand data-tauri-drag-region>
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
              title="最小化"
              onClick={() => runWindow((w) => w.minimize())}
            >
              <IconMin />
            </IconBtn>
            <IconBtn
              palette={CONTROL_MAX.pal}
              iconColor={CONTROL_MAX.icon}
              title="最大化 / 还原"
              onClick={() => runWindow((w) => w.toggleMaximize())}
            >
              <IconMax />
            </IconBtn>
            <IconBtn
              palette={CONTROL_CLOSE.pal}
              iconColor={CONTROL_CLOSE.icon}
              title="关闭"
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
