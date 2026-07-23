//! Deskling Pet Package v1：扫描、解析与校验桌宠资源包。
//!
//! 包本身是只读资源，用户对名字、人设与音色的修改由前端 PetInstance 单独保存，
//! 因此升级/重装资源包不会覆盖用户偏好。当前运行时支持 sprite-sheet；清单同时
//! 认识 live2d-cubism 与 inochi2d，等各自渲染器接入后不需要再迁移工坊包格式。

use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    path::{Component, Path, PathBuf},
};
use tauri::{path::BaseDirectory, AppHandle, Manager};

const MANIFEST_FILE: &str = "manifest.json";
const MANIFEST_MAX_BYTES: u64 = 256 * 1024;
const PROMPT_MAX_BYTES: u64 = 64 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageAuthor {
    pub name: String,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageLicense {
    pub name: String,
    #[serde(default)]
    pub file: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePreview {
    pub icon: String,
    #[serde(default)]
    pub cover: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpriteFrame {
    pub width: u32,
    pub height: u32,
    pub scale: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceLayout {
    pub ground_y: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageAnimation {
    pub src: String,
    pub frames: u32,
    #[serde(default)]
    pub sequence: Vec<u32>,
    pub fps: f32,
    #[serde(rename = "loop")]
    pub looping: bool,
    #[serde(default)]
    pub next: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageAppearance {
    #[serde(rename = "type")]
    pub appearance_type: String,
    /// sprite-sheet 的逐帧尺寸；Live2D 包不使用。
    #[serde(default)]
    pub frame: Option<SpriteFrame>,
    /// sprite-sheet 的落脚基线；Live2D 后续会扩展自己的锚点配置。
    #[serde(default)]
    pub layout: Option<AppearanceLayout>,
    /// Live2D 的 .model3.json 入口；sprite-sheet 不使用。
    #[serde(default)]
    pub entry: Option<String>,
    /// 语义状态 → 一个或多个动画变体。最少需要 idle，其余状态由前端安全回退。
    #[serde(default)]
    pub animations: BTreeMap<String, Vec<PackageAnimation>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePersona {
    pub prompt_file: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageVoice {
    pub pack_id: String,
    #[serde(default)]
    pub voice_id: i32,
    #[serde(default = "default_voice_speed")]
    pub speed: f32,
    #[serde(default)]
    pub enabled_by_default: bool,
}

fn default_voice_speed() -> f32 {
    1.0
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageComponents {
    pub appearance: PackageAppearance,
    #[serde(default)]
    pub persona: Option<PackagePersona>,
    #[serde(default)]
    pub voice: Option<PackageVoice>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetPackageManifest {
    pub schema_version: u32,
    pub kind: String,
    pub id: String,
    pub version: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub author: PackageAuthor,
    pub license: PackageLicense,
    #[serde(default)]
    pub min_deskling_version: Option<String>,
    pub preview: PackagePreview,
    pub components: PackageComponents,
}

/// 扫描结果：坏包同样返回，工坊/设置页以后可以直接展示具体原因。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetPackageInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub builtin: bool,
    pub valid: bool,
    pub runtime_supported: bool,
    pub root_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persona_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest: Option<PetPackageManifest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn strip_extended_prefix(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path
    }
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 {
        return Err("包 id 长度必须为 1-128".into());
    }
    if !id
        .bytes()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'.' | b'-' | b'_'))
    {
        return Err("包 id 只能包含小写字母、数字、点、横线和下划线".into());
    }
    if !id.as_bytes()[0].is_ascii_alphanumeric() {
        return Err("包 id 必须以小写字母或数字开头".into());
    }
    Ok(())
}

/// 所有资源引用统一使用便携的 `/` 相对路径；拒绝父目录、盘符、URL 与反斜杠。
fn validate_relative_path(spec: &str) -> Result<&Path, String> {
    if spec.is_empty() || spec.len() > 512 {
        return Err("资源路径长度必须为 1-512".into());
    }
    if spec.contains('\\') || spec.contains(':') || spec.starts_with('/') {
        return Err(format!("资源路径不是安全相对路径: {spec}"));
    }
    let path = Path::new(spec);
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(format!("资源路径不是安全相对路径: {spec}"));
    }
    Ok(path)
}

/// 文件必须实际落在包根目录内；canonicalize 后再检查可拦住指向包外的软链接。
fn validate_file(root: &Path, spec: &str, label: &str) -> Result<PathBuf, String> {
    let relative = validate_relative_path(spec)?;
    let candidate = root.join(relative);
    if !candidate.is_file() {
        return Err(format!("缺少{label}: {spec}"));
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("无法解析包目录: {error}"))?;
    let canonical_file = candidate
        .canonicalize()
        .map_err(|error| format!("无法解析{label} {spec}: {error}"))?;
    if !canonical_file.starts_with(&canonical_root) {
        return Err(format!("{label}越出包目录: {spec}"));
    }
    Ok(canonical_file)
}

fn validate_text(value: &str, label: &str, max_chars: usize) -> Result<(), String> {
    let size = value.chars().count();
    if size == 0 || size > max_chars {
        return Err(format!("{label}长度必须为 1-{max_chars}"));
    }
    Ok(())
}

fn validate_animation(
    root: &Path,
    state: &str,
    index: usize,
    animation: &PackageAnimation,
) -> Result<(), String> {
    validate_text(state, "动画状态名", 64)?;
    validate_file(
        root,
        &animation.src,
        &format!("动画 {state}[{index}] 的帧带"),
    )?;
    if animation.frames == 0 || animation.frames > 512 {
        return Err(format!("动画 {state}[{index}] 的 frames 必须为 1-512"));
    }
    if !animation.fps.is_finite() || animation.fps <= 0.0 || animation.fps > 120.0 {
        return Err(format!("动画 {state}[{index}] 的 fps 必须为 0-120"));
    }
    if animation
        .sequence
        .iter()
        .any(|frame| *frame >= animation.frames)
    {
        return Err(format!("动画 {state}[{index}] 的 sequence 含越界帧"));
    }
    if let Some(next) = &animation.next {
        validate_text(next, "动画 next 状态", 64)?;
    }
    Ok(())
}

fn validate_manifest(root: &Path, manifest: &PetPackageManifest) -> Result<Option<String>, String> {
    if manifest.schema_version != 1 {
        return Err(format!(
            "不支持 schemaVersion={}，当前只支持 1",
            manifest.schema_version
        ));
    }
    if manifest.kind != "pet" {
        return Err(format!("kind 必须为 pet，收到 {}", manifest.kind));
    }
    validate_id(&manifest.id)?;
    validate_text(&manifest.version, "版本号", 64)?;
    validate_text(&manifest.name, "桌宠名称", 80)?;
    validate_text(&manifest.author.name, "作者名", 120)?;
    validate_text(&manifest.license.name, "许可证名称", 120)?;
    validate_file(root, &manifest.preview.icon, "预览图标")?;
    if let Some(cover) = &manifest.preview.cover {
        validate_file(root, cover, "预览封面")?;
    }
    if let Some(file) = &manifest.license.file {
        validate_file(root, file, "许可证文件")?;
    }

    let appearance = &manifest.components.appearance;
    match appearance.appearance_type.as_str() {
        "sprite-sheet" => {
            let frame = appearance
                .frame
                .as_ref()
                .ok_or("sprite-sheet 缺少 frame 配置")?;
            if frame.width == 0 || frame.height == 0 || frame.width > 1024 || frame.height > 1024 {
                return Err("frame.width/height 必须为 1-1024".into());
            }
            if frame.scale == 0 || frame.scale > 16 {
                return Err("frame.scale 必须为 1-16".into());
            }
            let layout = appearance
                .layout
                .as_ref()
                .ok_or("sprite-sheet 缺少 layout 配置")?;
            if layout.ground_y > frame.height {
                return Err("layout.groundY 不能超过 frame.height".into());
            }
            if !appearance.animations.contains_key("idle") {
                return Err("sprite-sheet 至少需要 idle 动画".into());
            }
            for (state, variants) in &appearance.animations {
                if variants.is_empty() {
                    return Err(format!("动画状态 {state} 没有任何变体"));
                }
                for (index, animation) in variants.iter().enumerate() {
                    validate_animation(root, state, index, animation)?;
                }
            }
        }
        "live2d-cubism" => {
            let entry = appearance
                .entry
                .as_deref()
                .ok_or("live2d-cubism 缺少 entry")?;
            if !entry.to_ascii_lowercase().ends_with(".model3.json") {
                return Err("Live2D entry 必须指向 .model3.json".into());
            }
            validate_file(root, entry, "Live2D model3 入口")?;
        }
        "inochi2d" => {
            let entry = appearance.entry.as_deref().ok_or("inochi2d 缺少 entry")?;
            let lower = entry.to_ascii_lowercase();
            if !lower.ends_with(".inp") && !lower.ends_with(".inx") {
                return Err("Inochi2D entry 必须指向 .inp 或 .inx".into());
            }
            validate_file(root, entry, "Inochi2D 模型入口")?;
        }
        other => return Err(format!("未知外观类型: {other}")),
    }

    let prompt = if let Some(persona) = &manifest.components.persona {
        let path = validate_file(root, &persona.prompt_file, "人设 prompt")?;
        let size = std::fs::metadata(&path)
            .map_err(|error| format!("无法读取人设 prompt 元数据: {error}"))?
            .len();
        if size > PROMPT_MAX_BYTES {
            return Err(format!("人设 prompt 超过 {}KB", PROMPT_MAX_BYTES / 1024));
        }
        Some(
            std::fs::read_to_string(&path)
                .map_err(|error| format!("人设 prompt 不是有效 UTF-8: {error}"))?,
        )
    } else {
        None
    };

    if let Some(voice) = &manifest.components.voice {
        validate_id(&voice.pack_id).map_err(|error| format!("voice.packId 无效: {error}"))?;
        if !voice.speed.is_finite() || !(0.25..=4.0).contains(&voice.speed) {
            return Err("voice.speed 必须为 0.25-4.0".into());
        }
    }

    Ok(prompt)
}

fn read_manifest(path: &Path) -> Result<PetPackageManifest, String> {
    let size = std::fs::metadata(path)
        .map_err(|error| format!("无法读取 manifest 元数据: {error}"))?
        .len();
    if size > MANIFEST_MAX_BYTES {
        return Err(format!("manifest 超过 {}KB", MANIFEST_MAX_BYTES / 1024));
    }
    let source =
        std::fs::read_to_string(path).map_err(|error| format!("读取 manifest 失败: {error}"))?;
    serde_json::from_str(&source).map_err(|error| format!("manifest 解析失败: {error}"))
}

fn invalid_info(
    dir: &Path,
    builtin: bool,
    manifest: Option<PetPackageManifest>,
    error: String,
) -> PetPackageInfo {
    let fallback = dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("invalid-package")
        .to_string();
    PetPackageInfo {
        id: manifest
            .as_ref()
            .map(|item| item.id.clone())
            .unwrap_or_else(|| fallback.clone()),
        name: manifest
            .as_ref()
            .map(|item| item.name.clone())
            .unwrap_or(fallback),
        version: manifest
            .as_ref()
            .map(|item| item.version.clone())
            .unwrap_or_default(),
        builtin,
        valid: false,
        runtime_supported: false,
        root_path: strip_extended_prefix(dir.to_path_buf())
            .to_string_lossy()
            .into_owned(),
        persona_prompt: None,
        manifest,
        error: Some(error),
    }
}

fn scan_root(
    root: &Path,
    builtin: bool,
    seen_ids: &mut HashSet<String>,
    output: &mut Vec<PetPackageInfo>,
) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut dirs = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && path.join(MANIFEST_FILE).is_file())
        .collect::<Vec<_>>();
    dirs.sort();

    for dir in dirs {
        let manifest_path = dir.join(MANIFEST_FILE);
        let manifest = match read_manifest(&manifest_path) {
            Ok(manifest) => manifest,
            Err(error) => {
                output.push(invalid_info(&dir, builtin, None, error));
                continue;
            }
        };
        if seen_ids.contains(&manifest.id) {
            output.push(invalid_info(
                &dir,
                builtin,
                Some(manifest),
                "存在相同 id 的已加载资源包".into(),
            ));
            continue;
        }
        match validate_manifest(&dir, &manifest) {
            Ok(persona_prompt) => {
                seen_ids.insert(manifest.id.clone());
                let runtime_supported =
                    manifest.components.appearance.appearance_type == "sprite-sheet";
                output.push(PetPackageInfo {
                    id: manifest.id.clone(),
                    name: manifest.name.clone(),
                    version: manifest.version.clone(),
                    builtin,
                    valid: true,
                    runtime_supported,
                    root_path: strip_extended_prefix(dir.clone())
                        .to_string_lossy()
                        .into_owned(),
                    persona_prompt,
                    manifest: Some(manifest),
                    error: None,
                });
            }
            Err(error) => output.push(invalid_info(&dir, builtin, Some(manifest), error)),
        }
    }
}

fn builtin_root(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve("resources/pets", BaseDirectory::Resource)
        .ok()
        .map(strip_extended_prefix)
}

fn user_root(app: &AppHandle) -> Option<PathBuf> {
    let root = app.path().app_data_dir().ok()?.join("petpacks");
    let _ = std::fs::create_dir_all(&root);
    Some(strip_extended_prefix(root))
}

/// 扫描内置包和用户/工坊包。内置包先占用 id，用户包不能伪装覆盖内置资源。
#[tauri::command]
pub fn pet_packages(app: AppHandle) -> Vec<PetPackageInfo> {
    let mut packages = Vec::new();
    let mut seen_ids = HashSet::new();
    if let Some(root) = builtin_root(&app) {
        scan_root(&root, true, &mut seen_ids, &mut packages);
    }
    if let Some(root) = user_root(&app) {
        scan_root(&root, false, &mut seen_ids, &mut packages);
    }
    packages
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn test_dir(label: &str) -> PathBuf {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "deskling-pet-package-{label}-{}-{sequence}",
            std::process::id()
        ));
        std::fs::create_dir_all(root.join("appearance")).expect("应能创建测试目录");
        std::fs::create_dir_all(root.join("preview")).expect("应能创建预览目录");
        std::fs::write(root.join("appearance/idle.png"), b"not-decoded-here")
            .expect("应能写测试帧带");
        std::fs::write(root.join("preview/icon.png"), b"not-decoded-here").expect("应能写测试预览");
        root
    }

    fn manifest() -> PetPackageManifest {
        PetPackageManifest {
            schema_version: 1,
            kind: "pet".into(),
            id: "com.deskling.test".into(),
            version: "1.0.0".into(),
            name: "测试桌宠".into(),
            description: None,
            author: PackageAuthor {
                name: "Deskling".into(),
                url: None,
            },
            license: PackageLicense {
                name: "MIT".into(),
                file: None,
            },
            min_deskling_version: None,
            preview: PackagePreview {
                icon: "preview/icon.png".into(),
                cover: None,
            },
            components: PackageComponents {
                appearance: PackageAppearance {
                    appearance_type: "sprite-sheet".into(),
                    frame: Some(SpriteFrame {
                        width: 32,
                        height: 32,
                        scale: 6,
                    }),
                    layout: Some(AppearanceLayout { ground_y: 29 }),
                    entry: None,
                    animations: BTreeMap::from([(
                        "idle".into(),
                        vec![PackageAnimation {
                            src: "appearance/idle.png".into(),
                            frames: 12,
                            sequence: Vec::new(),
                            fps: 5.0,
                            looping: true,
                            next: None,
                        }],
                    )]),
                },
                persona: None,
                voice: None,
            },
        }
    }

    #[test]
    fn accepts_minimal_sprite_package() {
        let root = test_dir("valid");
        let result = validate_manifest(&root, &manifest());
        assert!(result.is_ok(), "合法包不应被拒绝: {result:?}");
        std::fs::remove_dir_all(root).expect("应能清理测试目录");
    }

    #[test]
    fn rejects_parent_directory_resource() {
        let root = test_dir("parent");
        let mut item = manifest();
        item.preview.icon = "../icon.png".into();
        let error = validate_manifest(&root, &item).expect_err("父目录路径必须被拒绝");
        assert!(error.contains("安全相对路径"));
        std::fs::remove_dir_all(root).expect("应能清理测试目录");
    }

    #[test]
    fn rejects_sequence_frame_out_of_bounds() {
        let root = test_dir("sequence");
        let mut item = manifest();
        item.components
            .appearance
            .animations
            .get_mut("idle")
            .expect("测试清单应有 idle")[0]
            .sequence = vec![0, 12];
        let error = validate_manifest(&root, &item).expect_err("越界帧必须被拒绝");
        assert!(error.contains("越界帧"));
        std::fs::remove_dir_all(root).expect("应能清理测试目录");
    }

    #[test]
    fn accepts_live2d_manifest_before_renderer_is_available() {
        let root = test_dir("live2d");
        std::fs::write(root.join("appearance/model.model3.json"), b"{}")
            .expect("应能写 Live2D 测试入口");
        let mut item = manifest();
        item.components.appearance.appearance_type = "live2d-cubism".into();
        item.components.appearance.frame = None;
        item.components.appearance.layout = None;
        item.components.appearance.entry = Some("appearance/model.model3.json".into());
        item.components.appearance.animations.clear();
        let result = validate_manifest(&root, &item);
        assert!(result.is_ok(), "Live2D 清单应可先进入包目录: {result:?}");
        std::fs::remove_dir_all(root).expect("应能清理测试目录");
    }

    #[test]
    fn accepts_open_inochi2d_manifest() {
        let root = test_dir("inochi2d");
        std::fs::write(root.join("appearance/model.inp"), b"test-inp")
            .expect("应能写 Inochi2D 测试入口");
        let mut item = manifest();
        item.components.appearance.appearance_type = "inochi2d".into();
        item.components.appearance.frame = None;
        item.components.appearance.layout = None;
        item.components.appearance.entry = Some("appearance/model.inp".into());
        item.components.appearance.animations.clear();
        let result = validate_manifest(&root, &item);
        assert!(result.is_ok(), "Inochi2D 清单应可进入包目录: {result:?}");
        std::fs::remove_dir_all(root).expect("应能清理测试目录");
    }

    #[test]
    fn validates_bundled_xuebao_package() {
        let root =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/pets/com.deskling.xuebao");
        let item = read_manifest(&root.join(MANIFEST_FILE)).expect("内置雪豹清单应能解析");
        let prompt = validate_manifest(&root, &item).expect("内置雪豹包应通过完整校验");
        assert_eq!(item.id, "com.deskling.xuebao");
        assert!(item.components.appearance.animations.len() >= 40);
        assert!(prompt.is_some_and(|value| value.contains("雪豹")));
    }
}
