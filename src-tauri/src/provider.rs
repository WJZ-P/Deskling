//! AI Provider 多协议抽象。
//!
//! 各家厂商端点/请求体/鉴权头不同，抽象成一个 `Protocol` trait：
//!  - `endpoint(profile)`  —— 拼出完整请求 URL（含 baseUrl + path，Gemini 还要塞 model）；
//!  - `apply_auth(req)`    —— 按协议加鉴权头（x-api-key vs Authorization: Bearer）；
//!  - `probe_body()`       —— 「测试连接」用的最小请求体（1 token，探活即可）。
//!
//! `ProviderProfile` 的 `protocol` 字段决定用哪个 impl。P0 先做「测试连接」，
//! 后续的对话流式（agent loop）复用同一套 endpoint/auth，只是换成真实 messages + 解析 SSE。

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

/// 在途流式请求的取消登记表：requestId → 取消标志。
/// 前端「暂停」按钮调 `provider_chat_cancel(requestId)` 把标志置真，
/// 对应的 `provider_chat` 读流循环每收一块就查一次，见真即收尾（发 Done 退出）。
/// 用 Arc<AtomicBool> 让命令持有自己那份句柄，登记表里删掉后仍能安全读。
fn cancel_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REG: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 注册一个请求的取消标志并拿到句柄（重复 id 覆盖旧的）。
fn register_cancel(request_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut reg) = cancel_registry().lock() {
        reg.insert(request_id.to_string(), flag.clone());
    }
    flag
}

/// 请求收尾时从登记表移除自己的标志（正常结束 / 出错 / 被取消都要清）。
fn unregister_cancel(request_id: &str) {
    if let Ok(mut reg) = cancel_registry().lock() {
        reg.remove(request_id);
    }
}

/// 一轮对话消息（前端传来的历史）：role = user / assistant，content 为纯文本。
/// P0 只走文本；后续接工具调用时再扩展成 segments。
#[derive(Debug, Clone, Deserialize)]
pub struct ChatTurn {
    pub role: String,
    pub content: String,
}

/// 流式对话事件：通过 tauri Channel 逐条推给前端。
/// tag="type" → 前端拿到 { type: "delta" | "done" | "error", ... }。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    /// 一段增量文本（token / token 片段）。
    Delta { text: String },
    /// 流正常结束。
    Done,
    /// 出错（网络 / HTTP / 解析）；带一句人话给前端展示。
    Error { message: String },
}

/// 前端 settings.ts 的 ProviderProfile 镜像（字段名对齐，serde 直接反序列化）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfile {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

/// 「测试连接」返回给前端的结果。
#[derive(Debug, Serialize)]
pub struct TestResult {
    pub ok: bool,
    pub message: String,
}

/// 协议适配器：把统一的 profile 翻译成各家具体的 HTTP 形态。
/// : Send —— provider_test 是 async 命令，Box<dyn Protocol> 会跨 await 持有，
/// Tauri 要求 future 为 Send，故适配器本身也须 Send。
trait Protocol: Send {
    /// 「测试连接」用的完整请求 URL（非流式探活）。
    fn endpoint(&self, p: &ProviderProfile) -> String;
    /// 按协议施加鉴权头（探活 / 对话共用）。
    fn apply_auth(&self, req: reqwest::RequestBuilder, p: &ProviderProfile) -> reqwest::RequestBuilder;
    /// 探活用最小请求体（尽量少 token）。
    fn probe_body(&self, p: &ProviderProfile) -> Value;

    // ---- 流式对话（agent loop 的文本骨架）----
    /// 流式对话的完整请求 URL（Gemini 换 streamGenerateContent，其余同探活端点）。
    fn chat_endpoint(&self, p: &ProviderProfile) -> String;
    /// 把历史消息拼成该协议的流式请求体（stream=true / alt=sse 等）。
    fn chat_body(&self, p: &ProviderProfile, history: &[ChatTurn]) -> Value;
    /// 解析一条 SSE data 行的 JSON，抽出其中的增量文本（无文本则 None）。
    fn parse_delta(&self, data: &Value) -> Option<String>;
}

/// 把统一历史翻成 OpenAI / Anthropic 通用的 messages 数组。
fn messages_array(history: &[ChatTurn]) -> Value {
    Value::Array(
        history
            .iter()
            .map(|m| json!({ "role": m.role, "content": m.content }))
            .collect(),
    )
}

/// 去掉 baseUrl 末尾斜杠，避免拼出双斜杠。
fn trim_base(base: &str) -> &str {
    base.trim_end_matches('/')
}

