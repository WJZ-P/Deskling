import type { PetState } from "../animations";
import type { PetAppearanceRuntime } from "../packages";

/** 渲染器报告的桌宠可交互区域，坐标使用各自逻辑帧空间。 */
export interface PetBodyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一次性动作结束时交给共享状态机的信息。 */
export interface PetAnimationEnd {
  state: PetState;
  next?: string;
}

export interface PetRendererProps {
  runtime: PetAppearanceRuntime;
  state: PetState;
  ariaLabel: string;
  onAnimationEnd: (event: PetAnimationEnd) => void;
  onRenderedStateChange: (state: PetState) => void;
  onBodyRectChange: (rect: PetBodyRect) => void;
}
