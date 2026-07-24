import { useEffect } from "react";
import { ANIMS, type AnimDef } from "../animations";
import type {
  DeferredPuppetRuntime,
  Live2DCubismRuntime,
} from "../packages";
import type { PetRendererProps } from "./types";

type DeferredRendererProps = Omit<PetRendererProps, "runtime"> & {
  runtime: DeferredPuppetRuntime | Live2DCubismRuntime;
};

/**
 * 已识别但未随当前构建提供的木偶引擎。保留预览图与完整状态机时序，避免误选包
 * 后窗口变成空白；真正的 Cubism/Inochi2D 组件接入时直接替换这个分支。
 */
export function DeferredPuppetRenderer({
  runtime,
  state,
  ariaLabel,
  onAnimationEnd,
  onRenderedStateChange,
  onBodyRectChange,
}: DeferredRendererProps) {
  useEffect(() => {
    console.warn(
      `[pet-renderer] ${runtime.unavailableReason ?? "当前渲染器不可用"}`,
    );
  }, [runtime.unavailableReason]);

  useEffect(() => {
    onBodyRectChange({
      x: 0,
      y: 0,
      w: runtime.geometry.frameWidth,
      h: runtime.geometry.frameHeight,
    });
  }, [onBodyRectChange, runtime.geometry]);

  useEffect(() => {
    onRenderedStateChange(state);
    const semantic = (ANIMS[state] as readonly AnimDef[])[0];
    if (semantic.loop) return;
    const duration =
      (Math.max(1, semantic.sequence.length) / Math.max(0.001, semantic.fps)) *
      1000;
    const timer = window.setTimeout(() => {
      onAnimationEnd({ state, next: semantic.next });
    }, duration);
    return () => window.clearTimeout(timer);
  }, [onAnimationEnd, onRenderedStateChange, state]);

  return runtime.previewUrl ? (
    <img
      src={runtime.previewUrl}
      alt={ariaLabel}
      draggable={false}
      style={{
        display: "block",
        width: runtime.geometry.frameWidth * runtime.geometry.scale,
        height: runtime.geometry.frameHeight * runtime.geometry.scale,
        objectFit: "contain",
      }}
    />
  ) : (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{
        width: runtime.geometry.frameWidth * runtime.geometry.scale,
        height: runtime.geometry.frameHeight * runtime.geometry.scale,
      }}
    />
  );
}
