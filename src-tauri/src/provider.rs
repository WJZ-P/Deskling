//! AI Provider 多协议抽象 + agent loop。
//!
//! 每家厂商端点/请求体/鉴权头/流式格式/工具调用格式都不同，抽象成一个 `Protocol` trait：
//!  - `endpoint / apply_auth / probe_body`             —— 「测试连接」；
//!  - `chat_endpoint / initial_messages / build_body`  —— 起一次真实对话请求；
//!  - `consume`                                        —— 处理一条 SSE JSON：文本发 Delta，
//!                                                        工具调用累进 StreamAcc；
//!  - `append_assistant_turn / append_tool_result`     —— 把这一轮的助手输出（文本 + 工具调用）
//!                                                        和执行结果续进 messages，供下轮请求。
//!
//! agent loop（`provider_chat`）：外层循环——发请求 → 流式读 → 累积工具调用 →
//! 无调用则收尾；有调用则逐个执行（写/命令类先停下等审批）→ append 结果 → 继续下一轮。

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::oneshot;

use crate::skills;
use crate::tools;

/// 工具调用纪律片段（主/子 agent 的 system prompt 恒注入）。
/// 背景：跨轮历史把过往工具调用压成「[工具调用记录 …]」纯文本（前端 toHistory），
/// 模型会见样学样在正文里手写该格式冒充调用——不走原生接口就什么都没执行，
/// 却让主人以为干了活。必须明文告诫。
const TOOL_DISCIPLINE: &str = "【工具调用规范】需要使用工具时，必须通过原生的工具调用接口（tool call）发起，\
绝不要在回复正文里手写「[调用工具 …]」「[工具调用记录 …]」之类的文字——历史消息里的这类文字\
只是过往调用的存档记录，写在正文里不会真正执行任何工具，还会误导主人。";

// ---- 取消登记表（保持原有语义）--------------------------------------------------

/// 在途流式请求的取消登记表：requestId → 取消标志。
/// 前端「暂停」按钮调 `provider_chat_cancel(requestId)` 把标志置真，
/// 对应的 agent loop 每读一块 / 每次等审批前后都查一次，见真即收尾。
fn cancel_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REG: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_cancel(request_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut reg) = cancel_registry().lock() {
        reg.insert(request_id.to_string(), flag.clone());
    }
    flag
}

fn unregister_cancel(request_id: &str) {
    if let Ok(mut reg) = cancel_registry().lock() {
        reg.remove(request_id);
    }
}

// ---- 审批登记表 -----------------------------------------------------------------

/// 一次审批的作答：同意 / 拒绝 / 被取消。取消通常由 `provider_chat_cancel` 触发，
/// 用来叫醒阻塞等审批的 agent loop（否则会一直挂着）。
#[derive(Debug)]
enum ApprovalMsg {
    Approved,
    Rejected,
    Canceled,
}

/// 待审批工具调用的登记表：key = "requestId:toolCallId" → 作答通道的发送端。
/// 每次进 pending 建一个 oneshot，前端调 `provider_tool_approve` 后从此处取出发送端喂结果。
fn approval_registry() -> &'static Mutex<HashMap<String, oneshot::Sender<ApprovalMsg>>> {
    static REG: OnceLock<Mutex<HashMap<String, oneshot::Sender<ApprovalMsg>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_approval(key: &str) -> oneshot::Receiver<ApprovalMsg> {
    let (tx, rx) = oneshot::channel();
    if let Ok(mut reg) = approval_registry().lock() {
        reg.insert(key.to_string(), tx);
    }
    rx
}

fn resolve_approval(key: &str, msg: ApprovalMsg) {
    if let Ok(mut reg) = approval_registry().lock() {
        if let Some(tx) = reg.remove(key) {
            let _ = tx.send(msg);
        }
    }
}

/// 取消一次请求下所有在等的审批（发 Canceled 叫醒阻塞的 loop）。
fn cancel_request_approvals(request_id: &str) {
    let prefix = format!("{request_id}:");
    if let Ok(mut reg) = approval_registry().lock() {
        let keys: Vec<String> = reg
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect();
        for key in keys {
            if let Some(tx) = reg.remove(&key) {
                let _ = tx.send(ApprovalMsg::Canceled);
            }
        }
    }
}

/// 前端点「同意 / 拒绝」时调这个命令，唤醒对应 agent loop 的 await。
#[tauri::command]
pub fn provider_tool_approve(request_id: String, tool_call_id: String, approved: bool) {
    let key = format!("{request_id}:{tool_call_id}");
    resolve_approval(
        &key,
        if approved { ApprovalMsg::Approved } else { ApprovalMsg::Rejected },
    );
}

// ---- 前后端数据类型 ------------------------------------------------------------

/// 一轮对话消息（前端传来的历史）：跨轮上下文，纯文本形态。
/// agent 单轮内的 tool_use/tool_result 由后端在 loop 里以协议原生 JSON 追加进 messages，
/// 不经过这个类型。
#[derive(Debug, Clone, Deserialize)]
pub struct ChatTurn {
    pub role: String,
    pub content: String,
}