// ---- Anthropic ----
struct Anthropic;
impl Protocol for Anthropic {
    fn endpoint(&self, p: &ProviderProfile) -> String {
        format!("{}/v1/messages", trim_base(&p.base_url))
    }
    fn apply_auth(&self, req: reqwest::RequestBuilder, p: &ProviderProfile) -> reqwest::RequestBuilder {
        req.header("x-api-key", &p.api_key)
            .header("anthropic-version", "2023-06-01")
    }
    fn probe_body(&self, p: &ProviderProfile) -> Value {
        json!({
            "model": p.model,
            "max_tokens": 1,
            "messages": [{ "role": "user", "content": "ping" }],
        })
    }
    fn chat_endpoint(&self, p: &ProviderProfile) -> String {
        // 对话与探活同端点，SSE 由请求体 stream=true 触发
        self.endpoint(p)
    }
    fn chat_body(&self, p: &ProviderProfile, history: &[ChatTurn]) -> Value {
        // Anthropic：max_tokens 必填；temperature 可选
        let mut body = json!({
            "model": p.model,
            "max_tokens": p.max_tokens.unwrap_or(4096),
            "stream": true,
            "messages": messages_array(history),
        });
        if let Some(temp) = p.temperature {
            body["temperature"] = json!(temp);
        }
        body
    }
    fn parse_delta(&self, data: &Value) -> Option<String> {
        // Anthropic SSE：只在 content_block_delta 里取 delta.text
        if data.get("type").and_then(Value::as_str) == Some("content_block_delta") {
            data.get("delta")
                .and_then(|d| d.get("text"))
                .and_then(Value::as_str)
                .map(str::to_string)
        } else {
            None
        }
    }
}

// ---- OpenAI / OpenAI 兼容 ----
// 智能识别用户 baseUrl 已经填到哪一层，避免重复拼路径（如 .../v1 再拼 /v1 → 404）：
//  - 已含 /chat/completions（完整端点）        → 原样用；
//  - 以 /v1、/v2… 版本段结尾（OpenAI SDK 惯例）→ 只接 /chat/completions；
//  - 只是主机                                  → 补完整 /v1/chat/completions。
// 官方与兼容端点共用此逻辑：只要用户按常见习惯填 baseUrl，都能拼对。
struct OpenAi;
fn openai_endpoint(base: &str) -> String {
    let base = trim_base(base);
    if base.contains("/chat/completions") {
        base.to_string()
    } else if ends_with_version_seg(base) {
        format!("{}/chat/completions", base)
    } else {
        format!("{}/v1/chat/completions", base)
    }
}
/// 判断 URL 是否以版本段（/v1、/v2、/v1beta…）结尾。
fn ends_with_version_seg(base: &str) -> bool {
    base.rsplit('/')
        .next()
        .map(|seg| {
            let s = seg.strip_prefix('v').unwrap_or("");
            !s.is_empty() && s.chars().next().is_some_and(|c| c.is_ascii_digit())
        })
        .unwrap_or(false)
}
impl Protocol for OpenAi {
    fn endpoint(&self, p: &ProviderProfile) -> String {
        openai_endpoint(&p.base_url)
    }
    fn apply_auth(&self, req: reqwest::RequestBuilder, p: &ProviderProfile) -> reqwest::RequestBuilder {
        req.bearer_auth(&p.api_key)
    }
    fn probe_body(&self, p: &ProviderProfile) -> Value {
        json!({
            "model": p.model,
            "max_tokens": 1,
            "messages": [{ "role": "user", "content": "ping" }],
        })
    }
    fn chat_endpoint(&self, p: &ProviderProfile) -> String {
        self.endpoint(p)
    }
    fn chat_body(&self, p: &ProviderProfile, history: &[ChatTurn]) -> Value {
        // OpenAI 兼容：stream=true；stream_options 让最后带 usage（可选，不强依赖）
        let mut body = json!({
            "model": p.model,
            "stream": true,
            "messages": messages_array(history),
        });
        if let Some(temp) = p.temperature {
            body["temperature"] = json!(temp);
        }
        if let Some(max) = p.max_tokens {
            body["max_tokens"] = json!(max);
        }
        body
    }
    fn parse_delta(&self, data: &Value) -> Option<String> {
        // OpenAI SSE：choices[0].delta.content
        data.get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("delta"))
            .and_then(|d| d.get("content"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    }
}

// ---- Google Gemini ----
struct Gemini;
impl Protocol for Gemini {
    fn endpoint(&self, p: &ProviderProfile) -> String {
        // Gemini 走 REST：模型名嵌在路径里，非流式探活用 generateContent
        format!(
            "{}/v1beta/models/{}:generateContent",
            trim_base(&p.base_url),
            p.model
        )
    }
    fn apply_auth(&self, req: reqwest::RequestBuilder, p: &ProviderProfile) -> reqwest::RequestBuilder {
        // Gemini 用 x-goog-api-key 头（也支持 ?key= query，这里用头更统一）
        req.header("x-goog-api-key", &p.api_key)
    }
    fn probe_body(&self, _p: &ProviderProfile) -> Value {
        json!({
            "contents": [{ "parts": [{ "text": "ping" }] }],
            "generationConfig": { "maxOutputTokens": 1 },
        })
    }
    fn chat_endpoint(&self, p: &ProviderProfile) -> String {
        // 流式走 streamGenerateContent；?alt=sse 让它吐标准 SSE（data: 行），
        // 否则默认返回一个 JSON 数组流，前端/解析都更麻烦。
        format!(
            "{}/v1beta/models/{}:streamGenerateContent?alt=sse",
            trim_base(&p.base_url),
            p.model
        )
    }
    fn chat_body(&self, p: &ProviderProfile, history: &[ChatTurn]) -> Value {
        // Gemini：role 只认 user / model（assistant → model）；文本装进 parts[].text
        let contents: Vec<Value> = history
            .iter()
            .map(|m| {
                let role = if m.role == "assistant" { "model" } else { "user" };
                json!({ "role": role, "parts": [{ "text": m.content }] })
            })
            .collect();
        let mut gen = serde_json::Map::new();
        if let Some(temp) = p.temperature {
            gen.insert("temperature".into(), json!(temp));
        }
        if let Some(max) = p.max_tokens {
            gen.insert("maxOutputTokens".into(), json!(max));
        }
        let mut body = json!({ "contents": contents });
        if !gen.is_empty() {
            body["generationConfig"] = Value::Object(gen);
        }
        body
    }
    fn parse_delta(&self, data: &Value) -> Option<String> {
        // Gemini SSE：candidates[0].content.parts[*].text，拼接一条 chunk 内多段
        let parts = data
            .get("candidates")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("content"))
            .and_then(|c| c.get("parts"))
            .and_then(Value::as_array)?;
        let text: String = parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect();
        (!text.is_empty()).then_some(text)
    }
}

