import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

/**
 * 防抖 + 按态缓存的尺寸观测 hook —— 供 PixelSurface / PixelFrame 换算网格用。
 *
 * 两种模式，解决两类抖动：
 *
 * 1) 无 sizeKey（默认，如标题栏 / 手动拖窗）——纯防抖：
 *    首帧立即测量；之后尺寸连续变化时只重置计时器，停稳 debounceMs 才提交，
 *    过渡/拖拽期间不逐帧重建网格。
 *
 * 2) 传 sizeKey（离散布局态，如侧栏「收起 / 展开」）——按态缓存 + 提前重建：
 *    内部按 key 缓存每个态「停稳后的尺寸」。key 一变，若该态已有缓存，
 *    **立即提交缓存的目标尺寸**（= 动画结束后的尺寸）——网格第一帧就重建成
 *    最终分辨率，剩下交给 SVG preserveAspectRatio=none 随 CSS 宽度过渡平滑缩放，
 *    全程无「粗像素突然变精细」的跳变。
 *    首次进入某个态还没缓存时退化为防抖停稳提交（该方向只跳一次，之后即热）。
 *    ResizeObserver 常驻刷新缓存，故拖窗改变尺寸后下次切态仍能自我校正。
 *
 * 另有 liveResize 开关（正交于上面两种模式）：针对「内容驱动的离散尺寸变化」
 *    （如 ToolCallBlock 点开/收起细节、气泡追加内容）——ResizeObserver 突发的
 *    **首帧就用 flushSync 同步提交**当前真实尺寸，网格当帧重建、viewBox 立即跟上，
 *    绘制不出「SVG 被 preserveAspectRatio 拉伸 → 1px 边框随之变粗/变细再回弹」的抖动帧。
 *    展开与收起两个方向都覆盖（首帧即到位）。连续拖窗只在起手同步一次，其余帧仍走
 *    防抖（拖拽期轻微拉伸可接受），故不会每帧 flushSync 拖垮性能。
 */
export function useElementSize<T extends Element>(
  ref: RefObject<T | null>,
  opts: { debounceMs?: number; sizeKey?: string | number; liveResize?: boolean } = {},
): { w: number; h: number } {
  const { debounceMs = 140, sizeKey, liveResize = false } = opts;

  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // sizeKey 放 ref：让常驻 observer 的 settle 闭包总能读到当前态，写对缓存桶
  const sizeKeyRef = useRef(sizeKey);
  sizeKeyRef.current = sizeKey;

  // 按态缓存「停稳尺寸」：key -> {w,h}
  const cacheRef = useRef<Map<string | number, { w: number; h: number }>>(
    new Map(),
  );

  const commit = (w: number, h: number) => {
    if (w === sizeRef.current.w && h === sizeRef.current.h) return;
    setSize({ w, h });
  };

  // 常驻观测 + 防抖：停稳后测量真实尺寸 → 写入当前态缓存 → 提交。
  // 依赖不含 sizeKey，避免每次切态重建 observer；切态由下方独立 effect 处理。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const settle = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const key = sizeKeyRef.current;
      if (key !== undefined) cacheRef.current.set(key, { w, h });
      commit(w, h);
    };
    settle(); // 首帧立即：初次挂载给个真实尺寸
    let timer = 0;
    let bursting = false; // 一次突发内是否已同步提交过首帧
    const onResize = () => {
      // liveResize：突发首帧同步提交（flushSync），viewBox 当帧跟上真实尺寸，
      // 不留「拉伸中 1px 边框变粗再回弹」的抖动帧。突发内后续帧仅重置防抖计时，
      // 停稳后再由 settle 落到最终尺寸——故拖窗只在起手同步一次，不逐帧 flushSync。
      if (liveResize && !bursting) {
        bursting = true;
        const w = el.clientWidth;
        const h = el.clientHeight;
        const key = sizeKeyRef.current;
        if (key !== undefined) cacheRef.current.set(key, { w, h });
        if (w !== sizeRef.current.w || h !== sizeRef.current.h) {
          flushSync(() => setSize({ w, h }));
        }
      }
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => {
        bursting = false; // 突发结束，下次变化重新允许同步首帧
        settle();
      }, debounceMs);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, debounceMs, liveResize]);

  // 切态：立即提交该态缓存的目标尺寸，让网格在动画开始就重建成最终分辨率，
  // 之后由 SVG 缩放平滑过渡。没缓存则不动，交给上面的防抖停稳提交（首次跳一次）。
  useLayoutEffect(() => {
    if (sizeKey === undefined) return;
    const cached = cacheRef.current.get(sizeKey);
    if (cached) commit(cached.w, cached.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeKey]);

  return size;
}
