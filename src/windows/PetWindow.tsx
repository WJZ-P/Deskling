import { useEffect, useRef, useState, type PointerEvent } from "react";
import { styled } from "@linaria/react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 桌宠窗口（label="pet"）：透明 / 无边框 / 置顶 / 不上任务栏，按住可拖动。
 *
 * 舞台上站的是真正的雪豹：32×32 像素源图整数倍放大（image-rendering:
 * pixelated 保持硬边像素），帧动画（横向帧带 + 播放序列）驱动本体，
 * 配待机浮动 + 落地软影，透明底直接融进桌面。
 * 帧带由 scripts/gen-pet-frames.ps1 从底图生成；新增状态动画在 ANIMS 登记。
 *
 * 状态机：idle（待机眨眼）⇄ petted（点击摸头，播完自回）⇄ sleeping（久置入睡，
 * 指针按下摸醒）；talking（说话嘴部开合）已备好帧带，等对话窗事件桥接入触发。
 * 交互：按下后原地松手 = 摸摸；移动超过阈值 = 移交系统拖窗。
 * 由 Pet 页「召唤到桌面」按钮（pet_toggle 命令，再点即收起）唤出；点 X 的
 * 全局拦截同样适用于本窗口（关闭 = 隐藏）。
 */

// ---- 顶层可调常量 ----
/** 桌宠整体透明度 0~1：作用于整个舞台，调小就是「半透明幽灵猫」喵～ */
const PET_OPACITY = 1;
/** 源图边长 px（帧带每帧 32×32） */
const SPRITE_SIZE = 32;
/** 整数放大倍数：32×6=192，在 240 窗口里给浮动留出余量 */
const SPRITE_SCALE = 6;
/** 放大后的帧边长 px（背景尺寸/步进都用它） */
const FRAME_PX = SPRITE_SIZE * SPRITE_SCALE;
/** 待机浮动动画：幅度 px / 周期 s（0 幅度 = 关闭浮动） */
const PET_FLOAT_AMP = 5;
const PET_FLOAT_DUR = 3.2;
/** 按下后移动超过这个曼哈顿距离（px）判定为拖窗，原地松手判定为摸摸 */
const DRAG_THRESHOLD_PX = 4;
/** idle 持续无交互这么久后入睡（ms） */
const SLEEP_AFTER_MS = 20_000;
/** 窗口停止移动这么久后走路收步回待机（ms） */
const WALK_STOP_MS = 300;

/** 一段帧动画：横向帧带 + 播放序列（序列项 = 帧带里的帧号，重复项用来撑节奏） */
interface AnimDef {
  /** 帧带路径（public 下） */
  src: string;
  /** 帧带里的帧数（算 background-size 用） */
  frames: number;
  /** 播放序列：每 tick 前进一项 */
  sequence: number[];
  /** 播放速率（序列项/秒） */
  fps: number;
  /** false = 播到序列末尾停住（一次性动作，如摸头反应） */
  loop: boolean;
}

/** 动画清单：状态 → 帧带。新增状态在这里登记即可 */
const ANIMS = {
  // 4s 一循环：长驻 1.5s → 尾巴内摆 ~0.4s → 停 1s → 眨眼 ~0.5s → 停 0.6s
  // （帧 0 睁眼 / 1 半闭 / 2 合眼 / 3 甩尾）
  idle: {
    src: "/pet/anim/idle.png",
    frames: 4,
    sequence: [
      ...Array<number>(12).fill(0), 3, 3, 3,
      ...Array<number>(8).fill(0), 1, 2, 2, 1,
      ...Array<number>(5).fill(0),
    ],
    fps: 8,
    loop: true,
  },
  // 说话：嘴部开合打拍子，后半程尾巴跟着不安分
  // （帧 0 闭嘴 / 1 张嘴 / 2 闭嘴甩尾 / 3 张嘴甩尾；触发源 = 对话窗事件桥，待接入）
  talking: {
    src: "/pet/anim/talk.png",
    frames: 4,
    sequence: [0, 1, 0, 1, 2, 3, 2, 3],
    fps: 5,
    loop: true,
  },
  // 走路：对角碎步（0 着地 / 1 抬腿A+甩尾 / 2 抬腿B），步点带头顶起伏
  // 触发源 = 窗口移动事件（被拖着走 / 将来自主散步同一条通路）
  walking: {
    src: "/pet/anim/walk.png",
    frames: 3,
    sequence: [0, 1, 0, 2],
    fps: 8,
    loop: true,
  },
  // 摸头：眯眼腮红 ⇄ 张嘴 + 全身上跳 1px（开心蹦跶），播完自回 idle
  petted: {
    src: "/pet/anim/petted.png",
    frames: 2,
    sequence: [0, 1, 0, 1, 0],
    fps: 6,
    loop: false,
  },
  // 睡觉：合眼，头顶 1px 呼吸下压 + Zzz 缓慢起伏（2s 一次呼吸）
  sleeping: {
    src: "/pet/anim/sleep.png",
    frames: 2,
    sequence: [0, 1],
    fps: 1,
    loop: true,
  },
} satisfies Record<string, AnimDef>;

