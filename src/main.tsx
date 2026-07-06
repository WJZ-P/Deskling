import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { TrayMenu } from "./windows/TrayMenu";
import { PetWindow } from "./windows/PetWindow";
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

  // 同一份前端 bundle 服务多个窗口：按 label 分流
  // main = 主界面 · pet = 桌宠 · tray-menu = 托盘右键菜单
  const label = windowLabel();
  const content =
    label === "tray-menu" ? <TrayMenu /> : label === "pet" ? <PetWindow /> : <App />;
  // 非主窗口都是透明底：像素内容直接悬浮在桌面上
  if (label !== "main") document.body.classList.add("transparent-window");

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>{content}</React.StrictMode>,
  );
}

void bootstrap();
