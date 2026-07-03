/**
 * WebGL 通用小工具（各背景风格共用喵～）。
 * 只依赖 WebGL1，保证 Tauri（WebView2/Chromium）与各平台通吃。
 */

/** 全屏三角形顶点着色器（覆盖整个视口，比两三角形省一个顶点） */
export const VERT_FS = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("[backdrop] shader 编译失败:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/** 编译 + 链接一个 program（vs/fs 源码）。失败返回 null。 */
export function makeProgram(
  gl: WebGLRenderingContext,
  vsSrc: string,
  fsSrc: string,
): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("[backdrop] program 链接失败:", gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

/** 创建覆盖全屏的三角形 VBO */
export function fullscreenBuffer(gl: WebGLRenderingContext): WebGLBuffer | null {
  const buf = gl.createBuffer();
  if (!buf) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  return buf;
}

/** 用指定 program + 全屏 VBO 画一发全屏三角形（会自动绑定 a_pos） */
export function drawFullscreen(
  gl: WebGLRenderingContext,
  prog: WebGLProgram,
  buf: WebGLBuffer,
): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const loc = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export interface GLTarget {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

/**
 * 创建一张 RGBA8 纹理 + 绑定的 framebuffer（用于模拟类风格的 ping-pong）。
 * RGBA8 在 WebGL1 下必定可渲染，无需任何扩展 → 最兼容。
 */
export function createRGBA8Target(
  gl: WebGLRenderingContext,
  w: number,
  h: number,
  filter: number,
  data: Uint8Array | null = null,
): GLTarget | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  if (!fbo) {
    gl.deleteTexture(tex);
    return null;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
    return null;
  }
  return { tex, fbo };
}

/** GLSL 片段：把 [0,1] 浮点打包进 2×8bit（RG 或 BA），在 RGBA8 上模拟 16bit 精度 */
export const GLSL_PACK16 = `
vec2 pack16(float v){
  v = clamp(v, 0.0, 1.0);
  float x = v * 65535.0;
  float hi = floor(x / 256.0);
  float lo = x - hi * 256.0;
  return vec2(hi / 255.0, lo / 255.0);
}
float unpack16(vec2 c){
  return (c.x * 255.0 * 256.0 + c.y * 255.0) / 65535.0;
}
`;

/** JS 侧：把 [0,1] 打包成 2 字节（与 GLSL unpack16 对应），用于初始化模拟纹理 */
export function pack16(v: number): [number, number] {
  const x = Math.max(0, Math.min(1, v)) * 65535;
  const hi = Math.floor(x / 256);
  const lo = Math.floor(x - hi * 256);
  return [hi, lo];
}
