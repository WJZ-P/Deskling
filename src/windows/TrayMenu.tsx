import { useEffect, useRef } from "react";
import { styled } from "@linaria/react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { t, applyTheme } from "../styles/theme";
import { PixelFrame } from "../components/pixel/PixelFrame";
import { PixelDivider } from "../components/pixel/PixelDivider";
import { PRIORITY_PAL } from "../components/pixel/palettes";
import { getSetting, initSettings } from "../settings";

/**
 * 托盘右键菜单窗口（label="tray-menu"）：替代系统原生托盘菜单的像素弹层。
 *
 * 机制：
 *  - 窗口在 tauri.conf.json 预建（隐藏 / 透明 / 置顶 / 不上任务栏）；
 *  - Rust 侧监听托盘右键 → 把本窗口定位到光标左上并 show + focus；
 *  - 失焦即隐藏（= 点击外部关闭）、Esc 关闭 —— 手感对齐原生菜单；
 *  - 每次被唤出（获得焦点）时重读 settings 同步主题，跟随主窗口明暗切换；
 *  - 挂载后按内容实际尺寸收缩窗口（含投影余量），Rust 按 outer_size 定位。
 *
 * 面板样式对齐 PixelSelect 的下拉弹层（同像素 / 切角 / 低噪 / 投影参数）喵～
 */

// ---- 顶层可调常量（对齐 PixelSelect 弹层） ----
const MENU_PIXEL = 3; // 面板像素大小
const MENU_RADIUS = 2; // 像素切角
const MENU_NOISE = 0.05; // 静态底噪
const MENU_ELEV = 4; // 硬投影高度（Root 底部留同高余量防裁切）
const MENU_WIDTH = 168; // 菜单逻辑宽度 px

export function TrayMenu() {
  const rootRef = useRef<HTMLDivElement>(null);

  // 挂载后把窗口收缩到内容实际尺寸（LogicalSize 自动处理 DPI 缩放）
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    void getCurrentWindow().setSize(
      new LogicalSize(Math.ceil(rect.width), Math.ceil(rect.height)),
    );
  }, []);

  useEffect(() => {
    const win = getCurrentWindow();
    // 获得焦点 = 被托盘右键唤出：同步主窗口可能改过的主题；失焦 = 点了外部：隐藏
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        void initSettings().then(() => applyTheme(getSetting("theme")));
      } else {
        void win.hide();
      }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void win.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      void unlisten.then((f) => f());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <Root ref={rootRef}>
      <Panel>
        <PixelFrame
          palette={PRIORITY_PAL.low}
          variant="raised"
          pixel={MENU_PIXEL}
          radius={MENU_RADIUS}
          noise={MENU_NOISE}
          noiseGranularity={2}
          elevation={MENU_ELEV}
        />
        <Items>
          <Item onClick={() => void invoke("tray_show_main")}>
            <Mark aria-hidden>▸</Mark>
            显示主界面
          </Item>
          <PixelDivider />
          <Item onClick={() => void invoke("tray_quit")}>
            <Mark aria-hidden>▸</Mark>
            退出 Deskling
          </Item>
        </Items>
      </Panel>
    </Root>
  );
}

/* 只包住内容：窗口尺寸 = 本元素尺寸；底部留出硬投影的余量 */
const Root = styled.div`
  display: inline-block;
  padding-bottom: ${MENU_ELEV}px;
`;

const Panel = styled.div`
  position: relative;
  width: ${MENU_WIDTH}px;
`;

const Items = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  padding: 6px;
`;

/* 菜单行：样式对齐 PixelSelect 的 OptionRow（hover 渐变高亮 + 像素箭头标记） */
const Item = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: ${t.textSm};
  letter-spacing: 1px;
  color: ${t.colorText};
  user-select: none;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    background-color: ${t.colorAccentSoft};
  }

  &:active {
    transform: translateY(1px);
  }
`;

const Mark = styled.span`
  flex: 0 0 auto;
  width: 10px;
  color: ${t.colorAccent};
  opacity: 0;
  transition: opacity 0.16s ease;

  ${Item}:hover & {
    opacity: 1;
  }
`;
