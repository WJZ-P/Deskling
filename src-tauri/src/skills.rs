//! Skill 框架：可扩展的能力包（内置 + 用户导入）。
//!
//! 一个 skill = 一个文件夹 + `SKILL.md`（YAML frontmatter: name/description + 正文
//! 说明）+ 可选脚本（Python/JS/…）。扫两个根：内置打包资源 `resources/skills`、
//! 用户数据目录下 `skills`（用户同名覆盖内置）。
//!
//! 模型侧接法全部复用现有 toolcall 接口（见 tools.rs / provider.rs）：
//!  - 系统提示词常驻「技能清单」= 每个 skill 的 name + description（渐进式披露，
//!    只放摘要不放全文，省上下文）；
//!  - `load_skill(name)` 工具按需返回该 skill 的 SKILL.md 全文 + 目录绝对路径；
//!  - SKILL.md 正文里指示模型用现成的 `run_command` 跑目录下的脚本。
//! 所以本模块只管「扫描 / 解析 / 拼提示词 / 取全文」，不新增执行器。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

/// 扫描到的一个技能。
pub struct Skill {
    pub name: String,
    pub description: String,
    /// 技能目录绝对路径（模型据此把脚本拼成绝对路径来跑）。
    pub dir: PathBuf,
    /// SKILL.md 去掉 frontmatter 后的正文（load_skill 返回给模型的说明书）。
    pub body: String,
    /// 来源：true=内置打包，false=用户导入。留给后续「技能管理/导入 UI」按来源
    /// 分组展示（当前扫描/加载逻辑未读取，故暂 allow dead_code）。
    #[allow(dead_code)]
    pub builtin: bool,
}

/// 去掉 Windows `\\?\` 扩展长度前缀——喂给模型/拼进命令的路径要干净可用。
fn strip_prefix(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p,
    }
}

/// 内置技能根（打包资源）；开发 = src-tauri/resources/skills
fn builtin_root(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve("resources/skills", BaseDirectory::Resource)
        .ok()
        .map(strip_prefix)
}

/// 用户/工坊技能根（应用数据目录，可写；不存在则建好等导入落包）
fn user_root(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("skills");
    let _ = std::fs::create_dir_all(&dir);
    Some(strip_prefix(dir))
}

