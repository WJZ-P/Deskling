//! 常驻 AI 计划任务。
//!
//! 与普通提醒不同：调度器只负责持久化计划、计算 Cron 和生成一次运行记录；
//! 真正到点后广播 `scheduled-task:run-request`，常驻的聊天窗口会创建一段真实会话，
//! 把任务说明、工作目录和关联资源交给 provider agent loop 执行。运行结果再通过
//! command 回写这里，因而任务面板能追踪真实会话、审批状态与最终结果。

use chrono::{DateTime, Datelike, Local, TimeZone, Timelike};
use cron::Schedule;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    path::PathBuf,
    str::FromStr,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const MAX_TASKS: usize = 500;
const MAX_TITLE_CHARS: usize = 80;
const MAX_INSTRUCTION_CHARS: usize = 8_000;
const MAX_SCHEDULE_CHARS: usize = 200;
const MAX_RELATED_FILES: usize = 64;
const MAX_PATH_CHARS: usize = 2_048;
const MAX_RUNS_PER_TASK: usize = 20;
const MAX_RUN_SUMMARY_CHARS: usize = 4_000;
const FIRST_TICK_DELAY: Duration = Duration::from_secs(3);
const POLL_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskOrigin {
    #[default]
    User,
    Agent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskRunTrigger {
    Schedule,
    Manual,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskRunStatus {
    Queued,
    Running,
    WaitingApproval,
    Succeeded,
    Failed,
    Skipped,
    Interrupted,
}

impl TaskRunStatus {
    fn is_active(self) -> bool {
        matches!(self, Self::Queued | Self::Running | Self::WaitingApproval)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunRecord {
    pub id: u64,
    pub trigger: TaskRunTrigger,
    pub scheduled_for: u64,
    pub queued_at: u64,
    #[serde(default)]
    pub started_at: Option<u64>,
    #[serde(default)]
    pub finished_at: Option<u64>,
    pub status: TaskRunStatus,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub id: u64,
    pub title: String,
    pub instruction: String,
    /// `@once RFC3339`、`@hourly` / `@daily` 等别名，或标准五字段 Cron。
    pub schedule: String,
    pub enabled: bool,
    #[serde(default)]
    pub related_files: Vec<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
    /// true 时该次后台会话允许写文件/跑命令无需再次审批。
    #[serde(default)]
    pub auto_approve: bool,
    #[serde(default)]
    pub origin: TaskOrigin,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub next_run_at: Option<u64>,
    #[serde(default)]
    pub runs: Vec<TaskRunRecord>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskInput {
    pub title: String,
    pub instruction: String,
    pub schedule: String,
    pub enabled: bool,
    #[serde(default)]
    pub related_files: Vec<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub auto_approve: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskRunRequest {
    pub task: ScheduledTask,
    pub run: TaskRunRecord,
}

struct TaskStore {
    path: PathBuf,
    tasks: Vec<ScheduledTask>,
}

impl TaskStore {
    fn save(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&self.tasks)
            .map_err(|error| format!("计划任务序列化失败: {error}"))?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建计划任务目录: {error}"))?;
        }
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, json)
            .map_err(|error| format!("计划任务临时文件写入失败: {error}"))?;
        std::fs::rename(&temporary, &self.path)
            .map_err(|error| format!("计划任务落盘失败: {error}"))?;
        Ok(())
    }
}

static STORE: OnceLock<Mutex<TaskStore>> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: AppHandle) {
    let directory = match app.path().app_data_dir() {
        Ok(directory) => directory,
        Err(error) => {
            eprintln!("计划任务不可用：解析 app_data_dir 失败（{error}）");
            return;
        }
    };
    let path = directory.join("scheduled_tasks.json");
    let now = now_ms();
    let (mut tasks, migrated) = match std::fs::read_to_string(&path) {
        Err(_) => (Vec::new(), false),
        Ok(source) => match load_tasks(&source) {
            Ok(result) => result,
            Err(error) => {
                let backup = directory.join("scheduled_tasks.json.corrupt");
                eprintln!(
                    "计划任务文件损坏（{error}），已尝试备份为 {}",
                    backup.display()
                );
                let _ = std::fs::rename(&path, backup);
                (Vec::new(), false)
            }
        },
    };
    tasks.truncate(MAX_TASKS);
    let recovered = recover_interrupted_runs(&mut tasks, now);
    let mut cleared_paused_times = false;
    for task in &mut tasks {
        // Paused plans are not scheduled. Re-enabling always calculates a fresh
        // occurrence from that moment, so retaining an old timestamp is misleading.
        if !task.enabled && task.next_run_at.take().is_some() {
            cleared_paused_times = true;
        }
    }
    sort_tasks(&mut tasks);

    let store = TaskStore { path, tasks };
    if migrated || recovered || cleared_paused_times {
        let _ = store.save();
    }
    let _ = STORE.set(Mutex::new(store));
    let _ = APP.set(app);
    let _ = std::thread::Builder::new()
        .name("deskling-ai-scheduler".into())
        .spawn(|| {
            // 给隐藏的聊天 WebView 留出 bootstrap + listen 的时间。
            std::thread::sleep(FIRST_TICK_DELAY);
            loop {
                if let Err(error) = fire_due_tasks() {
                    eprintln!("AI 计划任务调度失败: {error}");
                }
                std::thread::sleep(POLL_INTERVAL);
            }
        });
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn with_store<T>(read: impl FnOnce(&TaskStore) -> T) -> Result<T, String> {
    let store = STORE.get().ok_or("计划任务存储未初始化")?;
    let guard = store.lock().map_err(|_| "计划任务存储锁已损坏")?;
    Ok(read(&guard))
}

fn mutate_store<T>(
    mutate: impl FnOnce(&mut Vec<ScheduledTask>) -> Result<T, String>,
) -> Result<T, String> {
    let store = STORE.get().ok_or("计划任务存储未初始化")?;
    let mut guard = store.lock().map_err(|_| "计划任务存储锁已损坏")?;
    let previous = guard.tasks.clone();
    let result = match mutate(&mut guard.tasks) {
        Ok(result) => result,
        Err(error) => {
            guard.tasks = previous;
            return Err(error);
        }
    };
    sort_tasks(&mut guard.tasks);
    if let Err(error) = guard.save() {
        guard.tasks = previous;
        return Err(error);
    }
    let count = guard.tasks.len();
    drop(guard);
    notify_changed(count);
    Ok(result)
}

fn sort_tasks(tasks: &mut [ScheduledTask]) {
    tasks.sort_by_key(|task| {
        (
            !task.enabled,
            task.next_run_at.unwrap_or(u64::MAX),
            std::cmp::Reverse(task.updated_at),
        )
    });
}

fn notify_changed(count: usize) {
    if let Some(app) = APP.get() {
        let _ = app.emit(
            "scheduled-task:changed",
            serde_json::json!({ "count": count }),
        );
    }
}

fn emit_run_request(request: &ScheduledTaskRunRequest) {
    if let Some(app) = APP.get() {
        // 让用户能看到桌宠进入思考/敲电脑状态，但不抢键盘焦点。
        if let Some(pet) = app.get_webview_window("pet") {
            let _ = pet.show();
            let _ = pet.unminimize();
        }
        let _ = app.emit("scheduled-task:run-request", request);
    }
}

fn next_task_id(tasks: &[ScheduledTask]) -> u64 {
    let historical = tasks.iter().map(|task| task.id).max().unwrap_or(0) + 1;
    historical.max(now_ms())
}

fn next_run_id(task: &ScheduledTask) -> u64 {
    let historical = task.runs.iter().map(|run| run.id).max().unwrap_or(0) + 1;
    historical.max(now_ms())
}

fn push_run(task: &mut ScheduledTask, run: TaskRunRecord) {
    task.runs.insert(0, run);
    task.runs.truncate(MAX_RUNS_PER_TASK);
}

fn has_active_run(task: &ScheduledTask) -> bool {
    task.runs.iter().any(|run| run.status.is_active())
}

fn recover_interrupted_runs(tasks: &mut [ScheduledTask], now: u64) -> bool {
    let mut changed = false;
    for task in tasks {
        for run in &mut task.runs {
            if run.status.is_active() {
                run.status = TaskRunStatus::Interrupted;
                run.finished_at = Some(now);
                run.summary = Some("Deskling 上次运行中断，未得到完整结果".into());
                changed = true;
            }
        }
        task.runs.truncate(MAX_RUNS_PER_TASK);
    }
    changed
}

fn normalize_input(mut input: ScheduledTaskInput) -> Result<ScheduledTaskInput, String> {
    input.title = input.title.trim().to_string();
    input.instruction = input.instruction.trim().to_string();
    input.schedule = canonical_schedule(&input.schedule)?;
    input.working_directory = input
        .working_directory
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());

    if input.title.is_empty() || input.title.chars().count() > MAX_TITLE_CHARS {
        return Err(format!("任务标题应为 1～{MAX_TITLE_CHARS} 个字符"));
    }
    if input.instruction.is_empty() || input.instruction.chars().count() > MAX_INSTRUCTION_CHARS {
        return Err(format!("AI 执行指令应为 1～{MAX_INSTRUCTION_CHARS} 个字符"));
    }
    if input.schedule.chars().count() > MAX_SCHEDULE_CHARS {
        return Err(format!("运行计划不能超过 {MAX_SCHEDULE_CHARS} 个字符"));
    }
    if input.related_files.len() > MAX_RELATED_FILES {
        return Err(format!("关联资源最多 {MAX_RELATED_FILES} 条"));
    }
    if input
        .working_directory
        .as_ref()
        .is_some_and(|path| path.chars().count() > MAX_PATH_CHARS)
    {
        return Err(format!("工作目录不能超过 {MAX_PATH_CHARS} 个字符"));
    }

    let mut seen = HashSet::new();
    let mut files = Vec::new();
    for raw in input.related_files {
        let path = raw.trim();
        if path.is_empty() {
            continue;
        }
        if path.chars().count() > MAX_PATH_CHARS {
            return Err(format!("关联资源路径不能超过 {MAX_PATH_CHARS} 个字符"));
        }
        if seen.insert(path.to_string()) {
            files.push(path.to_string());
        }
    }
    input.related_files = files;
    Ok(input)
}

fn canonical_schedule(raw: &str) -> Result<String, String> {
    let compact = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return Err("请填写运行计划".into());
    }
    if compact.to_ascii_lowercase().starts_with("@once ") {
        let value = compact[6..].trim();
        let parsed = DateTime::parse_from_rfc3339(value)
            .map_err(|_| "单次计划格式应为 @once + RFC3339 时间".to_string())?;
        return Ok(format!("@once {}", parsed.to_rfc3339()));
    }
    let lowered = compact.to_ascii_lowercase();
    parse_cron(&lowered)?;
    Ok(lowered)
}

fn cron_expression_for_parser(schedule: &str) -> Result<String, String> {
    let alias = match schedule.to_ascii_lowercase().as_str() {
        "@hourly" => Some("0 0 * * * *"),
        "@daily" | "@midnight" => Some("0 0 0 * * *"),
        "@weekly" => Some("0 0 0 * * Sun"),
        "@monthly" => Some("0 0 0 1 * *"),
        "@yearly" | "@annually" => Some("0 0 0 1 1 *"),
        "@minutely" => Some("0 * * * * *"),
        _ => None,
    };
    if let Some(expression) = alias {
        return Ok(expression.into());
    }
    if schedule.starts_with('@') {
        return Err(
            "不支持的计划别名；可用 @minutely/@hourly/@daily/@weekly/@monthly/@yearly".into(),
        );
    }
    let fields: Vec<&str> = schedule.split_whitespace().collect();
    match fields.len() {
        // 面板和 AI 默认使用大家熟悉的五字段 Cron；cron crate 需要补秒字段。
        5 => Ok(format!("0 {schedule}")),
        6 | 7 => Ok(schedule.to_string()),
        _ => Err("Cron 应为 5 个字段：分钟 小时 日 月 星期".into()),
    }
}

fn parse_cron(schedule: &str) -> Result<Schedule, String> {
    let expression = cron_expression_for_parser(schedule)?;
    Schedule::from_str(&expression).map_err(|error| format!("Cron 表达式无效: {error}"))
}

fn next_after(schedule: &str, after_ms: u64) -> Result<Option<u64>, String> {
    if schedule.starts_with("@once ") {
        let parsed = DateTime::parse_from_rfc3339(schedule[6..].trim())
            .map_err(|_| "单次运行时间已损坏".to_string())?;
        let timestamp = parsed.timestamp_millis();
        return Ok((timestamp > after_ms as i64).then_some(timestamp as u64));
    }
    let parsed = parse_cron(schedule)?;
    let after = Local
        .timestamp_millis_opt(after_ms as i64)
        .single()
        .ok_or("无法解析本地时间")?;
    Ok(parsed
        .after(&after)
        .next()
        .and_then(|next| u64::try_from(next.timestamp_millis()).ok()))
}

fn create_internal(
    tasks: &mut Vec<ScheduledTask>,
    input: ScheduledTaskInput,
    origin: TaskOrigin,
) -> Result<ScheduledTask, String> {
    if tasks.len() >= MAX_TASKS {
        return Err(format!("计划任务最多 {MAX_TASKS} 条"));
    }
    let input = normalize_input(input)?;
    let now = now_ms();
    let candidate = next_after(&input.schedule, now)?;
    if input.enabled && candidate.is_none() {
        return Err("单次运行时间必须晚于现在".into());
    }
    let next_run_at = input.enabled.then_some(candidate).flatten();
    let task = ScheduledTask {
        id: next_task_id(tasks),
        title: input.title,
        instruction: input.instruction,
        schedule: input.schedule,
        enabled: input.enabled,
        related_files: input.related_files,
        working_directory: input.working_directory,
        auto_approve: input.auto_approve,
        origin,
        created_at: now,
        updated_at: now,
        next_run_at,
        runs: Vec::new(),
    };
    tasks.push(task.clone());
    Ok(task)
}

fn update_internal(
    tasks: &mut [ScheduledTask],
    id: u64,
    input: ScheduledTaskInput,
) -> Result<ScheduledTask, String> {
    let input = normalize_input(input)?;
    let now = now_ms();
    let candidate = next_after(&input.schedule, now)?;
    if input.enabled && candidate.is_none() {
        return Err("单次运行时间必须晚于现在".into());
    }
    let next_run_at = input.enabled.then_some(candidate).flatten();
    let task = tasks
        .iter_mut()
        .find(|task| task.id == id)
        .ok_or_else(|| format!("计划任务 #{id} 不存在"))?;
    task.title = input.title;
    task.instruction = input.instruction;
    task.schedule = input.schedule;
    task.enabled = input.enabled;
    task.related_files = input.related_files;
    task.working_directory = input.working_directory;
    task.auto_approve = input.auto_approve;
    task.next_run_at = next_run_at;
    task.updated_at = now;
    Ok(task.clone())
}

#[tauri::command]
pub fn scheduled_task_list() -> Vec<ScheduledTask> {
    with_store(|store| store.tasks.clone()).unwrap_or_else(|error| {
        eprintln!("scheduled_task_list 失败: {error}");
        Vec::new()
    })
}

#[tauri::command]
pub fn scheduled_task_create(input: ScheduledTaskInput) -> Result<ScheduledTask, String> {
    mutate_store(|tasks| create_internal(tasks, input, TaskOrigin::User))
}

#[tauri::command]
pub fn scheduled_task_update(id: u64, input: ScheduledTaskInput) -> Result<ScheduledTask, String> {
    mutate_store(|tasks| update_internal(tasks, id, input))
}

#[tauri::command]
pub fn scheduled_task_set_enabled(id: u64, enabled: bool) -> Result<ScheduledTask, String> {
    mutate_store(|tasks| {
        let now = now_ms();
        let task = tasks
            .iter_mut()
            .find(|task| task.id == id)
            .ok_or_else(|| format!("计划任务 #{id} 不存在"))?;
        if enabled {
            let next = next_after(&task.schedule, now)?;
            if next.is_none() {
                return Err("单次运行时间已经过去，请先编辑运行计划".into());
            }
            task.next_run_at = next;
        } else {
            task.next_run_at = None;
        }
        task.enabled = enabled;
        task.updated_at = now;
        Ok(task.clone())
    })
}

#[tauri::command]
pub fn scheduled_task_remove(id: u64) -> Result<(), String> {
    mutate_store(|tasks| {
        if tasks
            .iter()
            .find(|task| task.id == id)
            .is_some_and(has_active_run)
        {
            return Err("任务正在运行，结束后才能删除".into());
        }
        let before = tasks.len();
        tasks.retain(|task| task.id != id);
        if tasks.len() == before {
            return Err(format!("计划任务 #{id} 不存在"));
        }
        Ok(())
    })
}

#[tauri::command]
pub fn scheduled_task_run_now(id: u64) -> Result<TaskRunRecord, String> {
    let request = mutate_store(|tasks| {
        let now = now_ms();
        let task = tasks
            .iter_mut()
            .find(|task| task.id == id)
            .ok_or_else(|| format!("计划任务 #{id} 不存在"))?;
        if has_active_run(task) {
            return Err("任务已有一轮正在排队或执行".into());
        }
        let run = TaskRunRecord {
            id: next_run_id(task),
            trigger: TaskRunTrigger::Manual,
            scheduled_for: now,
            queued_at: now,
            started_at: None,
            finished_at: None,
            status: TaskRunStatus::Queued,
            conversation_id: None,
            summary: None,
        };
        push_run(task, run.clone());
        task.updated_at = now;
        Ok(ScheduledTaskRunRequest {
            task: task.clone(),
            run,
        })
    })?;
    emit_run_request(&request);
    Ok(request.run)
}

#[tauri::command]
pub fn scheduled_task_run_started(
    id: u64,
    run_id: u64,
    conversation_id: String,
) -> Result<(), String> {
    mutate_store(|tasks| {
        let now = now_ms();
        let task = tasks
            .iter_mut()
            .find(|task| task.id == id)
            .ok_or_else(|| format!("计划任务 #{id} 不存在"))?;
        let run = task
            .runs
            .iter_mut()
            .find(|run| run.id == run_id)
            .ok_or_else(|| format!("运行记录 #{run_id} 不存在"))?;
        if run.status != TaskRunStatus::Queued {
            return Err("该运行记录已被处理".into());
        }
        run.status = TaskRunStatus::Running;
        run.started_at = Some(now);
        run.conversation_id = Some(conversation_id);
        task.updated_at = now;
        Ok(())
    })
}

#[tauri::command]
pub fn scheduled_task_run_phase(
    id: u64,
    run_id: u64,
    waiting_approval: bool,
) -> Result<(), String> {
    mutate_store(|tasks| {
        let now = now_ms();
        let task = tasks
            .iter_mut()
            .find(|task| task.id == id)
            .ok_or_else(|| format!("计划任务 #{id} 不存在"))?;
        let run = task
            .runs
            .iter_mut()
            .find(|run| run.id == run_id)
            .ok_or_else(|| format!("运行记录 #{run_id} 不存在"))?;
        if !run.status.is_active() {
            return Err("该运行已经结束".into());
        }
        run.status = if waiting_approval {
            TaskRunStatus::WaitingApproval
        } else {
            TaskRunStatus::Running
        };
        task.updated_at = now;
        Ok(())
    })
}

#[tauri::command]
pub fn scheduled_task_run_finished(
    id: u64,
    run_id: u64,
    success: bool,
    summary: String,
) -> Result<(), String> {
    mutate_store(|tasks| {
        let now = now_ms();
        let task = tasks
            .iter_mut()
            .find(|task| task.id == id)
            .ok_or_else(|| format!("计划任务 #{id} 不存在"))?;
        let run = task
            .runs
            .iter_mut()
            .find(|run| run.id == run_id)
            .ok_or_else(|| format!("运行记录 #{run_id} 不存在"))?;
        if !run.status.is_active() {
            return Ok(());
        }
        run.status = if success {
            TaskRunStatus::Succeeded
        } else {
            TaskRunStatus::Failed
        };
        run.finished_at = Some(now);
        let summary = summary.trim();
        if !summary.is_empty() {
            run.summary = Some(summary.chars().take(MAX_RUN_SUMMARY_CHARS).collect());
        }
        task.updated_at = now;
        Ok(())
    })
}

fn fire_due_tasks() -> Result<(), String> {
    let now = now_ms();
    let store = STORE.get().ok_or("计划任务存储未初始化")?;
    let mut guard = store.lock().map_err(|_| "计划任务存储锁已损坏")?;
    let previous = guard.tasks.clone();
    let mut requests = Vec::new();
    let mut changed = false;

    for task in &mut guard.tasks {
        let Some(scheduled_for) = task.next_run_at else {
            continue;
        };
        if !task.enabled || scheduled_for > now {
            continue;
        }
        changed = true;
        let is_once = task.schedule.starts_with("@once ");
        if is_once {
            task.enabled = false;
            task.next_run_at = None;
        } else {
            match next_after(&task.schedule, now) {
                Ok(next) => task.next_run_at = next,
                Err(error) => {
                    task.enabled = false;
                    task.next_run_at = None;
                    let run = TaskRunRecord {
                        id: next_run_id(task),
                        trigger: TaskRunTrigger::Schedule,
                        scheduled_for,
                        queued_at: now,
                        started_at: None,
                        finished_at: Some(now),
                        status: TaskRunStatus::Failed,
                        conversation_id: None,
                        summary: Some(format!("运行计划失效: {error}")),
                    };
                    push_run(task, run);
                    task.updated_at = now;
                    continue;
                }
            }
        }

        if has_active_run(task) {
            let run = TaskRunRecord {
                id: next_run_id(task),
                trigger: TaskRunTrigger::Schedule,
                scheduled_for,
                queued_at: now,
                started_at: None,
                finished_at: Some(now),
                status: TaskRunStatus::Skipped,
                conversation_id: None,
                summary: Some("上一轮仍在执行，本轮已跳过以避免并发重入".into()),
            };
            push_run(task, run);
            task.updated_at = now;
            continue;
        }

        let run = TaskRunRecord {
            id: next_run_id(task),
            trigger: TaskRunTrigger::Schedule,
            scheduled_for,
            queued_at: now,
            started_at: None,
            finished_at: None,
            status: TaskRunStatus::Queued,
            conversation_id: None,
            summary: None,
        };
        push_run(task, run.clone());
        task.updated_at = now;
        requests.push(ScheduledTaskRunRequest {
            task: task.clone(),
            run,
        });
    }

    if !changed {
        return Ok(());
    }
    sort_tasks(&mut guard.tasks);
    if let Err(error) = guard.save() {
        guard.tasks = previous;
        return Err(error);
    }
    let count = guard.tasks.len();
    drop(guard);
    notify_changed(count);
    for request in &requests {
        emit_run_request(request);
    }
    Ok(())
}

fn value_files(value: &Value) -> Result<Vec<String>, String> {
    let Some(items) = value.as_array() else {
        return Err("relatedFiles 必须是路径数组".into());
    };
    items
        .iter()
        .map(|item| {
            item.as_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| "relatedFiles 中只能放字符串路径".to_string())
        })
        .collect()
}

