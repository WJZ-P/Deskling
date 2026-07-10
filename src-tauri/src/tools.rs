//! Agent 工具集：让模型能「操作整台电脑」的一组本地能力。
//!
//! 每个工具是一步具体动作（读文件 / 列目录 / 写文件 / 跑命令）。工具分两档：
//!  - 只读（read_file / list_dir）：安全，agent loop 直接执行，无需审批；
//!  - 写/命令（write_file / run_command）：有副作用，`needs_approval()` 返回 true，
//!    loop 会先停下发 ApprovalRequest 等用户点「同意」再执行。
//!
//! 本模块只负责「工具是什么、怎么执行、怎么给模型/用户描述」；
//! 「何时执行、要不要审批、结果喂回哪」由 provider.rs 的 agent loop 编排。
//!
//! ⚠️ MVP 不做路径沙箱：工具可操作任意路径，安全靠「写/命令需人工审批」这道闸门兜底。

use serde_json::{json, Value};

/// 单条读文件返回的最大字符数（超出截断，避免把超大文件灌进上下文）。
const READ_MAX_CHARS: usize = 8000;
/// 命令输出（stdout+stderr 合计）回喂给模型的最大字符数。
const OUTPUT_MAX_CHARS: usize = 4000;
/// 列目录最多列出的条目数。
const LIST_MAX_ENTRIES: usize = 200;

/// 一个工具的对模型声明：名字 + 说明 + 参数 JSON Schema（协议无关的中性形态）。
/// 各协议适配器再把它翻成自家格式（Anthropic tools / OpenAI tools / Gemini functionDeclarations）。
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    /// JSON Schema（type=object，含 properties/required），中性形态。
    pub parameters: Value,
}

/// agent 可用的全部工具声明。三家协议构造请求体时都从这里取。
pub fn tool_specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "read_file",
            description: "读取一个文本文件的内容。用于查看代码/配置/日志等。返回文件文本（过大时截断）。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "文件的绝对路径或相对当前工作目录的路径" }
                },
                "required": ["path"]
            }),
        },
        ToolSpec {
            name: "list_dir",
            description: "列出一个目录下的文件与子目录（子目录名带尾部 /）。用于浏览项目结构。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "目录路径；省略或传 \".\" 表示当前工作目录" }
                },
                "required": ["path"]
            }),
        },
        ToolSpec {
            name: "write_file",
            description: "把内容写入一个文件（覆盖已存在的同名文件）。有副作用，需用户审批。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "要写入的文件路径" },
                    "content": { "type": "string", "description": "写入的完整文本内容" }
                },
                "required": ["path", "content"]
            }),
        },
        ToolSpec {
            name: "run_command",
            description: "在系统 shell 里执行一条命令并返回输出（Windows 下是 cmd /C，其余平台是 sh -c）。可用于构建/测试/文件操作等。有副作用，需用户审批。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "要执行的完整命令行" }
                },
                "required": ["command"]
            }),
        },
    ]
}

/// 工具是否需要人工审批（写/命令类为 true）。未知工具按需审批处理（保守）。
pub fn needs_approval(name: &str) -> bool {
    !matches!(name, "read_file" | "list_dir")
}

/// 给用户看的一句话摘要（工具卡标题右侧）。args 解析失败时回落到工具名。
pub fn summarize(name: &str, args: &Value) -> String {
    match name {
        "read_file" => format!("读取 {}", str_arg(args, "path")),
        "list_dir" => {
            let p = str_arg(args, "path");
            let p = if p.is_empty() { ".".into() } else { p };
            format!("列出目录 {p}")
        }
        "write_file" => format!("写入 {}", str_arg(args, "path")),
        "run_command" => format!("执行 `{}`", str_arg(args, "command")),
        other => format!("调用 {other}"),
    }
}

/// 从参数对象取一个字符串字段（缺失 → 空串）。
fn str_arg(args: &Value, key: &str) -> String {
    args.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

/// 按字符数截断字符串，超长则附一句省略提示。
fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{head}\n…（已截断，共 {} 字符）", s.chars().count())
}

/// 执行一个工具，返回「给模型看的结果文本」。
/// 成功返回 Ok(结果串)，失败返回 Err(错误串)——两者都会作为工具结果喂回模型，
/// 只是 UI 上 Err 标红。执行本身不 panic：IO/命令错误都转成 Err 字符串。
pub async fn execute(name: &str, args: &Value) -> Result<String, String> {
    match name {
        "read_file" => read_file(args).await,
        "list_dir" => list_dir(args).await,
        "write_file" => write_file(args).await,
        "run_command" => run_command(args).await,
        other => Err(format!("未知工具: {other}")),
    }
}

