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
 * 清洗加载进来的会话：把上次运行没收尾的工具段（pending/running）落定成 error。
 * 应用中途退出时防抖落盘可能存下未定稿状态，重启后对应的 agent loop 早已不在，
 * 不清洗的话审批按钮/呼吸闪烁会永远悬在历史里。
 */
function sanitize(list: Conversation[]): Conversation[] {
  return list.map((c) => ({
    ...c,
    messages: c.messages.map((m) => ({
      ...m,
      segments: m.segments.map((s) =>
        s.kind === "tool" && (s.status === "pending" || s.status === "running")
          ? { ...s, status: "error" as const, detail: s.detail ?? "已中断（应用重启）" }
          : s,
      ),
    })),
  }));
}

/**
 * 启动时调用：从磁盘读入全部会话到内存缓存。
 * 任何异常（含非 Tauri 环境）都安全回退到空列表。
 */
export async function initConversations(): Promise<Conversation[]> {
  try {
    store = await load(STORE_FILE, { autoSave: false, defaults: { [KEY]: [] } });
    const loaded = await store.get<Conversation[]>(KEY);
    cache = Array.isArray(loaded) ? sanitize(loaded) : [];
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
