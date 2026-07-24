//! 语音输出（TTS）：语音包体系 + sherpa-onnx OfflineTts 本地合成 + cpal 播放。
//!
//! 语音包（Voice Pack）= 目录 + manifest.json（id/引擎家族/文件清单/音色表），
//! 两处根目录合并扫描：
//!   <安装目录>/resources/tts/     内置默认包（bundle.resources 打进安装包）
//!   <应用数据目录>/voicepacks/    用户/创意工坊安装的包（可写，卸载重装不丢）
//! 每只桌宠档案绑定一个 (packId, voiceId)——创意工坊上线即「下载落目录 + 重扫」。
//!
//! 管线：前端分句后逐句 tts_speak → 任务队列 → 合成线程（OfflineTts 常驻，
//! 换包才重载）→ 重采样到输出设备率 → 样本队列 → 播放线程（cpal 输出流）。
//! 合成第 N+1 句时第 N 句在播（流水线）；播放线程按队列有无声音广播
//! tts:state { playing } 事件，桌宠嘴型跟着真实声音开合。
//!
//! 打断（tts_stop）：清任务队列 + 清样本队列 + 竖 cancel 旗（合成回调检查，
//! 生成中途立刻弃稿）。新一轮对话 / 用户暂停 / 按住说话开麦都走它。

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SizedSample};
use serde::{Deserialize, Serialize};
use sherpa_onnx::{
    GenerationConfig, LinearResampler, OfflineTts, OfflineTtsConfig, OfflineTtsKokoroModelConfig,
    OfflineTtsMatchaModelConfig, OfflineTtsVitsModelConfig,
};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};

/// 播放停顿判定：样本队列排空后再等这么久才算「说完了」（ms）——
/// 句与句之间合成偶尔慢半拍，别让嘴型闪合又闪开
const PLAYING_HANGOVER_MS: u64 = 300;
const MANIFEST_MAX_BYTES: u64 = 256 * 1024;
const IMPORT_MAX_FILES: usize = 20_000;
const IMPORT_MAX_BYTES: u64 = 6 * 1024 * 1024 * 1024;
const ARCHIVE_MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;

// ==================== 语音包 manifest ====================

/// 音色条目（manifest.voices[]）：sid 对应模型内说话人编号。
/// beep 引擎的音色不指向模型说话人，而是用 wave/base/blipMs 三个参数
/// 描述一种电子拟声音色（其他引擎忽略这三个字段）
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceMeta {
    pub id: i32,
    pub name: String,
    #[serde(default)]
    pub lang: Option<String>,
    /// beep 波形：sine / square / triangle / chirp（缺省 sine）
    #[serde(default)]
    pub wave: Option<String>,
    /// beep 基频 Hz（音高锚点，缺省 700）
    #[serde(default)]
    pub base: Option<f32>,
    /// beep 单字时值 ms（缺省 80）
    #[serde(default)]
    pub blip_ms: Option<u32>,
}

/// 语音包 manifest（voicepacks/<pack>/manifest.json）。
/// files 的值支持逗号分隔多文件（如 kokoro 的双词典 / 三条规整 FST）
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackManifest {
    #[serde(default)]
    pub schema_version: Option<u32>,
    #[serde(default)]
    pub kind: Option<String>,
    pub id: String,
    pub name: String,
    /// 引擎家族：kokoro / vits（melo 同族）/ matcha —— 决定加载配置的形状
    pub engine: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    /// 角色名 → 包内相对路径（引擎家族决定有哪些键，见 load_engine）
    pub files: HashMap<String, String>,
    #[serde(default)]
    pub voices: Vec<VoiceMeta>,
}

/// 扫描结果条目（给设置页/人设面板的包列表；坏包也列出来标灰，方便排查）
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub voices: Vec<VoiceMeta>,
    pub version: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub size_bytes: u64,
    pub builtin: bool,
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 去掉 Windows 扩展长路径前缀（\\?\）。Tauri 路径解析可能返回带前缀的
/// 规范化路径：Rust 侧 exists() 无碍，但 sherpa-onnx 的 C++ 里再拼
/// "/phontab" 这类正斜杠子路径时，\\?\ 前缀禁用路径规范化 → FileExists
/// 全挂、创建引擎报 "Errors in config"。统一剥掉，喂给 C++ 的都是普通路径
fn strip_extended_prefix(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p
    }
}

fn validate_pack_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 {
        return Err("音色包 id 长度必须为 1-128".into());
    }
    if !id
        .bytes()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'.' | b'-' | b'_'))
    {
        return Err("音色包 id 只能包含小写字母、数字、点、横线和下划线".into());
    }
    if !id.as_bytes()[0].is_ascii_alphanumeric() {
        return Err("音色包 id 必须以小写字母或数字开头".into());
    }
    Ok(())
}

/// 模型清单只接受便携的包内相对路径。逗号分隔由调用方逐项处理。
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

fn required_roles(engine: &str) -> Result<&'static [&'static str], String> {
    match engine {
        "beep" => Ok(&[]),
        "kokoro" => Ok(&["model", "voices", "tokens"]),
        "vits" | "melo" => Ok(&["model", "tokens"]),
        "matcha" => Ok(&["acousticModel", "vocoder", "tokens"]),
        other => Err(format!("未知引擎家族: {other}")),
    }
}

fn validate_manifest(m: &PackManifest) -> Result<(), String> {
    if m.schema_version.is_some_and(|version| version != 1) {
        return Err("目前只支持 schemaVersion 1 的音色包".into());
    }
    if m.kind.as_deref().is_some_and(|kind| kind != "voice") {
        return Err("manifest.kind 必须为 voice".into());
    }
    validate_pack_id(&m.id)?;
    if m.name.trim().is_empty() || m.name.chars().count() > 128 {
        return Err("音色包名称长度必须为 1-128".into());
    }
    for role in required_roles(&m.engine)? {
        if !m.files.contains_key(*role) {
            return Err(format!("{} 引擎缺少 files.{role}", m.engine));
        }
    }
    if m.files.len() > 32 {
        return Err("files 条目过多（最多 32 项）".into());
    }
    if m.voices.len() > 4096 {
        return Err("音色数量过多（最多 4096 个）".into());
    }
    let mut voice_ids = HashSet::new();
    for voice in &m.voices {
        if voice.id < 0 || !voice_ids.insert(voice.id) {
            return Err(format!("音色 sid 非法或重复: {}", voice.id));
        }
        if voice.name.trim().is_empty() || voice.name.chars().count() > 128 {
            return Err(format!("音色 {} 的名称长度必须为 1-128", voice.id));
        }
    }
    Ok(())
}

