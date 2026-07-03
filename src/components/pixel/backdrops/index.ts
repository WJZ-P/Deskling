import type { BackdropStyle, BackdropStyleId } from "./types";
import { turbulence } from "./turbulence";
import { curlFlow } from "./curlFlow";
import { reaction } from "./reaction";
import { cellular } from "./cellular";

export type { BackdropStyle, BackdropStyleId, BackdropRenderer } from "./types";

/** 所有背景风格注册表（顺序即设置里的展示顺序）。默认取第一个（湍流）。 */
export const BACKDROP_STYLES: BackdropStyle[] = [turbulence, curlFlow, reaction, cellular];

export const DEFAULT_BACKDROP: BackdropStyleId = "turbulence";

const STYLE_MAP: Record<BackdropStyleId, BackdropStyle> = {
  turbulence,
  curlFlow,
  reaction,
  cellular,
};

export function getBackdropStyle(id: BackdropStyleId): BackdropStyle {
  return STYLE_MAP[id] ?? turbulence;
}
