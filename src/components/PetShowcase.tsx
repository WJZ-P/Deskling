import { useEffect, useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../styles/theme";
import { PixelFrame } from "./pixel/PixelFrame";
import { PixelModal } from "./pixel/PixelModal";
import { PixelButton } from "./pixel/PixelButton";
import { PixelInput } from "./pixel/PixelInput";
import { PixelTextarea } from "./pixel/PixelTextarea";
import { PixelTip } from "./pixel/PixelTip";
import { PRIORITY_PAL } from "./pixel/palettes";
import { updatePetProfile, type PetProfile } from "../settings";

/**
 * 桌宠展示栏（桌宠页用）：一排桌宠图标卡，当前桌宠排最前。
 *  - 卡片只放精灵图标（当前桌宠青 plate + 低噪流动高亮，同服务商卡片语汇）；
 *    名字走 PixelTip 悬停小签，不占卡面；
 *  - 点击卡片拉起人设面板（PixelModal）：编辑名字 / 人设 prompt，保存落盘；
 *  - 档案列表由父级（桌宠页）持有传入：保存后 onChanged 通知父级重读，
 *    大卡片的名字/头像同步刷新。
 */

interface PetShowcaseProps {
  pets: PetProfile[];
  activePetId: string;
  /** 档案变更（面板保存后）通知父级重读 settings 缓存 */
  onChanged: () => void;
}

export function PetShowcase({ pets, activePetId, onChanged }: PetShowcaseProps) {
  const [editing, setEditing] = useState<PetProfile | null>(null);
  // 当前桌宠排最前，其余保持原序
  const ordered = [...pets].sort((a, b) =>
    a.id === activePetId ? -1 : b.id === activePetId ? 1 : 0,
  );

  return (
    <>
      <Row>
        {ordered.map((p) => (
          <PetIconCard
            key={p.id}
            pet={p}
            active={p.id === activePetId}
            onOpen={() => setEditing(p)}
          />
        ))}
      </Row>
      <PetEditModal
        pet={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
    </>
  );
}

/** 图标卡：只放精灵图，hover 上浮 + 抬投影（同服务商卡片手感） */
function PetIconCard({
  pet,
  active,
  onOpen,
}: {
  pet: PetProfile;
  active: boolean;
  onOpen: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const stateName = active ? "active" : hovered ? "hover" : "rest";

  return (
    <PixelTip tip={`${pet.name} · 点击设置`}>
      <Card
        role="button"
        tabIndex={0}
        aria-label={`设置 ${pet.name}`}
        data-state={stateName}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <PixelFrame
          palette={active ? PRIORITY_PAL.primary : PRIORITY_PAL.low}
          variant="raised"
          pixel={3}
          radius={2}
          noise={active ? 0.07 : 0.05}
          noiseGranularity={2}
          noiseSpeed={active ? 1.1 : 0}
          elevation={active || hovered ? 4 : 2}
        />
        <SpriteImg src={pet.sprite} alt="" draggable={false} />
      </Card>
    </PixelTip>
  );
}

/** 人设面板：编辑名字 / 人设 prompt。open 由 pet != null 驱动 */
function PetEditModal({
  pet,
  onClose,
  onSaved,
}: {
  pet: PetProfile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");

  // 打开面板（editing 换人）时，把草稿重置成该档案当前值
  useEffect(() => {
    if (pet) {
      setName(pet.name);
      setPrompt(pet.prompt);
    }
  }, [pet]);

  const save = async () => {
    if (!pet) return;
    await updatePetProfile(pet.id, { name: name.trim() || pet.name, prompt });
    onSaved();
  };

  return (
    <PixelModal
      open={pet != null}
      title={`桌宠设置 · ${pet?.name ?? ""}`}
      onClose={onClose}
      width={430}
      footer={
        <>
          <PixelButton variant="low" onClick={onClose}>
            取消
          </PixelButton>
          <PixelButton variant="primary" onClick={() => void save()}>
            保存
          </PixelButton>
        </>
      }
    >
      <FieldBlock>
        <FieldLabel>名字</FieldLabel>
        <PixelInput
          value={name}
          placeholder="桌宠的名字"
          onChange={(e) => setName(e.target.value)}
        />
      </FieldBlock>
      <FieldBlock>
        <FieldLabel>人设 Prompt</FieldLabel>
        <PixelTextarea
          rows={9}
          value={prompt}
          placeholder="它是谁、什么性格、怎么说话……"
          onChange={(e) => setPrompt(e.target.value)}
        />
        <FieldHint>对话时作为 system prompt 下发给模型（注入链路接好后生效）</FieldHint>
      </FieldBlock>
    </PixelModal>
  );
}

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: calc(${t.unit} * 3);
`;

/* 整卡：hover/active 上浮（同服务商卡片手感），投影由 PixelFrame 的 elevation 承担 */
const Card = styled.div`
  position: relative;
  width: 76px;
  height: 76px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  outline: none;
  transition: transform 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.3);

  &[data-state="hover"],
  &[data-state="active"] {
    transform: translateY(-2px);
  }
`;

const SpriteImg = styled.img`
  position: relative;
  z-index: 1;
  width: 52px;
  height: 52px;
  image-rendering: pixelated;
  -webkit-user-drag: none;
`;

const FieldBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const FieldLabel = styled.span`
  font: ${t.textSm};
  font-weight: bold;
  letter-spacing: 1px;
  color: ${t.colorTextMuted};
`;

const FieldHint = styled.span`
  font: ${t.textXs};
  color: ${t.colorTextMuted};
  opacity: 0.8;
`;
