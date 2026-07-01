import { useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../styles/theme";
import {
  Button,
  Divider,
  Page,
  PageHeader,
  PageSubtitle,
  PageTitle,
  Panel,
  PanelTitle,
  ProgressBar,
  SettingDesc,
  SettingInfo,
  SettingLabel,
  SettingRow,
  SoonTag,
  Tag,
  Well,
} from "../components/ui";

function Debug() {
  const [progress, setProgress] = useState(60);

  return (
    <Page>
      <PageHeader>
        <PageTitle>调试</PageTitle>
        <PageSubtitle>组件陈列室喵～ 主人可以在这里逐个测试观感</PageSubtitle>
      </PageHeader>

      <Panel>
        <PanelTitle>按钮 Button</PanelTitle>
        <Row>
          <Button type="button">默认按钮</Button>
          <Button type="button" variant="accent">
            强调按钮
          </Button>
          <Button type="button" disabled>
            禁用按钮
          </Button>
        </Row>
        <SettingDesc>静止凸起、悬停抬升、按下凹陷——试试按住不放喵～</SettingDesc>
      </Panel>

      <Panel>
        <PanelTitle>进度条 ProgressBar</PanelTitle>
        <ProgressBar value={progress} />
        <Row>
          <Button type="button" onClick={() => setProgress((p) => Math.max(0, p - 10))}>
            − 10
          </Button>
          <Button type="button" onClick={() => setProgress((p) => Math.min(100, p + 10))}>
            + 10
          </Button>
          <Tag>{progress}%</Tag>
        </Row>
        <ProgressBar value={25} />
        <ProgressBar value={90} />
      </Panel>

      <Panel>
        <PanelTitle>标签 Tag / 占位 SoonTag</PanelTitle>
        <Row>
          <Tag>像素标签</Tag>
          <Tag>v0.1.0</Tag>
          <SoonTag>敬请期待</SoonTag>
        </Row>
      </Panel>

      <Panel>
        <PanelTitle>凹陷容器 Well / 分隔线 Divider</PanelTitle>
        <Well>这是一个凹陷内嵌区，适合放数值、说明或代码，和凸起的面板形成层次对比喵～</Well>
        <Divider />
        <SettingDesc>上面那条就是雕刻式分隔线（上暗下亮两色调）。</SettingDesc>
      </Panel>

      <Panel>
        <PanelTitle>设置行 SettingRow</PanelTitle>
        <SettingRow>
          <SettingInfo>
            <SettingLabel>示例项 A</SettingLabel>
            <SettingDesc>带雕刻分隔的设置行</SettingDesc>
          </SettingInfo>
          <Button type="button">操作</Button>
        </SettingRow>
        <SettingRow>
          <SettingInfo>
            <SettingLabel>示例项 B</SettingLabel>
            <SettingDesc>第二行会自动出现上方分隔</SettingDesc>
          </SettingInfo>
          <SoonTag>敬请期待</SoonTag>
        </SettingRow>
      </Panel>

      <Panel>
        <PanelTitle>字号 Typography</PanelTitle>
        <Stack>
          <TextXl>特大 xl · 24</TextXl>
          <TextLg>大 lg · 20</TextLg>
          <TextMd>默认 md · 16</TextMd>
          <TextSm>小 sm · 12</TextSm>
          <TextXs>特小 xs · 10</TextXs>
        </Stack>
      </Panel>
    </Page>
  );
}

export default Debug;

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: calc(${t.unit} * 2);
`;

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.unit};
  color: ${t.colorText};
`;

const TextXl = styled.div`
  font: ${t.textXl};
`;
const TextLg = styled.div`
  font: ${t.textLg};
`;
const TextMd = styled.div`
  font: ${t.textMd};
`;
const TextSm = styled.div`
  font: ${t.textSm};
`;
const TextXs = styled.div`
  font: ${t.textXs};
`;
