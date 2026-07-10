import { makeProgram, fullscreenBuffer, drawFullscreen, hexToRgb01, VERT_FS } from "./backdrops/glUtils";
import type { PixelPalette } from "./PixelFrame";

/**
 * WebGL 像素帧「渲染器」：把一帧像素帧（外描边 / 面色 / 低噪 / 内斜角 / 切角）
 * 用一发片元着色器画到一张 cols×rows 的共享 GL 画布上，再 blit（drawImage）到
 * 每个气泡自己的 2D <canvas>，由 CSS image-rendering: pixelated 最近邻放大铺满。
 *
 * 为什么不再走「烘焙成 data URL 当 background-image」：
 *  - 那是一张冻住的静态图，想让低噪动起来只能每帧 toDataURL 重设背景，
 *    而 toDataURL 是一次 GPU→CPU→PNG 编码同步往返，几十个气泡 60fps 扛不住。
 *  - 改成「共享 GL 渲染 + blit 到各自 2D canvas」后：
 *      · 静态气泡：一次渲染 + 一次 blit（和贴背景图一样便宜，还省掉 PNG 编解码）；
 *      · 流式气泡：共享 rAF 推 u_time，逐帧重画 + blit，低噪就能真的蠕动。
 *
 * 为什么用 2D canvas 而不是每气泡一个 WebGL canvas：
 *  - Chromium 单页 WebGL 上下文上限约 16 个，几十个气泡各占一个直接爆；
 *  - 2D 上下文不受此限，可开成百上千个 —— 所以 GL 只留一个共享的当引擎，
 *    结果 blit 给各气泡的 2D canvas。
 *
 * 复刻精度：分辨率就是美术网格 cols×rows（一美术像素=一纹素），再由 CSS
 * image-rendering:pixelated 放大，与 SVG viewBox + preserveAspectRatio=none +
 * crispEdges 的最近邻放大逐像素一致。低噪用「按块常量灰度」复刻同粒度同幅度，
 * 动画态则在相邻两 tick 间线性插值（约 2.5Hz），得到平滑蠕动而非闪烁。
 */

// 低噪灰度增量系数（与 PixelFrame / PixelSurface 的 NOISE_PX 对齐）
const NOISE_PX = 150;

