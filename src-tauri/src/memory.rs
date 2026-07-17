//! 长期记忆：跨会话记住主人的喜好、习惯、项目、约定。
//!
//! 三个接口面：
//!   写入   agent 的 remember 工具（tools.rs 分发到 add）——主/子 agent 在
//!          对话中得知值得长久记住的事实时主动调用，免审批
//!   注入   provider.rs 组装请求时把全部记忆拼进 system prompt（主 agent 与
//!          子 agent 都注入，读写对称；桌宠场景记忆量小，全量注入最可靠）
//!   管理   设置页「记忆」区经 memory_list / memory_remove / memory_clear
//!          查看、单删、清空
//!
//! 存储是 app_data_dir/memory.json 的一个条目数组，进程内单例
//! （OnceLock<Mutex>，setup 时 init）。落盘走「写临时文件 + rename」的原子
//! 替换，中途崩溃/断电不会留半截 JSON；启动时若发现文件损坏，改名备份成
//! memory.json.corrupt 再从空开始，绝不静默覆写掉用户积累的数据。
//! 任何变更成功落盘后广播 memory:changed 事件（设置页据此刷新条数/列表）。

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// 条数上限：超出丢最旧的（条目按「最后活跃」排序，见 add）。
/// 全量注入 system prompt，别让它无限膨胀
const MAX_ENTRIES: usize = 200;
/// 单条记忆长度上限（字符）：记忆应是精炼的事实句，不是文章
const MAX_CONTENT_CHARS: usize = 500;

#[derive(Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: u64,
    pub content: String,
    /// 写入时间戳（ms，设置页显示「记于某天」）
    pub ts: u64,
}

struct MemoryStore {
    path: PathBuf,
    entries: Vec<MemoryEntry>,
}

impl MemoryStore {
    /// 原子落盘：写 .tmp 再 rename 替换（Windows 上 rename 带 REPLACE_EXISTING），
    /// 写一半崩溃只会留下孤儿 tmp，正式文件永远是完整 JSON。
    /// 失败如实上抛——调用方别拿着「已记住」骗模型，磁盘上其实没有
    fn save(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&self.entries)
            .map_err(|e| format!("记忆序列化失败: {e}"))?;
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| format!("记忆写盘失败: {e}"))?;
        std::fs::rename(&tmp, &self.path).map_err(|e| format!("记忆落盘失败: {e}"))?;
        Ok(())
    }
}

static STORE: OnceLock<Mutex<MemoryStore>> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();

/// 启动时初始化：加载 app_data_dir/memory.json。文件不存在 = 首次运行空起步；
/// 存在但解析失败 = 先备份原文件再空起步（下一次落盘不会覆掉可抢救的数据）
pub fn init(app: AppHandle) {
    let dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("记忆存储不可用：解析 app_data_dir 失败（{e}），本次运行无长期记忆");
            return;
        }
    };
    let path = dir.join("memory.json");
    let entries: Vec<MemoryEntry> = match std::fs::read_to_string(&path) {
        Err(_) => Vec::new(), // 不存在：首次运行
        Ok(s) => match serde_json::from_str(&s) {
            Ok(v) => v,
            Err(e) => {
                let backup = dir.join("memory.json.corrupt");
                eprintln!("记忆文件损坏（{e}），已备份为 {}，从空记忆起步", backup.display());
                let _ = std::fs::rename(&path, &backup);
                Vec::new()
            }
        },
    };
    let _ = STORE.set(Mutex::new(MemoryStore { path, entries }));
    let _ = APP.set(app);
}

