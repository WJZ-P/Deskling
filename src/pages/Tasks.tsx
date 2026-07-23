import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { styled } from "@linaria/react";
import {
  PixelPage,
  PixelPageHeader,
  PixelPageSubtitle,
  PixelPageTitle,
} from "../components/pixel/PixelPage";
import { PixelSection } from "../components/pixel/PixelSection";
import { PixelCard } from "../components/pixel/PixelCard";
import { PixelButton } from "../components/pixel/PixelButton";
import { PixelSwitch } from "../components/pixel/PixelSwitch";
import { PixelTag } from "../components/pixel/PixelTag";
import { PixelModal } from "../components/pixel/PixelModal";
import { PixelConfirmModal } from "../components/pixel/PixelConfirmModal";
import { PixelInput } from "../components/pixel/PixelInput";
import { PixelTextarea } from "../components/pixel/PixelTextarea";
import { PixelSelect, type PixelSelectOption } from "../components/pixel/PixelSelect";
import { PixelWell } from "../components/pixel/PixelWell";
import { t } from "../styles/theme";
import {
  createScheduledTask,
  listScheduledTasks,
  removeScheduledTask,
  runScheduledTaskNow,
  setScheduledTaskEnabled,
  updateScheduledTask,
  type ScheduledTask,
  type ScheduledTaskInput,
  type TaskRunRecord,
  type TaskRunStatus,
} from "../scheduledTasks";

type ScheduleMode = "once" | "hourly" | "daily" | "custom";

const SCHEDULE_OPTIONS: PixelSelectOption[] = [
  { value: "once", label: "单次运行" },
  { value: "hourly", label: "每小时" },
  { value: "daily", label: "每天" },
  { value: "custom", label: "自定义 Cron" },
];

interface TaskDraft {
  title: string;
  instruction: string;
  scheduleMode: ScheduleMode;
  onceAt: string;
  dailyAt: string;
  cron: string;
  workingDirectory: string;
  relatedFiles: string;
  autoApprove: boolean;
  enabled: boolean;
}

const DATE_TIME = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const FULL_DATE_TIME = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const RUN_LABEL: Record<TaskRunStatus, string> = {
  queued: "排队中",
  running: "执行中",
  waitingApproval: "等待审批",
  succeeded: "成功",
  failed: "失败",
  skipped: "已跳过",
  interrupted: "已中断",
};

function roundedFuture(): number {
  const date = new Date(Date.now() + 30 * 60_000);
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5);
  return date.getTime();
}

function toLocalInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function blankDraft(): TaskDraft {
  return {
    title: "",
    instruction: "",
    scheduleMode: "hourly",
    onceAt: toLocalInput(roundedFuture()),
    dailyAt: "09:00",
    cron: "0 */2 * * *",
    workingDirectory: "",
    relatedFiles: "",
    autoApprove: false,
    enabled: true,
  };
}

function draftFor(task: ScheduledTask): TaskDraft {
  const draft = blankDraft();
  const once = task.schedule.match(/^@once\s+(.+)$/i);
  const daily = task.schedule.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (once) {
    const timestamp = new Date(once[1]).getTime();
    draft.scheduleMode = "once";
    draft.onceAt = toLocalInput(timestamp > Date.now() ? timestamp : roundedFuture());
  } else if (task.schedule === "@hourly") {
    draft.scheduleMode = "hourly";
  } else if (task.schedule === "@daily") {
    draft.scheduleMode = "daily";
    draft.dailyAt = "00:00";
  } else if (daily) {
    draft.scheduleMode = "daily";
    draft.dailyAt = `${daily[2].padStart(2, "0")}:${daily[1].padStart(2, "0")}`;
  } else {
    draft.scheduleMode = "custom";
    draft.cron = task.schedule;
  }
  return {
    ...draft,
    title: task.title,
    instruction: task.instruction,
    workingDirectory: task.workingDirectory ?? "",
    relatedFiles: task.relatedFiles.join("\n"),
    autoApprove: task.autoApprove,
    enabled: task.enabled,
  };
}

function scheduleFromDraft(draft: TaskDraft): string {
  if (draft.scheduleMode === "hourly") return "@hourly";
  if (draft.scheduleMode === "daily") {
    const [hour = "0", minute = "0"] = draft.dailyAt.split(":");
    return `${Number(minute)} ${Number(hour)} * * *`;
  }
  if (draft.scheduleMode === "once") {
    const timestamp = new Date(draft.onceAt).getTime();
    if (!Number.isFinite(timestamp)) return "";
    return `@once ${new Date(timestamp).toISOString()}`;
  }
  return draft.cron.trim();
}