/// 按 profile.protocol 分发到具体协议适配器。
/// openai / openai-compatible 共用 OpenAi —— 端点构造器已能识别 baseUrl 到哪一层
/// （完整端点 / 带 /v1 / 纯主机），故不必再按协议区分。
fn resolve(protocol: &str) -> Box<dyn Protocol> {
    match protocol {
        "anthropic" => Box::new(Anthropic),
        "gemini" => Box::new(Gemini),
        _ => Box::new(OpenAi),
    }
}

/// 「测试连接」：按 profile 发一个最小探测请求，只看 HTTP 状态是否成功。
/// 返回结果始终是 Ok（把失败包在 TestResult.ok=false 里），便于前端统一展示。
#[tauri::command]
pub async fn provider_test(profile: ProviderProfile) -> TestResult {
    if profile.api_key.trim().is_empty() {
        return TestResult { ok: false, message: "API Key 为空".into() };
    }
    if profile.base_url.trim().is_empty() {
        return TestResult { ok: false, message: "Base URL 为空".into() };
    }

    let proto = resolve(&profile.protocol);
    let url = proto.endpoint(&profile);
    let body = proto.probe_body(&profile);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
    {
        Ok(c) => c,
        Err(e) => return TestResult { ok: false, message: format!("客户端初始化失败: {e}") },
    };

    let req = proto
        .apply_auth(client.post(&url), &profile)
        .header("content-type", "application/json")
        .json(&body);

    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                TestResult { ok: true, message: format!("连接成功 ({})", status.as_u16()) }
            } else {
                // 读一点响应体，把厂商的错误信息带回去（截断避免过长）
                let text = resp.text().await.unwrap_or_default();
                let snippet: String = text.chars().take(200).collect();
                TestResult {
                    ok: false,
                    message: format!("HTTP {}: {}", status.as_u16(), snippet),
                }
            }
        }
        Err(e) => {
            let reason = if e.is_timeout() {
                "请求超时".to_string()
            } else if e.is_connect() {
                "无法连接到服务器".to_string()
            } else {
                e.to_string()
            };
            TestResult { ok: false, message: reason }
        }
    }
}

