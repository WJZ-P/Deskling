import { useEffect, useRef, useState } from "react";
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
import { PixelButton } from "../components/pixel/PixelButton";
import { PixelFrame } from "../components/pixel/PixelFrame";
import { PX } from "../components/pixel/palettes";
import { PetShowcase } from "../components/PetShowcase";
import { getPetProfiles, getSetting } from "../settings";
import type { Live2DCoreStatus } from "../pet/live2dCore";

/**
 * 桌宠页：桌宠展示栏（图标卡，点击拉起人设面板）+ 当前桌宠信息大卡。
 * 名字/头像来自桌宠包默认值与 settings.petInstances 用户覆盖项的解析结果；
 * 状态数值仍是占位，后续再接真实状态 / TTS / 互动。
 */

/** 动画测试项：key 与桌宠窗 ANIMS 的状态键一一对应 */
const ANIM_TESTS = [
  { key: "idle", label: "待机" },
  { key: "idleLook", label: "张望" },
  { key: "idleGroom", label: "洗脸" },
  { key: "idleScratch", label: "挠耳" },
  { key: "idleSneeze", label: "喷嚏" },
  { key: "idleAlert", label: "警觉" },
  { key: "talking", label: "说话" },
  { key: "walking", label: "走路" },
  { key: "walkingLeft", label: "走路←" },
  { key: "walkingRight", label: "走路→" },
  { key: "walkingUp", label: "走路↑" },
  { key: "walkingDown", label: "走路↓" },
  { key: "typing", label: "敲电脑" },
  { key: "searching", label: "搜索" },
  { key: "listening", label: "聆听" },
  { key: "waitingApproval", label: "待批准" },
  { key: "success", label: "成功" },
  { key: "error", label: "错误" },
  { key: "petted", label: "摸头" },
  { key: "eating", label: "吃文件" },
  { key: "sleeping", label: "睡觉" },
  { key: "yawning", label: "打哈欠" },
  { key: "stretching", label: "伸懒腰" },
  { key: "wakingStartled", label: "吓醒" },
  { key: "wakingDream", label: "美梦醒" },
  { key: "dangling", label: "悬空" },
  { key: "entering", label: "入场" },
  { key: "greeting", label: "打招呼" },
  { key: "thinking", label: "思考中" },
  { key: "hidingLeft", label: "躲←" },
  { key: "hidingRight", label: "躲→" },
  { key: "hidingUp", label: "躲↑" },
  { key: "hidingDown", label: "躲↓" },
  { key: "peekingLeft", label: "探头←" },
  { key: "peekingRight", label: "探头→" },
  { key: "peekingUp", label: "探头↑" },
  { key: "peekingDown", label: "探头↓" },
  { key: "unhideLeft", label: "召回←" },
  { key: "unhideRight", label: "召回→" },
  { key: "unhideUp", label: "召回↑" },
  { key: "unhideDown", label: "召回↓" },
] as const;

/** 正式提示音一对（软木确认定稿）：唤醒 = 上行「在听」，结束 = 镜像下行「收到」 */
const WAKE_SOUNDS = [
  { key: "start", label: "唤醒音 · 在听", src: "/audio/wake-start.wav" },
  { key: "end", label: "结束音 · 收到", src: "/audio/wake-end.wav" },
] as const;

type WakeSound = (typeof WAKE_SOUNDS)[number];