/// 流式对话事件：通过 tauri Channel 逐条推给前端。
/// tag="type", rename_all="camelCase" → 前端拿到
/// `{ type: "delta" | "thinking" | "toolStart" | "toolEnd" | "done" | "error", ... }`。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    /// 一段增量文本（token / 片段）。
    Delta { text: String },
    /// 一段思考增量：推理模型（DeepSeek R1 等）与正文分开下发的 reasoning 文本。
    /// 只推给前端渲染成可折叠思考块；不累入 text_buf → 不进跨轮历史。
    Thinking { text: String },
    /// 模型请求一个工具调用：Rust 已解析出 id/name/args。
    /// needs_approval=true 时前端把工具段落成 pending 态、显示同意/拒绝按钮；
    /// 否则直接 running（loop 已在执行）。
    #[serde(rename_all = "camelCase")]
    ToolStart {
        id: String,
        name: String,
        summary: String,
        /// 参数的原始 JSON 字符串（前端展示 / 跨轮 history 重建都用它）
        args: String,
        needs_approval: bool,
    },
    /// 一个工具调用收尾：status = success / error，detail 是结果或错误串。
    ToolEnd {
        id: String,
        status: String,
        detail: String,
    },
    /// 子 agent（subagent 工具）执行中的一步进展：line = 一行摘要（在干嘛），
    /// id = 父级 subagent 工具调用的 id。前端把它追加进那张工具卡的子步骤日志，
    /// 让用户看到子 agent 具体在做什么；不进主消息、不驱动桌宠。
    #[serde(rename_all = "camelCase")]
    SubagentStep { id: String, line: String },
    /// 整轮对话正常结束。
    Done,
    /// 出错（网络 / HTTP / 解析）；带一句人话给前端展示。
    Error { message: String },
}

/// 前端 settings.ts 的 ProviderProfile 镜像。
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

// ---- 流式累积器 ----------------------------------------------------------------

/// 单轮流式响应的累积状态：
///  - text_buf：assistant 本轮说的自然语言（工具调用前后可能有文本），
///    用于事后 append 到 messages 里的助手轮 content。
///  - tools：本轮模型请求的工具调用；OpenAI/Anthropic 的参数是分片流入的，
///    slot 用来定位续接位置；Gemini 一次给整份，直接压入。
#[derive(Default)]
struct StreamAcc {
    text_buf: String,
    tools: Vec<PartialToolCall>,
}

/// 一个尚未收尾的工具调用（流式过程中）。
struct PartialToolCall {
    /// 协议内的定位键：OpenAI = tool_calls[index]，Anthropic = content_block.index，Gemini = 递增序号
    slot: usize,
    id: String,
    name: String,
    /// 参数 JSON 的累积串（Gemini 一次给全，OpenAI/Anthropic 分片累加）
    args_buf: String,
}

impl StreamAcc {
    /// 按 slot 取或创建一条 PartialToolCall（供 OpenAI/Anthropic 累加分片时定位）。
    fn slot_mut(&mut self, slot: usize) -> &mut PartialToolCall {
        if let Some(pos) = self.tools.iter().position(|t| t.slot == slot) {
            return &mut self.tools[pos];
        }
        self.tools.push(PartialToolCall {
            slot,
            id: String::new(),
            name: String::new(),
            args_buf: String::new(),
        });
        self.tools.last_mut().unwrap()
    }
}

/// 一次已完成的工具调用（含执行结果），用于 append 到下一轮 messages。
struct CompletedCall {
    id: String,
    name: String,
    args_str: String,
    /// Ok(输出) / Err(错误串或用户拒绝)
    result: Result<String, String>,
}

impl CompletedCall {
    fn is_error(&self) -> bool {
        self.result.is_err()
    }
    fn content_str(&self) -> &str {
        match &self.result {
            Ok(s) => s,
            Err(s) => s,
        }
    }
}

// ---- Protocol trait ------------------------------------------------------------

/// 协议适配器：把统一的 profile + 历史翻译成各家具体的 HTTP + JSON 形态。
trait Protocol: Send + Sync {
    // 探活
    fn endpoint(&self, p: &ProviderProfile) -> String;
    fn apply_auth(
        &self,
        req: reqwest::RequestBuilder,
        p: &ProviderProfile,
    ) -> reqwest::RequestBuilder;
    fn probe_body(&self, p: &ProviderProfile) -> Value;

    // 流式对话
    fn chat_endpoint(&self, p: &ProviderProfile) -> String;
    /// 把跨轮纯文本历史翻成协议原生 messages 数组。
    fn initial_messages(&self, history: &[ChatTurn]) -> Vec<Value>;
    /// 用当前 messages 构造完整请求体（stream=true / tools/functions 声明都在里面）。
    /// thinking=true 时请求模型下发思考过程：Anthropic 加 thinking(adaptive)、
    /// Gemini 加 thinkingConfig(includeThoughts)；OpenAI 兼容协议无标准开关，忽略
    /// （推理模型的 reasoning_content 由服务端自行下发，consume 侧始终解析）。
    /// system：人设/系统提示词（当前桌宠档案的 prompt）。只在对话开头出现一次、
    /// 不随轮次重复插入：Anthropic 走顶层 system 字段、OpenAI 走首条 role=system
    /// 消息、Gemini 走 systemInstruction —— 三家都是独立于对话轮的原生形态。
    fn build_body(
        &self,
        p: &ProviderProfile,
        messages: &[Value],
        thinking: bool,
        system: Option<&str>,
        // 是否把 subagent 工具也声明给模型（仅主 agent true；子 agent false，不递归）
        include_subagent: bool,
    ) -> Value;
    /// 消化一条 SSE data 行的 JSON：文本立即 emit Delta，工具调用累进 acc。
    /// on_event=None：子 agent 用——只把文本/工具累进 acc，不向前端发 Delta/Thinking
    /// （子 agent 的原始输出不进主对话，只有最终结论作为工具结果回给主 agent）。
    fn consume(
        &self,
        json: &Value,
        acc: &mut StreamAcc,
        on_event: Option<&tauri::ipc::Channel<ChatEvent>>,
    );
    /// 把这一轮助手的输出（自然语言 + 工具调用）追加进 messages（协议原生形态）。
    fn append_assistant_turn(&self, messages: &mut Vec<Value>, text: &str, tools: &[CompletedCall]);
    /// 把每个工具的执行结果追加进 messages（OpenAI 是 role=tool 单独一轮，Anthropic/Gemini 是 role=user/user 带特殊 parts）。
    fn append_tool_results(&self, messages: &mut Vec<Value>, tools: &[CompletedCall]);
}

/// 去掉 baseUrl 末尾斜杠，避免拼出双斜杠。
fn trim_base(base: &str) -> &str {
    base.trim_end_matches('/')
}

