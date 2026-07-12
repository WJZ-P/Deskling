//! 语音输入（STT）：按住说话 → cpal 采集麦克风 → SenseVoice 离线识别。
//!
//! 命令三件套（前端 ChatComposer 麦克风按钮驱动）：
//!   stt_start  按下开麦：起独立采集线程（cpal Stream 不是 Send，进不了
//!              State，由线程独占持有），同时后台预热识别器——首次加载
//!              约 1s，正好藏进用户说话的时长里
//!   stt_stop   松手识别：停采集 → 重采样 16k → SenseVoice 解码 → 返回文本
//!   stt_cancel 放弃本次录音（不识别直接丢弃）
//!
//! 模型文件在 resources/stt/（经 bundle.resources 打进安装包，用户开箱即用）；
//! 开发机由 scripts/fetch-stt-model.mjs 拉取（已挂进 beforeDevCommand，
//! 缺失时自动补）——模型 ~230MB 超 GitHub 单文件 100MB 上限，不进 git 仓库。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SizedSample};
use sherpa_onnx::{
    LinearResampler, OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig,
};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State};

/// SenseVoice 特征提取采样率（模型定死 16kHz，设备率不同则重采样）
const TARGET_RATE: u32 = 16_000;
/// 单次录音时长上限（秒）：按住说话场景的兜底，超出后丢弃新样本防爆内存
const MAX_RECORD_SECS: usize = 60;
/// 短于这个时长（秒）不送识别：手滑误触直接打回
const MIN_RECORD_SECS: f32 = 0.25;

/// 一次进行中的录音会话。cpal 流由采集线程独占，
/// 这里只握共享样本缓冲、停止旗和 join 句柄。
struct RecSession {
    stop: Arc<AtomicBool>,
    /// 已采样本：单声道、设备原生采样率
    buffer: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    handle: JoinHandle<()>,
}

/// STT 全局状态：进行中的录音会话 + 常驻识别器。
/// 识别器首次用时加载（~1s）、之后复用（单次识别几百 ms）；
/// 挂 Arc 让预热/识别的 blocking 线程能拿走一份句柄。
#[derive(Default)]
pub struct SttState {
    session: Mutex<Option<RecSession>>,
    recognizer: Arc<Mutex<Option<OfflineRecognizer>>>,
}

/// 解析模型目录：打包后 = 安装目录 resources/stt；开发 = src-tauri/resources/stt
fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("resources/stt", BaseDirectory::Resource)
        .map_err(|e| format!("解析语音模型目录失败: {e}"))
}

/// 加载 SenseVoice 识别器：language=auto（中英粤日韩自动判别）、
/// ITN 开启（“三点半”→“3:30” 这类数字/标点规整，识别结果直接可用）
fn load_recognizer(dir: &Path) -> Result<OfflineRecognizer, String> {
    let model = dir.join("sense-voice.int8.onnx");
    let tokens = dir.join("tokens.txt");
    if !model.exists() || !tokens.exists() {
        return Err("语音模型未就绪：开发环境请先运行 pnpm fetch:stt".into());
    }
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
        model: Some(model.to_string_lossy().into_owned()),
        language: Some("auto".into()),
        use_itn: true,
    };
    config.model_config.tokens = Some(tokens.to_string_lossy().into_owned());
    config.model_config.num_threads = 2;
    OfflineRecognizer::create(&config).ok_or_else(|| "加载语音识别器失败".into())
}

/// 确保识别器已加载。拿着锁装载：预热线程装载期间，stt_stop 会在锁上
/// 等它装完再识别，天然串行无竞态。
fn ensure_recognizer(
    slot: &Arc<Mutex<Option<OfflineRecognizer>>>,
    dir: &Path,
) -> Result<(), String> {
    let mut guard = slot.lock().unwrap();
    if guard.is_none() {
        *guard = Some(load_recognizer(dir)?);
    }
    Ok(())
}