/// 把 manifest 里逗号分隔的相对路径拼成引擎要的逗号分隔绝对路径
fn resolve_multi(dir: &Path, spec: &str) -> String {
    spec.split(',')
        .map(|p| dir.join(p.trim()).to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(",")
}

/// 校验 manifest 声明的文件/目录都在包里（逗号分隔逐个查）
fn validate_files(dir: &Path, m: &PackManifest) -> Result<(), String> {
    validate_manifest(m)?;
    let canonical_root = dir
        .canonicalize()
        .map_err(|error| format!("无法解析音色包目录: {error}"))?;
    for (role, spec) in &m.files {
        for part in spec.split(',') {
            let part = part.trim();
            let relative = validate_relative_path(part)?;
            let p = dir.join(relative);
            if !p.exists() {
                return Err(format!("缺文件 {role}: {part}"));
            }
            let canonical = p
                .canonicalize()
                .map_err(|error| format!("无法解析 {role} ({part}): {error}"))?;
            if !canonical.starts_with(&canonical_root) {
                return Err(format!("{role} 越出音色包目录: {part}"));
            }
        }
    }
    Ok(())
}

/// 按 manifest 装配引擎。files 角色约定：
///   kokoro: model / voices / tokens / dataDir(espeak) / dictDir(jieba) /
///           lexicon(多文件) / ruleFsts(多文件，可选)
///   vits(melo 同族): model / tokens / lexicon(可选) / dataDir(可选) / dictDir(可选)
///   matcha: acousticModel / vocoder / tokens / lexicon / dataDir / dictDir
fn load_engine(dir: &Path, m: &PackManifest) -> Result<OfflineTts, String> {
    validate_files(dir, m)?;
    let f = |k: &str| -> Option<String> { m.files.get(k).map(|spec| resolve_multi(dir, spec)) };
    let mut config = OfflineTtsConfig::default();
    match m.engine.as_str() {
        "kokoro" => {
            config.model.kokoro = OfflineTtsKokoroModelConfig {
                model: f("model"),
                voices: f("voices"),
                tokens: f("tokens"),
                data_dir: f("dataDir"),
                dict_dir: f("dictDir"),
                lexicon: f("lexicon"),
                ..Default::default()
            };
        }
        "vits" | "melo" => {
            config.model.vits = OfflineTtsVitsModelConfig {
                model: f("model"),
                tokens: f("tokens"),
                lexicon: f("lexicon"),
                data_dir: f("dataDir"),
                dict_dir: f("dictDir"),
                ..Default::default()
            };
        }
        "matcha" => {
            config.model.matcha = OfflineTtsMatchaModelConfig {
                acoustic_model: f("acousticModel"),
                vocoder: f("vocoder"),
                tokens: f("tokens"),
                lexicon: f("lexicon"),
                data_dir: f("dataDir"),
                dict_dir: f("dictDir"),
                ..Default::default()
            };
        }
        other => return Err(format!("未知引擎家族: {other}")),
    }
    // 中文数字/日期/电话念法规整（kokoro 包自带三条 FST；没有就不挂）
    config.rule_fsts = f("ruleFsts");
    config.model.num_threads = 2;
    OfflineTts::create(&config)
        .ok_or_else(|| format!("加载语音包 {} 失败（目录: {}）", m.id, dir.display()))
}

// ==================== 包扫描 ====================

/// 内置包根目录（打包资源）；开发 = src-tauri/resources/tts
fn builtin_root(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve("resources/tts", BaseDirectory::Resource)
        .ok()
        .map(strip_extended_prefix)
}

/// 用户/工坊包根目录（应用数据目录，可写；不存在时创建好等着工坊落包）
fn user_root(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("voicepacks");
    let _ = std::fs::create_dir_all(&dir);
    Some(strip_extended_prefix(dir))
}

fn user_root_result(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录: {error}"))?
        .join("voicepacks");
    std::fs::create_dir_all(&dir).map_err(|error| format!("无法创建音色包目录: {error}"))?;
    Ok(strip_extended_prefix(dir))
}

fn read_manifest(path: &Path) -> Result<PackManifest, String> {
    let metadata =
        std::fs::metadata(path).map_err(|error| format!("读取 manifest 失败: {error}"))?;
    if metadata.len() > MANIFEST_MAX_BYTES {
        return Err("manifest.json 过大（上限 256KB）".into());
    }
    let source =
        std::fs::read_to_string(path).map_err(|error| format!("读取 manifest 失败: {error}"))?;
    serde_json::from_str(&source).map_err(|error| format!("manifest 解析失败: {error}"))
}

fn directory_size(root: &Path) -> u64 {
    let mut total = 0u64;
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() {
                total = total.saturating_add(entry.metadata().map(|meta| meta.len()).unwrap_or(0));
            }
        }
    }
    total
}

/// 扫一个根目录：每个含 manifest.json 的子目录是一个包。
/// 解析/校验失败的包也进列表（valid=false + 原因），前端灰显可排查
fn scan_root(
    root: &Path,
    builtin: bool,
    out: &mut Vec<PackInfo>,
    cache: &mut HashMap<String, (PathBuf, PackManifest)>,
) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for e in entries.flatten() {
        let dir = e.path();
        if e.file_type().is_ok_and(|kind| kind.is_symlink()) {
            continue;
        }
        let mf_path = dir.join("manifest.json");
        if !mf_path.is_file() {
            continue;
        }
        let dir_name = e.file_name().to_string_lossy().into_owned();
        let size_bytes = directory_size(&dir);
        let parsed = read_manifest(&mf_path).and_then(|m| validate_files(&dir, &m).map(|_| m));
        match parsed {
            Ok(m) => {
                out.push(PackInfo {
                    id: m.id.clone(),
                    name: m.name.clone(),
                    engine: m.engine.clone(),
                    voices: m.voices.clone(),
                    version: m.version.clone(),
                    author: m.author.clone(),
                    license: m.license.clone(),
                    size_bytes,
                    builtin,
                    valid: true,
                    error: None,
                });
                cache.insert(m.id.clone(), (dir, m));
            }
            Err(err) => out.push(PackInfo {
                id: dir_name.clone(),
                name: dir_name,
                engine: String::new(),
                voices: Vec::new(),
                version: None,
                author: None,
                license: None,
                size_bytes,
                builtin,
                valid: false,
                error: Some(err),
            }),
        }
    }
}

/// 扫全部根目录，刷新 id → (目录, manifest) 缓存，返回包列表
fn scan_all(
    app: &AppHandle,
    cache: &mut HashMap<String, (PathBuf, PackManifest)>,
) -> Vec<PackInfo> {
    let mut out = Vec::new();
    cache.clear();
    if let Some(root) = builtin_root(app) {
        scan_root(&root, true, &mut out, cache);
    }
    if let Some(root) = user_root(app) {
        scan_root(&root, false, &mut out, cache);
    }
    out.sort_by(|a, b| {
        b.builtin
            .cmp(&a.builtin)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out
}

// ==================== 用户导入 ====================

#[derive(Default)]
struct TreeInventory {
    files: Vec<PathBuf>,
    dirs: Vec<PathBuf>,
    bytes: u64,
}

fn relative_spec(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| format!("资源不在模型目录内: {}", path.display()))?;
    let mut parts = Vec::new();
    for part in relative.components() {
        let Component::Normal(value) = part else {
            return Err(format!("资源路径不安全: {}", relative.display()));
        };
        let value = value
            .to_str()
            .ok_or_else(|| format!("资源路径不是有效 UTF-8: {}", relative.display()))?;
        parts.push(value);
    }
    let spec = parts.join("/");
    validate_relative_path(&spec)?;
    Ok(spec)
}

fn inventory_tree(root: &Path) -> Result<TreeInventory, String> {
    let mut inventory = TreeInventory::default();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(&dir)
            .map_err(|error| format!("读取模型目录 {} 失败: {error}", dir.display()))?
        {
            let entry = entry.map_err(|error| format!("读取模型目录条目失败: {error}"))?;
            let kind = entry
                .file_type()
                .map_err(|error| format!("读取资源类型失败: {error}"))?;
            if kind.is_symlink() {
                return Err(format!(
                    "模型目录不能包含软链接或目录链接: {}",
                    entry.path().display()
                ));
            }
            if kind.is_dir() {
                inventory.dirs.push(entry.path());
                pending.push(entry.path());
            } else if kind.is_file() {
                inventory.files.push(entry.path());
                inventory.bytes = inventory
                    .bytes
                    .checked_add(
                        entry
                            .metadata()
                            .map_err(|error| format!("读取资源大小失败: {error}"))?
                            .len(),
                    )
                    .ok_or_else(|| "模型目录大小溢出".to_string())?;
                if inventory.files.len() > IMPORT_MAX_FILES {
                    return Err(format!("模型文件过多（上限 {IMPORT_MAX_FILES} 个）"));
                }
                if inventory.bytes > IMPORT_MAX_BYTES {
                    return Err("模型目录过大（上限 6GB）".into());
                }
            } else {
                return Err(format!("不支持的资源类型: {}", entry.path().display()));
            }
        }
    }
    Ok(inventory)
}

fn copy_model_tree(source: &Path, destination: &Path) -> Result<(), String> {
    let kind = std::fs::symlink_metadata(source)
        .map_err(|error| format!("读取模型目录失败: {error}"))?
        .file_type();
    if !kind.is_dir() || kind.is_symlink() {
        return Err("请选择真实的模型目录，不能选择目录链接".into());
    }
    let inventory = inventory_tree(source)?;
    let canonical_source = source
        .canonicalize()
        .map_err(|error| format!("无法解析模型目录: {error}"))?;
    std::fs::create_dir_all(destination)
        .map_err(|error| format!("创建导入暂存目录失败: {error}"))?;
    for directory in &inventory.dirs {
        let relative = directory
            .strip_prefix(source)
            .map_err(|_| "模型子目录越出来源目录".to_string())?;
        std::fs::create_dir_all(destination.join(relative))
            .map_err(|error| format!("创建模型子目录失败: {error}"))?;
    }
    let mut copied_bytes = 0u64;
    for file in &inventory.files {
        if std::fs::symlink_metadata(file)
            .map_err(|error| format!("读取模型文件失败: {error}"))?
            .file_type()
            .is_symlink()
        {
            return Err(format!("复制期间发现文件链接: {}", file.display()));
        }
        let canonical_file = file
            .canonicalize()
            .map_err(|error| format!("无法解析模型文件: {error}"))?;
        if !canonical_file.starts_with(&canonical_source) {
            return Err(format!("模型文件越出来源目录: {}", file.display()));
        }
        let relative = file
            .strip_prefix(source)
            .map_err(|_| "模型文件越出来源目录".to_string())?;
        let target = destination.join(relative);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建模型文件目录失败: {error}"))?;
        }
        let copied = std::fs::copy(file, &target)
            .map_err(|error| format!("复制模型文件 {} 失败: {error}", relative.display()))?;
        copied_bytes = copied_bytes
            .checked_add(copied)
            .ok_or_else(|| "复制模型大小溢出".to_string())?;
        if copied_bytes > IMPORT_MAX_BYTES {
            return Err("模型目录在复制期间超过 6GB 上限".into());
        }
    }
    Ok(())
}

