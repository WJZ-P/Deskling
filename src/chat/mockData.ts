import type { Conversation } from "./types";

/**
 * UI 阶段的占位会话数据（后续接真实持久化 / API 时整体替换）。
 * 时间戳以「模块加载时刻」为基准往前推，保证「今天 / 昨天」分组稳定演示。
 */

const now = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "c1",
    title: "整理桌面截图",
    preview: "好的喵～已经把 37 张截图按日期归好类了",
    updatedAt: now - 3 * MIN,
    messages: [
      {
        id: "m1",
        role: "user",
        ts: now - 9 * MIN,
        segments: [
          { kind: "text", text: "帮我把桌面上的截图按日期归类到 Pictures 里吧" },
        ],
      },
      {
        id: "m2",
        role: "assistant",
        ts: now - 8 * MIN,
        segments: [
          { kind: "text", text: "好的主人喵～我先看看桌面上有哪些截图。" },
          {
            kind: "tool",
            name: "read_dir",
            summary: "读取 ~/Desktop 目录",
            detail: "找到 37 个 PNG 文件，命名形如 Screenshot 2026-07-01 ...",
            status: "success",
          },
          { kind: "text", text: "一共 37 张。这就按拍摄日期建子文件夹分好类。" },
          {
            kind: "tool",
            name: "run_command",
            summary: "按日期移动截图到 ~/Pictures/Screenshots/<日期>/",
            detail: "mkdir -p 并 mv 全部 37 个文件，无冲突",
            status: "success",
          },
          {
            kind: "text",
            text: "搞定啦～已经把 37 张截图按日期归好类，桌面清爽多了喵！",
          },
        ],
      },
    ],
  },
  {
    id: "c2",
    title: "查今天的天气",
    preview: "今天多云转晴，最高 31°C，记得涂防晒喵",
    updatedAt: now - 2 * HOUR,
    messages: [
      {
        id: "m3",
        role: "user",
        ts: now - 2 * HOUR - 2 * MIN,
        segments: [{ kind: "text", text: "今天天气怎么样呀" }],
      },
      {
        id: "m4",
        role: "assistant",
        ts: now - 2 * HOUR,
        segments: [
          {
            kind: "tool",
            name: "web_search",
            summary: "搜索本地天气",
            status: "success",
          },
          {
            kind: "text",
            text: "今天多云转晴，最高 31°C、最低 24°C，出门记得涂防晒喵～",
          },
        ],
      },
    ],
  },
  {
    id: "c3",
    title: "重命名一批文件",
    preview: "已按 序号_原名 的格式重命名 12 个文件",
    updatedAt: now - 1 * DAY - 3 * HOUR,
    messages: [
      {
        id: "m5",
        role: "user",
        ts: now - 1 * DAY - 3 * HOUR - MIN,
        segments: [
          { kind: "text", text: "把这个文件夹里的文件都加上序号前缀" },
        ],
      },
      {
        id: "m6",
        role: "assistant",
        ts: now - 1 * DAY - 3 * HOUR,
        segments: [
          {
            kind: "tool",
            name: "run_command",
            summary: "批量重命名为 01_、02_ … 前缀",
            status: "success",
          },
          { kind: "text", text: "12 个文件都加好序号前缀啦～" },
        ],
      },
    ],
  },
  {
    id: "c4",
    title: "写一封请假邮件",
    preview: "草稿写好了，主人看看要不要改语气",
    updatedAt: now - 3 * DAY,
    messages: [
      {
        id: "m7",
        role: "user",
        ts: now - 3 * DAY - 4 * MIN,
        segments: [{ kind: "text", text: "帮我写封明天的请假邮件，理由是身体不舒服" }],
      },
      {
        id: "m8",
        role: "assistant",
        ts: now - 3 * DAY,
        segments: [
          {
            kind: "text",
            text: "草稿写好啦，主人看看语气合不合适，要更正式一点也可以跟我说喵～",
          },
        ],
      },
    ],
  },
];
