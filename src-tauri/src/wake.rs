//! 语音唤醒（Wake Word）：常驻监听麦克风 → 流式 KWS 命中唤醒词 → VAD 倾听
//! 一句话 → SenseVoice 识别 → 广播给前端直发会话。
//!
//! 管线两条线程（wake_configure 拉起/重建，配置不变则幂等跳过）：
//!   采集线程   复用 stt::capture_thread（cpal 独占持流，样本进共享缓冲）
//!   处理线程   每 ~100ms 排空缓冲 → 重采样 16k → 两阶段状态机：
//!     Watch    喂 zipformer KWS 小模型（3.3M，空闲 CPU 极低），命中唤醒词
//!              即广播 wake:detected（前端响提示音 + 桌宠竖耳倾听），并顺手
//!              预热 SenseVoice——趁用户说命令的功夫把 ~1s 的加载藏掉。
//!              同时维护 ~1.5s 的 16k 尾巴缓冲：KWS 判定有解码延迟，命中时
//!              把尾巴预喂给倾听阶段，「雪豹今天天气」连着说也不削字
//!     Listen   喂 silero VAD 断句：静音 ~0.9s 判定说完 → 整段送 SenseVoice
//!              识别 → 剥掉开头的唤醒词 → wake:command { text }（ChatWindow
//!              收到直接走发送链路）。段里只有唤醒词本身（两步流「雪豹…(停顿)
//!              …命令」的前半）则不发送、继续听下一段；倾听中每攒 ~1s 新语音
//!              就快照解码一版草稿经 wake:partial 推给桌宠气泡（边听边写）；
//!              迟迟不开口 / 说太久则 wake:aborted 回到 Watch
//!
//! 防自触发三面旗（任一竖起就丢样本并复位状态机）：
//!   STT_BUSY   按住说话录音中（同一句话别让唤醒管线也听一遍）
//!   TTS_BUSY   桌宠语音播报中（雪豹听到自己念「雪豹」不能把自己叫醒）
//!   CHAT_BUSY  AI 回复在途（ChatWindow 经 wake_chat_busy 同步，答完才继续听）
//!
//! 唤醒词是中文文本（设置页可改，默认跟随桌宠），经 pinyin 转 KWS 的
//! 「声母 韵母(带调) @原词」token 格式，并对照模型 tokens.txt 逐一校验。
//! 模型文件在 resources/stt/{kws/, silero_vad.onnx}（scripts/fetch-stt-model.mjs
//! 拉取，bundle.resources 打进安装包）。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use pinyin::ToPinyin;
use sherpa_onnx::{
    KeywordSpotter, KeywordSpotterConfig, LinearResampler, OfflineRecognizer,
    SileroVadModelConfig, VadModelConfig, VoiceActivityDetector,
};
use tauri::{AppHandle, Emitter, State};

use crate::stt;

/// 管线统一工作采样率（KWS / VAD / SenseVoice 三个模型都吃 16kHz）
const TARGET_RATE: u32 = 16_000;
/// 处理线程排空缓冲的节拍
const TICK: Duration = Duration::from_millis(100);
/// 唤醒后迟迟不开口的放弃时限（用户只是喊了一声没下文）
const LISTEN_START_TIMEOUT: Duration = Duration::from_secs(6);
/// 单条语音命令总时长兜底（VAD max_speech 之外的最后防线）
const LISTEN_TOTAL_TIMEOUT: Duration = Duration::from_secs(20);
/// VAD 断句：静音这么久（秒）判定一句说完 →「结束时自动发出去」的那个「结束」
const VAD_MIN_SILENCE_SECS: f32 = 0.9;
/// VAD 最短语音（秒）：比这短的动静当噪声，不算开口
const VAD_MIN_SPEECH_SECS: f32 = 0.25;
/// VAD 单段语音上限（秒）：说到这么长强制断句送识别
const VAD_MAX_SPEECH_SECS: f32 = 12.0;
/// Watch 阶段保留的 16k 尾巴样本数（1.5s）：KWS 命中晚于真实发音几百 ms，
/// 靠它把「唤醒词与命令连着说」时已被 KWS 消费掉的那截语音找补回来
const PRE_ROLL_SAMPLES: usize = (TARGET_RATE as usize * 3) / 2;
/// 倾听草稿：每攒够这么多新样本（0.6s）就快照解码一版推给桌宠气泡；
/// 停顿时另有追赶解码（见 Listen 分支），句尾不吞字
const PARTIAL_STEP_SAMPLES: usize = TARGET_RATE as usize * 3 / 5;