/// 一段单声道样本 → （必要时）重采样 16k → SenseVoice 解码 → 识别文本
fn recognize(
    recognizer: &OfflineRecognizer,
    samples: &[f32],
    sample_rate: u32,
) -> Result<String, String> {
    let resampled;
    let samples = if sample_rate == TARGET_RATE {
        samples
    } else {
        let resampler = LinearResampler::create(sample_rate as i32, TARGET_RATE as i32)
            .ok_or("创建重采样器失败")?;
        resampled = resampler.resample(samples, true);
        &resampled
    };
    let stream = recognizer.create_stream();
    stream.accept_waveform(TARGET_RATE as i32, samples);
    recognizer.decode(&stream);
    let result = stream.get_result().ok_or("识别结果为空")?;
    Ok(result.text.trim().to_string())
}

/// 建一条输入流：回调里把设备样本 T 转 f32、多声道逐帧平均压单声道，攒进共享缓冲
fn build_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: usize,
    sample_rate: u32,
    buffer: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let max_len = sample_rate as usize * MAX_RECORD_SECS;
    let channels = channels.max(1);
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                let mut buf = buffer.lock().unwrap();
                if buf.len() >= max_len {
                    return;
                }
                for frame in data.chunks(channels) {
                    let sum: f32 = frame.iter().map(|s| f32::from_sample(*s)).sum();
                    buf.push(sum / frame.len() as f32);
                }
            },
            |e| eprintln!("stt 采集流错误: {e}"),
            None,
        )
        .map_err(|e| format!("打开麦克风失败: {e}"))
}

/// 采集线程主体：开麦克风（设置页指定设备名，缺省/失联回退系统默认）→
/// 按设备样本格式建流（cpal 不做隐式格式转换，常见四种各给一条泛型分派）→
/// 经 ready 回报采样率/错误 → 驻留到停止旗竖起，退出时 drop 流关麦。
fn capture_thread(
    device_name: Option<String>,
    stop: Arc<AtomicBool>,
    buffer: Arc<Mutex<Vec<f32>>>,
    ready: mpsc::Sender<Result<u32, String>>,
) {
    let host = cpal::default_host();
    let device = match device_name.as_deref() {
        Some(name) if !name.is_empty() => host
            .input_devices()
            .ok()
            .and_then(|mut it| {
                it.find(|d| d.description().is_ok_and(|desc| desc.name() == name))
            })
            // 指定设备找不到（拔掉了）：回退系统默认，别让语音输入直接哑火
            .or_else(|| host.default_input_device()),
        _ => host.default_input_device(),
    };
    let Some(device) = device else {
        let _ = ready.send(Err("没有可用的麦克风设备".into()));
        return;
    };
    let supported = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            let _ = ready.send(Err(format!("读取麦克风配置失败: {e}")));
            return;
        }
    };
    let sample_rate = supported.sample_rate();
    let channels = supported.channels() as usize;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();

    let stream = match format {
        cpal::SampleFormat::F32 => build_stream::<f32>(&device, config, channels, sample_rate, buffer),
        cpal::SampleFormat::I16 => build_stream::<i16>(&device, config, channels, sample_rate, buffer),
        cpal::SampleFormat::U16 => build_stream::<u16>(&device, config, channels, sample_rate, buffer),
        cpal::SampleFormat::I32 => build_stream::<i32>(&device, config, channels, sample_rate, buffer),
        other => Err(format!("不支持的麦克风样本格式: {other:?}")),
    };
    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    if let Err(e) = stream.play() {
        let _ = ready.send(Err(format!("启动麦克风采集失败: {e}")));
        return;
    }
    let _ = ready.send(Ok(sample_rate));
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(std::time::Duration::from_millis(30));
    }
    drop(stream);
}

/// 枚举可用麦克风设备名（设置页「声音 · 麦克风」下拉用）。
/// 枚举失败返回空列表而不报错——前端仍有「系统默认」兜底可选。
#[tauri::command]
pub fn stt_devices() -> Vec<String> {
    let Ok(devices) = cpal::default_host().input_devices() else {
        return Vec::new();
    };
    devices
        .filter_map(|d| d.description().ok().map(|desc| desc.name().to_string()))
        .collect()
}