const FRAG = `
precision highp float;
uniform float u_cols;
uniform float u_rows;
uniform float u_radius;    // 切角格数
uniform float u_noise;     // 低噪幅度 0~1
uniform float u_gran;      // 低噪块粒度（N×N 合一块）
uniform float u_time;      // 秒（JS 侧已取模压小，保 highp 精度）
uniform float u_noiseSpeed;// 0=静态低噪；>0 每秒重掷次数（低噪随时间平滑游动，含流式气泡的 2.5）
uniform float u_hollow;    // 1=空心框（只留外圈 2px 环，中心透明）
uniform vec3  u_face;      // 面色
uniform vec3  u_edge;      // 外描边
uniform vec3  u_tl;        // 顶左内斜线色
uniform vec3  u_br;        // 底右内斜线色
uniform float u_hasLines;  // variant!=flat → 1，画内斜角

// 伪随机 hash → [0,1)（与 SVG 版 hash1 不同源，但同为均匀分布，质感一致）
float hash(vec2 p){
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main(){
  float cols = u_cols;
  float rows = u_rows;
  // 片元 → 美术网格整数坐标（SVG 以左上为原点，WebGL 以左下，故 y 翻转）
  float gx = floor(gl_FragCoord.x);
  float gy = floor(rows - gl_FragCoord.y);

  // 四角曼哈顿距离 → 取最小，判断落在哪个切角三角内
  float dTL = gx + gy;
  float dTR = (cols - 1.0 - gx) + gy;
  float dBL = gx + (rows - 1.0 - gy);
  float dBR = (cols - 1.0 - gx) + (rows - 1.0 - gy);
  float mc = min(min(dTL, dTR), min(dBL, dBR));

  float r = u_radius;
  // 外轮廓抠角：mc < r（整数） → 透明（露出背景，得圆角外形）
  if (r > 0.5 && mc < r - 0.5) { discard; }

  // 内斜角行列判定（空心框与实心面共用）
  bool topRow  = abs(gy - 1.0) < 0.5;
  bool leftCol = abs(gx - 1.0) < 0.5;
  bool botRow  = abs(gy - (rows - 2.0)) < 0.5;
  bool rightCol= abs(gx - (cols - 2.0)) < 0.5;

  // 空心框：中心透明，只画「外描边 + 内斜角」组成的外圈 2px 环（窗口收口框用）
  if (u_hollow > 0.5) {
    bool inCenter = (gx > 1.5 && gx < cols - 2.5 && gy > 1.5 && gy < rows - 2.5);
    if (inCenter) { discard; }
    vec3 rc = u_edge;
    if (u_hasLines > 0.5) {
      if (topRow || leftCol)  rc = u_tl;
      if (botRow || rightCol) rc = u_br;
    }
    gl_FragColor = vec4(rc, 1.0);
    return;
  }

  // 默认外描边；面组再套「面 mask」——切角多缩一档（mc < r+1）处露出连续描边
  vec3 col = u_edge;
  bool faceAllowed = !(r > 0.5 && mc < (r + 1.0) - 0.5);
  bool inInner = (gx > 0.5 && gx < cols - 1.5 && gy > 0.5 && gy < rows - 1.5);

  if (faceAllowed && inInner) {
    // 面色 + 按块低噪
    float bxi = floor((gx - 1.0) / u_gran);
    float byi = floor((gy - 1.0) / u_gran);
    // 灰度种子：静态时按块常量；noiseSpeed>0 时相邻两 tick 间 smoothstep 插值 →
    // 平滑游动（速度即每秒重掷次数：流式气泡传 2.5，侧栏/标题栏传各自慢速值）
    float hv;
    if (u_noiseSpeed > 0.0) {
      float tf = u_time * u_noiseSpeed;
      float t0 = floor(tf);
      float f  = fract(tf);
      f = f * f * (3.0 - 2.0 * f); // smoothstep：低速游动更柔，不显步进
      float h0 = hash(vec2(bxi, byi) + vec2(t0 * 1.7, t0 * 0.3));
      float h1 = hash(vec2(bxi, byi) + vec2((t0 + 1.0) * 1.7, (t0 + 1.0) * 0.3));
      hv = mix(h0, h1, f);
    } else {
      hv = hash(vec2(bxi, byi));
    }
    float d = (hv * 2.0 - 1.0) * u_noise * (${NOISE_PX.toFixed(1)} / 255.0);
    col = clamp(u_face + vec3(d), 0.0, 1.0);
    // 内斜角：先顶左，后底右（底右后画 → 交叠处底右覆盖，与 SVG 一致）
    if (u_hasLines > 0.5) {
      if (topRow || leftCol)  col = u_tl;
      if (botRow || rightCol) col = u_br;
    }
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---- 噪声场着色器（对话窗背景 PixelNoiseField 的 GPU 版）--------------------
//
// 把原来 CPU 上「每帧 1.5 万块 × 2 次 value-noise ≈ 12 万次 Math.sin」的 JS 循环
// 整体搬进片元着色器：淡底噪（灰度颗粒 + 极缓 shimmer）+ 漂移蓝场按阈值染色。
// 算法逐行对齐 PixelNoiseField 的 JS 实现（hash2 / snoise2 同源），观感一致。
const FRAG_NOISE_FIELD = `
precision highp float;
uniform float u_rows;
uniform float u_time;      // 秒
uniform vec3  u_base;      // 基色（主题淡色背景）
uniform vec3  u_accent;    // 蓝场染色（accent 青蓝）
uniform float u_baseAmp;   // 底噪灰度振幅（0~1 归一）
uniform float u_shimmer;   // 底噪明暗变化速度（每秒）
uniform float u_blueMax;   // 蓝色最大浓度
uniform float u_blueGate;  // 蓝色显现阈值
uniform float u_blueScale; // 蓝场空间频率
uniform float u_blueDrift; // 蓝场漂移速度

