import type { ThemeMode } from "../../../styles/theme";
import type { BackdropStyle } from "./types";
import { VERT_FS, drawFullscreen, fullscreenBuffer, hexToRgb01, makeProgram } from "./glUtils";

/**
 * 风格①「湍流 Turbulence」——原始流体风格。
 * simplex 噪声 domain warping：无限循环的有机流动青蓝雾/水流；鼠标局部扭曲 + 微光。
 */

// ============ 顶部可调参数喵 ============
const FLOW_SPEED = 0.02; // 流动速度
const WARP = 1.0; // 域扭曲强度（越大越湍流）
const NOISE_SCALE = 0.5; // 噪声空间频率
const INTENSITY = 0.75; // 整体对比强度
const MOUSE_STRENGTH = 0.05; // 鼠标对流体的扭曲强度
const MOUSE_RADIUS = 0.4; // 鼠标影响半径

// 配色（bg=底色，c1/c2/c3=流动色）
const COLORS: Record<ThemeMode, { bg: string; c1: string; c2: string; c3: string }> = {
  light: { bg: "#e9f6f6", c1: "#7dd1d4", c2: "#a8c8ff", c3: "#a6e6cf" },
  dark: { bg: "#0a1626", c1: "#2ea6ad", c2: "#2b5aa0", c3: "#1d7d86" },
};

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform vec3 u_bg, u_c1, u_c2, u_c3;
uniform float u_intensity, u_flow, u_warp, u_nscale, u_mstr, u_mrad;

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
  for(int i = 0; i < 5; i++){ v += a * snoise(p); p *= 2.0; a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 pc = uv - 0.5; pc.x *= aspect;

  vec2 toM = pc - u_mouse;
  float md = length(toM);
  float infl = exp(-md*md/(u_mrad*u_mrad));
  vec2 p = pc * u_nscale + toM * infl * u_mstr;

  float t = u_time * u_flow;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2,1.3) - t));
  vec2 r = vec2(
    fbm(p + u_warp*q + vec2(1.7,9.2) + 0.5*t),
    fbm(p + u_warp*q + vec2(8.3,2.8) - 0.5*t)
  );
  float f = fbm(p + u_warp*r);

  vec3 col = u_bg;
  col = mix(col, u_c1, clamp(0.5 + 0.5*f, 0.0, 1.0));
  col = mix(col, u_c2, clamp(0.5 + 0.5*q.x, 0.0, 1.0) * 0.55);
  col = mix(col, u_c3, clamp(length(r) * 0.5, 0.0, 1.0) * 0.5);
  col = mix(u_bg, col, u_intensity);
  col += u_c1 * infl * 0.10;

  gl_FragColor = vec4(col, 1.0);
}
`;

export const turbulence: BackdropStyle = {
  id: "turbulence",
  label: "湍流 · 流体雾",
  desc: "simplex 域扭曲的青蓝流体，混沌有机、鼠标扰动",
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
    gl.uniform3fv(U("u_c3"), hexToRgb01(c.c3));
    gl.uniform1f(U("u_intensity"), INTENSITY);
    gl.uniform1f(U("u_flow"), FLOW_SPEED);
    gl.uniform1f(U("u_warp"), WARP);
    gl.uniform1f(U("u_nscale"), NOISE_SCALE);
    gl.uniform1f(U("u_mstr"), MOUSE_STRENGTH);
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