// ---- 防自触发旗 ----
static STT_BUSY: AtomicBool = AtomicBool::new(false);
static TTS_BUSY: AtomicBool = AtomicBool::new(false);
static CHAT_BUSY: AtomicBool = AtomicBool::new(false);

/// 按住说话录音起止时由 stt.rs 调用
pub fn set_stt_busy(busy: bool) {
    STT_BUSY.store(busy, Ordering::Relaxed);
}

/// TTS 播放起止时由 tts.rs 播放线程调用
pub fn set_tts_busy(busy: bool) {
    TTS_BUSY.store(busy, Ordering::Relaxed);
}

fn suspended() -> bool {
    STT_BUSY.load(Ordering::Relaxed)
        || TTS_BUSY.load(Ordering::Relaxed)
        || CHAT_BUSY.load(Ordering::Relaxed)
}

/// AI 回复在途时 ChatWindow 挂起唤醒检测（发起时 true，收尾时 false）
#[tauri::command]
pub fn wake_chat_busy(busy: bool) {
    CHAT_BUSY.store(busy, Ordering::Relaxed);
}

/// 一份生效中的唤醒配置（用于幂等比对：多窗口 bootstrap 会重复推同一份配置）
#[derive(Clone, PartialEq)]
struct WakeConfig {
    device: String,
    keyword: String,
    /// 唤醒灵敏度 0~1（设置页滑块）：映射成 KWS 的加权分与判定阈值
    sensitivity: f32,
}

/// 运行中的唤醒管线：停止旗 + 两条线程的 join 句柄
struct WakeSession {
    config: WakeConfig,
    stop: Arc<AtomicBool>,
    capture: JoinHandle<()>,
    process: JoinHandle<()>,
}

/// 会话槽挂 Arc：wake_configure 是 async 命令（重建要 join 正在识别的处理线程，
/// 最长 1-2s，不能堵主线程），槽要能带进 spawn_blocking。
#[derive(Default)]
pub struct WakeState {
    session: Arc<Mutex<Option<WakeSession>>>,
}

/// 汉语拼音声母表（zh/ch/sh 在前保证最长匹配）
const INITIALS: [&str; 23] = [
    "zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r",
    "z", "c", "s", "y", "w",
];

