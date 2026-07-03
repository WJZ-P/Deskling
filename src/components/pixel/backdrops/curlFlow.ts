import type { ThemeMode } from "../../../styles/theme";
import type { BackdropStyle } from "./types";
import { VERT_FS, drawFullscreen, fullscreenBuffer, hexToRgb01, makeProgram } from "./glUtils";

/**
 * 风格②「神经与数据流 · 卷曲噪声流场 Curl Noise Flow Field」。
 *
 * 手法：对 fbm 势场求旋度（curl）得到无散度流场 → 天然的丝滑漩涡流线；
 * 再沿流线做「线积分卷积（LIC）」采样高频噪声墨水 → 沿流方向拉出发光丝缕，
 * 像神经纤维/数据流一样流动。噪声墨水随时间相位滚动 → 数据在流动。
 * 鼠标附近注入旋转分量 + 微光 → 手一挥流场就绕着转。
 */

// ============ 顶部可调参数喵 ============
const STEPS = 12; // LIC 单侧步数（越大丝缕越长越顺，越贵）——编译期常量
const STEP = 0.09; // LIC 每步弧长
const FLOW_SCALE = 2.2; // 流场/画面空间尺度（越大越密）
const FLOW_LOWFREQ = 0.5; // 流场低频系数（curl 采样频率 = SCALE*LOWFREQ，越小漩涡越大）
const INK_FREQ = 3.0; // 墨水噪声频率（丝缕粗细）
const INK_SPEED = 0.55; // 墨水相位滚动速度（数据流动快慢）
const INTENSITY = 0.95; // 丝缕整体强度
const CORE_GLOW = 0.6; // 高亮「数据脉冲」核心强度
const MOUSE_SWIRL = 1.6; // 鼠标旋转注入强度
const MOUSE_RADIUS = 0.36; // 鼠标影响半径

const COLORS: Record<ThemeMode, { bg: string; c1: string; c2: string }> = {
  light: { bg: "#eaf6f6", c1: "#2f8f95", c2: "#12b5c4" },
  dark: { bg: "#071019", c1: "#26c6d6", c2: "#8af2ff" },
};

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform vec3 u_bg, u_c1, u_c2;
uniform float u_scale, u_lowfreq, u_inkfreq, u_inkspeed, u_intensity, u_core, u_mswirl, u_mrad;

vec3 mod289(vec3 x){ return x - floor(x*(1.0/289.0))*289.0; }
vec2 mod289(vec2 x){ return x - floor(x*(1.0/289.0))*289.0; }
vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 4; i++){ v += a * snoise(p); p *= 2.0; a *= 0.5; }
  return v;
}
// 势场旋度 → 无散度流向
vec2 curl(vec2 p){
  float e = 0.08;
  float a = fbm(p + vec2(0.0, e));
  float b = fbm(p - vec2(0.0, e));
  float c = fbm(p + vec2(e, 0.0));
  float d = fbm(p - vec2(e, 0.0));
  return vec2(a - b, -(c - d)) / (2.0 * e);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vnoise2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1.0,0.0)), c = hash(i+vec2(0.0,1.0)), d = hash(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 pc = uv - 0.5; pc.x *= aspect;
  vec2 p = pc * u_scale;

  vec2 toM = pc - u_mouse;
  float md = length(toM);
  float infl = exp(-md*md/(u_mrad*u_mrad));
  vec2 swirl = vec2(-toM.y, toM.x) * infl * u_mswirl;

  float phase = u_time * u_inkspeed;
  vec2 fpos = p;
  vec2 bpos = p;
  float sum = 0.0;
  float wsum = 0.0;
  for(int i = 0; i < ${STEPS}; i++){
    float w = 1.0 - float(i) / float(${STEPS});
    vec2 vf = normalize(curl(fpos * u_lowfreq) + swirl + 1e-5);
    fpos += vf * ${STEP.toFixed(4)};
    sum += vnoise2(fpos * u_inkfreq - phase) * w;
    vec2 vb = normalize(curl(bpos * u_lowfreq) + swirl + 1e-5);
    bpos -= vb * ${STEP.toFixed(4)};
    sum += vnoise2(bpos * u_inkfreq - phase) * w;
    wsum += 2.0 * w;
  }
  float lic = sum / wsum;

  float streak = smoothstep(0.36, 0.74, lic);
  float core = pow(streak, 3.0);
  float pulse = 0.5 + 0.5 * sin(lic * 22.0 - u_time * 3.0);

  vec3 col = u_bg;
  col = mix(col, u_c1, streak * u_intensity);
  col += u_c2 * core * (0.5 + 0.5 * pulse) * u_core;
  col += u_c1 * infl * 0.15;

  gl_FragColor = vec4(col, 1.0);
}
`;

export const curlFlow: BackdropStyle = {
  id: "curlFlow",
  label: "数据流 · 卷曲噪声流场",
  desc: "旋度流场 + 线积分卷积，发光神经/数据丝缕沿流流动",
  create(gl, theme) {
    const prog = makeProgram(gl, VERT_FS, FRAG);
    const buf = fullscreenBuffer(gl);
    if (!prog || !buf) return null;

    gl.useProgram(prog);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = U("u_res");
    const uTime = U("u_time");
    const uMouse = U("u_mouse");

    const c = COLORS[theme];
    gl.uniform3fv(U("u_bg"), hexToRgb01(c.bg));
    gl.uniform3fv(U("u_c1"), hexToRgb01(c.c1));
    gl.uniform3fv(U("u_c2"), hexToRgb01(c.c2));
    gl.uniform1f(U("u_scale"), FLOW_SCALE);
    gl.uniform1f(U("u_lowfreq"), FLOW_LOWFREQ);
    gl.uniform1f(U("u_inkfreq"), INK_FREQ);
    gl.uniform1f(U("u_inkspeed"), INK_SPEED);
    gl.uniform1f(U("u_intensity"), INTENSITY);
    gl.uniform1f(U("u_core"), CORE_GLOW);
    gl.uniform1f(U("u_mswirl"), MOUSE_SWIRL);
    gl.uniform1f(U("u_mrad"), MOUSE_RADIUS);

    return {
      resize(w, h) {
        gl.useProgram(prog);
        gl.uniform2f(uRes, w, h);
        gl.viewport(0, 0, w, h);
      },
      frame(t, _dt, mouse) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(prog);
        gl.uniform1f(uTime, t);
        gl.uniform2f(uMouse, mouse[0], mouse[1]);
        drawFullscreen(gl, prog, buf);
      },
      dispose() {
        gl.deleteProgram(prog);
        gl.deleteBuffer(buf);
      },
    };
  },
};