function scheduleLabel(task: ScheduledTask): string {
  if (task.schedule === "@hourly") return "每小时整点";
  if (task.schedule === "@daily") return "每天 00:00";
  if (task.schedule === "@weekly") return "每周日 00:00";
  if (task.schedule === "@monthly") return "每月 1 日 00:00";
  if (task.schedule.startsWith("@once ")) {
    const timestamp = new Date(task.schedule.slice(6).trim()).getTime();
    return Number.isFinite(timestamp)
      ? `单次 · ${FULL_DATE_TIME.format(new Date(timestamp))}`
      : "单次运行";
  }
  const daily = task.schedule.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (daily) {
    return `每天 ${daily[2].padStart(2, "0")}:${daily[1].padStart(2, "0")}`;
  }
  return `Cron · ${task.schedule}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function latestRun(task: ScheduledTask): TaskRunRecord | undefined {
  return task.runs[0];
}

function runIsActive(run?: TaskRunRecord): boolean {
  return !!run && ["queued", "running", "waitingApproval"].includes(run.status);
}

function oneShotEnded(task: ScheduledTask): boolean {
  if (!task.schedule.startsWith("@once ")) return false;
  const timestamp = new Date(task.schedule.slice(6).trim()).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function taskStatus(task: ScheduledTask): {
  label: string;
  variant: "primary" | "normal" | "low";
} {
  const run = latestRun(task);
  if (run?.status === "waitingApproval") {
    return { label: "等待审批", variant: "primary" };
  }
  if (run?.status === "running" || run?.status === "queued") {
    return { label: RUN_LABEL[run.status], variant: "primary" };
  }
  if (task.enabled) return { label: "已计划", variant: "normal" };
  if (oneShotEnded(task)) {
    return {
      label: run?.status === "succeeded" ? "已完成" : "已结束",
      variant: "low",
    };
  }
  return { label: "已暂停", variant: "low" };
}

function runTone(status: TaskRunStatus): "primary" | "normal" | "low" {
  if (["queued", "running", "waitingApproval"].includes(status)) return "primary";
  if (status === "succeeded") return "normal";
  return "low";
}

export default function Tasks() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<ScheduledTask | null | undefined>();
  const [draft, setDraft] = useState<TaskDraft>(blankDraft);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<ScheduledTask | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await listScheduledTasks();
      setTasks(next);
      setError("");
    } catch (reason) {
      setError(`读取 AI 计划失败：${errorText(reason)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const changed = listen("scheduled-task:changed", () => void refresh());
    return () => {
      void changed.then((stop) => stop());
    };
  }, [refresh]);

  const ordered = useMemo(
    () =>
      [...tasks].sort((left, right) => {
        const leftActive = runIsActive(latestRun(left));
        const rightActive = runIsActive(latestRun(right));
        if (leftActive !== rightActive) return leftActive ? -1 : 1;
        if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
        const leftNext = left.nextRunAt ?? Number.MAX_SAFE_INTEGER;
        const rightNext = right.nextRunAt ?? Number.MAX_SAFE_INTEGER;
        if (leftNext !== rightNext) return leftNext - rightNext;
        return right.updatedAt - left.updatedAt;
      }),
    [tasks],
  );

  const openCreate = () => {
    setDraft(blankDraft());
    setEditing(null);
    setError("");
  };

  const openEdit = (task: ScheduledTask) => {
    setDraft(draftFor(task));
    setEditing(task);
    setError("");
  };

  const closeEditor = () => {
    if (!saving) setEditing(undefined);
  };

  const save = async () => {
    const title = draft.title.trim();
    const instruction = draft.instruction.trim();
    const schedule = scheduleFromDraft(draft);
    if (!title) {
      setError("请填写任务标题");
      return;
    }
    if (!instruction) {
      setError("请填写 AI 每次运行时要完成的执行指令");
      return;
    }
    if (!schedule) {
      setError("请填写有效的运行计划");
      return;
    }
    if (
      draft.scheduleMode === "once" &&
      new Date(draft.onceAt).getTime() <= Date.now()
    ) {
      setError("单次运行时间必须晚于现在");
      return;
    }

    const input: ScheduledTaskInput = {
      title,
      instruction,
      schedule,
      enabled: draft.enabled,
      relatedFiles: draft.relatedFiles
        .split(/\r?\n/)
        .map((path) => path.trim())
        .filter(Boolean),
      workingDirectory: draft.workingDirectory.trim() || undefined,
      autoApprove: draft.autoApprove,
    };
    setSaving(true);
    try {
      if (editing) await updateScheduledTask(editing.id, input);
      else await createScheduledTask(input);
      setNotice(editing ? "AI 计划已更新" : "AI 计划已创建并交给后台调度器");
      setError("");
      setEditing(undefined);
      await refresh();
    } catch (reason) {
      setError(`保存失败：${errorText(reason)}`);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (task: ScheduledTask, enabled: boolean) => {
    setBusyId(task.id);
    try {
      await setScheduledTaskEnabled(task.id, enabled);
      setNotice(enabled ? "AI 计划已恢复" : "AI 计划已暂停；正在运行的一轮不会被强制中断");
      setError("");
      await refresh();
    } catch (reason) {
      setError(`切换失败：${errorText(reason)}`);
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (task: ScheduledTask) => {
    setBusyId(task.id);
    try {
      await runScheduledTaskNow(task.id);
      setNotice(`「${task.title}」已加入 AI 运行队列；原计划时间不变`);
      setError("");
      await refresh();
    } catch (reason) {
      setError(`立即运行失败：${errorText(reason)}`);
    } finally {
      setBusyId(null);
    }
  };

  const openRunConversation = async (run: TaskRunRecord) => {
    if (!run.conversationId) return;
    try {
      await emitTo("chat", "scheduled-task:open-conversation", {
        conversationId: run.conversationId,
      });
      await invoke("chat_show");
    } catch (reason) {
      setError(`打开执行会话失败：${errorText(reason)}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await removeScheduledTask(deleting.id);
      setNotice(`已删除「${deleting.title}」及其运行记录`);
      setError("");
      setDeleting(null);
      await refresh();
    } catch (reason) {
      setError(`删除失败：${errorText(reason)}`);
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = tasks.filter((task) => task.enabled).length;
  const runningCount = tasks.filter((task) => runIsActive(latestRun(task))).length;
  const failedCount = tasks.filter((task) => {
    const status = latestRun(task)?.status;
    return status === "failed" || status === "interrupted";
  }).length;

  return (
    <PixelPage>
      <PixelPageHeader>
        <PixelPageTitle>AI 计划任务</PixelPageTitle>
        <PixelPageSubtitle>
          AI 会在对话中主动识别未来工作，保存执行上下文，并按 Cron 创建真实会话运行
        </PixelPageSubtitle>
      </PixelPageHeader>

      <SummaryRow>
        <PixelCard title="启用计划" variant="low">
          <SummaryValue>{activeCount}</SummaryValue>
        </PixelCard>
        <PixelCard title="正在运行" variant="normal">
          <SummaryValue>{runningCount}</SummaryValue>
        </PixelCard>
        <PixelCard title="需要关注" variant="primary">
          <SummaryValue>{failedCount}</SummaryValue>
        </PixelCard>
      </SummaryRow>

      {(error || notice) && (
        <Feedback role={error ? "alert" : "status"} data-error={error || undefined}>
          {error || notice}
        </Feedback>
      )}

      <PixelSection
        title={`运行计划 · ${tasks.length} 条`}
        trailing={
          <PixelButton variant="primary" onClick={openCreate}>
            ＋ 新建 AI 计划
          </PixelButton>
        }
      >
        {loading ? (
          <Empty>正在读取 AI 计划…</Empty>
        ) : ordered.length === 0 ? (
          <Empty>
            还没有运行计划。可以手动创建，也可以告诉 AI
            “每天分析这个日志并生成报告”，让它准备脚本并主动建立计划。
          </Empty>
        ) : (
          <TaskGrid>
            {ordered.map((task) => {
              const status = taskStatus(task);
              const run = latestRun(task);
              const active = runIsActive(run);
              const ended = oneShotEnded(task);
              return (
                <TaskCard
                  key={task.id}
                  title={task.title}
                  variant={active ? "normal" : task.enabled ? "low" : "normal"}
                  trailing={<PixelTag variant={status.variant}>{status.label}</PixelTag>}
                >
                  <OriginLine>
                    <PixelTag variant="low">
                      {task.origin === "agent" ? "AI 创建" : "手动创建"}
                    </PixelTag>
                    <ScheduleText>{scheduleLabel(task)}</ScheduleText>
                  </OriginLine>

                  <TaskInstruction>{task.instruction}</TaskInstruction>

                  <TaskMeta>
                    <span>
                      下次运行：
                      {task.nextRunAt
                        ? DATE_TIME.format(new Date(task.nextRunAt))
                        : active
                          ? "本轮结束后无后续计划"
                          : "无"}
                    </span>
                    <span>
                      权限：{task.autoApprove ? "无人值守" : "危险操作需审批"}
                    </span>
                  </TaskMeta>

                  {(task.workingDirectory || task.relatedFiles.length > 0) && (
                    <ResourceBox>
                      {task.workingDirectory && (
                        <ResourceLine title={task.workingDirectory}>
                          <ResourceKind>工作目录</ResourceKind>
                          {task.workingDirectory}
                        </ResourceLine>
                      )}
                      {task.relatedFiles.slice(0, 3).map((path) => (
                        <ResourceLine key={path} title={path}>
                          <ResourceKind>资源</ResourceKind>
                          {path}
                        </ResourceLine>
                      ))}
                      {task.relatedFiles.length > 3 && (
                        <MoreResources>另有 {task.relatedFiles.length - 3} 条关联资源</MoreResources>
                      )}
                    </ResourceBox>
                  )}

                  {run && (
                    <RunBox data-failed={
                      run.status === "failed" || run.status === "interrupted" || undefined
                    }>
                      <RunHead>
                        <PixelTag variant={runTone(run.status)}>
                          最近 · {RUN_LABEL[run.status]}
                        </PixelTag>
                        <RunTime>
                          {FULL_DATE_TIME.format(
                            new Date(run.startedAt ?? run.queuedAt),
                          )}
                        </RunTime>
                      </RunHead>
                      {run.summary && <RunSummary>{run.summary}</RunSummary>}
                      {run.conversationId && (
                        <PixelButton
                          small
                          variant="low"
                          onClick={() => void openRunConversation(run)}
                        >
                          查看执行会话
                        </PixelButton>
                      )}
                    </RunBox>
                  )}

                  <TaskActions>
                    <SwitchWrap>
                      <PixelSwitch
                        checked={task.enabled}
                        disabled={busyId === task.id || ended}
                        onChange={(enabled) => void toggle(task, enabled)}
                        aria-label={`${task.enabled ? "暂停" : "启用"}${task.title}`}
                      />
                      <SwitchText>
                        {ended ? "已结束" : task.enabled ? "启用" : "暂停"}
                      </SwitchText>
                    </SwitchWrap>
                    <ActionSpacer />
                    <PixelButton
                      small
                      disabled={busyId === task.id || active}
                      onClick={() => void runNow(task)}
                    >
                      立即运行
                    </PixelButton>
                    <PixelButton small variant="low" onClick={() => openEdit(task)}>
                      编辑
                    </PixelButton>
                    <PixelButton
                      small
                      variant="low"
                      disabled={active}
                      onClick={() => setDeleting(task)}
                    >
                      删除
                    </PixelButton>
                  </TaskActions>
                </TaskCard>
              );
            })}
          </TaskGrid>
        )}
      </PixelSection>

      <PixelModal
        open={editing !== undefined}
        title={editing ? `编辑 AI 计划 · ${editing.title}` : "新建 AI 计划任务"}
        onClose={closeEditor}
        width={680}
        footer={
          <>
            <PixelButton variant="low" disabled={saving} onClick={closeEditor}>
              取消
            </PixelButton>
            <PixelButton variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? "保存中…" : "保存运行计划"}
            </PixelButton>
          </>
        }
      >
        <Form>
          <Field>
            <FieldLabel>任务标题</FieldLabel>
            <FullInput
              value={draft.title}
              maxLength={80}
              placeholder="例如：生成项目日报"
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>AI 执行指令</FieldLabel>
            <FullTextarea
              rows={6}
              value={draft.instruction}
              maxLength={8000}
              placeholder="写成脱离当前对话也能理解的完整任务：读取什么、执行什么、验证什么、结果放在哪里"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  instruction: event.target.value,
                }))
              }
            />
            <FieldHint>到点后，这段内容会作为新会话的任务上下文交给 AI。</FieldHint>
          </Field>

          <FormColumns>
            <Field>
              <FieldLabel>运行方式</FieldLabel>
              <FullSelect
                options={SCHEDULE_OPTIONS}
                value={draft.scheduleMode}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    scheduleMode: value as ScheduleMode,
                  }))
                }
              />
            </Field>
            {draft.scheduleMode === "once" && (
              <Field>
                <FieldLabel>运行时间</FieldLabel>
                <FullInput
                  type="datetime-local"
                  min={toLocalInput(Date.now() + 60_000)}
                  value={draft.onceAt}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      onceAt: event.target.value,
                    }))
                  }
                />
              </Field>
            )}
            {draft.scheduleMode === "daily" && (
              <Field>
                <FieldLabel>每天运行时间</FieldLabel>
                <FullInput
                  type="time"
                  value={draft.dailyAt}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      dailyAt: event.target.value,
                    }))
                  }
                />
              </Field>
            )}
            {draft.scheduleMode === "hourly" && (
              <Field>
                <FieldLabel>实际计划</FieldLabel>
                <SchedulePreview compact>
                  <SchedulePreviewText>@hourly · 每小时整点</SchedulePreviewText>
                </SchedulePreview>
              </Field>
            )}
            {draft.scheduleMode === "custom" && (
              <Field>
                <FieldLabel>五字段 Cron</FieldLabel>
                <FullInput
                  value={draft.cron}
                  placeholder="*/15 * * * *"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, cron: event.target.value }))
                  }
                />
                <FieldHint>分钟 小时 日 月 星期；如 */15 * * * * = 每 15 分钟。</FieldHint>
              </Field>
            )}
          </FormColumns>

          <Field>
            <FieldLabel>工作目录</FieldLabel>
            <FullInput
              value={draft.workingDirectory}
              maxLength={2048}
              placeholder="例如 W:\\data\\MyProject"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  workingDirectory: event.target.value,
                }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>关联资源 · 每行一个文件或目录</FieldLabel>
            <FullTextarea
              rows={5}
              value={draft.relatedFiles}
              placeholder={"scripts/report.ps1\nconfig/report.json\ndata/output/"}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  relatedFiles: event.target.value,
                }))
              }
            />
            <FieldHint>
              AI 自动创建任务时会把本轮生成的脚本、配置和输入输出路径一起登记。
            </FieldHint>
          </Field>

          <SettingWell>
            <SettingRow>
              <div>
                <SettingLabel>允许无人值守写入与命令</SettingLabel>
                <SettingHint>
                  开启后，定时会话可直接修改文件和运行脚本；关闭时遇到危险工具会拉起会话等待审批。
                </SettingHint>
              </div>
              <PixelSwitch
                checked={draft.autoApprove}
                onChange={(autoApprove) =>
                  setDraft((current) => ({ ...current, autoApprove }))
                }
                aria-label="允许计划任务无人值守执行危险工具"
              />
            </SettingRow>
          </SettingWell>

          <SettingWell>
            <SettingRow>
              <div>
                <SettingLabel>保存后启用</SettingLabel>
                <SettingHint>关闭时只保存计划和上下文，不会自动排队运行。</SettingHint>
              </div>
              <PixelSwitch
                checked={draft.enabled}
                onChange={(enabled) =>
                  setDraft((current) => ({ ...current, enabled }))
                }
                aria-label="保存后启用任务"
              />
            </SettingRow>
          </SettingWell>
        </Form>
      </PixelModal>

      <PixelConfirmModal
        open={deleting !== null}
        title="删除 AI 计划"
        message={`确定删除「${deleting?.title ?? ""}」吗？任务配置和本地运行记录会一起移除，已创建的会话仍保留。`}
        confirmLabel="删除"
        tone="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </PixelPage>
  );
}

const SummaryRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: calc(${t.unit} * 3);

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const SummaryValue = styled.div`
  font: ${t.text2xl};
  font-weight: bold;
  color: ${t.colorAccent};
`;

const Feedback = styled.div`
  padding: calc(${t.unit} * 2) calc(${t.unit} * 3);
  border-left: 4px solid ${t.colorAccent};
  background: ${t.colorAccentSoft};
  font: ${t.textSm};
  color: ${t.colorText};

  &[data-error] {
    border-left-color: ${t.btnClose};
  }
`;

const TaskGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: calc(${t.unit} * 3);

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const TaskCard = styled(PixelCard)`
  min-width: 0;
`;

const OriginLine = styled.div`
  display: flex;
  align-items: center;
  gap: calc(${t.unit} * 2);
  min-width: 0;
`;

const ScheduleText = styled.span`
  overflow: hidden;
  color: ${t.colorTextMuted};
  font: ${t.textSm};
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const TaskInstruction = styled.p`
  display: -webkit-box;
  min-height: 44px;
  margin: 0;
  overflow: hidden;
  color: ${t.colorText};
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
`;

const TaskMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  color: ${t.colorTextMuted};
  font: ${t.textSm};
`;

const ResourceBox = styled.div`
  display: grid;
  gap: ${t.unit};
  padding: calc(${t.unit} * 2);
  border: 1px solid ${t.colorBorder};
  background: ${t.colorWell};
`;

const ResourceLine = styled.div`
  display: flex;
  gap: calc(${t.unit} * 2);
  min-width: 0;
  overflow: hidden;
  color: ${t.colorTextMuted};
  font: ${t.textXs};
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const ResourceKind = styled.span`
  flex: none;
  color: ${t.colorAccent};
  font-weight: bold;
`;

const MoreResources = styled.div`
  color: ${t.colorTextMuted};
  font: ${t.textXs};
`;

const RunBox = styled.div`
  display: grid;
  gap: calc(${t.unit} * 1.5);
  padding: calc(${t.unit} * 2);
  border-left: 3px solid ${t.colorAccent};
  background: ${t.colorAccentSoft};

  &[data-failed] {
    border-left-color: ${t.btnClose};
  }
`;

const RunHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(${t.unit} * 2);
`;

const RunTime = styled.span`
  color: ${t.colorTextMuted};
  font: ${t.textXs};
`;

const RunSummary = styled.div`
  display: -webkit-box;
  overflow: hidden;
  color: ${t.colorText};
  font: ${t.textSm};
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
`;

const TaskActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: calc(${t.unit} * 2);
  margin-top: ${t.unit};
`;

const SwitchWrap = styled.div`
  display: inline-flex;
  align-items: center;
  gap: calc(${t.unit} * 2);
`;

const SwitchText = styled.span`
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;

const ActionSpacer = styled.div`
  flex: 1;
`;

const Empty = styled.div`
  min-height: 170px;
  display: grid;
  place-items: center;
  padding: calc(${t.unit} * 6);
  text-align: center;
  font: ${t.textMd};
  color: ${t.colorTextMuted};
  white-space: pre-line;
`;

const Form = styled.div`
  display: flex;
  flex-direction: column;
  gap: calc(${t.unit} * 4);
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.unit};
  min-width: 0;
`;

const FieldLabel = styled.span`
  font: ${t.textSm};
  font-weight: bold;
  letter-spacing: 1px;
  color: ${t.colorTextMuted};
`;

const FieldHint = styled.span`
  display: block;
  margin-top: 2px;
  font: ${t.textXs};
  line-height: 1.5;
  color: ${t.colorTextMuted};
`;

const FullInput = styled(PixelInput)`
  width: 100%;
`;

const FullTextarea = styled(PixelTextarea)`
  width: 100%;
`;

const FullSelect = styled(PixelSelect)`
  width: 100%;
`;

const FormColumns = styled.div`
  display: grid;
  grid-template-columns: minmax(180px, 0.65fr) minmax(0, 1.35fr);
  gap: calc(${t.unit} * 3);

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const SchedulePreview = styled(PixelWell)``;

const SchedulePreviewText = styled.span`
  display: block;
  color: ${t.colorTextMuted};
  font: ${t.textSm};
  letter-spacing: 0.5px;
`;

const SettingWell = styled(PixelWell)`
  width: 100%;
`;

const SettingRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(${t.unit} * 4);

  > div {
    min-width: 0;
  }
`;

const SettingLabel = styled.span`
  display: block;
  color: ${t.colorText};
  font: ${t.textMd};
  font-weight: bold;
  letter-spacing: 1px;
`;

const SettingHint = styled.span`
  display: block;
  margin-top: 2px;
  color: ${t.colorTextMuted};
  font: ${t.textSm};
  line-height: 1.5;
`;