/// 发给模型的完整工具清单：基础工具 + （仅主 agent）subagent。
/// include_subagent=false 时不含 subagent——子 agent 拿不到它，从根上杜绝无限递归。
fn full_tool_specs(include_subagent: bool) -> Vec<tools::ToolSpec> {
    let mut v = tools::tool_specs();
    if include_subagent {
        v.push(tools::subagent_spec());
    }
    v
}

/// 把工具规范翻成 OpenAI / Anthropic 通用的 JSON Schema 声明形态。
fn openai_tools_array(include_subagent: bool) -> Value {
    let arr: Vec<Value> = full_tool_specs(include_subagent)
        .into_iter()
        .map(|t| {
            json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                }
            })
        })
        .collect();
    Value::Array(arr)
}

fn anthropic_tools_array(include_subagent: bool) -> Value {
    let arr: Vec<Value> = full_tool_specs(include_subagent)
        .into_iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "input_schema": t.parameters,
            })
        })
        .collect();
    Value::Array(arr)
}

fn gemini_tools_array(include_subagent: bool) -> Value {
    let decls: Vec<Value> = full_tool_specs(include_subagent)
        .into_iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            })
        })
        .collect();
    // Gemini 把所有函数声明放在一个 tools 项的 functionDeclarations 里
    json!([{ "functionDeclarations": decls }])
}

/// 工具执行分派：load_skill 由技能注册表就地取 SKILL.md 全文（只读、无副作用），
/// 其余工具走 tools::execute。单独抽出来是因为 load_skill 需要技能注册表，而
/// tools::execute 是无上下文的自由函数拿不到。
async fn run_tool(
    name: &str,
    args: &Value,
    skill_registry: &[skills::Skill],
) -> Result<String, String> {
    if name == "load_skill" {
        let n = args.get("name").and_then(Value::as_str).unwrap_or("");
        Ok(skills::load(skill_registry, n))
    } else {
        tools::execute(name, args).await
    }
}

/// 子 agent：主 agent 调 subagent 工具时跑的嵌套循环。独立完成一个子任务，
/// 只把最终结论作为工具结果返回。过程「不完全静默」——每步用 SubagentStep 事件
/// 回报到父级那张工具卡（让用户看到它在干嘛），但不发 Delta/不驱动桌宠。
/// 全套工具 + 强制免审批（内部工具直接执行，不等审批）+ 不提供 subagent 工具
/// （build_body 传 false，从根上不递归）+ 自己的步数上限。
#[allow(clippy::too_many_arguments)]
async fn run_subagent(
    proto: &dyn Protocol,
    client: &reqwest::Client,
    profile: &ProviderProfile,
    thinking: bool,
    skill_registry: &[skills::Skill],
    cancel: &std::sync::atomic::AtomicBool,
    on_event: &tauri::ipc::Channel<ChatEvent>,
    parent_id: &str,
    args: &Value,
) -> Result<String, String> {
    let task = args
        .get("task")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if task.is_empty() {
        return Err("subagent 缺少 task 参数".into());
    }

    let step = |line: String| {
        let _ = on_event.send(ChatEvent::SubagentStep {
            id: parent_id.to_string(),
            line,
        });
    };
    step(format!(
        "接到子任务：{}",
        task.chars().take(40).collect::<String>()
    ));

    // 子 agent 系统提示：自主多步、看不到主对话、给出最终结论、别再开子 agent。
    // 技能清单照样给它（子 agent 也能用技能）；长期记忆同样注入——子任务常带
    // 主人背景（如按喜好办事），且它也有 remember 工具，读写要对称，不然它
    // 看不见已有记忆、换个措辞就会写出近似重复的条目。
    let sub_system = format!(
        "你是一个子 agent，被主 agent 指派独立完成一个子任务。你看不到主对话上下文，\
         只有下面这个任务说明。请自主使用工具多步完成它，完成后用一段清晰的文字给出最终\
         结论/产出——这段文字会作为结果回给主 agent。不要再调用 subagent 工具。\n\n{}\n\n{}\n\n{}",
        skills::system_prompt_fragment(skill_registry).unwrap_or_default(),
        crate::memory::prompt_fragment().unwrap_or_default(),
        TOOL_DISCIPLINE
    );

    let mut messages = proto.initial_messages(&[ChatTurn {
        role: "user".into(),
        content: task,
    }]);

    const MAX_SUB_STEPS: usize = 10;
    for _ in 0..MAX_SUB_STEPS {
        if cancel.load(Ordering::SeqCst) {
            return Err("已取消".into());
        }
        let url = proto.chat_endpoint(profile);
        // 子 agent：include_subagent=false（拿不到 subagent 工具，不递归）
        let body = proto.build_body(profile, &messages, thinking, Some(&sub_system), false);
        let resp = match proto
            .apply_auth(client.post(&url), profile)
            .header("content-type", "application/json")
            .header("accept", "text/event-stream")
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Err(format!("子 agent 请求失败：{e}")),
        };
        if !resp.status().is_success() {
            let code = resp.status().as_u16();
            let t = resp.text().await.unwrap_or_default();
            return Err(format!(
                "子 agent HTTP {}: {}",
                code,
                t.chars().take(200).collect::<String>()
            ));
        }

        // 流式读一轮，静默累积（consume 传 None，不把子 agent 的原始文本发给前端）
        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        let mut acc = StreamAcc::default();
        let mut done_sentinel = false;
        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::SeqCst) {
                return Err("已取消".into());
            }
            let bytes = match chunk {
                Ok(b) => b,
                Err(e) => return Err(format!("子 agent 流中断：{e}")),
            };
            buf.extend_from_slice(&bytes);
            while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = buf.drain(..=nl).collect();
                let line = String::from_utf8_lossy(&line_bytes);
                let line = line.trim();
                if line.is_empty() || line.starts_with(':') {
                    continue;
                }
                let payload = match line.strip_prefix("data:") {
                    Some(rest) => rest.trim(),
                    None => continue,
                };
                if payload == "[DONE]" {
                    done_sentinel = true;
                    break;
                }
                if let Ok(jv) = serde_json::from_str::<Value>(payload) {
                    proto.consume(&jv, &mut acc, None);
                }
            }
            if done_sentinel {
                break;
            }
        }

        // 无工具调用 → 本轮文本即最终结论，收工
        if acc.tools.is_empty() {
            step("完成".into());
            let out = acc.text_buf.trim().to_string();
            return Ok(if out.is_empty() {
                "（子 agent 没有产出文本）".into()
            } else {
                out
            });
        }

        // 有工具调用：逐个执行（强制免审批，不等待），每步报一句进展
        let mut completed: Vec<CompletedCall> = Vec::with_capacity(acc.tools.len());
        for call in std::mem::take(&mut acc.tools) {
            // 与主循环对齐：一轮内多个工具时，取消能及时打断后续工具（不再逐个跑完）
            if cancel.load(Ordering::SeqCst) {
                return Err("已取消".into());
            }
            let args_val: Value = serde_json::from_str(&call.args_buf).unwrap_or_else(|_| json!({}));
            step(tools::summarize(&call.name, &args_val));
            let exec = if call.name == "subagent" {
                Err("子 agent 不能再调用 subagent".into())
            } else {
                run_tool(&call.name, &args_val, skill_registry).await
            };
            completed.push(CompletedCall {
                id: call.id,
                name: call.name,
                args_str: call.args_buf,
                result: exec,
            });
        }
        proto.append_assistant_turn(&mut messages, &acc.text_buf, &completed);
        proto.append_tool_results(&mut messages, &completed);
    }
    Err("子 agent 到达步数上限仍未完成".into())
}

