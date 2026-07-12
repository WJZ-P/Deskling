import { useEffect, useState } from "react";
import { styled } from "@linaria/react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { t } from "../styles/theme";
import {
  Page,
  PageHeader,
  PageSubtitle,
  PageTitle,
  Tag,
} from "../components/ui";
import { PixelSection } from "../components/pixel/PixelSection";
import { PixelCard } from "../components/pixel/PixelCard";
import { PixelProgress } from "../components/pixel/PixelProgress";
import { PixelButton } from "../components/pixel/PixelButton";
import { PixelFrame } from "../components/pixel/PixelFrame";
import { PX } from "../components/pixel/palettes";
import { PetShowcase } from "../components/PetShowcase";
import { getPetProfiles, getSetting } from "../settings";

/**
 * 桌宠页：桌宠展示栏（图标卡，点击拉起人设面板）+ 当前桌宠信息大卡。
 * 名字/头像来自桌宠档案（settings.petProfiles）；
 * 状态数值仍是占位，后续再接真实状态 / TTS / 互动。
 */

/** 当前桌宠占位数据（名字/头像已接档案，其余后续接入真实状态源） */
const PET = {
  species: "AI 雪豹桌宠",
  level: 1,
  mood: "待命中",
  bio: "一只住在桌面上的 AI agent 桌宠，随时准备陪主人喵～",
};

/** 状态占位数值（0–100，后续接真实数据） */
const STATS = [
  { key: "energy", label: "精力", value: 82 },
  { key: "mood", label: "心情", value: 90 },
  { key: "bond", label: "亲密度", value: 40 },
];

/** 动画测试项：key 与桌宠窗 ANIMS 的状态键一一对应 */
const ANIM_TESTS = [
  { key: "idle", label: "待机" },
  { key: "talking", label: "说话" },
  { key: "walking", label: "走路" },
  { key: "typing", label: "敲电脑" },
  { key: "petted", label: "摸头" },
  { key: "sleeping", label: "睡觉" },
] as const;

function Pet() {
  // 桌宠 / 对话窗的可见状态：挂载时向后端查一次，之后每次 toggle 用返回值更新，
  // 让按钮文案（召唤/收起 · 打开/关闭）跟真实窗口状态一致。
  const [petShown, setPetShown] = useState(false);
  const [chatShown, setChatShown] = useState(false);
  // 桌宠档案：本页持有一份（展示栏 + 大卡片共用），面板保存后重读缓存刷新
  const [pets, setPets] = useState(getPetProfiles);
  const activePet = pets.find((p) => p.id === getSetting("activePetId")) ?? pets[0];

  useEffect(() => {
    void invoke<boolean>("pet_visible").then(setPetShown).catch(() => {});
    void invoke<boolean>("chat_visible").then(setChatShown).catch(() => {});
  }, []);

  const togglePet = async () => {
    try {
      setPetShown(await invoke<boolean>("pet_toggle"));
    } catch (err) {
      console.warn("pet_toggle failed:", err);
    }
  };

  const toggleChat = async () => {
    try {
      setChatShown(await invoke<boolean>("chat_toggle"));
    } catch (err) {
      console.warn("chat_toggle failed:", err);
    }
  };

  return (
    <Page>
      <PageHeader>
        <PageTitle>桌宠</PageTitle>
        <PageSubtitle>看看你的桌面小伙伴现在怎么样喵～</PageSubtitle>
      </PageHeader>

      <PixelSection title="我的桌宠">
        <PetShowcase
          pets={pets}
          activePetId={activePet?.id ?? ""}
          onChanged={() => setPets(getPetProfiles())}
        />
      </PixelSection>

      <PixelSection title="当前桌宠" trailing={<Tag>在线</Tag>}>
        <Profile>
          {/* 双层像素头像框：外青框 + 内凹槽底 + 精灵图头像 */}
          <Avatar>
            <PixelFrame palette={PX.accent} variant="raised" pixel={3} radius={3} />
            <AvatarInner>
              <PixelFrame palette={PX.well} variant="sunken" pixel={3} radius={2} />
              <AvatarSprite src={activePet?.sprite ?? "/pet/xuebao.png"} alt="" draggable={false} />
            </AvatarInner>
          </Avatar>

          <Meta>
            <PetName>{activePet?.name ?? "Deskling"}</PetName>
            <PetSpecies>
              {PET.species} · Lv.{PET.level}
            </PetSpecies>
            <PetBio>{PET.bio}</PetBio>
          </Meta>
        </Profile>

        <StatGrid>
          {STATS.map((s) => (
            <PixelCard key={s.key} title={s.label} trailing={<Tag>{s.value}%</Tag>} variant="low">
              <PixelProgress value={s.value} />
            </PixelCard>
          ))}
        </StatGrid>

        <Actions>
          <PixelButton onClick={() => void togglePet()}>
            {petShown ? "从桌面收起" : "召唤到桌面"}
          </PixelButton>
          <PixelButton variant="primary" onClick={() => void toggleChat()}>
            {chatShown ? "关闭对话" : "打开对话"}
          </PixelButton>
        </Actions>
      </PixelSection>

      <PixelSection title="动画测试">
        <TestRow>
          {ANIM_TESTS.map((t) => (
            <PixelButton
              key={t.key}
              small
              pixel={3}
              onClick={() => void emitTo("pet", "pet:play", { state: t.key })}
            >
              {t.label}
            </PixelButton>
          ))}
        </TestRow>
        <TestHint>
          桌宠在桌面上时点按切换动画；「摸头」播完自动回待机，循环类动画点「待机」收场
        </TestHint>
      </PixelSection>
    </Page>
  );
}

export default Pet;

const Profile = styled.div`
  display: flex;
  align-items: center;
  gap: calc(${t.unit} * 4);
`;

const Avatar = styled.div`
  position: relative;
  width: 88px;
  height: 88px;
  padding: 9px;
  flex: 0 0 auto;
`;

const AvatarInner = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const AvatarSprite = styled.img`
  position: relative;
  z-index: 1;
  width: 48px;
  height: 48px;
  image-rendering: pixelated;
  -webkit-user-drag: none;
`;

const Meta = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.unit};
  min-width: 0;
`;

const PetName = styled.div`
  font: ${t.textXl};
  letter-spacing: 2px;
  color: ${t.colorAccent};
`;

const PetSpecies = styled.div`
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;

const PetBio = styled.p`
  margin: 0;
  font: ${t.textSm};
  line-height: 1.7;
  color: ${t.colorText};
`;

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: calc(${t.unit} * 3);
  align-items: start;
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: calc(${t.unit} * 2);
`;

/* 动画测试按钮排 */
const TestRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: calc(${t.unit} * 2);
`;

const TestHint = styled.p`
  margin: 0;
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;
