import { invoke, Channel } from "@tauri-apps/api/core";
import type { ProviderProfile } from "../settings";
import type { ChatMessage } from "./types";

/**
 * 前端 → Rust 的流式对话桥。
 *
 * Rust 的 `provider_chat` 命令通过一个 tauri Channel 逐条回推事件：
 *   { type: "delta", text }  —— 一段增量文本
 *   { type: "done" }         —— 正常结束
 *   { type: "error", message } —— 出错（网络 / HTTP / 解析）
 * 这里把它们翻成回调，屏蔽 Channel 细节，让 UI 只关心「来字 / 完了 / 错了」。
 */

/** Rust 侧 ChatEvent 的镜像（serde tag="type"） */
type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** 一轮历史消息：只取文本（P0 不带工具段） */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** 流式回调集合 */
export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * 把一条消息的所有文本段拼成单串（工具段暂时忽略）。
 * 空文本消息（比如只有工具调用的助手轮）会被上层过滤掉。
 */
function messageToText(msg: ChatMessage): string {
  return msg.segments
    .filter((s) => s.kind === "text")
    .map((s) => (s.kind === "text" ? s.text : ""))
    .join("")
    .trim();
}

/**
 * 把 UI 的消息列表压成 Rust 需要的 {role, content} 历史。
 * 丢掉空内容轮（无文本的助手轮），避免给模型塞空消息。
 */
export function toHistory(messages: ChatMessage[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const m of messages) {
    const content = messageToText(m);
    if (content) out.push({ role: m.role, content });
  }
  return out;
}

/**
 * 发起一次流式对话。返回 Promise：命令调用完成即 resolve
 * （真正的收尾由 onDone/onError 回调驱动，命令本身总是 Ok）。
 */
export async function streamChat(
  profile: ProviderProfile,
  history: ChatTurn[],
  handlers: StreamHandlers,
): Promise<void> {
  const channel = new Channel<ChatEvent>();
  channel.onmessage = (ev) => {
    if (ev.type === "delta") handlers.onDelta(ev.text);
    else if (ev.type === "done") handlers.onDone();
    else if (ev.type === "error") handlers.onError(ev.message);
  };
  await invoke("provider_chat", { profile, history, onEvent: channel });
}