/// 执行「一轮内的一个工具调用」的完整生命周期：ToolStart → 审批闸门 → 执行
/// （subagent 走嵌套子循环，其余走 run_tool）→ ToolEnd，返回 CompletedCall。
/// 被取消（取消标志置位 / 审批被 Canceled）返回 None——外层据此干净收尾，不落
/// 「失败」卡也不折进历史。抽成独立函数是为了让主循环能用 buffer_unordered 并发跑多个。
#[allow(clippy::too_many_arguments)]
async fn exec_one_tool(
    call: PartialToolCall,
    auto_approve: bool,
    thinking: bool,
    request_id: &str,
    cancel: &std::sync::atomic::AtomicBool,
    on_event: &tauri::ipc::Channel<ChatEvent>,
    proto: &dyn Protocol,
    client: &reqwest::Client,
    profile: &ProviderProfile,
    skill_registry: &[skills::Skill],
) -> Option<CompletedCall> {
    if cancel.load(Ordering::SeqCst) {
        return None;
    }
    let args_val: Value = serde_json::from_str(&call.args_buf).unwrap_or_else(|_| json!({}));
    let summary = tools::summarize(&call.name, &args_val);
    // 免审批开启时一律不进审批分支；ToolStart 的 needs_approval 也带 false，
    // 前端据此直接落 running 段（不渲染「同意/拒绝」按钮）
    let needs_approval = !auto_approve && tools::needs_approval(&call.name);

    let _ = on_event.send(ChatEvent::ToolStart {
        id: call.id.clone(),
        name: call.name.clone(),
        summary,
        args: call.args_buf.clone(),
        needs_approval,
    });

    // 审批闸门：需审批则等用户点选（并发时各工具各自弹卡、各自等）
    let approved = if needs_approval {
        let key = format!("{request_id}:{}", call.id);
        let rx = register_approval(&key);
        if cancel.load(Ordering::SeqCst) {
            if let Ok(mut reg) = approval_registry().lock() {
                reg.remove(&key);
            }
            return None;
        }
        match rx.await {
            Ok(ApprovalMsg::Approved) => true,
            Ok(ApprovalMsg::Rejected) => false,
            Ok(ApprovalMsg::Canceled) | Err(_) => return None,
        }
    } else {
        true
    };

    // 放行后执行：subagent 走嵌套子循环（全套工具 + 强制免审批 + 不再递归，过程
    // 用 SubagentStep 回报本卡片、最终结论作为工具结果），其余走常规工具分派
    let exec_result: Result<String, String> = if !approved {
        Err("用户拒绝执行此工具".into())
    } else if call.name == "subagent" {
        run_subagent(
            proto,
            client,
            profile,
            thinking,
            skill_registry,
            cancel,
            on_event,
            &call.id,
            &args_val,
        )
        .await
    } else {
        run_tool(&call.name, &args_val, skill_registry).await
    };

    // 执行期间被取消（典型：子 agent 中途被叫停，返回 Err("已取消")）：不落成一张
    // 「失败」卡、也不折进历史——取消不是工具出错，返回 None 让外层干净收尾
    if cancel.load(Ordering::SeqCst) {
        return None;
    }
    let (status_str, detail) = match &exec_result {
        Ok(out) => ("success".to_string(), out.clone()),
        Err(err) => ("error".to_string(), err.clone()),
    };
    let _ = on_event.send(ChatEvent::ToolEnd {
        id: call.id.clone(),
        status: status_str,
        detail,
    });

    Some(CompletedCall {
        id: call.id,
        name: call.name,
        args_str: call.args_buf,
        result: exec_result,
    })
}

// ---- Anthropic -----------------------------------------------------------------

