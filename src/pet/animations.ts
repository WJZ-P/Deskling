/**
 * 桌宠动画登记表 + 播放管理器。
 *
 * 每个状态挂一组帧带变体：单变体就一套；多变体（如向左走的 w 嘴版/喘气版）
 * 由 PetAnimManager 在进入状态时随机抽一套整段播放——变体只在状态边界切换，
 * 段中绝不混切（口型这类特征逐帧横跳会显得不协调）。
 *
 * 帧带由 scripts/gen-pet-frames.ps1 从底图生成；新增动画 = 生成器加一段
 * Build-Strip spec + 这里登记一条；加变体 = 同状态数组多推一项。
 */

/** 松手后的四拍收步速度；拖动中的固定步态仍使用各 walking 条目的 10 FPS。 */
const WALK_SETTLE_FPS = 10;

/** 一段帧动画：横向帧带 + 播放序列（序列项 = 帧带里的帧号） */
export interface AnimDef {
  /** 帧带路径（public 下） */
  src: string;
  /** 帧带里的帧数（Canvas 从横向帧带裁取源矩形时校验边界） */
  frames: number;
  /** 播放序列：每 tick 前进一项 */
  sequence: number[];
  /** 播放速率（序列项/秒） */
  fps: number;
  /** false = 播到序列末尾停住（一次性动作，如摸头反应） */
  loop: boolean;
  /** 非循环动画播完切到的状态（缺省 idle），如打哈欠播完接 sleeping */
  next?: string;
}

/**
 * hidden 驻留序列：躲好后近静态——大部分 tick 定格主帧（重复帧号 = 定格，
 * 播放 hook 帧号不变不重渲），偶尔让侧边尾巴轻摆/松垂，或让上下双耳弯一下。
 * fps 2 下约 11s 一圈；探头独立成 peeking 状态由定时器驱动。
 */
const HIDDEN_EDGE_SEQ = [
  0, 0, 0, 0, 1, 2, 3, 2, 1, 0, 0, 0, 0, 0, 4, 4, 5, 5, 4, 4, 0, 0,
];

/** 顶部藏入在完全离场的空帧多停两拍，再倒挂回来露耳。 */
const HIDE_UP_SEQ = [0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 9, 10, 11];

/**
 * enter 入场序列：冒头段逐帧上浮，张望/眨眼/蓄力各驻留两拍（重复帧号 =
 * 定格），最后一帧单拍「蹦！」直上——fps 8 下全程约 2.5s，播完接 greeting
 */
const ENTER_SEQ = [0, 1, 1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11];

/** 任意帧数顺播条目的简写（过渡帧带会短于常规 12 帧） */
const clip = (
  src: string,
  frames: number,
  fps: number,
  extra?: Partial<AnimDef>,
): AnimDef => ({
  src,
  frames,
  sequence: Array.from({ length: frames }, (_, i) => i),
  fps,
  loop: true,
  ...extra,
});

/** 12 帧顺播条目的简写（大多数帧带都是这个形状） */
const strip = (src: string, fps: number, extra?: Partial<AnimDef>): AnimDef =>
  clip(src, 12, fps, extra);

