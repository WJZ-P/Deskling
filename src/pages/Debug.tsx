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
import { PixelCard } from "../components/pixel/PixelCard";
import { PixelSection } from "../components/pixel/PixelSection";
import { PixelInput } from "../components/pixel/PixelInput";
import { PixelSelect } from "../components/pixel/PixelSelect";
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

const MODEL_OPTIONS = [
  { value: "gpt", label: "GPT · 通用对话" },
  { value: "claude", label: "Claude · 长文推理" },
  { value: "local", label: "本地模型（离线）" },
  { value: "soon", label: "自定义模型（敬请期待）", disabled: true },
];

function Debug() {
  const [progress, setProgress] = useState(60);
  const [petName, setPetName] = useState("");
  const [search, setSearch] = useState("");
  const [model, setModel] = useState("gpt");
  const [voice, setVoice] = useState("");

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
          <PixelButton variant="primary">强调按钮</PixelButton>
          <PixelButton disabled>禁用按钮</PixelButton>
        </Row>
        <SettingDesc>静止凸起、悬停抬升、按住凹陷（高光/暗影自动对调）喵～</SettingDesc>

        <SubTitle>进度条 · 青色填充 + 斜向抖动条纹</SubTitle>
        <PixelProgress value={progress} />
        <Row>
          <PixelButton onClick={() => setProgress((p) => Math.max(0, p - 10))}>
            − 10
          </PixelButton>
          <PixelButton variant="primary" onClick={() => setProgress((p) => Math.min(100, p + 10))}>
            + 10
          </PixelButton>
          <Tag>{progress}%</Tag>
        </Row>
        <PixelProgress value={30} />
        <PixelProgress value={85} />

        <SubTitle>异形边框 · 面板 &amp; 双层嵌套头像框</SubTitle>
        <Row style={{ alignItems: "stretch" }}>
          <FrameCard>
            <PixelFrame palette={PX.panel} variant="raised" pixel={3} radius={3} />
            <FrameCardBody>
              <CardName>Nova</CardName>
              <CardMeta>AI PET · Lv.24</CardMeta>
              <PixelProgress value={70} />
            </FrameCardBody>
          </FrameCard>

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
        <PanelTitle>卡片 Card · 打样喵～</PanelTitle>
        <SettingDesc>
          基于静态 PixelFrame 的容器：多重描边 + 高光/暗影 + 像素圆角 + 硬投影。
          三种面色（纯白 / 浅青 / 青），可选标题头、尾插槽、悬停抬升。
        </SettingDesc>

        <SubTitle>基础卡片（surface / soft / accent）</SubTitle>
        <CardGrid>
          <PixelCard title="纯白卡片" variant="low">
            这是一段卡片正文喵～ 适合放说明、状态或次要信息，和凸起面板形成层次。
          </PixelCard>
          <PixelCard title="浅青卡片" variant="normal">
            soft 变体用浅青面色，低调但仍带青蓝识别色。
          </PixelCard>
          <PixelCard title="青色卡片" variant="primary">
            accent 变体用青色面色，适合强调/推荐位，文字用深青墨保证对比。
          </PixelCard>
        </CardGrid>

        <SubTitle>带尾插槽 + 操作（可交互，悬停抬升）</SubTitle>
        <CardGrid>
          <PixelCard title="Nova" trailing={<Tag>Lv.24</Tag>} variant="low" interactive>
            <div>AI PET · 在线</div>
            <div style={{ marginTop: 8 }}>
              <PixelProgress value={70} />
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <PixelButton>详情</PixelButton>
              <PixelButton variant="primary">互动</PixelButton>
            </div>
          </PixelCard>

          <PixelCard title="每日奖励" trailing={<Tag>New</Tag>} variant="normal" interactive>
            <div>登录即可领取今日能量补给喵～</div>
            <div style={{ marginTop: 12 }}>
              <PixelButton variant="primary">领取</PixelButton>
            </div>
          </PixelCard>
        </CardGrid>
      </Panel>

      <Panel>
        <PanelTitle>分区容器 Section · 打样喵～</PanelTitle>
        <SettingDesc>
          包裹卡片/其他元素的静态父容器（无动画）：浅青「凹槽」底 + 像素虚线标题分隔，
          让内部白色卡片自然浮起来，形成层次。
        </SettingDesc>

        <PixelSection title="我的桌宠" trailing={<Tag>2 只</Tag>}>
          <CardGrid>
            <PixelCard title="Nova" trailing={<Tag>Lv.24</Tag>} variant="low" interactive>
              <div>AI PET · 在线</div>
              <div style={{ marginTop: 8 }}>
                <PixelProgress value={70} />
              </div>
            </PixelCard>
            <PixelCard title="Momo" trailing={<Tag>Lv.9</Tag>} variant="low" interactive>
              <div>AI PET · 休眠</div>
              <div style={{ marginTop: 8 }}>
                <PixelProgress value={30} />
              </div>
            </PixelCard>
          </CardGrid>
          <Row>
            <PixelButton>管理</PixelButton>
            <PixelButton variant="primary">＋ 新建桌宠</PixelButton>
          </Row>
        </PixelSection>

        <div style={{ height: 16 }} />

        <PixelSection title="纯白底变体" variant="low">
          <SettingDesc>variant=&quot;panel&quot; 用纯白底，适合内容本身已带底色时。</SettingDesc>
          <CardGrid>
            <PixelCard title="浅青卡片" variant="normal">
              白底 section + 浅青卡片，也是一种层次搭配喵。
            </PixelCard>
            <PixelCard title="青色卡片" variant="primary">
              强调卡片放白底 section 里更跳。
            </PixelCard>
          </CardGrid>
        </PixelSection>
      </Panel>

      <Panel>
        <PanelTitle>输入框 Input &amp; 下拉 Select · 打样喵～</PanelTitle>
        <SettingDesc>
          输入框基于 PixelFrame 的凹陷底 + 透明原生 input，聚焦时描边变青；
          下拉是全自定义像素弹层（非原生 select），选项列表也是像素风，支持键盘 ↑↓/Enter/Esc。
        </SettingDesc>

        <SubTitle>输入框（low 白底 / normal 浅青 / primary 深色）</SubTitle>
        <FieldGrid>
          <PixelInput
            variant="low"
            placeholder="给桌宠起个名字…"
            value={petName}
            onChange={(e) => setPetName(e.target.value)}
          />
          <PixelInput
            variant="normal"
            leading="🔍"
            placeholder="搜索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <PixelInput variant="primary" placeholder="强调输入框" />
          <PixelInput variant="low" placeholder="禁用输入框" disabled />
        </FieldGrid>

        <SubTitle>下拉选择（normal / low / primary，含禁用项）</SubTitle>
        <FieldGrid>
          <PixelSelect
            options={MODEL_OPTIONS}
            value={model}
            onChange={setModel}
            variant="normal"
          />
          <PixelSelect
            options={MODEL_OPTIONS}
            value={voice}
            onChange={setVoice}
            placeholder="选择声音…"
            variant="low"
          />
          <PixelSelect
            options={MODEL_OPTIONS}
            value={model}
            onChange={setModel}
            variant="primary"
          />
          <PixelSelect options={MODEL_OPTIONS} placeholder="禁用下拉" disabled />
        </FieldGrid>
        <SettingDesc>当前选择：模型 = {model || "（未选）"}，声音 = {voice || "（未选）"}</SettingDesc>
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

const CardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: calc(${t.unit} * 4);
  align-items: start;
`;

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: calc(${t.unit} * 3);
  align-items: start;

  /* 让内部 PixelInput/PixelSelect 撑满栅格列 */
  & > * {
    width: 100%;
  }
`;

const FrameCard = styled.div`
  position: relative;
  flex: 1 1 220px;
  min-width: 200px;
  padding: calc(${t.unit} * 4);
`;

const FrameCardBody = styled.div`
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
