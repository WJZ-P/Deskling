import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ANIMS, type AnimDef, type PetState } from "./animations";

export const BUILTIN_XUEBAO_PACKAGE_ID = "com.deskling.xuebao";
/** 正式构建与开发模式都提供 Live2D 渲染器；Core 由安装包内置。 */
export const LIVE2D_RENDERER_ENABLED = true;
export type PetAppearanceType =
  | "sprite-sheet"
  | "live2d-cubism"
  | "inochi2d";

export interface PetPackageAuthor {
  name: string;
  url?: string;
}

export interface PetPackageLicense {
  name: string;
  file?: string;
}

export interface PetPackageAnimation {
  src: string;
  frames: number;
  sequence: number[];
  fps: number;
  loop: boolean;
  next?: string;
}

export interface PetPackageCubismMotion {
  /** model3.json 中的 Motion group；省略时可以只切 expression。 */
  group?: string;
  /** 省略时由引擎在该 group 内随机抽取。 */
  index?: number;
  expression?: string;
  /** 覆盖语义动画的收尾时长；主要给没有可靠结束信号的特殊动作使用。 */
  durationMs?: number;
  loop?: boolean;
  next?: string;
}

export interface PetPackageAppearance {
  type: PetAppearanceType;
  frame?: {
    width: number;
    height: number;
    scale: number;
  };
  layout?: {
    groundY: number;
    /** Live2D 模型相对“适配进画布”的二次缩放。 */
    modelScale?: number;
    offsetX?: number;
    offsetY?: number;
  };
  entry?: string;
  animations: Record<string, PetPackageAnimation[]>;
  /** Deskling 语义状态 → Cubism Motion/Expression 变体。 */
  motions?: Record<string, PetPackageCubismMotion[]>;
}

export interface PetPackageManifest {
  schemaVersion: 1;
  kind: "pet";
  id: string;
  version: string;
  name: string;
  description?: string;
  author: PetPackageAuthor;
  license: PetPackageLicense;
  minDesklingVersion?: string;
  preview: {
    icon: string;
    cover?: string;
  };
  components: {
    appearance: PetPackageAppearance;
    persona?: {
      promptFile: string;
    };
    voice?: {
      packId: string;
      voiceId: number;
      speed: number;
      enabledByDefault: boolean;
    };
  };
}

export interface PetPackageInfo {
  id: string;
  name: string;
  version: string;
  builtin: boolean;
  valid: boolean;
  runtimeSupported: boolean;
  rootPath: string;
  personaPrompt?: string;
  manifest?: PetPackageManifest;
  error?: string;
}

export interface SpriteGeometry {
  frameWidth: number;
  frameHeight: number;
  scale: number;
  groundY: number;
}

export interface SpritePetRuntime {
  type: "sprite-sheet";
  packageId: string;
  rendererAvailable: true;
  registry: Record<PetState, AnimDef[]>;
  geometry: SpriteGeometry;
  previewUrl: string | null;
}

export interface Live2DCubismRuntime {
  type: "live2d-cubism";
  packageId: string;
  rendererAvailable: boolean;
  entryUrl: string;
  previewUrl: string | null;
  geometry: SpriteGeometry;
  modelScale: number;
  offsetX: number;
  offsetY: number;
  motionMap: Partial<Record<PetState, PetPackageCubismMotion[]>>;
  unavailableReason?: string;
}

export interface DeferredPuppetRuntime {
  type: "inochi2d";
  packageId: string;
  rendererAvailable: false;
  entryUrl: string;
  previewUrl: string | null;
  /** 接口已经识别该格式，但对应渲染器尚未随应用发布。 */
  unavailableReason: string;
  /** 共享窗口逻辑所需的占位尺寸；真正渲染器接入后由包内布局覆盖。 */
  geometry: SpriteGeometry;
}

export type PetAppearanceRuntime =
  | SpritePetRuntime
  | Live2DCubismRuntime
  | DeferredPuppetRuntime;

export const DEFAULT_PET_GEOMETRY: SpriteGeometry = {
  frameWidth: 32,
  frameHeight: 32,
  scale: 6,
  groundY: 29,
};

