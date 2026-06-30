import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initSettings } from "./settings";
import { applyTheme } from "./styles/theme";
import "./styles/theme.css";

async function bootstrap() {
  // 启动时先 await 读取持久化配置（主题等），失败则回退默认浅色
  const settings = await initSettings();
  applyTheme(settings.theme);

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
