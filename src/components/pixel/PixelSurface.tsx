import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import type { PixelPalette } from "./PixelFrame";

/**
 * 弹簧驱动的像素表面（顶级交互按钮的底层，纯 JS 精细控制，无 CSS 换色）。
 *
 * 设计要点：
 *  - 每个可见像素（外描边 / 高光 / 暗影 / 面）都是一个 cell，拥有独立的弹簧状态；
 *  - 状态机：rest / hover / press。状态只决定各弹簧的「目标值」，
 *    弹簧始终从当前值追目标 → 任意时刻打断都平滑（不跳帧），并带轻微回弹；
 *  - hover：整块 border 逐像素「错落地」点亮（每格随机延迟 + 弹簧），
 *           面像素叠加随机相位的亮暗交替（呼吸/闪烁），而非扫光；
 *  - press：在 hover 基础上进一步错落提亮，松开平滑退回；
 *  - 位移(lift)与投影(elevation)也用整体弹簧驱动，全程丝滑。
 *
 * requestAnimationFrame 逐帧直接写 rect.fill / 根节点 transform / svg filter，
 * 不触发 React 重渲染；空闲（收敛且非 hover/press）自动停机。
 */

export type SurfaceState = "rest" | "hover" | "press";

// ---- 角色 ----
const EDGE = 0;
const HI = 1;
const LO = 2;
const FACE = 3;

/**
 * 表面动画调参 —— 全部抽成顶层，方便按用途覆盖喵～
 * 按钮用默认值；卡片等可传 `tune` 局部覆盖（如更慢的闪烁、更大的颗粒）。
 */
export interface SurfaceTune {
  /** 各角色 hover 提亮 [EDGE, HI, LO, FACE] */
  hoverLiftRole: [number, number, number, number];
  /** 各角色 press 提亮（HI/LO 按压表现由「高光反转」承担，通常设 0） */
  pressLiftRole: [number, number, number, number];
  /** 面像素正弦呼吸幅度（老式 flicker，按钮用；卡片可设 0 改用动态低噪） */
  flickerAmp: number;
  /** 面像素低噪/闪烁的绝对灰度增量系数（浅色深色都可见） */
  shimmerPx: number;
  /** 正弦呼吸速度最小值（越小越慢） */
  flickerSpeedMin: number;
  /** 正弦呼吸速度随机范围 */
  flickerSpeedRange: number;
  /** 低噪颗粒度：N×N 个美术像素合成一块噪声（1=最细，越大越粗块，独立于 pixel） */
  noiseGranularity: number;
  /** hover 动态低噪「变动幅度」（0=关闭动态低噪，仅静态低噪 + 正弦呼吸） */
  noiseHoverAmp: number;
  /** hover 动态低噪「重掷间隔/delay」秒：越大变化越慢、块与块越错落 */
  noiseHoverDelay: number;
  /** 每格错落起始延迟上限（秒） */
  delayMax: number;
  /** 弹簧刚度 */
  springK: number;
  /** 弹簧阻尼（略欠阻尼→轻微回弹） */
  springD: number;
  /** 抬升/下沉/投影 CSS 过渡时长（ms） */
  liftMs: number;
  /** 抬升/下沉缓动 */
  liftEase: string;
  /** hover 抬升 px（负=上抬） */
  hoverTy: number;
  /** press 下沉 px */
  pressTy: number;
  /** 静止/hover/press 投影高度 px */
  elevRest: number;
  elevHover: number;
  elevPress: number;
}

/** 默认调参（=按钮当前手感，改这里等于改按钮默认表现） */
export const DEFAULT_TUNE: SurfaceTune = {
  hoverLiftRole: [0.16, 0.12, 0.12, 0.05],
  pressLiftRole: [0.14, 0, 0, 0.2],
  flickerAmp: 0.09,
  shimmerPx: 150,
  flickerSpeedMin: 2,
  flickerSpeedRange: 4,
  noiseGranularity: 1,
  noiseHoverAmp: 0, // 按钮默认关闭动态低噪，保持既定手感
  noiseHoverDelay: 0.18,
  delayMax: 0.1,
  springK: 800,
  springD: 24,
  liftMs: 200,
  liftEase: "cubic-bezier(.2,.9,.3,1.3)",
  hoverTy: -2,
  pressTy: 1,
  elevRest: 3,
  elevHover: 3,
  elevPress: 3,
};