export const DEFAULT_LIVE2D_GEOMETRY: SpriteGeometry = {
  frameWidth: 240,
  frameHeight: 240,
  scale: 1,
  groundY: 236,
};

let packageCatalog: PetPackageInfo[] = [];

/**
 * 每个前端窗口启动时从 Rust 扫一遍资源包。纯浏览器预览或后端异常时保留空目录，
 * 上层会继续使用 public/pet 的内置兼容资源，不让整个应用因扩展包损坏而起不来。
 */
export async function initPetPackages(): Promise<PetPackageInfo[]> {
  try {
    packageCatalog = await invoke<PetPackageInfo[]>("pet_packages");
  } catch (error) {
    console.warn("[pet-packages] 扫描失败，使用内置兼容资源:", error);
    packageCatalog = [];
  }
  return packageCatalog;
}

export function getPetPackages(): readonly PetPackageInfo[] {
  return packageCatalog;
}

export function getPetPackage(packageId: string): PetPackageInfo | null {
  return (
    packageCatalog.find(
      (item) => item.id === packageId && item.valid && item.manifest,
    ) ?? null
  );
}

function safePackagePath(relativePath: string): string | null {
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.includes(":") ||
    relativePath.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return relativePath;
}

/**
 * `convertFileSrc` 会把整条 Windows 路径编码进同一个 URL path segment，例如
 * `C:\pet\model.model3.json` 会变成 `C%3A%5Cpet%5Cmodel.model3.json`。
 * 普通 `<img>` 可以直接读取，但 Cubism 会用 `new URL(relative, model3Url)` 解析
 * moc/纹理；如果目录分隔符仍是 `%5C`/`%2F`，浏览器会把整个本地路径当成文件名，
 * 相对引用最终退化成 `asset.localhost/model.moc3`。
 *
 * 这里只恢复 URL 的 path 分隔符，盘符等内容仍保持编码，Tauri asset scope 也会
 * 继续在后端校验真实文件是否位于允许目录。这样同一 URL 既能直接加载，也保留了
 * Cubism 解析相对资源所需的目录层级。
 */
function preserveAssetUrlDirectories(url: string): string {
  return url.replace(/%5c/gi, "/").replace(/%2f/gi, "/");
}

/** 把后端已校验过的包内相对路径变成可继续解析相对引用的 Tauri asset URL。 */
export function petPackageAssetUrl(
  info: PetPackageInfo,
  relativePath: string,
): string | null {
  const safe = safePackagePath(relativePath);
  if (!safe || !info.rootPath) return null;
  const separator = info.rootPath.includes("\\") ? "\\" : "/";
  const root = info.rootPath.replace(/[\\/]+$/, "");
  const path = `${root}${separator}${safe.split("/").join(separator)}`;
  return preserveAssetUrlDirectories(convertFileSrc(path));
}

export function getPetPackagePreview(packageId: string): string | null {
  const info = getPetPackage(packageId);
  const icon = info?.manifest?.preview.icon;
  return info && icon ? petPackageAssetUrl(info, icon) : null;
}

function materializeAnimation(
  info: PetPackageInfo,
  source: PetPackageAnimation,
): AnimDef | null {
  const src = petPackageAssetUrl(info, source.src);
  if (!src) return null;
  const frames = Math.max(1, Math.floor(source.frames));
  return {
    src,
    frames,
    sequence:
      source.sequence.length > 0
        ? source.sequence
        : Array.from({ length: frames }, (_, index) => index),
    fps: source.fps,
    loop: source.loop,
    next: source.next,
  };
}

/**
 * 把包里的语义动画组接进现有状态机。扩展包只强制提供 idle；缺少的状态会用
 * 该包自己的 idle 画面按相应循环/一次性时长兜底，绝不会混入另一只桌宠的帧。
 */
