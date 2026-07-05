import { styled } from "@linaria/react";
import { t } from "../styles/theme";
import {
  Page,
  PageHeader,
  PageSubtitle,
  PageTitle,
  Panel,
  PanelTitle,
  SettingInfo,
  SettingLabel,
  SettingDesc,
  SettingRow,
} from "../components/ui";

/** 应用元信息（与 tauri.conf.json / package.json 保持一致） */
const APP_VERSION = "0.1.0";
const APP_IDENTIFIER = "com.wjz.deskling";

function About() {
  return (
    <Page>
      <PageHeader>
        <PageTitle>关于</PageTitle>
        <PageSubtitle>认识一下你的桌面小伙伴喵～</PageSubtitle>
      </PageHeader>

      <Panel>
        <Brand>
          <Paw>🐾</Paw>
          <BrandText>
            <BrandName>Deskling</BrandName>
            <BrandDesc>一只住在桌面上的 AI agent 桌宠</BrandDesc>
          </BrandText>
        </Brand>

        <SettingRow>
          <SettingInfo>
            <SettingLabel>版本</SettingLabel>
          </SettingInfo>
          <Mono>v{APP_VERSION}</Mono>
        </SettingRow>
        <SettingRow>
          <SettingInfo>
            <SettingLabel>应用标识</SettingLabel>
          </SettingInfo>
          <Mono>{APP_IDENTIFIER}</Mono>
        </SettingRow>
      </Panel>

      <Panel>
        <PanelTitle>致谢</PanelTitle>
        <SettingInfo>
          <SettingDesc>字体：Zpix 最像素（开源像素字体）</SettingDesc>
          <SettingDesc>框架：Tauri 2 · React 19 · Vite</SettingDesc>
        </SettingInfo>
      </Panel>
    </Page>
  );
}

export default About;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: calc(${t.unit} * 4);
`;

const Paw = styled.div`
  font-size: 40px;
  line-height: 1;
`;

const BrandText = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.unit};
`;

const BrandName = styled.div`
  font: ${t.textXl};
  letter-spacing: 2px;
  color: ${t.colorAccent};
`;

const BrandDesc = styled.div`
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;

const Mono = styled.span`
  font: ${t.textMd};
  color: ${t.colorText};
`;
