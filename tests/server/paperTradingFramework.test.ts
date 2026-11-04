import { describe, expect, it, vi } from "vitest";
import {
  advancePaperForwardOnce,
  createPaperForwardRunner,
  type PaperForwardAdvanceAdapter,
  type PaperForwardStateCore,
} from "../../server/paperTradingFramework";

interface TestState extends PaperForwardStateCore {
  readonly equity: number;
  readonly processed: readonly string[];
}

function state(overrides: Partial<TestState> = {}): TestState {
  return {
    runId: "paper-test",
    status: "WAITING_FOR_NEW_DATA",
    latestDataDate: "2025-01-01",
    lastProcessedTradingDate: "2025-01-01",
    nextTradingDate: null,
    lastRunAt: "t0",
    lastError: null,
    equity: 100,
    processed: [],
    ...overrides,
  };
}

function adapter(overrides: Partial<PaperForwardAdvanceAdapter<TestState, { date: string }, never, never>> = {}): PaperForwardAdvanceAdapter<TestState, { date: string }, never, never> {
  return {
    resolveTradingCalendar: async () => ({ latestDataDate: "2025-01-03", tradingDates: ["2025-01-02", "2025-01-03"] }),
    markWaiting: ({ previous, latestDataDate, lastRunAt }) => ({ ...previous, latestDataDate, status: "WAITING_FOR_NEW_DATA", lastRunAt }),
    buildIncrement: async ({ fromTradingDate, toTradingDate }) => ({ newDaily: [{ date: fromTradingDate }, { date: toTradingDate }], newHistory: [], carriedPositions: [] }),
    mergeIncrement: ({ previous, increment, latestDataDate, nextTradingDate, lastRunAt }) => ({
      ...previous,
      latestDataDate,
      lastProcessedTradingDate: increment.newDaily.at(-1)!.date,
      nextTradingDate,
      status: "ADVANCED",
      lastRunAt,
      lastError: null,
      equity: previous.equity + 1,
      processed: [...previous.processed, ...increment.newDaily.map((item) => item.date)],
    }),
    markError: ({ previous, lastRunAt, error }) => ({ ...previous, status: "ERROR", lastRunAt, lastError: String(error) }),
    ...overrides,
  };
}

describe("Paper Trading 通用 Forward 框架", () => {
  it("增量：只推进 lastProcessedTradingDate 之后的交易日并保留 checkpoint", async () => {
    const next = await advancePaperForwardOnce(adapter(), state(), () => "t1");
    expect(next.status).toBe("ADVANCED");
    expect(next.processed).toEqual(["2025-01-02", "2025-01-03"]);
    expect(next.lastProcessedTradingDate).toBe("2025-01-03");
    expect(next.equity).toBe(101);
  });

  it("幂等 / no-new-data：没有新日期时不 build、不 merge、不新增记录", async () => {
    const buildIncrement = vi.fn(adapter().buildIncrement);
    const mergeIncrement = vi.fn(adapter().mergeIncrement);
    const next = await advancePaperForwardOnce(adapter({ buildIncrement, mergeIncrement }), state({ lastProcessedTradingDate: "2025-01-03", status: "ADVANCED" }), () => "t2");
    expect(next.status).toBe("WAITING_FOR_NEW_DATA");
    expect(next.processed).toEqual([]);
    expect(buildIncrement).not.toHaveBeenCalled();
    expect(mergeIncrement).not.toHaveBeenCalled();
  });

  it("错误边界：写回 ERROR，不破坏既有 checkpoint", async () => {
    const next = await advancePaperForwardOnce(adapter({ resolveTradingCalendar: async () => { throw new Error("db unavailable"); } }), state({ equity: 123 }), () => "t3");
    expect(next.status).toBe("ERROR");
    expect(next.equity).toBe(123);
    expect(next.lastError).toContain("db unavailable");
  });

  it("服务端口：首次 initialize 后保存；已有 checkpoint 时直接恢复并推进", async () => {
    const save = vi.fn(async () => undefined);
    const advance = vi.fn(async (s: TestState) => ({ ...s, status: "ADVANCED" as const }));
    const initialize = vi.fn(async () => state());
    const runner = createPaperForwardRunner<TestState>({ load: async () => null, initialize, advance, save });
    const first = await runner.runNextAvailableDay();
    expect(first.status).toBe("ADVANCED");
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(first);

    const existing = state({ status: "ADVANCED", lastProcessedTradingDate: "2025-01-02" });
    const resumed = createPaperForwardRunner<TestState>({ load: async () => existing, initialize, advance, save });
    await resumed.runNextAvailableDay();
    expect(advance).toHaveBeenLastCalledWith(existing);
  });
});
