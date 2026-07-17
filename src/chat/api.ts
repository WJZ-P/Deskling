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

/**
 * Rust 侧 ChatEvent 的镜像（serde tag="type", camelCase）。
 * 文本流之外多了两个工具事件：
 *  - toolStart：模型要调一个工具（Rust 已解析出 name+参数）。needsApproval=true 的
 *    危险工具此刻进入 pending 态、等前端审批；否则直接 running 开始执行。
 *  - toolEnd：该工具执行收尾（success/error），detail 带结果/输出预览。
 */
type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolStart"; id: string; name: string; summary: string; args: string; needsApproval: boolean }
  | { type: "toolEnd"; id: string; status: "success" | "error"; detail: string }
  | { type: "subagentStep"; id: string; line: string }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * 一轮历史消息（发给 Rust 的对话上下文）：仍是 {role, content} 纯文本。
 * agent 单轮内的多步（工具调用/结果）由 Rust 在 loop 里用结构化 tool_use/tool_result
 * 消息处理；跨轮历史这里把已完成的工具调用折叠成一行可读文本回喂给模型，
 * 避免三家协议各自严格的 tool_call_id 校验（重建稍有偏差就 400）。
 */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** 流式回调集合 */
export interface StreamHandlers {
  onDelta: (text: string) => void;
  /** 一段思考增量（推理模型的 reasoning，先于正文到达）：追加进思考段 */
  onThinking: (text: string) => void;
  /** 一个工具调用开始：据 needsApproval 决定落成 pending（待审批）还是 running */
  onToolStart: (call: {
    id: string;
    name: string;
    summary: string;
    args: string;
    needsApproval: boolean;
  }) => void;
  /** 一个工具调用收尾：更新对应段的状态与结果 detail */
  onToolEnd: (end: { id: string; status: "success" | "error"; detail: string }) => void;
  /** 子 agent（subagent 工具）执行中的一步进展：追加进对应工具段的子步骤日志 */
  onSubagentStep: (step: { id: string; line: string }) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * 把一条消息压成给模型的纯文本。
 *  - 文本段原样拼接；
 *  - 已完成的工具段（success/error）折叠成一行「调用 + 结果」摘要，作为跨轮上下文；
 *  - pending/running（未定稿）的工具段忽略；
 *  - 思考段整个跳过——reasoning 不该回喂给模型（烧 token 且污染上下文）。
 */
function messageToText(msg: ChatMessage): string {
  const parts: string[] = [];
  for (const s of msg.segments) {
    if (s.kind === "text") {
      if (s.text) parts.push(s.text);
    } else if (s.kind === "tool" && (s.status === "success" || s.status === "error")) {
      // 存档记录口吻：这段文字会作为跨轮历史喂回模型，若写成「调用工具 …」
      // 模型会在正文里手写同款格式冒充真调用（system prompt 的工具调用规范
      // 与此呼应）——措辞必须一眼是「过去的记录」而非「可模仿的动作」
      const args = s.args ? `(${s.args})` : "";
      const result = s.detail ? `\n结果: ${s.detail}` : "";
      const tag = s.status === "error" ? "工具调用记录·失败" : "工具调用记录";
      parts.push(`[${tag} ${s.name}${args}${result}]`);
    }
  }
  return parts.join("\n").trim();
}

/**
 * 把 UI 的消息列表压成 Rust 需要的 {role, content} 历史。
 * 丢掉空内容轮（无文本、无已完成工具的助手轮），避免给模型塞空消息。
 */
export function toHistory(messages: ChatMessage[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const m of messages) {
    const content = messageToText(m);
    if (!content) continue;
    // 语音输入的用户消息：只在发给模型的正文上拼标记（离线识别可能有同音/
    // 断句误差，提示模型别太抠字面）；UI 气泡不显示前缀，用声波条标识
    const tagged =
      m.voice && m.role === "user" ? `(语音输入) ${content}` : content;
    out.push({ role: m.role, content: tagged });
  }
  return out;
}

/** 一次在途流式请求的句柄：cancel() 暂停，approve() 放行/拒绝一次待审批的工具调用。 */
export interface ChatStream {
  /** 请求 Rust 侧终止这次流（下一次读流查标志即收尾）。 */
  cancel: () => void;
  /**
   * 对一次 pending 的工具调用作答：approved=true 放行执行，false 拒绝。
   * 唤醒 Rust 侧阻塞等待审批的 agent loop（幂等：重复/迟到的作答被忽略）。
   */
  approve: (toolCallId: string, approved: boolean) => void;
}

// 每次请求的唯一 id：给 Rust 侧登记取消标志用（一次运行内唯一即可）
let reqSeq = 0;
const nextRequestId = () => `chat-${Date.now()}-${reqSeq++}`;

/**
 * 发起一次流式对话。同步返回一个句柄（含 cancel），
 * 底层命令调用在后台进行：真正的收尾由 onDone/onError 回调驱动。
 * 点「暂停」时调 handle.cancel() → Rust 置取消标志 → 读流循环收尾发 Done。
 */
export function streamChat(
  profile: ProviderProfile,
  history: ChatTurn[],
  handlers: StreamHandlers,
  /** 危险工具（写/命令）免审批直接执行；由设置「免审批执行」开关决定 */
  autoApprove: boolean,
  /** 深度思考：Anthropic/Gemini 请求思考过程下发（输入框操作栏开关决定） */
  thinking: boolean,
  /** 并发上限：一轮内多个工具调用最多同时跑几个（设置项；Rust 侧 clamp 到 1..=20） */
  concurrency: number,
  /** 人设/系统提示词（当前桌宠档案的 prompt）：只在对话开头注入一次；null/空白不注入 */
  system: string | null,
): ChatStream {
  const requestId = nextRequestId();
  const channel = new Channel<ChatEvent>();
  channel.onmessage = (ev) => {
    if (ev.type === "delta") handlers.onDelta(ev.text);
    else if (ev.type === "thinking") handlers.onThinking(ev.text);
    else if (ev.type === "toolStart")
      handlers.onToolStart({
        id: ev.id,
        name: ev.name,
        summary: ev.summary,
        args: ev.args,
        needsApproval: ev.needsApproval,
      });
    else if (ev.type === "toolEnd")
      handlers.onToolEnd({ id: ev.id, status: ev.status, detail: ev.detail });
    else if (ev.type === "subagentStep")
      handlers.onSubagentStep({ id: ev.id, line: ev.line });
    else if (ev.type === "done") handlers.onDone();
    else if (ev.type === "error") handlers.onError(ev.message);
  };
  // 后台发起；命令自身总是 Ok，异常仅可能来自 IPC 层，兜底转成 onError
  void invoke("provider_chat", {
    requestId,
    profile,
    history,
    autoApprove,
    thinking,
    concurrency,
    system,
    onEvent: channel,
  }).catch((err) => handlers.onError(String(err)));
  return {
    cancel: () => {
      void invoke("provider_chat_cancel", { requestId }).catch(() => {});
    },
    approve: (toolCallId: string, approved: boolean) => {
      void invoke("provider_tool_approve", { requestId, toolCallId, approved }).catch(
        () => {},
      );
    },
  };
}
