import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import {
  PixelPage,
  PixelPageHeader,
  PixelPageTitle,
  PixelPageSubtitle,
} from "../components/pixel/PixelPage";
import { PixelSection } from "../components/pixel/PixelSection";
import { PixelButton } from "../components/pixel/PixelButton";
import { PixelSoonTag } from "../components/pixel/PixelTag";
import {
  PixelSettingList,
  PixelSettingRow,
  PixelSettingInfo,
  PixelSettingLabel,
  PixelSettingDesc,
} from "../components/pixel/PixelSettingRow";
import { PixelSelect, type PixelSelectOption } from "../components/pixel/PixelSelect";
import { PixelSwitch } from "../components/pixel/PixelSwitch";
import { PixelInput } from "../components/pixel/PixelInput";
import { PixelSlider } from "../components/pixel/PixelSlider";
import { BACKDROP_STYLES, type BackdropStyleId } from "../components/pixel/backdrops";
import { ProviderSettings } from "../components/ProviderSettings";
import type { ThemeMode } from "../styles/theme";
import type { AppSettings, ProviderProfile } from "../settings";
import {
  getProfiles,
  getSetting,
  setSetting,
  saveProfile,
  deleteProfile,
  setActiveProvider,
  syncWakeConfig,
} from "../settings";

interface SettingsProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  backdropStyle: BackdropStyleId;
  onChangeBackdrop: (id: BackdropStyleId) => void;
}

const BACKDROP_OPTIONS: PixelSelectOption[] = BACKDROP_STYLES.map((s) => ({
  value: s.id,
  label: s.label,
}));

/** 桌宠气泡驻留时长候选（秒）：说完后气泡再停多久才消失 */
const BUBBLE_SECS_OPTIONS: PixelSelectOption[] = [
  { value: "3", label: "3 秒" },
  { value: "5", label: "5 秒" },
  { value: "10", label: "10 秒" },
  { value: "20", label: "20 秒" },
];

/** 工具并发上限可选档（1-20，默认 5） */
const CONCURRENCY_OPTIONS: PixelSelectOption[] = [1, 2, 3, 5, 8, 10, 15, 20].map((n) => ({
  value: String(n),
  label: `${n} 个`,
}));

/** 代理模式候选 */
const PROXY_MODE_OPTIONS: PixelSelectOption[] = [
  { value: "system", label: "跟随系统代理" },
  { value: "custom", label: "自定义" },
  { value: "off", label: "不使用代理" },
];



