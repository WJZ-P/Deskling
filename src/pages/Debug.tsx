import { useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../styles/theme";
import {
  PixelPage,
  PixelPageHeader,
  PixelPageTitle,
  PixelPageSubtitle,
} from "../components/pixel/PixelPage";
import { PixelSection } from "../components/pixel/PixelSection";
import { PixelCard } from "../components/pixel/PixelCard";
import { PixelButton } from "../components/pixel/PixelButton";
import { PixelProgress } from "../components/pixel/PixelProgress";
import { PixelInput } from "../components/pixel/PixelInput";
import { PixelSelect } from "../components/pixel/PixelSelect";
import { PixelTag, PixelSoonTag } from "../components/pixel/PixelTag";
import { PixelWell } from "../components/pixel/PixelWell";
import { PixelDivider } from "../components/pixel/PixelDivider";
import {
  PixelSettingList,
  PixelSettingRow,
  PixelSettingInfo,
  PixelSettingLabel,
  PixelSettingDesc,
} from "../components/pixel/PixelSettingRow";
import { PixelFrame } from "../components/pixel/PixelFrame";
import { PX } from "../components/pixel/palettes";

/**
 * 组件陈列室：逐个展示 pixel 组件库，每个组件单独一个 PixelSection 方便验收。
 * 全程只用 pixel 组件（不含任何旧 ui.tsx 组件）。
 *
 * 性能约定：交互 demo 的 state 一律「下放」到各自的小组件里（ProgressDemo /
 * InputDemo / SelectDemo），不要提升到页面顶层 —— 否则点一下按钮整个陈列室
 * 重渲染，几十个 PixelFrame 重建几万个 SVG rect 虚拟 DOM，会整体卡一下喵。
 */

const MODEL_OPTIONS = [
  { value: "gpt", label: "GPT · 通用对话" },
  { value: "claude", label: "Claude · 长文推理" },
  { value: "local", label: "本地模型（离线）" },
  { value: "soon", label: "自定义模型（敬请期待）", disabled: true },
];

/** 进度条 demo：state 只在本节内，点 ±10 不波及页面其他分区 */
function ProgressDemo() {
  const [progress, setProgress] = useState(60);
  return (
    <PixelSection title="进度条 PixelProgress" trailing={<PixelTag>{progress}%</PixelTag>}>
      <PixelSettingDesc>青色填充 + 斜向抖动条纹，凹槽底 + 凸起填充块。</PixelSettingDesc>
      <PixelProgress value={progress} />
      <Row>
        <PixelButton onClick={() => setProgress((p) => Math.max(0, p - 10))}>− 10</PixelButton>
        <PixelButton variant="primary" onClick={() => setProgress((p) => Math.min(100, p + 10))}>
          + 10
        </PixelButton>
      </Row>
      <PixelProgress value={30} />
      <PixelProgress value={85} />
    </PixelSection>
  );
}

/** 输入框 demo：受控输入的 state 同样只在本节内，打字不重渲染整页 */
function InputDemo() {
  const [petName, setPetName] = useState("");
  const [search, setSearch] = useState("");
  return (
    <PixelSection title="输入框 PixelInput">
      <PixelSettingDesc>
        复用按钮的 PixelSurface 弹簧引擎，聚焦时描边逐像素点亮、低噪动起来。上浮透明原生 input 负责输入/输入法。
      </PixelSettingDesc>
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
    </PixelSection>
  );
}

/** 下拉选择 demo */
function SelectDemo() {
  const [model, setModel] = useState("gpt");
  const [voice, setVoice] = useState("");
  return (
    <PixelSection title="下拉选择 PixelSelect">
      <PixelSettingDesc>
        全自定义像素弹层（非原生 select），选项列表也是像素风，支持键盘 ↑↓/Enter/Esc 与点击外部关闭。
      </PixelSettingDesc>
      <FieldGrid>
        <PixelSelect options={MODEL_OPTIONS} value={model} onChange={setModel} variant="normal" />
        <PixelSelect
          options={MODEL_OPTIONS}
          value={voice}
          onChange={setVoice}
          placeholder="选择声音…"
          variant="low"
        />
        <PixelSelect options={MODEL_OPTIONS} value={model} onChange={setModel} variant="primary" />
        <PixelSelect options={MODEL_OPTIONS} placeholder="禁用下拉" disabled />
      </FieldGrid>
      <PixelSettingDesc>当前选择：模型 = {model || "（未选）"}，声音 = {voice || "（未选）"}</PixelSettingDesc>
    </PixelSection>
  );
}

function DebugPage() {
  return (
    <PixelPage>
      <PixelPageHeader>
        <PixelPageTitle>调试</PixelPageTitle>
        <PixelPageSubtitle>pixel 组件陈列室喵～ 每个组件单独一节，逐个验收</PixelPageSubtitle>
      </PixelPageHeader>

      {/* ---------- PixelButton ---------- */}
      <PixelSection title="按钮 PixelButton" trailing={<PixelTag>Button</PixelTag>}>
        <PixelSettingDesc>
          多重内描边 + 高光/暗影 + 像素切角。静止凸起、悬停抬升、按住凹陷（高光/暗影自动对调）。
        </PixelSettingDesc>
        <Row>
          <PixelButton>默认按钮</PixelButton>
          <PixelButton variant="primary">强调按钮</PixelButton>
          <PixelButton variant="low">白底按钮</PixelButton>
          <PixelButton disabled>禁用按钮</PixelButton>
        </Row>
      </PixelSection>

      {/* ---------- PixelProgress ---------- */}
      <ProgressDemo />

      {/* ---------- PixelCard ---------- */}
      <PixelSection title="卡片 PixelCard">
        <PixelSettingDesc>
          三种面色（白 low / 浅青 normal / 青 primary），可选标题头、尾插槽、悬停抬升。
        </PixelSettingDesc>
        <CardGrid>
          <PixelCard title="纯白卡片" variant="low">
            适合放说明、状态或次要信息，和凸起面板形成层次。
          </PixelCard>
          <PixelCard title="浅青卡片" variant="normal">
            浅青面色，低调但仍带青蓝识别色。
          </PixelCard>
          <PixelCard title="青色卡片" variant="primary">
            青色面色，适合强调/推荐位，文字用深青墨保证对比。
          </PixelCard>
        </CardGrid>
        <CardGrid>
          <PixelCard title="Nova" trailing={<PixelTag variant="primary">Lv.24</PixelTag>} variant="low" interactive>
            <div>AI PET · 在线</div>
            <div style={{ marginTop: 8 }}>
              <PixelProgress value={70} />
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <PixelButton>详情</PixelButton>
              <PixelButton variant="primary">互动</PixelButton>
            </div>
          </PixelCard>
          <PixelCard title="每日奖励" trailing={<PixelTag>New</PixelTag>} variant="normal" interactive>
            <div>登录即可领取今日能量补给喵～</div>
            <div style={{ marginTop: 12 }}>
              <PixelButton variant="primary">领取</PixelButton>
            </div>
          </PixelCard>
        </CardGrid>
      </PixelSection>

      {/* ---------- PixelSection（嵌套自展示） ---------- */}
      <PixelSection title="分区容器 PixelSection" trailing={<PixelTag>2 只</PixelTag>}>
        <PixelSettingDesc>
          包裹卡片/其他元素的静态父容器：浅青凹槽底 + 像素虚线标题分隔 + 边缘啃缺轮廓，
          让内部白色卡片自然浮起来。（本节外框就是一个 PixelSection）
        </PixelSettingDesc>
        <CardGrid>
          <PixelCard title="Nova" trailing={<PixelTag>Lv.24</PixelTag>} variant="low" interactive>
            <div>AI PET · 在线</div>
            <div style={{ marginTop: 8 }}>
              <PixelProgress value={70} />
            </div>
          </PixelCard>
          <PixelCard title="Momo" trailing={<PixelTag>Lv.9</PixelTag>} variant="low" interactive>
            <div>AI PET · 休眠</div>
            <div style={{ marginTop: 8 }}>
              <PixelProgress value={30} />
            </div>
          </PixelCard>
        </CardGrid>
      </PixelSection>

      {/* ---------- PixelInput ---------- */}
      <InputDemo />

      {/* ---------- PixelSelect ---------- */}
      <SelectDemo />

      {/* ---------- PixelTag / PixelSoonTag ---------- */}
      <PixelSection title="标签 PixelTag / 占位 PixelSoonTag">
        <PixelSettingDesc>
          实心像素描边小标签（三种色阶）+「敬请期待」占位徽标（边缘啃缺做出未完成的粗犷感）。
        </PixelSettingDesc>
        <Row>
          <PixelTag variant="low">白底标签</PixelTag>
          <PixelTag variant="normal">浅青标签</PixelTag>
          <PixelTag variant="primary">青色标签</PixelTag>
          <PixelTag>v0.1.0</PixelTag>
          <PixelSoonTag />
          <PixelSoonTag>开发中</PixelSoonTag>
        </Row>
      </PixelSection>

      {/* ---------- PixelWell / PixelDivider ---------- */}
      <PixelSection title="凹陷容器 PixelWell / 分隔线 PixelDivider">
        <PixelSettingDesc>凹陷内嵌区（放数值/说明/代码）+ 像素虚线分隔。</PixelSettingDesc>
        <PixelWell>
          这是一个凹陷内嵌区，适合放数值、说明或代码，和凸起的分区形成层次对比喵～
        </PixelWell>
        <PixelDivider />
        <PixelSettingDesc>上面那条就是像素虚线分隔（点阵味）。</PixelSettingDesc>
      </PixelSection>

      {/* ---------- PixelSettingRow ---------- */}
      <PixelSection title="设置行 PixelSettingRow">
        <PixelSettingDesc>
          左信息（标签 + 描述）+ 右控件，相邻行自动带像素虚线分隔。多行需包进 PixelSettingList（gap:0）。
        </PixelSettingDesc>
        <PixelSettingList>
          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>主题</PixelSettingLabel>
              <PixelSettingDesc>带像素虚线分隔的设置行</PixelSettingDesc>
            </PixelSettingInfo>
            <PixelButton>操作</PixelButton>
          </PixelSettingRow>
          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>AI 模型</PixelSettingLabel>
              <PixelSettingDesc>第二行会自动出现上方分隔</PixelSettingDesc>
            </PixelSettingInfo>
            <PixelSoonTag />
          </PixelSettingRow>
          <PixelSettingRow>
            <PixelSettingInfo>
              <PixelSettingLabel>背景风格</PixelSettingLabel>
              <PixelSettingDesc>右侧也能放下拉/标签等任意控件</PixelSettingDesc>
            </PixelSettingInfo>
            <PixelTag variant="primary">turbulence</PixelTag>
          </PixelSettingRow>
        </PixelSettingList>
      </PixelSection>

      {/* ---------- PixelFrame（异形边框 / 头像框） ---------- */}
      <PixelSection title="像素帧 PixelFrame（异形边框 / 双层头像框）">
        <PixelSettingDesc>
          底层的静态 SVG 像素帧渲染器：多重描边 / 高光/暗影 / 像素切角 / 动态底噪 / 空心框 / 边缘啃缺。
          卡片、分区、进度条、标签都基于它。
        </PixelSettingDesc>
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
      </PixelSection>
    </PixelPage>
  );
}

export default DebugPage;

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: calc(${t.unit} * 2);
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
