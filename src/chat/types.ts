/**
 * 对话窗口的数据模型（UI 阶段：先定形状，后续接 Rust 命令 / Anthropic API 时复用）。
 *
 * agent 能操作整台电脑 → 消息不止「文本」，还会有「工具调用」段。
 * 所以一条 assistant 消息由若干「段（segment）」组成：文本段 + 工具调用段交替，
 * 这样流式渲染时能原样按顺序铺开（先说一句 → 调用工具 → 再接着说）。
 */

/** 消息角色 */
export type ChatRole = "user" | "assistant";

/**
 * 工具调用的执行状态（决定 UI 上的标记与配色）：
 *  - pending：等待用户审批（写/命令类工具，卡片显示「同意 / 拒绝」按钮）；
 *  - running：已放行、正在执行（状态点呼吸闪烁）；
 *  - success / error：执行完成 / 失败。
 */
export type ToolStatus = "pending" | "running" | "success" | "error";

/** 一次工具调用段：agent 操作电脑的一步（读文件 / 跑命令 / 点界面…） */
export interface ToolCallSegment {
  kind: "tool";
  /** 本轮请求内该次调用的唯一 id（Rust 侧生成），审批 / 状态更新按它回指 */
  id: string;
  /** 工具名，如 run_command / read_file / list_dir / write_file */
  name: string;
  /** 给人看的一句话摘要，如「执行 `ls -la`」 */
  summary: string;
  /** 调用参数的原始 JSON 串（跨轮重建 history 时回喂给模型；也用于 detail 展示） */
  args?: string;
  /** 可选：执行结果 / 输出预览（折叠区展示） */
  detail?: string;
  /** true 表示危险工具（写文件 / 跑命令），pending 时需人工审批放行 */
  needsApproval?: boolean;
  /** 子步骤日志（仅 subagent 段）：子 agent 运行中每一步在干嘛，逐行累积展示 */
  steps?: string[];
  status: ToolStatus;
}

/** 一段纯文本（assistant 的自然语言，或 user 的输入） */
export interface TextSegment {
  kind: "text";
  text: string;
}

/**
 * 一段思考文本：推理模型（DeepSeek R1 等）与正文分开下发的 reasoning 过程。
 * 渲染成可折叠的思考块（流式中展开、定稿后折叠）；不回喂给模型（跨轮历史跳过）。
 */
export interface ThinkingSegment {
  kind: "thinking";
  text: string;
}

export type MessageSegment = TextSegment | ToolCallSegment | ThinkingSegment;

/** 一条消息 */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** 由若干段组成（user 通常只有一个 text 段） */
  segments: MessageSegment[];
  /** 本地时间戳（ms）；渲染成 HH:MM */
  ts: number;
}

/** 一段会话（左侧历史列表的一项） */
export interface Conversation {
  id: string;
  title: string;
  /** 最近一条消息的预览文本（列表副标题） */
  preview: string;
  /** 最近活动时间戳（ms），用于列表排序与显示 */
  updatedAt: number;
  messages: ChatMessage[];
}

/** 把 ms 时间戳格式化成 HH:MM（本地时区，补零） */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** 相对日期标签：今天 / 昨天 / M月D日 —— 历史列表分组用 */
export function relativeDay(ts: number, now: number): string {
  const dayMs = 86_400_000;
  const startOf = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const diff = (startOf(now) - startOf(ts)) / dayMs;
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
