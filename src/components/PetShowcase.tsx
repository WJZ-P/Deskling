import { useEffect, useState } from "react";
import { styled } from "@linaria/react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { t } from "../styles/theme";
import { PixelFrame } from "./pixel/PixelFrame";
import { PixelModal } from "./pixel/PixelModal";
import { PixelButton } from "./pixel/PixelButton";
import { PixelConfirmModal } from "./pixel/PixelConfirmModal";
import { PixelInput } from "./pixel/PixelInput";
import { PixelSelect, type PixelSelectOption } from "./pixel/PixelSelect";
import { PixelTextarea } from "./pixel/PixelTextarea";
import { PixelTip } from "./pixel/PixelTip";
import { PRIORITY_PAL } from "./pixel/palettes";
import {
  DEFAULT_PET_VOICE,
  getSetting,
  setActivePet,
  updatePetProfile,
  type PetProfile,
  type PetVoice,
} from "../settings";

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
        active={editing?.id === activePetId}
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
        <SpriteImg
          src={pet.sprite}
          alt=""
          draggable={false}
          data-pixel={pet.appearanceType === "sprite-sheet" || undefined}
        />
      </Card>
    </PixelTip>
  );
}

/** 语音包扫描结果（tts_packs 命令返回的条目，前端只关心这些字段） */
interface TtsPack {
  id: string;
  name: string;
  engine: string;
  voices: { id: number; name: string; lang?: string }[];
  version?: string;
  author?: string;
  license?: string;
  sizeBytes: number;
  builtin: boolean;
  valid: boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  const rank = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** rank;
  return `${value >= 10 || rank === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[rank]}`;
}

