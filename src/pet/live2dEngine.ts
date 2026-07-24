import type { Application } from "pixi.js";
import type { Live2DModel } from "untitled-pixi-live2d-engine/cubism";
import { loadLive2DCore } from "./live2dCore";

type PixiModule = typeof import("pixi.js");
type CubismModule = typeof import("untitled-pixi-live2d-engine/cubism");

export type Live2DApplication = Application;
export type Live2DModelInstance = Live2DModel;

export interface Live2DEngine {
  PIXI: PixiModule;
  Cubism: CubismModule;
}

let engineLoad: Promise<Live2DEngine> | null = null;

/**
 * Live2D 的重依赖集中在这个异步模块中。正式构建会包含对应 chunk，但只有
 * 当前桌宠确实使用 live2d-cubism 时才加载 Pixi、Cubism Framework 与 Core。
 */
export async function loadLive2DEngine(): Promise<Live2DEngine> {
  await loadLive2DCore();
  if (!engineLoad) {
    engineLoad = (async () => {
      const PIXI = await import("pixi.js");
      const Cubism = await import("untitled-pixi-live2d-engine/cubism");
      // Pixi 8 的 Live2D Render Pipe 必须在创建 renderer 之前注册。
      PIXI.extensions.add(Cubism.Live2DPlugin);
      Cubism.config.sound = false;
      return { PIXI, Cubism };
    })().catch((error) => {
      engineLoad = null;
      throw error;
    });
  }
  return engineLoad;
}
