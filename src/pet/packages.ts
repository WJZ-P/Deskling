import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ANIMS, type AnimDef, type PetState } from "./animations";

export const BUILTIN_XUEBAO_PACKAGE_ID = "com.deskling.xuebao";
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

export interface PetPackageAppearance {
  type: PetAppearanceType;
  frame?: {
    width: number;
    height: number;
    scale: number;
  };
  layout?: {
    groundY: number;
  };
  entry?: string;
  animations: Record<string, PetPackageAnimation[]>;
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

export interface DeferredPuppetRuntime {
  type: "live2d-cubism" | "inochi2d";
  packageId: string;
  rendererAvailable: false;
  entryUrl: string;
  previewUrl: string | null;
  /** 接口已经识别该格式，但对应渲染器尚未随应用发布。 */
  unavailableReason: string;
  /** 共享窗口逻辑所需的占位尺寸；真正渲染器接入后由包内布局覆盖。 */
  geometry: SpriteGeometry;
}

export type PetAppearanceRuntime = SpritePetRuntime | DeferredPuppetRuntime;

export const DEFAULT_PET_GEOMETRY: SpriteGeometry = {
  frameWidth: 32,
  frameHeight: 32,
  scale: 6,
  groundY: 29,
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

/** 把后端已校验过的包内相对路径变成 Tauri asset URL。 */
export function petPackageAssetUrl(
  info: PetPackageInfo,
  relativePath: string,
): string | null {
  const safe = safePackagePath(relativePath);
  if (!safe || !info.rootPath) return null;
  const separator = info.rootPath.includes("\\") ? "\\" : "/";
  const root = info.rootPath.replace(/[\\/]+$/, "");
  const path = `${root}${separator}${safe.split("/").join(separator)}`;
  return convertFileSrc(path);
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
 * Cubism/Inochi2D 当前返回可识别但不可播放的描述符，由对应 Renderer 插件接管。
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

  if (
    (appearance.type === "live2d-cubism" || appearance.type === "inochi2d") &&
    appearance.entry
  ) {
    const entryUrl = petPackageAssetUrl(info, appearance.entry);
    if (!entryUrl) return null;
    return {
      type: appearance.type,
      packageId,
      rendererAvailable: false,
      entryUrl,
      previewUrl: getPetPackagePreview(packageId),
      unavailableReason:
        appearance.type === "live2d-cubism"
          ? "Live2D Cubism 渲染器受发布许可控制，当前构建未携带 Cubism Core"
          : "Inochi2D 渲染器接口已预留，运行时尚未接入",
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