/** 人设面板：编辑名字 / 人设 prompt / 嗓音。open 由 pet != null 驱动 */
function PetEditModal({
  pet,
  active,
  onClose,
  onSaved,
}: {
  pet: PetProfile | null;
  active: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  // 嗓音草稿：packId 空串 = 静音（下拉里的显式选项）
  const [voice, setVoice] = useState<PetVoice>(DEFAULT_PET_VOICE);
  // 语音包列表：面板打开时扫一次（工坊装了新包重开面板即可见）
  const [packs, setPacks] = useState<TtsPack[]>([]);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [removePack, setRemovePack] = useState<TtsPack | null>(null);

  const refreshPacks = async (): Promise<TtsPack[]> => {
    const list = (await invoke<TtsPack[]>("tts_packs")).filter((pack) => pack.valid);
    setPacks(list);
    return list;
  };

  // 打开面板（editing 换人）时，把草稿重置成该档案当前值
  useEffect(() => {
    if (pet) {
      setName(pet.name);
      setPrompt(pet.prompt);
      setVoice(pet.voice ?? DEFAULT_PET_VOICE);
      setVoiceMessage("");
      setRemovePack(null);
      void refreshPacks()
        .catch(() => setPacks([]));
    }
  }, [pet]);

  const save = async () => {
    if (!pet) return;
    await updatePetProfile(pet.id, { name: name.trim() || pet.name, prompt, voice });
    onSaved();
  };

  const activate = async () => {
    if (!pet || active) return;
    await setActivePet(pet.id);
    await emitTo("pet", "pet:appearance-changed");
    onSaved();
  };

  // 试听：用草稿嗓音直接念一句（不用保存；静音态按钮禁用）
  const audition = () => {
    if (!voice.packId) return;
    void invoke("tts_speak", {
      text: `你好呀主人，我是${name.trim() || pet?.name || "你的桌宠"}，以后就用这个声音陪你说话喵。`,
      packId: voice.packId,
      voiceId: voice.voiceId,
      speed: voice.speed ?? 1,
      // 扬声器走设置页「声音 · 扬声器」（"" = 系统默认）
      device: getSetting("ttsDevice") || null,
    }).catch((err) => console.warn("tts 试听失败:", err));
  };

  const importVoice = async (directory: boolean) => {
    setVoiceMessage("");
    let selected: string | string[] | null;
    try {
      selected = await open(
        directory
          ? {
              title: "选择 sherpa-onnx TTS 模型目录",
              multiple: false,
              directory: true,
            }
          : {
              title: "选择 Deskling 音色包",
              multiple: false,
              directory: false,
              filters: [
                {
                  name: "Deskling 音色包",
                  extensions: ["zip", "deskling-voice"],
                },
              ],
            },
      );
    } catch (error) {
      setVoiceMessage(`无法打开文件选择器：${errorText(error)}`);
      return;
    }
    const sourcePath = Array.isArray(selected) ? selected[0] : selected;
    if (!sourcePath) return;

    setVoiceBusy(true);
    setVoiceMessage("正在复制并校验模型，第一次加载大模型可能需要一些时间…");
    try {
      const installed = await invoke<TtsPack>("tts_pack_import", { sourcePath });
      const list = await refreshPacks();
      const ready = list.find((pack) => pack.id === installed.id) ?? installed;
      setVoice((current) => ({
        packId: ready.id,
        voiceId: ready.voices[0]?.id ?? 0,
        speed: current.speed ?? 1,
      }));
      setVoiceMessage(`已导入「${ready.name}」并选中；点击“保存”后应用到当前桌宠。`);
    } catch (error) {
      setVoiceMessage(`导入失败：${errorText(error)}`);
    } finally {
      setVoiceBusy(false);
    }
  };

  const uninstallVoice = async () => {
    if (!removePack) return;
    const target = removePack;
    setRemovePack(null);
    setVoiceBusy(true);
    setVoiceMessage(`正在卸载「${target.name}」…`);
    try {
      const list = await invoke<TtsPack[]>("tts_pack_remove", { packId: target.id });
      setPacks(list.filter((pack) => pack.valid));
      if (voice.packId === target.id) {
        setVoice(DEFAULT_PET_VOICE);
      }
      setVoiceMessage(`已卸载「${target.name}」。`);
    } catch (error) {
      setVoiceMessage(`卸载失败：${errorText(error)}`);
    } finally {
      setVoiceBusy(false);
    }
  };

  const packOptions: PixelSelectOption[] = [
    { value: "", label: "静音（不说话）" },
    ...packs.map((p) => ({ value: p.id, label: p.name })),
  ];
  const activePack = packs.find((p) => p.id === voice.packId);
  const voiceOptions: PixelSelectOption[] =
    activePack?.voices.map((v) => ({ value: String(v.id), label: v.name })) ?? [];

  return (
    <>
      <PixelModal
        open={pet != null}
        title={`桌宠设置 · ${pet?.name ?? ""}`}
        onClose={onClose}
        width={520}
        footer={
          <>
            {!active && (
              <PixelButton variant="normal" onClick={() => void activate()}>
                设为当前桌宠
              </PixelButton>
            )}
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
          <FieldLabel>嗓音</FieldLabel>
          <VoiceRow>
            <PixelSelect
              options={packOptions}
              value={voice.packId}
              onChange={(packId) => {
                const nextPack = packs.find((pack) => pack.id === packId);
                // 不同模型的 sid 空间不同，切包时选中它声明的第一个可用音色。
                setVoice((current) =>
                  packId === ""
                    ? { ...current, packId: "" }
                    : {
                        packId,
                        voiceId: nextPack?.voices[0]?.id ?? 0,
                        speed: current.speed ?? 1,
                      },
                );
              }}
              variant="normal"
            />
            {voice.packId !== "" && (
              <PixelSelect
                options={voiceOptions}
                value={String(voice.voiceId)}
                onChange={(id) => setVoice((v) => ({ ...v, voiceId: Number(id) }))}
                variant="normal"
              />
            )}
            <PixelButton
              small
              pixel={3}
              disabled={voice.packId === "" || voiceBusy}
              onClick={audition}
            >
              试听
            </PixelButton>
          </VoiceRow>
          {activePack && (
            <PackMeta>
              {activePack.engine.toUpperCase()} · {activePack.voices.length} 个音色 ·{" "}
              {formatBytes(activePack.sizeBytes)}
              {activePack.author ? ` · ${activePack.author}` : ""}
            </PackMeta>
          )}
          <VoiceActions>
            <PixelButton
              small
              pixel={3}
              disabled={voiceBusy}
              onClick={() => void importVoice(true)}
            >
              导入模型目录
            </PixelButton>
            <PixelButton
              small
              pixel={3}
              variant="low"
              disabled={voiceBusy}
              onClick={() => void importVoice(false)}
            >
              导入 ZIP 音色包
            </PixelButton>
            {activePack && !activePack.builtin && (
              <PixelButton
                small
                pixel={3}
                variant="low"
                disabled={voiceBusy}
                onClick={() => setRemovePack(activePack)}
              >
                卸载当前音色
              </PixelButton>
            )}
          </VoiceActions>
          {voiceMessage && (
            <VoiceMessage role={voiceMessage.includes("失败") ? "alert" : "status"}>
              {voiceMessage}
            </VoiceMessage>
          )}
          <FieldHint>
            可直接导入现成的 sherpa-onnx Kokoro、VITS/Melo 或 Matcha 模型目录；无需重新训练或转换
            ONNX 文件。
          </FieldHint>
        </FieldBlock>
        <FieldBlock>
          <FieldLabel>人设 Prompt</FieldLabel>
          <PixelTextarea
            rows={6}
            value={prompt}
            placeholder="它是谁、什么性格、怎么说话……"
            onChange={(e) => setPrompt(e.target.value)}
          />
          <FieldHint>对话时作为 system prompt 下发给模型（注入链路接好后生效）</FieldHint>
        </FieldBlock>
      </PixelModal>
      <PixelConfirmModal
        open={removePack != null}
        title="卸载自定义音色"
        message={
          <>
            确定卸载「{removePack?.name}」吗？引用它的其他桌宠会暂时静音，重新导入同一音色包后可恢复。
          </>
        }
        confirmLabel="卸载"
        tone="danger"
        onCancel={() => setRemovePack(null)}
        onConfirm={() => void uninstallVoice()}
      />
    </>
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
  image-rendering: auto;
  -webkit-user-drag: none;

  &[data-pixel] {
    image-rendering: pixelated;
  }
`;

const FieldBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

/* 嗓音行：语音包 + 音色两个下拉 + 试听按钮，横排随宽换行 */
const VoiceRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const VoiceActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
`;

const PackMeta = styled.span`
  font: ${t.textXs};
  color: ${t.colorTextMuted};
`;

const VoiceMessage = styled.div`
  padding: 7px 9px;
  border-left: 3px solid ${t.colorAccent};
  background: ${t.colorAccentSoft};
  font: ${t.textSm};
  line-height: 1.5;
  color: ${t.colorText};
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