fn extract_zip(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = std::fs::metadata(source).map_err(|error| format!("读取压缩包失败: {error}"))?;
    if metadata.len() > ARCHIVE_MAX_BYTES {
        return Err("压缩包过大（上限 4GB）".into());
    }
    let input = std::fs::File::open(source).map_err(|error| format!("打开压缩包失败: {error}"))?;
    let mut archive =
        zip::ZipArchive::new(input).map_err(|error| format!("ZIP 解析失败: {error}"))?;
    if archive.len() > IMPORT_MAX_FILES {
        return Err(format!("压缩包文件过多（上限 {IMPORT_MAX_FILES} 个）"));
    }
    if archive
        .decompressed_size()
        .is_some_and(|size| size > IMPORT_MAX_BYTES as u128)
    {
        return Err("压缩包展开后过大（上限 6GB）".into());
    }
    std::fs::create_dir_all(destination).map_err(|error| format!("创建解压目录失败: {error}"))?;

    let mut expanded = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("读取 ZIP 第 {} 项失败: {error}", index + 1))?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(format!("ZIP 不能包含软链接: {}", entry.name()));
        }
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| format!("ZIP 含越界路径: {}", entry.name()))?
            .to_path_buf();
        let spec = relative
            .components()
            .map(|part| match part {
                Component::Normal(value) => value
                    .to_str()
                    .map(str::to_owned)
                    .ok_or_else(|| "ZIP 路径不是有效 UTF-8".to_string()),
                _ => Err("ZIP 含不安全路径".to_string()),
            })
            .collect::<Result<Vec<_>, _>>()?
            .join("/");
        validate_relative_path(&spec)?;
        let target = destination.join(&relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|error| format!("创建解压目录失败: {error}"))?;
            continue;
        }
        expanded = expanded
            .checked_add(entry.size())
            .ok_or_else(|| "压缩包展开大小溢出".to_string())?;
        if expanded > IMPORT_MAX_BYTES {
            return Err("压缩包展开后过大（上限 6GB）".into());
        }
        let parent = target
            .parent()
            .ok_or_else(|| "ZIP 文件缺少父目录".to_string())?;
        std::fs::create_dir_all(parent).map_err(|error| format!("创建解压目录失败: {error}"))?;
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|error| format!("创建解压文件 {} 失败: {error}", relative.display()))?;
        let copied = std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("解压 {} 失败: {error}", relative.display()))?;
        if copied != entry.size() {
            return Err(format!("ZIP 文件大小不一致: {}", relative.display()));
        }
    }
    Ok(())
}

fn find_manifest_root(root: &Path) -> Result<Option<PathBuf>, String> {
    if root.join("manifest.json").is_file() {
        return Ok(Some(root.to_path_buf()));
    }
    let inventory = inventory_tree(root)?;
    let mut matches = inventory
        .files
        .into_iter()
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("manifest.json"))
                && path
                    .strip_prefix(root)
                    .map(|relative| relative.components().count() <= 4)
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    if matches.len() > 1 {
        return Err("压缩包内有多个 manifest.json，无法判断要安装哪一个音色包".into());
    }
    Ok(matches
        .pop()
        .and_then(|path| path.parent().map(Path::to_path_buf)))
}

fn file_name_lower(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn choose_file<F>(files: &[PathBuf], mut predicate: F) -> Option<PathBuf>
where
    F: FnMut(&str) -> bool,
{
    let mut matches = files
        .iter()
        .filter_map(|path| {
            let name = file_name_lower(path);
            predicate(&name).then(|| path.clone())
        })
        .collect::<Vec<_>>();
    matches.sort_by_key(|path| path.components().count());
    matches.into_iter().next()
}

fn choose_model(files: &[PathBuf], excluded_words: &[&str]) -> Option<PathBuf> {
    let mut matches = files
        .iter()
        .filter(|path| {
            let name = file_name_lower(path);
            name.ends_with(".onnx") && !excluded_words.iter().any(|word| name.contains(word))
        })
        .cloned()
        .collect::<Vec<_>>();
    matches.sort_by_key(|path| {
        let name = file_name_lower(path);
        let preference = if name.contains("int8") {
            0
        } else if name == "model.onnx" {
            1
        } else {
            2
        };
        (preference, path.components().count(), name)
    });
    matches.into_iter().next()
}

fn choose_directory(dirs: &[PathBuf], names: &[&str]) -> Option<PathBuf> {
    let mut matches = dirs
        .iter()
        .filter(|path| {
            let name = file_name_lower(path);
            names.iter().any(|candidate| name == *candidate)
        })
        .cloned()
        .collect::<Vec<_>>();
    matches.sort_by_key(|path| path.components().count());
    matches.into_iter().next()
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut separator = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            separator = false;
        } else if !separator && !slug.is_empty() {
            slug.push('-');
            separator = true;
        }
        if slug.len() >= 72 {
            break;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "voice".into()
    } else {
        slug
    }
}

fn available_local_id(name: &str, existing_ids: &HashSet<String>) -> String {
    let base = format!("local.{}", slugify(name));
    if !existing_ids.contains(&base) {
        return base;
    }
    for suffix in 2..10_000 {
        let candidate = format!("{base}.{suffix}");
        if !existing_ids.contains(&candidate) {
            return candidate;
        }
    }
    format!(
        "{base}.{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    )
}

fn detect_raw_manifest(
    root: &Path,
    display_name: &str,
    existing_ids: &HashSet<String>,
) -> Result<PackManifest, String> {
    let inventory = inventory_tree(root)?;
    let tokens = choose_file(&inventory.files, |name| name == "tokens.txt")
        .ok_or("没有找到 tokens.txt；请选择完整的 sherpa-onnx TTS 模型目录")?;
    let voices = choose_file(&inventory.files, |name| {
        name == "voices.bin" || (name.contains("voice") && name.ends_with(".bin"))
    });
    let vocoder = choose_file(&inventory.files, |name| {
        name.ends_with(".onnx")
            && (name.contains("vocoder") || name.contains("hifigan") || name.contains("vocos"))
    });
    let acoustic = choose_file(&inventory.files, |name| {
        name.ends_with(".onnx")
            && (name.contains("matcha") || name.contains("acoustic"))
            && !name.contains("vocoder")
    });

    let (engine, model, acoustic_model, vocoder_model) = if voices.is_some() {
        (
            "kokoro",
            Some(
                choose_model(
                    &inventory.files,
                    &["vocoder", "hifigan", "vocos", "acoustic", "matcha"],
                )
                .ok_or("Kokoro 目录里没有找到主 ONNX 模型")?,
            ),
            None,
            None,
        )
    } else if let (Some(acoustic), Some(vocoder)) = (acoustic, vocoder) {
        ("matcha", None, Some(acoustic), Some(vocoder))
    } else {
        (
            "vits",
            Some(
                choose_model(
                    &inventory.files,
                    &["vocoder", "hifigan", "vocos", "acoustic", "matcha"],
                )
                .ok_or("没有找到可用的 ONNX TTS 模型")?,
            ),
            None,
            None,
        )
    };

    let mut files = HashMap::new();
    files.insert("tokens".into(), relative_spec(root, &tokens)?);
    if let Some(model) = model {
        files.insert("model".into(), relative_spec(root, &model)?);
    }
    if let Some(voices) = voices {
        files.insert("voices".into(), relative_spec(root, &voices)?);
    }
    if let Some(acoustic) = acoustic_model {
        files.insert("acousticModel".into(), relative_spec(root, &acoustic)?);
    }
    if let Some(vocoder) = vocoder_model {
        files.insert("vocoder".into(), relative_spec(root, &vocoder)?);
    }
    if let Some(data_dir) = choose_directory(&inventory.dirs, &["espeak-ng-data", "espeak_data"]) {
        files.insert("dataDir".into(), relative_spec(root, &data_dir)?);
    }
    if let Some(dict_dir) = choose_directory(&inventory.dirs, &["dict", "jieba"]) {
        files.insert("dictDir".into(), relative_spec(root, &dict_dir)?);
    }
    let mut lexicons = inventory
        .files
        .iter()
        .filter(|path| {
            let name = file_name_lower(path);
            name.starts_with("lexicon") && name.ends_with(".txt")
        })
        .map(|path| relative_spec(root, path))
        .collect::<Result<Vec<_>, _>>()?;
    lexicons.sort();
    if !lexicons.is_empty() {
        files.insert("lexicon".into(), lexicons.join(","));
    }
    let mut rule_fsts = inventory
        .files
        .iter()
        .filter(|path| file_name_lower(path).ends_with(".fst"))
        .map(|path| relative_spec(root, path))
        .collect::<Result<Vec<_>, _>>()?;
    rule_fsts.sort();
    if !rule_fsts.is_empty() {
        files.insert("ruleFsts".into(), rule_fsts.join(","));
    }

    Ok(PackManifest {
        schema_version: Some(1),
        kind: Some("voice".into()),
        id: available_local_id(display_name, existing_ids),
        name: display_name.to_string(),
        engine: engine.into(),
        version: None,
        author: None,
        license: None,
        files,
        voices: Vec::new(),
    })
}

fn write_manifest(root: &Path, manifest: &PackManifest) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("生成 manifest 失败: {error}"))?;
    if json.len() as u64 > MANIFEST_MAX_BYTES {
        return Err("生成的 manifest.json 过大".into());
    }
    let path = root.join("manifest.json");
    let mut output = std::fs::File::create(&path)
        .map_err(|error| format!("写入 manifest.json 失败: {error}"))?;
    output
        .write_all(&json)
        .map_err(|error| format!("写入 manifest.json 失败: {error}"))?;
    output
        .sync_all()
        .map_err(|error| format!("同步 manifest.json 失败: {error}"))
}

