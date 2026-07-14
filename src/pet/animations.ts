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

/** 一段帧动画：横向帧带 + 播放序列（序列项 = 帧带里的帧号） */
export interface AnimDef {
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
  /** 非循环动画播完切到的状态（缺省 idle），如打哈欠播完接 sleeping */
  next?: string;
}

/** 0..11 线性序列：12 帧逐帧微差的帧带直接顺播 */
const SEQ_12 = Array.from({ length: 12 }, (_, i) => i);

/**
 * hidden 驻留序列：躲好后近静态——大部分 tick 定格在尾巴立正帧（重复帧号 =
 * 定格，播放 hook 帧号不变不重渲），偶尔懒摆一循环、松垂歇两拍（fps 2 下
 * 约 11s 一圈）。探头不在这里，独立成 peeking 状态由定时器驱动
 */
const HIDDEN_SEQ = [0, 0, 0, 0, 1, 2, 3, 2, 1, 0, 0, 0, 0, 0, 4, 4, 5, 5, 4, 4, 0, 0];

/**
 * enter 入场序列：冒头段逐帧上浮，张望/眨眼/蓄力各驻留两拍（重复帧号 =
 * 定格），最后一帧单拍「蹦！」直上——fps 8 下全程约 2.5s，播完接 greeting
 */
const ENTER_SEQ = [0, 1, 1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11];

/** 12 帧顺播条目的简写（大多数帧带都是这个形状） */
const strip = (src: string, fps: number, extra?: Partial<AnimDef>): AnimDef => ({
  src,
  frames: 12,
  sequence: SEQ_12,
  fps,
  loop: true,
  ...extra,
});

/** 动画登记表：状态 → 帧带变体组（进入状态时抽一套） */
export const ANIMS = {
  // 待机：尾巴慢波浪 + 慢呼吸（一循环只沉浮各一次）+ 眨眼弧 + 耳尖抖
  idle: [strip("/pet/anim/idle.png", 5)],
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
  // 敲电脑：左右爪交替敲击，节奏里夹眨眼/抬眼/顿一下
  // 触发源 = 对话窗事件桥，agent 执行工具期间
  typing: [strip("/pet/anim/typing.png", 8)],
  // 摸头：两轮开心蹦跶（起跳→最高→回落→落地压缩），播完自回 idle
  petted: [strip("/pet/anim/petted.png", 8, { loop: false })],
  // 睡觉：猫貌团趴姿——呼吸起伏 + Zzz 上飘 + 尾尖/耳朵偶发小动作（6s 一循环）
  sleeping: [strip("/pet/anim/sleep.png", 2)],
  // 打哈欠入睡：大哈欠 → 逐帧趴下团成猫貌团，播完顺势接 sleeping
  yawning: [strip("/pet/anim/yawn.png", 6, { loop: false, next: "sleeping" })],
  // 伸懒腰醒来：趴着睁眼 → 撑起站直 → 踮脚大伸展，播完回 idle
  stretching: [strip("/pet/anim/stretch.png", 8, { loop: false })],
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
    { src: "/pet/anim/hidden-left.png", frames: 6, sequence: HIDDEN_SEQ, fps: 2, loop: true },
  ],
  // 探头偷看（左）：蹭出画缘 → 右眼粉耳露出、眨眼张望 → 缩回去，播完接回躲好
  peekingLeft: [strip("/pet/anim/peek-left.png", 4, { loop: false, next: "hiddenLeft" })],
  // 召回（左）：从只剩尾巴的躲好态跑回画面——尾巴一挺 → 探头确认 → 面朝屏内
  // 小跑滑回 → 刹车转正脸抖耳，播完回 idle。点尾巴（原地不拖）或测试按钮触发
  unhideLeft: [strip("/pet/anim/unhide-left.png", 10, { loop: false })],
  // 躲到屏幕右缘 / 躲好（右）/ 探头（右）/ 召回（右）：左侧版的整帧镜像
  hidingRight: [strip("/pet/anim/hide-right.png", 10, { loop: false, next: "hiddenRight" })],
  hiddenRight: [
    { src: "/pet/anim/hidden-right.png", frames: 6, sequence: HIDDEN_SEQ, fps: 2, loop: true },
  ],
  peekingRight: [strip("/pet/anim/peek-right.png", 4, { loop: false, next: "hiddenRight" })],
  unhideRight: [strip("/pet/anim/unhide-right.png", 10, { loop: false })],
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
