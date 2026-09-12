import { describe, expect, it } from "vitest";
import type { LeaderCandidateBacktestRow } from "./leaderCandidates";
import {
  DEFAULT_LEADER_CANDIDATE_HISTORY_PAGE_SIZE,
  MAX_LEADER_CANDIDATE_HISTORY_PAGE_SIZE,
  filterLeaderCandidateHistoryRows,
  paginateLeaderCandidateHistory,
  stripLeaderCandidateHistory,
} from "./leaderCandidateHistory";
import type { LeaderCandidateBacktestResult } from "./leaderCandidates";

/** 与真实 Dataset 同构的最小行（只填本模块读取的字段）。 */
function row(partial: Partial<LeaderCandidateBacktestRow> & { date: string; stockCode: string }): LeaderCandidateBacktestRow {
  return {
    stockName: `名称${partial.stockCode}`,
    sector: "试验题材",
    boards: 1,
    score: 50,
    circulationValue: "10",
    marketCapScore: 50,
    nextDate: "2026-08-20",
    nextDayDate: "2026-08-19",
    secondDayDate: null,
    success: false,
    signalClosePrice: null,
    nextOpenPrice: null,
    nextClosePrice: null,
    nextOpenPremium: null,
    nextClosePremium: null,
    secondDayOpenPrice: null,
    secondDayClosePrice: null,
    secondDayOpenPremium: null,
    secondDayClosePremium: null,
    tPlus1CloseToTPlus2CloseReturn: null,
    tPlus1CloseToTPlus2CloseSuccess: null,
    phase: null,
    maxBoards: null,
    ...partial,
  };
}

/** 上游 historicalRows 的既有排序：候选日期倒序 → 评分降序。 */
function orderedRows(count: number): LeaderCandidateBacktestRow[] {
  return Array.from({ length: count }, (_unused, index) =>
    row({
      date: `2026-08-${String(28 - (index % 25)).padStart(2, "0")}`,
      stockCode: `6000${String(index).padStart(2, "0")}.SH`,
      score: 100 - index,
      success: index % 3 === 0,
      phase: index % 2 === 0 ? "上升发酵" : "高位分歧",
    }),
  );
}

