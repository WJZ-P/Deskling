import { useEffect, useRef, useState } from "react";
import {
  loadLive2DEngine,
  type Live2DApplication,
  type Live2DModelInstance,
} from "deskling-live2d-engine-runtime";
import { ANIMS, type AnimDef, type PetState } from "../animations";
import type {
  Live2DCubismRuntime,
  PetPackageCubismMotion,
} from "../packages";
import type { PetBodyRect, PetRendererProps } from "./types";

type Live2DRendererProps = Omit<PetRendererProps, "runtime"> & {
  runtime: Live2DCubismRuntime;
};

const COMMON_GROUPS: Partial<Record<PetState, readonly string[]>> = {
  idle: ["Idle"],
  idleLook: ["Look", "Idle"],
  idleGroom: ["Groom", "TapBody"],
  idleScratch: ["Scratch", "TapBody"],
  idleSneeze: ["Sneeze", "TapBody"],
  idleAlert: ["Surprised", "TapBody"],
  talking: ["Talk", "Talking", "TapBody"],
  listening: ["Listen", "Listening", "Idle"],
  thinking: ["Think", "Thinking", "Idle"],
  typing: ["Type", "Typing", "TapBody"],
  searching: ["Search", "Searching", "TapBody"],
  waitingApproval: ["Wait", "Thinking", "Idle"],
  success: ["Happy", "Success", "TapBody"],
  error: ["Sad", "Error", "TapBody"],
  petted: ["TapHead", "FlickHead", "TapBody"],
  eating: ["Eat", "TapBody"],
  sleeping: ["Sleep", "Sleeping", "Idle"],
  yawning: ["Yawn", "TapBody"],
  stretching: ["Stretch", "TapBody"],
  wakingStartled: ["Surprised", "TapBody"],
  wakingDream: ["Happy", "TapBody"],
  walking: ["Walk", "Walking", "Idle"],
  walkingLeft: ["Walk", "Walking", "Idle"],
  walkingRight: ["Walk", "Walking", "Idle"],
  walkingUp: ["Walk", "Walking", "Idle"],
  walkingDown: ["Walk", "Walking", "Idle"],
  entering: ["Appear", "Greeting", "TapBody"],
  greeting: ["Greeting", "TapBody"],
};

function semanticAnimation(state: PetState): AnimDef {
  return (ANIMS[state] as readonly AnimDef[])[0];
}

function semanticDurationMs(state: PetState): number {
  const semantic = semanticAnimation(state);
  return (
    (Math.max(1, semantic.sequence.length) / Math.max(0.001, semantic.fps)) *
    1000
  );
}

function randomVariant<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null;
  return values[Math.floor(Math.random() * values.length)] ?? null;
}

function resolveGroup(
  model: Live2DModelInstance,
  requested: string,
): string | null {
  const definitions = model.internalModel.motionManager.definitions;
  const groups = Object.keys(definitions);
  return (
    groups.find((group) => group === requested) ??
    groups.find((group) => group.toLowerCase() === requested.toLowerCase()) ??
    null
  );
}

function chooseBinding(
  runtime: Live2DCubismRuntime,
  state: PetState,
  model: Live2DModelInstance,
): PetPackageCubismMotion | null {
  const declared = runtime.motionMap[state] ?? [];
  if (declared.length > 0) {
    const picked = randomVariant(declared);
    if (!picked) return null;
    const group = picked.group ? resolveGroup(model, picked.group) : null;
    return { ...picked, group: group ?? picked.group };
  }

  const idleGroup = model.internalModel.motionManager.groups.idle;
  const candidates = COMMON_GROUPS[state] ?? [idleGroup];
  for (const candidate of candidates) {
    const group = resolveGroup(model, candidate);
    if (group) return { group };
  }
  const fallback = resolveGroup(model, idleGroup);
  return fallback ? { group: fallback } : null;
}

function clampBodyRect(
  rect: PetBodyRect,
  width: number,
  height: number,
): PetBodyRect {
  const x = Math.max(0, Math.min(width, rect.x));
  const y = Math.max(0, Math.min(height, rect.y));
  const right = Math.max(x, Math.min(width, rect.x + rect.w));
  const bottom = Math.max(y, Math.min(height, rect.y + rect.h));
  return { x, y, w: right - x, h: bottom - y };
}

