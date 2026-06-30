import { styled } from "@linaria/react";
import Titlebar from "./components/Titlebar";
import { useTheme } from "./hooks/useTheme";
import { t } from "./styles/theme";

function App() {
  const { theme, toggleTheme } = useTheme();

  return (
    <Shell>
      <Titlebar theme={theme} onToggleTheme={toggleTheme} />
      <Content>
        <Card>
          <Paw>🐾</Paw>
          <Title>Deskling</Title>
          <Desc>主人～像素风双色主题搭好啦喵！</Desc>
          <Tag>当前主题：{theme === "light" ? "浅色 · 灰米" : "深色 · 蓝紫"}</Tag>
          <Hint>点右上角 {theme === "light" ? "☾" : "☀"} 可以切换主题哦</Hint>
        </Card>
      </Content>
    </Shell>
  );
}

export default App;

const Shell = styled.div`
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Content = styled.main`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(${t.unit} * 6);
`;

const Card = styled.div`
  padding: calc(${t.unit} * 8) calc(${t.unit} * 10);
  text-align: center;
  background: ${t.colorSurface};
  border: ${t.borderW} solid ${t.colorBorderStrong};
  box-shadow: 6px 6px 0 ${t.colorShadow};
`;

const Paw = styled.div`
  font-size: 40px;
  margin-bottom: ${t.unit};
`;

const Title = styled.h1`
  margin: 0 0 calc(${t.unit} * 2);
  font-family: ${t.fontPixel};
  font-size: 24px;
  letter-spacing: 2px;
  color: ${t.colorAccent};
`;

const Desc = styled.p`
  margin: 0 0 calc(${t.unit} * 4);
  font-size: 12px;
  color: ${t.colorText};
`;

const Tag = styled.div`
  display: inline-block;
  padding: ${t.unit} calc(${t.unit} * 2);
  font-family: ${t.fontPixel};
  font-size: 12px;
  color: ${t.colorText};
  background: ${t.colorSurface2};
  border: ${t.borderW} solid ${t.colorBorder};
`;

const Hint = styled.p`
  margin: calc(${t.unit} * 3) 0 0;
  font-size: 12px;
  color: ${t.colorTextMuted};
`;
