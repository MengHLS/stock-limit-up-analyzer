/** PAPER-TRADING-PERSISTENCE-FIX-001 —— 扩展载荷原样读取单测（纯函数，无 DB）。 */
import { describe, expect, it } from "vitest";
import { parseRawArchivedPayload } from "../../../server/closedLoopBacktestRun/rawPayload";

describe("parseRawArchivedPayload", () => {
  it("扩展载荷（paperTradingState / evaluationDetail）原样保留，不经任何 schema 解释", () => {
    const json = JSON.stringify({
      runId: "paper-3570001-2025-01-01-2026-09-04",
      overall: { status: "ALL_EXECUTED" },
      paperTradingState: {
        account: { equity: 199036.53, cash: 5381.53, marketValue: 193655 },
        openPositions: [1, 2, 3, 4, 5],
        lastRunAt: "2026-10-03T00:00:00.000Z",
      },
      evaluationDetail: { promoted: { full: { totalReturnPct: 129.686 } } },
    });
    const parsed = parseRawArchivedPayload(json);
    expect(parsed).not.toBeNull();
    expect((parsed!.paperTradingState as any).account.equity).toBe(199036.53);
    expect((parsed!.paperTradingState as any).openPositions).toHaveLength(5);
    expect((parsed!.evaluationDetail as any).promoted.full.totalReturnPct).toBe(129.686);
  });

  it("旧版闭环载荷兼容：原样返回（不做 reconcile）", () => {
    const legacy = { runId: "clrun-x", overall: { status: "ALL_EXECUTED" }, stages: [], wiring: {} };
    expect(parseRawArchivedPayload(JSON.stringify(legacy))).toEqual(legacy);
  });

  it("空载荷 ⇒ null（不伪造、不抛错）", () => {
    expect(parseRawArchivedPayload(null)).toBeNull();
    expect(parseRawArchivedPayload(undefined)).toBeNull();
    expect(parseRawArchivedPayload("")).toBeNull();
  });

  it("非对象载荷 ⇒ null（数组 / 原始值）", () => {
    expect(parseRawArchivedPayload("[1,2,3]")).toBeNull();
    expect(parseRawArchivedPayload("42")).toBeNull();
    expect(parseRawArchivedPayload("\"x\"")).toBeNull();
    expect(parseRawArchivedPayload("null")).toBeNull();
  });
});