struct ImportCleanup(PathBuf);

impl Drop for ImportCleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn import_voice_pack(
    app: &AppHandle,
    source_path: &str,
    existing_ids: &HashSet<String>,
) -> Result<String, String> {
    let source = strip_extended_prefix(
        PathBuf::from(source_path)
            .canonicalize()
            .map_err(|error| format!("无法读取所选路径: {error}"))?,
    );
    let metadata =
        std::fs::symlink_metadata(&source).map_err(|error| format!("无法读取所选路径: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("不能从软链接或目录链接导入模型".into());
    }

    let user_root = user_root_result(app)?;
    let canonical_user_root = user_root
        .canonicalize()
        .map_err(|error| format!("无法解析音色包目录: {error}"))?;
    if metadata.is_dir() && canonical_user_root.starts_with(&source) {
        return Err("不能选择包含 Deskling 音色包安装目录的上级目录".into());
    }
    let nonce = format!(
        ".import-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let operation = user_root.join(nonce);
    std::fs::create_dir(&operation).map_err(|error| format!("创建导入任务失败: {error}"))?;
    let _cleanup = ImportCleanup(operation.clone());
    let payload = operation.join("payload");

    if metadata.is_dir() {
        copy_model_tree(&source, &payload)?;
    } else if metadata.is_file()
        && source
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| {
                value.eq_ignore_ascii_case("zip") || value.eq_ignore_ascii_case("deskling-voice")
            })
    {
        extract_zip(&source, &payload)?;
    } else {
        return Err("请选择模型目录、.zip 或 .deskling-voice 音色包".into());
    }

    let manifest_root = find_manifest_root(&payload)?;
    let package_root = manifest_root.as_deref().unwrap_or(&payload);
    let display_name = source
        .file_stem()
        .or_else(|| source.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("导入音色");
    let manifest_path = package_root.join("manifest.json");
    let had_manifest = manifest_path.is_file();
    let mut manifest = if had_manifest {
        read_manifest(&manifest_path)?
    } else {
        detect_raw_manifest(package_root, display_name, existing_ids)?
    };
    if manifest.engine == "beep" {
        return Err("导入功能只安装真实 TTS 模型；电子拟声无需外部模型".into());
    }
    if existing_ids.contains(&manifest.id) {
        return Err(format!(
            "音色包 {} 已存在，请先卸载旧版本再导入",
            manifest.id
        ));
    }
    validate_files(package_root, &manifest)?;

    // 真正创建一次引擎，避免把“文件看起来齐全但模型不兼容”的坏包安装进去。
    let engine = load_engine(package_root, &manifest)?;
    let speaker_count = engine.num_speakers().max(1);
    if speaker_count > 4096 {
        return Err(format!(
            "模型声明了过多说话人（{speaker_count}，上限 4096）"
        ));
    }
    if manifest.voices.is_empty() {
        manifest.voices = (0..speaker_count)
            .map(|id| VoiceMeta {
                id,
                name: if speaker_count == 1 {
                    "默认音色".into()
                } else {
                    format!("音色 {}", id + 1)
                },
                ..Default::default()
            })
            .collect();
    } else if manifest
        .voices
        .iter()
        .any(|voice| voice.id >= speaker_count)
    {
        return Err(format!(
            "manifest 声明了超出模型范围的 sid（模型共有 {speaker_count} 个音色）"
        ));
    }
    drop(engine);
    if !had_manifest || manifest.voices.is_empty() || !manifest_path.is_file() {
        write_manifest(package_root, &manifest)?;
    } else {
        // 有清单但 voices 原本为空时，上方已自动补全，也需要持久化。
        let original = read_manifest(&manifest_path)?;
        if original.voices.is_empty() {
            write_manifest(package_root, &manifest)?;
        }
    }

    let destination = user_root.join(&manifest.id);
    if destination.exists() {
        return Err(format!("音色包安装目录已存在: {}", manifest.id));
    }
    std::fs::rename(package_root, &destination)
        .map_err(|error| format!("完成音色包安装失败: {error}"))?;
    Ok(manifest.id)
}

// ==================== 运行时（合成 + 播放双线程） ====================

type SampleQueue = Arc<Mutex<VecDeque<f32>>>;
type JobQueue = Arc<Mutex<VecDeque<SpeakJob>>>;

/// 一句待合成任务（前端分句后逐句提交）
struct SpeakJob {
    text: String,
    pack_id: String,
    dir: PathBuf,
    manifest: PackManifest,
    voice: i32,
    speed: f32,
}

// ==================== beep 引擎：程序化电子拟声 ====================
// 不用任何模型：逐字生成一声短促 blip（动森 / Undertale 式对话音）。文字内容
// 由气泡承载，声音只表达「在说话」的存在感与语气。零延迟、零体积、零违和。
//
// 「像说话不像音乐」的三根支柱：
//   · 音高连续不落音阶：句内自然下倾（说话的重音衰落）+ 每字随机抖动，
//     字内还带喵弧——是「抑扬」不是「旋律」；
//   · 音节拱形包络（起-峰-落）而非拨弦衰减（快起+长衰 = 乐器音的形状）；
//     字头垫一层几毫秒的噪声瞬态当「辅音」，有了子音-母音的言语结构；
//   · 全部参数逐字随机（时钟播种）——每次发声都不重样，模拟真实环境。
// 「像素味」：整段过 lo-fi 压碎（采样保持降频 + 粗位深量化），蒸汽波毛边。
// 标点即语气：逗号短停 / 句号长停 / 问号句尾上扬 / 叹号整句加能量。

// ---- beep 可调旋钮（改手感就动这里）----
/// 字间发音间隔（秒）：每声 blip 之间随机取 [MIN, MAX]
const BEEP_GAP_MIN_S: f32 = 0.03;
const BEEP_GAP_MAX_S: f32 = 0.05;
/// 每字音高随机抖动幅度（± 半音）
const BEEP_JITTER_SEMI: f32 = 2.5;
/// 每字时值随机抖动（± 比例，0.22 = ±22%）
const BEEP_DUR_JITTER: f32 = 0.22;
/// 喵弧强度：voc 音色字内音高中段上扬的比例（0.35 = +35%）
const BEEP_MEOW_BEND: f32 = 0.35;
/// 标点停顿（秒），叠加在字间隔之上：句号/叹号/问号 与 逗号/顿号
const BEEP_PAUSE_LONG_S: f32 = 0.1;
const BEEP_PAUSE_SHORT_S: f32 = 0.05;

/// 轻量 xorshift32 随机源：每次合成用系统时钟纳秒播种 → 每段发声都不重样
struct BeepRng(u32);

impl BeepRng {
    fn seeded() -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0x9E37_79B9);
        Self(nanos | 1)
    }

    fn next(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }

    /// [0, 1) 均匀
    fn unit(&mut self) -> f32 {
        (self.next() >> 8) as f32 / 16_777_216.0
    }

    /// [lo, hi) 均匀
    fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.unit()
    }
}

/// lo-fi 压碎：采样保持降到 ~11kHz + ~5bit 量化——beep 的像素身份认同，
/// 天生自带（与 fx 的 bit 预设同款手法，这里是引擎内置）
fn crush(samples: &mut [f32], rate: u32) {
    let hold = ((rate as f32 / 11_025.0).round().max(1.0)) as usize;
    let mut held = 0.0_f32;
    for (i, s) in samples.iter_mut().enumerate() {
        if i % hold == 0 {
            held = *s;
        }
        *s = (held * 22.0).round() / 22.0;
    }
}

