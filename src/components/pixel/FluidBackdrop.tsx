import { useEffect, useRef, useState, type CSSProperties } from "react";
import { styled } from "@linaria/react";
import type { ThemeMode } from "../../styles/theme";

/**
 * 主区域现代流体背景（WebGL shader 版，灵动感喵～）。
 *
 * 手法：全屏片元着色器，用 simplex 噪声做 domain warping（域扭曲），
 * 得到无限循环、有机流动的青蓝渐变雾/水流；光标附近对噪声域做局部扭曲 + 微光，
 * 让流体跟着鼠标「活」起来。
 *
 * 性能：降分辨率渲染（RENDER_SCALE）+ 帧率上限 + 失焦/隐藏暂停；GPU 跑，几乎零 CPU。
 * 兜底：无 WebGL 或系统「减少动态」→ 回退静态 CSS 渐变。
 *
 * 绝对铺满父级（父级需 position: relative），只作背景，不拦截事件。
 */

// ============ 顶部可调参数喵 ============
const RENDER_SCALE = 0.5; // 渲染分辨率倍率（<1 更省更柔）
const FPS_CAP = 60; // 帧率上限
const FLOW_SPEED = 0.02; // 流动速度（越大越快）
const WARP = 1.0; // 域扭曲强度（越大越湍流）
const NOISE_SCALE = 0.5; // 噪声空间频率（越大纹理越密）
const INTENSITY = 0.75; // 整体对比强度（适中）
const MOUSE_STRENGTH = 0.05 // 鼠标对流体的扭曲强度
const MOUSE_RADIUS = 0.4; // 鼠标影响半径
const MOUSE_EASE = 0.1; // 鼠标跟随平滑（越小越跟手）

// 配色（hex；bg=底色，c1/c2/c3=流动色）
const THEME_COLORS: Record<ThemeMode, { bg: string; c1: string; c2: string; c3: string }> = {
  light: { bg: "#e9f6f6", c1: "#7dd1d4", c2: "#a8c8ff", c3: "#a6e6cf" },
  dark: { bg: "#0a1626", c1: "#2ea6ad", c2: "#2b5aa0", c3: "#1d7d86" },
};

const hexToRgb01 = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const VERT = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

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

  // 鼠标局部扭曲
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
  col += u_c1 * infl * 0.10; // 光标微光

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function FluidBackdrop({ theme }: { theme: ThemeMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const gl = canvas.getContext("webgl", {
      antialias: false,
      depth: false,
      alpha: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      setFallback(true);
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      setFallback(true);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFallback(true);
      return;
    }
    gl.useProgram(prog);

    // 全屏三角形
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const locPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

    const U = (name: string) => gl.getUniformLocation(prog, name);
    const uRes = U("u_res");
    const uTime = U("u_time");
    const uMouse = U("u_mouse");
    const uIntensity = U("u_intensity");
    const uFlow = U("u_flow");
    const uWarp = U("u_warp");
    const uNScale = U("u_nscale");
    const uMStr = U("u_mstr");
    const uMRad = U("u_mrad");

    const cols = THEME_COLORS[theme];
    gl.uniform3fv(U("u_bg"), hexToRgb01(cols.bg));
    gl.uniform3fv(U("u_c1"), hexToRgb01(cols.c1));
    gl.uniform3fv(U("u_c2"), hexToRgb01(cols.c2));
    gl.uniform3fv(U("u_c3"), hexToRgb01(cols.c3));
    gl.uniform1f(uIntensity, INTENSITY);
    gl.uniform1f(uFlow, FLOW_SPEED);
    gl.uniform1f(uWarp, WARP);
    gl.uniform1f(uNScale, NOISE_SCALE);
    gl.uniform1f(uMStr, MOUSE_STRENGTH);
    gl.uniform1f(uMRad, MOUSE_RADIUS);

    let vw = 0;
    let vh = 0;
    const resize = () => {
      const w = Math.max(1, Math.floor(canvas.clientWidth * RENDER_SCALE));
      const h = Math.max(1, Math.floor(canvas.clientHeight * RENDER_SCALE));
      if (w === vw && h === vh) return;
      vw = w;
      vh = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // 鼠标（aspect-centered，y 轴翻转匹配 gl_FragCoord）
    const mouseTarget: [number, number] = [0, 0];
    const mouseCur: [number, number] = [0, 0];
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      const aspect = rect.width / rect.height;
      mouseTarget[0] = (nx - 0.5) * aspect;
      mouseTarget[1] = 1.0 - ny - 0.5;
    };
    if (!reduce) window.addEventListener("pointermove", onMove, { passive: true });

    const start = performance.now();
    const render = (now: number) => {
      mouseCur[0] += (mouseTarget[0] - mouseCur[0]) * MOUSE_EASE;
      mouseCur[1] += (mouseTarget[1] - mouseCur[1]) * MOUSE_EASE;
      gl.uniform2f(uMouse, mouseCur[0], mouseCur[1]);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let raf = 0;
    let timer = 0;
    if (reduce) {
      render(start); // 静态一帧
    } else {
      const tick = () => {
        raf = requestAnimationFrame((now) => {
          if (!document.hidden) render(now);
          timer = window.setTimeout(tick, 1000 / FPS_CAP);
        });
      };
      tick();
    }

    return () => {
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, [theme]);

  if (fallback) {
    const c = THEME_COLORS[theme];
    const style: CSSProperties = {
      background: `radial-gradient(120% 120% at 25% 20%, ${c.c1}55, transparent 55%),
        radial-gradient(120% 120% at 80% 70%, ${c.c2}44, transparent 55%),
        radial-gradient(100% 100% at 60% 90%, ${c.c3}44, transparent 55%),
        ${c.bg}`,
    };
    return <FallbackBox style={style} aria-hidden />;
  }

  return <Canvas ref={canvasRef} aria-hidden />;
}

const Canvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  z-index: 0;
  pointer-events: none;
`;

const FallbackBox = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
`;
