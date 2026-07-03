import type { ThemeMode } from "../../../styles/theme";
import type { BackdropRenderer, BackdropStyle } from "./types";
import {
  VERT_FS,
  createRGBA8Target,
  drawFullscreen,
  fullscreenBuffer,
  hexToRgb01,
  makeProgram,
  type GLTarget,
} from "./glUtils";

/**
 * 风格④「极客浪漫 · 元胞自动机 Cellular Automata」。
 *
 * 手法：低分辨率格子上跑生命游戏（HighLife 规则 B36/S23，带复制子更活跃），
 * ping-pong 双缓冲逐代演化；NEAREST 上采样 → 硬像素格子，复古极客味。
 * 每格保留「余热」通道做拖尾辉光；随机降生防止死绝；鼠标经过处绘制生命。
 * 演化按固定间隔步进（STEP_MS），不跟满帧率，方便肉眼欣赏。
 */

// ============ 顶部可调参数喵 ============
const CELL_SCALE = 0.09; // 格子分辨率 = 呈现分辨率 × 此值（越小格子越大越复古）
const STEP_MS = 90; // 每代间隔毫秒（越大演化越慢越好看）
const INIT_DENSITY = 0.2; // 初始存活密度
const SPAWN_RATE = 0.0006; // 每格每代随机降生概率（保持活跃、别死绝）
const HEAT_DECAY = 0.84; // 余热拖尾衰减（越大拖尾越长）
const MOUSE_RADIUS = 0.05; // 鼠标绘制生命半径（uv 单位）
const MAX_STEPS_PER_FRAME = 4; // 单帧最多补步数（防切后台回来暴走）

const COLORS: Record<ThemeMode, { bg: string; c1: string; c2: string }> = {
  light: { bg: "#eef7f7", c1: "#1f6f75", c2: "#7dd1d4" },
  dark: { bg: "#060f18", c1: "#8af2ff", c2: "#1d7d86" },
};

const UPDATE_FRAG = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_texel;
uniform vec2 u_mouse;
uniform float u_time, u_spawn, u_decay, u_mrad;
float rand(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float aliveAt(vec2 c){ return step(0.5, texture2D(u_prev, c).r); }
void main(){
  vec2 uv = gl_FragCoord.xy * u_texel;
  float n = 0.0;
  n += aliveAt(uv + vec2(-1.0,-1.0) * u_texel);
  n += aliveAt(uv + vec2( 0.0,-1.0) * u_texel);
  n += aliveAt(uv + vec2( 1.0,-1.0) * u_texel);
  n += aliveAt(uv + vec2(-1.0, 0.0) * u_texel);
  n += aliveAt(uv + vec2( 1.0, 0.0) * u_texel);
  n += aliveAt(uv + vec2(-1.0, 1.0) * u_texel);
  n += aliveAt(uv + vec2( 0.0, 1.0) * u_texel);
  n += aliveAt(uv + vec2( 1.0, 1.0) * u_texel);

  vec4 cur = texture2D(u_prev, uv);
  float self = step(0.5, cur.r);
  // HighLife: B36 / S23
  float born = (self < 0.5 && (n == 3.0 || n == 6.0)) ? 1.0 : 0.0;
  float surv = (self > 0.5 && (n == 2.0 || n == 3.0)) ? 1.0 : 0.0;
  float next = max(born, surv);

  if (rand(gl_FragCoord.xy + u_time) < u_spawn) next = 1.0;

  float md = distance(uv, u_mouse);
  if (md < u_mrad) next = 1.0;

  float heat = max(next, cur.g * u_decay);
  gl_FragColor = vec4(next, heat, 0.0, 1.0);
}
`;

const PRESENT_FRAG = `
precision highp float;
uniform sampler2D u_state;
uniform vec2 u_res;
uniform vec3 u_bg, u_c1, u_c2;
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 s = texture2D(u_state, uv);
  float alive = step(0.5, s.r);
  float heat = s.g;
  vec3 col = u_bg;
  col = mix(col, u_c2, heat * 0.55);
  col = mix(col, u_c1, alive);
  gl_FragColor = vec4(col, 1.0);
}
`;

function makeSeed(w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const alive = Math.random() < INIT_DENSITY ? 255 : 0;
    const o = i * 4;
    data[o] = alive;
    data[o + 1] = alive;
    data[o + 2] = 0;
    data[o + 3] = 255;
  }
  return data;
}

export const cellular: BackdropStyle = {
  id: "cellular",
  label: "元胞 · 生命游戏",
  desc: "HighLife 元胞自动机演化，硬像素格 + 余热拖尾，鼠标画生命",
  create(gl, theme): BackdropRenderer | null {
    const updateProg = makeProgram(gl, VERT_FS, UPDATE_FRAG);
    const presentProg = makeProgram(gl, VERT_FS, PRESENT_FRAG);
    const buf = fullscreenBuffer(gl);
    if (!updateProg || !presentProg || !buf) return null;

    gl.useProgram(updateProg);
    const uU = (n: string) => gl.getUniformLocation(updateProg, n);
    const uPrev = uU("u_prev");
    const uTexel = uU("u_texel");
    const uMouseU = uU("u_mouse");
    const uTime = uU("u_time");
    gl.uniform1f(uU("u_spawn"), SPAWN_RATE);
    gl.uniform1f(uU("u_decay"), HEAT_DECAY);
    gl.uniform1f(uU("u_mrad"), MOUSE_RADIUS);

    gl.useProgram(presentProg);
    const pU = (n: string) => gl.getUniformLocation(presentProg, n);
    const uState = pU("u_state");
    const uResP = pU("u_res");
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

    const step = (mx: number, my: number) => {
      if (!a || !b) return;
      const read = a;
      const write = b;
      gl.useProgram(updateProg);
      gl.uniform2f(uTexel, 1 / simW, 1 / simH);
      gl.uniform2f(uMouseU, mx, my);
      gl.uniform1f(uTime, stepCount * 1.7);
      gl.viewport(0, 0, simW, simH);
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, read.tex);
      gl.uniform1i(uPrev, 0);
      drawFullscreen(gl, updateProg, buf);
      a = write;
      b = read;
      stepCount++;
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
      },
      frame(_t, dt, mouse) {
        if (!ok || !a || !b) return;
        const aspect = presentW / presentH;
        const mx = mouse[0] / aspect + 0.5;
        const my = mouse[1] + 0.5;

        acc += dt;
        const interval = STEP_MS / 1000;
        let steps = 0;
        while (acc >= interval && steps < MAX_STEPS_PER_FRAME) {
          acc -= interval;
          step(mx, my);
          steps++;
        }
        if (acc > interval) acc = interval; // 丢弃积压

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