/// 双二阶带通滤波器（RBJ cookbook）：voc 音色的「元音共鸣腔」。
/// 人声「呃呃呃」的秘密就是共振峰——嗓音源（富含谐波的锯齿脉冲）过两个
/// 共鸣峰（F1/F2），出来的就是元音；Undertale 式对话音的人声感即由此来
struct Bandpass {
    b0: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Bandpass {
    fn new(freq: f32, q: f32, rate: u32) -> Self {
        let w0 = std::f32::consts::TAU * freq / rate as f32;
        let alpha = w0.sin() / (2.0 * q);
        let a0 = 1.0 + alpha;
        Self {
            b0: alpha / a0,
            a1: -2.0 * w0.cos() / a0,
            a2: (1.0 - alpha) / a0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * (x - self.x2) - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }

    /// 平滑改中心频率（保留滤波状态）：音节内共振峰滑动（喵的口型变化）用
    fn retune(&mut self, freq: f32, q: f32, rate: u32) {
        let w0 = std::f32::consts::TAU * freq / rate as f32;
        let alpha = w0.sin() / (2.0 * q);
        let a0 = 1.0 + alpha;
        self.b0 = alpha / a0;
        self.a1 = -2.0 * w0.cos() / a0;
        self.a2 = (1.0 - alpha) / a0;
    }
}

/// 元音表（F1/F2 共振峰频率 Hz）：每个字按哈希挑一个 → 呃呃啊哦的含糊嘟囔
const VOWELS: [(f32, f32); 5] = [
    (600.0, 1100.0), // 呃 ə
    (750.0, 1200.0), // 啊 a
    (450.0, 850.0),  // 哦 o
    (420.0, 1600.0), // 诶 e
    (350.0, 800.0),  // 呜 u
];

/// 一个字符在 beep 里的角色
enum Beep {
    Blip,
    PauseLong,  // 。！？：句末大停顿
    PauseShort, // ，、；：句读小停顿
    Gap,        // 空白：极短气口
}
fn classify(c: char) -> Beep {
    if c.is_alphanumeric() {
        Beep::Blip
    } else if "。！？!?.…～~".contains(c) {
        Beep::PauseLong
    } else if "，、；;：:,".contains(c) {
        Beep::PauseShort
    } else {
        Beep::Gap
    }
}

/// 把一段文字合成为电子拟声 PCM（单声道，直接按输出设备率 rate 生成，免重采样）。
/// speed = 语速倍率（缩放时值/停顿）。人设面板试听走这条（按文字念）；
/// 实时聊天叨叨走 beep_chatter_unit（不念文字）
fn synth_beep(text: &str, v: &VoiceMeta, speed: f32, rate: u32) -> Vec<f32> {
    let speed = if speed > 0.1 { speed } else { 1.0 };
    let base = v.base.unwrap_or(520.0);
    let wave = v.wave.as_deref().unwrap_or("square");
    let blip_ms = v.blip_ms.unwrap_or(62) as f32 / speed;
    // 语气：含叹号整句加能量；问号结尾则句尾上扬
    let energy = if text.contains('！') || text.contains('!') {
        1.18
    } else {
        1.0
    };
    let rising = text.trim_end().ends_with(['？', '?']);
    let total = text
        .chars()
        .filter(|c| matches!(classify(*c), Beep::Blip))
        .count()
        .max(1);

    let ms_to_n = |ms: f32| ((ms / 1000.0) * rate as f32) as usize;
    let mut rng = BeepRng::seeded();
    let mut out: Vec<f32> = Vec::new();
    let mut idx = 0usize;
    for c in text.chars() {
        match classify(c) {
            Beep::Blip => {
                // 说话的抑扬（半音域）：句内自然下倾 +2 → -3（陈述句的重音衰落），
                // 每字随机抖动 ±BEEP_JITTER_SEMI——连续音高不落音阶，是嘟囔不是旋律
                let progress = idx as f32 / total as f32;
                let mut semi = 2.0 - 5.0 * progress;
                semi += rng.range(-BEEP_JITTER_SEMI, BEEP_JITTER_SEMI);
                // 问句句尾上扬：最后 1/4 逐字抬到 +5 半音
                if rising && progress > 0.75 {
                    semi += 5.0 * (progress - 0.75) / 0.25;
                }
                let f0 = base * 2f32.powf(semi / 12.0);
                // 时值随机抖动：不打拍子
                let dur = blip_ms * rng.range(1.0 - BEEP_DUR_JITTER, 1.0 + BEEP_DUR_JITTER);
                let seed = rng.next();
                append_blip(&mut out, f0, wave, dur, energy, rate, seed);
                // 字间发音间隔：[BEEP_GAP_MIN_S, BEEP_GAP_MAX_S] 随机（随语速缩放）
                let gap_ms = rng.range(BEEP_GAP_MIN_S, BEEP_GAP_MAX_S) * 1000.0 / speed;
                out.extend(std::iter::repeat(0.0).take(ms_to_n(gap_ms)));
                idx += 1;
            }
            Beep::PauseLong => {
                out.extend(std::iter::repeat(0.0).take(ms_to_n(BEEP_PAUSE_LONG_S * 1000.0 / speed)))
            }
            Beep::PauseShort => out
                .extend(std::iter::repeat(0.0).take(ms_to_n(BEEP_PAUSE_SHORT_S * 1000.0 / speed))),
            Beep::Gap => out.extend(std::iter::repeat(0.0).take(ms_to_n(24.0 / speed))),
        }
    }
    // 像素压碎收尾：连字头的噪声辅音一起碎，蒸汽波毛边
    crush(&mut out, rate);
    out
}

/// 生成一声 blip（一个「音节」）追加进缓冲：
///   字头 ~4ms 噪声瞬态当辅音 → 音体走拱形包络（起-峰-落，音节的形状，
///   不是拨弦的快起长衰）+ 字内 12% 下滑音（自然音节的音高走向）。
///   voc 音色（人声感主打）：锯齿嗓音源 → F1/F2 元音共鸣腔（按字挑元音）
///   → tanh 软限幅，出来是含糊的「呃呃啊哦」而非乐器音
fn append_blip(
    out: &mut Vec<f32>,
    f0: f32,
    wave: &str,
    dur_ms: f32,
    energy: f32,
    rate: u32,
    seed: u32,
) {
    // 辅音：短噪声瞬态（LCG 伪随机，种子逐字随机 → 每声「辅音」都不重样）。
    // voc 收轻——猫叫的起音是软的「咪」不是硬的「咔」
    let noise_amp = if wave == "voc" { 0.1 } else { 0.22 };
    let mut rng = seed | 1;
    let n_noise = ((0.004 * rate as f32) as usize).max(1);
    for i in 0..n_noise {
        rng = rng.wrapping_mul(1664525).wrapping_add(1013904223);
        let white = ((rng >> 16) & 0xffff) as f32 / 32768.0 - 1.0;
        let decay = 1.0 - i as f32 / n_noise as f32;
        out.push(white * decay * noise_amp * energy);
    }
    // 母音：拱形包络音体。频率逐样本积分（cycles 累加），支持音高弧/扫频
    let dur_s = dur_ms / 1000.0;
    let n = ((dur_s * rate as f32) as usize).max(1);
    let dt = 1.0 / rate as f32;
    let pi = std::f32::consts::PI;
    if wave == "voc" {
        // 元音逐字随机挑：呃啊哦诶呜换着嘟囔
        let (f1_end, f2_end) = VOWELS[((seed >> 4) % VOWELS.len() as u32) as usize];
        let mut bp1 = Bandpass::new(330.0, 8.0, rate);
        let mut bp2 = Bandpass::new(1850.0, 10.0, rate);
        let mut cycles = 0.0_f32;
        for i in 0..n {
            let tn = i as f32 / n as f32;
            // 喵弧包络：起快落慢（tn^0.75 前倾峰值），软起软收
            let env = (pi * tn.powf(0.75)).sin().max(0.0).powf(0.7);
            // 音高走「喵」的弧：中段上扬 BEEP_MEOW_BEND 再落回——猫叫的音高轮廓
            let f = f0 * (1.0 + BEEP_MEOW_BEND * (pi * tn).sin());
            cycles += f * dt;
            let saw = 2.0 * cycles.fract() - 1.0;
            // 共振峰滑动 = 口型在动：F1 拱形张合（闭→开→闭），
            // F2 从「咦」的高位滑落到元音位 →「咦啊呜」的喵口型
            let f1 = 330.0 + (f1_end - 330.0) * (pi * tn.powf(0.8)).sin().max(0.0);
            let f2 = 1850.0 + (f2_end - 1850.0) * tn.powf(0.55);
            bp1.retune(f1, 8.0, rate);
            bp2.retune(f2.max(500.0), 10.0, rate);
            let y = bp1.run(saw) + 0.55 * bp2.run(saw);
            out.push((y * 3.2).tanh() * env * energy * 0.62);
        }
        return;
    }
    let mut cycles = 0.0_f32;
    for i in 0..n {
        let tn = i as f32 / n as f32;
        // 音节拱形：sin^0.65 起-峰-落（说话的音节轮廓）
        let env = (pi * tn).sin().max(0.0).powf(0.65);
        // chirp 保持上滑鸟鸣；其余波形也带一点喵弧（中段上扬 15% 落回）
        let f = if wave == "chirp" {
            f0 * (1.0 + 0.25 * tn)
        } else {
            f0 * (1.0 + 0.15 * (pi * tn).sin())
        };
        cycles += f * dt;
        let frac = cycles.fract();
        let raw = match wave {
            "square" => {
                if frac < 0.5 {
                    0.55
                } else {
                    -0.55
                }
            }
            "triangle" => 4.0 * (frac - 0.5).abs() - 1.0,
            _ => (std::f32::consts::TAU * cycles).sin(), // sine / chirp
        };
        out.push(raw * env * energy * 0.5);
    }
}

/// beep 自主叨叨的一声：随机音高（base ± BEEP_JITTER_SEMI 半音）+ 随机时值
/// 的一个 blip，尾随一段随机气口。用于「电子拟声」的实时聊天叨叨——不念具体
/// 文字，只在 AI 输出期间持续发声、随播放线程按队列有无声广播嘴型
fn beep_chatter_unit(out: &mut Vec<f32>, v: &VoiceMeta, rate: u32, rng: &mut BeepRng) {
    let base = v.base.unwrap_or(190.0);
    let wave = v.wave.as_deref().unwrap_or("voc");
    let blip_ms = v.blip_ms.unwrap_or(112) as f32;
    let semi = rng.range(-BEEP_JITTER_SEMI, BEEP_JITTER_SEMI);
    let f0 = base * 2f32.powf(semi / 12.0);
    let dur = blip_ms * rng.range(1.0 - BEEP_DUR_JITTER, 1.0 + BEEP_DUR_JITTER);
    let start = out.len();
    append_blip(out, f0, wave, dur, 1.0, rate, rng.next());
    // 字间气口：叨叨的疏密（同一套 GAP 旋钮）
    let gap_ms = rng.range(BEEP_GAP_MIN_S, BEEP_GAP_MAX_S) * 1000.0;
    let gap_n = ((gap_ms / 1000.0) * rate as f32) as usize;
    out.extend(std::iter::repeat(0.0).take(gap_n));
    crush(&mut out[start..], rate); // 像素毛边（母音段，气口是静音无所谓）
}

/// 常驻运行时：首次 tts_speak 时拉起，之后复用；换输出设备时整套退役重建
struct TtsRuntime {
    jobs: JobQueue,
    samples: SampleQueue,
    /// 竖起后合成/播放两线程自行退出（换设备时旧运行时体面谢幕）
    shutdown: Arc<AtomicBool>,
    /// 本运行时打开的输出设备名（"" = 系统默认），换设备判定用
    device: String,
    playback_thread: std::thread::JoinHandle<()>,
    synth_thread: std::thread::JoinHandle<()>,
}

/// TTS 全局状态：懒启动的运行时 + 包缓存 + 打断旗 + 叨叨音色。
/// chatter = Some(音色) 时合成线程持续吐 beep 叨叨（电子拟声实时聊天用），
/// tts_stop 清空它即收声
#[derive(Default)]
pub struct TtsState {
    runtime: Mutex<Option<TtsRuntime>>,
    packs: Mutex<HashMap<String, (PathBuf, PackManifest)>>,
    /// 安装/卸载与发声取包互斥，避免卸载 ONNX 时下一句又把同一模型加载回来。
    pack_ops: Mutex<()>,
    cancel: Arc<AtomicBool>,
    chatter: Arc<Mutex<Option<VoiceMeta>>>,
}

/// 软件音量（0.0~1.0）：设置页可调，播放输出按它线性缩放。用 AtomicU32 存 f32
/// 位模式，音频回调无锁读取。默认 1.0（= 0x3F80_0000 的 f32 位模式）。
static TTS_VOLUME: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0x3F80_0000);

/// 建输出流：把样本队列（单声道、设备率）逐帧铺到所有声道；队列空则静音。
/// 每帧按软件音量缩放（TTS_VOLUME）。
fn build_output_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: usize,
    samples: SampleQueue,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = channels.max(1);
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _| {
                // 每次回调读一次音量（无锁），乘到每个样本上
                let vol = f32::from_bits(TTS_VOLUME.load(std::sync::atomic::Ordering::Relaxed));
                let mut q = samples.lock().unwrap();
                for frame in data.chunks_mut(channels) {
                    let s = q.pop_front().unwrap_or(0.0) * vol;
                    for slot in frame {
                        *slot = T::from_sample(s);
                    }
                }
            },
            |e| eprintln!("tts 播放流错误: {e}"),
            None,
        )
        .map_err(|e| format!("打开扬声器失败: {e}"))
}