/// 流式对话：按 profile + 历史消息发一个 SSE 请求，逐条把增量文本经 Channel 推给前端。
///
/// 事件顺序：0..N 个 `delta` → 一个 `done`（正常收尾）；任何环节出错则发一个 `error` 后终止。
/// 命令本身总是返回 Ok(())：失败信息走 `ChatEvent::Error`，让前端只监听一处。
///
/// SSE 解析：reqwest 的 bytes_stream 给的是任意切分的字节块，可能把一行劈成两半，
/// 故用一个字节缓冲累积，按 `\n` 切出完整行再处理；`data:` 行的负载解析成 JSON
/// 交给协议的 parse_delta 抽文本。OpenAI 末尾的 `data: [DONE]` 当作正常结束哨兵。
/// 收尾即从取消登记表移除自己的 RAII 守卫：无论正常结束、出错还是被取消，
/// provider_chat 的任一退出路径都会走它的 Drop，保证标志不残留。
struct CancelGuard(String);
impl Drop for CancelGuard {
    fn drop(&mut self) {
        unregister_cancel(&self.0);
    }
}

/// 取消一次在途流式对话：把该 requestId 的取消标志置真。
/// 对应的 provider_chat 读流循环下一次查标志时收尾退出。找不到（已结束）则无操作。
#[tauri::command]
pub fn provider_chat_cancel(request_id: String) {
    if let Ok(reg) = cancel_registry().lock() {
        if let Some(flag) = reg.get(&request_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

#[tauri::command]
pub async fn provider_chat(
    request_id: String,
    profile: ProviderProfile,
    history: Vec<ChatTurn>,
    on_event: tauri::ipc::Channel<ChatEvent>,
) -> Result<(), String> {
    // 登记取消标志并拿句柄；_guard 在函数任一退出点 Drop 时把登记项清掉
    let cancel = register_cancel(&request_id);
    let _guard = CancelGuard(request_id);

    // 参数兜底：缺 key / baseUrl 直接以 error 事件收场
    if profile.api_key.trim().is_empty() {
        let _ = on_event.send(ChatEvent::Error { message: "API Key 为空".into() });
        return Ok(());
    }
    if profile.base_url.trim().is_empty() {
        let _ = on_event.send(ChatEvent::Error { message: "Base URL 为空".into() });
        return Ok(());
    }

    let proto = resolve(&profile.protocol);
    let url = proto.chat_endpoint(&profile);
    let body = proto.chat_body(&profile, &history);

    // 流式请求不设总超时（回答可能很长），只设连接超时，避免拨号卡死。
    let client = match reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            let _ = on_event.send(ChatEvent::Error { message: format!("客户端初始化失败: {e}") });
            return Ok(());
        }
    };

    let req = proto
        .apply_auth(client.post(&url), &profile)
        .header("content-type", "application/json")
        .header("accept", "text/event-stream")
        .json(&body);

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            let reason = if e.is_timeout() {
                "请求超时".to_string()
            } else if e.is_connect() {
                "无法连接到服务器".to_string()
            } else {
                e.to_string()
            };
            let _ = on_event.send(ChatEvent::Error { message: reason });
            return Ok(());
        }
    };

    // 非 2xx：读一点响应体带回错误信息（截断）
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let snippet: String = text.chars().take(300).collect();
        let _ = on_event.send(ChatEvent::Error {
            message: format!("HTTP {}: {}", status.as_u16(), snippet),
        });
        return Ok(());
    }

    // 逐块读流，按行拆 SSE
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        // 用户点了暂停：置了取消标志 → 立即收尾（drop stream 断开连接）。
        // 发一个 Done 让前端统一走收尾路径（前端已本地置为已中止，忽略迟到事件）。
        if cancel.load(Ordering::SeqCst) {
            let _ = on_event.send(ChatEvent::Done);
            return Ok(());
        }
        let bytes = match chunk {
            Ok(b) => b,
            Err(e) => {
                let _ = on_event.send(ChatEvent::Error { message: format!("流读取中断: {e}") });
                return Ok(());
            }
        };
        buf.extend_from_slice(&bytes);

        // 切出所有完整行（保留最后未收尾的残行在 buf 里）
        while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=nl).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim();
            // 空行是 SSE 事件分隔；注释行以 ':' 开头 —— 都跳过
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            let payload = match line.strip_prefix("data:") {
                Some(rest) => rest.trim(),
                None => continue, // 只关心 data: 行（event:/id: 等忽略）
            };
            // OpenAI 结束哨兵
            if payload == "[DONE]" {
                let _ = on_event.send(ChatEvent::Done);
                return Ok(());
            }
            if let Ok(json) = serde_json::from_str::<Value>(payload) {
                if let Some(text) = proto.parse_delta(&json) {
                    let _ = on_event.send(ChatEvent::Delta { text });
                }
            }
        }
    }

    // 流自然结束（Anthropic/Gemini 没有 [DONE] 哨兵，走到这里即完成）
    let _ = on_event.send(ChatEvent::Done);
    Ok(())
}
