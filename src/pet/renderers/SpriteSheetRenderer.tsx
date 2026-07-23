import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PetAnimManager, type AnimDef } from "../animations";
import type { SpriteGeometry, SpritePetRuntime } from "../packages";
import type { PetBodyRect, PetRendererProps } from "./types";

type SpriteRendererProps = Omit<PetRendererProps, "runtime"> & {
  runtime: SpritePetRuntime;
};

// 解码后的图像与 Promise 都跨状态复用：既避免重复请求，也保证 drawImage 时
// HTMLImageElement 仍有强引用。资源 URL 包含包目录，不会在不同包间串缓存。
const spriteImageCache = new Map<string, HTMLImageElement>();
const spriteDecodeCache = new Map<string, Promise<HTMLImageElement>>();
const bodyRectCache = new Map<string, Promise<PetBodyRect>>();

function decodeSprite(src: string): Promise<HTMLImageElement> {
  const cached = spriteImageCache.get(src);
  if (cached) return Promise.resolve(cached);
  let ready = spriteDecodeCache.get(src);
  if (!ready) {
    ready = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      // asset:// 与 Vite 开发页是不同 origin；匿名 CORS 才能让命中区扫描读取像素。
      image.crossOrigin = "anonymous";
      image.decoding = "sync";
      image.onload = () => {
        const finish = () => {
          spriteImageCache.set(src, image);
          resolve(image);
        };
        if (typeof image.decode === "function") image.decode().then(finish, finish);
        else finish();
      };
      image.onerror = () => reject(new Error(`桌宠帧带加载失败：${src}`));
      image.src = src;
    });
    spriteDecodeCache.set(src, ready);
  }
  return ready;
}

/** Canvas 时钟独立于 React 渲染，只在业务动作或资源包变化时重启。 */
function useCanvasSpriteAnimation(
  def: AnimDef,
  geometry: SpriteGeometry,
  canvasRef: { readonly current: HTMLCanvasElement | null },
  onEnd: () => void,
): void {
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useLayoutEffect(() => {
    let alive = true;
    let raf = 0;
    let wakeTimer = 0;
    let lastFrame = -1;
    let finished = false;

    const start = (image: HTMLImageElement) => {
      if (!alive) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;

      const sequenceLength = Math.max(1, def.sequence.length);
      const frameMs = 1000 / Math.max(0.001, def.fps);
      const startedAt = performance.now();
      context.imageSmoothingEnabled = false;

      const drawSequenceIndex = (sequenceIndex: number) => {
        const candidate = def.sequence[sequenceIndex] ?? 0;
        const frame = candidate >= 0 && candidate < def.frames ? candidate : 0;
        if (frame === lastFrame) return;
        context.globalCompositeOperation = "copy";
        context.drawImage(
          image,
          frame * geometry.frameWidth,
          0,
          geometry.frameWidth,
          geometry.frameHeight,
          0,
          0,
          geometry.frameWidth,
          geometry.frameHeight,
        );
        context.globalCompositeOperation = "source-over";
        lastFrame = frame;
      };

      // layout effect 中同步落首帧，切状态后的第一次浏览器 paint 就有桌宠。
      drawSequenceIndex(0);
      const scheduleNext = () => {
        if (!alive) return;
        const now = performance.now();
        const nextIndex = Math.floor((now - startedAt) / frameMs) + 1;
        const nextAt = startedAt + nextIndex * frameMs;
        wakeTimer = window.setTimeout(() => {
          if (alive) raf = window.requestAnimationFrame(tick);
        }, Math.max(0, nextAt - now - 2));
      };
      const tick = (now: number) => {
        if (!alive) return;
        const elapsedIndex = Math.floor((now - startedAt) / frameMs);
        if (!def.loop && elapsedIndex >= sequenceLength) {
          drawSequenceIndex(sequenceLength - 1);
          if (!finished) {
            finished = true;
            onEndRef.current();
          }
          return;
        }
        drawSequenceIndex(def.loop ? elapsedIndex % sequenceLength : elapsedIndex);
        scheduleNext();
      };
      scheduleNext();
    };

    const image = spriteImageCache.get(def.src);
    if (image) start(image);
    else void decodeSprite(def.src).then(start).catch((error) => console.warn(error));
    return () => {
      alive = false;
      window.clearTimeout(wakeTimer);
      window.cancelAnimationFrame(raf);
    };
  }, [canvasRef, def, geometry]);
}