/// 设置软件音量（0.0~1.0，越界自动 clamp）：设置页音量控件调用，立即对在播/后续输出生效。
#[tauri::command]
pub fn tts_set_volume(volume: f32) {
    TTS_VOLUME.store(
        volume.clamp(0.0, 1.0).to_bits(),
        std::sync::atomic::Ordering::Relaxed,
    );
}

/// 播放线程：持有 cpal 输出流（非 Send 不进 State），经 ready 回报设备采样率；
/// 之后驻留监视样本队列，按「有声/静默」转变广播 tts:state（带 300ms 停顿豁免，
/// 句间合成慢半拍不闪嘴）。shutdown 竖起即退（drop 流放设备），换设备重建用
fn playback_thread(
    app: AppHandle,
    device_name: String,
    samples: SampleQueue,
    shutdown: Arc<AtomicBool>,
    ready: mpsc::Sender<Result<u32, String>>,
) {
    let host = cpal::default_host();
    // 指定设备按名字找（拔掉了回退默认），没指定用系统默认（与 STT 麦克风同款语义）
    let device = if device_name.is_empty() {
        host.default_output_device()
    } else {
        host.output_devices()
            .ok()
            .and_then(|mut it| {
                it.find(|d| d.description().is_ok_and(|desc| desc.name() == device_name))
            })
            .or_else(|| host.default_output_device())
    };
    let Some(device) = device else {
        let _ = ready.send(Err("没有可用的音频输出设备".into()));
        return;
    };
    let supported = match device.default_output_config() {
        Ok(c) => c,
        Err(e) => {
            let _ = ready.send(Err(format!("读取输出设备配置失败: {e}")));
            return;
        }
    };
    let rate = supported.sample_rate();
    let channels = supported.channels() as usize;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let stream = match format {
        cpal::SampleFormat::F32 => {
            build_output_stream::<f32>(&device, config, channels, samples.clone())
        }
        cpal::SampleFormat::I16 => {
            build_output_stream::<i16>(&device, config, channels, samples.clone())
        }
        cpal::SampleFormat::U16 => {
            build_output_stream::<u16>(&device, config, channels, samples.clone())
        }
        cpal::SampleFormat::I32 => {
            build_output_stream::<i32>(&device, config, channels, samples.clone())
        }
        other => Err(format!("不支持的输出样本格式: {other:?}")),
    };
    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    if let Err(e) = stream.play() {
        let _ = ready.send(Err(format!("启动播放失败: {e}")));
        return;
    }
    let _ = ready.send(Ok(rate));

    let mut playing = false;
    let mut last_audible = Instant::now() - Duration::from_secs(60);
    while !shutdown.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(50));
        if !samples.lock().unwrap().is_empty() {
            last_audible = Instant::now();
        }
        let want = last_audible.elapsed() < Duration::from_millis(PLAYING_HANGOVER_MS);
        if want != playing {
            playing = want;
            // 唤醒管线同步挂起/恢复：桌宠自己念「雪豹」不能把自己叫醒
            crate::wake::set_tts_busy(playing);
            // 广播给所有窗口：桌宠嘴型（talking）与对话窗按需各自消费
            let _ = app.emit("tts:state", serde_json::json!({ "playing": playing }));
        }
    }
    // 退役：确保嘴型不悬在「说话」上（换设备瞬间可能正播到一半）
    if playing {
        crate::wake::set_tts_busy(false);
        let _ = app.emit("tts:state", serde_json::json!({ "playing": false }));
    }
    drop(stream);
}

