/**
 * STEP 7.3 — Checkpoint 测试（§19 / §20 / §34.G）。
 */

import { describe, expect, it } from "vitest";
import {
  MemoryCheckpointStore,
  createPendingCheckpoint,
  toFinalCheckpoint,
  toRunningCheckpoint,
} from "./checkpoint";

describe("checkpoint 构造", () => {
  it("createPendingCheckpoint", () => {
    const cp = createPendingCheckpoint("2026-09-04");
    expect(cp.status).toBe("PENDING");
    expect(cp.attempts).toBe(0);
    expect(cp.rowCount).toBeNull();
  });

  it("toRunningCheckpoint 递增 attempts", () => {
    const cp = toRunningCheckpoint(createPendingCheckpoint("2026-09-04"), "2026-09-04");
    expect(cp.status).toBe("RUNNING");
    expect(cp.attempts).toBe(1);
  });

  it("toFinalCheckpoint 标记 SUCCESS + rowCount", () => {
    const cp = toFinalCheckpoint("2026-09-04", "SUCCESS", 1, { rowCount: 5500, receivedRows: 5500 });
    expect(cp.status).toBe("SUCCESS");
    expect(cp.rowCount).toBe(5500);
    expect(cp.completedAt).not.toBeNull();
  });
});

describe("MemoryCheckpointStore", () => {
  it("set/get 往返", async () => {
    const store = new MemoryCheckpointStore();
    await store.set(toFinalCheckpoint("2026-09-04", "SUCCESS", 1, { rowCount: 100 }));
    const cp = await store.get("2026-09-04");
    expect(cp?.status).toBe("SUCCESS");
    expect(cp?.rowCount).toBe(100);
  });

  it("get 不存在 → null", async () => {
    const store = new MemoryCheckpointStore();
    expect(await store.get("2099-01-01")).toBeNull();
  });

  it("list 按日期范围过滤 + 排序", async () => {
    const store = new MemoryCheckpointStore();
    await store.set(toFinalCheckpoint("2026-09-03", "SUCCESS", 1));
    await store.set(toFinalCheckpoint("2026-09-04", "FAILED", 2));
    await store.set(toFinalCheckpoint("2026-09-05", "SUCCESS", 1));
    const list = await store.list("2026-09-04", "2026-09-05");
    expect(list.map((cp) => cp.tradeDate)).toEqual(["2026-09-04", "2026-09-05"]);
  });

  it("set 覆盖（upsert 语义，不产生重复）", async () => {
    const store = new MemoryCheckpointStore();
    await store.set(toFinalCheckpoint("2026-09-04", "FAILED", 1));
    await store.set(toFinalCheckpoint("2026-09-04", "SUCCESS", 2, { rowCount: 10 }));
    expect(store.size).toBe(1);
    expect((await store.get("2026-09-04"))?.status).toBe("SUCCESS");
  });
});
