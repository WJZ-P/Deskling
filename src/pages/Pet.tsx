import { styled } from "@linaria/react";
import { invoke } from "@tauri-apps/api/core";
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

/**
 * 桌宠页：展示当前桌宠信息的卡片。
 * 先用像素组件搭个骨架 + 占位文案，后续再接真实状态 / TTS / 互动。
 */

/** 当前桌宠占位数据（后续接入真实状态源） */
const PET = {
  name: "Deskling",
  species: "AI 猫娘桌宠",
  level: 1,
  mood: "待命中",
  face: "🐱",
  bio: "一只住在桌面上的 AI agent 桌宠，随时准备陪主人喵～",
};

/** 状态占位数值（0–100，后续接真实数据） */
const STATS = [
  { key: "energy", label: "精力", value: 82 },
  { key: "mood", label: "心情", value: 90 },
  { key: "bond", label: "亲密度", value: 40 },
];

function Pet() {
  return (
    <Page>
      <PageHeader>
        <PageTitle>桌宠</PageTitle>
        <PageSubtitle>看看你的桌面小伙伴现在怎么样喵～</PageSubtitle>
      </PageHeader>

      <PixelSection title="当前桌宠" trailing={<Tag>在线</Tag>}>
        <Profile>
          {/* 双层像素头像框：外青框 + 内凹槽底 + 表情 */}
          <Avatar>
            <PixelFrame palette={PX.accent} variant="raised" pixel={3} radius={3} />
            <AvatarInner>
              <PixelFrame palette={PX.well} variant="sunken" pixel={3} radius={2} />
              <AvatarFace>{PET.face}</AvatarFace>
            </AvatarInner>
          </Avatar>

          <Meta>
            <PetName>{PET.name}</PetName>
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
          <PixelButton onClick={() => void invoke("pet_summon")}>召唤到桌面</PixelButton>
          <PixelButton variant="primary">开始对话</PixelButton>
        </Actions>
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

const AvatarFace = styled.span`
  position: relative;
  z-index: 1;
  font-size: 34px;
  line-height: 1;
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