function Settings({ theme, onToggleTheme, backdropStyle, onChangeBackdrop }: SettingsProps) {
  const isLight = theme === "light";
  const currentDesc = BACKDROP_STYLES.find((s) => s.id === backdropStyle)?.desc ?? "";

  // Provider 配置：本地镜像 settings 缓存，改动即落盘 + 刷新 UI
  const [profiles, setProfiles] = useState<ProviderProfile[]>(() => getProfiles());
  const [activeId, setActiveId] = useState<string | null>(() => getSetting("activeProviderId"));

  const refresh = useCallback(() => {
    setProfiles([...getProfiles()]);
    setActiveId(getSetting("activeProviderId"));
  }, []);

  const handleSave = useCallback(
    async (profile: ProviderProfile) => {
      await saveProfile(profile);
      refresh();
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteProfile(id);
      refresh();
    },
    [refresh],
  );

  const handleSelect = useCallback(
    async (id: string) => {
      await setActiveProvider(id);
      refresh();
    },
    [refresh],
  );

  // agent 工具免审批开关：改动即落盘（onKeyChange 会广播给常驻聊天窗）
  const [autoApprove, setAutoApprove] = useState<boolean>(() =>
    getSetting("autoApproveTools"),
  );
  const handleAutoApprove = useCallback((next: boolean) => {
    setAutoApprove(next);
    void setSetting("autoApproveTools", next);
  }, []);

  // 工具并发上限（1-20，默认 5）：一轮多个工具调用同时跑几个，改动即落盘（广播给聊天窗）
  const [concurrency, setConcurrency] = useState<number>(() => getSetting("toolConcurrency"));
  const handleConcurrency = useCallback((v: string) => {
    const n = Math.max(1, Math.min(20, Math.round(Number(v)) || 5));
    setConcurrency(n);
    void setSetting("toolConcurrency", n);
  }, []);

  // 代理：模式（跟随系统/自定义/关闭）+ 自定义地址。改动即落盘并即时推给 Rust 生效
  const [proxyMode, setProxyMode] = useState<AppSettings["proxyMode"]>(() =>
    getSetting("proxyMode"),
  );
  const [proxyUrl, setProxyUrl] = useState<string>(() => getSetting("proxyUrl"));
  const pushProxy = (mode: string, url: string) => {
    void invoke("set_proxy", { mode, url }).catch(() => {});
  };
  const handleProxyMode = useCallback(
    (v: string) => {
      const mode = v as AppSettings["proxyMode"];
      setProxyMode(mode);
      void setSetting("proxyMode", mode);
      pushProxy(mode, proxyUrl);
    },
    [proxyUrl],
  );
  const handleProxyUrl = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const url = e.target.value;
      setProxyUrl(url);
      void setSetting("proxyUrl", url);
      if (proxyMode === "custom") pushProxy("custom", url);
    },
    [proxyMode],
  );

  // 软件音量（0~1）：拖动滑块即改，落盘并即时推给 Rust 播放线程
  const [volume, setVolume] = useState<number>(() => getSetting("volume"));
  const handleVolume = useCallback((vol: number) => {
    const v = Math.max(0, Math.min(1, vol));
    setVolume(v);
    void setSetting("volume", v);
    void invoke("tts_set_volume", { volume: v }).catch(() => {});
  }, []);

  // 桌宠说话气泡：驻留时长 + 点击拉起对话开关，改动即落盘
  // （onKeyChange 广播给常驻桌宠窗，下一个气泡生效）
  const [bubbleSecs, setBubbleSecs] = useState<number>(() => getSetting("petBubbleSecs"));
  const handleBubbleSecs = useCallback((v: string) => {
    const secs = Number(v) || 5;
    setBubbleSecs(secs);
    void setSetting("petBubbleSecs", secs);
  }, []);
  const [bubbleClick, setBubbleClick] = useState<boolean>(() =>
    getSetting("petBubbleClick"),
  );
  const handleBubbleClick = useCallback((next: boolean) => {
    setBubbleClick(next);
    void setSetting("petBubbleClick", next);
  }, []);
  const [petAutoWalk, setPetAutoWalk] = useState<boolean>(() =>
    getSetting("petAutoWalk"),
  );
  const handlePetAutoWalk = useCallback((next: boolean) => {
    setPetAutoWalk(next);
    void setSetting("petAutoWalk", next);
  }, []);
  const [petAlwaysOnTop, setPetAlwaysOnTop] = useState<boolean>(() =>
    getSetting("petAlwaysOnTop"),
  );
  const handlePetAlwaysOnTop = useCallback((next: boolean) => {
    setPetAlwaysOnTop(next);
    void setSetting("petAlwaysOnTop", next);
    void emitTo("pet", "pet:always-on-top", { enabled: next });
  }, []);

  // 语音唤醒：开关 / 唤醒词 / 提示音。改动即落盘并推给 Rust 重建常驻监听管线
  // （唤醒词失焦才提交——每次重建要重载 KWS 模型，别跟着键入抖）；
  // 「唤醒词不在模型词表」这类配置错误就地显示在开关行的描述里。
  const [voiceWake, setVoiceWake] = useState<boolean>(() => getSetting("voiceWake"));
  const [wakeWord, setWakeWord] = useState<string>(() => getSetting("wakeWord"));
  const [wakeError, setWakeError] = useState<string | null>(null);
  const pushWake = useCallback(() => {
    syncWakeConfig()
      .then(() => setWakeError(null))
      .catch((err) => setWakeError(String(err)));
  }, []);
  const handleVoiceWake = useCallback(
    (next: boolean) => {
      setVoiceWake(next);
      void setSetting("voiceWake", next);
      pushWake();
    },
    [pushWake],
  );
  // 唤醒灵敏度：拖动即落盘显示，但重建监听管线（要重载 KWS 模型）防抖 500ms——
  // 拖一整条只重建一次
  const [wakeSensitivity, setWakeSensitivity] = useState<number>(() =>
    getSetting("wakeSensitivity"),
  );
  const wakePushTimerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(wakePushTimerRef.current), []);
  const handleWakeSensitivity = useCallback(
    (v: number) => {
      const s = Math.max(0, Math.min(1, v));
      setWakeSensitivity(s);
      void setSetting("wakeSensitivity", s);
      window.clearTimeout(wakePushTimerRef.current);
      wakePushTimerRef.current = window.setTimeout(pushWake, 500);
    },
    [pushWake],
  );
  const [wakeCue, setWakeCue] = useState<boolean>(() => getSetting("wakeCue"));
  const handleWakeCue = useCallback((next: boolean) => {
    setWakeCue(next);
    void setSetting("wakeCue", next);
    // 打开即试听一声「在听」，立刻知道长什么样（音量跟软件音量设置）
    if (next) {
      const audio = new Audio("/audio/wake-start.wav");
      audio.volume = Math.max(0, Math.min(1, getSetting("volume")));
      void audio.play().catch(() => {});
    }
  }, []);
  const handleWakeWordChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setWakeWord(e.target.value);
  }, []);
  const commitWakeWord = useCallback(() => {
    const word = wakeWord.trim() || "雪豹";
    setWakeWord(word);
    void setSetting("wakeWord", word);
    pushWake();
  }, [wakeWord, pushWake]);
  // 挂载重放一次唤醒配置：上次留下的失效配置（非法唤醒词/模型未就绪但开关已开）
  // 会在进设置页时把错误重新亮出来，而不是开关显示开启、后端却静默没在听
  useEffect(() => {
    if (getSetting("voiceWake")) pushWake();
  }, [pushWake]);

  // 语音输入麦克风 / 播报扬声器：挂载时向后端各枚举一次；改动即落盘
  // （onKeyChange 广播给常驻对话窗，下次录音/念句生效）
  const [micDevices, setMicDevices] = useState<string[]>([]);
  const [micDevice, setMicDevice] = useState<string>(() => getSetting("sttDevice"));
  const [spkDevices, setSpkDevices] = useState<string[]>([]);
  const [spkDevice, setSpkDevice] = useState<string>(() => getSetting("ttsDevice"));
  useEffect(() => {
    void invoke<string[]>("stt_devices").then(setMicDevices).catch(() => {});
    void invoke<string[]>("tts_output_devices").then(setSpkDevices).catch(() => {});
  }, []);
  const handleMicDevice = useCallback(
    (v: string) => {
      setMicDevice(v);
      void setSetting("sttDevice", v);
      // 常驻唤醒管线也用这个麦克风：换设备即重建（未开启则是幂等空转）
      pushWake();
    },
    [pushWake],
  );
  const handleSpkDevice = useCallback((v: string) => {
    setSpkDevice(v);
    void setSetting("ttsDevice", v);
  }, []);
  // 已选设备当前不在枚举列表（被拔掉了）时仍保留为一项，下拉不至于显示错位
  const deviceOptions = (devices: string[], current: string): PixelSelectOption[] => [
    { value: "", label: "系统默认" },
    ...devices.map((d) => ({ value: d, label: d })),
    ...(current && !devices.includes(current)
      ? [{ value: current, label: `${current}（未找到）` }]
      : []),
  ];
  const micOptions = deviceOptions(micDevices, micDevice);
  const spkOptions = deviceOptions(spkDevices, spkDevice);

  return (
    <PixelPage>
      <PixelPageHeader>
        <PixelPageTitle>设置</PixelPageTitle>
        <PixelPageSubtitle>调教一下 Deskling 的外观与能力喵～</PixelPageSubtitle>
      </PixelPageHeader>

      <PixelSection title="外观">
        <PixelSettingList>
          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>主题</PixelSettingLabel>
              <PixelSettingDesc>
                当前：{isLight ? "浅色 · 灰米" : "深色 · 蓝紫"}
              </PixelSettingDesc>
            </PixelSettingInfo>
            <PixelButton onClick={onToggleTheme}>
              {isLight ? "☾ 切到深色" : "☀ 切到浅色"}
            </PixelButton>
          </PixelSettingRow>

          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>背景风格</PixelSettingLabel>
              <PixelSettingDesc>{currentDesc}</PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSelect
              options={BACKDROP_OPTIONS}
              value={backdropStyle}
              onChange={(v) => onChangeBackdrop(v as BackdropStyleId)}
              variant="normal"
            />
          </PixelSettingRow>
        </PixelSettingList>
      </PixelSection>

      <PixelSection title="AI 模型">
        <ProviderSettings
          profiles={profiles}
          activeId={activeId}
          onSave={handleSave}
          onDelete={handleDelete}
          onSelect={handleSelect}
        />
      </PixelSection>

      <PixelSection title="Agent 工具">
        <PixelSettingList>
          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>免审批执行</PixelSettingLabel>
              <PixelSettingDesc>
                {autoApprove
                  ? "开启：写文件 / 执行命令等操作直接放行，不再逐步确认"
                  : "关闭：每一步危险操作先弹「同意 / 拒绝」，由你把关"}
              </PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSwitch
              checked={autoApprove}
              onChange={handleAutoApprove}
              aria-label="agent 工具免审批执行"
            />
          </PixelSettingRow>

          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>工具并发上限</PixelSettingLabel>
              <PixelSettingDesc>
                模型一轮里同时调用多个工具（含子任务 subagent）时，最多几个一起跑
              </PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSelect
              options={CONCURRENCY_OPTIONS}
              value={String(concurrency)}
              onChange={handleConcurrency}
              variant="normal"
            />
          </PixelSettingRow>
        </PixelSettingList>
      </PixelSection>

      <PixelSection title="桌宠">
        <PixelSettingList>
          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>气泡驻留时长</PixelSettingLabel>
              <PixelSettingDesc>
                桌宠说完一轮后，头顶气泡再停这么久才消失
              </PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSelect
              options={BUBBLE_SECS_OPTIONS}
              value={String(bubbleSecs)}
              onChange={handleBubbleSecs}
              variant="normal"
            />
          </PixelSettingRow>

          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>点气泡打开对话</PixelSettingLabel>
              <PixelSettingDesc>
                {bubbleClick
                  ? "开启：点击桌宠头顶的气泡，直接拉起 AI 对话窗"
                  : "关闭：气泡只是展示，不响应点击"}
              </PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSwitch
              checked={bubbleClick}
              onChange={handleBubbleClick}
              aria-label="点击桌宠气泡打开对话窗"
            />
          </PixelSettingRow>

          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>自主散步</PixelSettingLabel>
              <PixelSettingDesc>
                {petAutoWalk
                  ? "开启：桌宠真正空闲时，偶尔随机走向屏幕水平线上的其他位置"
                  : "关闭：桌宠只在拖动或任务栏避让时移动"}
              </PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSwitch
              checked={petAutoWalk}
              onChange={handlePetAutoWalk}
              aria-label="允许桌宠自主散步"
            />
          </PixelSettingRow>

          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>始终置顶</PixelSettingLabel>
              <PixelSettingDesc>
                {petAlwaysOnTop
                  ? "开启：桌宠一直显示在其他普通窗口上方"
                  : "关闭：其他窗口可以正常盖住桌宠"}
              </PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSwitch
              checked={petAlwaysOnTop}
              onChange={handlePetAlwaysOnTop}
              aria-label="桌宠窗口始终置顶"
            />
          </PixelSettingRow>
        </PixelSettingList>
      </PixelSection>

      <PixelSection title="网络">
        <PixelSettingList>
          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>代理</PixelSettingLabel>
              <PixelSettingDesc>
                联网工具（网页搜索等）走哪个代理。默认跟随 Windows 系统代理——很多机器访问外网需要它
              </PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSelect
              options={PROXY_MODE_OPTIONS}
              value={proxyMode}
              onChange={handleProxyMode}
              variant="normal"
            />
          </PixelSettingRow>

          {proxyMode === "custom" && (
            <PixelSettingRow>
              <PixelSettingInfo>
                <PixelSettingLabel>代理地址</PixelSettingLabel>
                <PixelSettingDesc>如 http://127.0.0.1:7890</PixelSettingDesc>
              </PixelSettingInfo>
              <PixelInput
                value={proxyUrl}
                placeholder="http://127.0.0.1:7890"
                onChange={handleProxyUrl}
              />
            </PixelSettingRow>
          )}
        </PixelSettingList>
      </PixelSection>

      <PixelSection title="声音">
        <PixelSettingList>
          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>音量</PixelSettingLabel>
              <PixelSettingDesc>桌宠说话 / 音效的总音量</PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSlider
              value={volume}
              min={0}
              max={1}
              step={0.01}
              onChange={handleVolume}
              formatTip={(v) => `${Math.round(v * 100)}%`}
              aria-label="软件音量"
            />
          </PixelSettingRow>

          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>麦克风</PixelSettingLabel>
              <PixelSettingDesc>对话窗语音输入用哪个设备收音</PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSelect
              options={micOptions}
              value={micDevice}
              onChange={handleMicDevice}
              variant="normal"
            />
          </PixelSettingRow>

          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>扬声器</PixelSettingLabel>
              <PixelSettingDesc>桌宠说话从哪个设备出声（试听没声音先查这里）</PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSelect
              options={spkOptions}
              value={spkDevice}
              onChange={handleSpkDevice}
              variant="normal"
            />
          </PixelSettingRow>

          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>语音</PixelSettingLabel>
              <PixelSettingDesc>为桌宠挑一把好听的嗓子</PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSoonTag />
          </PixelSettingRow>
        </PixelSettingList>
      </PixelSection>

      <PixelSection title="语音唤醒">
        <PixelSettingList>
          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>语音唤醒</PixelSettingLabel>
              <PixelSettingDesc>
                {wakeError
                  ? `⚠ ${wakeError}`
                  : voiceWake
                    ? "开启：常驻监听麦克风，喊唤醒词 → 提示音 → 直接说事，说完自动发进会话"
                    : "关闭：语音输入只保留输入框的按住说话"}
              </PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSwitch
              checked={voiceWake}
              onChange={handleVoiceWake}
              aria-label="语音唤醒"
            />
          </PixelSettingRow>

          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>唤醒词</PixelSettingLabel>
              <PixelSettingDesc>中文；多个候选用逗号分隔，移开输入框后生效</PixelSettingDesc>
            </PixelSettingInfo>
            <PixelInput
              value={wakeWord}
              onChange={handleWakeWordChange}
              onBlur={commitWakeWord}
              placeholder="雪豹"
              aria-label="唤醒词"
            />
          </PixelSettingRow>

          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>唤醒灵敏度</PixelSettingLabel>
              <PixelSettingDesc>
                越高越容易被唤醒（语速快也不漏），同时也更容易被同音词误触
              </PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSlider
              value={wakeSensitivity}
              min={0}
              max={1}
              step={0.05}
              onChange={handleWakeSensitivity}
              formatTip={(v) => `${Math.round(v * 100)}%`}
              aria-label="唤醒灵敏度"
            />
          </PixelSettingRow>

          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>唤醒提示音</PixelSettingLabel>
              <PixelSettingDesc>
                {wakeCue
                  ? "开启：命中唤醒词响「在听」，一句话说完响「收到」"
                  : "关闭：只靠桌宠的倾听动画和头顶草稿泡提示"}
              </PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSwitch
              checked={wakeCue}
              onChange={handleWakeCue}
              aria-label="唤醒提示音"
            />
          </PixelSettingRow>
        </PixelSettingList>
      </PixelSection>
    </PixelPage>
  );
}

export default Settings;
