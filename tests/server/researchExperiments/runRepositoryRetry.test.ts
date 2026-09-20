/**
 * RESEARCH-EXPERIMENT-004 — Run 仓库的**只读重试语义**（回归钉）。
 *
 * ## 为什么值得单独钉
 *
 * 2026-09-20 前端实测：冷启动后的第一次 `researchExperiments.listRuns` 返回 **500**
 * （19.2s 后失败，与 `server/db.ts` 的 `connectTimeout: 20_000` 同量级），紧接着重试同一
 * 请求 1.6s 成功。实验列表页因此显示「运行历史暂时取不到」。
 *
 * 根因不是「Run 表/迁移有问题」（`_probe_9ch_run_query.mts` 在真库上五步全绿），而是
 * **004 新增的读路径没有继承全站既有的兜底约定** ——`server/db.ts` 的池配置注释已写明
 * 「取出死连接 / 建连超时 ⇒ Drizzle 包成 `Failed query: …`」，既有兜底就是 `withReadRetry`。
 *
 * 本文件把它钉成**行为断言**（不是 grep 源码）：用假 db 让第一次读抛瞬时错误、第二次成功，
 * 断言「调用次数 = 2 且结果正确」；再用语义错误（表不存在）断言「调用次数 = 1」证明
 * **不是无脑重试**；最后断言写路径（insert）**绝不重试**（重试写可能造成重复写入）。
 *
 * 假 db 的形状：`select()` 链自返回、本身是 thenable（`await` 时触发 handler）；
 * `insert()` 返回 `{ values }`。**不模拟 drizzle 的 SQL 生成** —— 本文件断言的是重试次数与
 * 结果，不是 SQL 文本（SQL 文本由真库 E2E 覆盖）。
 */

import { describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../../../server/db", () => ({
  getDb: async () => holder.db,
}));

const { DbExperimentRunRepository } = await import(
  "../../../server/researchExperiments/persistence/runRepository"
);

/** Drizzle 形状的瞬时错误：真实原因在 `cause` 链上（只看最外层 message 会漏判）。 */
function transientError(): Error {
  const cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  const error = new Error("Failed query: select `id` from `research_experiment_run`");
  error.name = "DrizzleQueryError";
  (error as { cause?: unknown }).cause = cause;
  return error;
}

/** 语义错误：表不存在 —— 重试没有意义，必须原样抛出。 */
function semanticError(): Error {
  const cause = Object.assign(new Error("Table 'research_experiment_run' doesn't exist"), {
    code: "ER_NO_SUCH_TABLE",
    errno: 1146,
  });
  const error = new Error("Failed query: select `id` from `research_experiment_run`");
  error.name = "DrizzleQueryError";
  (error as { cause?: unknown }).cause = cause;
  return error;
}

interface FakeDb {
  db: Record<string, unknown>;
  calls: () => number;
}

/**
 * 假 db：`handler(callIndex, kind)` 决定第 n 次调用成功还是失败。
 * `successRows` 是该次调用成功时解析出的行数组。
 */
function makeFakeDb(
  handler: (callIndex: number, kind: "select" | "insert") => { ok: true; rows: unknown[] } | { ok: false; error: Error },
): FakeDb {
  let calls = 0;
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.from = passthrough;
  chain.where = passthrough;
  chain.orderBy = passthrough;
  chain.groupBy = passthrough;
  chain.limit = passthrough;
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
    const outcome = handler(calls, "select");
    calls += 1;
    return outcome.ok ? Promise.resolve(outcome.rows).then(onFulfilled, onRejected) : Promise.reject(outcome.error).then(onFulfilled, onRejected);
  };
  const db: Record<string, unknown> = {
    select: passthrough,
    insert: () => ({
      values: () => {
        const outcome = handler(calls, "insert");
        calls += 1;
        return outcome.ok ? Promise.resolve(outcome.rows) : Promise.reject(outcome.error);
      },
    }),
  };
  return { db, calls: () => calls };
}

describe("004 · Run 仓库的只读重试（冷连接瞬时失败不得变成页面 500）", () => {
  it("getRun：首次瞬时失败 → 重试一次后成功（调用 2 次，返回 null 而不是抛错）", async () => {
    const fake = makeFakeDb((index) => (index === 0 ? { ok: false, error: transientError() } : { ok: true, rows: [] }));
    holder.db = fake.db;
    const repo = new DbExperimentRunRepository();

    await expect(repo.getRun("RUN-X")).resolves.toBeNull();
    expect(fake.calls()).toBe(2);
  });

  it("listRuns：首次瞬时失败 → 重试后返回（调用 2 次，返回空数组）", async () => {
    const fake = makeFakeDb((index) => (index === 0 ? { ok: false, error: transientError() } : { ok: true, rows: [] }));
    holder.db = fake.db;
    const repo = new DbExperimentRunRepository();

    await expect(repo.listRuns({ experimentId: "first-board-pullback/entry-day" })).resolves.toEqual([]);
    expect(fake.calls()).toBe(2);
  });

  it("countRunsByExperiment：重试后读到真实计数（不是退化成 0）", async () => {
    const fake = makeFakeDb((index) => (index === 0 ? { ok: false, error: transientError() } : { ok: true, rows: [{ n: 7 }] }));
    holder.db = fake.db;
    const repo = new DbExperimentRunRepository();

    await expect(repo.countRunsByExperiment("first-board-pullback/entry-day")).resolves.toBe(7);
    expect(fake.calls()).toBe(2);
  });

  it("latestRunByExperiment：两步查询整体重试一次后成功", async () => {
    const fake = makeFakeDb((index) => (index === 0 ? { ok: false, error: transientError() } : { ok: true, rows: [] }));
    holder.db = fake.db;
    const repo = new DbExperimentRunRepository();

    const map = await repo.latestRunByExperiment();
    expect(map.size).toBe(0);
    // 第 1 次失败 → 第 2 次（分组查询）成功且 ids 为空 ⇒ 不再发第 3 条按 id 取行的查询
    expect(fake.calls()).toBe(2);
  });

  it("语义错误（ER_NO_SUCH_TABLE）**不重试**，只调用 1 次并原样抛出", async () => {
    const fake = makeFakeDb(() => ({ ok: false, error: semanticError() }));
    holder.db = fake.db;
    const repo = new DbExperimentRunRepository();

    await expect(repo.listRuns()).rejects.toThrow(/Failed query/u);
    expect(fake.calls()).toBe(1);
  });

  it("超过重试上限后仍然抛出（有界，不会把请求挂死）", async () => {
    const fake = makeFakeDb(() => ({ ok: false, error: transientError() }));
    holder.db = fake.db;
    const repo = new DbExperimentRunRepository();

    await expect(repo.getRun("RUN-Y")).rejects.toThrow(/Failed query/u);
    // 默认 3 次尝试（含首次）
    expect(fake.calls()).toBe(3);
  });

  it("🔴 写路径不重试：createRun 的 insert 瞬时失败只调用 1 次（重试写会重复写入）", async () => {
    const fake = makeFakeDb(() => ({ ok: false, error: transientError() }));
    holder.db = fake.db;
    const repo = new DbExperimentRunRepository();

    await expect(
      repo.createRun({
        runId: "RUN-Z",
        experimentId: "first-board-pullback/entry-day",
        experimentName: "首板后入场日基础统计",
        experimentVersion: "1.0.0",
        datasetVersionId: 1,
        datasetCode: "first_limit_pullback",
        datasetVersionLabel: "v1",
        parameters: {},
      }),
    ).rejects.toThrow(/Failed query/u);
    expect(fake.calls()).toBe(1);
  });
});