float hash2(vec2 p){
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
// 2D 平滑值噪声：四角随机值 + smoothstep 双线性插值（与 JS 版 snoise2 同构）
float snoise2(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main(){
  // 片元 → 网格块坐标（一块=一纹素；y 翻转对齐 JS 的左上原点）
  float gx = floor(gl_FragCoord.x);
  float gy = floor(u_rows - gl_FragCoord.y);

  // 漂移蓝场 → 阈值上映射成蓝色浓度（横竖不同速 → 斜向游动不呆板）
  float dx = u_time * u_blueDrift;
  float dy = -u_time * u_blueDrift * 0.6;
  float bf = snoise2(vec2(gx * u_blueScale + dx, gy * u_blueScale + dy));
  float blue = bf > u_blueGate ? (bf - u_blueGate) / (1.0 - u_blueGate) * u_blueMax : 0.0;

  // 底噪灰度：每块用坐标 hash 出的相位种子跑 1D value-noise，随时间缓慢小幅明暗
  float s = hash2(vec2(gx * 1.3 + 0.5, gy * 1.7 + 0.5)) * 20.0;
  float g = (snoise2(vec2(s, u_time * u_shimmer + s)) - 0.5) * 2.0 * u_baseAmp;

  vec3 col = clamp(mix(u_base, u_accent, blue) + vec3(g), 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

interface GL {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  prog: WebGLProgram;
  buf: WebGLBuffer;
  loc: {
    cols: WebGLUniformLocation | null;
    rows: WebGLUniformLocation | null;
    radius: WebGLUniformLocation | null;
    noise: WebGLUniformLocation | null;
    gran: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    noiseSpeed: WebGLUniformLocation | null;
    hollow: WebGLUniformLocation | null;
    face: WebGLUniformLocation | null;
    edge: WebGLUniformLocation | null;
    tl: WebGLUniformLocation | null;
    br: WebGLUniformLocation | null;
    hasLines: WebGLUniformLocation | null;
  };
  /** 噪声场程序（惰性编译：首次用到 PixelNoiseField 才建） */
  nf?: {
    prog: WebGLProgram;
    loc: {
      rows: WebGLUniformLocation | null;
      time: WebGLUniformLocation | null;
      base: WebGLUniformLocation | null;
      accent: WebGLUniformLocation | null;
      baseAmp: WebGLUniformLocation | null;
      shimmer: WebGLUniformLocation | null;
      blueMax: WebGLUniformLocation | null;
      blueGate: WebGLUniformLocation | null;
      blueScale: WebGLUniformLocation | null;
      blueDrift: WebGLUniformLocation | null;
    };
  } | null;
}

let glCtx: GL | null | undefined; // undefined=未初始化，null=不可用（回退 SVG）

function initGL(): GL | null {
  if (glCtx !== undefined) return glCtx;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", {
      alpha: true, // 切角处透明，露出气泡背景
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // 画完后 drawImage 读得到当前缓冲
      antialias: false,
    }) as WebGLRenderingContext | null;
    if (!gl) {
      glCtx = null;
      return null;
    }
    const prog = makeProgram(gl, VERT_FS, FRAG);
    const buf = fullscreenBuffer(gl);
    if (!prog || !buf) {
      glCtx = null;
      return null;
    }
    gl.useProgram(prog);
    glCtx = {
      canvas,
      gl,
      prog,
      buf,
      loc: {
        cols: gl.getUniformLocation(prog, "u_cols"),
        rows: gl.getUniformLocation(prog, "u_rows"),
        radius: gl.getUniformLocation(prog, "u_radius"),
        noise: gl.getUniformLocation(prog, "u_noise"),
        gran: gl.getUniformLocation(prog, "u_gran"),
        time: gl.getUniformLocation(prog, "u_time"),
        noiseSpeed: gl.getUniformLocation(prog, "u_noiseSpeed"),
        hollow: gl.getUniformLocation(prog, "u_hollow"),
        face: gl.getUniformLocation(prog, "u_face"),
        edge: gl.getUniformLocation(prog, "u_edge"),
        tl: gl.getUniformLocation(prog, "u_tl"),
        br: gl.getUniformLocation(prog, "u_br"),
        hasLines: gl.getUniformLocation(prog, "u_hasLines"),
      },
    };
    return glCtx;
  } catch {
    glCtx = null;
    return null;
  }
}

/** WebGL 是否可用（不可用则 GLPixelFrame 回退到 SVG 版 PixelFrame）。 */
export function glRendererAvailable(): boolean {
  return initGL() !== null;
}

export interface FrameParams {
  cols: number;
  rows: number;
  variant: "raised" | "sunken" | "flat";
  palette: PixelPalette;
  radius: number;
  noise: number;
  noiseGranularity: number;
  /** 低噪随时间游动的速度（每秒重掷次数）：0=静态；流式气泡传 2.5，面板传各自慢速值 */
  noiseSpeed?: number;
  /** 空心框：只画外圈 2px 环，中心透明（窗口收口框用） */
  hollow?: boolean;
}

/**
 * 渲染一帧像素帧到共享 GL 画布，并 blit 到目标 2D canvas。WebGL 不可用返回 false。
 * timeSec 仅在 params.noiseSpeed>0 时生效（低噪游动相位）。
 */
export function renderPixelFrameInto(
  target: HTMLCanvasElement,
  p: FrameParams,
  timeSec: number,
): boolean {
  const ctx = initGL();
  if (!ctx) return false;

  const { gl, canvas, loc } = ctx;
  const cols = Math.max(4, Math.round(p.cols));
  const rows = Math.max(4, Math.round(p.rows));

  if (canvas.width !== cols) canvas.width = cols;
  if (canvas.height !== rows) canvas.height = rows;
  gl.viewport(0, 0, cols, rows);

  const [fr, fg, fb] = hexToRgb01(p.palette.face);
  const [er, eg, eb] = hexToRgb01(p.palette.edge);
  // 顶左 / 底右 内线色（凹陷则对调），与 SVG 版一致
  const tl = p.variant === "sunken" ? p.palette.lo : p.palette.hi;
  const br = p.variant === "sunken" ? p.palette.hi : p.palette.lo;
  const [tr_, tg, tb] = hexToRgb01(tl);
  const [brr, brg, brb] = hexToRgb01(br);

  gl.useProgram(ctx.prog);
  gl.uniform1f(loc.cols, cols);
  gl.uniform1f(loc.rows, rows);
  gl.uniform1f(loc.radius, Math.max(0, Math.round(p.radius)));
  gl.uniform1f(loc.noise, p.noise);
  gl.uniform1f(loc.gran, Math.max(1, Math.round(p.noiseGranularity)));
  gl.uniform1f(loc.time, timeSec);
  gl.uniform1f(loc.noiseSpeed, Math.max(0, p.noiseSpeed ?? 0));
  gl.uniform1f(loc.hollow, p.hollow ? 1 : 0);
  gl.uniform3f(loc.face, fr, fg, fb);
  gl.uniform3f(loc.edge, er, eg, eb);
  gl.uniform3f(loc.tl, tr_, tg, tb);
  gl.uniform3f(loc.br, brr, brg, brb);
  gl.uniform1f(loc.hasLines, p.variant === "flat" ? 0 : 1);

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  drawFullscreen(gl, ctx.prog, ctx.buf);

  // blit 共享 GL 画布 → 本气泡自己的 2D canvas
  const t2d = target.getContext("2d");
  if (!t2d) return false;
  if (target.width !== cols) target.width = cols;
  if (target.height !== rows) target.height = rows;
  t2d.clearRect(0, 0, cols, rows);
  t2d.drawImage(canvas, 0, 0);
  return true;
}

// ---- 噪声场渲染（PixelNoiseField 的 GPU 路径）------------------------------

export interface NoiseFieldParams {
  cols: number;
  rows: number;
  /** 基色（主题淡色背景）[r,g,b] 0~1 */
  base: [number, number, number];
  /** 蓝场染色（accent）[r,g,b] 0~1 */
  accent: [number, number, number];
  /** 底噪灰度振幅（0~255 尺度，内部归一） */
  baseAmp: number;
  /** 底噪明暗变化速度（每秒） */
  shimmer: number;
  blueMax: number;
  blueGate: number;
  blueScale: number;
  blueDrift: number;
}

/** 惰性编译噪声场程序（共享同一个 GL 上下文与顶点缓冲）。 */
function initNoiseField(ctx: GL): NonNullable<GL["nf"]> | null {
  if (ctx.nf !== undefined) return ctx.nf;
  const prog = makeProgram(ctx.gl, VERT_FS, FRAG_NOISE_FIELD);
  if (!prog) {
    ctx.nf = null;
    return null;
  }
  const gl = ctx.gl;
  ctx.nf = {
    prog,
    loc: {
      rows: gl.getUniformLocation(prog, "u_rows"),
      time: gl.getUniformLocation(prog, "u_time"),
      base: gl.getUniformLocation(prog, "u_base"),
      accent: gl.getUniformLocation(prog, "u_accent"),
      baseAmp: gl.getUniformLocation(prog, "u_baseAmp"),
      shimmer: gl.getUniformLocation(prog, "u_shimmer"),
      blueMax: gl.getUniformLocation(prog, "u_blueMax"),
      blueGate: gl.getUniformLocation(prog, "u_blueGate"),
      blueScale: gl.getUniformLocation(prog, "u_blueScale"),
      blueDrift: gl.getUniformLocation(prog, "u_blueDrift"),
    },
  };
  return ctx.nf;
}

/**
 * 渲染一帧噪声场到共享 GL 画布并 blit 到目标 2D canvas。
 * GPU 一发着色器替代原 CPU 逐块循环（每帧十几万次 Math.sin → 归零）。
 * WebGL 不可用返回 false（调用方回退 CPU 路径）。
 */
export function renderNoiseFieldInto(
  target: HTMLCanvasElement,
  p: NoiseFieldParams,
  timeSec: number,
): boolean {
  const ctx = initGL();
  if (!ctx) return false;
  const nf = initNoiseField(ctx);
  if (!nf) return false;

  const { gl, canvas } = ctx;
  const cols = Math.max(1, Math.round(p.cols));
  const rows = Math.max(1, Math.round(p.rows));
  if (canvas.width !== cols) canvas.width = cols;
  if (canvas.height !== rows) canvas.height = rows;
  gl.viewport(0, 0, cols, rows);

  gl.useProgram(nf.prog);
  gl.uniform1f(nf.loc.rows, rows);
  gl.uniform1f(nf.loc.time, timeSec);
  gl.uniform3f(nf.loc.base, p.base[0], p.base[1], p.base[2]);
  gl.uniform3f(nf.loc.accent, p.accent[0], p.accent[1], p.accent[2]);
  gl.uniform1f(nf.loc.baseAmp, p.baseAmp / 255);
  gl.uniform1f(nf.loc.shimmer, p.shimmer);
  gl.uniform1f(nf.loc.blueMax, p.blueMax);
  gl.uniform1f(nf.loc.blueGate, p.blueGate);
  gl.uniform1f(nf.loc.blueScale, p.blueScale);
  gl.uniform1f(nf.loc.blueDrift, p.blueDrift);

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  drawFullscreen(gl, nf.prog, ctx.buf);

  const t2d = target.getContext("2d");
  if (!t2d) return false;
  if (target.width !== cols) target.width = cols;
  if (target.height !== rows) target.height = rows;
  t2d.clearRect(0, 0, cols, rows);
  t2d.drawImage(canvas, 0, 0);
  return true;
}

// ---- 全 app 唯一的动画 rAF：只有存在动画帧（游动底噪/流式气泡）时才转 ----

/** 动画统一帧率上限：慢速游动底噪用不着 60fps，封顶后常驻 CPU 开销降到 1/2~1/3。
 *  想更顺滑/更省电改这里即可喵（噪声重掷本身才 1~2.5Hz，24fps 的插值已足够平滑）。 */
const ANIM_FPS = 24;

type Tick = (timeSec: number) => void;
const animated = new Set<Tick>();
let rafId: number | null = null;
let lastTickAt = 0;

function loop(): void {
  rafId = animated.size > 0 ? requestAnimationFrame(loop) : null;
  const now = performance.now();
  if (now - lastTickAt < 1000 / ANIM_FPS) return; // 帧率封顶：不到点直接跳过
  lastTickAt = now;
  // 取模压小，保持 highp 精度稳定（长会话久开也不漂）
  const timeSec = (now / 1000) % 3600;
  animated.forEach((cb) => cb(timeSec));
}

/** 注册一个动画帧回调（每帧收到当前秒）。首个注册即启动 rAF。 */
export function addAnimatedFrame(cb: Tick): void {
  animated.add(cb);
  if (rafId === null) rafId = requestAnimationFrame(loop);
}

/** 注销动画帧回调；清空后停 rAF，回到零开销。 */
export function removeAnimatedFrame(cb: Tick): void {
  animated.delete(cb);
  if (animated.size === 0 && rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}
