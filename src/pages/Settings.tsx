import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { BACKDROP_STYLES, type BackdropStyleId } from "../components/pixel/backdrops";
import { ProviderSettings } from "../components/ProviderSettings";
import type { ThemeMode } from "../styles/theme";
import type { ProviderProfile } from "../settings";
import {
  getProfiles,
  getSetting,
  setSetting,
  saveProfile,
  deleteProfile,
  setActiveProvider,
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
  const handleMicDevice = useCallback((v: string) => {
    setMicDevice(v);
    void setSetting("sttDevice", v);
  }, []);
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
        </PixelSettingList>
      </PixelSection>

      <PixelSection title="声音">
        <PixelSettingList>
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
    </PixelPage>
  );
}

export default Settings;
