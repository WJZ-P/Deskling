//! Deskling Pet Package v1：扫描、解析与校验桌宠资源包。
//!
//! 包本身是只读资源，用户对名字、人设与音色的修改由前端 PetInstance 单独保存，
//! 因此升级/重装资源包不会覆盖用户偏好。当前运行时支持 sprite-sheet 与
//! live2d-cubism（Core 随 Deskling 安装包提供）；inochi2d 保留格式入口。

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
    #[serde(default)]
    pub model_scale: Option<f32>,
    #[serde(default)]
    pub offset_x: Option<f32>,
    #[serde(default)]
    pub offset_y: Option<f32>,
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
pub struct CubismMotionBinding {
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub index: Option<u32>,
    #[serde(default)]
    pub expression: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u32>,
    #[serde(default, rename = "loop")]
    pub looping: Option<bool>,
    #[serde(default)]
    pub next: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageAppearance {
    #[serde(rename = "type")]
    pub appearance_type: String,
    /// sprite-sheet 的逐帧尺寸；Live2D 中表示透明画布的逻辑尺寸与显示倍数。
    #[serde(default)]
    pub frame: Option<SpriteFrame>,
    /// 统一落脚基线；Live2D 还可声明模型适配后的缩放与偏移。
    #[serde(default)]
    pub layout: Option<AppearanceLayout>,
    /// Live2D 的 .model3.json 入口；sprite-sheet 不使用。
    #[serde(default)]
    pub entry: Option<String>,
    /// 语义状态 → 一个或多个动画变体。最少需要 idle，其余状态由前端安全回退。
    #[serde(default)]
    pub animations: BTreeMap<String, Vec<PackageAnimation>>,
    /// Deskling 语义状态 → Cubism Motion/Expression 变体。
    #[serde(default)]
    pub motions: BTreeMap<String, Vec<CubismMotionBinding>>,
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

fn validate_frame_and_layout(frame: &SpriteFrame, layout: &AppearanceLayout) -> Result<(), String> {
    if frame.width == 0 || frame.height == 0 || frame.width > 1024 || frame.height > 1024 {
        return Err("frame.width/height 必须为 1-1024".into());
    }
    if frame.scale == 0 || frame.scale > 16 {
        return Err("frame.scale 必须为 1-16".into());
    }
    if layout.ground_y > frame.height {
        return Err("layout.groundY 不能超过 frame.height".into());
    }
    if let Some(scale) = layout.model_scale {
        if !scale.is_finite() || !(0.1..=4.0).contains(&scale) {
            return Err("layout.modelScale 必须为 0.1-4".into());
        }
    }
    for (label, value) in [
        ("layout.offsetX", layout.offset_x),
        ("layout.offsetY", layout.offset_y),
    ] {
        if value.is_some_and(|value| !value.is_finite() || value.abs() > 4096.0) {
            return Err(format!("{label} 必须为 -4096 到 4096 的有限数"));
        }
    }
    Ok(())
}

fn validate_cubism_motion_map(
    motions: &BTreeMap<String, Vec<CubismMotionBinding>>,
) -> Result<(), String> {
    for (state, variants) in motions {
        validate_text(state, "Live2D 动画状态名", 64)?;
        if variants.is_empty() {
            return Err(format!("Live2D 动画状态 {state} 没有任何变体"));
        }
        for (index, binding) in variants.iter().enumerate() {
            if binding.group.is_none() && binding.expression.is_none() {
                return Err(format!(
                    "Live2D 动画 {state}[{index}] 至少需要 group 或 expression"
                ));
            }
            if let Some(group) = &binding.group {
                validate_text(group, "Live2D Motion group", 128)?;
            } else if binding.index.is_some() {
                return Err(format!(
                    "Live2D 动画 {state}[{index}] 声明 index 时必须同时声明 group"
                ));
            }
            if let Some(expression) = &binding.expression {
                validate_text(expression, "Live2D expression", 128)?;
            }
            if let Some(duration) = binding.duration_ms {
                if !(50..=120_000).contains(&duration) {
                    return Err(format!(
                        "Live2D 动画 {state}[{index}] 的 durationMs 必须为 50-120000"
                    ));
                }
            }
            if let Some(next) = &binding.next {
                validate_text(next, "Live2D 动画 next 状态", 64)?;
            }
        }
    }
    Ok(())
}

fn validate_live2d_reference(
    root: &Path,
    entry: &str,
    reference: &str,
    label: &str,
) -> Result<(), String> {
    let relative = validate_relative_path(reference)?;
    let entry_parent = Path::new(entry).parent().unwrap_or_else(|| Path::new(""));
    let combined = entry_parent.join(relative);
    let combined = combined
        .to_str()
        .ok_or_else(|| format!("{label} 路径不是有效 UTF-8: {reference}"))?
        .replace('\\', "/");
    validate_file(root, &combined, label)?;
    Ok(())
}

fn validate_optional_live2d_file(
    root: &Path,
    entry: &str,
    references: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<(), String> {
    if let Some(value) = references.get(key) {
        let path = value
            .as_str()
            .ok_or_else(|| format!("Live2D FileReferences.{key} 必须是字符串"))?;
        validate_live2d_reference(root, entry, path, &format!("Live2D {key}"))?;
    }
    Ok(())
}

/// 在模型进入 WebView 前校验 model3 中所有标准文件引用，既能提前报缺件，也能拦住
/// `../`、绝对路径和 URL。创意工坊包不能借模型清单读取其他包或用户文件。
fn validate_live2d_model(root: &Path, entry: &str) -> Result<(), String> {
    let path = validate_file(root, entry, "Live2D model3 入口")?;
    let metadata =
        std::fs::metadata(&path).map_err(|error| format!("无法读取 Live2D model3: {error}"))?;
    if metadata.len() > MANIFEST_MAX_BYTES * 4 {
        return Err("Live2D model3.json 超过 1MB".into());
    }
    let source = std::fs::read_to_string(&path)
        .map_err(|error| format!("无法读取 Live2D model3: {error}"))?;
    let model: serde_json::Value = serde_json::from_str(&source)
        .map_err(|error| format!("Live2D model3.json 解析失败: {error}"))?;
    let references = model
        .get("FileReferences")
        .and_then(serde_json::Value::as_object)
        .ok_or("Live2D model3.json 缺少 FileReferences")?;

    let moc = references
        .get("Moc")
        .and_then(serde_json::Value::as_str)
        .ok_or("Live2D model3.json 缺少 FileReferences.Moc")?;
    validate_live2d_reference(root, entry, moc, "Live2D Moc")?;

    let textures = references
        .get("Textures")
        .and_then(serde_json::Value::as_array)
        .ok_or("Live2D model3.json 缺少 FileReferences.Textures")?;
    if textures.is_empty() {
        return Err("Live2D model3.json 至少需要一张纹理".into());
    }
    for (index, texture) in textures.iter().enumerate() {
        let texture = texture
            .as_str()
            .ok_or_else(|| format!("Live2D Textures[{index}] 必须是字符串"))?;
        validate_live2d_reference(root, entry, texture, &format!("Live2D 纹理[{index}]"))?;
    }

    for key in ["Physics", "Pose", "UserData", "DisplayInfo"] {
        validate_optional_live2d_file(root, entry, references, key)?;
    }

    if let Some(expressions) = references.get("Expressions") {
        let expressions = expressions
            .as_array()
            .ok_or("Live2D FileReferences.Expressions 必须是数组")?;
        for (index, expression) in expressions.iter().enumerate() {
            let file = expression
                .get("File")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| format!("Live2D Expressions[{index}] 缺少 File"))?;
            validate_live2d_reference(root, entry, file, &format!("Live2D 表情[{index}]"))?;
        }
    }

    if let Some(motions) = references.get("Motions") {
        let motions = motions
            .as_object()
            .ok_or("Live2D FileReferences.Motions 必须是对象")?;
        for (group, variants) in motions {
            let variants = variants
                .as_array()
                .ok_or_else(|| format!("Live2D Motions.{group} 必须是数组"))?;
            for (index, motion) in variants.iter().enumerate() {
                let file = motion
                    .get("File")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| format!("Live2D Motions.{group}[{index}] 缺少 File"))?;
                validate_live2d_reference(
                    root,
                    entry,
                    file,
                    &format!("Live2D 动作 {group}[{index}]"),
                )?;
                if let Some(sound) = motion.get("Sound") {
                    let sound = sound.as_str().ok_or_else(|| {
                        format!("Live2D Motions.{group}[{index}].Sound 必须是字符串")
                    })?;
                    validate_live2d_reference(
                        root,
                        entry,
                        sound,
                        &format!("Live2D 动作音频 {group}[{index}]"),
                    )?;
                }
            }
        }
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
            let layout = appearance
                .layout
                .as_ref()
                .ok_or("sprite-sheet 缺少 layout 配置")?;
            validate_frame_and_layout(frame, layout)?;
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
            match (&appearance.frame, &appearance.layout) {
                (Some(frame), Some(layout)) => validate_frame_and_layout(frame, layout)?,
                (None, None) => {}
                _ => return Err("Live2D 的 frame 与 layout 必须同时声明或同时省略".into()),
            }
            validate_cubism_motion_map(&appearance.motions)?;
            validate_live2d_model(root, entry)?;
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
                let runtime_supported = matches!(
                    manifest.components.appearance.appearance_type.as_str(),
                    "sprite-sheet" | "live2d-cubism"
                );
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
                    layout: Some(AppearanceLayout {
                        ground_y: 29,
                        model_scale: None,
                        offset_x: None,
                        offset_y: None,
                    }),
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
                    motions: BTreeMap::new(),
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
    fn accepts_complete_live2d_manifest() {
        let root = test_dir("live2d");
        std::fs::write(root.join("appearance/model.moc3"), b"moc").expect("应能写 Live2D 测试 moc");
        std::fs::write(root.join("appearance/texture.png"), b"texture")
            .expect("应能写 Live2D 测试纹理");
        std::fs::write(
            root.join("appearance/model.model3.json"),
            br#"{
                "Version": 3,
                "FileReferences": {
                    "Moc": "model.moc3",
                    "Textures": ["texture.png"]
                }
            }"#,
        )
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
    fn rejects_live2d_resource_outside_package() {
        let root = test_dir("live2d-parent");
        std::fs::write(
            root.join("appearance/model.model3.json"),
            br#"{
                "Version": 3,
                "FileReferences": {
                    "Moc": "../outside.moc3",
                    "Textures": ["texture.png"]
                }
            }"#,
        )
        .expect("应能写 Live2D 测试入口");
        std::fs::write(root.join("appearance/texture.png"), b"texture")
            .expect("应能写 Live2D 测试纹理");
        let mut item = manifest();
        item.components.appearance.appearance_type = "live2d-cubism".into();
        item.components.appearance.frame = None;
        item.components.appearance.layout = None;
        item.components.appearance.entry = Some("appearance/model.model3.json".into());
        item.components.appearance.animations.clear();
        let error = validate_manifest(&root, &item).expect_err("越出模型目录的引用必须被拒绝");
        assert!(error.contains("安全相对路径"));
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
