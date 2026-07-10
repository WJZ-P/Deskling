import { load, type Store } from "@tauri-apps/plugin-store";
import type { ThemeMode } from "./styles/theme";
import type { BackdropStyleId } from "./components/pixel/backdrops";

export type { ThemeMode };

// ==================== AI Provider 配置 ====================

/** 支持的协议类型 */
export type ProtocolId = "anthropic" | "openai" | "openai-compatible" | "gemini";

/** 协议元数据（内置常量，驱动 UI 自动填充和模型候选） */
export interface ProtocolMeta {
  id: ProtocolId;
  label: string;
  defaultBaseUrl: string;
  endpointPath: string; // 相对于 baseUrl 的端点路径
  authStyle: "x-api-key" | "bearer"; // 鉴权头风格
  presetModels: string[]; // 该厂商常见模型（下拉候选）
}

/** 内置协议表 */
export const PROTOCOLS: ProtocolMeta[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    defaultBaseUrl: "https://api.anthropic.com",
    endpointPath: "/v1/messages",
    authStyle: "x-api-key",
    presetModels: [
      "claude-opus-4-8",
      "claude-sonnet-4-20250514",
      "claude-sonnet-3-5-20241022",
      "claude-haiku-3-5-20241022",
    ],
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    defaultBaseUrl: "https://api.openai.com",
    endpointPath: "/v1/chat/completions",
    authStyle: "bearer",
    presetModels: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  },
  {
    id: "openai-compatible",
    label: "OpenAI 兼容端点",
    defaultBaseUrl: "", // 用户自填完整端点（中转/本地 Ollama），Base URL 即完整地址
    endpointPath: "", // 兼容端点：不拼路径，Base URL 直接当端点用（Rust 侧 raw_endpoint）
    authStyle: "bearer",
    presetModels: [], // 无预设，用户自填
  },
  {
    id: "gemini",
    label: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    endpointPath: "/v1beta/models/{model}:streamGenerateContent", // {model} 占位符
    authStyle: "x-api-key",
    presetModels: ["gemini-2.0-flash-exp", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
];

/** 单个 Provider 配置档（用户数据） */
export interface ProviderProfile {
  id: string; // 自增 uuid
  name: string; // 用户起的名字
  protocol: ProtocolId;
  baseUrl: string; // 可覆盖默认（代理/中转）
  apiKey: string; // 明文存 settings.json，后续迁移到 keyring
  model: string; // 当前选中的模型
  /** 用户手动添加的模型名（与协议预设合并成可选列表；预设无覆盖时全靠这里） */
  customModels?: string[];
  temperature?: number; // 可选参数
  maxTokens?: number;
}

// ==================== 应用设置 ====================

/** 所有持久化配置项集中在这里，新增配置时同步补默认值即可 */
export interface AppSettings {
  theme: ThemeMode;
  /** 侧边栏是否折叠为纯图标 */
  sidebarCollapsed: boolean;
  /** 主区域背景风格 */
  backdropStyle: BackdropStyleId;
  /** AI Provider 配置档列表（多档位） */
  providerProfiles: ProviderProfile[];
  /** 当前选中的 provider ID */
  activeProviderId: string | null;
  /**
   * agent 工具免审批：true = 写文件/命令等危险工具直接执行（默认，顺畅优先）；
   * false = 每步危险操作先弹「同意/拒绝」审批卡。
   */
  autoApproveTools: boolean;
}

/** 默认值：读取失败或缺失时回退到这里 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  sidebarCollapsed: false,
  backdropStyle: "turbulence",
  providerProfiles: [],
  activeProviderId: null,
  autoApproveTools: true,
};

const STORE_FILE = "settings.json";

let store: Store | null = null;
/** 内存缓存：启动时填充，供 UI 同步读取，避免异步导致的主题闪烁 */
let cache: AppSettings = { ...DEFAULT_SETTINGS };
/** 跨窗口同步监听只绑一次（initSettings 可能被多次调用，如 TrayMenu 聚焦时重读） */
let crossWindowSyncBound = false;

/**
 * 启动时调用：从磁盘 store 读取全部配置到内存缓存。
 * 任何异常（含非 Tauri 环境）都会安全回退到默认值。
 */
export async function initSettings(): Promise<AppSettings> {
  try {
    store = await load(STORE_FILE, {
      autoSave: true,
      defaults: DEFAULT_SETTINGS as unknown as { [key: string]: unknown },
    });
    const loaded: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      const val = await store.get(key);
      if (val !== undefined && val !== null) {
        loaded[key] = val;
      }
    }
    cache = { ...DEFAULT_SETTINGS, ...loaded };
    bindCrossWindowSync(store);
  } catch (err) {
    console.warn("[settings] 读取失败，使用默认配置:", err);
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

/**
 * 跨窗口配置同步：Tauri 多窗口各有独立 JS 上下文与内存 cache，
 * store 插件的 onKeyChange 会把任一窗口的写入广播给所有窗口。
 * 常驻的聊天窗（关闭=隐藏，不销毁）启动后 cache 不再重填，若不订阅，
 * 主窗口设置里切模型 / 改 provider 后，聊天窗发送时仍读到旧 profile（切换不生效）。
 * 这里订阅 provider 相关键，收到广播即刷新本窗口 cache —— 只更内存，不回写 store，无回环。
 * 只绑一次（crossWindowSyncBound 守卫），避免 initSettings 被重复调用时叠加监听。
 */
function bindCrossWindowSync(s: Store): void {
  if (crossWindowSyncBound) return;
  crossWindowSyncBound = true;
  void s.onKeyChange<ProviderProfile[]>("providerProfiles", (v) => {
    cache.providerProfiles = v ?? [];
  });
  void s.onKeyChange<string | null>("activeProviderId", (v) => {
    cache.activeProviderId = v ?? null;
  });
  // 审批开关在主窗口设置里改、常驻聊天窗发送时读，同样要跨窗口刷
  void s.onKeyChange<boolean>("autoApproveTools", (v) => {
    cache.autoApproveTools = v ?? DEFAULT_SETTINGS.autoApproveTools;
  });
}

/** 同步读取某项配置（来自内存缓存） */
export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return cache[key];
}

/** 写入某项配置：更新内存缓存并异步落盘（autoSave 开启） */
export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  cache[key] = value;
  try {
    if (store) await store.set(key, value);
  } catch (err) {
    console.warn(`[settings] 保存 ${String(key)} 失败:`, err);
  }
}