describe("龙头候选明细分页", () => {
  it("默认分页只回传一页，聚合计数反映全量", () => {
    const rows = orderedRows(1234);
    const page = paginateLeaderCandidateHistory(rows);
    expect(page.rows).toHaveLength(DEFAULT_LEADER_CANDIDATE_HISTORY_PAGE_SIZE);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(DEFAULT_LEADER_CANDIDATE_HISTORY_PAGE_SIZE);
    expect(page.totalRows).toBe(1234);
    expect(page.allRows).toBe(1234);
    expect(page.totalPages).toBe(Math.ceil(1234 / DEFAULT_LEADER_CANDIDATE_HISTORY_PAGE_SIZE));
    expect(page.hasPreviousPage).toBe(false);
    expect(page.hasNextPage).toBe(true);
    expect(page.truncated).toBe(true);
  });

  it("保持上游顺序切片：分页结果顺序与全量列表逐行一致", () => {
    const rows = orderedRows(500);
    const collected: LeaderCandidateBacktestRow[] = [];
    for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
      collected.push(...paginateLeaderCandidateHistory(rows, { page: pageNumber, pageSize: 100 }).rows);
    }
    expect(collected).toHaveLength(500);
    expect(collected.map((item) => item.stockCode)).toEqual(rows.map((item) => item.stockCode));
  });

  it("分页切片与全量列表零重复零遗漏（任意页长）", () => {
    const rows = orderedRows(97);
    const seen = new Set<string>();
    const pages = paginateLeaderCandidateHistory(rows, { pageSize: 10 }).totalPages;
    expect(pages).toBe(10);
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      for (const item of paginateLeaderCandidateHistory(rows, { page: pageNumber, pageSize: 10 }).rows) {
        const key = `${item.date}-${item.stockCode}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(97);
  });

  it("pageSize 非法值回落、超上限截断", () => {
    const rows = orderedRows(1000);
    expect(paginateLeaderCandidateHistory(rows, { pageSize: 0 }).pageSize).toBe(DEFAULT_LEADER_CANDIDATE_HISTORY_PAGE_SIZE);
    expect(paginateLeaderCandidateHistory(rows, { pageSize: -5 }).pageSize).toBe(DEFAULT_LEADER_CANDIDATE_HISTORY_PAGE_SIZE);
    expect(paginateLeaderCandidateHistory(rows, { pageSize: Number.NaN }).pageSize).toBe(DEFAULT_LEADER_CANDIDATE_HISTORY_PAGE_SIZE);
    expect(paginateLeaderCandidateHistory(rows, { pageSize: 9999 }).pageSize).toBe(MAX_LEADER_CANDIDATE_HISTORY_PAGE_SIZE);
    expect(paginateLeaderCandidateHistory(rows, { pageSize: 9999 }).rows.length).toBeLessThanOrEqual(MAX_LEADER_CANDIDATE_HISTORY_PAGE_SIZE);
  });

  it("页码越界夹取到最后一页（数据收缩时不出现空白页）", () => {
    const rows = orderedRows(120);
    const page = paginateLeaderCandidateHistory(rows, { page: 99, pageSize: 50 });
    expect(page.totalPages).toBe(3);
    expect(page.page).toBe(3);
    expect(page.rows).toHaveLength(20);
    expect(page.hasNextPage).toBe(false);
  });

  it("页码非法值回落为 1", () => {
    const rows = orderedRows(10);
    expect(paginateLeaderCandidateHistory(rows, { page: 0 }).page).toBe(1);
    expect(paginateLeaderCandidateHistory(rows, { page: -3 }).page).toBe(1);
    expect(paginateLeaderCandidateHistory(rows, { page: 2.7 }).page).toBe(1);
  });

  it("空结果不产生 NaN，且 totalPages 至少为 1", () => {
    const page = paginateLeaderCandidateHistory([]);
    expect(page.rows).toEqual([]);
    expect(page.totalRows).toBe(0);
    expect(page.totalPages).toBe(1);
    expect(page.truncated).toBe(false);
    expect(page.hasNextPage).toBe(false);
  });

  it("phase 过滤发生在分页之前（totalRows 反映筛选后全量）", () => {
    const rows = orderedRows(40);
    const page = paginateLeaderCandidateHistory(rows, { phase: "上升发酵", pageSize: 5 });
    expect(page.totalRows).toBe(20);
    expect(page.allRows).toBe(40);
    expect(page.totalPages).toBe(4);
    expect(page.rows.every((item) => item.phase === "上升发酵")).toBe(true);
    expect(page.rows).toHaveLength(5);
  });

  it("onlySuccess 过滤生效，且不修改入参顺序", () => {
    const rows = orderedRows(30);
    const filtered = paginateLeaderCandidateHistory(rows, { onlySuccess: true, pageSize: 10 });
    expect(filtered.totalRows).toBe(rows.filter((item) => item.success).length);
    expect(filtered.rows.every((item) => item.success)).toBe(true);
    expect(filtered.rows).toHaveLength(10);
    expect(rows[0].stockCode).toBe("600000.SH");
    expect(rows.map((item) => item.score)).toEqual(Array.from({ length: 30 }, (_unused, index) => 100 - index));
  });

  it("无过滤参数时返回原数组引用（零拷贝快路径）", () => {
    const rows = orderedRows(3);
    expect(filterLeaderCandidateHistoryRows(rows)).toBe(rows);
  });

  it("phase=null / onlySuccess=null 视为不过滤（前端清空筛选）", () => {
    const rows = orderedRows(12);
    const page = paginateLeaderCandidateHistory(rows, { phase: null, onlySuccess: null });
    expect(page.totalRows).toBe(12);
  });

  it("剥离明细后聚合字段保留，仅暴露行数", () => {
    const result = {
      historicalRows: orderedRows(4321),
      totalSamples: 4321,
      successCount: 100,
      observationDays: 1,
    } as unknown as LeaderCandidateBacktestResult;
    const summary = stripLeaderCandidateHistory(result);
    expect(summary.historicalRowCount).toBe(4321);
    expect(summary.totalSamples).toBe(4321);
    expect(summary.successCount).toBe(100);
    expect(summary.observationDays).toBe(1);
    expect("historicalRows" in summary).toBe(false);
  });
});