struct Anthropic;
impl Protocol for Anthropic {
    fn endpoint(&self, p: &ProviderProfile) -> String {
        format!("{}/v1/messages", trim_base(&p.base_url))
    }
    fn apply_auth(
        &self,
        req: reqwest::RequestBuilder,
        p: &ProviderProfile,
    ) -> reqwest::RequestBuilder {
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
        self.endpoint(p)
    }
    fn initial_messages(&self, history: &[ChatTurn]) -> Vec<Value> {
        history
            .iter()
            .map(|m| json!({ "role": m.role, "content": m.content }))
            .collect()
    }
    fn build_body(
        &self,
        p: &ProviderProfile,
        messages: &[Value],
        thinking: bool,
        system: Option<&str>,
        include_subagent: bool,
    ) -> Value {
        let mut body = json!({
            "model": p.model,
            "max_tokens": p.max_tokens.unwrap_or(4096),
            "stream": true,
            "messages": messages,
            "tools": anthropic_tools_array(include_subagent),
        });
        if let Some(sys) = system {
            // 协议原生顶层 system 字段：不进 messages，对话全程只此一份
            body["system"] = json!(sys);
        }
        if thinking {
            // adaptive：当前世代（4.6+ / Fable）通用的思考开法；display=summarized
            // 让新模型返回可读摘要（4.7+ 默认 omitted 是空文本，开了等于白开）。
            // 更老的模型（4.5 及以前）不认 adaptive 会 400——由用户关开关回避。
            body["thinking"] = json!({ "type": "adaptive", "display": "summarized" });
        } else if let Some(temp) = p.temperature {
            // temperature 只在不思考时带：思考模式与自定义采样参数不兼容
            //（新模型整体拒收 temperature，老模型要求思考时 temp=1）
            body["temperature"] = json!(temp);
        }
        body
    }
    fn consume(
        &self,
        json: &Value,
        acc: &mut StreamAcc,
        on_event: Option<&tauri::ipc::Channel<ChatEvent>>,
    ) {
        let evt_type = json.get("type").and_then(Value::as_str).unwrap_or("");
        match evt_type {
            // 新的 content block 开始：可能是文本块，也可能是工具调用块
            "content_block_start" => {
                let idx = json.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                if let Some(block) = json.get("content_block") {
                    if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                        let id = block
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let name = block
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let call = acc.slot_mut(idx);
                        call.id = id;
                        call.name = name;
                    }
                }
            }
            "content_block_delta" => {
                let idx = json.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let delta = match json.get("delta") {
                    Some(d) => d,
                    None => return,
                };
                let dtype = delta.get("type").and_then(Value::as_str).unwrap_or("");
                match dtype {
                    "text_delta" => {
                        if let Some(text) = delta.get("text").and_then(Value::as_str) {
                            acc.text_buf.push_str(text);
                            if let Some(ch) = on_event {
                                let _ = ch.send(ChatEvent::Delta { text: text.to_string() });
                            }
                        }
                    }
                    "input_json_delta" => {
                        if let Some(part) = delta.get("partial_json").and_then(Value::as_str) {
                            // 仅对已开始的 tool_use 块累加（文本块不会走这里）
                            if acc.tools.iter().any(|t| t.slot == idx) {
                                let call = acc.slot_mut(idx);
                                call.args_buf.push_str(part);
                            }
                        }
                    }
                    // 思考增量（请求开了 thinking 才有）：只推前端渲染，
                    // 不入 text_buf → 不进跨轮历史（signature_delta 等一概忽略）
                    "thinking_delta" => {
                        if let Some(text) = delta.get("thinking").and_then(Value::as_str) {
                            if !text.is_empty() {
                                if let Some(ch) = on_event {
                                    let _ = ch.send(ChatEvent::Thinking {
                                        text: text.to_string(),
                                    });
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    fn append_assistant_turn(&self, messages: &mut Vec<Value>, text: &str, tools: &[CompletedCall]) {
        let mut content: Vec<Value> = Vec::new();
        if !text.is_empty() {
            content.push(json!({ "type": "text", "text": text }));
        }
        for t in tools {
            let input: Value = serde_json::from_str(&t.args_str).unwrap_or(json!({}));
            content.push(json!({
                "type": "tool_use",
                "id": t.id,
                "name": t.name,
                "input": input,
            }));
        }
        messages.push(json!({ "role": "assistant", "content": content }));
    }
    fn append_tool_results(&self, messages: &mut Vec<Value>, tools: &[CompletedCall]) {
        // Anthropic 把所有 tool_result 打包在同一条 user 消息里
        let content: Vec<Value> = tools
            .iter()
            .map(|t| {
                let mut obj = json!({
                    "type": "tool_result",
                    "tool_use_id": t.id,
                    "content": t.content_str(),
                });
                if t.is_error() {
                    obj["is_error"] = json!(true);
                }
                obj
            })
            .collect();
        messages.push(json!({ "role": "user", "content": content }));
    }
}

// ---- OpenAI / OpenAI 兼容 -------------------------------------------------------

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
    fn apply_auth(
        &self,
        req: reqwest::RequestBuilder,
        p: &ProviderProfile,
    ) -> reqwest::RequestBuilder {
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
    fn initial_messages(&self, history: &[ChatTurn]) -> Vec<Value> {
        history
            .iter()
            .map(|m| json!({ "role": m.role, "content": m.content }))
            .collect()
    }
    fn build_body(
        &self,
        p: &ProviderProfile,
        messages: &[Value],
        _thinking: bool,
        system: Option<&str>,
        include_subagent: bool,
    ) -> Value {
        // OpenAI 兼容协议没有标准思考开关（推理模型的 reasoning_content
        // 由服务端自行下发，consume 侧始终解析），thinking 参数忽略
        // system 是 OpenAI 系唯一形态：messages 首条 role=system。messages 本身
        // 不持有它（agent loop 追加的轮次在其后），每次构体时前插这一条
        let msgs: Vec<Value> = match system {
            Some(sys) => std::iter::once(json!({ "role": "system", "content": sys }))
                .chain(messages.iter().cloned())
                .collect(),
            None => messages.to_vec(),
        };
        let mut body = json!({
            "model": p.model,
            "stream": true,
            "messages": msgs,
            "tools": openai_tools_array(include_subagent),
        });
        if let Some(temp) = p.temperature {
            body["temperature"] = json!(temp);
        }
        if let Some(max) = p.max_tokens {
            body["max_tokens"] = json!(max);
        }
        body
    }
    fn consume(
        &self,
        json: &Value,
        acc: &mut StreamAcc,
        on_event: Option<&tauri::ipc::Channel<ChatEvent>>,
    ) {
        let delta = match json
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("delta"))
        {
            Some(d) => d,
            None => return,
        };
        // 思考片段（DeepSeek 系 reasoning_content / OpenRouter 系 reasoning）：
        // 推理模型把思考与正文分字段下发。思考只发给前端渲染，不入 text_buf——
        // text_buf 会拼进跨轮历史，思考文本混进去既烧 token 又污染上下文。
        if let Some(text) = delta
            .get("reasoning_content")
            .or_else(|| delta.get("reasoning"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            if let Some(ch) = on_event {
                let _ = ch.send(ChatEvent::Thinking {
                    text: text.to_string(),
                });
            }
        }
        // 文本片段
        if let Some(text) = delta
            .get("content")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            acc.text_buf.push_str(text);
            if let Some(ch) = on_event {
                let _ = ch.send(ChatEvent::Delta {
                    text: text.to_string(),
                });
            }
        }
        // 工具调用片段（按 index 累加）
        if let Some(tcs) = delta.get("tool_calls").and_then(Value::as_array) {
            for tc in tcs {
                let idx = tc.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let call = acc.slot_mut(idx);
                if let Some(id) = tc.get("id").and_then(Value::as_str) {
                    if !id.is_empty() {
                        call.id = id.to_string();
                    }
                }
                if let Some(func) = tc.get("function") {
                    if let Some(name) = func.get("name").and_then(Value::as_str) {
                        if !name.is_empty() {
                            call.name = name.to_string();
                        }
                    }
                    if let Some(args_frag) = func.get("arguments").and_then(Value::as_str) {
                        call.args_buf.push_str(args_frag);
                    }
                }
            }
        }
    }
    fn append_assistant_turn(&self, messages: &mut Vec<Value>, text: &str, tools: &[CompletedCall]) {
        let tool_calls: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "id": t.id,
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "arguments": t.args_str,
                    }
                })
            })
            .collect();
        let content: Value = if text.is_empty() {
            Value::Null
        } else {
            json!(text)
        };
        messages.push(json!({
            "role": "assistant",
            "content": content,
            "tool_calls": tool_calls,
        }));
    }
    fn append_tool_results(&self, messages: &mut Vec<Value>, tools: &[CompletedCall]) {
        for t in tools {
            messages.push(json!({
                "role": "tool",
                "tool_call_id": t.id,
                "content": t.content_str(),
            }));
        }
    }
}

// ---- Google Gemini -------------------------------------------------------------

struct Gemini;
impl Protocol for Gemini {
    fn endpoint(&self, p: &ProviderProfile) -> String {
        format!(
            "{}/v1beta/models/{}:generateContent",
            trim_base(&p.base_url),
            p.model
        )
    }
    fn apply_auth(
        &self,
        req: reqwest::RequestBuilder,
        p: &ProviderProfile,
    ) -> reqwest::RequestBuilder {
        req.header("x-goog-api-key", &p.api_key)
    }
    fn probe_body(&self, _p: &ProviderProfile) -> Value {
        json!({
            "contents": [{ "parts": [{ "text": "ping" }] }],
            "generationConfig": { "maxOutputTokens": 1 },
        })
    }
    fn chat_endpoint(&self, p: &ProviderProfile) -> String {
        format!(
            "{}/v1beta/models/{}:streamGenerateContent?alt=sse",
            trim_base(&p.base_url),
            p.model
        )
    }
    fn initial_messages(&self, history: &[ChatTurn]) -> Vec<Value> {
        history
            .iter()
            .map(|m| {
                let role = if m.role == "assistant" { "model" } else { "user" };
                json!({ "role": role, "parts": [{ "text": m.content }] })
            })
            .collect()
    }
    fn build_body(
        &self,
        p: &ProviderProfile,
        messages: &[Value],
        thinking: bool,
        system: Option<&str>,
        include_subagent: bool,
    ) -> Value {
        let mut gen = serde_json::Map::new();
        if let Some(temp) = p.temperature {
            gen.insert("temperature".into(), json!(temp));
        }
        if let Some(max) = p.max_tokens {
            gen.insert("maxOutputTokens".into(), json!(max));
        }
        if thinking {
            // 2.5 系思考模型：includeThoughts 让思考摘要随流下发（thought=true 的 part）。
            // 关闭时不带 thinkingConfig：模型照默认行为跑，只是不下发思考内容。
            gen.insert("thinkingConfig".into(), json!({ "includeThoughts": true }));
        }
        let mut body = json!({
            "contents": messages,
            "tools": gemini_tools_array(include_subagent),
        });
        if let Some(sys) = system {
            // 协议原生 systemInstruction：独立于 contents，对话全程只此一份
            body["systemInstruction"] = json!({ "parts": [{ "text": sys }] });
        }
        if !gen.is_empty() {
            body["generationConfig"] = Value::Object(gen);
        }
        body
    }
    fn consume(
        &self,
        json: &Value,
        acc: &mut StreamAcc,
        on_event: Option<&tauri::ipc::Channel<ChatEvent>>,
    ) {
        // Gemini SSE：一条 data JSON 里带 candidates[0].content.parts[*]
        let parts = match json
            .get("candidates")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("content"))
            .and_then(|c| c.get("parts"))
            .and_then(Value::as_array)
        {
            Some(p) => p,
            None => return,
        };
        for part in parts {
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                if !text.is_empty() {
                    // thought=true 的 part 是思考摘要（includeThoughts 开启后下发）：
                    // 只推前端渲染，不入 text_buf → 不进跨轮历史
                    if part.get("thought").and_then(Value::as_bool) == Some(true) {
                        if let Some(ch) = on_event {
                            let _ = ch.send(ChatEvent::Thinking {
                                text: text.to_string(),
                            });
                        }
                    } else {
                        acc.text_buf.push_str(text);
                        if let Some(ch) = on_event {
                            let _ = ch.send(ChatEvent::Delta {
                                text: text.to_string(),
                            });
                        }
                    }
                }
            }
            if let Some(fc) = part.get("functionCall") {
                let name = fc
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                // Gemini 参数一次到位，直接序列化成字符串
                let args_obj = fc.get("args").cloned().unwrap_or(json!({}));
                let args_str = serde_json::to_string(&args_obj).unwrap_or_else(|_| "{}".into());
                // Gemini 不给 id，本地合成一个。id 必须在一次 provider_chat 内全局唯一：
                // 每轮 agent loop 都重建 StreamAcc，slot 会从 0 重来——若用 gemini-{slot}，
                // 第 2 轮的 gemini-0 会和第 1 轮撞 id，前端 onToolEnd/子步骤按 id 更新时
                // 会串改前几轮的卡片。改用进程级全局递增计数器保证不复用。
                let slot = acc.tools.len();
                static GEMINI_TOOL_SEQ: std::sync::atomic::AtomicU64 =
                    std::sync::atomic::AtomicU64::new(0);
                let id = format!(
                    "gemini-{}",
                    GEMINI_TOOL_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                );
                acc.tools.push(PartialToolCall {
                    slot,
                    id,
                    name,
                    args_buf: args_str,
                });
            }
        }
    }
    fn append_assistant_turn(&self, messages: &mut Vec<Value>, text: &str, tools: &[CompletedCall]) {
        let mut parts: Vec<Value> = Vec::new();
        if !text.is_empty() {
            parts.push(json!({ "text": text }));
        }
        for t in tools {
            let args: Value = serde_json::from_str(&t.args_str).unwrap_or(json!({}));
            parts.push(json!({
                "functionCall": { "name": t.name, "args": args }
            }));
        }
        messages.push(json!({ "role": "model", "parts": parts }));
    }
    fn append_tool_results(&self, messages: &mut Vec<Value>, tools: &[CompletedCall]) {
        // Gemini：functionResponse 用 role="user" 装在一条 content 里；response 必须是对象
        let parts: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "functionResponse": {
                        "name": t.name,
                        "response": { "result": t.content_str() }
                    }
                })
            })
            .collect();
        messages.push(json!({ "role": "user", "parts": parts }));
    }
}