fn with_store<T>(f: impl FnOnce(&mut MemoryStore) -> T) -> Result<T, String> {
    let store = STORE.get().ok_or("记忆存储未初始化")?;
    Ok(f(&mut store.lock().unwrap()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 变更成功落盘后广播（设置页常驻挂载，靠它刷新条数与浮窗列表）
fn notify_changed(count: usize) {
    if let Some(app) = APP.get() {
        let _ = app.emit("memory:changed", serde_json::json!({ "count": count }));
    }
}

/// remember 工具落一条记忆，返回给模型看的结果文本。
/// 去重两向：已有记忆涵盖新内容 → 跳过；被新内容涵盖的旧条目（可能不止一条）
/// 全部收编进新条目（"主人喜欢咖啡"+"喜欢咖啡加糖"遇到"主人喜欢咖啡加糖"时
/// 一并合并，不留近似重复）。新条目追加到末尾：位置即新鲜度，上限驱逐先走最旧
pub fn add(content: &str) -> Result<String, String> {
    let content = content.trim();
    if content.is_empty() {
        return Err("记忆内容为空".into());
    }
    let content: String = content.chars().take(MAX_CONTENT_CHARS).collect();
    with_store(|s| -> Result<String, String> {
        if let Some(dup) = s.entries.iter().find(|e| e.content.contains(&content)) {
            return Ok(format!("已有涵盖它的记忆（#{}），未重复记录", dup.id));
        }
        let before = s.entries.len();
        s.entries.retain(|e| !content.contains(e.content.as_str()));
        let merged = before - s.entries.len();
        // id 单调不复用：以时间戳为底、不低于历史最大值+1——删除最大条后新 id
        // 也不会撞上旧 id（前端列表键/删除请求不会指错条目）
        let id = (s.entries.iter().map(|e| e.id).max().unwrap_or(0) + 1).max(now_ms());
        s.entries.push(MemoryEntry { id, content, ts: now_ms() });
        if s.entries.len() > MAX_ENTRIES {
            let overflow = s.entries.len() - MAX_ENTRIES;
            s.entries.drain(..overflow);
        }
        s.save()?;
        notify_changed(s.entries.len());
        Ok(if merged > 0 {
            format!("已记住（#{id}，顺带合并了 {merged} 条被涵盖的旧记忆）")
        } else {
            format!("已记住（#{id}）")
        })
    })?
}

/// 全部记忆 → 系统提示词片段；没有记忆返回 None（不注入空段落）
pub fn prompt_fragment() -> Option<String> {
    let store = STORE.get()?;
    let s = store.lock().unwrap();
    if s.entries.is_empty() {
        return None;
    }
    let lines = s
        .entries
        .iter()
        .map(|e| format!("- {}", e.content))
        .collect::<Vec<_>>()
        .join("\n");
    Some(format!(
        "【长期记忆】以下是你此前与主人相处记住的事，回应时自然运用，\
         不要逐条复述；得知新的重要信息（喜好、习惯、身份、项目、约定）\
         时用 remember 工具记下来：\n{lines}"
    ))
}

/// 设置页：列出全部记忆（新的在前）。未初始化按空列表返回（错误已在 init 落日志）
#[tauri::command]
pub fn memory_list() -> Vec<MemoryEntry> {
    match with_store(|s| {
        let mut list = s.entries.clone();
        list.reverse();
        list
    }) {
        Ok(list) => list,
        Err(e) => {
            eprintln!("memory_list 失败: {e}");
            Vec::new()
        }
    }
}

/// 设置页：删除单条记忆
#[tauri::command]
pub fn memory_remove(id: u64) -> Result<(), String> {
    with_store(|s| -> Result<(), String> {
        s.entries.retain(|e| e.id != id);
        s.save()?;
        notify_changed(s.entries.len());
        Ok(())
    })?
}

/// 设置页：清除全部记忆
#[tauri::command]
pub fn memory_clear() -> Result<(), String> {
    with_store(|s| -> Result<(), String> {
        s.entries.clear();
        s.save()?;
        notify_changed(0);
        Ok(())
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 去重/合并语义：涵盖跳过、被涵盖合并（含多条）、无关并存
    #[test]
    fn dedup_and_merge() {
        let dir = std::env::temp_dir().join(format!("deskling-mem-test-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let _ = STORE.set(Mutex::new(MemoryStore {
            path: dir.join("memory.json"),
            entries: Vec::new(),
        }));

        assert!(add("主人喜欢咖啡").unwrap().starts_with("已记住"));
        assert!(add("喜欢咖啡加糖").unwrap().starts_with("已记住")); // 互不为子串，并存
        // 同时涵盖上面两条 → 合并成一条
        let msg = add("主人喜欢咖啡加糖，早上一杯").unwrap();
        assert!(msg.contains("合并了 2 条"), "实际: {msg}");
        // 已被涵盖 → 跳过
        assert!(add("喜欢咖啡加糖").unwrap().contains("未重复"));
        let list = memory_list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].content, "主人喜欢咖啡加糖，早上一杯");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
