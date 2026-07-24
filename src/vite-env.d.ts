/// <reference types="vite/client" />

declare module "deskling-live2d-engine-runtime" {
  export type Live2DApplication = import("pixi.js").Application;
  export type Live2DModelInstance =
    import("untitled-pixi-live2d-engine/cubism").Live2DModel;

  export interface Live2DEngine {
    PIXI: typeof import("pixi.js");
    Cubism: typeof import("untitled-pixi-live2d-engine/cubism");
  }

  export function loadLive2DEngine(): Promise<Live2DEngine>;
}
