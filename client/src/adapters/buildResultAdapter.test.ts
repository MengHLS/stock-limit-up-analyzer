/**
 * buildResultAdapter 单测（任务 §19：INCONCLUSIVE / NO_ROWS_BUILT / Source vs Final rows / Pipeline）。
 *
 * 用后端 `researchDataset.build` 的真实摘要形态构造 mock，验证 adapter 的派生逻辑
 * 严格来自真实事实、不臆造数据。
 */

import { describe, expect, it } from "vitest";
import { buildResultToViewModel } from "./buildResultAdapter";

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    datasetVersion: "rd-1.0.0-1-cffc2a0e66efbf0b",
    universeDefinition: {
      rule: "all listed securities",
      asOfDescription: "asOf = tradeDate",
      days: [
        { tradeDate: "2026-08-31", isTradingDay: true, members: ["s1", "s2"], excludedByReason: {} },
        { tradeDate: "2026-09-01", isTradingDay: true, members: ["s1"], excludedByReason: { DELISTED: 1 } },
      ],
    },
    policySet: [{ policyId: "p1", name: "口径", description: "", value: true, evidence: ["e1"] }],
    dataSnapshot: {
      capturedAt: "2026-09-07T10:00:00.000Z",
      request: { startDate: "2026-08-31", endDate: "2026-09-04", asOfPerTradeDate: true, asOf: null, coreIndexCodes: [] },
      calendarName: "research-dataset-calendar",
      calendarFirstDate: "2026-08-31",
      calendarLastDate: "2026-09-04",
      tradingDays: 5,
      domains: [
        { domain: "A OHLCV", rowsLoaded: 27735, securitiesCovered: 5520, datesCovered: 5, datesExpected: 5, note: "A 域已 FULL（§44.1）" },
        { domain: "B Master", rowsLoaded: 5552, securitiesCovered: 5552, datesCovered: 5, datesExpected: 5, note: "research_securities 全表加载" },
        { domain: "C Status", rowsLoaded: 123, securitiesCovered: 100, datesCovered: 5, datesExpected: 5, note: "未全量时 universe 成员受限（默认拒绝）" },
        { domain: "D CA", rowsLoaded: 88, securitiesCovered: 60, datesCovered: 5, datesExpected: 5, note: "corporate_actions" },
        { domain: "E Liquidity", rowsLoaded: 22000, securitiesCovered: 5000, datesCovered: 5, datesExpected: 5, note: "E 域回填中（§44.2 CODE_READY）" },
        { domain: "F Index", rowsLoaded: 20, securitiesCovered: 4, datesCovered: 5, datesExpected: 5, note: "index_daily" },
        { domain: "G Industry", rowsLoaded: 5212, securitiesCovered: 5212, datesCovered: 5, datesExpected: 5, note: "industry_assignments" },
      ],
      coverageGaps: ["NO_ROWS_BUILT"],
    },
    gate: "INCONCLUSIVE",
    gateNotes: ["覆盖缺口：NO_ROWS_BUILT", "dataReady=false（冒烟口径）；缺口在 dataReady=true 时判 FAIL"],
    rowCount: 0,
    ...overrides,
  };
}

describe("buildResultAdapter · NO_ROWS_BUILT / Source vs Final", () => {
  it("识别 NO_ROWS_BUILT 原因", () => {
    const vm = buildResultToViewModel(makeSummary());
    expect(vm.reason).toBe("NO_ROWS_BUILT");
    expect(vm.hasNoRows).toBe(true);
    expect(vm.rowCount).toBe(0);
  });

  it("严格区分 Source Rows 与 Final Rows", () => {
    const vm = buildResultToViewModel(makeSummary());
    // source rows = 各域加载行数之和（27735+5552+123+88+22000+20+5212）
    expect(vm.sourceRows).toBe(60730);
    expect(vm.rowCount).toBe(0);
    // source 有大量行，但 final 为 0 —— 不误读为「构建成功」
    expect(vm.sourceRows).toBeGreaterThan(0);
    expect(vm.rowCount).toBeLessThan(vm.sourceRows);
  });

  it("派生 dataReadyStatus = FAIL（gateNotes 含 dataReady=false）", () => {
    const vm = buildResultToViewModel(makeSummary());
    expect(vm.dataReadyStatus).toBe("FAIL");
  });

  it("派生 pitStatus = PASS（逐日 PIT）", () => {
    const vm = buildResultToViewModel(makeSummary());
    expect(vm.pitStatus).toBe("PASS");
  });

  it("universeSize 取 Master 证券数", () => {
    const vm = buildResultToViewModel(makeSummary());
    expect(vm.universeSize).toBe(5552);
  });

  it("pipeline 末节点 NO_ROWS_BUILT 为 WARNING", () => {
    const vm = buildResultToViewModel(makeSummary());
    const final = vm.pipeline.find((n) => n.id === "final");
    expect(final).toBeDefined();
    expect(final!.status).toBe("WARNING");
    expect(final!.outputRows).toBe(0);
  });

  it("域状态：E Liquidity 回填中 → WARNING", () => {
    const vm = buildResultToViewModel(makeSummary());
    const e = vm.domains.find((d) => d.domain === "E Liquidity");
    expect(e!.status).toBe("WARNING");
  });

  it("gate=PASS 时 reason 为 null 且 dataReady=PASS", () => {
    const summary = makeSummary({
      gate: "PASS",
      gateNotes: [],
      rowCount: 25000,
      dataSnapshot: {
        ...(makeSummary() as unknown as { dataSnapshot: Record<string, unknown> }).dataSnapshot,
        coverageGaps: [],
      },
    });
    const vm = buildResultToViewModel(summary as never);
    expect(vm.reason).toBeNull();
    expect(vm.dataReadyStatus).toBe("PASS");
    expect(vm.hasNoRows).toBe(false);
  });
});
