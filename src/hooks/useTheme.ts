import { useCallback, useEffect, useState } from "react";
import { getSetting, setSetting } from "../settings";
import { applyTheme, type ThemeMode } from "../styles/theme";

export type { ThemeMode };

export function useTheme() {
  // 初值同步取自内存缓存（已在启动时由 initSettings 填充），无闪烁
  const [theme, setThemeState] = useState<ThemeMode>(() => getSetting("theme"));

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    void setSetting("theme", mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeMode = prev === "light" ? "dark" : "light";
      void setSetting("theme", next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}
