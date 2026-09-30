import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SnapshotExportEvent, SnapshotExportPhase } from "./exporter";
import { DatasetSnapshotStore } from "./store";

export type DatasetSnapshotTaskStatus = "running" | "completed" | "failed";

export interface DatasetSnapshotTaskEvent {
  phase: SnapshotExportPhase;
  event: "progress" | "completed" | "failed";
  message: string;
  datasetVersionId: number;
  rowsWritten?: number;
  totalRows?: number;
  table?: string;
  error?: string;
}

export interface DatasetSnapshotTaskView {
  taskId: string;
  datasetVersionId: number;
  status: DatasetSnapshotTaskStatus;
  force: boolean;
  events: DatasetSnapshotTaskEvent[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
}

export interface CreateDatasetSnapshotTaskResult {
  taskId: string;
  status: DatasetSnapshotTaskStatus;
}

export interface DatasetSnapshotTaskManagerOptions {
  store: DatasetSnapshotStore;
  scriptPath?: string;
  spawnProcess?: SnapshotTaskSpawn;
}

export type SnapshotTaskSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

const PHASES = new Set<SnapshotExportPhase>([
  "event",
  "prefix",
  "post",
  "path",
  "outcome",
  "identity",
  "index",
  "verify",
]);

const TERMINAL_EVENTS = new Set<DatasetSnapshotTaskEvent["event"]>([
  "completed",
  "failed",
]);

function parseTaskEvent(line: string): DatasetSnapshotTaskEvent {
  let value: Partial<DatasetSnapshotTaskEvent>;
  try {
    value = JSON.parse(line) as Partial<DatasetSnapshotTaskEvent>;
  } catch (error) {
    throw new Error(`[DatasetSnapshotTask] 非法 JSONL 事件：${line.slice(0, 500)}`, {
      cause: error,
    });
  }
  if (
    !value ||
    typeof value !== "object" ||
    !PHASES.has(value.phase as SnapshotExportPhase) ||
    (value.event !== "progress" && value.event !== "completed" && value.event !== "failed") ||
    typeof value.message !== "string" ||
    typeof value.datasetVersionId !== "number"
  ) {
    throw new Error(`[DatasetSnapshotTask] 非法 JSONL 事件：${line.slice(0, 500)}`);
  }
  return value as DatasetSnapshotTaskEvent;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Process-local task registry for local snapshot exports.
 *
 * The HTTP/tRPC layer only returns task state; the CLI child owns the actual SQLite
 * publication and emits JSONL progress on stdout.
 */
export class DatasetSnapshotTaskManager {
  private readonly store: DatasetSnapshotStore;
  private readonly scriptPath: string;
  private readonly spawnProcess: SnapshotTaskSpawn;
  private readonly tasks = new Map<number, DatasetSnapshotTaskView>();
  private readonly children = new Map<number, ChildProcessWithoutNullStreams>();

  constructor(options: DatasetSnapshotTaskManagerOptions) {
    this.store = options.store;
    this.scriptPath =
      options.scriptPath ??
      fileURLToPath(new URL("../../../scripts/datasetSnapshot.ts", import.meta.url));
    this.spawnProcess = options.spawnProcess ?? (spawn as SnapshotTaskSpawn);
  }

  create(
    datasetVersionId: number,
    options: { force?: boolean } = {},
  ): CreateDatasetSnapshotTaskResult {
    const existing = this.tasks.get(datasetVersionId);
    if (existing?.status === "running") {
      return { taskId: existing.taskId, status: existing.status };
    }

    const task: DatasetSnapshotTaskView = {
      taskId: randomUUID(),
      datasetVersionId,
      status: "running",
      force: options.force ?? false,
      events: [],
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
    };
    this.tasks.set(datasetVersionId, task);

    const args = [
      "--import",
      "tsx",
      this.scriptPath,
      "--dataset-version-id",
      String(datasetVersionId),
      "--json-events",
    ];
    if (task.force) args.push("--force");

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess(process.execPath, args, {
        cwd: process.cwd(),
        env: { ...process.env },
        windowsHide: true,
      });
    } catch (error) {
      this.finish(task, "failed", formatError(error));
      return { taskId: task.taskId, status: task.status };
    }
    this.children.set(datasetVersionId, child);

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let terminalEvent: DatasetSnapshotTaskEvent | null = null;

    const failByProtocol = (message: string): void => {
      if (task.status !== "running") return;
      task.events.push({
        phase: "verify",
        event: "failed",
        message,
        datasetVersionId,
        error: message,
      });
      this.finish(task, "failed", message);
      child.kill();
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      for (;;) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline < 0) break;
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line.length === 0) continue;
        try {
          const event = parseTaskEvent(line);
          if (event.datasetVersionId !== datasetVersionId) {
            throw new Error(
              `[DatasetSnapshotTask] 事件 datasetVersionId=${event.datasetVersionId}，期望 ${datasetVersionId}`,
            );
          }
          task.events.push(event);
          if (TERMINAL_EVENTS.has(event.event)) terminalEvent = event;
        } catch (error) {
          failByProtocol(formatError(error));
          return;
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrBuffer = `${stderrBuffer}${chunk}`.slice(-8_000);
    });
    child.on("error", (error) => {
      this.finish(task, "failed", error.message);
    });
    child.on("close", (code) => {
      this.children.delete(datasetVersionId);
      task.exitCode = code;
      const trailing = stdoutBuffer.trim();
      if (task.status === "running" && trailing.length > 0) {
        try {
          const event = parseTaskEvent(trailing);
          if (event.datasetVersionId !== datasetVersionId) {
            throw new Error(
              `[DatasetSnapshotTask] 事件 datasetVersionId=${event.datasetVersionId}，期望 ${datasetVersionId}`,
            );
          }
          task.events.push(event);
          if (TERMINAL_EVENTS.has(event.event)) terminalEvent = event;
        } catch (error) {
          failByProtocol(formatError(error));
        }
      }

      if (task.status !== "running") return;
      if (terminalEvent?.event === "completed" && code === 0) {
        this.finish(task, "completed", null);
        return;
      }
      const terminalError =
        terminalEvent?.event === "failed"
          ? terminalEvent.message
          : code === 0
            ? "快照导出进程未返回 completed 事件"
            : `快照导出进程退出码 ${String(code)}${stderrBuffer.trim() ? `：${stderrBuffer.trim()}` : ""}`;
      this.finish(task, "failed", terminalError);
    });

    return { taskId: task.taskId, status: task.status };
  }

  get(datasetVersionId: number): DatasetSnapshotTaskView | null {
    const task = this.tasks.get(datasetVersionId);
    return task ? structuredClone(task) : null;
  }

  private finish(
    task: DatasetSnapshotTaskView,
    status: Exclude<DatasetSnapshotTaskStatus, "running">,
    error: string | null,
  ): void {
    if (task.status !== "running") return;
    task.status = status;
    task.error = error;
    task.finishedAt = new Date().toISOString();
    this.store.invalidate(task.datasetVersionId);
  }
}