fn value_string(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(Value::as_str).map(ToOwned::to_owned)
}

fn task_input_from_args(args: &Value) -> Result<ScheduledTaskInput, String> {
    Ok(ScheduledTaskInput {
        title: value_string(args, "title").unwrap_or_default(),
        instruction: value_string(args, "instruction").unwrap_or_default(),
        schedule: value_string(args, "schedule").unwrap_or_default(),
        enabled: args.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        related_files: match args.get("relatedFiles") {
            Some(value) => value_files(value)?,
            None => Vec::new(),
        },
        working_directory: value_string(args, "workingDirectory"),
        auto_approve: args
            .get("autoApprove")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn format_timestamp(timestamp: Option<u64>) -> String {
    let Some(timestamp) = timestamp else {
        return "无".into();
    };
    Local
        .timestamp_millis_opt(timestamp as i64)
        .single()
        .map(|time| time.format("%Y-%m-%d %H:%M:%S %:z").to_string())
        .unwrap_or_else(|| timestamp.to_string())
}

/// Agent 工具：主动创建真正会执行 AI agent loop 的计划任务。
pub fn tool_create(args: &Value) -> Result<String, String> {
    let input = task_input_from_args(args)?;
    let task = mutate_store(|tasks| create_internal(tasks, input, TaskOrigin::Agent))?;
    Ok(format!(
        "已创建 AI 计划任务 #{}「{}」\n运行计划: {}\n下次运行: {}\n关联资源: {} 条\n无人值守写入/命令: {}",
        task.id,
        task.title,
        task.schedule,
        format_timestamp(task.next_run_at),
        task.related_files.len(),
        if task.auto_approve { "允许" } else { "不允许，届时需用户审批" }
    ))
}

pub fn tool_list() -> Result<String, String> {
    let tasks = with_store(|store| store.tasks.clone())?;
    if tasks.is_empty() {
        return Ok("当前没有 AI 计划任务。".into());
    }
    Ok(tasks
        .iter()
        .map(|task| {
            let last = task.runs.first().map(|run| format!("{:?}", run.status));
            format!(
                "#{} [{}] {} | {} | 下次 {} | 资源 {} | 最近 {}",
                task.id,
                if task.enabled { "启用" } else { "暂停" },
                task.title,
                task.schedule,
                format_timestamp(task.next_run_at),
                task.related_files.len(),
                last.unwrap_or_else(|| "尚未运行".into())
            )
        })
        .collect::<Vec<_>>()
        .join("\n"))
}

pub fn tool_update(args: &Value) -> Result<String, String> {
    let id = args
        .get("id")
        .and_then(Value::as_u64)
        .ok_or("缺少计划任务 id")?;
    let current = with_store(|store| store.tasks.iter().find(|task| task.id == id).cloned())?
        .ok_or_else(|| format!("计划任务 #{id} 不存在"))?;
    let input = ScheduledTaskInput {
        title: value_string(args, "title").unwrap_or(current.title),
        instruction: value_string(args, "instruction").unwrap_or(current.instruction),
        schedule: value_string(args, "schedule").unwrap_or(current.schedule),
        enabled: args
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(current.enabled),
        related_files: match args.get("relatedFiles") {
            Some(value) => value_files(value)?,
            None => current.related_files,
        },
        working_directory: if args.get("workingDirectory").is_some() {
            value_string(args, "workingDirectory")
        } else {
            current.working_directory
        },
        auto_approve: args
            .get("autoApprove")
            .and_then(Value::as_bool)
            .unwrap_or(current.auto_approve),
    };
    let task = mutate_store(|tasks| update_internal(tasks, id, input))?;
    Ok(format!(
        "已更新计划任务 #{}「{}」；下次运行 {}",
        task.id,
        task.title,
        format_timestamp(task.next_run_at)
    ))
}

pub fn tool_delete(args: &Value) -> Result<String, String> {
    let id = args
        .get("id")
        .and_then(Value::as_u64)
        .ok_or("缺少计划任务 id")?;
    scheduled_task_remove(id)?;
    Ok(format!("已删除计划任务 #{id}"))
}

pub fn tool_run_now(args: &Value) -> Result<String, String> {
    let id = args
        .get("id")
        .and_then(Value::as_u64)
        .ok_or("缺少计划任务 id")?;
    let run = scheduled_task_run_now(id)?;
    Ok(format!("计划任务 #{id} 已加入运行队列（运行 #{}）", run.id))
}

/// 注入主/子 agent 的时间与计划任务纪律，让模型自主识别“未来持续工作”。
pub fn prompt_fragment() -> String {
    format!(
        "【本机时间与 AI 计划任务】现在是 {}（系统本地时区）。当对话目标包含未来执行、周期执行、持续巡检，或你为后续工作创建了脚本/配置时，应自行判断并调用 create_scheduled_task，而不是等用户逐字说‘创建定时任务’。若后续执行需要复用脚本或配置，先创建并验证它们，再创建计划。任务 instruction 必须脱离当前对话也能独立执行；relatedFiles 要列全脚本、配置、输入及关键输出路径，workingDirectory 填实际工作目录。单次计划用 `@once RFC3339`；周期计划优先用五字段 Cron（分钟 小时 日 月 星期），如 `@hourly`、每天 9 点 `0 9 * * *`、工作日 9 点 `0 9 * * 1-5`。计划到点会启动真实 AI 会话；不要创建只显示提醒文案的计划，而要写清到点后实际执行、验证和产出的工作。修改前先 list_scheduled_tasks。不要把普通即时工作错误地排进未来。",
        Local::now().format("%Y-%m-%d %H:%M:%S %:z")
    )
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum LegacyRecurrence {
    Once,
    Daily,
    Weekdays,
    Weekly,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyTask {
    id: u64,
    title: String,
    message: String,
    enabled: bool,
    next_run_at: u64,
    recurrence: LegacyRecurrence,
    created_at: u64,
    updated_at: u64,
    #[serde(default)]
    last_run_at: Option<u64>,
}

fn load_tasks(source: &str) -> Result<(Vec<ScheduledTask>, bool), String> {
    if let Ok(tasks) = serde_json::from_str::<Vec<ScheduledTask>>(source) {
        return Ok((tasks, false));
    }
    let legacy: Vec<LegacyTask> =
        serde_json::from_str(source).map_err(|error| error.to_string())?;
    Ok((legacy.into_iter().map(migrate_legacy).collect(), true))
}

fn migrate_legacy(task: LegacyTask) -> ScheduledTask {
    let local = Local
        .timestamp_millis_opt(task.next_run_at as i64)
        .single()
        .unwrap_or_else(Local::now);
    let schedule = match task.recurrence {
        LegacyRecurrence::Once => format!("@once {}", local.to_rfc3339()),
        LegacyRecurrence::Daily => format!("{} {} * * *", local.minute(), local.hour()),
        LegacyRecurrence::Weekdays => {
            format!("{} {} * * 1-5", local.minute(), local.hour())
        }
        LegacyRecurrence::Weekly => format!(
            "{} {} * * {}",
            local.minute(),
            local.hour(),
            local.weekday().num_days_from_sunday()
        ),
    };
    let runs = task
        .last_run_at
        .map(|timestamp| {
            vec![TaskRunRecord {
                id: timestamp,
                trigger: TaskRunTrigger::Schedule,
                scheduled_for: timestamp,
                queued_at: timestamp,
                started_at: Some(timestamp),
                finished_at: Some(timestamp),
                status: TaskRunStatus::Succeeded,
                conversation_id: None,
                summary: Some("由旧版提醒任务迁移；没有 AI 会话记录".into()),
            }]
        })
        .unwrap_or_default();
    let completed_once = matches!(task.recurrence, LegacyRecurrence::Once)
        && !task.enabled
        && task.last_run_at.is_some();
    ScheduledTask {
        id: task.id,
        title: task.title,
        instruction: task.message,
        schedule,
        enabled: task.enabled,
        related_files: Vec::new(),
        working_directory: None,
        auto_approve: false,
        origin: TaskOrigin::User,
        created_at: task.created_at,
        updated_at: task.updated_at,
        next_run_at: (task.enabled && !completed_once).then_some(task.next_run_at),
        runs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration as ChronoDuration;
    use serde_json::json;

    #[test]
    fn accepts_five_field_cron_and_aliases() {
        assert_eq!(canonical_schedule(" 0 9 * * 1-5 ").unwrap(), "0 9 * * 1-5");
        assert_eq!(canonical_schedule("@HOURLY").unwrap(), "@hourly");
        assert!(canonical_schedule("0 9 * *").is_err());
        assert!(canonical_schedule("@sometimes").is_err());
    }

    #[test]
    fn hourly_schedule_lands_on_the_hour() {
        let now = Local::now();
        let next = next_after("@hourly", now.timestamp_millis() as u64)
            .unwrap()
            .unwrap();
        let next = Local.timestamp_millis_opt(next as i64).single().unwrap();
        assert_eq!(next.minute(), 0);
        assert_eq!(next.second(), 0);
        assert!(next > now);
        assert!(next <= now + ChronoDuration::hours(1));
    }

    #[test]
    fn paused_plan_has_no_stale_next_run() {
        let mut tasks = Vec::new();
        let task = create_internal(
            &mut tasks,
            ScheduledTaskInput {
                title: "暂停的计划".into(),
                instruction: "检查状态并汇报".into(),
                schedule: "@hourly".into(),
                enabled: false,
                related_files: Vec::new(),
                working_directory: None,
                auto_approve: false,
            },
            TaskOrigin::User,
        )
        .unwrap();
        assert_eq!(task.next_run_at, None);
    }

    #[test]
    fn agent_tools_persist_run_and_manage_lifecycle() {
        let directory = std::env::temp_dir().join(format!("deskling-ai-task-{}", now_ms()));
        std::fs::create_dir_all(&directory).unwrap();
        STORE
            .set(Mutex::new(TaskStore {
                path: directory.join("scheduled_tasks.json"),
                tasks: Vec::new(),
            }))
            .ok()
            .expect("测试存储只能初始化一次");

        let created = tool_create(&json!({
            "title": "整理日报",
            "instruction": "读取日志并生成日报。",
            "schedule": "@hourly",
            "relatedFiles": ["scripts/report.ps1", "data/input.json"],
            "workingDirectory": ".",
            "autoApprove": false
        }))
        .unwrap();
        assert!(created.contains("关联资源: 2 条"));
        let id = scheduled_task_list()[0].id;

        let run = scheduled_task_run_now(id).unwrap();
        scheduled_task_run_started(id, run.id, "conversation-1".into()).unwrap();
        scheduled_task_run_phase(id, run.id, true).unwrap();
        scheduled_task_run_phase(id, run.id, false).unwrap();
        scheduled_task_run_finished(id, run.id, true, "日报已生成".into()).unwrap();
        let task = scheduled_task_list().remove(0);
        assert_eq!(task.runs[0].status, TaskRunStatus::Succeeded);
        assert_eq!(
            task.runs[0].conversation_id.as_deref(),
            Some("conversation-1")
        );

        tool_update(&json!({ "id": id, "schedule": "0 9 * * *" })).unwrap();
        assert_eq!(scheduled_task_list()[0].schedule, "0 9 * * *");
        tool_delete(&json!({ "id": id })).unwrap();
        assert!(scheduled_task_list().is_empty());

        let _ = std::fs::remove_dir_all(directory);
    }
}
