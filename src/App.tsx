import { useState } from "react";
import { styled } from "@linaria/react";
import Titlebar from "./components/Titlebar";
import Sidebar, { type SectionId } from "./components/Sidebar";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import About from "./pages/About";
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
          {section === "home" && <Home />}
          {section === "settings" && (
            <Settings theme={theme} onToggleTheme={toggleTheme} />
          )}
          {section === "about" && <About />}
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
  flex: 1;
  min-width: 0;
  overflow: hidden;
`;
