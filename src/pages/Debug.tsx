import { useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../styles/theme";
import { StylePreview, type PvVars } from "../components/StylePreview";
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
import { PixelFrame } from "../components/pixel/PixelFrame";
import { PixelButton } from "../components/pixel/PixelButton";
import { PixelProgress } from "../components/pixel/PixelProgress";
import { PX } from "../components/pixel/palettes";

/** 候选 UI 风格（全程像素字体，仅整体处理手法/配色不同） */
const STYLES: { name: string; desc: string; vars: PvVars }[] = [
  {
    name: "① 复古 Bevel（当前）",
    desc: "直角 + 硬立体斜角边 + 硬投影，工具软件/复古气质",
    vars: {
      "--pv-bg": "#e8f0f8",
      "--pv-chrome": "#dbe8f2",
      "--pv-surface": "#ffffff",
      "--pv-text": "#1b2c3d",
      "--pv-muted": "#61788e",
      "--pv-accent": "#12a8bd",
      "--pv-on-accent": "#06222b",
      "--pv-outline": "#5b7d9c",
      "--pv-radius": "0px",
      "--pv-dot": "0",
      "--pv-card-shadow":
        "inset 1px 1px 0 #ffffff, inset -1px -1px 0 #93aec6, 4px 4px 0 #b7cadb",
      "--pv-btn-shadow":
        "inset 1px 1px 0 #ffffff, inset -1px -1px 0 #93aec6, 2px 2px 0 #b7cadb",
      "--pv-btn-active-shadow":
        "inset 1px 1px 0 #93aec6, inset -1px -1px 0 #ffffff",
      "--pv-ghost-shadow":
        "inset 1px 1px 0 #ffffff, inset -1px -1px 0 #93aec6, 2px 2px 0 #b7cadb",
      "--pv-well": "#c6d8e7",
      "--pv-well-shadow": "inset 1px 1px 0 #93aec6, inset -1px -1px 0 #ffffff",
      "--pv-fill-shadow": "inset 1px 1px 0 #ffffff, inset -1px -1px 0 #93aec6",
      "--pv-fill-radius": "0px",
    },
  },
  {
    name: "② 软萌像素 Soft Kawaii",
    desc: "圆角 + 柔和阴影/青色微发光 + 大留白，精致可爱现代感",
    vars: {
      "--pv-bg": "#eef5fc",
      "--pv-chrome": "#ffffff",
      "--pv-surface": "#ffffff",
      "--pv-text": "#33506a",
      "--pv-muted": "#8aa0b5",
      "--pv-accent": "#35c4d6",
      "--pv-on-accent": "#053039",
      "--pv-outline": "#dbe8f2",
      "--pv-radius": "10px",
      "--pv-dot": "50%",
      "--pv-card-shadow": "0 6px 16px rgba(70,130,170,0.14)",
      "--pv-btn-shadow": "0 4px 10px rgba(53,196,214,0.35)",
      "--pv-btn-active-shadow": "0 2px 5px rgba(53,196,214,0.30)",
      "--pv-ghost-shadow": "0 3px 8px rgba(70,130,170,0.12)",
      "--pv-well": "#e6eff8",
      "--pv-well-shadow": "inset 0 2px 4px rgba(70,130,170,0.18)",
      "--pv-fill-shadow": "0 0 8px rgba(53,196,214,0.55)",
      "--pv-fill-radius": "8px",
    },
  },
  {
    name: "③ 温暖治愈像素 Cozy",
    desc: "奶油暖底 + 青绿点缀 + 圆润块 + 柔和平投影，itch.io 治愈系",
    vars: {
      "--pv-bg": "#f3eee3",
      "--pv-chrome": "#fbf7ee",
      "--pv-surface": "#fffdf8",
      "--pv-text": "#4b4232",
      "--pv-muted": "#93876f",
      "--pv-accent": "#2fb0a6",
      "--pv-on-accent": "#fffdf8",
      "--pv-outline": "#d8c8a8",
      "--pv-radius": "6px",
      "--pv-dot": "50%",
      "--pv-card-shadow": "3px 3px 0 rgba(120,100,70,0.18)",
      "--pv-btn-shadow": "2px 2px 0 rgba(70,110,105,0.35)",
      "--pv-btn-active-shadow": "1px 1px 0 rgba(70,110,105,0.35)",
      "--pv-ghost-shadow": "2px 2px 0 rgba(120,100,70,0.15)",
      "--pv-well": "#ece3d1",
      "--pv-well-shadow": "inset 0 1px 3px rgba(120,100,70,0.20)",
      "--pv-fill-shadow": "none",
      "--pv-fill-radius": "4px",
    },
  },
  {
    name: "④ 霓虹暗色 Neon Anime",
    desc: "深藏蓝 + 青色霓虹辉光 + 细描边，VTuber 工具/未来感",
    vars: {
      "--pv-bg": "#0a1626",
      "--pv-chrome": "#11233b",
      "--pv-surface": "#12253d",
      "--pv-text": "#e6f0fa",
      "--pv-muted": "#8fa8c2",
      "--pv-accent": "#3fd2e2",
      "--pv-on-accent": "#04202a",
      "--pv-outline": "#28506f",
      "--pv-radius": "3px",
      "--pv-dot": "50%",
      "--pv-card-shadow": "0 0 0 1px #1c3a56, 0 8px 20px rgba(0,0,0,0.5)",
      "--pv-btn-shadow": "0 0 12px rgba(63,210,226,0.50)",
      "--pv-btn-active-shadow": "0 0 6px rgba(63,210,226,0.40)",
      "--pv-ghost-shadow": "0 0 0 1px #1c3a56",
      "--pv-well": "#0b1c30",
      "--pv-well-shadow": "inset 0 2px 5px rgba(0,0,0,0.6)",
      "--pv-fill-shadow": "0 0 10px rgba(63,210,226,0.85)",
      "--pv-fill-radius": "2px",
    },
  },
];

function Debug() {
  const [progress, setProgress] = useState(60);

  return (
    <Page>
      <PageHeader>
        <PageTitle>调试</PageTitle>
        <PageSubtitle>组件陈列室喵～ 主人可以在这里逐个测试观感</PageSubtitle>
      </PageHeader>

      <Panel>
        <PanelTitle>SVG 像素打样（实验）· 仅本页生效喵～</PanelTitle>
        <SettingDesc>
          底层用 JS 测尺寸 + SVG 在像素网格上逐格渲染：多重描边 / 顶部高光 / 底部暗影 /
          像素切角 / 抖动纹理，放大也锐利不糊。对照右上角参考图打样中～
        </SettingDesc>

        <SubTitle>按钮 · 多重内描边 + 高光/暗影 + 像素切角</SubTitle>
        <Row>
          <PixelButton>默认按钮</PixelButton>
          <PixelButton variant="accent">强调按钮</PixelButton>
          <PixelButton disabled>禁用按钮</PixelButton>
        </Row>
        <SettingDesc>静止凸起、悬停抬升、按住凹陷（高光/暗影自动对调）喵～</SettingDesc>

        <SubTitle>进度条 · 青色填充 + 斜向抖动条纹</SubTitle>
        <PixelProgress value={progress} />
        <Row>
          <PixelButton onClick={() => setProgress((p) => Math.max(0, p - 10))}>
            − 10
          </PixelButton>
          <PixelButton variant="accent" onClick={() => setProgress((p) => Math.min(100, p + 10))}>
            + 10
          </PixelButton>
          <Tag>{progress}%</Tag>
        </Row>
        <PixelProgress value={30} />
        <PixelProgress value={85} />

        <SubTitle>异形边框 · 面板 &amp; 双层嵌套头像框</SubTitle>
        <Row style={{ alignItems: "stretch" }}>
          <PixelCard>
            <PixelFrame palette={PX.panel} variant="raised" pixel={3} radius={3} />
            <PixelCardBody>
              <CardName>Nova</CardName>
              <CardMeta>AI PET · Lv.24</CardMeta>
              <PixelProgress value={70} />
            </PixelCardBody>
          </PixelCard>

          <PixelAvatar>
            <PixelFrame palette={PX.accent} variant="raised" pixel={3} radius={3} />
            <PixelAvatarInner>
              <PixelFrame palette={PX.well} variant="sunken" pixel={3} radius={2} />
              <AvatarFace>🐱</AvatarFace>
            </PixelAvatarInner>
          </PixelAvatar>
        </Row>
      </Panel>

      <Panel>
        <PanelTitle>风格预览 · 选一个方向喵～</PanelTitle>
        <SettingDesc>
          同一套迷你窗口（全像素字体），下面用不同处理手法渲染，主人对比后告诉 Kitten
          编号，就照那个方向重做全局～
        </SettingDesc>
        <PreviewGrid>
          {STYLES.map((s) => (
            <StyleCell key={s.name}>
              <StyleName>{s.name}</StyleName>
              <StyleDesc>{s.desc}</StyleDesc>
              <StylePreview vars={s.vars} />
            </StyleCell>
          ))}
        </PreviewGrid>
      </Panel>

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

const SubTitle = styled.div`
  margin-top: calc(${t.unit} * 2);
  font: ${t.textSm};
  color: ${t.colorTextMuted};
  letter-spacing: 1px;
`;

const PixelCard = styled.div`
  position: relative;
  flex: 1 1 220px;
  min-width: 200px;
  padding: calc(${t.unit} * 4);
`;

const PixelCardBody = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: ${t.unit};
  color: ${t.colorText};
`;

const CardName = styled.div`
  font: ${t.textLg};
`;

const CardMeta = styled.div`
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;

const PixelAvatar = styled.div`
  position: relative;
  width: 84px;
  height: 84px;
  padding: 9px;
  flex: 0 0 auto;
`;

const PixelAvatarInner = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const AvatarFace = styled.span`
  position: relative;
  z-index: 1;
  font-size: 32px;
  line-height: 1;
`;

const PreviewGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: calc(${t.unit} * 4);
`;

const StyleCell = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.unit};
`;

const StyleName = styled.div`
  font: ${t.textMd};
  color: ${t.colorText};
`;

const StyleDesc = styled.div`
  font: ${t.textSm};
  color: ${t.colorTextMuted};
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
