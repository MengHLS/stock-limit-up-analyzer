import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../../../server/data";
import type { ResearchDatasetRow } from "../../../../server/researchDataset/types";
import type { ResearchDatasetCursor } from "../../../../server/research/framework/datasetCursor";
import type { CandidateEvaluationRun } from "../../../../server/research/signalEngine";
import {
  EXECUTION_OVERLAY_HORIZON_TRADING_DAYS,
  loadPositionExecutionOverlay,
  mergeExecutionOverlayRows,
} from "../../../../server/research/simulator/cursorEngine";

/** 40 个合成交易日（覆盖 +30 交易日边界）。 */
const DATES = Array.from({ length: 40 }, (_, i) => `2024-02-${String(i + 1).padStart(2, "0")}`);

const PANEL_ID = "sec_x::event:603099.SH@2024-02-01";

function rowOf(tradeDate: string, close: number): ResearchDatasetRow {
  return {
    tradeDate,
    asOf: tradeDate,
    securityId: PANEL_ID,
    code: "603099.SH",
    open: close,
    high: close,
    low: close,
    close,
    preClose: close,
    volume: 100,
    amount: 1_000,
    knowledge: { price: "KNOWN", liquidity: "UNKNOWN" },
  } as unknown as ResearchDatasetRow;
}

function cursorOf(): ResearchDatasetCursor {
  return {
    metadata: { startDate: DATES[0]!, endDate: DATES[DATES.length - 1]!, datasetVersion: "v-test" },
    tradingDates: DATES,
  } as unknown as ResearchDatasetCursor;
}

/** 事件窗只到 DATES[3]（模拟 rd 上限用尽），intent 在 DATES[3]。 */
function runOf(): CandidateEvaluationRun {
  return {
    days: [{ date: DATES[3]!, positionIntents: [{ securityId: PANEL_ID }] }],
  } as unknown as CandidateEvaluationRun;
}

function barReader(bars: readonly CanonicalMarketBar[]) {
  const calls: { ids: readonly string[]; from: string; to: string }[] = [];
  return {
    calls,
    reader: {
      barsForSecuritiesDateRange: async (ids: readonly string[], from: string, to: string) => {
        calls.push({ ids, from, to });
        return bars.filter((b) => b.timestamp >= from && b.timestamp <= to);
      },
    },
  };
}

function allBars(): CanonicalMarketBar[] {
  return DATES.map((d, i) => ({
    symbol: "603099.SH",
    timestamp: d,
    open: 10 + i,
    high: 10 + i,
    low: 10 + i,
    close: 10 + i,
    preClose: 10 + i,
    volume: 100,
    amount: 1_000,
    adjustment: "raw",
  })) as unknown as CanonicalMarketBar[];
}

describe("executionOverlayRetention — Execution Overlay（FIX-003 方案 A）", () => {
  it("Test B：exit 落在事件窗之外时，overlay 仍能提供 entry → exit 的行情", async () => {
    // 事件窗只有前 4 天；TIME_EXIT 20 的退出日远在窗之外。
    const retained = DATES.slice(0, 4).map((d, i) => rowOf(d, 10 + i));
    const harness = barReader(allBars());
    const overlay = await loadPositionExecutionOverlay(cursorOf(), runOf(), retained, harness.reader);

    expect(overlay.stats.identityCount).toBe(1);
    expect(overlay.stats.skippedReason).toBeNull();
    const dates = overlay.rows.map((r) => r.tradeDate);
    // +30 个交易日边界：首个 intent 日 DATES[3] → DATES[3+30]
    expect(dates).toContain(DATES[3 + EXECUTION_OVERLAY_HORIZON_TRADING_DAYS]!);
    // 事件窗之外的持有/退出日行情确实拿到了
    const merged = mergeExecutionOverlayRows(retained, overlay.rows);
    const keys = new Set(merged.map((r) => r.tradeDate + "|" + r.securityId));
    expect(keys.has(DATES[20] + "|" + PANEL_ID)).toBe(true);
    // 只查一次切片，且查询下推了日期范围（DB-side filtering）
    expect(harness.calls.length).toBeGreaterThan(0);
    expect(harness.calls[0]!.ids).toContain("603099.SH");
  });

  it("Test B（合并规则）：事件窗行优先，overlay 只补缺失键，且不重复", async () => {
    const retained = DATES.slice(0, 4).map((d, i) => rowOf(d, 10 + i));
    const harness = barReader(allBars());
    const overlay = await loadPositionExecutionOverlay(cursorOf(), runOf(), retained, harness.reader);
    const merged = mergeExecutionOverlayRows(retained, overlay.rows);

    // 键唯一
    const keys = merged.map((r) => r.tradeDate + "|" + r.securityId);
    expect(new Set(keys).size).toBe(keys.length);
    // 事件窗已有的日期保留事件窗行（close = 10+i，而不是 overlay 的 10+i_datesIndex）
    const day0 = merged.find((r) => r.tradeDate === DATES[0]!)!;
    expect(day0.close).toBe(10);
    // overlay 补了事件窗缺失的日期
    expect(merged.some((r) => r.tradeDate === DATES[10]!)).toBe(true);
  });

  it("Test C（不伪造）：真实日线缺失时 overlay 不造行 ⇒ SUSPENDED 语义保持正确", async () => {
    const retained = DATES.slice(0, 4).map((d, i) => rowOf(d, 10 + i));
    const harness = barReader([]); // 库里确实没有行情
    const overlay = await loadPositionExecutionOverlay(cursorOf(), runOf(), retained, harness.reader);
    expect(overlay.rows).toEqual([]);
    const merged = mergeExecutionOverlayRows(retained, overlay.rows);
    expect(merged.length).toBe(retained.length);
    expect(merged.some((r) => r.tradeDate === DATES[10]!)).toBe(false);
  });

  it("没有 positionIntent 时不做任何 overlay（身份集合只来自实际执行意图）", async () => {
    const retained = DATES.slice(0, 4).map((d, i) => rowOf(d, 10 + i));
    const harness = barReader(allBars());
    const emptyRun = { days: [] } as unknown as CandidateEvaluationRun;
    const overlay = await loadPositionExecutionOverlay(cursorOf(), emptyRun, retained, harness.reader);
    expect(overlay.rows).toEqual([]);
    expect(overlay.stats.skippedReason).toBe("NO_POSITION_INTENT");
    expect(harness.calls.length).toBe(0);
  });
});