function Pet() {
  // 桌宠 / 对话窗的可见状态：挂载时向后端查一次，之后每次 toggle 用返回值更新，
  // 让按钮文案（召唤/收起 · 打开/关闭）跟真实窗口状态一致。
  const [petShown, setPetShown] = useState(false);
  const [chatShown, setChatShown] = useState(false);
  const [playingWakeSound, setPlayingWakeSound] = useState<string | null>(null);
  const [live2dCore, setLive2dCore] = useState<Live2DCoreStatus | null>(null);
  const [live2dBusy, setLive2dBusy] = useState(false);
  const [live2dMessage, setLive2dMessage] = useState("");
  const live2dFileRef = useRef<HTMLInputElement>(null);
  const wakeSoundRef = useRef<HTMLAudioElement | null>(null);
  const wakeSoundTokenRef = useRef(0);
  // 桌宠档案：本页持有一份（展示栏 + 大卡片共用），面板保存后重读缓存刷新
  const [pets, setPets] = useState(getPetProfiles);
  const activePet = pets.find((p) => p.id === getSetting("activePetId")) ?? pets[0];

  useEffect(() => {
    void invoke<boolean>("pet_visible").then(setPetShown).catch(() => {});
    void invoke<boolean>("chat_visible").then(setChatShown).catch(() => {});
    void invoke<Live2DCoreStatus>("live2d_core_status")
      .then(setLive2dCore)
      .catch(() => setLive2dCore(null));

    return () => {
      wakeSoundTokenRef.current += 1;
      wakeSoundRef.current?.pause();
      wakeSoundRef.current = null;
    };
  }, []);

  const previewWakeSound = (sound: WakeSound) => {
    const token = ++wakeSoundTokenRef.current;
    wakeSoundRef.current?.pause();

    const audio = new Audio(sound.src);
    audio.preload = "auto";
    audio.volume = Math.max(0, Math.min(1, getSetting("volume")));
    wakeSoundRef.current = audio;
    setPlayingWakeSound(sound.key);

    const finish = () => {
      if (wakeSoundTokenRef.current !== token) return;
      wakeSoundRef.current = null;
      setPlayingWakeSound(null);
    };
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    void audio.play().catch((err) => {
      finish();
      console.warn("wake sound preview failed:", err);
    });
  };

  const togglePet = async () => {
    try {
      const shown = await invoke<boolean>("pet_toggle");
      setPetShown(shown);
      // 召唤上桌：从底边探头张望再蹦出来，接落地挥手（收起时不发）
      if (shown) void emitTo("pet", "pet:play", { state: "entering" });
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

  const importLive2dCore = async (file: File | undefined) => {
    if (!file) return;
    if (file.name.toLowerCase() !== "live2dcubismcore.min.js") {
      setLive2dMessage("请选择官方 SDK 中的 live2dcubismcore.min.js");
      if (live2dFileRef.current) live2dFileRef.current.value = "";
      return;
    }
    setLive2dBusy(true);
    setLive2dMessage("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const status = await invoke<Live2DCoreStatus>(
        "live2d_core_install",
        bytes,
      );
      setLive2dCore(status);
      setLive2dMessage("外部 Cubism Core 已安装，将覆盖软件内置版本。");
      await emitTo("pet", "pet:live2d-runtime-changed");
    } catch (error) {
      setLive2dMessage(`导入失败：${String(error)}`);
    } finally {
      setLive2dBusy(false);
      if (live2dFileRef.current) live2dFileRef.current.value = "";
    }
  };

  const restoreBundledLive2dCore = async () => {
    setLive2dBusy(true);
    setLive2dMessage("");
    try {
      const status = await invoke<Live2DCoreStatus>("live2d_core_remove");
      setLive2dCore(status);
      setLive2dMessage("已恢复软件内置 Cubism Core。");
      await emitTo("pet", "pet:live2d-runtime-changed");
    } catch (error) {
      setLive2dMessage(`移除失败：${String(error)}`);
    } finally {
      setLive2dBusy(false);
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
              <AvatarSprite
                src={activePet?.sprite ?? "/pet/xuebao.png"}
                alt=""
                draggable={false}
                data-pixel={
                  activePet?.appearanceType === "sprite-sheet" || undefined
                }
              />
            </AvatarInner>
          </Avatar>

          <Meta>
            <PetName>{activePet?.name ?? "Deskling"}</PetName>
            <PetSpecies>
              {activePet?.appearanceType === "live2d-cubism"
                ? "Live2D AI 桌宠"
                : activePet?.appearanceType === "inochi2d"
                  ? "Inochi2D AI 桌宠"
                  : "像素 AI 桌宠"}
            </PetSpecies>
            <PetBio>{activePet?.description || "一个住在桌面上的 AI 伙伴。"}</PetBio>
          </Meta>
        </Profile>

        <Actions>
          <PixelButton onClick={() => void togglePet()}>
            {petShown ? "从桌面收起" : "召唤到桌面"}
          </PixelButton>
          <PixelButton variant="primary" onClick={() => void toggleChat()}>
            {chatShown ? "关闭对话" : "打开对话"}
          </PixelButton>
        </Actions>
      </PixelSection>

      <PixelSection
        title="Live2D 运行时"
        trailing={
          <Tag>
            {live2dCore?.source === "override"
              ? "外部 Core"
              : live2dCore?.installed
                ? "内置 Core"
                : "Core 异常"}
          </Tag>
        }
      >
        <Live2DRow>
          <PixelButton
            variant="normal"
            disabled={live2dBusy}
            onClick={() => live2dFileRef.current?.click()}
          >
            {live2dBusy
              ? "处理中…"
              : live2dCore?.overrideInstalled
                ? "替换外部 Core"
                : "使用外部 Core"}
          </PixelButton>
          {live2dCore?.overrideInstalled && (
            <PixelButton
              variant="low"
              disabled={live2dBusy}
              onClick={() => void restoreBundledLive2dCore()}
            >
              恢复内置
            </PixelButton>
          )}
          <RuntimeMeta>
            已识别 {pets.filter((pet) => pet.appearanceType === "live2d-cubism").length}{" "}
            个 Live2D 桌宠包
            {live2dCore?.sizeBytes
              ? ` · ${(live2dCore.sizeBytes / 1024).toFixed(0)}KB`
              : ""}
          </RuntimeMeta>
          <HiddenFileInput
            ref={live2dFileRef}
            type="file"
            accept=".js,application/javascript,text/javascript"
            aria-label="选择 live2dcubismcore.min.js"
            onChange={(event) =>
              void importLive2dCore(event.currentTarget.files?.[0])
            }
          />
        </Live2DRow>
        <TestHint>
          Cubism Core 已随 Deskling 安装，正式版本可直接运行 Live2D 桌宠。需要测试
          新版 SDK 时，可选择官方 Core 目录中的 live2dcubismcore.min.js
          覆盖内置版本；创意工坊模型包仍不允许自行捆绑 Core。
        </TestHint>
        {(live2dMessage || live2dCore?.error) && (
          <RuntimeMessage data-error={live2dCore?.error ? true : undefined}>
            {live2dMessage || live2dCore?.error}
          </RuntimeMessage>
        )}
      </PixelSection>

      <PixelSection
        title="唤醒提示音"
        trailing={<Tag>{playingWakeSound ? "试听中" : "软木确认"}</Tag>}
      >
        <TestRow>
          {WAKE_SOUNDS.map((sound) => {
            const playing = playingWakeSound === sound.key;
            return (
              <PixelButton
                key={sound.key}
                small
                pixel={3}
                variant={playing ? "primary" : "normal"}
                aria-pressed={playing}
                onClick={() => previewWakeSound(sound)}
              >
                {playing ? "♪" : "▶"} {sound.label}
              </PixelButton>
            );
          })}
        </TestRow>
        <TestHint>
          喊出唤醒词时响「在听」，一句话说完响「收到」；默认不响，去设置页
          「语音唤醒 · 唤醒提示音」打开；音量跟随软件音量设置。
        </TestHint>
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
          <PixelButton
            small
            pixel={3}
            onClick={() => void emitTo("pet", "pet:wander")}
          >
            自主散步
          </PixelButton>
        </TestRow>
        <TestHint>
          桌宠在桌面上时点按切换动画；摸头/伸懒腰/打招呼播完自动回待机，
          打哈欠播完顺势入睡，躲←/躲→播完只剩尾巴近乎静止、随机 1-3 分钟
          自己探头一次（探头按钮可直接看）；点「自主散步」前先切到待机，循环类
          动画点「待机」收场
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
  image-rendering: auto;
  -webkit-user-drag: none;

  &[data-pixel] {
    image-rendering: pixelated;
  }
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

const Live2DRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: calc(${t.unit} * 2);
`;

const RuntimeMeta = styled.span`
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;

const RuntimeMessage = styled.p`
  margin: 0;
  font: ${t.textSm};
  color: ${t.colorAccent};

  &[data-error] {
    color: ${t.colorText};
  }
`;

const HiddenFileInput = styled.input`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
`;