/** 桌宠状态：键即 ANIMS 的键（状态 ⇄ 动画一一对应） */
type PetState = keyof typeof ANIMS;

/**
 * 按清单播放一段帧动画，返回当前该显示的帧号（帧号不变时不触发重渲）。
 * 非循环动画播到序列末尾停住并回调 onEnd（状态机用它切回 idle）。
 */
function useSpriteAnim(def: AnimDef, onEnd?: () => void): number {
  const [frame, setFrame] = useState(def.sequence[0] ?? 0);
  // onEnd 走 ref：回调身份变化不重启动画
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  useEffect(() => {
    let i = 0;
    setFrame(def.sequence[0] ?? 0);
    const timer = window.setInterval(() => {
      i += 1;
      if (i >= def.sequence.length) {
        if (!def.loop) {
          window.clearInterval(timer);
          onEndRef.current?.();
          return;
        }
        i = 0;
      }
      setFrame(def.sequence[i]);
    }, 1000 / def.fps);
    return () => window.clearInterval(timer);
  }, [def]);
  return frame;
}

export function PetWindow() {
  const [state, setState] = useState<PetState>("idle");
  // 交互脉冲：每次指针按下 +1，重置入睡倒计时（拖窗不改 state，靠它兜底）
  const [activity, setActivity] = useState(0);
  const anim = ANIMS[state];
  // 一次性动作（摸头）播完自动回待机
  const frame = useSpriteAnim(anim, () => setState("idle"));

  // 按下起点：null = 本次按下已移交拖窗或已结束
  const downRef = useRef<{ x: number; y: number } | null>(null);

  // 久置入睡：idle 持续 SLEEP_AFTER_MS 无交互 → sleeping
  useEffect(() => {
    if (state !== "idle") return;
    const t = window.setTimeout(() => setState("sleeping"), SLEEP_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [state, activity]);

  // 窗口在移动（被拖着走 / 将来自主散步）→ 走路；停稳 WALK_STOP_MS 后收步回待机
  useEffect(() => {
    let stopTimer = 0;
    const unlisten = getCurrentWindow().onMoved(() => {
      setState("walking");
      window.clearTimeout(stopTimer);
      stopTimer = window.setTimeout(() => setState("idle"), WALK_STOP_MS);
    });
    return () => {
      window.clearTimeout(stopTimer);
      void unlisten.then((f) => f());
    };
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setActivity((n) => n + 1);
    downRef.current = { x: e.screenX, y: e.screenY };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = downRef.current;
    if (!d) return;
    // 超阈值：判定为拖拽，移交系统拖窗（之后指针事件归 OS，松手不算摸摸）
    if (Math.abs(e.screenX - d.x) + Math.abs(e.screenY - d.y) > DRAG_THRESHOLD_PX) {
      downRef.current = null;
      void getCurrentWindow().startDragging();
    }
  };

  const onPointerUp = () => {
    // 原地松手 = 摸摸：睡着时摸也直接摸醒进开心（petted 播完自回 idle）
    if (downRef.current) setState("petted");
    downRef.current = null;
  };

  return (
    <Stage
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <Float>
        <SpriteView
          role="img"
          aria-label="雪豹"
          style={{
            backgroundImage: `url(${anim.src})`,
            backgroundSize: `${anim.frames * FRAME_PX}px ${FRAME_PX}px`,
            backgroundPosition: `${-frame * FRAME_PX}px 0`,
          }}
        />
      </Float>
      <Shadow aria-hidden />
    </Stage>
  );
}

/* 舞台：铺满透明窗口，整体透明度在这里统一控制 */
const Stage = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  opacity: ${PET_OPACITY};
  cursor: grab;
  user-select: none;

  &:active {
    cursor: grabbing;
  }
`;

/* 浮动层：克制的上下浮动，让小家伙看起来是活的喵 */
const Float = styled.div`
  position: relative;
  z-index: 1;
  animation: pet-float ${PET_FLOAT_DUR}s ease-in-out infinite;

  @keyframes pet-float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-${PET_FLOAT_AMP}px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

/* 雪豹本体：帧带做背景图，按帧号步进 background-position 切帧；
   pixelated 保住整数倍放大的方块硬边不糊 */
const SpriteView = styled.div`
  width: ${SPRITE_SIZE * SPRITE_SCALE}px;
  height: ${SPRITE_SIZE * SPRITE_SCALE}px;
  image-rendering: pixelated;
`;

/* 落地软影：椭圆暗斑随浮动反相缩放（宠物升到最高时影子最小最淡） */
const Shadow = styled.div`
  position: absolute;
  bottom: 14px;
  left: 50%;
  width: ${SPRITE_SIZE * SPRITE_SCALE * 0.52}px;
  height: 12px;
  margin-left: ${-SPRITE_SIZE * SPRITE_SCALE * 0.26}px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse at center,
    rgba(30, 34, 40, 0.32),
    rgba(30, 34, 40, 0) 70%
  );
  animation: pet-shadow ${PET_FLOAT_DUR}s ease-in-out infinite;

  @keyframes pet-shadow {
    0%,
    100% {
      transform: scaleX(1);
      opacity: 1;
    }
    50% {
      transform: scaleX(0.86);
      opacity: 0.7;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
