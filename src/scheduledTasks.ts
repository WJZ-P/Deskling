import { invoke } from "@tauri-apps/api/core";

export type TaskOrigin = "user" | "agent";
export type TaskRunTrigger = "schedule" | "manual";
export type TaskRunStatus =
  | "queued"
  | "running"
  | "waitingApproval"
  | "succeeded"
  | "failed"
  | "skipped"
  | "interrupted";

export interface TaskRunRecord {
  id: number;
  trigger: TaskRunTrigger;
  scheduledFor: number;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  status: TaskRunStatus;
  conversationId?: string;
  summary?: string;
}

export interface ScheduledTask {
  id: number;
  title: string;
  instruction: string;
  schedule: string;
  enabled: boolean;
  relatedFiles: string[];
  workingDirectory?: string;
  autoApprove: boolean;
  origin: TaskOrigin;
  createdAt: number;
  updatedAt: number;
  nextRunAt?: number;
  runs: TaskRunRecord[];
}

export interface ScheduledTaskInput {
  title: string;
  instruction: string;
  schedule: string;
  enabled: boolean;
  relatedFiles: string[];
  workingDirectory?: string;
  autoApprove: boolean;
}

export interface ScheduledTaskRunRequest {
  task: ScheduledTask;
  run: TaskRunRecord;
}

export function listScheduledTasks(): Promise<ScheduledTask[]> {
  return invoke<ScheduledTask[]>("scheduled_task_list");
}

export function createScheduledTask(
  input: ScheduledTaskInput,
): Promise<ScheduledTask> {
  return invoke<ScheduledTask>("scheduled_task_create", { input });
}

export function updateScheduledTask(
  id: number,
  input: ScheduledTaskInput,
): Promise<ScheduledTask> {
  return invoke<ScheduledTask>("scheduled_task_update", { id, input });
}

export function setScheduledTaskEnabled(
  id: number,
  enabled: boolean,
): Promise<ScheduledTask> {
  return invoke<ScheduledTask>("scheduled_task_set_enabled", { id, enabled });
}

export function removeScheduledTask(id: number): Promise<void> {
  return invoke("scheduled_task_remove", { id });
}

export function runScheduledTaskNow(id: number): Promise<TaskRunRecord> {
  return invoke<TaskRunRecord>("scheduled_task_run_now", { id });
}

export function markScheduledTaskRunStarted(
  id: number,
  runId: number,
  conversationId: string,
): Promise<void> {
  return invoke("scheduled_task_run_started", { id, runId, conversationId });
}

export function setScheduledTaskRunWaiting(
  id: number,
  runId: number,
  waitingApproval: boolean,
): Promise<void> {
  return invoke("scheduled_task_run_phase", { id, runId, waitingApproval });
}

export function finishScheduledTaskRun(
  id: number,
  runId: number,
  success: boolean,
  summary: string,
): Promise<void> {
  return invoke("scheduled_task_run_finished", {
    id,
    runId,
    success,
    summary,
  });
}
