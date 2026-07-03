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
 * 风格③「数字有机体 · 反应-扩散 Gray-Scott / 图灵斑图」。
 *
 * 手法：ping-pong 双缓冲在 GPU 上迭代 Gray-Scott 反应扩散方程，
 * 化学物 U/V 相互反应 + 扩散，自组织出珊瑚/斑马纹/细胞分裂等图灵斑图 —— 活的有机体。
 * 状态用 RGBA8 打包 16bit（U→rg，V→ba）存储，避免浮点纹理扩展，最兼容。
 * 鼠标经过处注入化学物 V → 手到之处长出新图案。
 */

// ============ 顶部可调参数喵 ============
const SIM_SCALE = 0.6; // 模拟分辨率 = 呈现分辨率 × 此值（越小越粗越省）
const STEPS_PER_FRAME = 8; // 每帧迭代步数（越多演化越快，越贵）
const DIFF_U = 1.0; // U 扩散率 Da
const DIFF_V = 0.5; // V 扩散率 Db
const FEED = 0.037; // 投喂率 F（配 KILL 决定斑图形态）
const KILL = 0.06; // 消亡率 K
const DT = 1.0; // 时间步长
const SEED_SPOTS = 28; // 初始随机种子斑点数
const MOUSE_INJECT = 0.9; // 鼠标注入 V 强度
const MOUSE_RADIUS = 0.04; // 鼠标注入半径（uv 单位）

const COLORS: Record<ThemeMode, { bg: string; c1: string; c2: string }> = {
  light: { bg: "#eef8f8", c1: "#7dd1d4", c2: "#1f6f75" },
  dark: { bg: "#08131f", c1: "#1d7d86", c2: "#7ef0ff" },
};

const UPDATE_FRAG = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_texel;      // 1/simRes
uniform vec2 u_mouse;      // uv 空间 (0..1)
uniform float u_da, u_db, u_feed, u_kill, u_dt, u_minject, u_mrad;
${GLSL_PACK16}
vec2 getUV(vec2 c){ vec4 t = texture2D(u_prev, c); return vec2(unpack16(t.rg), unpack16(t.ba)); }
void main(){
  vec2 uv = gl_FragCoord.xy * u_texel;
  vec2 c = getUV(uv);
  vec2 lap =
      getUV(uv + vec2(-1.0, 0.0) * u_texel) * 0.2
    + getUV(uv + vec2( 1.0, 0.0) * u_texel) * 0.2
    + getUV(uv + vec2( 0.0,-1.0) * u_texel) * 0.2
    + getUV(uv + vec2( 0.0, 1.0) * u_texel) * 0.2
    + getUV(uv + vec2(-1.0,-1.0) * u_texel) * 0.05
    + getUV(uv + vec2( 1.0,-1.0) * u_texel) * 0.05
    + getUV(uv + vec2(-1.0, 1.0) * u_texel) * 0.05
    + getUV(uv + vec2( 1.0, 1.0) * u_texel) * 0.05
    - c;
  float u = c.x, v = c.y;
  float react = u * v * v;
  float du = u_da * lap.x - react + u_feed * (1.0 - u);
  float dv = u_db * lap.y + react - (u_kill + u_feed) * v;
  u += du * u_dt;
  v += dv * u_dt;

  // 鼠标注入 V（长出新图案）
  float md = distance(uv, u_mouse);
  if (md < u_mrad) v += u_minject * (1.0 - md / u_mrad);

  u = clamp(u, 0.0, 1.0);
  v = clamp(v, 0.0, 1.0);
  gl_FragColor = vec4(pack16(u), pack16(v));
}
`;

const PRESENT_FRAG = `
precision highp float;
uniform sampler2D u_state;
uniform vec2 u_res;
uniform vec3 u_bg, u_c1, u_c2;
${GLSL_PACK16}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float v = unpack16(texture2D(u_state, uv).ba);
  vec3 col = u_bg;
  col = mix(col, u_c1, smoothstep(0.08, 0.32, v));
  col = mix(col, u_c2, smoothstep(0.32, 0.5, v));
  gl_FragColor = vec4(col, 1.0);
}
`;

function makeSeed(w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  const [uHi, uLo] = pack16(1.0);
  // 全场 U=1, V=0
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    data[o] = uHi;
    data[o + 1] = uLo;
    data[o + 2] = 0;
    data[o + 3] = 0;
  }
  // 撒若干随机斑点：U=0.5, V=1
  const [uh, ul] = pack16(0.5);
  const [vh, vl] = pack16(1.0);
  for (let s = 0; s < SEED_SPOTS; s++) {
    const cx = Math.floor(Math.random() * w);
    const cy = Math.floor(Math.random() * h);
    const rad = 2 + Math.floor(Math.random() * 4);
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (dx * dx + dy * dy > rad * rad) continue;
        const o = (y * w + x) * 4;
        data[o] = uh;
        data[o + 1] = ul;
        data[o + 2] = vh;
        data[o + 3] = vl;
      }
    }
  }
  return data;
}

export const reaction: BackdropStyle = {
  id: "reaction",
  label: "有机体 · 反应扩散",
  desc: "Gray-Scott 图灵斑图自组织生长，鼠标注入化学物长新纹",
  create(gl, theme): BackdropRenderer | null {
    const updateProg = makeProgram(gl, VERT_FS, UPDATE_FRAG);
    const presentProg = makeProgram(gl, VERT_FS, PRESENT_FRAG);
    const buf = fullscreenBuffer(gl);
    if (!updateProg || !presentProg || !buf) return null;

    // 常量 uniform
    gl.useProgram(updateProg);
    const uU = (n: string) => gl.getUniformLocation(updateProg, n);
    const uPrev = uU("u_prev");
    const uTexel = uU("u_texel");
    const uMouseU = uU("u_mouse");
    gl.uniform1f(uU("u_da"), DIFF_U);
    gl.uniform1f(uU("u_db"), DIFF_V);
    gl.uniform1f(uU("u_feed"), FEED);
    gl.uniform1f(uU("u_kill"), KILL);
    gl.uniform1f(uU("u_dt"), DT);
    gl.uniform1f(uU("u_minject"), MOUSE_INJECT);
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
        simW = Math.max(4, Math.floor(w * SIM_SCALE));
        simH = Math.max(4, Math.floor(h * SIM_SCALE));
        disposeTargets();
        const seed = makeSeed(simW, simH);
        a = createRGBA8Target(gl, simW, simH, gl.NEAREST, seed);
        b = createRGBA8Target(gl, simW, simH, gl.NEAREST, null);
        ok = !!a && !!b;
      },
      frame(_t, _dt, mouse) {
        if (!ok || !a || !b) return;
        const aspect = presentW / presentH;
        const mx = mouse[0] / aspect + 0.5;
        const my = mouse[1] + 0.5;

        let read: GLTarget = a;
        let write: GLTarget = b;

        gl.useProgram(updateProg);
        gl.uniform2f(uTexel, 1 / simW, 1 / simH);
        gl.uniform2f(uMouseU, mx, my);
        gl.viewport(0, 0, simW, simH);
        for (let i = 0; i < STEPS_PER_FRAME; i++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, read.tex);
          gl.uniform1i(uPrev, 0);
          drawFullscreen(gl, updateProg, buf);
          const tmp = read;
          read = write;
          write = tmp;
        }
        a = read;
        b = write;

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, presentW, presentH);
        gl.useProgram(presentProg);
        gl.uniform2f(uResP, presentW, presentH);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, read.tex);
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
