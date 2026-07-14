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

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SizedSample};
use serde::{Deserialize, Serialize};
use sherpa_onnx::{
    GenerationConfig, LinearResampler, OfflineTts, OfflineTtsConfig,
    OfflineTtsKokoroModelConfig, OfflineTtsMatchaModelConfig, OfflineTtsVitsModelConfig,
};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};

/// 播放停顿判定：样本队列排空后再等这么久才算「说完了」（ms）——
/// 句与句之间合成偶尔慢半拍，别让嘴型闪合又闪开
const PLAYING_HANGOVER_MS: u64 = 300;

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

/// 把 manifest 里逗号分隔的相对路径拼成引擎要的逗号分隔绝对路径
fn resolve_multi(dir: &Path, spec: &str) -> String {
    spec.split(',')
        .map(|p| dir.join(p.trim()).to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(",")
}

/// 校验 manifest 声明的文件/目录都在包里（逗号分隔逐个查）
fn validate_files(dir: &Path, m: &PackManifest) -> Result<(), String> {
    for (role, spec) in &m.files {
        for part in spec.split(',') {
            let p = dir.join(part.trim());
            if !p.exists() {
                return Err(format!("缺文件 {role}: {part}"));
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
    let f = |k: &str| -> Option<String> {
        m.files.get(k).map(|spec| resolve_multi(dir, spec))
    };
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

/// 扫一个根目录：每个含 manifest.json 的子目录是一个包。
/// 解析/校验失败的包也进列表（valid=false + 原因），前端灰显可排查
fn scan_root(root: &Path, builtin: bool, out: &mut Vec<PackInfo>, cache: &mut HashMap<String, (PathBuf, PackManifest)>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for e in entries.flatten() {
        let dir = e.path();
        let mf_path = dir.join("manifest.json");
        if !mf_path.is_file() {
            continue;
        }
        let dir_name = e.file_name().to_string_lossy().into_owned();
        let parsed = std::fs::read_to_string(&mf_path)
            .map_err(|e| format!("读 manifest 失败: {e}"))
            .and_then(|s| {
                serde_json::from_str::<PackManifest>(&s).map_err(|e| format!("manifest 解析失败: {e}"))
            })
            .and_then(|m| validate_files(&dir, &m).map(|_| m));
        match parsed {
            Ok(m) => {
                out.push(PackInfo {
                    id: m.id.clone(),
                    name: m.name.clone(),
                    engine: m.engine.clone(),
                    voices: m.voices.clone(),
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
                builtin,
                valid: false,
                error: Some(err),
            }),
        }
    }
}

/// 扫全部根目录，刷新 id → (目录, manifest) 缓存，返回包列表
fn scan_all(app: &AppHandle, cache: &mut HashMap<String, (PathBuf, PackManifest)>) -> Vec<PackInfo> {
    let mut out = Vec::new();
    cache.clear();
    if let Some(root) = builtin_root(app) {
        scan_root(&root, true, &mut out, cache);
    }
    if let Some(root) = user_root(app) {
        scan_root(&root, false, &mut out, cache);
    }
    out
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
    let energy = if text.contains('！') || text.contains('!') { 1.18 } else { 1.0 };
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
            Beep::PauseShort => {
                out.extend(std::iter::repeat(0.0).take(ms_to_n(BEEP_PAUSE_SHORT_S * 1000.0 / speed)))
            }
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
fn append_blip(out: &mut Vec<f32>, f0: f32, wave: &str, dur_ms: f32, energy: f32, rate: u32, seed: u32) {
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
            "square" => if frac < 0.5 { 0.55 } else { -0.55 },
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
}

/// TTS 全局状态：懒启动的运行时 + 包缓存 + 打断旗 + 叨叨音色。
/// chatter = Some(音色) 时合成线程持续吐 beep 叨叨（电子拟声实时聊天用），
/// tts_stop 清空它即收声
#[derive(Default)]
pub struct TtsState {
    runtime: Mutex<Option<TtsRuntime>>,
    packs: Mutex<HashMap<String, (PathBuf, PackManifest)>>,
    cancel: Arc<AtomicBool>,
    chatter: Arc<Mutex<Option<VoiceMeta>>>,
}

/// 建输出流：把样本队列（单声道、设备率）逐帧铺到所有声道；队列空则静音
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
                let mut q = samples.lock().unwrap();
                for frame in data.chunks_mut(channels) {
                    let s = q.pop_front().unwrap_or(0.0);
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
        cpal::SampleFormat::F32 => build_output_stream::<f32>(&device, config, channels, samples.clone()),
        cpal::SampleFormat::I16 => build_output_stream::<i16>(&device, config, channels, samples.clone()),
        cpal::SampleFormat::U16 => build_output_stream::<u16>(&device, config, channels, samples.clone()),
        cpal::SampleFormat::I32 => build_output_stream::<i32>(&device, config, channels, samples.clone()),
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
            // 广播给所有窗口：桌宠嘴型（talking）与对话窗按需各自消费
            let _ = app.emit("tts:state", serde_json::json!({ "playing": playing }));
        }
    }
    // 退役：确保嘴型不悬在「说话」上（换设备瞬间可能正播到一半）
    if playing {
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
            let vm = job.manifest.voices.iter().find(|v| v.id == job.voice).unwrap_or(&fallback);
            let out = synth_beep(&job.text, vm, job.speed, device_rate);
            samples.lock().unwrap().extend(out);
            continue;
        }
        // 换包重载（同包复用，加载 1~2s 只发生在切宠/切包时）
        if engine.as_ref().map(|(id, _, _)| id != &job.pack_id).unwrap_or(true) {
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
        rt.shutdown.store(true, Ordering::Relaxed);
        rt.jobs.lock().unwrap().clear();
        rt.samples.lock().unwrap().clear();
        *guard = None;
    }
    let samples: SampleQueue = Arc::new(Mutex::new(VecDeque::new()));
    let jobs: JobQueue = Arc::new(Mutex::new(VecDeque::new()));
    let shutdown = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel();
    {
        let app = app.clone();
        let samples = samples.clone();
        let shutdown = shutdown.clone();
        let device = device.to_string();
        std::thread::spawn(move || playback_thread(app, device, samples, shutdown, ready_tx));
    }
    let device_rate = ready_rx
        .recv()
        .map_err(|_| "播放线程意外退出".to_string())??;
    {
        let jobs = jobs.clone();
        let samples = samples.clone();
        let cancel = state.cancel.clone();
        let shutdown = shutdown.clone();
        let chatter = state.chatter.clone();
        std::thread::spawn(move || synth_worker(jobs, samples, cancel, shutdown, chatter, device_rate));
    }
    *guard = Some(TtsRuntime {
        jobs: jobs.clone(),
        samples,
        shutdown,
        device: device.to_string(),
    });
    Ok(jobs)
}

// ==================== 命令 ====================

/// 扫描全部语音包（设置页/人设面板的包与音色列表；坏包标灰带原因）
#[tauri::command]
pub fn tts_packs(app: AppHandle, state: State<TtsState>) -> Vec<PackInfo> {
    scan_all(&app, &mut state.packs.lock().unwrap())
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
            assert!(sherpa_onnx::write(&out, &samples, rate as i32), "写 wav 失败");
            println!("已写出: {out}（{} 样本）", samples.len());
        }
    }

}