async fn read_file(args: &Value) -> Result<String, String> {
    let path = str_arg(args, "path");
    if path.is_empty() {
        return Err("缺少参数 path".into());
    }
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(truncate_chars(&content, READ_MAX_CHARS)),
        Err(e) => Err(format!("读取失败 {path}: {e}")),
    }
}

async fn list_dir(args: &Value) -> Result<String, String> {
    let mut path = str_arg(args, "path");
    if path.is_empty() {
        path = ".".into();
    }
    let mut rd = match tokio::fs::read_dir(&path).await {
        Ok(rd) => rd,
        Err(e) => return Err(format!("列目录失败 {path}: {e}")),
    };
    let mut entries: Vec<String> = Vec::new();
    loop {
        match rd.next_entry().await {
            Ok(Some(entry)) => {
                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry
                    .file_type()
                    .await
                    .map(|ft| ft.is_dir())
                    .unwrap_or(false);
                entries.push(if is_dir { format!("{name}/") } else { name });
            }
            Ok(None) => break,
            Err(e) => return Err(format!("遍历目录出错: {e}")),
        }
    }
    if entries.is_empty() {
        return Ok("（空目录）".into());
    }
    entries.sort();
    let total = entries.len();
    let shown: Vec<String> = entries.into_iter().take(LIST_MAX_ENTRIES).collect();
    let mut out = shown.join("\n");
    if total > LIST_MAX_ENTRIES {
        out.push_str(&format!("\n…（共 {total} 项，仅显示前 {LIST_MAX_ENTRIES}）"));
    }
    Ok(out)
}

async fn write_file(args: &Value) -> Result<String, String> {
    let path = str_arg(args, "path");
    let content = str_arg(args, "content");
    if path.is_empty() {
        return Err("缺少参数 path".into());
    }
    // 有父目录则先建，避免写入不存在的目录直接失败
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
    }
    match tokio::fs::write(&path, content.as_bytes()).await {
        Ok(()) => Ok(format!("已写入 {path}（{} 字节）", content.len())),
        Err(e) => Err(format!("写入失败 {path}: {e}")),
    }
}

/// 把子进程输出解码成字符串：先严格按 UTF-8（现代工具多为 UTF-8），
/// 失败再按 GBK 解 —— 中文 Windows 的 cmd / 系统报错走 CP936，
/// 此前 from_utf8_lossy 硬解会把整段错误信息吞成 �（如 'wmic' 不存在的提示全是乱码）。
/// 顺序不能反：GBK 几乎能「成功」解出任意字节序列，先 GBK 会把真 UTF-8 输出解成乱码。
fn decode_console(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    #[cfg(target_os = "windows")]
    {
        let (s, _, _) = encoding_rs::GBK.decode(bytes);
        s.into_owned()
    }
    #[cfg(not(target_os = "windows"))]
    {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

async fn run_command(args: &Value) -> Result<String, String> {
    let command = str_arg(args, "command");
    if command.trim().is_empty() {
        return Err("缺少参数 command".into());
    }

    // 按平台选 shell：Windows 用 cmd /C，其余用 sh -c。
    #[cfg(target_os = "windows")]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("cmd");
        // /C 后的整条命令必须 raw_arg 原样拼接（等价于终端手敲）：
        // 默认 arg() 按 MSVC 规则转义（内部引号变 \"），而 cmd.exe 不认反斜杠转义，
        // 嵌套引号会被拆散 —— 表现为 findstr /C:"a b" 的引号被吃报「无法打开 b"」、
        // powershell -Command "..." 退化成字符串字面量被回显（退出码 0 却只输出命令文本）。
        c.arg("/C").raw_arg(&command);
        // CREATE_NO_WINDOW：release 是 GUI 子系统，不加会每跑一条命令闪一个黑色控制台窗
        c.creation_flags(0x0800_0000);
        tokio::process::Command::from(c)
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("sh");
        c.arg("-c").arg(&command);
        c
    };

    match cmd.output().await {
        Ok(output) => {
            let stdout = decode_console(&output.stdout);
            let stderr = decode_console(&output.stderr);
            let code = output.status.code().unwrap_or(-1);
            let mut combined = String::new();
            if !stdout.trim().is_empty() {
                combined.push_str(&stdout);
            }
            if !stderr.trim().is_empty() {
                if !combined.is_empty() {
                    combined.push('\n');
                }
                combined.push_str("[stderr]\n");
                combined.push_str(&stderr);
            }
            if combined.trim().is_empty() {
                combined = "（无输出）".into();
            }
            let body = truncate_chars(&combined, OUTPUT_MAX_CHARS);
            if output.status.success() {
                Ok(format!("退出码 {code}\n{body}"))
            } else {
                // 非零退出：作为 Err 让 UI 标红，但仍把输出喂回模型
                Err(format!("退出码 {code}\n{body}"))
            }
        }
        Err(e) => Err(format!("命令启动失败: {e}")),
    }
}