function placeModel(
  model: Live2DModelInstance,
  runtime: Live2DCubismRuntime,
): PetBodyRect {
  const { frameWidth, frameHeight, groundY } = runtime.geometry;
  model.anchor.set(0.5, 1);
  model.scale.set(1);
  const natural = model.getLocalBounds();
  const naturalWidth = Math.max(1, natural.width);
  const naturalHeight = Math.max(1, natural.height);
  const availableHeight = Math.max(1, Math.min(frameHeight, groundY));
  const fit =
    Math.min(frameWidth / naturalWidth, availableHeight / naturalHeight) *
    runtime.modelScale;
  model.scale.set(fit);
  model.position.set(
    frameWidth / 2 + runtime.offsetX,
    groundY + runtime.offsetY,
  );
  model.updateTransform({});

  const bounds = model.getBounds();
  const body = clampBodyRect(
    { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
    frameWidth,
    frameHeight,
  );
  return body.w > 0 && body.h > 0
    ? body
    : { x: 0, y: 0, w: frameWidth, h: frameHeight };
}

/**
 * Pixi Application 会先销毁 ticker plugin、再递归销毁 stage；Live2DModel 的
 * automator 却会在自身 destroy 时从 ticker 注销。让 Application 直接递归清理
 * 会因此访问已经拆掉的 ticker 链表。必须先把模型移出 stage 并销毁，再释放
 * Application；纹理由 Pixi Assets 缓存持有，不在这里越权 destroy。
 */
function disposeLive2D(
  app: Live2DApplication | null,
  model: Live2DModelInstance | null,
): void {
  if (model) {
    try {
      app?.stage.removeChild(model);
    } catch {
      // 初始化半途失败时，模型可能尚未加入 stage。
    }
    try {
      model.destroy({ children: true });
    } catch (error) {
      console.warn("[live2d] 模型资源释放失败:", error);
    }
  }
  if (app) {
    try {
      app.destroy(false, {
        children: false,
        texture: false,
        textureSource: false,
        context: true,
      });
    } catch (error) {
      console.warn("[live2d] Pixi Application 释放失败:", error);
    }
  }
}

/**
 * Cubism 只负责“怎么画”；桌宠行为、优先级与窗口移动仍由 PetWindow 的统一状态机控制。
 * Core/模型加载期间预览图始终垫在画布后面，等 WebGL 连续画出两帧后才原子切换。
 */
export function Live2DCubismRenderer({
  runtime,
  state,
  ariaLabel,
  onAnimationEnd,
  onRenderedStateChange,
  onBodyRectChange,
}: Live2DRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<Live2DModelInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    onBodyRectChange({
      x: 0,
      y: 0,
      w: runtime.geometry.frameWidth,
      h: runtime.geometry.frameHeight,
    });
  }, [onBodyRectChange, runtime.geometry]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    let app: Live2DApplication | null = null;
    let loadedModel: Live2DModelInstance | null = null;
    let revealFrame = 0;

    setReady(false);
    setLoadError(null);
    modelRef.current = null;

    void loadLive2DEngine()
      .then(async ({ PIXI, Cubism }) => {
        if (!alive) return;
        const createdApp = new PIXI.Application();
        try {
          await createdApp.init({
            canvas,
            width: runtime.geometry.frameWidth,
            height: runtime.geometry.frameHeight,
            resolution: Math.max(1, window.devicePixelRatio),
            autoDensity: true,
            antialias: true,
            backgroundAlpha: 0,
            preference: "webgl",
          });
        } catch (error) {
          disposeLive2D(createdApp, null);
          throw error;
        }
        if (!alive) {
          disposeLive2D(createdApp, null);
          return;
        }
        app = createdApp;
        canvas.style.width = `${runtime.geometry.frameWidth * runtime.geometry.scale}px`;
        canvas.style.height = `${runtime.geometry.frameHeight * runtime.geometry.scale}px`;

        loadedModel = await Cubism.Live2DModel.from(runtime.entryUrl, {
          ticker: app.ticker,
          autoFocus: false,
          autoHitTest: false,
          crossOrigin: "anonymous",
          // 启动时先把 Motion 载齐，避免首次切状态时网络加载导致旧动作反抢新动作。
          motionPreload: Cubism.MotionPreloadStrategy.ALL,
        });
        if (!alive || !app) {
          disposeLive2D(app, loadedModel);
          app = null;
          loadedModel = null;
          return;
        }
        loadedModel.eventMode = "none";
        app.stage.addChild(loadedModel);
        modelRef.current = loadedModel;
        onBodyRectChange(placeModel(loadedModel, runtime));
        app.render();

        // 第一帧可能只完成纹理上传；第二帧确认模型已经真正进入透明画布。
        revealFrame = window.requestAnimationFrame(() => {
          revealFrame = window.requestAnimationFrame(() => {
            if (alive) setReady(true);
          });
        });
      })
      .catch((error) => {
        disposeLive2D(app, loadedModel);
        app = null;
        loadedModel = null;
        modelRef.current = null;
        if (!alive) return;
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[live2d] 模型渲染器启动失败:", error);
        setLoadError(message);
      });

    return () => {
      alive = false;
      window.cancelAnimationFrame(revealFrame);
      modelRef.current = null;
      // 模型仍在异步加载时暂留 Application；加载 Promise 收尾后会按“模型 →
      // ticker/Application”的正确顺序统一释放，避免 automator 访问死 ticker。
      if (loadedModel) {
        disposeLive2D(app, loadedModel);
        app = null;
        loadedModel = null;
      }
    };
  }, [onBodyRectChange, runtime]);

  useEffect(() => {
    onRenderedStateChange(state);
  }, [onRenderedStateChange, state]);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const semantic = semanticAnimation(state);
    const model = ready ? modelRef.current : null;
    const finish = (next?: string) => {
      if (!alive) return;
      alive = false;
      onAnimationEnd({ state, next: next ?? semantic.next });
    };

    if (!model) {
      if (!semantic.loop) {
        timer = window.setTimeout(() => finish(), semanticDurationMs(state));
      }
      return () => {
        alive = false;
        window.clearTimeout(timer);
      };
    }

    const binding = chooseBinding(runtime, state, model);
    const loop = binding?.loop ?? semantic.loop;
    // Rust 的 Option 字段经 IPC 会以 `null` 出现；Cubism 把 `null` index 当成
    // “指定了一个不存在的下标”，只有真正的 `undefined` 才会随机抽该组动作。
    const configuredDuration = binding?.durationMs ?? undefined;
    const duration = configuredDuration ?? semanticDurationMs(state);
    const next = binding?.next ?? semantic.next;

    void (async () => {
      if (binding?.expression) {
        await model.expression(binding.expression).catch((error) => {
          console.warn(
            `[live2d] expression ${binding.expression} 播放失败:`,
            error,
          );
          return false;
        });
      }
      if (!alive) return;

      const requestedGroup = binding?.group ?? undefined;
      const motionIndex = binding?.index ?? undefined;
      if (!requestedGroup) {
        if (!loop) timer = window.setTimeout(() => finish(next), duration);
        return;
      }
      const { Cubism } = await loadLive2DEngine();
      if (!alive) return;
      const priority =
        state === "idle"
          ? Cubism.MotionPriority.IDLE
          : Cubism.MotionPriority.FORCE;
      const started = await model
        .motion(requestedGroup, motionIndex, priority, {
          loop,
          onFinish: () => {
            if (configuredDuration === undefined) {
              window.clearTimeout(timer);
              finish(next);
            }
          },
        })
        .catch((error) => {
          console.warn(`[live2d] motion ${requestedGroup} 播放失败:`, error);
          return false;
        });
      if (!alive || loop) return;
      if (!started) {
        timer = window.setTimeout(() => finish(next), duration);
        return;
      }
      timer = window.setTimeout(
        () => finish(next),
        configuredDuration ??
          Math.max(1200, Math.min(12000, duration * 2)),
      );
    })();

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [onAnimationEnd, ready, runtime, state]);

  const width = runtime.geometry.frameWidth * runtime.geometry.scale;
  const height = runtime.geometry.frameHeight * runtime.geometry.scale;
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      data-live2d-ready={ready || undefined}
      data-live2d-error={loadError || undefined}
      title={loadError ?? undefined}
      style={{
        position: "relative",
        display: "block",
        width,
        height,
      }}
    >
      <img
        src={runtime.previewUrl ?? "/pet/xuebao-preview.png"}
        alt=""
        aria-hidden
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          width,
          height,
          objectFit: "contain",
          visibility: ready ? "hidden" : "visible",
        }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          width,
          height,
          opacity: ready ? 1 : 0,
        }}
      />
    </div>
  );
}
