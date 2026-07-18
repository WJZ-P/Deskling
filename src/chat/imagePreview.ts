import { invoke } from "@tauri-apps/api/core";

/**
 * 图片预览缓存：本地路径 → data URL（Rust image_preview 命令读文件 base64）。
 * 同一路径全应用只读一次——作曲区缩略图、消息气泡、历史回看共享；失败也缓存
 * （文件被删/超限时别每次渲染都白跑一趟 IPC），失败值为 null。
 */
const cache = new Map<string, Promise<string | null>>();

export function imagePreview(path: string): Promise<string | null> {
  let hit = cache.get(path);
  if (!hit) {
    hit = invoke<string>("image_preview", { path }).catch(() => null);
    cache.set(path, hit);
  }
  return hit;
}

/** 支持的位图扩展名判定（拖放分流：图片进附件条，其余走文件投喂）。
    与 Rust 侧 image_mime 同一份名单；BMP 三家协议都不收，不算图片 */
export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(path);
}