/// 合成线程：轮询任务队列，OfflineTts 常驻（packId 变了才重载），
/// 逐句合成 → 重采样到设备率 → 追加进样本队列。cancel 旗三处检查：
/// 取任务后、生成回调里（中途弃稿）、生成完入队前。shutdown 竖起即退
fn synth_worker(
    jobs: JobQueue,
    samples: SampleQueue,
    cancel: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    chatter: Arc<Mutex<Option<VoiceMeta>>>,
    device_rate: u32,
) {
    let mut engine: Option<(String, OfflineTts, i32)> = None;
    let mut rng = BeepRng::seeded();
    // 叨叨维持的样本水位（秒）：低于它就补一声，高于就歇——省得无限生成
    let chatter_floor = (0.28 * device_rate as f32) as usize;
    while !shutdown.load(Ordering::Relaxed) {
        // 电子拟声实时叨叨：chatter 有音色且未被打断时，持续把队列补到水位线。
        // 不念文字（模拟发音），播放线程据队列有无声广播嘴型 → AI 输出期间一直「说」
        if let Some(vm) = chatter.lock().unwrap().clone() {
            if cancel.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(15));
                continue;
            }
            if samples.lock().unwrap().len() < chatter_floor {
                let mut out = Vec::new();
                beep_chatter_unit(&mut out, &vm, device_rate, &mut rng);
                samples.lock().unwrap().extend(out);
            } else {
                std::thread::sleep(Duration::from_millis(15));
            }
            continue;
        }
        let job = jobs.lock().unwrap().pop_front();
        let Some(job) = job else {
            std::thread::sleep(Duration::from_millis(30));
            continue;
        };
        if cancel.load(Ordering::Relaxed) {
            continue;
        }
        // beep 引擎的 tts_speak（人设面板试听走这条）：按文字程序化生成，不碰模型
        if job.manifest.engine == "beep" {
            let fallback = VoiceMeta::default();
            let vm = job
                .manifest
                .voices
                .iter()
                .find(|v| v.id == job.voice)
                .unwrap_or(&fallback);
            let out = synth_beep(&job.text, vm, job.speed, device_rate);
            samples.lock().unwrap().extend(out);
            continue;
        }
        // 换包重载（同包复用，加载 1~2s 只发生在切宠/切包时）
        if engine
            .as_ref()
            .map(|(id, _, _)| id != &job.pack_id)
            .unwrap_or(true)
        {
            match load_engine(&job.dir, &job.manifest) {
                Ok(tts) => {
                    let rate = tts.sample_rate();
                    engine = Some((job.pack_id.clone(), tts, rate));
                }
                Err(e) => {
                    eprintln!("tts 加载语音包失败: {e}");
                    continue;
                }
            }
        }
        let (_, tts, engine_rate) = engine.as_ref().unwrap();
        let cancel_cb = cancel.clone();
        let audio = tts.generate_with_config(
            &job.text,
            &GenerationConfig {
                sid: job.voice,
                speed: job.speed,
                ..Default::default()
            },
            // 回调返回 false = 中途弃稿（tts_stop 竖旗后本句立刻停）
            Some(move |_: &[f32], _: f32| !cancel_cb.load(Ordering::Relaxed)),
        );
        let Some(audio) = audio else { continue };
        if cancel.load(Ordering::Relaxed) {
            continue;
        }
        let out: Vec<f32> = if *engine_rate == device_rate as i32 {
            audio.samples().to_vec()
        } else {
            match LinearResampler::create(*engine_rate, device_rate as i32) {
                Some(r) => r.resample(audio.samples(), true),
                None => {
                    eprintln!("tts 重采样器创建失败（{engine_rate} → {device_rate}）");
                    continue;
                }
            }
        };
        samples.lock().unwrap().extend(out);
    }
}

/// 确保运行时就绪（播放线程拿到设备率才回），返回任务队列句柄。
/// device 变化时旧运行时退役（两线程自行退出、流释放）重建新的
fn ensure_runtime(app: &AppHandle, state: &TtsState, device: &str) -> Result<JobQueue, String> {
    let mut guard = state.runtime.lock().unwrap();
    if let Some(rt) = guard.as_ref() {
        if rt.device == device {
            return Ok(rt.jobs.clone());
        }
        // 换设备：旧线程退役（清空队列免得残句跟进新设备）
        let rt = guard.take().unwrap();
        rt.shutdown.store(true, Ordering::Relaxed);
        rt.jobs.lock().unwrap().clear();
        rt.samples.lock().unwrap().clear();
        // 换设备不必等旧线程 join；句柄 drop 后线程看到 shutdown 会自行收尾。
    }
    let samples: SampleQueue = Arc::new(Mutex::new(VecDeque::new()));
    let jobs: JobQueue = Arc::new(Mutex::new(VecDeque::new()));
    let shutdown = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel();
    let playback_thread = {
        let app = app.clone();
        let samples = samples.clone();
        let shutdown = shutdown.clone();
        let device = device.to_string();
        std::thread::spawn(move || playback_thread(app, device, samples, shutdown, ready_tx))
    };
    let device_rate = match ready_rx.recv() {
        Ok(Ok(rate)) => rate,
        Ok(Err(error)) => {
            shutdown.store(true, Ordering::Relaxed);
            let _ = playback_thread.join();
            return Err(error);
        }
        Err(_) => {
            shutdown.store(true, Ordering::Relaxed);
            let _ = playback_thread.join();
            return Err("播放线程意外退出".into());
        }
    };
    let synth_thread = {
        let jobs = jobs.clone();
        let samples = samples.clone();
        let cancel = state.cancel.clone();
        let shutdown = shutdown.clone();
        let chatter = state.chatter.clone();
        std::thread::spawn(move || {
            synth_worker(jobs, samples, cancel, shutdown, chatter, device_rate)
        })
    };
    *guard = Some(TtsRuntime {
        jobs: jobs.clone(),
        samples,
        shutdown,
        device: device.to_string(),
        playback_thread,
        synth_thread,
    });
    Ok(jobs)
}

// ==================== 命令 ====================

/// 扫描全部语音包（设置页/人设面板的包与音色列表；坏包标灰带原因）
#[tauri::command]
pub fn tts_packs(app: AppHandle, state: State<TtsState>) -> Vec<PackInfo> {
    let _operation = state.pack_ops.lock().unwrap();
    scan_all(&app, &mut state.packs.lock().unwrap())
}

/// 导入已经解压的 sherpa-onnx 模型目录，或 ZIP/deskling-voice 包。
/// 大模型的复制、解压与试加载放进阻塞线程，避免冻结 Tauri IPC/窗口事件循环。
#[tauri::command]
pub async fn tts_pack_import(
    app: AppHandle,
    webview: tauri::WebviewWindow,
    state: State<'_, TtsState>,
    source_path: String,
) -> Result<PackInfo, String> {
    if webview.label() != "main" {
        return Err("只有主面板可以安装音色包".into());
    }
    let existing_ids = {
        let _operation = state.pack_ops.lock().unwrap();
        let mut cache = state.packs.lock().unwrap();
        scan_all(&app, &mut cache)
            .into_iter()
            .map(|pack| pack.id)
            .collect::<HashSet<_>>()
    };
    let worker_app = app.clone();
    let pack_id = tauri::async_runtime::spawn_blocking(move || {
        import_voice_pack(&worker_app, &source_path, &existing_ids)
    })
    .await
    .map_err(|error| format!("音色导入任务异常退出: {error}"))??;

    let _operation = state.pack_ops.lock().unwrap();
    let mut cache = state.packs.lock().unwrap();
    scan_all(&app, &mut cache)
        .into_iter()
        .find(|pack| pack.id == pack_id)
        .ok_or_else(|| "音色包已经安装，但重新扫描时没有找到它".to_string())
}

fn join_thread_briefly(handle: std::thread::JoinHandle<()>) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !handle.is_finished() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    if handle.is_finished() {
        let _ = handle.join();
    }
    // 超时则 drop 句柄让线程后台收尾；后续文件删除重试仍会等待模型释放。
}

fn retire_runtime(state: &TtsState) {
    state.cancel.store(true, Ordering::Relaxed);
    *state.chatter.lock().unwrap() = None;
    let runtime = state.runtime.lock().unwrap().take();
    if let Some(rt) = runtime {
        rt.shutdown.store(true, Ordering::Relaxed);
        rt.jobs.lock().unwrap().clear();
        rt.samples.lock().unwrap().clear();
        // 正常情况下 join 后 OfflineTts 已析构，Windows 不再占用模型文件。
        // 设上限，避免异常模型的生成调用让卸载命令无限卡住。
        join_thread_briefly(rt.synth_thread);
        join_thread_briefly(rt.playback_thread);
    }
}

