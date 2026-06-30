import { load, type Store } from "@tauri-apps/plugin-store";
import type { ThemeMode } from "./styles/theme";

export type { ThemeMode };

/** 所有持久化配置项集中在这里，新增配置时同步补默认值即可 */
export interface AppSettings {
  theme: ThemeMode;
}

/** 默认值：读取失败或缺失时回退到这里 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
};

const STORE_FILE = "settings.json";

let store: Store | null = null;
/** 内存缓存：启动时填充，供 UI 同步读取，避免异步导致的主题闪烁 */
let cache: AppSettings = { ...DEFAULT_SETTINGS };

/**
 * 启动时调用：从磁盘 store 读取全部配置到内存缓存。
 * 任何异常（含非 Tauri 环境）都会安全回退到默认值。
 */
export async function initSettings(): Promise<AppSettings> {
  try {
    store = await load(STORE_FILE, {
      autoSave: true,
      defaults: DEFAULT_SETTINGS as unknown as { [key: string]: unknown },
    });
    const loaded: Partial<AppSettings> = {};
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      const val = await store.get(key);
      if (val !== undefined && val !== null) {
        loaded[key] = val as AppSettings[typeof key];
      }
    }
    cache = { ...DEFAULT_SETTINGS, ...loaded };
  } catch (err) {
    console.warn("[settings] 读取失败，使用默认配置:", err);
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

/** 同步读取某项配置（来自内存缓存） */
export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return cache[key];
}

/** 写入某项配置：更新内存缓存并异步落盘（autoSave 开启） */
export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  cache[key] = value;
  try {
    if (store) await store.set(key, value);
  } catch (err) {
    console.warn(`[settings] 保存 ${String(key)} 失败:`, err);
  }
}
