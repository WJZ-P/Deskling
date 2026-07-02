import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { styled } from "@linaria/react";
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

interface PixelSurfaceProps {
  palette: PixelPalette;
  state: SurfaceState;
  pixel?: number;
  radius?: number;
  /** 面像素基准随机明暗强度 0~1 */
  noise?: number;
  className?: string;
  children?: ReactNode;
  shadowColor?: string;
}

// ---- 角色 ----
const EDGE = 0;
const HI = 1;
const LO = 2;
const FACE = 3;

// ---- 动画参数（可调）----
const HOVER_LIFT_ROLE = [0.16, 0.12, 0.12, 0.05]; // 各角色 hover 提亮
// 各角色 press 提亮；HI/LO 的按压表现改由「高光反转」承担，故其提亮设 0
const PRESS_LIFT_ROLE = [0.14, 0, 0, 0.2];
const FLICKER_AMP = 0.09; // 面像素亮暗交替幅度
const DELAY_MAX = 0.1; // 每格错落起始延迟（秒）
const SPRING_K = 800; // 弹簧刚度
const SPRING_D = 24; // 弹簧阻尼（略欠阻尼→轻微回弹）

// 位移/投影是「纯位置」表现，交给 CSS 过渡（在这里调速度即可）
const LIFT_MS = 200; // 抬升/下沉/投影过渡时长（ms）
const LIFT_EASE = "cubic-bezier(.2,.9,.3,1.3)"; // 带一点回弹的缓动
const HOVER_TY = -2; // hover 抬升 px
const PRESS_TY = 1; // 按下下沉 px
const ELEV_REST = 3; // 静止投影高度 px
const ELEV_HOVER = 3; // hover 投影高度 px
const ELEV_PRESS = 3; // 按下投影高度 px

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [230, 244, 244];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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
  delay: Float32Array;
  kj: Float32Array;
}

export function PixelSurface({
  palette,
  state,
  pixel = 4,
  radius = 2,
  noise = 0.1,
  className,
  children,
  shadowColor = "rgba(31,106,111,0.38)",
}: PixelSurfaceProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const stateRef = useRef<SurfaceState>(state);
  stateRef.current = state;

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
  const r = Math.max(1, radius);

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
      delay: new Float32Array(n),
      kj: new Float32Array(n),
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
      c.baseOff[i] = role === FACE ? (Math.random() * 2 - 1) * noise : 0;
      c.flkS[i] = 2 + Math.random() * 4; // 闪烁速度
      c.flkP[i] = Math.random() * Math.PI * 2; // 闪烁相位
      c.delay[i] = Math.random() * DELAY_MAX; // 错落延迟
      c.kj[i] = 0.75 + Math.random() * 0.5; // 弹簧刚度抖动
    }
    return c;
  }, [cols, rows, r, palette, noise]);

  // 渲染 cell（引用冻结，状态变化不重建/不重置 fill）
  const rects = useMemo(() => {
    const arr: ReactNode[] = [];
    for (let i = 0; i < cells.n; i++) {
      const a = Math.min(1, Math.abs(cells.baseOff[i]));
      const tgt = cells.baseOff[i] >= 0 ? 255 : 0;
      const rr = Math.round(cells.br[i] + (tgt - cells.br[i]) * a);
      const gg = Math.round(cells.bg[i] + (tgt - cells.bg[i]) * a);
      const bb = Math.round(cells.bb[i] + (tgt - cells.bb[i]) * a);
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
  }, [cells]);

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
        const k = SPRING_K * cells.kj[i];
        let a = k * (hTarget - hp[i]) - SPRING_D * hv[i];
        hv[i] += a * dt;
        hp[i] += hv[i] * dt;
        a = k * (pTarget - pp[i]) - SPRING_D * pv[i];
        pv[i] += a * dt;
        pp[i] += pv[i] * dt;

        const role = cells.role[i];
        let off = cells.baseOff[i];
        off += HOVER_LIFT_ROLE[role] * hp[i];
        off += PRESS_LIFT_ROLE[role] * pp[i];
        if (role === FACE) {
          off += FLICKER_AMP * Math.sin(t * cells.flkS[i] + cells.flkP[i]) * hp[i];
        }

        // 基准色：按压进度在 raised(基准) ↔ sunken(反转) 间插值 → 平滑高光反转
        let pc = pp[i];
        pc = pc < 0 ? 0 : pc > 1 ? 1 : pc;
        const baseR = cells.br[i] + (cells.br2[i] - cells.br[i]) * pc;
        const baseG = cells.bg[i] + (cells.bg2[i] - cells.bg[i]) * pc;
        const baseB = cells.bb[i] + (cells.bb2[i] - cells.bb[i]) * pc;

        const aa = off < 0 ? -off : off;
        const clamp = aa > 1 ? 1 : aa;
        const tgt = off >= 0 ? 255 : 0;
        const rr = (baseR + (tgt - baseR) * clamp) | 0;
        const gg = (baseG + (tgt - baseG) * clamp) | 0;
        const bb = (baseB + (tgt - baseB) * clamp) | 0;
        const rect = nodes[i];
        if (rect) rect.setAttribute("fill", `rgb(${rr},${gg},${bb})`);

        if (Math.abs(hTarget - hp[i]) > 0.002 || Math.abs(hv[i]) > 0.002) moving = true;
        if (Math.abs(pTarget - pp[i]) > 0.002 || Math.abs(pv[i]) > 0.002) moving = true;
        if (role === FACE && hp[i] > 0.01) moving = true; // 闪烁需持续
      }

      if (moving || wantHover || wantPress) {
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
  }, [cells]);

  useEffect(() => {
    startRef.current();
  }, [state]);

  // 位移 + 投影：纯位置表现，交给 CSS 过渡（调速见顶部 LIFT_MS / LIFT_EASE）
  const ty = state === "press" ? PRESS_TY : state === "hover" ? HOVER_TY : 0;
  const elev = state === "press" ? ELEV_PRESS : state === "hover" ? ELEV_HOVER : ELEV_REST;

  return (
    <Root
      ref={rootRef}
      className={className}
      style={{ transform: `translateY(${ty}px)`, transition: `transform ${LIFT_MS}ms ${LIFT_EASE}` }}
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
          transition: `filter ${LIFT_MS}ms ${LIFT_EASE}`,
        }}
      >
        <g ref={gRef} data-pf={rid}>
          {rects}
        </g>
      </svg>
      <Content>{children}</Content>
    </Root>
  );
}

const Root = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 34px;
  padding: 8px 18px;
  will-change: transform;
`;

const Content = styled.span`
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;
