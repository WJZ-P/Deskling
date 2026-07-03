import type { ThemeMode } from "../../../styles/theme";

/** 背景风格 id（新增风格时在这里加一个字面量喵） */
export type BackdropStyleId = "turbulence" | "curlFlow" | "reaction" | "cellular";

/**
 * 单个风格实例（已绑定到某个 WebGL 上下文 + 主题）。
 * 宿主组件负责 canvas/RAF/鼠标，风格只管：尺寸变了怎么办、每帧画什么、销毁清理。
 */
export interface BackdropRenderer {
  /** 视口尺寸变化（w/h 为 canvas 后备缓冲像素） */
  resize(w: number, h: number): void;
  /** 每帧渲染：timeSec=累计秒，dt=距上帧秒，mouse=居中/aspect 归一坐标（y 上正） */
  frame(timeSec: number, dt: number, mouse: readonly [number, number]): void;
  /** 释放 GL 资源 */
  dispose(): void;
}

/** 风格定义：元信息 + 工厂。create 失败（如着色器不支持）返回 null → 宿主回退。 */
export interface BackdropStyle {
  id: BackdropStyleId;
  label: string;
  desc: string;
  create(gl: WebGLRenderingContext, theme: ThemeMode): BackdropRenderer | null;
}
