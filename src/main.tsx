import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { TrayMenu } from "./windows/TrayMenu";
import { PetWindow } from "./windows/PetWindow";
import { ChatWindow } from "./windows/ChatWindow";
import {
  initSettings,
  syncBackendConfig,
  syncInstalledPetPackages,
} from "./settings";
import { initConversations } from "./chat/store";
import { initPetPackages } from "./pet/packages";
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
  const label = windowLabel();
  // 启动时先 await 读取持久化配置（主题等），失败则回退默认浅色
  const settings = await initSettings();
  applyTheme(settings.theme);
  // 资源包目录必须在任一窗口渲染前就绪：主窗用预览/人设，桌宠窗用动画登记表。
  await initPetPackages();
  // 主窗口把新扫描到的工坊包登记成桌宠实例；其他常驻窗口由 store 广播接收结果。
  if (label === "main") await syncInstalledPetPackages();
  // 把代理 / 音量推给 Rust 侧生效（存前端 store，但要在后端进程起作用）
  void syncBackendConfig();

  // 读入历史会话到内存缓存（供 ChatWindow 同步取初值，避免闪空）
  await initConversations();

  // 同一份前端 bundle 服务多个窗口：按 label 分流
  // main = 主界面 · pet = 桌宠 · tray-menu = 托盘右键菜单 · chat = AI 对话窗
  const content =
    label === "tray-menu" ? (
      <TrayMenu />
    ) : label === "pet" ? (
      <PetWindow />
    ) : label === "chat" ? (
      <ChatWindow />
    ) : (
      <App />
    );
  // 透明底窗口（桌宠 / 托盘菜单）：像素内容直接悬浮在桌面上。
  // main 与 chat 都是实心窗（自绘标题栏 + 外框），不加透明类。
  if (label === "pet" || label === "tray-menu") {
    document.body.classList.add("transparent-window");
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>{content}</React.StrictMode>,
  );
}

void bootstrap();
