import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { TrayMenu } from "./windows/TrayMenu";
import { initSettings } from "./settings";
import { applyTheme } from "./styles/theme";
import "./styles/theme.css";

/** 当前 Tauri 窗口标签；非 Tauri 环境（纯浏览器 dev）回退到主窗口 */
function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

async function bootstrap() {
  // 启动时先 await 读取持久化配置（主题等），失败则回退默认浅色
  const settings = await initSettings();
  applyTheme(settings.theme);

  // 同一份前端 bundle 服务多个窗口：按 label 分流（tray-menu = 托盘右键菜单）
  const isTrayMenu = windowLabel() === "tray-menu";
  if (isTrayMenu) document.body.classList.add("tray-menu-window");

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>{isTrayMenu ? <TrayMenu /> : <App />}</React.StrictMode>,
  );
}

void bootstrap();
