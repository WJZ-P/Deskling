import type { ThemeMode } from "../../../styles/theme";
import type { BackdropRenderer, BackdropStyle } from "./types";
import {
  GLSL_PACK16,
  VERT_FS,
  createRGBA8Target,
  drawFullscreen,
  fullscreenBuffer,
  hexToRgb01,
  makeProgram,
  pack16,
  type GLTarget,
} from "./glUtils";

/**
 * 风格②「极客浪漫 · 元胞自动机 Cellular Automata」。
 *
 * 逻辑：低分辨率格子上跑生命游戏（HighLife 规则 B36/S23，带复制子更活跃），
 * ping-pong 双缓冲逐代演化。起始撒随机数量、随机位置的孢子后「自由演化」（无鼠标干预）。
 *
 * 呈现：每格是一个「弹簧小方块」——存活时方块从很小弹性放大（略过冲后回落），
 * 消亡时弹性缩小。每格维护液面 size(g) 与速度(b/a 打包 16bit)，每帧做弹簧积分，
 * 生命游戏仅在「代」边界推进。方块用切比雪夫距离绘制（轴对齐、无圆形锯齿），
 * 相邻方块满格时自然拼接，像一个个小容器里的流体涌入/退去，丝滑又美观。
 */

// ============ 顶部可调参数喵 ============
const CELL_SCALE = 0.2; // 格子分辨率 = 呈现分辨率 × 此值（越小方块越大越复古）
const STEP_MS = 130; // 每代间隔毫秒（越大演化越慢越好看）
const SPRING_K = 60.0; // 弹簧刚度（越大越快越硬）
const SPRING_C = 6.0; // 弹簧阻尼（越小回弹/过冲越明显）
const SPAWN_RATE = 0.0002; // 每格每代随机降生概率（防彻底死绝的保险；设 0 则纯自由演化）
const RAD_MAX = 0.6; // 满格方块半边长（>0.5 会与邻格拼接）
const EDGE = 0.05; // 方块边缘柔和度（抗锯齿）

// 内部编码范围（size 允许 >1 的过冲；速度有正负需偏移编码）
const FILL_MAX = 1.5; // size 存储上限（留出弹簧过冲空间）
const VEL_MAX = 16.0; // 速度编码范围 ±VEL_MAX

// ---- 起始孢子（随机数量 + 随机位置的小簇）----
const SPORE_MIN = 14; // 最少孢子簇数
const SPORE_MAX = 40; // 最多孢子簇数
const CLUSTER_CELLS = 6; // 每簇最多活细胞数
const CLUSTER_SPREAD = 2; // 每簇散布半径（格）

const COLORS: Record<ThemeMode, { bg: string; c1: string; c2: string }> = {
  light: { bg: "#eef7f7", c1: "#2f9aa0", c2: "#a9dede" },
  dark: { bg: "#060f18", c1: "#6fe6f2", c2: "#123c44" },
};

