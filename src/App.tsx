import { useState } from "react";
import { styled } from "@linaria/react";
import Titlebar from "./components/pixel/Titlebar";
import Sidebar, { type SectionId } from "./components/pixel/Sidebar";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import Debug from "./pages/Debug";
import About from "./pages/About";
import { FluidBackdrop } from "./components/pixel/FluidBackdrop";
import { PixelFrame } from "./components/pixel/PixelFrame";
import { WINDOW_FRAME } from "./components/pixel/palettes";
import type { BackdropStyleId } from "./components/pixel/backdrops";
import { useTheme } from "./hooks/useTheme";
import { getSetting, setSetting } from "./settings";
import { t } from "./styles/theme";

function App() {
  const { theme, toggleTheme } = useTheme();
  const [section, setSection] = useState<SectionId>("home");
  const [collapsed, setCollapsed] = useState(() =>
    getSetting("sidebarCollapsed"),
  );
  const [backdropStyle, setBackdropStyle] = useState<BackdropStyleId>(() =>
    getSetting("backdropStyle"),
  );

  const changeBackdrop = (next: BackdropStyleId) => {
    setBackdropStyle(next);
    void setSetting("backdropStyle", next);
  };

  const toggleCollapse = () =>
    setCollapsed((prev) => {
      const next = !prev;
      void setSetting("sidebarCollapsed", next);
      return next;
    });

  return (
    <Shell>
      <Titlebar theme={theme} onToggleTheme={toggleTheme} />
      <Body>
        <Sidebar
          theme={theme}
          active={section}
          collapsed={collapsed}
          onSelect={setSection}
          onToggleCollapse={toggleCollapse}
        />
        <Main>
          <FluidBackdrop theme={theme} style={backdropStyle} />
          <Content>
            {section === "home" && <Home />}
            {section === "settings" && (
              <Settings
                theme={theme}
                onToggleTheme={toggleTheme}
                backdropStyle={backdropStyle}
                onChangeBackdrop={changeBackdrop}
              />
            )}
            {section === "debug" && <Debug />}
            {section === "about" && <About />}
          </Content>
        </Main>
      </Body>
      {/* 窗口外包裹框：空心像素框叠在最上层，给整个无边框窗口收口一圈。
          pointer-events:none 不拦事件；内部各模块贴窗口边的重复边被它盖住，只留模块间接缝。 */}
      <WindowFrameLayer aria-hidden>
        <PixelFrame palette={WINDOW_FRAME[theme]} variant="raised" pixel={3} radius={0} hollow />
      </WindowFrameLayer>
    </Shell>
  );
}

export default App;

const Shell = styled.div`
  position: relative;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: ${t.colorBg};
`;

const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  /* 上移一档，把侧栏顶边塞进标题栏（不透明、更高 z）底下，
     消除「标题栏底边 + 侧栏顶边」的双线接缝。8px = 外框 2 格 × pixel(4)。 */
  margin-top: -8px;
`;

/* 窗口外框层：绝对铺满 Shell，最上层，只做视觉收口 */
const WindowFrameLayer = styled.div`
  position: absolute;
  inset: 0;
  z-index: 100;
  pointer-events: none;
`;

const Main = styled.main`
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
`;

/* 内容层置于 backdrop 之上；撑满 Main，滚动交给内部 Page */
const Content = styled.div`
  position: relative;
  z-index: 1;
  height: 100%;
`;
