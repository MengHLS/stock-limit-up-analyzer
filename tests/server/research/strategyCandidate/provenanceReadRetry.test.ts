/**
 * STRATEGY-RESEARCH-BRIDGE-001 §16 回归 —— **Strategy 溯源仓储的只读重试语义**。
 *
 * ## 为什么值得单独钉（这不是「顺手加个 retry」）
 *
 * 前端实测：Strategies 详情页「版本与状态」标签里的**研究证据区块**出现过一次
 * 「溯源卡片在、证据不在」——`docs/evidence/_probe_srb001_strategy_detail_frontend.out.json`
 * 的一次中间态 `panelState = { evidenceBlock: false }`。
 *
 * 根因与 004 的 Run 读路径缺陷**同类**：`DbStrategyResearchProvenanceRepository` 的三个**读**方法
 * （`getByStrategyVersionId` / `listByStrategyId` / `getBySourceCandidateId`）**没有继承全站既有的
 * `withReadRetry` 兜底约定**。而这条读路径的前端 query 是 `retry: false`（溯源是「可缺、不阻断」
 * 的附加信息，故意不自动重试）⇒ 服务端**单次**冷启动 / 死连接失败会原样透到页面，
 * 用户看到「溯源读取失败」并**看不到研究证据** —— §16「证据必须可见」就落空了。
 *
 * 本文件把它钉成**行为断言**（不是 grep 源码）：
 *   - 读：第一次抛瞬时错误、第二次成功 ⇒ 调用 **2** 次且结果正确；
 *   - 语义错误（表不存在）⇒ 只调用 **1** 次并原样抛出（证明**不是无脑重试**）；
 *   - 写（`deleteByStrategyVersionId`）⇒ 瞬时错误**不重试**，只调用 **1** 次
 *     （重试写可能造成重复删除 / 重复写入）。
 *
 * 假 db 的形状与 004 的 `runRepositoryRetry.test.ts` **同一套范式**（select 链自返回且是 thenable，
 * 另有 `delete` 链）—— 本文件断言的是重试次数与结果，不是 SQL 文本（SQL 由真库 E2E 覆盖）。
 */

import { describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ db: null as unknown }));

// 本文件位于 `tests/server/research/strategyCandidate/` —— 比 004 的
// `tests/server/researchExperiments/` **深一级** ⇒ 相对路径是 **4** 级 `../`（不是 3 级）。
vi.mock("../../../../server/db", () => ({
  getDb: async () => holder.db,
}));

const { DbStrategyResearchProvenanceRepository } = await import(
  "../../../../server/research/strategyCandidate/provenance"
);

/** Drizzle 形状的瞬时错误：真实原因在 `cause` 链上（只看最外层 message 会漏判）。 */
function transientError(): Error {
  const cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  const error = new Error("Failed query: select `id` from `strategy_research_provenance`");
  error.name = "DrizzleQueryError";
  (error as { cause?: unknown }).cause = cause;
  return error;
}

/** 语义错误：表不存在 —— 重试没有意义，必须原样抛出。 */
function semanticError(): Error {
  const cause = Object.assign(new Error("Table 'strategy_research_provenance' doesn't exist"), {
    code: "ER_NO_SUCH_TABLE",
    errno: 1146,
  });
  const error = new Error("Failed query: select `id` from `strategy_research_provenance`");
  error.name = "DrizzleQueryError";
  (error as { cause?: unknown }).cause = cause;
  return error;
}

type Outcome = { ok: true; rows: unknown[] } | { ok: false; error: Error };
type Kind = "select" | "delete";

interface FakeDb {
  db: Record<string, unknown>;
  calls: () => number;
}

