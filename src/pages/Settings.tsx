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

  // 语音输入麦克风：挂载时向后端枚举一次输入设备；改动即落盘
  // （onKeyChange 广播给常驻对话窗，下次按语音按钮生效）
  const [micDevices, setMicDevices] = useState<string[]>([]);
  const [micDevice, setMicDevice] = useState<string>(() => getSetting("sttDevice"));
  useEffect(() => {
    void invoke<string[]>("stt_devices").then(setMicDevices).catch(() => {});
  }, []);
  const handleMicDevice = useCallback((v: string) => {
    setMicDevice(v);
    void setSetting("sttDevice", v);
  }, []);
  // 已选设备当前不在枚举列表（被拔掉了）时仍保留为一项，下拉不至于显示错位
  const micOptions: PixelSelectOption[] = [
    { value: "", label: "系统默认" },
    ...micDevices.map((d) => ({ value: d, label: d })),
    ...(micDevice && !micDevices.includes(micDevice)
      ? [{ value: micDevice, label: `${micDevice}（未找到）` }]
      : []),
  ];

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
