import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { styled } from "@linaria/react";
import { invoke } from "@tauri-apps/api/core";
import {
  currentMonitor,
  cursorPosition,
  getCurrentWindow,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { t } from "../styles/theme";
import { PixelSurface } from "../components/pixel/PixelSurface";
import { PX } from "../components/pixel/palettes";
import { StreamingText } from "../chat/components/StreamingText";
import { getSetting } from "../settings";
import { PetAnimManager, type AnimDef, type PetState } from "../pet/animations";

/**
 * 桌宠窗口（label="pet"）：透明 / 无边框 / 置顶 / 不上任务栏，按住可拖动。
 *
 * 舞台上站的是真正的雪豹：32×32 像素源图整数倍放大（image-rendering:
 * pixelated 保持硬边像素），帧动画（横向帧带 + 播放序列）驱动本体，
 * 透明底直接融进桌面（生命感全由帧带内的微动作提供，不做 CSS 整体
 * 浮动/阴影这类窗口级装饰——免得和帧内动作叠加出碎动感）。
 * 帧带由 scripts/gen-pet-frames.ps1 生成；动画登记表 + 变体抽取在
 * src/pet/animations.ts（PetAnimManager），本窗口只管按抽到的帧带顺播。
 *
 * 状态机：idle（待机眨眼）⇄ petted（点击摸头，播完自回）；久置经 yawning
 * （打哈欠趴下）入 sleeping，睡着被摸经 stretching（伸懒腰）醒回 idle；
 * 拖窗 = 按拖动方向跟手小跑（walkingLeft/Right/Up/Down），停稳回 idle；召唤上桌播一次 entering
 * （底边探头张望再蹦出）接 greeting（落地挥手）；thinking/typing/talking
 * /searching 由对话窗事件桥驱动（等首包托腮 → 执行工具敲电脑 / web 搜索举放大镜
 * → 正文输出说话，收工回 idle）。
 * 交互：命中区收紧到本体最小矩形（帧带非透明像素并集包围盒，运行时扫描，
 * 工坊任意精灵图通用）；按下后原地松手 = 摸摸；移动超过阈值 = 移交系统拖窗。
 * 命中区外的一切空白（含精灵框透明边角）经光标巡逻 setIgnoreCursorEvents
 * 整窗穿透，点击直达桌面。拖拽松手后做落位：明显拖出任一屏缘 = 贴边播
 * 躲边动画（左右留尾巴、上下留双耳，可点击/拖动召回）；其余越界吸回工作区。
 * 小幅盖住任务栏时会自己走回安全位置（以本体矩形为准，气泡位不受限）。
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
/** 按下后移动超过这个曼哈顿距离（px）判定为拖窗，原地松手判定为摸摸 */
const DRAG_THRESHOLD_PX = 4;
/** idle 持续无交互这么久后入睡（ms） */
const SLEEP_AFTER_MS = 20_000;
/** idle 站稳后，第一次考虑自主小动作的等待区间（基础 + 随机幅度）。 */
const IDLE_ACTION_MIN_MS = 6_000;
const IDLE_ACTION_RAND_MS = 6_000;
/** 到达抽选时刻后真正表演的概率；落空则继续普通呼吸，随后按原逻辑入睡。 */
const IDLE_ACTION_CHANCE = 0.62;
interface IdleActionConfig {
  state: PetState;
  weight: number;
  cooldownMs: number;
}
/** 五种自主动作的相对权重与独立冷却；喷嚏最稀有，张望最常见。 */
const IDLE_ACTIONS: readonly IdleActionConfig[] = [
  { state: "idleLook", weight: 34, cooldownMs: 25_000 },
  { state: "idleGroom", weight: 24, cooldownMs: 45_000 },
  { state: "idleScratch", weight: 18, cooldownMs: 45_000 },
  { state: "idleAlert", weight: 16, cooldownMs: 35_000 },
  { state: "idleSneeze", weight: 8, cooldownMs: 90_000 },
];
/** 说话气泡兜底自消：这么久没收到新文本也没收尾（如中途暂停）就自行隐去（ms）。
    收尾（done）后的驻留时长走设置项 petBubbleSecs（设置面板可调） */
const BUBBLE_IDLE_MS = 10_000;
/** 气泡退场动画时长（ms）：下沉缩小淡出，播完才真正卸载 */
const BUBBLE_OUT_MS = 180;
/** 气泡最大宽度 px（窗口 240 宽，留出两侧余量不贴边） */
const BUBBLE_MAX_W = 210;
/** 躲好后随机再过这么久探一次头：基础 + 随机幅度（ms），合计 1-3 分钟 */
const PEEK_MIN_MS = 60_000;
const PEEK_RAND_MS = 120_000;
/** 窗口停止移动这么久后走路收步回待机（ms） */
const WALK_STOP_MS = 300;
/** 任务栏保护触发后，自动走回工作区的逻辑像素速度（会按 DPR 换算，缩放下体感一致） */
const TASKBAR_WALK_SPEED_PX_PER_SEC = 480;
/** 自动走开至少持续这么久，保证很短的校正也能看见步态（ms） */
const TASKBAR_WALK_MIN_MS = 260;
/** 自动走开的时长上限，避免异常越界时走太久（ms） */
const TASKBAR_WALK_MAX_MS = 600;
/** 光标巡逻周期 ms：读全局光标判断在不在交互区，切换整窗穿透。
    调小则光标扫上桌宠后更快恢复可点，代价是 IPC 更密 */
const CURSOR_PATROL_MS = 60;
/** 松手时本体越过任一工作区边缘超过这个比例的身位，判定为「想塞出去」→ 贴边躲藏；
    低于则吸回屏内 */
const HIDE_OVER_RATIO = 0.2;
/** Windows 原生拖窗会约束透明窗外框；其他平台保留系统拖窗作为兼容回退。 */
const USE_MANUAL_WINDOW_DRAG = navigator.userAgent.includes("Windows");

/** idle 中低概率点播的一次性自主小动作。 */
const IDLE_ACTION_STATES = IDLE_ACTIONS.map(({ state }) => state);
const isIdleActionState = (s: PetState) => IDLE_ACTION_STATES.includes(s);

/** 「移动态」集合：拖拽跟手的走路（按方向分四向）+ 悬空。onMoved 只在这些
    状态里按拖动方向切向，停表也只对这些状态收步——不打断播放中的一次性动画 */
const MOVE_STATES: PetState[] = [
  "walking",
  "walkingLeft",
  "walkingRight",
  "walkingUp",
  "walkingDown",
  "dangling",
];
const isMoveState = (s: PetState) => MOVE_STATES.includes(s);

/** 拖动结束后的四拍收步过渡；播完动态恢复最近的对话态或 idle */
const SETTLING_STATES: PetState[] = [
  "settling",
  "settlingLeft",
  "settlingRight",
  "settlingUp",
  "settlingDown",
];
const isSettlingState = (s: PetState) => SETTLING_STATES.includes(s);

/** 走路方向 → 对应收步过渡。悬空/正面步态走通用收步 */
function settlingStateFor(s: PetState): PetState {
  if (s === "walkingLeft") return "settlingLeft";
  if (s === "walkingRight") return "settlingRight";
  if (s === "walkingUp") return "settlingUp";
  if (s === "walkingDown") return "settlingDown";
  return "settling";
}

/** 窗口即将移动的方向 → 对应固定步态。 */
function walkingStateForDelta(dx: number, dy: number): PetState {
  if (dx === 0 && dy === 0) return "walking";
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "walkingLeft" : "walkingRight";
  return dy < 0 ? "walkingUp" : "walkingDown";
}

/** 程序化走位使用缓入缓出，避免从静止瞬间满速或抵达时急停。 */
function easeInOutCubic(progress: number): number {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

type SettleAfterMoveResult = "none" | "hidden" | "settled" | "cancelled";

/** 「对话活动态」集合：对话窗事件桥推来的演出（说话/思考/敲电脑/搜索 + 收工待机）。
    这些态会被记进 convStateRef：拖拽打断后据它恢复、从隐藏被叫来时据它接演 */
const CONV_STATES: PetState[] = ["talking", "thinking", "typing", "searching", "idle"];
const isConvState = (s: PetState) => CONV_STATES.includes(s);

/** 四边完全躲好后的驻留态。 */
const HIDDEN_IDLE_STATES: PetState[] = [
  "hiddenLeft",
  "hiddenRight",
  "hiddenUp",
  "hiddenDown",
];
const isHiddenIdleState = (s: PetState) => HIDDEN_IDLE_STATES.includes(s);

/** 四边偶发探头态。 */
const PEEKING_STATES: PetState[] = [
  "peekingLeft",
  "peekingRight",
  "peekingUp",
  "peekingDown",
];
const isPeekingState = (s: PetState) => PEEKING_STATES.includes(s);

/** 躲好或正在探头：被对话叫住时都要先召回。 */
const HIDDEN_STATES: PetState[] = [...HIDDEN_IDLE_STATES, ...PEEKING_STATES];
const isHiddenState = (s: PetState) => HIDDEN_STATES.includes(s);

/** 正在向四边藏入 / 从四边召回的一次性过渡。 */
const HIDING_STATES: PetState[] = ["hidingLeft", "hidingRight", "hidingUp", "hidingDown"];
const UNHIDE_STATES: PetState[] = ["unhideLeft", "unhideRight", "unhideUp", "unhideDown"];
const isHidingState = (s: PetState) => HIDING_STATES.includes(s);
const isUnhideState = (s: PetState) => UNHIDE_STATES.includes(s);

/** 当前所在边缘 → 对应的召回动画。 */
function unhideStateFor(s: PetState): PetState {
  if (s === "hiddenRight" || s === "peekingRight" || s === "hidingRight") {
    return "unhideRight";
  }
  if (s === "hiddenUp" || s === "peekingUp" || s === "hidingUp") return "unhideUp";
  if (s === "hiddenDown" || s === "peekingDown" || s === "hidingDown") {
    return "unhideDown";
  }
  return "unhideLeft";
}

/** 完全躲好态 → 同边缘的偶发探头动画。 */
function peekingStateFor(s: PetState): PetState {
  if (s === "hiddenRight") return "peekingRight";
  if (s === "hiddenUp") return "peekingUp";
  if (s === "hiddenDown") return "peekingDown";
  return "peekingLeft";
}

/**
 * 状态仲裁策略：循环态通常可随时切换；一次性反应/过渡在播放期间保护，
 * 低优先级请求排队到收尾后执行。更高优先级仍可抢占（拖动最高，用户永远
 * 可以把桌宠拎走），避免“不可打断”变成“不可交互”。
 */
interface StatePolicy {
  priority: number;
  interruptible: boolean;
}

interface StateRequestOptions {
  /** 用户直接拖动等强制交互可无视保护区抢占 */
  force?: boolean;
  /** 被保护状态拦住时是否记为“收尾后再播”（默认 true） */
  queueIfBlocked?: boolean;
}

function statePolicy(s: PetState): StatePolicy {
  if (isMoveState(s)) return { priority: 100, interruptible: true };
  if (isSettlingState(s)) return { priority: 90, interruptible: false };
  if (isHidingState(s) || isUnhideState(s)) {
    return { priority: 80, interruptible: false };
  }
  if (s === "entering" || s === "greeting") {
    return { priority: 70, interruptible: false };
  }
  if (s === "petted" || s === "stretching") {
    return { priority: 60, interruptible: false };
  }
  if (s === "yawning" || isPeekingState(s)) {
    return { priority: 50, interruptible: false };
  }
  if (isConvState(s)) return { priority: 30, interruptible: true };
  // 自主待机动作只是低优先级点缀：说话、摸头、拖动等都能即时接管。
  if (isIdleActionState(s)) return { priority: 20, interruptible: true };
  return { priority: 0, interruptible: true };
}

// 动画登记表（状态 → 帧带变体组）在 src/pet/animations.ts；管理器负责
// 状态合法性检查 + 进入状态时的变体抽取（如向左走随机抽 w 嘴版/喘气版）
const ANIM_MANAGER = new PetAnimManager();

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

/** 桌宠本体命中矩形（32×32 帧内坐标，w/h 含端点） */
interface BodyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 帧带 src → 本体矩形缓存（帧带静态不变，整个会话每条只真扫一次）
const bodyRectCache = new Map<string, Promise<BodyRect>>();

/**
 * 扫帧带全帧非透明像素的并集包围盒 = 该状态下桌宠本体的最小命中矩形。
 * 横向折回帧内坐标（x % SPRITE_SIZE）：任一帧在该位置有像素就算体——
 * 换帧时命中区不跳动。逐像素判 alpha 对创意工坊的任意精灵图都适用；
 * 矩形内部残留的透明缺口（耳朵旁的天空这类）不追求剔除，「最小矩形」
 * 即约定精度。解码失败按整帧兜底（宁可多接事件不可点不了）
 */
function stripBodyRect(src: string): Promise<BodyRect> {
  let rect = bodyRectCache.get(src);
  if (!rect) {
    rect = new Promise<BodyRect>((resolve) => {
      const full = { x: 0, y: 0, w: SPRITE_SIZE, h: SPRITE_SIZE };
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(full);
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let x0 = SPRITE_SIZE;
        let y0 = SPRITE_SIZE;
        let x1 = -1;
        let y1 = -1;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            if (data[(y * canvas.width + x) * 4 + 3] === 0) continue;
            const fx = x % SPRITE_SIZE;
            if (fx < x0) x0 = fx;
            if (fx > x1) x1 = fx;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
        resolve(x1 < 0 ? full : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
      };
      img.onerror = () => resolve(full);
      img.src = src;
    });
    bodyRectCache.set(src, rect);
  }
  return rect;
}

export function PetWindow() {
  // 初始即 entering：启动时从画面底边探头张望再蹦出来，接 greeting 落地挥手
  // 完成整套登场（隐藏启动则悄悄播完落回 idle）
  const [state, setState] = useState<PetState>("entering");
  // 同步镜像 + 状态仲裁队列：外部事件不再到处直接 setState，而是统一经过
  // requestState。一次性动画保护期间来的低优先级请求只保留最新一个。
  const stateRef = useRef<PetState>("entering");
  const queuedStateRef = useRef<PetState | null>(null);
  // 召回/收步这类“先播过渡、再接目标”的目标缓存。
  const pendingStateRef = useRef<PetState | null>(null);
  // 最近的对话活动态：摸头/拖拽等插播结束后据它恢复演出。
  const convStateRef = useRef<PetState>("idle");
  stateRef.current = state;

  const requestState = useCallback(
    (next: PetState, options: StateRequestOptions = {}): boolean => {
      const current = stateRef.current;
      if (current === next) return true;
      const currentPolicy = statePolicy(current);
      const nextPolicy = statePolicy(next);
      const blocked =
        !options.force &&
        !currentPolicy.interruptible &&
        nextPolicy.priority <= currentPolicy.priority;
      if (blocked) {
        if (options.queueIfBlocked !== false) queuedStateRef.current = next;
        return false;
      }
      stateRef.current = next;
      setState(next);
      return true;
    },
    [],
  );

  // 交互脉冲：每次指针按下 +1，重置入睡倒计时（拖窗不改 state，靠它兜底）
  const [activity, setActivity] = useState(0);
  // 进入状态时抽定帧带变体（多变体随机），状态不变则整段咬死不换
  const anim = useMemo(() => ANIM_MANAGER.pick(state), [state]);
  const frame = useSpriteAnim(
    anim,
    () => {
      const current = stateRef.current;
      const isRecall = isUnhideState(current);

      // 召回 / 收步是动态过渡：播完优先接缓存目标；目标已收工则回 idle。
      if (isRecall || isSettlingState(current)) {
        const pending = pendingStateRef.current;
        pendingStateRef.current = null;
        // 动画测试等非对话请求仍可能在保护期排队；它优先于过渡开始时缓存的
        // resume 目标，消费后清空，不能让队列悬在循环态里永远等不到下一次 onEnd。
        const queued = queuedStateRef.current;
        queuedStateRef.current = null;
        const target =
          queued && ANIM_MANAGER.has(queued)
            ? queued
            : pending && ANIM_MANAGER.has(pending)
              ? pending
              : convStateRef.current;
        requestState(target !== "idle" ? target : "idle", {
          force: true,
          queueIfBlocked: false,
        });
        return;
      }

      // 正在躲边时被对话叫住：完整播完冲出画面，再从同侧跑回来接演。
      const queued = queuedStateRef.current;
      if (isHidingState(current) && queued && isUnhideState(queued)) {
        queuedStateRef.current = null;
        requestState(queued, { force: true, queueIfBlocked: false });
        return;
      }

      // 打哈欠已经趴下时若对话在排队，先完整伸懒腰站起来，再接对话态。
      if (current === "yawning" && queued && queued !== "idle") {
        requestState("stretching", { force: true, queueIfBlocked: false });
        return;
      }

      // entering→greeting、yawning→sleeping、hiding→hidden 等声明式连续动作优先；
      // idle 只是“收工”请求，不应拆断这条自然动作链。
      const declared = anim.next;
      if (declared && ANIM_MANAGER.has(declared)) {
        if (queuedStateRef.current === "idle") queuedStateRef.current = null;
        requestState(declared, { force: true, queueIfBlocked: false });
        return;
      }

      // 无声明后继的一次性动画：消费保护期间最后一个排队请求；没有则恢复
      // 最近对话态（例如 thinking 中被摸头，开心蹦完继续托腮）。
      const next = queuedStateRef.current;
      queuedStateRef.current = null;
      const target = next && ANIM_MANAGER.has(next) ? next : convStateRef.current;
      requestState(target !== "idle" ? target : "idle", {
        force: true,
        queueIfBlocked: false,
      });
    },
  );

  // 当前帧带的本体命中矩形：换状态重取（有缓存，仅每条帧带首次真扫）。
  // 新矩形到位前沿用旧值——比瞬间跳回整帧兜底更稳；首帧未就绪按整帧
  const [bodyRect, setBodyRect] = useState<BodyRect | null>(null);
  useEffect(() => {
    let alive = true;
    void stripBodyRect(anim.src).then((r) => {
      if (alive) setBodyRect(r);
    });
    return () => {
      alive = false;
    };
  }, [anim]);

  // 头顶气泡：对话窗把回复文本经 pet:say 事件推来逐字长出。两种形态——
  // say = 正文说话（白面对话泡 + 三角尾巴）；think = 思考中（浅青想法泡 +
  // 三个小圆圈从头顶升上去，漫画式心理活动）。收尾（done）后按设置的驻留
  // 时长消失；中途没了下文（暂停）由兜底计时器自隐
  const [bubble, setBubble] = useState<{
    text: string;
    kind: "say" | "think";
    live: boolean;
  } | null>(null);
  // 退场两拍：closing 置真先播退场动画（下沉缩小淡出），播完才真正卸载
  const [closing, setClosing] = useState(false);
  const bubbleTimerRef = useRef(0);
  const closeTimerRef = useRef(0);
  const bubbleBodyRef = useRef<HTMLDivElement>(null);
  const closeBubble = useCallback(() => {
    window.clearTimeout(closeTimerRef.current);
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setBubble(null);
      setClosing(false);
    }, BUBBLE_OUT_MS);
  }, []);
  useEffect(() => {
    const unlisten = getCurrentWindow().listen<{
      text?: string;
      kind?: string;
      done?: boolean;
    }>("pet:say", (e) => {
      const text = e.payload?.text ?? "";
      window.clearTimeout(bubbleTimerRef.current);
      if (!text) {
        closeBubble(); // 新一轮开场清残留：同样体面退场，不瞬间消失
        return;
      }
      // 新内容到达：撤销进行中的退场（复活），刷新内容
      window.clearTimeout(closeTimerRef.current);
      setClosing(false);
      const done = !!e.payload?.done;
      // live 驱动逐字蹦入（StreamingText）：流入中弹簧入场，收尾塌成纯文本
      setBubble({ text, kind: e.payload?.kind === "think" ? "think" : "say", live: !done });
      // done = 本轮说完：按设置驻留让人读完；否则兜底自隐（防暂停后气泡卡住）
      bubbleTimerRef.current = window.setTimeout(
        closeBubble,
        done ? getSetting("petBubbleSecs") * 1000 : BUBBLE_IDLE_MS,
      );
    });
    return () => {
      window.clearTimeout(bubbleTimerRef.current);
      window.clearTimeout(closeTimerRef.current);
      void unlisten.then((f) => f());
    };
  }, [closeBubble]);
  // 文本增长时滚到底：长内容气泡像字幕一样只露最新几行
  useEffect(() => {
    const el = bubbleBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubble]);

  // 点气泡拉起 AI 对话窗（设置开关，默认开；关掉后气泡不收指针事件）
  const bubbleClickable = getSetting("petBubbleClick");
  const openChatFromBubble = () => {
    void invoke("chat_show").catch(() => {});
  };

  // 按下起点：null = 本次按下已移交拖窗或已结束
  const downRef = useRef<{ x: number; y: number } | null>(null);
  // 本体命中区 / 气泡的 DOM 引用（光标巡逻逐 tick 量矩形用）；
  // 精灵帧引用（松手落位躲边时量帧矩形做贴边基准）
  const hitRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLDivElement>(null);
  // 窗口位置缓存（物理 px）：挂载时查一次，之后靠 onMoved 增量维护，
  // 巡逻 tick 就只剩 cursorPosition 一次 IPC
  const winPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastXRef = useRef<number | null>(null);
  const lastYRef = useRef<number | null>(null);
  // 真 = 下一次 onMoved 来自落点校正的 setPosition：只记位置，不进走路状态
  const clampMoveRef = useRef(false);
  // 任务栏保护的程序化走位期间，onMoved 只同步坐标；run id 让用户按下时可立即取消。
  const autoMoveRef = useRef(false);
  const autoMoveRunRef = useRef(0);
  // 原生 startDragging 会按整个 240×380 透明窗做屏幕边界保护：顶部为气泡
  // 预留的空气先撞到屏幕顶，猫本体便永远塞不出去。桌宠改用全局鼠标坐标
  // 自行跟手移动；run id 同时负责 PointerUp 与系统键位兜底之间的去重取消。
  const manualDragRef = useRef(false);
  const manualDragRunRef = useRef(0);

  /**
   * 把整个透明窗口逐帧移动到目标物理坐标。每次 setPosition 完成后才排下一帧，
   * 避免 IPC 堆积；返回 false 表示途中被用户按下取消。
   */
  const animateWindowTo = async (
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs: number,
  ): Promise<boolean> => {
    const run = ++autoMoveRunRef.current;
    autoMoveRef.current = true;
    const win = getCurrentWindow();
    const startedAt = performance.now();

    try {
      while (true) {
        const now = await new Promise<number>((resolve) =>
          window.requestAnimationFrame(resolve),
        );
        if (autoMoveRunRef.current !== run) return false;

        const progress = Math.min(1, (now - startedAt) / Math.max(1, durationMs));
        const eased = easeInOutCubic(progress);
        const x = Math.round(from.x + (to.x - from.x) * eased);
        const y = Math.round(from.y + (to.y - from.y) * eased);
        await win.setPosition(new PhysicalPosition(x, y));
        winPosRef.current = { x, y };
        lastXRef.current = x;
        lastYRef.current = y;

        if (progress >= 1) return true;
      }
    } finally {
      if (autoMoveRunRef.current === run) autoMoveRef.current = false;
    }
  };

  // 松手落位：按本体命中矩形（非整窗，头顶气泡展示位可以越出屏顶）四选一——
  //  · 本体拖出任一屏缘超过 HIDE_OVER_RATIO 个身位 = 想把它塞出去：窗口
  //    贴到对应边缘，播躲边动画；左右只留尾巴、上下只留双耳，随后探头计时器接管；
  //  · 侵入任务栏占用的工作区边缘：切对应步态，缓入缓出走回安全位置，再收步；
  //  · 其余越界：保持原来的瞬时吸边，顶部兜住防拖丢；
  //  · 没越界：不动。
  // OS 拖窗的模态循环里抢 setPosition 会打架，所以只挂在移动停表上，且
  // 停表靠系统键位查询保证真松手了才落位
  // 返回处理结果：任务栏走位会在函数内接好收步；普通校正仍由 bumpMoveStop 收尾。
  const settleAfterMove = async (): Promise<SettleAfterMoveResult> => {
    const pos = winPosRef.current;
    const hit = hitRef.current;
    const sprite = spriteRef.current;
    if (!pos || !hit || !sprite) return "none";
    const monitor = await currentMonitor();
    if (!monitor) return "none";
    const dpr = window.devicePixelRatio;
    const wa = monitor.workArea;
    // 本体矩形的屏幕坐标（物理 px）
    const r = hit.getBoundingClientRect();
    const left = pos.x + r.left * dpr;
    const top = pos.y + r.top * dpr;
    const right = pos.x + r.right * dpr;
    const bottom = pos.y + r.bottom * dpr;
    const workLeft = wa.position.x;
    const workTop = wa.position.y;
    const workRight = workLeft + wa.size.width;
    const workBottom = workTop + wa.size.height;
    const overL = Math.max(0, workLeft - left);
    const overR = Math.max(0, right - workRight);
    const overT = Math.max(0, workTop - top);
    const overB = Math.max(0, bottom - workBottom);
    const bodyWidth = Math.max(1, right - left);
    const bodyHeight = Math.max(1, bottom - top);
    const fr = sprite.getBoundingClientRect(); // 精灵帧矩形（躲边的贴边基准）

    // 四边都按“越界身位比例”竞争：超过阈值才代表用户主动塞出去；角落同时
    // 越过两边时取比例更深的一边。小幅越界仍只是吸回/任务栏走开保护。
    const hideCandidate = [
      { state: "hidingLeft" as const, ratio: overL / bodyWidth },
      { state: "hidingRight" as const, ratio: overR / bodyWidth },
      { state: "hidingUp" as const, ratio: overT / bodyHeight },
      { state: "hidingDown" as const, ratio: overB / bodyHeight },
    ].reduce((best, candidate) => (candidate.ratio > best.ratio ? candidate : best));
    const hide: PetState | null =
      hideCandidate.ratio > HIDE_OVER_RATIO ? hideCandidate.state : null;

    let dx = 0;
    let dy = 0;
    if (hide === "hidingLeft") {
      dx = workLeft - (pos.x + fr.left * dpr);
      dy = overT > 0 ? overT : overB > 0 ? -overB : 0;
    } else if (hide === "hidingRight") {
      dx = workRight - (pos.x + fr.right * dpr);
      dy = overT > 0 ? overT : overB > 0 ? -overB : 0;
    } else if (hide === "hidingUp") {
      dy = workTop - (pos.y + fr.top * dpr);
      dx = overL > 0 ? overL : overR > 0 ? -overR : 0;
    } else if (hide === "hidingDown") {
      dy = workBottom - (pos.y + fr.bottom * dpr);
      dx = overL > 0 ? overL : overR > 0 ? -overR : 0;
    } else {
      dx = overL > 0 ? overL : overR > 0 ? -overR : 0;
      dy = overT > 0 ? overT : overB > 0 ? -overB : 0;
    }

    // workArea 相对完整显示器被压缩的那一侧才是任务栏；普通屏幕边缘越界不走动画。
    const monitorLeft = monitor.position.x;
    const monitorTop = monitor.position.y;
    const monitorRight = monitorLeft + monitor.size.width;
    const monitorBottom = monitorTop + monitor.size.height;
    const overlapsTaskbar =
      !hide &&
      ((dx > 0 && workLeft > monitorLeft && left < workLeft) ||
        (dx < 0 && workRight < monitorRight && right > workRight) ||
        (dy > 0 && workTop > monitorTop && top < workTop) ||
        (dy < 0 && workBottom < monitorBottom && bottom > workBottom));

    if (dx || dy) {
      const target = {
        x: Math.round(pos.x + dx),
        y: Math.round(pos.y + dy),
      };
      if (overlapsTaskbar) {
        const interruptedState = stateRef.current;
        const previousPending = pendingStateRef.current;
        const walkState = walkingStateForDelta(dx, dy);
        requestState(walkState, { force: true, queueIfBlocked: false });

        const logicalDistance = Math.hypot(dx, dy) / Math.max(1, dpr);
        const durationMs = Math.min(
          TASKBAR_WALK_MAX_MS,
          Math.max(
            TASKBAR_WALK_MIN_MS,
            (logicalDistance * 1000) / TASKBAR_WALK_SPEED_PX_PER_SEC,
          ),
        );
        const completed = await animateWindowTo(pos, target, durationMs);
        if (!completed) return "cancelled";

        // 拖拽后恢复最近对话态；启动/其他场景触发保护时恢复被插播的原状态。
        const resumeState =
          previousPending ??
          (isMoveState(interruptedState)
            ? convStateRef.current
            : convStateRef.current !== "idle"
              ? convStateRef.current
              : interruptedState);
        pendingStateRef.current = ANIM_MANAGER.has(resumeState) ? resumeState : "idle";
        requestState(settlingStateFor(walkState), {
          force: true,
          queueIfBlocked: false,
        });
        return "settled";
      }

      clampMoveRef.current = true;
      await getCurrentWindow().setPosition(new PhysicalPosition(target.x, target.y));
    }
    // 贴好边再开演：左右最终只剩尾巴，上下最终只剩双耳（播完自动接 hidden）。
    if (hide) {
      requestState(hide, { force: true, queueIfBlocked: false });
      return "hidden";
    }
    return "none";
  };

  // 久置入睡：idle 持续 SLEEP_AFTER_MS 无交互 → 打个哈欠趴下（播完接 sleeping）
  useEffect(() => {
    if (state !== "idle") return;
    const t = window.setTimeout(() => requestState("yawning"), SLEEP_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [state, activity, requestState]);

  // 自主待机行为：idle 站稳 6-12 秒后进行一次概率抽选。每种动作有独立冷却，
  // 候选内按权重抽取；概率落空后本轮不再重掷，让普通呼吸和原有入睡仍占主导。
  // 动作播完走通用 onEnd 回 idle；任何 AI 活动态或用户交互都可直接打断。
  const idleActionCooldownRef = useRef(new Map<PetState, number>());
  useEffect(() => {
    if (state !== "idle") return;
    const timer = window.setTimeout(
      () => {
        if (stateRef.current !== "idle" || Math.random() > IDLE_ACTION_CHANCE) return;

        const now = performance.now();
        const candidates = IDLE_ACTIONS.filter(
          ({ state: action }) => (idleActionCooldownRef.current.get(action) ?? 0) <= now,
        );
        if (candidates.length === 0) return;

        const totalWeight = candidates.reduce((sum, action) => sum + action.weight, 0);
        let roll = Math.random() * totalWeight;
        let selected = candidates[candidates.length - 1];
        for (const candidate of candidates) {
          roll -= candidate.weight;
          if (roll <= 0) {
            selected = candidate;
            break;
          }
        }

        if (requestState(selected.state)) {
          idleActionCooldownRef.current.set(selected.state, now + selected.cooldownMs);
        }
      },
      IDLE_ACTION_MIN_MS + Math.random() * IDLE_ACTION_RAND_MS,
    );
    return () => window.clearTimeout(timer);
  }, [state, activity, requestState]);

  // 躲好后偶尔探头：hidden 驻留随机 1-3 分钟点播一次 peeking，播完自动
  // 缩回 hidden → 本效应重挂、重新掷下一次的间隔
  useEffect(() => {
    if (!isHiddenIdleState(state)) return;
    const t = window.setTimeout(
      () => requestState(peekingStateFor(state)),
      PEEK_MIN_MS + Math.random() * PEEK_RAND_MS,
    );
    return () => window.clearTimeout(t);
  }, [state, requestState]);

  // 移动停表：拖拽走路等移动态在窗口停稳 WALK_STOP_MS 后回待机。
  // onMoved 每次移动都续命，拖拽分支起手武装。
  // 坑：拖到屏幕边缘顶住时光标被物理边界挡停，窗口不再位移、onMoved 断流，
  // 但手还没松——OS 拖窗期间网页收不到指针事件，只能拿系统级键位查询兜底：
  // 仍按着就续命保持走路，真松手了才收步 + 落点校正（校正也因此严格发生在
  // 松手后，不会中途跟 OS 拖窗抢窗口）
  const stopTimerRef = useRef(0);
  const bumpMoveStop = () => {
    window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = window.setTimeout(() => {
      void (async () => {
        if (isMoveState(stateRef.current)) {
          const held = await invoke<boolean>("mouse_pressed").catch(() => false);
          if (held) {
            bumpMoveStop();
            return;
          }
        }
        // 先落位（明显越过任一边就藏起来，其余越界吸回工作区）——先做它才能知道要不要躲，
        // 避免「先闪一下恢复的对话动画再躲」的跳帧。
        const result = await settleAfterMove();
        // 普通吸边/未越界由这里收步；任务栏走位已在 settleAfterMove 内接好收步，
        // 躲藏或被用户取消也不能再覆盖当前状态。
        if (result === "none") {
          const current = stateRef.current;
          if (isMoveState(current)) {
            pendingStateRef.current = convStateRef.current;
            requestState(settlingStateFor(current), {
              force: true,
              queueIfBlocked: false,
            });
          }
        }
      })();
    }, WALK_STOP_MS);
  };

  // 窗口在移动 = 正被拖着走：按拖动的主导轴选朝向让它跟手小跑——横向占优
  // （含平手）用侧脸帧带（往左跑 / 往右跑），纵向占优分上下（向下 = 低头看
  // 脚下，向上 = 仰头走，五官压向行进方向）；零位移兜底正面步态。
  // 只在「移动态」里按方向切（拖拽起手由 onPointerMove 置入），不打断播放中
  // 的一次性动画（召回/摸头等窗口不动，本就不会走到这）
  useEffect(() => {
    const unlisten = getCurrentWindow().onMoved(({ payload }) => {
      winPosRef.current = { x: payload.x, y: payload.y };
      // 任务栏保护正在逐帧走位：动画已经主动选择步态，只同步坐标，避免停表干扰。
      if (autoMoveRef.current) {
        lastXRef.current = payload.x;
        lastYRef.current = payload.y;
        return;
      }
      // 落点校正引发的贴靠移动：只记位置，不进走路状态也不再武装停表
      // （吸附完还播一段走路会很怪，且停表重触发会造成校正循环）
      if (clampMoveRef.current) {
        clampMoveRef.current = false;
        lastXRef.current = payload.x;
        lastYRef.current = payload.y;
        return;
      }
      const dx = lastXRef.current === null ? 0 : payload.x - lastXRef.current;
      const dy = lastYRef.current === null ? 0 : payload.y - lastYRef.current;
      lastXRef.current = payload.x;
      lastYRef.current = payload.y;
      const current = stateRef.current;
      if (isMoveState(current) && (dx !== 0 || dy !== 0)) {
        const direction = walkingStateForDelta(dx, dy);
        requestState(direction, { force: true, queueIfBlocked: false });
      }
      bumpMoveStop();
    });
    return () => {
      manualDragRunRef.current += 1;
      manualDragRef.current = false;
      window.clearTimeout(stopTimerRef.current);
      void unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestState]);

  /**
   * 透明桌宠窗的自定义拖动：以按住时鼠标在窗口内的物理偏移为锚点，随后逐帧
   * 读取全局鼠标并 setPosition。它不受原生标题栏的整窗可见性限制，因此顶部
   * 气泡留白可以离开屏幕，真正决定吸回/躲藏的仍是 settleAfterMove 的本体矩形。
   */
  const startManualDragging = async () => {
    const run = ++manualDragRunRef.current;
    manualDragRef.current = true;
    const win = getCurrentWindow();

    try {
      const [startPos, startCursor] = await Promise.all([
        win.outerPosition(),
        cursorPosition(),
      ]);
      if (manualDragRunRef.current !== run) return;

      const grabOffset = {
        x: startCursor.x - startPos.x,
        y: startCursor.y - startPos.y,
      };

      while (manualDragRunRef.current === run) {
        await new Promise<number>((resolve) => window.requestAnimationFrame(resolve));
        const [cursor, held] = await Promise.all([
          cursorPosition(),
          invoke<boolean>("mouse_pressed").catch(() => false),
        ]);
        if (manualDragRunRef.current !== run || !held) break;

        const x = Math.round(cursor.x - grabOffset.x);
        const y = Math.round(cursor.y - grabOffset.y);
        const current = winPosRef.current;
        if (current?.x === x && current.y === y) continue;

        await win.setPosition(new PhysicalPosition(x, y));
        winPosRef.current = { x, y };
      }
    } finally {
      // PointerUp 若先收到会递增 run 并自行武装停表；否则由系统键位查询在这里
      // 识别松手。两条路径只允许当前 run 收尾一次。
      if (manualDragRunRef.current === run) {
        manualDragRef.current = false;
        bumpMoveStop();
      }
    }
  };

  // 状态点播通道：其他窗口 emitTo("pet", "pet:play", { state }) 直接切状态。
  // 桌宠页的动画测试按钮走这里；将来对话窗事件桥（talking/typing）也走这条
  useEffect(() => {
    const unlisten = getCurrentWindow().listen<{ state?: string }>("pet:play", (e) => {
      const s = e.payload?.state;
      if (!s || !ANIM_MANAGER.has(s)) return;
      const cur = stateRef.current;
      // 对话活动态特殊处理：记住它（供拖拽/召回后恢复），并按当前处境决定接法
      if (isConvState(s)) {
        convStateRef.current = s;
        // 躲在屏幕边缘时被叫来说话：先召回冒出来再接演（idle=收工不打扰，继续躲着）
        if (isHiddenState(cur)) {
          if (s !== "idle") {
            pendingStateRef.current = s;
            requestState(unhideStateFor(cur));
          }
          return;
        }
        // 正在冲出屏幕时不半路瞬移回来：让 hiding 完整播完，再从同侧召回。
        if (isHidingState(cur)) {
          if (s !== "idle") {
            pendingStateRef.current = s;
            queuedStateRef.current = unhideStateFor(cur);
          }
          return;
        }
        // 召回还在播：只更新待接演目标，别打断召回动画（播完由 onEnd 接演）
        if (isUnhideState(cur) || isSettlingState(cur)) {
          pendingStateRef.current = s;
          return;
        }
        // 拖拽/走路中：缓存对话态但不打断拖拽，拖完由移动停表据 convStateRef 恢复
        if (isMoveState(cur)) return;
      }
      requestState(s);
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [requestState]);

  // 光标巡逻：把「空白穿透」做成真的——网页里的 pointer-events 只管页内命中，
  // 窗口本身仍会吃掉整个矩形的鼠标事件（透明处点击也到不了桌面）。每 tick 读
  // 全局光标换算窗内坐标，落在交互区（本体命中矩形 + 可点气泡）外就
  // setIgnoreCursorEvents(true) 整窗穿透；ignore 后网页收不到任何鼠标事件，
  // 也只能靠这条轮询把 ignore 解回来。
  // 按住期间 / 拖窗与走路中一律不动 ignore：拖拽时窗口位置高速变化，缓存的
  // 位置与光标读数存在错拍，误判「在区外」会把拖到一半的窗口变穿透直接脱手
  useEffect(() => {
    const win = getCurrentWindow();
    // 初始位置：onMoved 只在动窗时来，首次得自己查；顺带做一次启动落位
    // 校正（如上次会话把窗口留在了任务栏里）
    void win.outerPosition().then((p) => {
      winPosRef.current ??= { x: p.x, y: p.y };
      void settleAfterMove();
    });
    let ignored: boolean | null = null; // null = 未知，首 tick 必设一次
    let busy = false; // tick 内多次 await，防重入
    const timer = window.setInterval(() => {
      if (busy) return;
      if (downRef.current || isMoveState(stateRef.current)) return;
      busy = true;
      void (async () => {
        try {
          const pos = winPosRef.current;
          if (!pos) return;
          const cursor = await cursorPosition();
          // 物理 px → 窗内逻辑 px（无边框窗：外沿即内容原点）
          const x = (cursor.x - pos.x) / window.devicePixelRatio;
          const y = (cursor.y - pos.y) / window.devicePixelRatio;
          const rects: DOMRect[] = [];
          if (hitRef.current) rects.push(hitRef.current.getBoundingClientRect());
          const bub = bubbleRef.current;
          // 气泡只在「可点拉起对话」且不在退场时算交互区
          if (bub?.dataset.clickable && !bub.dataset.closing) {
            rects.push(bub.getBoundingClientRect());
          }
          const inside = rects.some(
            (r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom,
          );
          if (!inside !== ignored) {
            ignored = !inside;
            await win.setIgnoreCursorEvents(ignored);
          }
        } catch {
          // 窗口销毁/最小化等瞬态失败：下 tick 重试
        } finally {
          busy = false;
        }
      })();
    }, CURSOR_PATROL_MS);
    return () => {
      window.clearInterval(timer);
      void win.setIgnoreCursorEvents(false);
    };
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // 用户交互永远优先：按下即可取消尚未走完的任务栏自动避让。
    if (autoMoveRef.current) {
      autoMoveRunRef.current += 1;
      autoMoveRef.current = false;
    }
    setActivity((n) => n + 1);
    downRef.current = { x: e.screenX, y: e.screenY };
    // 捕获指针：命中矩形收紧后，贴边按住稍一滑就出区，不捕获会丢
    // move/up（拖拽判定失灵、downRef 悬空）。移交系统拖窗后捕获自然失效
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = downRef.current;
    if (!d) return;
    // 超阈值：判定为拖拽，启动不受透明整窗边界限制的自定义跟手移动。
    // 跟手小跑——按越过阈值这一下的指针方向定初始朝向（消掉首帧的方向空窗），
    // 之后由 onMoved 随窗口位移持续校正朝向；窗口停稳后由移动停表收回待机
    const dx = e.screenX - d.x;
    const dy = e.screenY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD_PX) {
      downRef.current = null;
      // 拖拽是最高优先级的直接交互：打断当前动画，清掉旧过渡目标；对话态仍由
      // convStateRef 保留，松手收步后会恢复。
      pendingStateRef.current = null;
      queuedStateRef.current = null;
      const direction = walkingStateForDelta(dx, dy);
      requestState(direction, { force: true, queueIfBlocked: false });
      bumpMoveStop();
      if (USE_MANUAL_WINDOW_DRAG) void startManualDragging();
      else void getCurrentWindow().startDragging();
    }
  };

  const onPointerUp = () => {
    if (manualDragRef.current) {
      manualDragRunRef.current += 1;
      manualDragRef.current = false;
      bumpMoveStop();
    }
    // 原地松手（没触发拖拽）：按当前状态给不同反馈——
    //  · 躲好/探头中点尾巴或耳朵 = 从对应边缘召回（拖动则仍走上面的悬空搬窝）；
    //  · 睡着摸 = 伸懒腰醒来；· 其余 = 摸摸开心。
    // 躲/召回进行中（hiding/unhide）不打断，保持原状态
    if (downRef.current) {
      const current = stateRef.current;
      if (isHiddenState(current)) {
        requestState(unhideStateFor(current));
      } else if (!isHidingState(current) && !isUnhideState(current) && !isSettlingState(current)) {
        requestState(current === "sleeping" ? "stretching" : "petted");
      }
    }
    downRef.current = null;
  };

  const onPointerCancel = () => {
    downRef.current = null;
    if (!manualDragRef.current) return;
    manualDragRunRef.current += 1;
    manualDragRef.current = false;
    bumpMoveStop();
  };

  return (
    <Stage>
      {/* 头顶气泡（PixelSurface 低噪像素面，与主面板同一套纹理）：
          say = 白面对话泡 + 三角尾巴；think = 浅青想法泡 + 三个小圆圈升上去。
          开了「点气泡拉起对话」则整个气泡可点（含尾巴/圆圈），否则不拦指针 */}
      {bubble && (
        <Bubble
          ref={bubbleRef}
          data-clickable={bubbleClickable || undefined}
          data-closing={closing || undefined}
          onClick={bubbleClickable ? openChatFromBubble : undefined}
        >
          <PixelSurface
            palette={bubble.kind === "think" ? PX.well : PX.panel}
            state="rest"
            pixel={3}
            radius={2}
            noise={0.08}
            rootStyle={{ display: "flex", maxWidth: BUBBLE_MAX_W }}
            contentStyle={{ display: "block", width: "100%", padding: "8px 11px" }}
          >
            <BubbleBody ref={bubbleBodyRef} data-kind={bubble.kind}>
              {/* 弹簧字逐字蹦入（与对话窗同款）。key 按形态断开：想法泡 ⇄ 对话泡
                  切换时整段重新蹦出，配合面色切换有「换了一口气」的感觉 */}
              <StreamingText key={bubble.kind} text={bubble.text} live={bubble.live} />
            </BubbleBody>
          </PixelSurface>
          {bubble.kind === "think" ? (
            <ThinkTrail aria-hidden>
              <ThinkDot data-i="0" />
              <ThinkDot data-i="1" />
              <ThinkDot data-i="2" />
            </ThinkTrail>
          ) : (
            <Tail aria-hidden />
          )}
        </Bubble>
      )}
      {/* 只有桌宠本体可交互：命中区 = 当前帧带非透明像素的最小包围盒（覆盖层，
          扫描未就绪前按整帧兜底），按下摸头 / 拖动搬窝；精灵框其余透明边角
          和窗口空白一样，由光标巡逻做成真穿透 */}
      <SpriteBox>
        <SpriteView
          ref={spriteRef}
          role="img"
          aria-label="雪豹"
          style={{
            backgroundImage: `url(${anim.src})`,
            backgroundSize: `${anim.frames * FRAME_PX}px ${FRAME_PX}px`,
            backgroundPosition: `${-frame * FRAME_PX}px 0`,
          }}
        />
        <PetHit
          ref={hitRef}
          style={{
            left: (bodyRect?.x ?? 0) * SPRITE_SCALE,
            top: (bodyRect?.y ?? 0) * SPRITE_SCALE,
            width: (bodyRect?.w ?? SPRITE_SIZE) * SPRITE_SCALE,
            height: (bodyRect?.h ?? SPRITE_SIZE) * SPRITE_SCALE,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
      </SpriteBox>
    </Stage>
  );
}

/* 舞台：铺满透明窗口，桌宠沉底、气泡自下往上叠在头顶。
   pointer-events:none 只管网页内命中（事件都归 PetHit / 可点气泡）；
   对桌面的真穿透由光标巡逻切 setIgnoreCursorEvents 实现 */
const Stage = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100vh;
  padding-bottom: 6px;
  opacity: ${PET_OPACITY};
  user-select: none;
  pointer-events: none;
`;

/* 精灵框：FRAME_PX 见方的定位容器，本身不收事件（视觉与命中分离） */
const SpriteBox = styled.div`
  position: relative;
  pointer-events: none;
`;

/* 桌宠本体命中区：贴着本体最小矩形的透明覆盖层（left/top/width/height 由
   帧带扫描结果内联），整个交互（摸头/拖窗）都在这，光标手型也只在它上面 */
const PetHit = styled.div`
  position: absolute;
  pointer-events: auto;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
`;

/* 头顶气泡：弹入登场 / 下沉缩小淡出退场（closing 两拍收场，播完才卸载）；
   默认纯视觉不拦指针，开了「点气泡拉起对话」才收点击（退场中不再可点） */
const Bubble = styled.div`
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 3px;
  transform-origin: center bottom;
  animation: bubble-pop 160ms cubic-bezier(0.2, 0.9, 0.3, 1.3);

  &[data-clickable] {
    pointer-events: auto;
    cursor: pointer;
  }

  &[data-closing] {
    pointer-events: none;
    animation: bubble-out ${BUBBLE_OUT_MS}ms ease-in both;
  }

  @keyframes bubble-pop {
    from {
      transform: translateY(5px) scale(0.95);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }

  @keyframes bubble-out {
    from {
      transform: none;
      opacity: 1;
    }
    to {
      transform: translateY(6px) scale(0.88);
      opacity: 0;
    }
  }
`;

/* 气泡正文：正文号深墨（浅面上恒定可读，不吃主题），长内容内部滚动只露最新几行
   （max-height ≈ 5 行）。思考态字色偏灰——心理活动比开口说话「轻」一档 */
const BubbleBody = styled.div`
  max-height: 125px;
  overflow: hidden;
  font: ${t.textMd};
  line-height: 1.55;
  letter-spacing: 0.3px;
  color: #3a3540;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;

  &[data-kind="think"] {
    color: #55616d;
  }
`;

/* 对话尾巴：朝下的小三角，尖端指向桌宠头顶。色同气泡面（PX.panel.face = 白） */
const Tail = styled.div`
  width: 0;
  height: 0;
  margin-top: -1px;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 8px solid #ffffff;
  filter: drop-shadow(0 2px 0 ${t.colorShadowPixel});
`;

/* 想法泡的引导圆圈：三颗由大到小从气泡底下排向头顶（漫画式「冒想法」），
   依次轻轻浮动。色取想法泡同款（PX.well 面色/描边） */
const ThinkTrail = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  margin-top: 2px;
`;

const ThinkDot = styled.div`
  border-radius: 50%;
  background: #c2e7e8; /* = PX.well.face */
  border: 2px solid #3f9599; /* = PX.well.edge */
  box-shadow: 0 2px 0 ${t.colorShadowPixel};
  animation: think-bob 1.3s ease-in-out infinite;

  &[data-i="0"] {
    width: 12px;
    height: 12px;
  }
  &[data-i="1"] {
    width: 9px;
    height: 9px;
    animation-delay: 0.18s;
  }
  &[data-i="2"] {
    width: 6px;
    height: 6px;
    animation-delay: 0.36s;
  }

  @keyframes think-bob {
    0%,
    100% {
      transform: none;
    }
    50% {
      transform: translateY(-2px);
    }
  }
`;

/* 雪豹本体：帧带做背景图，按帧号步进 background-position 切帧；
   pixelated 保住整数倍放大的方块硬边不糊 */
const SpriteView = styled.div`
  width: ${SPRITE_SIZE * SPRITE_SCALE}px;
  height: ${SPRITE_SIZE * SPRITE_SCALE}px;
  image-rendering: pixelated;
`;