const UPDATE_FRAG = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_texel;
uniform float u_step, u_dt, u_k, u_c, u_spawn, u_time;
${GLSL_PACK16}
float rand(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float aliveAt(vec2 c){ return step(0.5, texture2D(u_prev, c).r); }
void main(){
  vec2 uv = gl_FragCoord.xy * u_texel;
  vec4 cur = texture2D(u_prev, uv);
  float selfAlive = step(0.5, cur.r);
  float size = cur.g * ${FILL_MAX.toFixed(3)};
  float vel = (unpack16(cur.ba) - 0.5) * (2.0 * ${VEL_MAX.toFixed(3)});
  float alive = selfAlive;

  // 仅在「代」边界推进一次生命游戏；其余帧只做弹簧积分 → 丝滑
  if (u_step > 0.5) {
    float n = 0.0;
    n += aliveAt(uv + vec2(-1.0,-1.0) * u_texel);
    n += aliveAt(uv + vec2( 0.0,-1.0) * u_texel);
    n += aliveAt(uv + vec2( 1.0,-1.0) * u_texel);
    n += aliveAt(uv + vec2(-1.0, 0.0) * u_texel);
    n += aliveAt(uv + vec2( 1.0, 0.0) * u_texel);
    n += aliveAt(uv + vec2(-1.0, 1.0) * u_texel);
    n += aliveAt(uv + vec2( 0.0, 1.0) * u_texel);
    n += aliveAt(uv + vec2( 1.0, 1.0) * u_texel);
    float born = (selfAlive < 0.5 && (n == 3.0 || n == 6.0)) ? 1.0 : 0.0;
    float surv = (selfAlive > 0.5 && (n == 2.0 || n == 3.0)) ? 1.0 : 0.0;
    alive = max(born, surv);
    if (rand(gl_FragCoord.xy + u_time) < u_spawn) alive = 1.0;
  }

  // 弹簧积分（半隐式欧拉）：size 朝目标(存活=1/死亡=0)弹性收敛，欠阻尼→放大/缩小带回弹
  float acc = u_k * (alive - size) - u_c * vel;
  vel += acc * u_dt;
  size += vel * u_dt;
  size = clamp(size, 0.0, ${FILL_MAX.toFixed(3)});

  float velEnc = clamp(vel / (2.0 * ${VEL_MAX.toFixed(3)}) + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(alive, size / ${FILL_MAX.toFixed(3)}, pack16(velEnc));
}
`;

const PRESENT_FRAG = `
precision highp float;
uniform sampler2D u_state;
uniform vec2 u_res;
uniform vec2 u_gridres;
uniform vec3 u_bg, u_c1, u_c2;
uniform float u_radmax, u_edge;
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 gv = uv * u_gridres;          // 片元在格坐标系里的位置
  vec2 cellId = floor(gv);
  float cover = 0.0;                 // 方块覆盖（本格 + 邻格拼接）
  float wet = 0.0;                   // 更宽的湿润 halo
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 cid = cellId + vec2(float(dx), float(dy));
      float sz = texture2D(u_state, (cid + 0.5) / u_gridres).g * ${FILL_MAX.toFixed(3)};
      vec2 center = cid + 0.5;
      vec2 dd = abs(gv - center);
      float box = max(dd.x, dd.y);   // 切比雪夫距离 → 轴对齐方块
      float rad = u_radmax * sqrt(sz);
      cover = max(cover, smoothstep(rad + u_edge, rad - u_edge, box) * step(0.004, sz));
      wet = max(wet, sz * smoothstep(rad + 0.5, rad - u_edge, box));
    }
  }
  vec3 col = u_bg;
  col = mix(col, u_c2, wet * 0.5);
  col = mix(col, u_c1, cover);
  gl_FragColor = vec4(col, 1.0);
}
`;

function makeSeed(w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  // 全场：size=0、速度=0（编码 0.5 → pack16），孢子起始也从 0 弹性弹入
  const [vHi, vLo] = pack16(0.5);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    data[o + 2] = vHi;
    data[o + 3] = vLo;
  }
  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    data[(y * w + x) * 4] = 255; // alive
  };
  const count = SPORE_MIN + Math.floor(Math.random() * (SPORE_MAX - SPORE_MIN + 1));
  for (let s = 0; s < count; s++) {
    const cx = Math.floor(Math.random() * w);
    const cy = Math.floor(Math.random() * h);
    const cells = 2 + Math.floor(Math.random() * (CLUSTER_CELLS - 1));
    for (let k = 0; k < cells; k++) {
      const dx = Math.round((Math.random() * 2 - 1) * CLUSTER_SPREAD);
      const dy = Math.round((Math.random() * 2 - 1) * CLUSTER_SPREAD);
      set(cx + dx, cy + dy);
    }
  }
  return data;
}

export const cellular: BackdropStyle = {
  id: "cellular",
  label: "元胞 · 生命游戏",
  desc: "随机孢子自由演化的 HighLife 元胞，方块弹簧般涌入/退去",
  create(gl, theme): BackdropRenderer | null {
    const updateProg = makeProgram(gl, VERT_FS, UPDATE_FRAG);
    const presentProg = makeProgram(gl, VERT_FS, PRESENT_FRAG);
    const buf = fullscreenBuffer(gl);
    if (!updateProg || !presentProg || !buf) return null;

    gl.useProgram(updateProg);
    const uU = (n: string) => gl.getUniformLocation(updateProg, n);
    const uPrev = uU("u_prev");
    const uTexel = uU("u_texel");
    const uStep = uU("u_step");
    const uDt = uU("u_dt");
    const uTime = uU("u_time");
    gl.uniform1f(uU("u_k"), SPRING_K);
    gl.uniform1f(uU("u_c"), SPRING_C);
    gl.uniform1f(uU("u_spawn"), SPAWN_RATE);

    gl.useProgram(presentProg);
    const pU = (n: string) => gl.getUniformLocation(presentProg, n);
    const uState = pU("u_state");
    const uResP = pU("u_res");
    const uGridres = pU("u_gridres");
    gl.uniform1f(pU("u_radmax"), RAD_MAX);
    gl.uniform1f(pU("u_edge"), EDGE);
    const c = COLORS[theme];
    gl.uniform3fv(pU("u_bg"), hexToRgb01(c.bg));
    gl.uniform3fv(pU("u_c1"), hexToRgb01(c.c1));
    gl.uniform3fv(pU("u_c2"), hexToRgb01(c.c2));

    let a: GLTarget | null = null;
    let b: GLTarget | null = null;
    let simW = 1;
    let simH = 1;
    let presentW = 1;
    let presentH = 1;
    let ok = true;
    let acc = 0;
    let stepCount = 0;

    const disposeTargets = () => {
      if (a) {
        gl.deleteTexture(a.tex);
        gl.deleteFramebuffer(a.fbo);
      }
      if (b) {
        gl.deleteTexture(b.tex);
        gl.deleteFramebuffer(b.fbo);
      }
      a = null;
      b = null;
    };

    return {
      resize(w, h) {
        presentW = w;
        presentH = h;
        simW = Math.max(4, Math.floor(w * CELL_SCALE));
        simH = Math.max(4, Math.floor(h * CELL_SCALE));
        disposeTargets();
        a = createRGBA8Target(gl, simW, simH, gl.NEAREST, makeSeed(simW, simH));
        b = createRGBA8Target(gl, simW, simH, gl.NEAREST, null);
        ok = !!a && !!b;
        acc = 0;
        gl.useProgram(presentProg);
        gl.uniform2f(uGridres, simW, simH);
      },
      frame(_t, dt, _mouse) {
        if (!ok || !a || !b) return;

        // 是否到「代」边界（推进一次生命游戏）；其余帧仅做弹簧积分
        acc += dt;
        const interval = STEP_MS / 1000;
        let doStep = 0;
        if (acc >= interval) {
          acc -= interval;
          if (acc > interval) acc = interval; // 丢弃积压，防切后台回来暴走
          doStep = 1;
        }

        const read = a;
        const write = b;
        gl.useProgram(updateProg);
        gl.uniform2f(uTexel, 1 / simW, 1 / simH);
        gl.uniform1f(uStep, doStep);
        gl.uniform1f(uDt, dt);
        gl.uniform1f(uTime, stepCount * 1.7);
        gl.viewport(0, 0, simW, simH);
        gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, read.tex);
        gl.uniform1i(uPrev, 0);
        drawFullscreen(gl, updateProg, buf);
        a = write;
        b = read;
        if (doStep) stepCount++;

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, presentW, presentH);
        gl.useProgram(presentProg);
        gl.uniform2f(uResP, presentW, presentH);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, a.tex);
        gl.uniform1i(uState, 0);
        drawFullscreen(gl, presentProg, buf);
      },
      dispose() {
        disposeTargets();
        gl.deleteProgram(updateProg);
        gl.deleteProgram(presentProg);
        gl.deleteBuffer(buf);
      },
    };
  },
};
