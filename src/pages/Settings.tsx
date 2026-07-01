import {
  Button,
  Page,
  PageHeader,
  PageSubtitle,
  PageTitle,
  Panel,
  PanelTitle,
  SettingDesc,
  SettingInfo,
  SettingLabel,
  SettingRow,
  SoonTag,
} from "../components/ui";
import type { ThemeMode } from "../styles/theme";

interface SettingsProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
}

function Settings({ theme, onToggleTheme }: SettingsProps) {
  const isLight = theme === "light";
  return (
    <Page>
      <PageHeader>
        <PageTitle>设置</PageTitle>
        <PageSubtitle>调教一下 Deskling 的外观与能力喵～</PageSubtitle>
      </PageHeader>

      <Panel>
        <PanelTitle>外观</PanelTitle>
        <SettingRow>
          <SettingInfo>
            <SettingLabel>主题</SettingLabel>
            <SettingDesc>
              当前：{isLight ? "浅色 · 灰米" : "深色 · 蓝紫"}
            </SettingDesc>
          </SettingInfo>
          <Button type="button" onClick={onToggleTheme}>
            {isLight ? "☾ 切到深色" : "☀ 切到浅色"}
          </Button>
        </SettingRow>
      </Panel>

      <Panel>
        <PanelTitle>模型与声音</PanelTitle>
        <SettingRow>
          <SettingInfo>
            <SettingLabel>AI 模型</SettingLabel>
            <SettingDesc>接入自定义对话模型</SettingDesc>
          </SettingInfo>
          <SoonTag>敬请期待</SoonTag>
        </SettingRow>
        <SettingRow>
          <SettingInfo>
            <SettingLabel>语音</SettingLabel>
            <SettingDesc>为桌宠挑一把好听的嗓子</SettingDesc>
          </SettingInfo>
          <SoonTag>敬请期待</SoonTag>
        </SettingRow>
      </Panel>
    </Page>
  );
}

export default Settings;
