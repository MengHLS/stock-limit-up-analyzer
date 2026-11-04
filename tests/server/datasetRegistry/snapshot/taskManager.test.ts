import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatasetSnapshotStore } from "../../../../server/datasetRegistry/snapshot/store";
import {
  DatasetSnapshotTaskManager,
  type DatasetSnapshotTaskStatus,
} from "../../../../server/datasetRegistry/snapshot/taskManager";

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function asChild(child: FakeChild): ChildProcessWithoutNullStreams {
  return child as unknown as ChildProcessWithoutNullStreams;
}

async function waitForStatus(
  manager: DatasetSnapshotTaskManager,
  datasetVersionId: number,
  status: DatasetSnapshotTaskStatus,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (manager.get(datasetVersionId)?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`task for ${datasetVersionId} never reached status ${status}`);
}

function progressLine(datasetVersionId: number, patch: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    phase: "event",
    event: "progress",
    message: "event 已导出 1 行",
    datasetVersionId,
    rowsWritten: 1,
    ...patch,
  })}\n`;
}

describe("DatasetSnapshotTaskManager", () => {
  let root: string;
  let store: DatasetSnapshotStore;
  let children: FakeChild[];
  let spawnCalls: Array<{ command: string; args: readonly string[] }>;

  function makeManager(): DatasetSnapshotTaskManager {
    return new DatasetSnapshotTaskManager({
      store,
      scriptPath: path.join(root, "scripts", "datasetSnapshot.ts"),
      spawnProcess: (command, args) => {
        spawnCalls.push({ command, args: [...args] });
        const child = new FakeChild();
        children.push(child);
        return asChild(child);
      },
    });
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "dataset-snapshot-task-"));
    store = new DatasetSnapshotStore(root);
    children = [];
    spawnCalls = [];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("spawns the CLI with the expected arguments and completes on a completed event", async () => {
    const manager = makeManager();
    const created = manager.create(1);
    expect(created.status).toBe("running");
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.args).toEqual([
      "--import",
      "tsx",
      path.join(root, "scripts", "datasetSnapshot.ts"),
      "--dataset-version-id",
      "1",
      "--json-events",
    ]);

    const child = children[0]!;
    child.stdout.write(progressLine(1));
    child.stdout.write(
      `${JSON.stringify({
        phase: "verify",
        event: "completed",
        message: "快照发布完成：17 行",
        datasetVersionId: 1,
        rowsWritten: 17,
        totalRows: 17,
      })}\n`,
    );
    child.emit("close", 0);

    await waitForStatus(manager, 1, "completed");
    const task = manager.get(1)!;
    expect(task.taskId).toBe(created.taskId);
    expect(task.events).toHaveLength(2);
    expect(task.events[0]).toMatchObject({ event: "progress", phase: "event", rowsWritten: 1 });
    expect(task.error).toBeNull();
    expect(task.exitCode).toBe(0);
  });

  it("deduplicates concurrent creates for the same version", async () => {
    const manager = makeManager();
    const first = manager.create(1);
    const second = manager.create(1);
    expect(second).toEqual({ taskId: first.taskId, status: "running" });
    expect(spawnCalls).toHaveLength(1);

    children[0]!.stdout.write(
      `${JSON.stringify({ phase: "verify", event: "completed", message: "done", datasetVersionId: 1 })}\n`,
    );
    children[0]!.emit("close", 0);
    await waitForStatus(manager, 1, "completed");

    // 终态后允许重新创建（新的 taskId）。
    const third = manager.create(1);
    expect(third.taskId).not.toBe(first.taskId);
    expect(spawnCalls).toHaveLength(2);
  });

  it("marks the task failed when the CLI emits a failed terminal event", async () => {
    const manager = makeManager();
    manager.create(7);
    const child = children[0]!;
    child.stdout.write(
      `${JSON.stringify({
        phase: "verify",
        event: "failed",
        message: "identity 缺失",
        datasetVersionId: 7,
        error: "identity 缺失",
      })}\n`,
    );
    child.emit("close", 1);
    await waitForStatus(manager, 7, "failed");
    expect(manager.get(7)!.error).toBe("identity 缺失");
  });

  it("marks the task failed when spawn throws", () => {
    const manager = new DatasetSnapshotTaskManager({
      store,
      scriptPath: path.join(root, "scripts", "datasetSnapshot.ts"),
      spawnProcess: () => {
        throw new Error("spawn EINVAL");
      },
    });
    const created = manager.create(9);
    expect(created.status).toBe("failed");
    const task = manager.get(9)!;
    expect(task.status).toBe("failed");
    expect(task.error).toBe("spawn EINVAL");
  });

  it("marks the task failed when the process exits non-zero without a terminal event", async () => {
    const manager = makeManager();
    manager.create(3);
    const child = children[0]!;
    child.stderr.write("boom");
    child.emit("close", 2);
    await waitForStatus(manager, 3, "failed");
    expect(manager.get(3)!.error).toContain("退出码 2");
    expect(manager.get(3)!.error).toContain("boom");
  });

  it("rejects malformed JSONL protocol lines", async () => {
    const manager = makeManager();
    manager.create(5);
    const child = children[0]!;
    child.stdout.write("not json\n");
    await waitForStatus(manager, 5, "failed");
    expect(manager.get(5)!.error).toMatch(/非法 JSONL/);
    expect(child.killed).toBe(true);
  });
});