/// 唤醒词设置文本 → 词列表（多词用逗号/顿号/空格分隔）
fn split_words(raw: &str) -> Vec<String> {
    raw.split([',', '，', '、', ' ', '\u{3000}'])
        .map(str::trim)
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// 一个汉字的带调拼音 → KWS token 序列（「雪」→ ["x","uě"]）。
/// 先按声母+韵母拆开逐一对照模型词表；拆出来的 token 不在词表里
/// 就退回整音节再试——两条路都不通才报不支持。
fn syllable_tokens(py: &str, vocab: &HashSet<String>) -> Result<Vec<String>, String> {
    if let Some(initial) = INITIALS.iter().find(|i| py.starts_with(**i)) {
        let final_part = &py[initial.len()..];
        if !final_part.is_empty()
            && vocab.contains(*initial)
            && vocab.contains(final_part)
        {
            return Ok(vec![initial.to_string(), final_part.to_string()]);
        }
    }
    if vocab.contains(py) {
        return Ok(vec![py.to_string()]);
    }
    Err(format!("拼音「{py}」不在唤醒模型词表里"))
}

/// 唤醒词列表 → KWS keywords 格式（每词一行）。例：「雪豹」→ "x uě b ào @雪豹"
fn build_keywords(words: &[String], tokens_file: &Path) -> Result<String, String> {
    let vocab: HashSet<String> = std::fs::read_to_string(tokens_file)
        .map_err(|e| format!("读取唤醒模型词表失败: {e}"))?
        .lines()
        .filter_map(|l| l.split_whitespace().next().map(str::to_string))
        .collect();

    let mut lines = Vec::new();
    for word in words {
        let mut toks = Vec::new();
        for (ch, py) in word.chars().zip(word.as_str().to_pinyin()) {
            let Some(py) = py else {
                return Err(format!("唤醒词「{word}」含非中文字符「{ch}」，请用中文"));
            };
            toks.extend(syllable_tokens(py.with_tone(), &vocab)?);
        }
        if toks.is_empty() {
            continue;
        }
        lines.push(format!("{} @{word}", toks.join(" ")));
    }
    if lines.is_empty() {
        return Err("唤醒词为空".into());
    }
    Ok(lines.join("\n"))
}

/// 识别文本剥掉开头的唤醒词与标点（预喂尾巴会把「雪豹」也带进倾听段：
/// 「雪豹，今天天气怎么样」→「今天天气怎么样」；剥完为空 = 段里只有唤醒词）。
fn strip_wake_prefix(text: &str, words: &[String]) -> String {
    let punct = |c: char| c.is_whitespace() || "，。！？、,.!?~…；;：:".contains(c);
    let mut s = text.trim();
    loop {
        s = s.trim_start_matches(punct);
        match words.iter().find_map(|w| s.strip_prefix(w.as_str())) {
            Some(rest) => s = rest,
            None => break,
        }
    }
    s.trim_start_matches(punct).trim().to_string()
}

/// 一段 16k 样本 → SenseVoice 识别文本。Err 是识别器加载/解码失败（模型缺损
/// 之类），要与「听到了但识别为空」区分开——别让真实故障伪装成「没听清」。
fn recognize_samples(
    recognizer: &Arc<Mutex<Option<OfflineRecognizer>>>,
    stt_dir: &Path,
    samples: &[f32],
) -> Result<String, String> {
    stt::ensure_recognizer(recognizer, stt_dir)?;
    let guard = recognizer.lock().unwrap();
    stt::recognize(guard.as_ref().unwrap(), samples, TARGET_RATE)
}

/// 倾听阶段的累积状态
struct ListenCtx {
    since: Instant,
    /// VAD 是否已经探到人声（区分「没开口超时」与「说完收口」）
    heard: bool,
    /// 倾听期间累积的 16k 样本（含预喂尾巴）：草稿快照解码用
    cmd: Vec<f32>,
    /// 上次草稿解码时的 cmd 长度（攒够 PARTIAL_STEP_SAMPLES 新样本才再解）
    partial_at: usize,
    /// 最后一次「VAD 正探到人声」时的 cmd 长度：停顿追赶解码的水位线——
    /// partial_at 低于它说明还有没进过草稿的语音
    voiced_at: usize,
    /// 上次推送的草稿文本（去重，别拿同样的话刷气泡）
    last_partial: String,
}

impl ListenCtx {
    fn new(pre_roll: &[f32]) -> Self {
        Self {
            since: Instant::now(),
            heard: false,
            cmd: pre_roll.to_vec(),
            partial_at: pre_roll.len(),
            voiced_at: pre_roll.len(),
            last_partial: String::new(),
        }
    }
}

enum Phase {
    Watch,
    Listen(ListenCtx),
}

/// 处理线程主体：见模块头注释的两阶段状态机
#[allow(clippy::too_many_arguments)]
fn process_thread(
    app: AppHandle,
    stop: Arc<AtomicBool>,
    buffer: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    kws_dir: PathBuf,
    vad_model: PathBuf,
    keywords: String,
    words: Vec<String>,
    sensitivity: f32,
    recognizer: Arc<Mutex<Option<OfflineRecognizer>>>,
    stt_dir: PathBuf,
) {
    let fail = |msg: String| {
        eprintln!("wake 管线启动失败: {msg}");
        let _ = app.emit("wake:error", serde_json::json!({ "message": msg }));
        // 竖停止旗放采集线程收工：处理线程死了没人排空缓冲，采集线程
        // 独占的麦克风（和系统麦克风指示灯）不能一直挂着
        stop.store(true, Ordering::Relaxed);
    };

    // KWS：zipformer transducer 三件套 + 模型词表 + 定制唤醒词
    let mut kconfig = KeywordSpotterConfig::default();
    let p = |name: &str| Some(kws_dir.join(name).to_string_lossy().into_owned());
    kconfig.model_config.transducer.encoder = p("encoder.onnx");
    kconfig.model_config.transducer.decoder = p("decoder.onnx");
    kconfig.model_config.transducer.joiner = p("joiner.onnx");
    kconfig.model_config.tokens = p("tokens.txt");
    kconfig.model_config.num_threads = 1;
    kconfig.keywords_buf = Some(keywords);
    // 灵敏度 0~1 → KWS 双杠杆：加权分（给唤醒词路径的每步解码加分，提召回）
    // 与判定阈值（越低越易触发）。0~1 只是滑块的归一化刻度，真正的参数跨度在
    // 这里拉满：100% = 加权 3.0 / 阈值 0.05（相当激进，误唤醒也会明显变多）。
    // 语速快时音素后验偏弱，主要靠这两根杠杆兜住
    kconfig.keywords_score = 1.0 + 2.0 * sensitivity;
    kconfig.keywords_threshold = 0.35 - 0.30 * sensitivity;
    // 搜索束宽 4→6：多留几条候选路径，快语速下的弱证据不至于早早被剪枝
    kconfig.max_active_paths = 6;
    let Some(kws) = KeywordSpotter::create(&kconfig) else {
        return fail("加载唤醒词模型失败".into());
    };
    let kws_stream = kws.create_stream();

    // VAD：silero，负责唤醒后「听到一句完整话」的断句
    let mut vconfig = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: Some(vad_model.to_string_lossy().into_owned()),
            threshold: 0.5,
            min_silence_duration: VAD_MIN_SILENCE_SECS,
            min_speech_duration: VAD_MIN_SPEECH_SECS,
            window_size: 512,
            max_speech_duration: VAD_MAX_SPEECH_SECS,
        },
        ..Default::default()
    };
    vconfig.sample_rate = TARGET_RATE as i32;
    vconfig.num_threads = 1;
    let Some(vad) = VoiceActivityDetector::create(&vconfig, 30.0) else {
        return fail("加载 VAD 模型失败".into());
    };

    // 设备原生采样率 ≠ 16k 时建常驻重采样器（流式喂，不 flush 保连续性）
    let resampler = if sample_rate == TARGET_RATE {
        None
    } else {
        match LinearResampler::create(sample_rate as i32, TARGET_RATE as i32) {
            Some(r) => Some(r),
            None => return fail("创建唤醒重采样器失败".into()),
        }
    };

    let mut phase = Phase::Watch;
    let mut was_suspended = false;
    // Watch 阶段的 16k 尾巴环形缓冲（预喂倾听用）
    let mut tail: Vec<f32> = Vec::with_capacity(PRE_ROLL_SAMPLES * 2);

    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(TICK);
        let chunk = std::mem::take(&mut *buffer.lock().unwrap());

        // 挂起（录音/播报/回复在途）：丢样本 + 状态机复位，恢复后从头听
        if suspended() {
            if !was_suspended {
                was_suspended = true;
                kws.reset(&kws_stream);
                vad.reset();
                vad.clear();
                tail.clear();
                if matches!(phase, Phase::Listen(_)) {
                    let _ = app.emit("wake:aborted", serde_json::json!({ "reason": "suspended" }));
                }
                phase = Phase::Watch;
            }
            continue;
        }
        was_suspended = false;
        if chunk.is_empty() {
            continue;
        }
        let chunk16 = match &resampler {
            Some(r) => r.resample(&chunk, false),
            None => chunk,
        };

        match &mut phase {
            Phase::Watch => {
                // 尾巴缓冲：始终保留最近 ~1.5s（KWS 判定滞后的找补窗口）
                tail.extend_from_slice(&chunk16);
                if tail.len() > PRE_ROLL_SAMPLES {
                    tail.drain(..tail.len() - PRE_ROLL_SAMPLES);
                }

                kws_stream.accept_waveform(TARGET_RATE as i32, &chunk16);
                let mut hit: Option<String> = None;
                while kws.is_ready(&kws_stream) {
                    kws.decode(&kws_stream);
                    if let Some(r) = kws.get_result(&kws_stream) {
                        if !r.keyword.is_empty() {
                            hit = Some(r.keyword);
                            kws.reset(&kws_stream);
                        }
                    }
                }
                if let Some(keyword) = hit {
                    let _ = app.emit("wake:detected", serde_json::json!({ "keyword": keyword }));
                    // 预热 SenseVoice：趁用户说命令的功夫把首次加载的 ~1s 藏掉
                    let slot = recognizer.clone();
                    let dir = stt_dir.clone();
                    std::thread::spawn(move || {
                        if let Err(e) = stt::ensure_recognizer(&slot, &dir) {
                            eprintln!("wake 识别器预热失败: {e}");
                        }
                    });
                    // 预喂尾巴：连着说时被 KWS 消费掉的命令开头从这里找补回来
                    vad.reset();
                    vad.clear();
                    vad.accept_waveform(&tail);
                    phase = Phase::Listen(ListenCtx::new(&tail));
                    tail = Vec::with_capacity(PRE_ROLL_SAMPLES * 2);
                }
            }
            Phase::Listen(ctx) => {
                vad.accept_waveform(&chunk16);
                ctx.cmd.extend_from_slice(&chunk16);
                if vad.detected() {
                    ctx.heard = true;
                    ctx.voiced_at = ctx.cmd.len();
                }

                // 一段完整语音闭合（静音断句 / 超长强拆）：识别 → 剥唤醒词 → 发送。
                // 段里只有唤醒词本身（两步流的前半）则不发送，原地重新起听。
                let mut done = false;
                if !vad.is_empty() {
                    let samples = vad.front().map(|seg| seg.samples().to_vec());
                    vad.clear();
                    let text = match samples.map(|s| recognize_samples(&recognizer, &stt_dir, &s)) {
                        Some(Err(e)) => {
                            // 识别器故障：报真实错误，别伪装成「没听清」
                            let _ = app.emit("wake:error", serde_json::json!({ "message": e }));
                            let _ = app
                                .emit("wake:aborted", serde_json::json!({ "reason": "error" }));
                            vad.clear();
                            phase = Phase::Watch;
                            continue;
                        }
                        Some(Ok(t)) => t,
                        None => String::new(),
                    };
                    let text = strip_wake_prefix(&text, &words);
                    if !text.is_empty() {
                        let _ = app.emit("wake:command", serde_json::json!({ "text": text }));
                        done = true;
                    } else if ctx.since.elapsed() > LISTEN_TOTAL_TIMEOUT {
                        // 兜底：反复只听到唤醒词/杂音也别永远耗着
                        let _ =
                            app.emit("wake:aborted", serde_json::json!({ "reason": "empty" }));
                        done = true;
                    } else {
                        // 只喊了名字：清空累积、重开计时，继续等真正的命令
                        *ctx = ListenCtx::new(&[]);
                    }
                } else {
                    let waited = ctx.since.elapsed();
                    if ctx.heard && waited > LISTEN_TOTAL_TIMEOUT {
                        // 说太久：把 VAD 里未收口的尾巴冲出来，能识别就发
                        vad.flush();
                        let samples = vad.front().map(|seg| seg.samples().to_vec());
                        vad.clear();
                        let text = match samples
                            .map(|s| recognize_samples(&recognizer, &stt_dir, &s))
                        {
                            Some(Err(e)) => {
                                let _ =
                                    app.emit("wake:error", serde_json::json!({ "message": e }));
                                String::new()
                            }
                            Some(Ok(t)) => t,
                            None => String::new(),
                        };
                        let text = strip_wake_prefix(&text, &words);
                        if text.is_empty() {
                            let _ =
                                app.emit("wake:aborted", serde_json::json!({ "reason": "empty" }));
                        } else {
                            let _ = app.emit("wake:command", serde_json::json!({ "text": text }));
                        }
                        done = true;
                    } else if !ctx.heard && waited > LISTEN_START_TIMEOUT {
                        // 喊了一声没下文：放弃本次倾听
                        let _ =
                            app.emit("wake:aborted", serde_json::json!({ "reason": "timeout" }));
                        vad.clear();
                        done = true;
                    } else if ctx.heard
                        && (ctx.cmd.len() - ctx.partial_at >= PARTIAL_STEP_SAMPLES
                            // 停顿追赶：人声一停就把余下没解码的语音立刻补一版——
                            // 正好赶在静音断句收口之前把整句亮全，句尾不吞字
                            || (!vad.detected() && ctx.partial_at < ctx.voiced_at))
                    {
                        // 草稿快照：攒够新语音（或停顿追赶）就解一版推给桌宠气泡。
                        // try_lock：识别器还在预热加载就跳过本轮，不堵状态机
                        if let Ok(guard) = recognizer.try_lock() {
                            if let Some(rec) = guard.as_ref() {
                                ctx.partial_at = ctx.cmd.len();
                                let text = stt::recognize(rec, &ctx.cmd, TARGET_RATE)
                                    .unwrap_or_default();
                                let text = strip_wake_prefix(&text, &words);
                                if !text.is_empty() && text != ctx.last_partial {
                                    ctx.last_partial = text.clone();
                                    let _ = app
                                        .emit("wake:partial", serde_json::json!({ "text": text }));
                                }
                            }
                        }
                    }
                }
                if done {
                    vad.clear();
                    phase = Phase::Watch;
                }
            }
        }
    }
}

