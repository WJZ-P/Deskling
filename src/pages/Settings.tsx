import { useCallback, useState } from "react";
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
import { BACKDROP_STYLES, type BackdropStyleId } from "../components/pixel/backdrops";
import { ProviderSettings } from "../components/ProviderSettings";
import type { ThemeMode } from "../styles/theme";
import type { ProtocolId, ProviderProfile } from "../settings";
import {
  getProfiles,
  getSetting,
  createProfile,
  updateProfile,
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

  const handleCreate = useCallback(
    async (protocol: ProtocolId) => {
      await createProfile(protocol);
      refresh();
    },
    [refresh],
  );

  const handleUpdate = useCallback(
    async (id: string, patch: Partial<Omit<ProviderProfile, "id">>) => {
      await updateProfile(id, patch);
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
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onSelect={handleSelect}
        />
      </PixelSection>

      <PixelSection title="声音">
        <PixelSettingList>
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