/// 卸载用户音色包。内置包不可删；先退役推理线程，再重试删除以等待 Windows
/// 释放 ONNX 文件句柄。
#[tauri::command]
pub fn tts_pack_remove(
    app: AppHandle,
    webview: tauri::WebviewWindow,
    state: State<TtsState>,
    pack_id: String,
) -> Result<Vec<PackInfo>, String> {
    if webview.label() != "main" {
        return Err("只有主面板可以卸载音色包".into());
    }
    let _operation = state.pack_ops.lock().unwrap();
    validate_pack_id(&pack_id)?;
    let mut cache = state.packs.lock().unwrap();
    let packs = scan_all(&app, &mut cache);
    let info = packs
        .iter()
        .find(|pack| pack.id == pack_id)
        .ok_or_else(|| format!("音色包不存在: {pack_id}"))?;
    if info.builtin {
        return Err("内置音色包不能卸载".into());
    }
    drop(cache);

    let root = user_root_result(&app)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("无法解析音色包目录: {error}"))?;
    let target = root.join(&pack_id);
    let canonical_target = target
        .canonicalize()
        .map_err(|error| format!("无法解析待卸载音色包: {error}"))?;
    if !canonical_target.starts_with(&canonical_root)
        || canonical_target.parent() != Some(canonical_root.as_path())
    {
        return Err("拒绝卸载音色包目录之外的路径".into());
    }

    retire_runtime(&state);
    let mut last_error = None;
    for _ in 0..30 {
        match std::fs::remove_dir_all(&canonical_target) {
            Ok(()) => {
                last_error = None;
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                last_error = None;
                break;
            }
            Err(error) => {
                last_error = Some(error);
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    if let Some(error) = last_error {
        return Err(format!("卸载音色包失败: {error}"));
    }
    Ok(scan_all(&app, &mut state.packs.lock().unwrap()))
}

/// 枚举可用扬声器设备名（设置页「声音 · 扬声器」下拉用）。
/// 枚举失败返回空列表——前端仍有「系统默认」兜底可选
#[tauri::command]
pub fn tts_output_devices() -> Vec<String> {
    let Ok(devices) = cpal::default_host().output_devices() else {
        return Vec::new();
    };
    devices
        .filter_map(|d| d.description().ok().map(|desc| desc.name().to_string()))
        .collect()
}

/// 念一句话：入合成队列（前端分句后逐句喂）。packId 与上句相同零开销，
/// 不同则合成线程换载。voice = 模型内说话人编号（音色），speed = 语速倍率，
/// device = 输出设备名（设置页「扬声器」，空/None 用系统默认，变化时热重建）
#[tauri::command]
pub fn tts_speak(
    app: AppHandle,
    state: State<TtsState>,
    text: String,
    pack_id: String,
    voice_id: i32,
    speed: f32,
    device: Option<String>,
) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }
    let _operation = state.pack_ops.lock().unwrap();
    // 查包：缓存 miss 时重扫一次（工坊刚装的包即装即用）
    let (dir, manifest) = {
        let mut cache = state.packs.lock().unwrap();
        if !cache.contains_key(&pack_id) {
            let _ = scan_all(&app, &mut cache);
        }
        cache
            .get(&pack_id)
            .cloned()
            .ok_or_else(|| format!("语音包不存在: {pack_id}"))?
    };
    let jobs = ensure_runtime(&app, &state, device.as_deref().unwrap_or(""))?;
    // 新内容到达即解除打断态（tts_stop 竖的旗到此为止）
    state.cancel.store(false, Ordering::Relaxed);
    jobs.lock().unwrap().push_back(SpeakJob {
        text: text.to_string(),
        pack_id,
        dir,
        manifest,
        voice: voice_id,
        speed: if speed > 0.0 { speed } else { 1.0 },
    });
    Ok(())
}

/// 开始电子拟声实时叨叨（beep 包的聊天语音入口）：合成线程持续吐 blip，
/// 直到 tts_stop 收声。不念具体文字——只在 AI 输出期间/之后一小段持续「说话」。
/// 前端在 AI 回复完毕后随机延时 1-2s 再调 tts_stop，实现「说完话」的收尾
#[tauri::command]
pub fn tts_beep_start(
    app: AppHandle,
    state: State<TtsState>,
    pack_id: String,
    voice_id: i32,
    device: Option<String>,
) -> Result<(), String> {
    let _operation = state.pack_ops.lock().unwrap();
    let manifest = {
        let mut cache = state.packs.lock().unwrap();
        if !cache.contains_key(&pack_id) {
            let _ = scan_all(&app, &mut cache);
        }
        cache
            .get(&pack_id)
            .map(|(_, m)| m.clone())
            .ok_or_else(|| format!("语音包不存在: {pack_id}"))?
    };
    if manifest.engine != "beep" {
        return Err(format!("{pack_id} 不是电子拟声包"));
    }
    let vm = manifest
        .voices
        .iter()
        .find(|v| v.id == voice_id)
        .cloned()
        .unwrap_or_default();
    ensure_runtime(&app, &state, device.as_deref().unwrap_or(""))?;
    state.cancel.store(false, Ordering::Relaxed);
    *state.chatter.lock().unwrap() = Some(vm);
    Ok(())
}

/// 打断：清叨叨音色 + 清任务队列 + 清样本队列 + 竖 cancel 旗（生成中的句子
/// 立刻弃稿）。新一轮对话开始 / 用户暂停 / 按住说话开麦 / beep 收尾都走这里
#[tauri::command]
pub fn tts_stop(state: State<TtsState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::Relaxed);
    *state.chatter.lock().unwrap() = None;
    if let Some(rt) = state.runtime.lock().unwrap().as_ref() {
        rt.jobs.lock().unwrap().clear();
        rt.samples.lock().unwrap().clear();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "deskling-tts-{label}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn touch(&self, relative: &str) {
            let path = self.0.join(relative);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(path, []).unwrap();
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn relative_paths_reject_escape_and_platform_paths() {
        for unsafe_path in [
            "",
            "../model.onnx",
            "models/../../model.onnx",
            "/model.onnx",
            r"C:\model.onnx",
            r"models\model.onnx",
            "https://example.com/model.onnx",
        ] {
            assert!(
                validate_relative_path(unsafe_path).is_err(),
                "本应拒绝: {unsafe_path}"
            );
        }
        assert!(validate_relative_path("models/model.int8.onnx").is_ok());
    }

    #[test]
    fn detects_existing_kokoro_directory_without_custom_manifest() {
        let dir = TestDir::new("kokoro");
        for file in [
            "model.int8.onnx",
            "model.onnx",
            "voices.bin",
            "tokens.txt",
            "lexicon-zh.txt",
            "phone.fst",
        ] {
            dir.touch(file);
        }
        std::fs::create_dir_all(dir.0.join("espeak-ng-data")).unwrap();
        std::fs::create_dir_all(dir.0.join("dict")).unwrap();

        let manifest =
            detect_raw_manifest(&dir.0, "Hiyori 中文", &HashSet::new()).expect("应识别 Kokoro");
        assert_eq!(manifest.engine, "kokoro");
        assert_eq!(manifest.id, "local.hiyori");
        assert_eq!(
            manifest.files.get("model").map(String::as_str),
            Some("model.int8.onnx")
        );
        assert_eq!(
            manifest.files.get("voices").map(String::as_str),
            Some("voices.bin")
        );
        assert_eq!(
            manifest.files.get("dataDir").map(String::as_str),
            Some("espeak-ng-data")
        );
    }

    #[test]
    fn detects_matcha_acoustic_and_vocoder_pair() {
        let dir = TestDir::new("matcha");
        for file in [
            "matcha-acoustic.onnx",
            "vocos-22khz-univ.onnx",
            "tokens.txt",
        ] {
            dir.touch(file);
        }
        let manifest =
            detect_raw_manifest(&dir.0, "Matcha Voice", &HashSet::new()).expect("应识别 Matcha");
        assert_eq!(manifest.engine, "matcha");
        assert_eq!(
            manifest.files.get("acousticModel").map(String::as_str),
            Some("matcha-acoustic.onnx")
        );
        assert_eq!(
            manifest.files.get("vocoder").map(String::as_str),
            Some("vocos-22khz-univ.onnx")
        );
    }

    #[test]
    fn zip_import_rejects_parent_directory_entry() {
        let dir = TestDir::new("zip-escape");
        let archive_path = dir.0.join("evil.zip");
        let output = std::fs::File::create(&archive_path).unwrap();
        let mut archive = zip::ZipWriter::new(output);
        archive
            .start_file("../escaped.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"escape").unwrap();
        archive.finish().unwrap();

        let destination = dir.0.join("output");
        let error = extract_zip(&archive_path, &destination).unwrap_err();
        assert!(error.contains("越界") || error.contains("不安全"));
        assert!(!dir.0.join("escaped.txt").exists());
    }

    /// beep 电子拟声试听：TTS_TEST_BEEP_DIR 指定输出目录（未设置则跳过），
    /// 五种音色各写一个 wav。跑法：
    ///   $env:TTS_TEST_BEEP_DIR="..."; cargo test synth_beep -- --nocapture
    #[test]
    fn synth_beep_samples() {
        let Ok(out_dir) = std::env::var("TTS_TEST_BEEP_DIR") else {
            return;
        };
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/tts/beep");
        let manifest: PackManifest = serde_json::from_str(
            &std::fs::read_to_string(dir.join("manifest.json")).expect("读 manifest 失败"),
        )
        .expect("manifest 解析失败");
        let rate = 48_000u32;
        let text = "主人好！我是雪豹，今天要一起玩什么呢？";
        for v in &manifest.voices {
            let samples = synth_beep(text, v, 1.0, rate);
            let out = format!("{out_dir}\\beep-{}-{}.wav", v.id, v.name);
            assert!(
                sherpa_onnx::write(&out, &samples, rate as i32),
                "写 wav 失败"
            );
            println!("已写出: {out}（{} 样本）", samples.len());
        }
    }
}
