import { load, type Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
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

// ==================== 桌宠档案 ====================

/** 桌宠嗓音绑定：语音包 + 包内音色。packId 为空串 = 显式静音（不说话） */
export interface PetVoice {
  packId: string;
  voiceId: number;
  /** 语速倍率（缺省 1.0） */
  speed?: number;
}

/** 默认嗓音：静音（packId 空串）——桌宠默认不出声，想让它说话的在
    人设面板挑一个音色 */
export const DEFAULT_PET_VOICE: PetVoice = {
  packId: "",
  voiceId: 0,
};

/** 单个桌宠档案：桌宠页展示栏卡片 + 人设设置面板的数据源 */
export interface PetProfile {
  id: string;
  /** 桌宠名字（展示栏悬停小签 / 桌宠页大卡标题） */
  name: string;
  /** 人设 prompt：作为对话的 system prompt 注入（设置面板可编辑） */
  prompt: string;
  /** 精灵图路径（public 下，主窗/桌宠窗通用） */
  sprite: string;
  /** 嗓音绑定（人设面板选择）：缺省用 DEFAULT_PET_VOICE，packId 空串 = 静音 */
  voice?: PetVoice;
}

/** 雪豹的默认人设 prompt（首次初始化用；用户可在面板里随意改） */
export const DEFAULT_PET_PROMPT = `你是「雪豹」，一只住在主人桌面上的雪豹桌宠。

【性格】活泼粘人、好奇心旺盛，偶尔犯懒打盹；把用户称作「主人」。
【说话方式】中文口语，简短自然，句尾偶尔带「喵」；不堆砌颜文字。
【干活】你有真实的工具能力（读写文件、执行命令）：主人求助时认真干活，边做边简单说明；闲聊时轻松俏皮。
【边界】不要自称某个具体的大模型或厂商，你就是雪豹。`;

/** 内置桌宠：雪豹（首次启动的默认档案） */
const DEFAULT_PETS: PetProfile[] = [
  { id: "xuebao", name: "雪豹", prompt: DEFAULT_PET_PROMPT, sprite: "/pet/xuebao.png" },
];

/** 桌宠最后一次普通落脚的窗口物理坐标；物理 px 可避免高 DPI 下反复换算漂移。 */
export interface PetWindowPosition {
  x: number;
  y: number;
}

// ==================== 应用设置 ====================

/** 所有持久化配置项集中在这里，新增配置时同步补默认值即可 */
export interface AppSettings {
  theme: ThemeMode;
  /** 侧边栏是否折叠为纯图标 */
  sidebarCollapsed: boolean;
  /** 对话窗历史侧栏是否收起（仅对话窗读写，无需跨窗口同步） */
  chatSidebarCollapsed: boolean;
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
  /**
   * 对话「深度思考」开关（输入框上方操作栏切换，仅对话窗读写）：
   * true 时 Anthropic/Gemini 请求思考过程下发（OpenAI 兼容协议由模型自身决定，不受此控）。
   */
  chatThinking: boolean;
  /**
   * 工具并发上限（设置页可调，默认 5，范围 1-20）：一轮回复里模型一次请求了多个
   * 工具调用（含 subagent）时，最多同时并发跑几个。Rust 侧再 clamp 到 1..=20。
   */
  toolConcurrency: number;
  /**
   * 语音输入麦克风设备名（"" = 系统默认）：主窗口设置页「声音 · 麦克风」选择，
   * 常驻对话窗按下语音按钮时读取（跨窗口 onKeyChange 同步）。
   */
  sttDevice: string;
  /**
   * 语音播报扬声器设备名（"" = 系统默认）：设置页「声音 · 扬声器」选择，
   * 对话窗逐句合成 / 人设面板试听时读取（跨窗口 onKeyChange 同步），
   * 变化时 Rust 侧播放线程热重建。
   */
  ttsDevice: string;
  /**
   * 代理模式：system=跟随 Windows 系统代理（默认）/ custom=用 proxyUrl / off=不走代理。
   * Rust 的 run_command 据此给联网脚本（web-search 等）设代理环境变量。
   */
  proxyMode: "system" | "custom" | "off";
  /** 自定义代理地址（proxyMode=custom 时用），如 http://127.0.0.1:7890 */
  proxyUrl: string;
  /** 软件音量（0~1）：桌宠说话 / 音效输出的总音量，设置页可调，Rust 播放线程按它缩放 */
  volume: number;
  /** 桌宠说话气泡驻留时长（秒）：一轮回复说完后气泡再停这么久才消失 */
  petBubbleSecs: number;
  /** 点击桌宠气泡拉起 AI 对话窗（默认开启） */
  petBubbleClick: boolean;
  /**
   * 语音唤醒：常驻监听麦克风，喊唤醒词 → 提示音 → 倾听一句话 → 自动发进会话
   * （不拉起对话窗，聊天记录照常保存）。Rust 侧 wake_configure 按它起停管线。
   * 起止提示音是固定资源 /audio/wake-{start,end}.wav（ChatWindow 播放）。
   */
  voiceWake: boolean;
  /** 唤醒词（中文，多个用逗号分隔；空串回退「雪豹」） */
  wakeWord: string;
  /** 唤醒灵敏度 0~1（默认 0.5）：越高越容易唤醒（快语速不漏），也越容易被同音误触 */
  wakeSensitivity: number;
  /** 唤醒提示音开关（默认关）：开启时命中响「在听」、说完响「收到」 */
  wakeCue: boolean;
  /** 桌宠真正空闲时是否允许低频自主散步（手动动画测试不受影响） */
  petAutoWalk: boolean;
  /** 桌宠窗口是否始终压在其他普通窗口上方（默认关闭） */
  petAlwaysOnTop: boolean;
  /** 桌宠最后一次安全落脚位置；null = 首次运行交给系统安排 */
  petPosition: PetWindowPosition | null;
  /** 桌宠档案列表（桌宠页展示栏；人设 prompt 等都存在档案里） */
  petProfiles: PetProfile[];
  /** 当前桌宠 id（展示栏排最前；对话人设取它的 prompt） */
  activePetId: string;
}

/** 默认值：读取失败或缺失时回退到这里 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  sidebarCollapsed: false,
  chatSidebarCollapsed: false,
  backdropStyle: "turbulence",
  providerProfiles: [],
  activeProviderId: null,
  autoApproveTools: true,
  chatThinking: false,
  toolConcurrency: 5,
  proxyMode: "system",
  proxyUrl: "",
  volume: 1,
  sttDevice: "",
  ttsDevice: "",
  petBubbleSecs: 5,
  petBubbleClick: true,
  voiceWake: false,
  wakeWord: "雪豹",
  wakeSensitivity: 0.5,
  wakeCue: false,
  petAutoWalk: true,
  petAlwaysOnTop: false,
  petPosition: null,
  petProfiles: DEFAULT_PETS,
  activePetId: "xuebao",
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
  // 工具并发上限在主窗口设置里改、常驻聊天窗发送时读，同样要跨窗口刷
  void s.onKeyChange<number>("toolConcurrency", (v) => {
    cache.toolConcurrency = v ?? DEFAULT_SETTINGS.toolConcurrency;
  });
  // 麦克风设备在主窗口设置里选、常驻聊天窗按下语音按钮时读，同样要跨窗口刷
  void s.onKeyChange<string>("sttDevice", (v) => {
    cache.sttDevice = v ?? DEFAULT_SETTINGS.sttDevice;
  });
  // 扬声器设备在主窗口设置里选、常驻聊天窗逐句合成时读，同样要跨窗口刷
  void s.onKeyChange<string>("ttsDevice", (v) => {
    cache.ttsDevice = v ?? DEFAULT_SETTINGS.ttsDevice;
  });
  // 气泡驻留/点击行为在主窗口设置里改、常驻桌宠窗气泡收尾/点击时读，同样要跨窗口刷
  void s.onKeyChange<number>("petBubbleSecs", (v) => {
    cache.petBubbleSecs = v ?? DEFAULT_SETTINGS.petBubbleSecs;
  });
  void s.onKeyChange<boolean>("petBubbleClick", (v) => {
    cache.petBubbleClick = v ?? DEFAULT_SETTINGS.petBubbleClick;
  });
  void s.onKeyChange<boolean>("petAutoWalk", (v) => {
    cache.petAutoWalk = v ?? DEFAULT_SETTINGS.petAutoWalk;
  });
  // 语音唤醒在主窗口设置里改、常驻对话窗响提示音/发会话时读，同样要跨窗口刷
  void s.onKeyChange<boolean>("voiceWake", (v) => {
    cache.voiceWake = v ?? DEFAULT_SETTINGS.voiceWake;
  });
  void s.onKeyChange<string>("wakeWord", (v) => {
    cache.wakeWord = v ?? DEFAULT_SETTINGS.wakeWord;
  });
  void s.onKeyChange<number>("wakeSensitivity", (v) => {
    cache.wakeSensitivity = v ?? DEFAULT_SETTINGS.wakeSensitivity;
  });
  void s.onKeyChange<boolean>("wakeCue", (v) => {
    cache.wakeCue = v ?? DEFAULT_SETTINGS.wakeCue;
  });
  void s.onKeyChange<boolean>("petAlwaysOnTop", (v) => {
    cache.petAlwaysOnTop = v ?? DEFAULT_SETTINGS.petAlwaysOnTop;
  });
  // 桌宠档案在主窗口桌宠页编辑、常驻聊天窗发送时读人设 prompt，同样要跨窗口刷
  void s.onKeyChange<PetProfile[]>("petProfiles", (v) => {
    cache.petProfiles = v && v.length > 0 ? v : DEFAULT_SETTINGS.petProfiles;
  });
  void s.onKeyChange<string>("activePetId", (v) => {
    cache.activePetId = v ?? DEFAULT_SETTINGS.activePetId;
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

/**
 * 把「需要 Rust 侧生效」的设置（代理 / 音量）推给后端。这些设置存在前端 store，
 * 但要在 Rust 进程里生效（run_command 设代理环境、TTS 播放按音量缩放），所以启动后
 * （bootstrap）推一次当前值；设置页改动时也各自即时推（见 Settings 的 handler）。
 */
export async function syncBackendConfig(): Promise<void> {
  await invoke("set_proxy", { mode: cache.proxyMode, url: cache.proxyUrl }).catch((err) =>
    console.warn("[settings] set_proxy 失败:", err),
  );
  await invoke("tts_set_volume", { volume: cache.volume }).catch((err) =>
    console.warn("[settings] tts_set_volume 失败:", err),
  );
  await syncWakeConfig().catch((err) =>
    console.warn("[settings] wake_configure 失败:", err),
  );
}

/**
 * 把语音唤醒配置推给 Rust（起/停常驻监听管线）。后端按（设备 + 唤醒词）幂等
 * 比对，多窗口 bootstrap 重复推送无害。设置页改动唤醒相关项后也调它即时生效。
 * 抛错原样上抛（设置页要把「唤醒词不在词表」这类错误展示给用户）。
 */
export async function syncWakeConfig(): Promise<void> {
  await invoke("wake_configure", {
    enabled: cache.voiceWake,
    keyword: cache.wakeWord,
    device: cache.sttDevice || null,
    sensitivity: cache.wakeSensitivity,
  });
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

// ==================== 桌宠档案操作 ====================

/** 读取全部桌宠档案（内存缓存） */
export function getPetProfiles(): PetProfile[] {
  return cache.petProfiles;
}

/** 当前桌宠（id 失配时回退列表首个，保证总有一只在岗） */
export function getActivePet(): PetProfile {
  return (
    cache.petProfiles.find((p) => p.id === cache.activePetId) ??
    cache.petProfiles[0] ??
    DEFAULT_PETS[0]
  );
}

/** 局部更新某只桌宠（合并 patch），落盘 */
export async function updatePetProfile(
  id: string,
  patch: Partial<Omit<PetProfile, "id">>,
): Promise<void> {
  const next = cache.petProfiles.map((p) => (p.id === id ? { ...p, ...patch } : p));
  await setSetting("petProfiles", next);
}

/** 取某只桌宠的有效嗓音：没设置回退默认嗓；显式静音（packId 空串）返回 null */
export function getPetVoice(p: PetProfile): PetVoice | null {
  const v = p.voice ?? DEFAULT_PET_VOICE;
  return v.packId ? v : null;
}