/// 按 profile.protocol 分发到具体协议适配器。
fn resolve(protocol: &str) -> Box<dyn Protocol> {
    match protocol {
        "anthropic" => Box::new(Anthropic),
        "gemini" => Box::new(Gemini),
        _ => Box::new(OpenAi),
    }
}

// ---- 测试连接（保持原逻辑）------------------------------------------------------

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

// ---- provider_chat（agent loop）-------------------------------------------------

/// 收尾即从取消登记表移除自己的 RAII 守卫：无论正常结束、出错还是被取消，
/// provider_chat 的任一退出路径都会走它的 Drop，保证标志不残留。
struct CancelGuard(String);
impl Drop for CancelGuard {
    fn drop(&mut self) {
        unregister_cancel(&self.0);
        // 同时清掉这次 request 尚未收拢的审批项（正常结束通常已为空，防守用）
        cancel_request_approvals(&self.0);
    }
}

/// 取消一次在途流式对话：置取消标志，并叫醒此刻可能在等审批的 loop。
#[tauri::command]
pub fn provider_chat_cancel(request_id: String) {
    if let Ok(reg) = cancel_registry().lock() {
        if let Some(flag) = reg.get(&request_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
    cancel_request_approvals(&request_id);
}

/// agent loop 主体：外层循环——发一次请求 → 流式读回 → 累积工具调用 →
///   无调用则 Done；有调用则逐个执行（写/命令类先停下等审批）→
///   append 助手轮 + 结果轮 → 继续下一次请求。
///
/// 事件顺序：0..N 个 delta / toolStart / toolEnd 交错 → 一个 done（正常收尾）；
/// 任何环节出错则发一个 error 后终止。命令本身总是返回 Ok(())：错误信息走 Error 事件。
#[tauri::command]
pub async fn provider_chat(
    // Tauri 注入的应用句柄（按类型注入，前端 invoke 不传）：用于扫描技能目录
    app: tauri::AppHandle,
    request_id: String,
    profile: ProviderProfile,
    history: Vec<ChatTurn>,
    // 免审批开关（设置页「免审批执行」）：true 时写/命令类工具跳过审批直接执行
    auto_approve: bool,
    // 思考开关（输入框上方操作栏「深度思考」）：Anthropic/Gemini 请求思考过程下发
    thinking: bool,
    // 并发上限：一轮内多个工具调用最多同时跑几个（设置项，前端传入；下面 clamp 到 1..=20）
    concurrency: usize,
    // 人设/系统提示词（当前桌宠档案的 prompt）：只注入对话开头一次，None/空白不注入
    system: Option<String>,
    on_event: tauri::ipc::Channel<ChatEvent>,
) -> Result<(), String> {
    let concurrency = concurrency.clamp(1, 20);
    let cancel = register_cancel(&request_id);
    let _guard = CancelGuard(request_id.clone());

    if profile.api_key.trim().is_empty() {
        let _ = on_event.send(ChatEvent::Error { message: "API Key 为空".into() });
        return Ok(());
    }
    if profile.base_url.trim().is_empty() {
        let _ = on_event.send(ChatEvent::Error { message: "Base URL 为空".into() });
        return Ok(());
    }

    let proto = resolve(&profile.protocol);

    let client = match reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            let _ = on_event.send(ChatEvent::Error {
                message: format!("客户端初始化失败: {e}"),
            });
            return Ok(());
        }
    };

    // 协议原生 messages 数组：初始由跨轮纯文本历史转成；后续 loop 里追加 tool_use / tool_result
    let mut messages: Vec<Value> = proto.initial_messages(&history);

    // 空白人设视同未设置（前端已 trim，这里兜底）
    let system = system.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    // 扫描技能，把「技能清单」拼进系统提示词（人设 prompt 之后）。渐进式披露：
    // 系统里只放 name+description，模型要用时再 load_skill 拉全文。整轮扫一次即可
    // （导入新技能后重开一轮对话生效）
    let skill_registry = skills::scan(&app);
    let system = match skills::system_prompt_fragment(&skill_registry) {
        Some(frag) => Some(match system {
            Some(persona) => format!("{persona}\n\n{frag}"),
            None => frag,
        }),
        None => system,
    };

    // 长期记忆注入（技能清单之后）：全部记忆一次拼进，模型据此认得主人；
    // 片段里同时提示它用 remember 工具沉淀新事实。没有记忆则不加空段落
    let system = match crate::memory::prompt_fragment() {
        Some(frag) => Some(match system {
            Some(s) => format!("{s}\n\n{frag}"),
            None => frag,
        }),
        None => system,
    };

    // 工具调用纪律（恒注入）：跨轮历史会把过往工具调用压成「[工具调用记录 …]」
    // 纯文本（见前端 toHistory），模型见样学样、在正文里手写这个格式冒充调用
    // ——看起来调了工具，实际什么都没执行。明文告诫只认原生接口
    let system = Some(match system {
        Some(s) => format!("{s}\n\n{TOOL_DISCIPLINE}"),
        None => TOOL_DISCIPLINE.to_string(),
    });

    // 单次运行的 agent 步数硬上限，避免模型死循环
    const MAX_STEPS: usize = 12;
    for _step in 0..MAX_STEPS {
        if cancel.load(Ordering::SeqCst) {
            let _ = on_event.send(ChatEvent::Done);
            return Ok(());
        }

        let url = proto.chat_endpoint(&profile);
        // 主 agent：subagent 工具可用
        let body = proto.build_body(&profile, &messages, thinking, system.as_deref(), true);

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

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            let snippet: String = text.chars().take(300).collect();
            let _ = on_event.send(ChatEvent::Error {
                message: format!("HTTP {}: {}", status.as_u16(), snippet),
            });
            return Ok(());
        }

        // --- 流式读一轮响应 ---
        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        let mut acc = StreamAcc::default();
        let mut hit_done_sentinel = false;

        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::SeqCst) {
                let _ = on_event.send(ChatEvent::Done);
                return Ok(());
            }
            let bytes = match chunk {
                Ok(b) => b,
                Err(e) => {
                    let _ = on_event.send(ChatEvent::Error {
                        message: format!("流读取中断: {e}"),
                    });
                    return Ok(());
                }
            };
            buf.extend_from_slice(&bytes);

            while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = buf.drain(..=nl).collect();
                let line = String::from_utf8_lossy(&line_bytes);
                let line = line.trim();
                if line.is_empty() || line.starts_with(':') {
                    continue;
                }
                let payload = match line.strip_prefix("data:") {
                    Some(rest) => rest.trim(),
                    None => continue,
                };
                if payload == "[DONE]" {
                    hit_done_sentinel = true;
                    break;
                }
                if let Ok(json_val) = serde_json::from_str::<Value>(payload) {
                    proto.consume(&json_val, &mut acc, Some(&on_event));
                }
            }
            if hit_done_sentinel {
                break;
            }
        }

        // --- 没有工具调用 → 本轮就是最终回答，收尾 ---
        if acc.tools.is_empty() {
            let _ = on_event.send(ChatEvent::Done);
            return Ok(());
        }

        // --- 有工具调用：并发执行（上限 concurrency，来自设置，默认 5 / 最大 20）---
        // buffer_unordered 限最多 concurrency 个同时在跑；每个工具独立走
        // ToolStart → 审批 → 执行 → ToolEnd（exec_one_tool）。结果带原序号，跑完按
        // 序号排回——tool_result 的顺序必须与 tool_use 对应，否则三家协议的 id 配对会 400。
        // 被取消的任务产出 None：任一 None 或取消标志置位就干净收尾（不追加、不进下一轮）。
        let pending_tools = std::mem::take(&mut acc.tools);
        let proto_ref: &dyn Protocol = proto.as_ref();
        let skills_ref: &[skills::Skill] = &skill_registry;
        let cancel_ref: &std::sync::atomic::AtomicBool = &cancel;
        let client_ref = &client;
        let profile_ref = &profile;
        let request_id_ref: &str = &request_id;
        let mut outcomes: Vec<(usize, Option<CompletedCall>)> =
            futures_util::stream::iter(pending_tools.into_iter().enumerate())
                .map(|(idx, call)| {
                    // 每任务独立克隆 Channel（并发任务各自持有；Channel 只保证 Send）
                    let on_ev = on_event.clone();
                    async move {
                        let cc = exec_one_tool(
                            call,
                            auto_approve,
                            thinking,
                            request_id_ref,
                            cancel_ref,
                            &on_ev,
                            proto_ref,
                            client_ref,
                            profile_ref,
                            skills_ref,
                        )
                        .await;
                        (idx, cc)
                    }
                })
                .buffer_unordered(concurrency)
                .collect()
                .await;

        if cancel.load(Ordering::SeqCst) || outcomes.iter().any(|(_, o)| o.is_none()) {
            let _ = on_event.send(ChatEvent::Done);
            return Ok(());
        }
        outcomes.sort_by_key(|(i, _)| *i);
        let completed: Vec<CompletedCall> = outcomes.into_iter().filter_map(|(_, o)| o).collect();

        // 把这一轮助手输出（文本 + 工具调用）与执行结果追加进 messages，进入下一轮请求
        proto.append_assistant_turn(&mut messages, &acc.text_buf, &completed);
        proto.append_tool_results(&mut messages, &completed);
    }

    // 达到步数上限：以错误收尾，提示用户
    let _ = on_event.send(ChatEvent::Error {
        message: format!("agent 步数超过上限 ({MAX_STEPS} 步)"),
    });
    Ok(())
}
