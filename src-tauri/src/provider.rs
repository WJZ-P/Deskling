//! AI Provider 多协议抽象。
//!
//! 各家厂商端点/请求体/鉴权头不同，抽象成一个 `Protocol` trait：
//!  - `endpoint(profile)`  —— 拼出完整请求 URL（含 baseUrl + path，Gemini 还要塞 model）；
//!  - `apply_auth(req)`    —— 按协议加鉴权头（x-api-key vs Authorization: Bearer）；
//!  - `probe_body()`       —— 「测试连接」用的最小请求体（1 token，探活即可）。
//!
//! `ProviderProfile` 的 `protocol` 字段决定用哪个 impl。P0 先做「测试连接」，
//! 后续的对话流式（agent loop）复用同一套 endpoint/auth，只是换成真实 messages + 解析 SSE。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
    /// 完整请求 URL。
    fn endpoint(&self, p: &ProviderProfile) -> String;
    /// 按协议施加鉴权头。
    fn apply_auth(&self, req: reqwest::RequestBuilder, p: &ProviderProfile) -> reqwest::RequestBuilder;
    /// 探活用最小请求体（尽量少 token）。
    fn probe_body(&self, p: &ProviderProfile) -> Value;
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
}

// ---- OpenAI / OpenAI 兼容 ----
struct OpenAi;
impl Protocol for OpenAi {
    fn endpoint(&self, p: &ProviderProfile) -> String {
        format!("{}/v1/chat/completions", trim_base(&p.base_url))
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
}

/// 按 profile.protocol 分发到具体协议适配器。
fn resolve(protocol: &str) -> Box<dyn Protocol> {
    match protocol {
        "anthropic" => Box::new(Anthropic),
        "gemini" => Box::new(Gemini),
        // openai / openai-compatible 共用 OpenAI 适配器（端点、请求体一致，仅 baseUrl 不同）
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