interface PixelSurfaceProps {
  palette: PixelPalette;
  state: SurfaceState;
  pixel?: number;
  radius?: number;
  /** 面像素基准随机明暗强度 0~1 */
  noise?: number;
  /**
   * 环境低噪强度 0~1：动态低噪（noiseHoverAmp）的「驱动下限」。
   * 0 = 只有 hover/press 时低噪才动（默认）；
   * >0 = 即使静止（rest）也持续动态变化 —— 用于「选中态也要一直动」的场景，
   *      hover 时取 max(hover 进度, ambient)，两者叠加不冲突。
   */
  ambient?: number;
  /** 动画调参覆盖（请传模块级常量以保持引用稳定，避免重建 cells） */
  tune?: Partial<SurfaceTune>;
  className?: string;
  children?: ReactNode;
  shadowColor?: string;
  /** 根节点样式覆盖（布局用：display/width/... 位移过渡由内部管理） */
  rootStyle?: CSSProperties;
  /** 内容层样式覆盖（布局用：padding/对齐/方向...） */
  contentStyle?: CSSProperties;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [230, 244, 244];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 伪随机 hash → [0,1)
function hash1(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

// 平滑值噪声（value-noise）：随 x 连续变化，每整数格重掷随机值并 smoothstep 插值 → [0,1)
function vnoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(seed + i * 131.0);
  const b = hash1(seed + (i + 1) * 131.0);
  return a + (b - a) * u;
}

interface Cells {
  n: number;
  x: Int16Array;
  y: Int16Array;
  role: Uint8Array;
  // 基准色（raised 态）
  br: Uint8Array;
  bg: Uint8Array;
  bb: Uint8Array;
  // 按压反转目标色（sunken 态：hi↔lo 对调，其余同基准）
  br2: Uint8Array;
  bg2: Uint8Array;
  bb2: Uint8Array;
  baseOff: Float32Array;
  flkS: Float32Array;
  flkP: Float32Array;
  nseed: Float32Array; // 动态低噪：所属噪声块的随机种子
  nph: Float32Array; // 动态低噪：所属噪声块的相位偏移（错落 delay）
  delay: Float32Array;
  kj: Float32Array;
}

export function PixelSurface({
  palette,
  state,
  pixel = 4,
  radius = 2,
  noise = 0.1,
  ambient = 0,
  tune,
  className,
  children,
  shadowColor = t.colorShadowPixel,
  rootStyle,
  contentStyle,
}: PixelSurfaceProps) {
  // 合并调参：consumer 传模块级常量 → tune 引用稳定 → T 稳定，不会误重建 cells
  const T = useMemo<SurfaceTune>(() => ({ ...DEFAULT_TUNE, ...tune }), [tune]);
  const rootRef = useRef<HTMLSpanElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const stateRef = useRef<SurfaceState>(state);
  stateRef.current = state;
  const ambientRef = useRef<number>(ambient);
  ambientRef.current = ambient;

  const rid = useId().replace(/:/g, "");
  const [{ w, h }, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(4, Math.round(w / pixel));
  const rows = Math.max(4, Math.round(h / pixel));
  const r = Math.max(0, Math.round(radius));

  // 分类每个可见像素 → 角色 + 基准色（弹簧目标基于此在亮度上做文章）
  const cells = useMemo<Cells>(() => {
    const edge = hexToRgb(palette.edge);
    const hi = hexToRgb(palette.hi);
    const lo = hexToRgb(palette.lo);
    const face = hexToRgb(palette.face);
    const roleRgb = [edge, hi, lo, face];
    // 按压反转：HI→LO、LO→HI，EDGE/FACE 不变
    const altRgb = [edge, lo, hi, face];

    const xs: number[] = [];
    const ys: number[] = [];
    const roles: number[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const m = Math.min(x, cols - 1 - x) + Math.min(y, rows - 1 - y);
        if (m < r) continue; // 透明圆角
        const inFace = x >= 1 && x <= cols - 2 && y >= 1 && y <= rows - 2 && m >= r + 1;
        let role: number;
        if (!inFace) role = EDGE;
        else if (x === cols - 2 || y === rows - 2) role = LO;
        else if (x === 1 || y === 1) role = HI;
        else role = FACE;
        xs.push(x);
        ys.push(y);
        roles.push(role);
      }
    }

    const n = xs.length;
    const c: Cells = {
      n,
      x: new Int16Array(n),
      y: new Int16Array(n),
      role: new Uint8Array(n),
      br: new Uint8Array(n),
      bg: new Uint8Array(n),
      bb: new Uint8Array(n),
      br2: new Uint8Array(n),
      bg2: new Uint8Array(n),
      bb2: new Uint8Array(n),
      baseOff: new Float32Array(n),
      flkS: new Float32Array(n),
      flkP: new Float32Array(n),
      nseed: new Float32Array(n),
      nph: new Float32Array(n),
      delay: new Float32Array(n),
      kj: new Float32Array(n),
    };
    // 低噪按「块」共享随机：同一块（gran×gran 像素）内像素噪声一致 → 颗粒更粗
    const gran = Math.max(1, Math.round(T.noiseGranularity));
    interface Blk {
      off: number;
      flkP: number;
      flkS: number;
      seed: number;
      nph: number;
    }
    const blocks = new Map<number, Blk>();
    const blockOf = (x: number, y: number): Blk => {
      const id = Math.floor(y / gran) * 100000 + Math.floor(x / gran);
      let b = blocks.get(id);
      if (!b) {
        b = {
          off: (Math.random() * 2 - 1) * noise,
          flkP: Math.random() * Math.PI * 2,
          flkS: T.flickerSpeedMin + Math.random() * T.flickerSpeedRange,
          seed: Math.random() * 1000,
          nph: Math.random(), // 相位错落（0~1 个 delay 周期）
        };
        blocks.set(id, b);
      }
      return b;
    };
    for (let i = 0; i < n; i++) {
      const role = roles[i];
      c.x[i] = xs[i];
      c.y[i] = ys[i];
      c.role[i] = role;
      const rgb = roleRgb[role];
      c.br[i] = rgb[0];
      c.bg[i] = rgb[1];
      c.bb[i] = rgb[2];
      const alt = altRgb[role];
      c.br2[i] = alt[0];
      c.bg2[i] = alt[1];
      c.bb2[i] = alt[2];
      if (role === FACE) {
        const b = blockOf(xs[i], ys[i]);
        c.baseOff[i] = b.off; // 静态低噪（块共享）
        c.flkS[i] = b.flkS; // 正弦呼吸速度（块共享）
        c.flkP[i] = b.flkP; // 正弦呼吸相位（块共享）
        c.nseed[i] = b.seed; // 动态低噪块种子
        c.nph[i] = b.nph; // 动态低噪块相位（错落 delay）
      }
      // 外描边(EDGE) + 高光/暗影(HI/LO) 都整体同步：统一 delay=0、kj=1（无错落、同速），
      // 变色一起开始一起走；只有面像素(FACE)保留随机错落与刚度抖动。
      const cohesive = role === EDGE || role === HI || role === LO;
      c.delay[i] = cohesive ? 0 : Math.random() * T.delayMax; // 错落延迟
      c.kj[i] = cohesive ? 1 : 0.75 + Math.random() * 0.5; // 弹簧刚度抖动
    }
    return c;
  }, [cols, rows, r, palette, noise, T]);

  // 渲染 cell（引用冻结，状态变化不重建/不重置 fill）
  const rects = useMemo(() => {
    const arr: ReactNode[] = [];
    for (let i = 0; i < cells.n; i++) {
      // 首帧（rest）：面像素叠加绝对灰度低噪，其余用基准色
      const d = cells.role[i] === FACE ? cells.baseOff[i] * T.shimmerPx : 0;
      const clampCh = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
      const rr = clampCh(cells.br[i] + d);
      const gg = clampCh(cells.bg[i] + d);
      const bb = clampCh(cells.bb[i] + d);
      arr.push(
        <rect
          key={i}
          x={cells.x[i]}
          y={cells.y[i]}
          width={1}
          height={1}
          fill={`rgb(${rr},${gg},${bb})`}
        />,
      );
    }
    return arr;
  }, [cells, T]);

  // 弹簧动画引擎
  const startRef = useRef<() => void>(() => {});
  useEffect(() => {
    const g = gRef.current;
    if (!g) return;

    const n = cells.n;
    const hp = new Float32Array(n); // hover 进度
    const hv = new Float32Array(n);
    const pp = new Float32Array(n); // press 进度
    const pv = new Float32Array(n);

    // 错落门控：状态切换后各格延迟一小段再朝新目标出发
    let hoverWant = 0;
    let hoverStart = -1;
    let pressWant = 0;
    let pressStart = -1;

    let raf = 0;
    let running = false;
    let last = performance.now();
    let t0 = last;

    const step = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;

      const st = stateRef.current;
      const amb = ambientRef.current; // 环境低噪驱动下限（选中态即使静止也持续动）
      const wantHover = st === "hover" || st === "press" ? 1 : 0;
      const wantPress = st === "press" ? 1 : 0;
      const tsec = now / 1000;
      if (wantHover !== hoverWant) {
        hoverWant = wantHover;
        hoverStart = tsec;
      }
      if (wantPress !== pressWant) {
        pressWant = wantPress;
        pressStart = tsec;
      }

      const nodes = g.childNodes as unknown as SVGRectElement[];
      let moving = false;

      for (let i = 0; i < n; i++) {
        // 门控目标（延迟未到则维持旧目标 = 1-新目标，二值交替成立）
        const hTarget = tsec - hoverStart >= cells.delay[i] ? hoverWant : 1 - hoverWant;
        const pTarget = tsec - pressStart >= cells.delay[i] ? pressWant : 1 - pressWant;

        // 弹簧积分（半隐式欧拉）
        const k = T.springK * cells.kj[i];
        let a = k * (hTarget - hp[i]) - T.springD * hv[i];
        hv[i] += a * dt;
        hp[i] += hv[i] * dt;
        a = k * (pTarget - pp[i]) - T.springD * pv[i];
        pv[i] += a * dt;
        pp[i] += pv[i] * dt;

        const role = cells.role[i];

        // 基准色：按压进度在 raised(基准) ↔ sunken(反转) 间插值 → 平滑高光反转
        let pc = pp[i];
        pc = pc < 0 ? 0 : pc > 1 ? 1 : pc;
        const baseR = cells.br[i] + (cells.br2[i] - cells.br[i]) * pc;
        const baseG = cells.bg[i] + (cells.bg2[i] - cells.bg[i]) * pc;
        const baseB = cells.bb[i] + (cells.bb2[i] - cells.bb[i]) * pc;

        // 提亮（朝白/黑混合）：暗色边框上才亮得起来，用于 hover/press 点亮
        const lift = T.hoverLiftRole[role] * hp[i] + T.pressLiftRole[role] * pp[i];
        const la = lift < 0 ? -lift : lift;
        const lc = la > 1 ? 1 : la;
        const ltgt = lift >= 0 ? 255 : 0;
        let rr = baseR + (ltgt - baseR) * lc;
        let gg = baseG + (ltgt - baseG) * lc;
        let bb = baseB + (ltgt - baseB) * lc;

        // 面像素低噪：绝对灰度增量（对称），浅色/深色面都可见
        if (role === FACE) {
          // 静态低噪（块共享，rest 也在）
          let shimmer = cells.baseOff[i];
          // 正弦呼吸（老式 flicker，hover 时叠加）
          if (T.flickerAmp > 0) {
            shimmer += T.flickerAmp * Math.sin(t * cells.flkS[i] + cells.flkP[i]) * hp[i];
          }
          // 动态低噪：hover 或 选中(ambient) 时按块持续随机变化，delay 控节奏、amp 控幅度。
          // 驱动强度取 max(hover 进度, ambient)：选中态即使静止也在动，hover 再叠加。
          if (T.noiseHoverAmp > 0) {
            const drive = hp[i] > amb ? hp[i] : amb;
            if (drive > 0.001) {
              const vx = t / (T.noiseHoverDelay > 0.01 ? T.noiseHoverDelay : 0.01) + cells.nph[i];
              const dyn = (vnoise(cells.nseed[i], vx) - 0.5) * 2; // [-1,1)
              shimmer += dyn * T.noiseHoverAmp * drive;
            }
          }
          const d = shimmer * T.shimmerPx;
          rr += d;
          gg += d;
          bb += d;
        }

        rr = rr < 0 ? 0 : rr > 255 ? 255 : rr;
        gg = gg < 0 ? 0 : gg > 255 ? 255 : gg;
        bb = bb < 0 ? 0 : bb > 255 ? 255 : bb;
        const rect = nodes[i];
        if (rect) rect.setAttribute("fill", `rgb(${rr | 0},${gg | 0},${bb | 0})`);

        if (Math.abs(hTarget - hp[i]) > 0.002 || Math.abs(hv[i]) > 0.002) moving = true;
        if (Math.abs(pTarget - pp[i]) > 0.002 || Math.abs(pv[i]) > 0.002) moving = true;
        // 闪烁需持续：hover 进度或环境低噪任一存在都要继续跑
        if (role === FACE && (hp[i] > 0.01 || amb > 0.001)) moving = true;
      }

      if (moving || wantHover || wantPress || amb > 0.001) {
        raf = requestAnimationFrame(step);
      } else {
        running = false;
      }
    };

    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(step);
    };
    startRef.current = start;
    start();

    return () => {
      cancelAnimationFrame(raf);
      running = false;
    };
  }, [cells, T]);

  useEffect(() => {
    startRef.current();
  }, [state, ambient]);

  // 位移 + 投影：纯位置表现，交给 CSS 过渡（调速见 tune.liftMs / liftEase）
  const ty = state === "press" ? T.pressTy : state === "hover" ? T.hoverTy : 0;
  const elev = state === "press" ? T.elevPress : state === "hover" ? T.elevHover : T.elevRest;

  return (
    <Root
      ref={rootRef}
      className={className}
      style={{
        transform: `translateY(${ty}px)`,
        transition: `transform ${T.liftMs}ms ${T.liftEase}`,
        ...rootStyle,
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${cols} ${rows}`}
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          overflow: "visible",
          filter: `drop-shadow(0 ${elev}px 0 ${shadowColor})`,
          transition: `filter ${T.liftMs}ms ${T.liftEase}`,
        }}
      >
        <g ref={gRef} data-pf={rid}>
          {rects}
        </g>
      </svg>
      <Content style={contentStyle}>{children}</Content>
    </Root>
  );
}

const Root = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  will-change: transform;
`;

const Content = styled.span`
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
`;
