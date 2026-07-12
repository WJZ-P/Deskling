import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { styled } from "@linaria/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
 * 拖窗 = dangling（被拎起蹬腿），停稳回 idle；召唤上桌播一次 greeting
 * （落地挥手）；thinking/typing/talking 由对话窗事件桥驱动（等首包托腮
 * → 执行工具敲电脑 → 正文输出说话，收工回 idle）。
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
/** 按下后移动超过这个曼哈顿距离（px）判定为拖窗，原地松手判定为摸摸 */
const DRAG_THRESHOLD_PX = 4;
/** idle 持续无交互这么久后入睡（ms） */
const SLEEP_AFTER_MS = 20_000;
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

export function PetWindow() {
  // 初始即 greeting：启动时窗口在桌面上就来一次落地问候（隐藏启动则悄悄播完落回 idle）
  const [state, setState] = useState<PetState>("greeting");
  // 交互脉冲：每次指针按下 +1，重置入睡倒计时（拖窗不改 state，靠它兜底）
  const [activity, setActivity] = useState(0);
  // 进入状态时抽定帧带变体（多变体随机），状态不变则整段咬死不换
  const anim = useMemo(() => ANIM_MANAGER.pick(state), [state]);
  // 一次性动作播完切到 next 声明的状态（摸头/伸懒腰/打招呼回 idle，打哈欠接 sleeping）
  const frame = useSpriteAnim(anim, () => {
    const n = anim.next;
    setState(n && ANIM_MANAGER.has(n) ? n : "idle");
  });

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

  // 久置入睡：idle 持续 SLEEP_AFTER_MS 无交互 → 打个哈欠趴下（播完接 sleeping）
  useEffect(() => {
    if (state !== "idle") return;
    const t = window.setTimeout(() => setState("yawning"), SLEEP_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [state, activity]);

  // 躲好后偶尔探头：hidden 驻留随机 1-3 分钟点播一次 peeking，播完自动
  // 缩回 hidden → 本效应重挂、重新掷下一次的间隔
  useEffect(() => {
    if (state !== "hiddenLeft" && state !== "hiddenRight") return;
    const t = window.setTimeout(
      () => setState(state === "hiddenLeft" ? "peekingLeft" : "peekingRight"),
      PEEK_MIN_MS + Math.random() * PEEK_RAND_MS,
    );
    return () => window.clearTimeout(t);
  }, [state]);

  // 移动停表：走路/悬空状态在窗口停稳 WALK_STOP_MS 后回待机。
  // 拖拽分支和 onMoved 共用（悬空由拖拽进入，之后靠 onMoved 续命）
  const stopTimerRef = useRef(0);
  const bumpMoveStop = () => {
    window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = window.setTimeout(() => {
      setState((s) =>
        s === "walking" || s === "walkingLeft" || s === "walkingRight" || s === "dangling"
          ? "idle"
          : s,
      );
    }, WALK_STOP_MS);
  };

  // 窗口在移动：被指针拎着 = 悬空蹬腿（拖拽分支已置 dangling，这里保持）；
  // 其余移动（将来自主散步）按水平位移选朝向——向左/向右用对应侧脸帧带，
  // 纯纵向用正面步态。拖拽中途停顿超时会先落回 idle，再动会显示走路——
  // OS 拖窗期间收不到指针事件，无法分辨仍被拎着，可接受
  const lastXRef = useRef<number | null>(null);
  useEffect(() => {
    const unlisten = getCurrentWindow().onMoved(({ payload }) => {
      const dx = lastXRef.current === null ? 0 : payload.x - lastXRef.current;
      lastXRef.current = payload.x;
      setState((s) => {
        if (s === "dangling") return s;
        if (dx < 0) return "walkingLeft";
        if (dx > 0) return "walkingRight";
        return "walking";
      });
      bumpMoveStop();
    });
    return () => {
      window.clearTimeout(stopTimerRef.current);
      void unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 状态点播通道：其他窗口 emitTo("pet", "pet:play", { state }) 直接切状态。
  // 桌宠页的动画测试按钮走这里；将来对话窗事件桥（talking/typing）也走这条
  useEffect(() => {
    const unlisten = getCurrentWindow().listen<{ state?: string }>("pet:play", (e) => {
      const s = e.payload?.state;
      if (s && ANIM_MANAGER.has(s)) setState(s);
    });
    return () => {
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
    // 超阈值：判定为拖拽，移交系统拖窗（之后指针事件归 OS，松手不算摸摸）。
    // 被拎起来 = 悬空蹬腿；窗口停稳后由移动停表收回待机
    if (Math.abs(e.screenX - d.x) + Math.abs(e.screenY - d.y) > DRAG_THRESHOLD_PX) {
      downRef.current = null;
      setState("dangling");
      bumpMoveStop();
      void getCurrentWindow().startDragging();
    }
  };

  const onPointerUp = () => {
    // 原地松手：睡着时摸 = 伸懒腰醒来（播完回 idle）；其余状态 = 摸摸开心
    if (downRef.current) {
      setState((s) => (s === "sleeping" ? "stretching" : "petted"));
    }
    downRef.current = null;
  };

  return (
    <Stage>
      {/* 头顶气泡（PixelSurface 低噪像素面，与主面板同一套纹理）：
          say = 白面对话泡 + 三角尾巴；think = 浅青想法泡 + 三个小圆圈升上去。
          开了「点气泡拉起对话」则整个气泡可点（含尾巴/圆圈），否则不拦指针 */}
      {bubble && (
        <Bubble
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
      {/* 只有桌宠本体可交互：按下摸头 / 拖动搬窝，空白区不拦截桌面点击 */}
      <PetHit
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <SpriteView
          role="img"
          aria-label="雪豹"
          style={{
            backgroundImage: `url(${anim.src})`,
            backgroundSize: `${anim.frames * FRAME_PX}px ${FRAME_PX}px`,
            backgroundPosition: `${-frame * FRAME_PX}px 0`,
          }}
        />
      </PetHit>
    </Stage>
  );
}

/* 舞台：铺满透明窗口，桌宠沉底、气泡自下往上叠在头顶。
   pointer-events:none 让空白区不拦截桌面点击（只有桌宠本体 PetHit 收事件） */
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

/* 桌宠本体命中区：整个交互（摸头/拖窗）都在这，光标手型也只在它上面 */
const PetHit = styled.div`
  pointer-events: auto;
  display: flex;
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