export function getSpritePetRuntime(packageId: string): SpritePetRuntime | null {
  const info = getPetPackage(packageId);
  const appearance = info?.manifest?.components.appearance;
  if (
    !info ||
    !info.runtimeSupported ||
    appearance?.type !== "sprite-sheet" ||
    !appearance.frame ||
    !appearance.layout
  ) {
    return null;
  }

  const packageAnimations = appearance.animations;
  const idleSources = packageAnimations.idle
    ?.map((item) => materializeAnimation(info, item))
    .filter((item): item is AnimDef => item !== null);
  if (!idleSources?.length) return null;

  const registry = {} as Record<PetState, AnimDef[]>;
  for (const state of Object.keys(ANIMS) as PetState[]) {
    const declared = packageAnimations[state]
      ?.map((item) => materializeAnimation(info, item))
      .filter((item): item is AnimDef => item !== null);
    if (declared?.length) {
      registry[state] = declared;
      continue;
    }

    // 复用当前状态的控制语义（loop/next/fps），画面只取本包 idle。
    const semantics = ANIMS[state] as readonly AnimDef[];
    registry[state] = semantics.map((semantic, index) => {
      const idle = idleSources[index % idleSources.length];
      return {
        ...idle,
        fps: semantic.fps,
        loop: semantic.loop,
        next: semantic.next,
      };
    });
  }

  return {
    type: "sprite-sheet",
    packageId,
    rendererAvailable: true,
    registry,
    geometry: {
      frameWidth: appearance.frame.width,
      frameHeight: appearance.frame.height,
      scale: appearance.frame.scale,
      groundY: appearance.layout.groundY,
    },
    previewUrl: getPetPackagePreview(packageId),
  };
}

/**
 * 通用外观解析入口。PetWindow 只依赖这个判别联合，不再了解某一种模型格式。
 * 每一种外观都只在这里物化自己的运行时；窗口控制器不接触具体 SDK。
 */
export function getPetAppearanceRuntime(
  packageId: string,
): PetAppearanceRuntime | null {
  const info = getPetPackage(packageId);
  const appearance = info?.manifest?.components.appearance;
  if (!info || !appearance) return null;

  if (appearance.type === "sprite-sheet") {
    return getSpritePetRuntime(packageId);
  }

  if (appearance.type === "live2d-cubism" && appearance.entry) {
    const entryUrl = petPackageAssetUrl(info, appearance.entry);
    if (!entryUrl) return null;
    const frame = appearance.frame;
    const layout = appearance.layout;
    return {
      type: "live2d-cubism",
      packageId,
      rendererAvailable: LIVE2D_RENDERER_ENABLED,
      entryUrl,
      previewUrl: getPetPackagePreview(packageId),
      geometry: {
        frameWidth: frame?.width ?? DEFAULT_LIVE2D_GEOMETRY.frameWidth,
        frameHeight: frame?.height ?? DEFAULT_LIVE2D_GEOMETRY.frameHeight,
        scale: frame?.scale ?? DEFAULT_LIVE2D_GEOMETRY.scale,
        groundY: layout?.groundY ?? DEFAULT_LIVE2D_GEOMETRY.groundY,
      },
      modelScale: layout?.modelScale ?? 1,
      offsetX: layout?.offsetX ?? 0,
      offsetY: layout?.offsetY ?? 0,
      motionMap:
        (appearance.motions as Partial<
          Record<PetState, PetPackageCubismMotion[]>
        >) ?? {},
      unavailableReason: undefined,
    };
  }

  if (appearance.type === "inochi2d" && appearance.entry) {
    const entryUrl = petPackageAssetUrl(info, appearance.entry);
    if (!entryUrl) return null;
    return {
      type: "inochi2d",
      packageId,
      rendererAvailable: false,
      entryUrl,
      previewUrl: getPetPackagePreview(packageId),
      unavailableReason: "Inochi2D 渲染器接口已预留，运行时尚未接入",
      geometry: DEFAULT_PET_GEOMETRY,
    };
  }

  return null;
}

/** Tauri 后端不可用/内置包损坏时的无空白帧兼容运行时。 */
export function createFallbackSpriteRuntime(
  packageId = BUILTIN_XUEBAO_PACKAGE_ID,
): SpritePetRuntime {
  return {
    type: "sprite-sheet",
    packageId,
    rendererAvailable: true,
    registry: ANIMS as Record<PetState, AnimDef[]>,
    geometry: DEFAULT_PET_GEOMETRY,
    previewUrl: "/pet/xuebao.png",
  };
}
