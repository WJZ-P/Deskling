import { invoke } from "@tauri-apps/api/core";

export interface Live2DCoreStatus {
  installed: boolean;
  source: "bundled" | "override" | "missing";
  overrideInstalled: boolean;
  path: string;
  sizeBytes?: number;
  error?: string;
}

interface CubismCoreGlobal {
  Version?: {
    csmGetVersion?: () => number;
  };
}

declare global {
  var Live2DCubismCore: CubismCoreGlobal | undefined;
}

let coreLoad: Promise<CubismCoreGlobal> | null = null;

export function getLoadedLive2DCore(): CubismCoreGlobal | null {
  return globalThis.Live2DCubismCore ?? null;
}

/**
 * 从 Rust 侧读取内置 Core（或用户安装的新版覆盖）再以普通 script 执行。这里
 * 不能改成 `new Function`：script 标签更接近官方 Web SDK 的加载方式，也不需要
 * unsafe-eval。
 */
export function loadLive2DCore(): Promise<CubismCoreGlobal> {
  const loaded = getLoadedLive2DCore();
  if (loaded) return Promise.resolve(loaded);
  if (coreLoad) return coreLoad;

  coreLoad = invoke<string>("live2d_core_source")
    .then((source) => {
      const script = document.createElement("script");
      script.dataset.desklingLive2dCore = "true";
      script.text = `${source}\n//# sourceURL=deskling-live2dcubismcore.min.js`;
      document.head.appendChild(script);
      script.remove();

      const core = getLoadedLive2DCore();
      if (!core?.Version?.csmGetVersion) {
        throw new Error("Cubism Core 已执行，但没有导出 Live2DCubismCore.Version");
      }
      return core;
    })
    .catch((error) => {
      coreLoad = null;
      throw error;
    });
  return coreLoad;
}

/** 导入或移除后让下一次挂载重新检查；已经执行进 WebView 的脚本无法安全卸载。 */
export function resetLive2DCoreLoader(): void {
  coreLoad = null;
}
