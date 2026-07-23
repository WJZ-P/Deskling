import { DeferredPuppetRenderer } from "./DeferredPuppetRenderer";
import { SpriteSheetRenderer } from "./SpriteSheetRenderer";
import type { PetRendererProps } from "./types";

/** appearance.type 的唯一分发点；共享桌宠窗口不引用任何具体 SDK。 */
export function PetRenderer(props: PetRendererProps) {
  switch (props.runtime.type) {
    case "sprite-sheet":
      return <SpriteSheetRenderer {...props} runtime={props.runtime} />;
    case "live2d-cubism":
    case "inochi2d":
      return <DeferredPuppetRenderer {...props} runtime={props.runtime} />;
  }
}

export type { PetAnimationEnd, PetBodyRect } from "./types";
