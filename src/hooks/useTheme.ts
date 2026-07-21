import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  getSetting,
  setSetting,
  subscribeThemeSetting,
} from "../settings";
import { applyTheme, type ThemeMode } from "../styles/theme";

export type { ThemeMode };

export function useTheme() {
  // 初值同步取自内存缓存（已在启动时由 initSettings 填充），无闪烁
  const [theme, setThemeState] = useState<ThemeMode>(() => getSetting("theme"));

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(
    () =>
      subscribeThemeSetting((next) => {
        applyTheme(next);
        setThemeState(next);
      }),
    [],
  );

  const setTheme = useCallback((mode: ThemeMode) => {
    applyTheme(mode);
    setThemeState(mode);
    void setSetting("theme", mode);
  }, []);

  const toggleTheme = useCallback(() => {
    const next: ThemeMode = getSetting("theme") === "light" ? "dark" : "light";
    applyTheme(next);
    setThemeState(next);
    void setSetting("theme", next);
  }, []);

  return { theme, setTheme, toggleTheme };
}