/** 扫描整条帧带的非透明像素并集，得到换帧时不会跳动的交互矩形。 */
function spriteBodyRect(
  src: string,
  geometry: SpriteGeometry,
): Promise<PetBodyRect> {
  const cacheKey = `${geometry.frameWidth}x${geometry.frameHeight}:${src}`;
  let ready = bodyRectCache.get(cacheKey);
  if (!ready) {
    ready = new Promise<PetBodyRect>((resolve) => {
      const full = {
        x: 0,
        y: 0,
        w: geometry.frameWidth,
        h: geometry.frameHeight,
      };
      void decodeSprite(src)
        .then((image) => {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d");
          if (!context) {
            resolve(full);
            return;
          }
          context.drawImage(image, 0, 0);
          let data: Uint8ClampedArray;
          try {
            data = context.getImageData(0, 0, canvas.width, canvas.height).data;
          } catch (error) {
            console.warn("桌宠帧带命中区扫描失败，按整帧兜底:", error);
            resolve(full);
            return;
          }

          let x0 = geometry.frameWidth;
          let y0 = geometry.frameHeight;
          let x1 = -1;
          let y1 = -1;
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              if (data[(y * canvas.width + x) * 4 + 3] === 0) continue;
              const frameX = x % geometry.frameWidth;
              const frameY = y % geometry.frameHeight;
              if (frameX < x0) x0 = frameX;
              if (frameX > x1) x1 = frameX;
              if (frameY < y0) y0 = frameY;
              if (frameY > y1) y1 = frameY;
            }
          }
          resolve(
            x1 < 0
              ? full
              : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
          );
        })
        .catch(() => resolve(full));
    });
    bodyRectCache.set(cacheKey, ready);
  }
  return ready;
}

/** 像素帧带引擎：选变体、预解码、原子切图、播放和命中扫描全部封装在此。 */
export function SpriteSheetRenderer({
  runtime,
  state,
  ariaLabel,
  onAnimationEnd,
  onRenderedStateChange,
  onBodyRectChange,
}: SpriteRendererProps) {
  const manager = useMemo(
    () => new PetAnimManager(runtime.registry),
    [runtime.registry],
  );
  const desired = useMemo(() => manager.pick(state), [manager, state]);
  const [rendered, setRendered] = useState(() => ({ state, def: desired }));

  // 新帧带解码好才原子替换；加载期间 Canvas 保留上一条动画的最后可见帧。
  useEffect(() => {
    if (rendered.state === state && rendered.def === desired) return;
    let alive = true;
    void decodeSprite(desired.src)
      .then(() => {
        if (alive) setRendered({ state, def: desired });
      })
      .catch((error) => console.warn(error));
    return () => {
      alive = false;
    };
  }, [desired, rendered.def, rendered.state, state]);

  useEffect(() => {
    for (const variants of manager.definitions()) {
      for (const definition of variants) {
        void decodeSprite(definition.src).catch((error) => console.warn(error));
      }
    }
  }, [manager]);

  useEffect(() => {
    onRenderedStateChange(rendered.state);
  }, [onRenderedStateChange, rendered.state]);

  useEffect(() => {
    let alive = true;
    void spriteBodyRect(rendered.def.src, runtime.geometry).then((rect) => {
      if (alive) onBodyRectChange(rect);
    });
    return () => {
      alive = false;
    };
  }, [onBodyRectChange, rendered.def, runtime.geometry]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  useCanvasSpriteAnimation(rendered.def, runtime.geometry, canvasRef, () => {
    onAnimationEnd({ state: rendered.state, next: rendered.def.next });
  });

  return (
    <canvas
      ref={canvasRef}
      width={runtime.geometry.frameWidth}
      height={runtime.geometry.frameHeight}
      role="img"
      aria-label={ariaLabel}
      style={{
        display: "block",
        width: runtime.geometry.frameWidth * runtime.geometry.scale,
        height: runtime.geometry.frameHeight * runtime.geometry.scale,
        imageRendering: "pixelated",
      }}
    />
  );
}