// ==================== Provider 配置操作 ====================

/** 查协议元数据（找不到回退到 anthropic） */
export function protocolMeta(id: ProtocolId): ProtocolMeta {
  return PROTOCOLS.find((p) => p.id === id) ?? PROTOCOLS[0];
}

/** 一次运行内唯一的 profile id */
let profileSeq = 0;
function nextProfileId(): string {
  profileSeq += 1;
  return `prov-${Date.now().toString(36)}-${profileSeq}`;
}

/** 读取全部 provider 档位（内存缓存） */
export function getProfiles(): ProviderProfile[] {
  return cache.providerProfiles;
}

/** 读取当前激活的 provider（无则 null） */
export function getActiveProfile(): ProviderProfile | null {
  return (
    cache.providerProfiles.find((p) => p.id === cache.activeProviderId) ?? null
  );
}

/**
 * 新建一个 provider 档：按协议填入默认 baseUrl / 首个预设模型。
 * 落盘后自动设为当前激活档并返回它。
 */
export async function createProfile(
  protocol: ProtocolId,
  name?: string,
): Promise<ProviderProfile> {
  const meta = protocolMeta(protocol);
  const profile: ProviderProfile = {
    id: nextProfileId(),
    name: name?.trim() || meta.label,
    protocol,
    baseUrl: meta.defaultBaseUrl,
    apiKey: "",
    model: meta.presetModels[0] ?? "",
  };
  const next = [...cache.providerProfiles, profile];
  await setSetting("providerProfiles", next);
  await setSetting("activeProviderId", profile.id);
  return profile;
}

/**
 * 生成一个「未保存草稿」profile（不落盘、不入列表）：按协议填默认 baseUrl / 首个预设模型。
 * 用于浮窗「新建」——在草稿上编辑，点保存才 saveProfile 落盘。
 */
export function blankProfile(protocol: ProtocolId): ProviderProfile {
  const meta = protocolMeta(protocol);
  return {
    id: nextProfileId(),
    name: meta.label,
    protocol,
    baseUrl: meta.defaultBaseUrl,
    apiKey: "",
    model: meta.presetModels[0] ?? "",
    customModels: [],
  };
}

/**
 * 保存一个完整 profile（按 id upsert）：已存在则整体替换，不存在则追加。
 * 落盘后设为当前激活档。用于浮窗保存（新建/编辑统一走这条）。
 */
export async function saveProfile(profile: ProviderProfile): Promise<void> {
  const exists = cache.providerProfiles.some((p) => p.id === profile.id);
  const next = exists
    ? cache.providerProfiles.map((p) => (p.id === profile.id ? profile : p))
    : [...cache.providerProfiles, profile];
  await setSetting("providerProfiles", next);
  await setSetting("activeProviderId", profile.id);
}

/** 局部更新某个 profile（合并 patch），落盘 */
export async function updateProfile(
  id: string,
  patch: Partial<Omit<ProviderProfile, "id">>,
): Promise<void> {
  const next = cache.providerProfiles.map((p) =>
    p.id === id ? { ...p, ...patch } : p,
  );
  await setSetting("providerProfiles", next);
}

/** 删除某个 profile；若删的是当前激活档，激活档回退到列表首个（或 null） */
export async function deleteProfile(id: string): Promise<void> {
  const next = cache.providerProfiles.filter((p) => p.id !== id);
  await setSetting("providerProfiles", next);
  if (cache.activeProviderId === id) {
    await setSetting("activeProviderId", next[0]?.id ?? null);
  }
}

/** 切换当前激活的 provider */
export async function setActiveProvider(id: string): Promise<void> {
  await setSetting("activeProviderId", id);
}
