import { useState } from "react";
import { styled } from "@linaria/react";
import Titlebar from "./components/Titlebar";
import Sidebar, { type SectionId } from "./components/Sidebar";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import Debug from "./pages/Debug";
import About from "./pages/About";
import { PixelBackdrop } from "./components/pixel/PixelBackdrop";
import { useTheme } from "./hooks/useTheme";
import { getSetting, setSetting } from "./settings";
import { t } from "./styles/theme";

function App() {
  const { theme, toggleTheme } = useTheme();
  const [section, setSection] = useState<SectionId>("home");
  const [collapsed, setCollapsed] = useState(() =>
    getSetting("sidebarCollapsed"),
  );

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
          active={section}
          collapsed={collapsed}
          onSelect={setSection}
          onToggleCollapse={toggleCollapse}
        />
        <Main>
          <PixelBackdrop theme={theme} />
          <Content>
            {section === "home" && <Home />}
            {section === "settings" && (
              <Settings theme={theme} onToggleTheme={toggleTheme} />
            )}
            {section === "debug" && <Debug />}
            {section === "about" && <About />}
          </Content>
        </Main>
      </Body>
    </Shell>
  );
}

export default App;

const Shell = styled.div`
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
