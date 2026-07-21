import { useSyncExternalStore } from "react";
import {
  getAppliedTheme,
  subscribeAppliedTheme,
  type ThemeMode,
} from "../styles/theme";

/**
 * 读取真正作用在当前 WebView 上的主题。
 *
 * 普通 CSS 会自动响应变量变化，但像素组件会把色值预先烘焙进 SVG rect、Canvas
 * 和 WebGL uniform，因此也需要一次 React 更新来重建颜色数据。
 */
export function useAppliedTheme(): ThemeMode {
  return useSyncExternalStore(
    subscribeAppliedTheme,
    getAppliedTheme,
    () => "light",
  );
}