/// 应用/更新唤醒配置（settings 同步或设置页改动时调用；所有窗口 bootstrap 都会
/// 推一份，配置没变则幂等返回）。enabled=false 停掉管线。
/// async：重建要 join 可能正在识别的处理线程（最长 1-2s），丢给 blocking 线程池，
/// 不堵主事件循环（同步命令跑在主线程上，会把全部窗口一起冻住）。
#[tauri::command]
pub async fn wake_configure(
    app: AppHandle,
    wake: State<'_, WakeState>,
    stt_state: State<'_, stt::SttState>,
    enabled: bool,
    keyword: String,
    device: Option<String>,
    sensitivity: Option<f32>,
) -> Result<(), String> {
    let session_slot = wake.session.clone();
    let recognizer = stt_state.recognizer.clone();
    tauri::async_runtime::spawn_blocking(move || {
        configure_inner(app, session_slot, recognizer, enabled, keyword, device, sensitivity)
    })
    .await
    .map_err(|e| format!("唤醒配置任务失败: {e}"))?
}

#[allow(clippy::too_many_arguments)]
fn configure_inner(
    app: AppHandle,
    session_slot: Arc<Mutex<Option<WakeSession>>>,
    recognizer: Arc<Mutex<Option<OfflineRecognizer>>>,
    enabled: bool,
    keyword: String,
    device: Option<String>,
    sensitivity: Option<f32>,
) -> Result<(), String> {
    // 先复位在途旗：webview 热重载/异常退出可能没来得及发 busy=false，而重载后
    // 重推的配置往往一字不差、会走下面的幂等分支——复位必须在幂等判断之前，
    // 否则一面悬空的旗会把管线永远压住（ChatWindow 挂载时也会主动清一次，双保险）
    CHAT_BUSY.store(false, Ordering::Relaxed);

    let device = device.unwrap_or_default();
    let keyword = {
        let k = keyword.trim();
        if k.is_empty() { "雪豹".to_string() } else { k.to_string() }
    };
    let sensitivity = sensitivity.unwrap_or(0.5).clamp(0.0, 1.0);
    let config = WakeConfig { device: device.clone(), keyword: keyword.clone(), sensitivity };

    let mut session = session_slot.lock().unwrap();
    if let Some(cur) = session.as_ref() {
        // 配置没变且管线还活着：多窗口重复推送直接跳过。探活不可省——处理线程
        // 可能因模型损坏启动即亡（fail 路径），死会话必须允许同配置重建自愈
        if enabled && cur.config == config && !cur.process.is_finished() {
            return Ok(());
        }
        // 停旧管线（配置变了重建 / 死会话自愈 / enabled=false 收摊）
        let old = session.take().unwrap();
        old.stop.store(true, Ordering::Relaxed);
        let _ = old.capture.join();
        let _ = old.process.join();
    }
    if !enabled {
        return Ok(());
    }

    // 模型就绪检查（含命令识别用的 SenseVoice）+ 唤醒词转 token（此刻报错，
    // 别等线程里才炸）
    let stt_dir = stt::model_dir(&app)?;
    let kws_dir = stt_dir.join("kws");
    let vad_model = stt_dir.join("silero_vad.onnx");
    if !kws_dir.join("encoder.onnx").exists()
        || !vad_model.exists()
        || !stt_dir.join("sense-voice.int8.onnx").exists()
    {
        return Err("唤醒模型未就绪：开发环境请先运行 pnpm fetch:models".into());
    }
    let words = split_words(&keyword);
    let keywords = build_keywords(&words, &kws_dir.join("tokens.txt"))?;

    // 起采集线程（复用 stt 的：设备选择/格式分派/回退逻辑同一套）
    let stop = Arc::new(AtomicBool::new(false));
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let (ready_tx, ready_rx) = mpsc::channel();
    let capture = {
        let stop = stop.clone();
        let buffer = buffer.clone();
        let device = (!device.is_empty()).then(|| device.clone());
        std::thread::spawn(move || stt::capture_thread(device, stop, buffer, ready_tx))
    };
    let sample_rate = ready_rx
        .recv()
        .map_err(|_| "唤醒采集线程意外退出".to_string())??;

    // 起处理线程
    let process = {
        let app = app.clone();
        let stop = stop.clone();
        let buffer = buffer.clone();
        std::thread::spawn(move || {
            process_thread(
                app, stop, buffer, sample_rate, kws_dir, vad_model, keywords, words, sensitivity,
                recognizer, stt_dir,
            )
        })
    };

    *session = Some(WakeSession { config, stop, capture, process });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 唤醒词转 token 冒烟：模型词表就位（pnpm fetch:models）才跑，缺失静默跳过。
    /// 跑法：cargo test keywords -- --nocapture
    #[test]
    fn build_keywords_smoke() {
        let tokens = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/stt/kws/tokens.txt");
        if !tokens.exists() {
            return;
        }
        // 默认唤醒词必须可转换（设置页回退值不能炸）
        let kw = build_keywords(&split_words("雪豹"), &tokens).expect("默认唤醒词转换失败");
        println!("雪豹 -> {kw}");
        assert!(kw.ends_with("@雪豹"));
        // 多词 + 全角逗号分隔
        let multi =
            build_keywords(&split_words("雪豹，小雪"), &tokens).expect("多唤醒词转换失败");
        assert_eq!(multi.lines().count(), 2);
        // 非中文明确报错而非静默吞掉
        assert!(build_keywords(&split_words("hey cat"), &tokens).is_err());
    }

    /// 剥唤醒词前缀：连说/两步/带标点/只有唤醒词 四种形态
    #[test]
    fn strip_prefix_cases() {
        let words = split_words("雪豹，小雪");
        assert_eq!(strip_wake_prefix("雪豹，今天天气怎么样？", &words), "今天天气怎么样？");
        assert_eq!(strip_wake_prefix("雪豹雪豹 帮我查个东西", &words), "帮我查个东西");
        assert_eq!(strip_wake_prefix("小雪。", &words), "");
        assert_eq!(strip_wake_prefix("帮我算算 1+1", &words), "帮我算算 1+1");
    }

    /// KWS 端到端冒烟：用部署好的模型 + build_keywords 产物真跑一遍检测。
    /// WAKE_TEST_DIR 指向解包的官方模型目录（test_wavs/3.wav 含「文森特卡索」），
    /// 未设置则静默跳过。跑法：
    ///   $env:WAKE_TEST_DIR="...\sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01"
    ///   cargo test kws_detect -- --nocapture
    #[test]
    fn kws_detect_sample_wav() {
        use sherpa_onnx::Wave;
        let Ok(dir) = std::env::var("WAKE_TEST_DIR") else {
            return;
        };
        let kws_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/stt/kws");
        let keywords = build_keywords(&split_words("文森特卡索"), &kws_dir.join("tokens.txt"))
            .expect("唤醒词转换失败");

        let mut config = KeywordSpotterConfig::default();
        let p = |name: &str| Some(kws_dir.join(name).to_string_lossy().into_owned());
        config.model_config.transducer.encoder = p("encoder.onnx");
        config.model_config.transducer.decoder = p("decoder.onnx");
        config.model_config.transducer.joiner = p("joiner.onnx");
        config.model_config.tokens = p("tokens.txt");
        config.model_config.num_threads = 1;
        config.keywords_buf = Some(keywords);
        let kws = KeywordSpotter::create(&config).expect("创建 KWS 失败");
        let stream = kws.create_stream();

        // 3.wav 官方标注含「文森特卡索」——config.keywords_buf 装的正是
        // build_keywords 产物，默认流检出它 = 整条自定义唤醒词通路都通
        let wave = Wave::read(Path::new(&dir).join("test_wavs/3.wav").to_str().unwrap())
            .expect("读测试 wav 失败");
        stream.accept_waveform(wave.sample_rate(), wave.samples());
        stream.input_finished();
        let mut hit = String::new();
        while kws.is_ready(&stream) {
            kws.decode(&stream);
            if let Some(r) = kws.get_result(&stream) {
                if !r.keyword.is_empty() {
                    hit = r.keyword;
                    kws.reset(&stream);
                }
            }
        }
        println!("keywords_buf 通路检出: {hit}");
        assert_eq!(hit, "文森特卡索");
    }
}