/// 按下开麦（device = 设置页指定的设备名，空/None 用系统默认）。
/// 模型文件先行检查（缺失时按下那刻就报清楚，而不是松手才炸）；
/// 采集线程就位（拿到采样率）才返回；顺手后台预热识别器。
#[tauri::command]
pub fn stt_start(
    app: AppHandle,
    state: State<SttState>,
    device: Option<String>,
) -> Result<(), String> {
    let dir = model_dir(&app)?;
    if !dir.join("sense-voice.int8.onnx").exists() {
        return Err("语音模型未就绪：开发环境请先运行 pnpm fetch:stt".into());
    }
    let mut session = state.session.lock().unwrap();
    if session.is_some() {
        return Err("已经在录音中".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let (ready_tx, ready_rx) = mpsc::channel();
    let handle = {
        let stop = stop.clone();
        let buffer = buffer.clone();
        std::thread::spawn(move || capture_thread(device, stop, buffer, ready_tx))
    };
    let sample_rate = ready_rx
        .recv()
        .map_err(|_| "采集线程意外退出".to_string())??;
    *session = Some(RecSession {
        stop,
        buffer,
        sample_rate,
        handle,
    });
    // 预热：首次按下时提前加载识别器，松手识别就不用再等那 ~1s
    let slot = state.recognizer.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = ensure_recognizer(&slot, &dir) {
            eprintln!("stt 识别器预热失败: {e}");
        }
    });
    Ok(())
}

/// 松手识别：停采集拿走缓冲 → blocking 线程里重采样 + 解码（CPU 活不堵
/// async runtime）→ 返回识别文本。太短的误触录音直接打回。
#[tauri::command]
pub async fn stt_stop(app: AppHandle, state: State<'_, SttState>) -> Result<String, String> {
    let sess = state
        .session
        .lock()
        .unwrap()
        .take()
        .ok_or("当前没有在录音")?;
    sess.stop.store(true, Ordering::Relaxed);
    let _ = sess.handle.join();
    let samples = std::mem::take(&mut *sess.buffer.lock().unwrap());
    if (samples.len() as f32) < sess.sample_rate as f32 * MIN_RECORD_SECS {
        return Err("没听清，按住说话再试一次喵".into());
    }
    let dir = model_dir(&app)?;
    let slot = state.recognizer.clone();
    let sample_rate = sess.sample_rate;
    tauri::async_runtime::spawn_blocking(move || {
        ensure_recognizer(&slot, &dir)?;
        let guard = slot.lock().unwrap();
        recognize(guard.as_ref().unwrap(), &samples, sample_rate)
    })
    .await
    .map_err(|e| format!("识别任务失败: {e}"))?
}

/// 放弃本次录音：停采集直接丢样本（指针滑出按钮/取消等场景）
#[tauri::command]
pub fn stt_cancel(state: State<SttState>) -> Result<(), String> {
    if let Some(sess) = state.session.lock().unwrap().take() {
        sess.stop.store(true, Ordering::Relaxed);
        let _ = sess.handle.join();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sherpa_onnx::Wave;

    /// 识别链路冒烟：STT_TEST_WAV 指向样例 wav（模型包里的 test_wavs/zh.wav），
    /// 未设置则静默跳过。跑法：
    ///   $env:STT_TEST_WAV="...zh.wav"; cargo test recognize_sample -- --nocapture
    #[test]
    fn recognize_sample_wav() {
        let Ok(wav_path) = std::env::var("STT_TEST_WAV") else {
            return;
        };
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/stt");
        let recognizer = load_recognizer(&dir).expect("加载识别器失败");
        let wave = Wave::read(&wav_path).expect("读样例 wav 失败");
        let text =
            recognize(&recognizer, wave.samples(), wave.sample_rate() as u32).expect("识别失败");
        println!("识别结果: {text}");
        assert!(!text.is_empty(), "识别结果不应为空");
    }
}