/// 去掉单/双引号包裹（frontmatter 单行值常带引号）。
fn unquote(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2
        && ((s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')))
    {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

/// 解析 SKILL.md：切出 frontmatter 的 name / description + 正文。
/// 认最简标准形态：文件（去 BOM 后）以 `---` 起头 → YAML → 一行 `---` 收尾 → 正文。
/// name/description 取单行 `key: value`（去引号）；两者缺一即视为无效技能（返回 None）。
fn parse_skill_md(text: &str) -> Option<(String, String, String)> {
    // 去 BOM，再去前导空白/换行——复制粘贴/某些编辑器常在 --- 前多留空行，
    // 别因此把整份技能静默丢掉
    let text = text
        .trim_start_matches('\u{feff}')
        .trim_start_matches(|c: char| c.is_whitespace());
    let rest = text.strip_prefix("---")?;
    // frontmatter 结束的 `---` 行（前面带换行，避免撞上正文里的分隔线）
    let end = rest.find("\n---")?;
    let front = &rest[..end];
    let body = rest[end + "\n---".len()..]
        .trim_start_matches(|c| c == '\r' || c == '\n')
        .to_string();

    let mut name = None;
    let mut description = None;
    for line in front.lines() {
        // 宽松取 `key: value`——按首个冒号切，key 去空白后大小写不敏感匹配，
        // 容忍 "name : x" / "Name: x" / 带缩进等偏离最简形态的写法；value 保留
        // 其余冒号（描述里含冒号不受影响）
        let Some((key, val)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        if key.eq_ignore_ascii_case("name") {
            name = Some(unquote(val));
        } else if key.eq_ignore_ascii_case("description") {
            description = Some(unquote(val));
        }
    }
    let name = name?;
    let description = description?;
    if name.is_empty() || description.is_empty() {
        return None;
    }
    Some((name, description, body))
}

/// 扫一个根：每个含 `SKILL.md` 的子目录是一个技能。解析失败/缺字段的静默跳过。
fn scan_root(root: &Path, builtin: bool, out: &mut Vec<Skill>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for e in entries.flatten() {
        let dir = e.path();
        if !dir.is_dir() {
            continue;
        }
        let md = dir.join("SKILL.md");
        if !md.is_file() {
            continue;
        }
        // 有 SKILL.md 却读/解析失败：打日志——技能「放进去了却不显示」时可据此排查，
        // 否则用户完全无从得知为何技能没生效
        let text = match std::fs::read_to_string(&md) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("[skills] 读取 {} 失败：{e}", md.display());
                continue;
            }
        };
        match parse_skill_md(&text) {
            Some((name, description, body)) => out.push(Skill {
                name,
                description,
                dir,
                body,
                builtin,
            }),
            None => eprintln!(
                "[skills] 跳过 {}：SKILL.md 需以 --- 起头的 frontmatter，且含 name: 与 description:",
                dir.display()
            ),
        }
    }
}

/// 扫全部根，返回技能列表。用户目录同名技能覆盖内置（优先级 用户 > 内置）。
pub fn scan(app: &AppHandle) -> Vec<Skill> {
    let mut user = Vec::new();
    if let Some(root) = user_root(app) {
        scan_root(&root, false, &mut user);
    }
    // 大小写不敏感去重，与 load() 的 eq_ignore_ascii_case 匹配口径一致——否则用户
    // 写 name: Web-Search 覆盖内置 web-search 时，去重判不重复（两者都上榜），而
    // load 又按不敏感命中用户那份，造成「清单里俩、加载遮蔽内置」的不一致
    let user_names: HashSet<String> = user.iter().map(|s| s.name.to_ascii_lowercase()).collect();

    let mut builtin = Vec::new();
    if let Some(root) = builtin_root(app) {
        scan_root(&root, true, &mut builtin);
    }

    let mut out = user;
    for s in builtin {
        if !user_names.contains(&s.name.to_ascii_lowercase()) {
            out.push(s);
        }
    }
    out
}

/// 系统提示词片段：列出所有技能（name + description），教模型用 load_skill 拉全文。
/// 无技能时返回 None（不污染提示词）。拼在人设 prompt 之后。
pub fn system_prompt_fragment(skills: &[Skill]) -> Option<String> {
    if skills.is_empty() {
        return None;
    }
    let mut s = String::from(
        "# 可用技能（Skills）\n\
        下面是你可以使用的技能。每个技能是一份说明书（SKILL.md）。要用某个技能时，\
        先用 load_skill 工具读它的完整说明，再按说明操作——通常是用 run_command \
        运行该技能目录下的脚本。不确定某技能能不能用于当前任务时，先 load_skill 看说明。\n\n",
    );
    for sk in skills {
        s.push_str(&format!("- **{}**：{}\n", sk.name, sk.description));
    }
    Some(s)
}

/// load_skill 工具实现：按 name 返回 SKILL.md 全文 + 目录绝对路径提示。
/// 找不到时返回可用技能名清单（作为工具结果回喂，模型据此改用正确名字）。
pub fn load(skills: &[Skill], name: &str) -> String {
    let name = name.trim();
    match skills.iter().find(|s| s.name.eq_ignore_ascii_case(name)) {
        Some(sk) => format!(
            "技能「{}」目录：{}\n（说明书里提到的脚本/文件都在这个目录下；用 run_command \
             运行时把相对路径拼成该目录下的绝对路径）\n\n---- SKILL.md ----\n{}",
            sk.name,
            sk.dir.display(),
            sk.body,
        ),
        None => {
            let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
            if names.is_empty() {
                format!("没有名为「{name}」的技能（当前无任何可用技能）。")
            } else {
                format!("没有名为「{name}」的技能。可用技能：{}", names.join("、"))
            }
        }
    }
}