/** 假 db：`handler(callIndex, kind)` 决定第 n 次调用成功还是失败。 */
function makeFakeDb(handler: (callIndex: number, kind: Kind) => Outcome): FakeDb {
  let calls = 0;
  const makeChain = (kind: Kind): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    const passthrough = (): unknown => chain;
    chain.from = passthrough;
    chain.where = passthrough;
    chain.orderBy = passthrough;
    chain.limit = passthrough;
    chain.then = (
      onFulfilled: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => {
      const outcome = handler(calls, kind);
      calls += 1;
      return outcome.ok
        ? Promise.resolve(outcome.rows).then(onFulfilled, onRejected)
        : Promise.reject(outcome.error).then(onFulfilled, onRejected);
    };
    return chain;
  };
  const db: Record<string, unknown> = {
    select: () => makeChain("select"),
    delete: () => makeChain("delete"),
  };
  return { db, calls: () => calls };
}

describe("SRB001 §16 · 溯源仓储的只读重试（冷连接瞬时失败不得让证据区块消失）", () => {
  it("getByStrategyVersionId：首次瞬时失败 → 重试一次后成功（调用 2 次，返回 undefined 而不是抛错）", async () => {
    const fake = makeFakeDb((index) => (index === 0 ? { ok: false, error: transientError() } : { ok: true, rows: [] }));
    holder.db = fake.db;
    const repo = new DbStrategyResearchProvenanceRepository();

    await expect(repo.getByStrategyVersionId(1110001)).resolves.toBeUndefined();
    expect(fake.calls()).toBe(2);
  });

  it("listByStrategyId：首次瞬时失败 → 重试后返回（调用 2 次，返回空数组）", async () => {
    const fake = makeFakeDb((index) => (index === 0 ? { ok: false, error: transientError() } : { ok: true, rows: [] }));
    holder.db = fake.db;
    const repo = new DbStrategyResearchProvenanceRepository();

    await expect(repo.listByStrategyId("first-board-pullback")).resolves.toEqual([]);
    expect(fake.calls()).toBe(2);
  });

  it("getBySourceCandidateId：首次瞬时失败 → 重试后返回（调用 2 次）", async () => {
    const fake = makeFakeDb((index) => (index === 0 ? { ok: false, error: transientError() } : { ok: true, rows: [] }));
    holder.db = fake.db;
    const repo = new DbStrategyResearchProvenanceRepository();

    await expect(repo.getBySourceCandidateId(630001)).resolves.toBeUndefined();
    expect(fake.calls()).toBe(2);
  });

  it("语义错误（ER_NO_SUCH_TABLE）**不重试**：只调用 1 次并原样抛出", async () => {
    const fake = makeFakeDb(() => ({ ok: false, error: semanticError() }));
    holder.db = fake.db;
    const repo = new DbStrategyResearchProvenanceRepository();

    await expect(repo.getByStrategyVersionId(1110001)).rejects.toThrow(/Failed query/u);
    expect(fake.calls()).toBe(1);
  });

  it("写路径（deleteByStrategyVersionId）瞬时错误**不重试**：只调用 1 次", async () => {
    const fake = makeFakeDb(() => ({ ok: false, error: transientError() }));
    holder.db = fake.db;
    const repo = new DbStrategyResearchProvenanceRepository();

    await expect(repo.deleteByStrategyVersionId(1110001)).rejects.toThrow(/Failed query/u);
    expect(fake.calls()).toBe(1);
  });

  it("夹具自检：`withReadRetry` 真的挂在读路径上（否则前四条会被别的原因弄绿）", async () => {
    // 连续两次瞬时失败 ⇒ 读路径应当把两次都吃掉再成功（调用 3 次），
    // 这只有在「读路径确实走了重试」时才成立。
    const fake = makeFakeDb((index) =>
      index < 2 ? { ok: false, error: transientError() } : { ok: true, rows: [] },
    );
    holder.db = fake.db;
    const repo = new DbStrategyResearchProvenanceRepository();

    await expect(repo.getByStrategyVersionId(1110001)).resolves.toBeUndefined();
    expect(fake.calls()).toBe(3);
  });
});
