import { load, type Store } from "@tauri-apps/plugin-store";
import type { Conversation } from "./types";

/**
 * 对话会话的持久化 store（独立文件 conversations.json）。
 *
 * 与 settings 分开：会话体量大、写入频率高（流式 delta），单独一个文件更清爽，
 * 也避免和设置项互相拖累落盘。模式沿用 settings.ts：
 *   - 启动时 initConversations() 把磁盘内容读进模块级缓存；
 *   - getConversations() 同步读缓存，供 UI 作 useState 初值（不闪空）；
 *   - persistConversations() 落盘（由 UI 侧防抖调用，合并高频 delta 写入）。
 */

const STORE_FILE = "conversations.json";
const KEY = "conversations";

let store: Store | null = null;
/** 内存缓存：启动填充，供 UI 同步读取 */
let cache: Conversation[] = [];

/**
 * 启动时调用：从磁盘读入全部会话到内存缓存。
 * 任何异常（含非 Tauri 环境）都安全回退到空列表。
 */
export async function initConversations(): Promise<Conversation[]> {
  try {
    store = await load(STORE_FILE, { autoSave: false, defaults: { [KEY]: [] } });
    const loaded = await store.get<Conversation[]>(KEY);
    cache = Array.isArray(loaded) ? loaded : [];
  } catch (err) {
    console.warn("[conversations] 读取失败，使用空列表:", err);
    cache = [];
  }
  return cache;
}

/** 同步读取全部会话（内存缓存） */
export function getConversations(): Conversation[] {
  return cache;
}

/**
 * 落盘：更新内存缓存并写磁盘。
 * 过滤掉 0 消息的空会话——「新建了没聊」的占位不进历史，保持列表干净。
 */
export async function persistConversations(list: Conversation[]): Promise<void> {
  cache = list;
  const kept = list.filter((c) => c.messages.length > 0);
  try {
    if (store) {
      await store.set(KEY, kept);
      await store.save();
    }
  } catch (err) {
    console.warn("[conversations] 保存失败:", err);
  }
}
