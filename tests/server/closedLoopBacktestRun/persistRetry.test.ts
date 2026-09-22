/**
 * BD-24 — 闭环留档「长算后被链路掐连接」的重试语义（**注入式可证伪**）。
 *
 * ## 为什么有这条测试
 *
 * 用户报障「跑完 `first-board-pullback`，在『回测历史』里看不到」。复现证据
 * （`docs/evidence/_probe_fbp_looprun_repro2.out.json`）显示：9.81 分钟的长算结束后，
 * 留档 INSERT 连续 **3 次** 全部 `read ECONNRESET`（errno −4077），被 best-effort 吞掉
 * ⇒ 页面有结果、库里没这条。
 *
 * 要害在于 **3 次是不够的**：每次连接级失败只消耗**一条**死连接（mysql2
 * `pool_connection.js` 在 error 时把连接移出池），而该次运行结束池里**至少 4 条**已死
 * （3 次 INSERT + 紧随其后的列表 SELECT 全挂）。
 *
 * ## 判据（可证伪）
 *
 *   - **C1**：真实失败形态（前 3 次 ECONNRESET、第 4 次成功）+ **生产默认参数** ⇒ 必须留档成功。
 *     ⚠️ 这条的意义在于：把 `CLOSED_LOOP_PERSIST_ATTEMPTS` 改回 3 ⇒ **本用例变红**。
 *   - **C2**：非瞬时错误（SQL / 表结构类）⇒ **只尝试一次**、立即放弃（不白等 N × 19.6s）。
 *   - **C3**：全瞬时失败 ⇒ **不抛**（best-effort 不变式：绝不能把「列表少一条」升级成「回测结果丢失」），
 *     且尝试次数用尽后**响亮告警**（含 runId + 「历史列表将缺此条」）。
 *   - **C4**：首次即成功 ⇒ 零重试、零告警。
 *   - **C5**：瞬时判定必须**穿透 Drizzle 的 cause 包装**（只看最外层 message 会漏判）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  persistClosedLoopBacktestRun,
  type ClosedLoopPersistDeps,
} from "../../../server/researchRunRouter";
import type { ClosedLoopRunResult } from "../../../shared/researchContracts";

const RUN_ID = "clrun-20260921112519626";

/** 本单测只关心**重试编排**，故结果体只给 `runId`（摘要构建另有 `summary.test.ts`）。 */
const RESULT = { runId: RUN_ID } as unknown as ClosedLoopRunResult;

const OPTIONS = {
  experimentId: "EXP-20260921-081838C9",
  strategyId: "first-board-pullback",
  strategyVersion: "1.0.0",
  startDate: "2025-01-02",
  endDate: "2025-03-31",
  result: RESULT,
};

/** Drizzle 把真实原因包在 `cause` 里，**逐字照抄**生产上的形态。 */
function drizzleConnectionReset(): Error {
  const inner = new Error("read ECONNRESET") as Error & { code?: string; errno?: number };
  inner.code = "ECONNRESET";
  inner.errno = -4077;
  const outer = new Error(
    "Failed query: insert into `closed_loop_backtest_run` (`id`, `runId`, …) values (default, ?, …)",
  );
  outer.name = "DrizzleQueryError";
  (outer as { cause?: unknown }).cause = inner;
  return outer;
}

/** 语义错误：报错里没有任何瞬时特征码 ⇒ 不该重试。 */
function semanticError(): Error {
  const inner = new Error("Unknown column 'nope' in 'field list'") as Error & { code?: string };
  inner.code = "ER_BAD_FIELD_ERROR";
  const outer = new Error("Failed query: insert into `closed_loop_backtest_run` …");
  outer.name = "DrizzleQueryError";
  (outer as { cause?: unknown }).cause = inner;
  return outer;
}

/** 按给定序列返回结果/异常的假写入器，并记录调用次数。 */
function scriptedSave(outcomes: Array<"ok" | Error>) {
  const calls: unknown[] = [];
  const save = async (input: unknown): Promise<number> => {
    calls.push(input);
    const outcome = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
    if (outcome instanceof Error) throw outcome;
    return 42;
  };
  return { save: save as NonNullable<ClosedLoopPersistDeps["save"]>, calls };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("BD-24 · 闭环留档重试（长算后连接被掐）", () => {
  it("C1 · 前 3 次 ECONNRESET、第 4 次成功 ⇒ **生产默认参数下**必须留档成功", async () => {
    const { save, calls } = scriptedSave([
      drizzleConnectionReset(),
      drizzleConnectionReset(),
      drizzleConnectionReset(),
      "ok",
    ]);

    await expect(
      persistClosedLoopBacktestRun(OPTIONS, { save, retryDelayMs: 0 }),
    ).resolves.toEqual({ persisted: true, errorCode: null, errorMessage: null });

    expect(calls).toHaveLength(4);
    // 3 次失败各一条重试告警 + 最终成功一条 ⇒ 共 4 条（每一次都可见，不静默）
    expect(warnSpy).toHaveBeenCalledTimes(4);
    expect(String(warnSpy.mock.calls.at(-1)?.[0])).toContain("第 4 次尝试成功");
  });

  it("C2 · 非瞬时错误 ⇒ 只尝试一次、立即放弃（不重试、不抛）", async () => {
    const { save, calls } = scriptedSave([semanticError(), "ok"]);

    await expect(
      persistClosedLoopBacktestRun(OPTIONS, { save, retryDelayMs: 0 }),
    ).resolves.toMatchObject({ persisted: false, errorCode: "CLOSED_LOOP_PERSIST_FAILED" });

    expect(calls).toHaveLength(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("非瞬时错误，不重试");
  });

  it("C3 · 全瞬时失败 ⇒ 不抛（best-effort 不变式）+ 用尽尝试 + 响亮告警", async () => {
    const { save, calls } = scriptedSave([drizzleConnectionReset()]);

    await expect(
      persistClosedLoopBacktestRun(OPTIONS, { save, attempts: 3, retryDelayMs: 0 }),
    ).resolves.toMatchObject({ persisted: false, errorCode: "CLOSED_LOOP_PERSIST_FAILED" });

    expect(calls).toHaveLength(3);
    const terminal = String(warnSpy.mock.calls.at(-1)?.[0]);
    expect(terminal).toContain("历史列表将缺此条");
    expect(terminal).toContain(RUN_ID);
  });

  it("C4 · 首次即成功 ⇒ 零重试、零告警", async () => {
    const { save, calls } = scriptedSave(["ok"]);

    await persistClosedLoopBacktestRun(OPTIONS, { save, retryDelayMs: 0 });

    expect(calls).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("C5 · 瞬时判定穿透 Drizzle 的 cause 包装（最外层 message 无 ECONNRESET 字样也要认）", async () => {
    const { save, calls } = scriptedSave([drizzleConnectionReset(), "ok"]);
    expect(drizzleConnectionReset().message).not.toContain("ECONNRESET");

    await persistClosedLoopBacktestRun(OPTIONS, { save, retryDelayMs: 0 });

    expect(calls).toHaveLength(2);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("连接级瞬时错误");
  });
});