/** 动画登记表：状态 → 帧带变体组（进入状态时抽一套） */
export const ANIMS = {
  // 待机：尾巴慢波浪 + 慢呼吸（一循环只沉浮各一次）+ 眨眼弧 + 耳尖抖
  idle: [strip("/pet/anim/idle.png", 5)],
  // 随机待机动作：仅由 PetWindow 的带权重/冷却调度器在 idle 中低概率点播。
  // 全部一次性播放，结束后回 idle；AI 活动态或用户交互可以随时打断。
  idleLook: [strip("/pet/anim/idle-look.png", 5, { loop: false })],
  idleGroom: [strip("/pet/anim/idle-groom.png", 6, { loop: false })],
  idleScratch: [strip("/pet/anim/idle-scratch.png", 8, { loop: false })],
  idleSneeze: [strip("/pet/anim/idle-sneeze.png", 8, { loop: false })],
  idleAlert: [strip("/pet/anim/idle-alert.png", 7, { loop: false })],
  // 说话：嘴部开合打拍子 + 点头 + 尾巴伴奏（触发源 = 对话窗事件桥，正文流式输出时）
  talking: [strip("/pet/anim/talk.png", 6)],
  // 走路（正面）：对角步态 + 下盘横摆 + 尾巴打拍子
  // 触发源 = 窗口移动事件的零位移兜底（首个事件方向未知时；将来自主散步同一条通路）
  walking: [strip("/pet/anim/walk.png", 10)],
  // 往下走：五官整体下移 1px 低头看脚下（纵向向下位移时播），
  // 与左右走同款双口型变体（全程 w 嘴 / 全程喘气线），进入状态时随机抽一套
  walkingDown: [
    strip("/pet/anim/walk-down.png", 10),
    strip("/pet/anim/walk-down-pant.png", 10),
  ],
  // 往上走：五官整体上移 1px 仰着头走（纵向向上位移时播），同样两套口型变体
  walkingUp: [
    strip("/pet/anim/walk-up.png", 10),
    strip("/pet/anim/walk-up-pant.png", 10),
  ],
  // 向左走：步态同 walking 且下盘一律压左，五官左移 2px 压向行进方向。
  // 两套口型变体（全程 w 嘴 / 全程喘气线），进入状态时随机抽一套
  walkingLeft: [
    strip("/pet/anim/walk-left.png", 10),
    strip("/pet/anim/walk-left-pant.png", 10),
  ],
  // 向右走：walkingLeft 的镜像（五官右移、下盘压右），同样两套口型变体
  walkingRight: [
    strip("/pet/anim/walk-right.png", 10),
    strip("/pet/anim/walk-right-pant.png", 10),
  ],
  // 拖动松手的四拍收步：最后一步落地、重心回中、五官回正。
  // 目标态不是静态 next：桌宠窗会据最新对话状态动态接 idle/thinking/talking…
  settling: [clip("/pet/anim/walk-stop.png", 4, WALK_SETTLE_FPS, { loop: false })],
  settlingLeft: [clip("/pet/anim/walk-stop-left.png", 4, WALK_SETTLE_FPS, { loop: false })],
  settlingRight: [clip("/pet/anim/walk-stop-right.png", 4, WALK_SETTLE_FPS, { loop: false })],
  settlingUp: [clip("/pet/anim/walk-stop-up.png", 4, WALK_SETTLE_FPS, { loop: false })],
  settlingDown: [clip("/pet/anim/walk-stop-down.png", 4, WALK_SETTLE_FPS, { loop: false })],
  // 敲电脑：左右爪交替敲击，节奏里夹眨眼/抬眼/顿一下
  // 触发源 = 对话窗事件桥，agent 执行工具期间（web 搜索类工具改走 searching）
  typing: [strip("/pet/anim/typing.png", 8)],
  // 搜索中：举放大镜端详找东西，两套镜像变体进入时随机抽一套整段播——
  //  · 左眼版（search.png）：放大镜罩左眼、左爪握，挑眉在右眼；
  //  · 右眼版（search-right.png）：放大镜罩右眼、右爪握，挑眉在左眼。
  // 两版同构：镜内大瞳左右扫视 + 举镜微浮 + 问号起伏，偶尔眨大眼/歪头。
  // 触发源 = 对话窗事件桥，agent 执行 web 搜索类工具期间
  searching: [
    strip("/pet/anim/search.png", 5),
    strip("/pet/anim/search-right.png", 5),
  ],
  // 正在聆听：录音期间竖耳追声，声波由近到远扩散。
  listening: [strip("/pet/anim/listening.png", 6)],
  // 等待危险工具批准：举着问号牌看主人，循环到用户同意或拒绝。
  waitingApproval: [strip("/pet/anim/waiting-approval.png", 5)],
  // 工具/任务反馈：一次性反应，由桌宠窗在播完后恢复最新对话态。
  success: [strip("/pet/anim/success.png", 8, { loop: false })],
  error: [strip("/pet/anim/error.png", 7, { loop: false })],
  // 摸头：两轮开心蹦跶（起跳→最高→回落→落地压缩），播完自回 idle
  petted: [strip("/pet/anim/petted.png", 8, { loop: false })],
  // 吃文件：主人投喂——文件飘现头顶 → 张嘴迎接 → 咔嚓两口（缺口渐大 + 碎屑）
  // → 鼓腮咕咚吞下 → 舔嘴冒心收势，播完自回 idle
  eating: [strip("/pet/anim/eat.png", 7, { loop: false })],
  // 睡觉：猫貌团趴姿——呼吸起伏 + Zzz 上飘 + 尾尖/耳朵偶发小动作（6s 一循环）
  sleeping: [strip("/pet/anim/sleep.png", 2)],
  // 打哈欠入睡：大哈欠 → 逐帧趴下团成猫貌团，播完顺势接 sleeping
  yawning: [strip("/pet/anim/yawn.png", 6, { loop: false, next: "sleeping" })],
  // 伸懒腰醒来：趴着睁眼 → 撑起站直 → 踮脚大伸展，播完回 idle
  stretching: [strip("/pet/anim/stretch.png", 8, { loop: false })],
  // 自然睡醒的两种随机剧情：受惊弹起 / 做完美梦开心醒来，均从趴睡姿起手并回 idle。
  wakingStartled: [strip("/pet/anim/wake-startled.png", 8, { loop: false })],
  wakingDream: [strip("/pet/anim/wake-dream.png", 7, { loop: false })],
  // 拖拽悬空：被拎起来四腿蹬空 + 尾巴乱甩（拖窗期间循环，停稳回 idle）
  dangling: [strip("/pet/anim/dangle.png", 8)],
  // 入场登台：从画面底边先冒耳朵尖 → 眼睛探出来左右张望（尾巴尖跟着在右缘
  // 冒头轻摆）→ 安心眨眼 → 缩下去蓄力 →「蹦！」跃出画面顶点，播完接
  // greeting 从同款腾空姿势落地挥手——召唤到桌面 / 启动时的完整登场戏
  entering: [
    { src: "/pet/anim/enter.png", frames: 12, sequence: ENTER_SEQ, fps: 8, loop: false, next: "greeting" },
  ],
  // 登场打招呼：蹦跳落地 + 举左前腿挥手（entering 蹦出后顺势接入；也可单独点播），播完回 idle
  greeting: [strip("/pet/anim/greet.png", 8, { loop: false })],
  // 思考中：右前腿托腮 + 头顶「…」逐帧冒出 + 眼神上瞟/侧瞟轮换
  // 触发源 = 对话窗事件桥，等首包/推理输出/消化工具结果期间
  thinking: [strip("/pet/anim/think.png", 4)],
  // 躲到屏幕左缘：惊觉「!」→ 压低蓄力 → 冲出画面（速度线）→ 扬尘消失，
  // 播完接 hiddenLeft。将来全屏应用检测到时触发（窗口贴左屏缘 + 播这个）
  hidingLeft: [strip("/pet/anim/hide-left.png", 10, { loop: false, next: "hiddenLeft" })],
  // 躲好（左）：近静态只剩尾巴——6 帧姿势 + 驻留序列（大部分时间定格立正，
  // 偶尔懒摆/松垂）；探头由桌宠窗定时器随机 1-3 分钟点播一次 peekingLeft
  hiddenLeft: [
    { src: "/pet/anim/hidden-left.png", frames: 6, sequence: HIDDEN_EDGE_SEQ, fps: 2, loop: true },
  ],
  // 探头偷看（左）：蹭出画缘 → 右眼粉耳露出、眨眼张望 → 缩回去，播完接回躲好
  peekingLeft: [strip("/pet/anim/peek-left.png", 4, { loop: false, next: "hiddenLeft" })],
  // 召回（左）：从只剩尾巴的躲好态跑回画面——尾巴一挺 → 探头确认 → 面朝屏内
  // 小跑滑回 → 刹车转正脸抖耳，播完回 idle。点尾巴（原地不拖）或测试按钮触发
  unhideLeft: [strip("/pet/anim/unhide-left.png", 10, { loop: false })],
  // 躲到屏幕右缘 / 躲好（右）/ 探头（右）/ 召回（右）：左侧版的整帧镜像
  hidingRight: [strip("/pet/anim/hide-right.png", 10, { loop: false, next: "hiddenRight" })],
  hiddenRight: [
    { src: "/pet/anim/hidden-right.png", frames: 6, sequence: HIDDEN_EDGE_SEQ, fps: 2, loop: true },
  ],
  peekingRight: [strip("/pet/anim/peek-right.png", 4, { loop: false, next: "hiddenRight" })],
  unhideRight: [strip("/pet/anim/unhide-right.png", 10, { loop: false })],
  // 躲到底边：逐步下沉，只留双耳；双耳偶尔弯一下，随机探头时露眼张望。
  hidingDown: [strip("/pet/anim/hide-down.png", 10, { loop: false, next: "hiddenDown" })],
  hiddenDown: [
    { src: "/pet/anim/hidden-down.png", frames: 6, sequence: HIDDEN_EDGE_SEQ, fps: 2, loop: true },
  ],
  peekingDown: [strip("/pet/anim/peek-down.png", 4, { loop: false, next: "hiddenDown" })],
  unhideDown: [strip("/pet/anim/unhide-down.png", 10, { loop: false })],
  // 躲到顶边：正常向上完全离场，空一拍后倒挂回来露耳；待机/探头是底边版纵向镜像。
  hidingUp: [
    { src: "/pet/anim/hide-up.png", frames: 12, sequence: HIDE_UP_SEQ, fps: 10, loop: false, next: "hiddenUp" },
  ],
  hiddenUp: [
    { src: "/pet/anim/hidden-up.png", frames: 6, sequence: HIDDEN_EDGE_SEQ, fps: 2, loop: true },
  ],
  peekingUp: [strip("/pet/anim/peek-up.png", 4, { loop: false, next: "hiddenUp" })],
  unhideUp: [strip("/pet/anim/unhide-up.png", 10, { loop: false })],
} satisfies Record<string, AnimDef[]>;

/** 桌宠状态：键即登记表的键（状态 ⇄ 动画组一一对应） */
export type PetState = keyof typeof ANIMS;

/**
 * 动画播放管理器：持有登记表，负责状态合法性判断与进入状态时的变体抽取。
 * 播放侧用 useMemo 把 pick 结果咬死在状态上，保证段中不换变体。
 */
export class PetAnimManager {
  constructor(private readonly registry: Record<string, AnimDef[]> = ANIMS) {}

  /** 该状态是否已登记（pet:play 事件与 next 跳转的合法性检查） */
  has(state: string): state is PetState {
    return state in this.registry;
  }

  /** 进入状态时抽一套变体：单变体直取，多变体均匀随机 */
  pick(state: PetState): AnimDef {
    const variants = this.registry[state];
    return variants.length > 1
      ? variants[Math.floor(Math.random() * variants.length)]
      : variants[0];
  }
}
