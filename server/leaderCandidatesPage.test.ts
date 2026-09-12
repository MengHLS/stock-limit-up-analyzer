import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(resolve(import.meta.dirname, relative), "utf8");

/**
 * 龙头候选池页面性能修复的防回归断言（2026-09-11）。
 * 背景：全样本历史明细曾随回测响应整表回传并在浏览器一次性渲染，导致页面卡死无法渲染。
 * 本测试锁死「明细必须走服务端分页」这一契约，不依赖数据库。
 */
describe("龙头候选池页面（服务端分页修复）", () => {
  it("页面通过分页端点读取历史明细，不再直接消费全量 historicalRows", () => {
    const page = read("../client/src/pages/LeaderCandidates.tsx");
    expect(page).toContain("getLeaderCandidateHistoryPage");
    expect(page).toContain("CandidateHistoryTable");
    expect(page).toContain("keepPreviousData");
    // 防回归：页面不得再自行过滤 / 渲染整份明细。
    expect(page).not.toContain("backtest?.historicalRows");
    expect(page).not.toContain("filteredHistoricalRows");
  });

  it("明细表只渲染服务端返回的当前页，并提供分页控件", () => {
    const table = read("../client/src/components/CandidateHistoryTable.tsx");
    expect(table).toContain("rows.map");
    expect(table).toContain("PaginationBar");
    expect(table).toContain("onPageChange");
    expect(table).toContain("totalRows");
    expect(table).toContain("allRows");
  });

  it("分页控件提供首/上/下/末页与页码夹取", () => {
    const bar = read("../client/src/components/PaginationBar.tsx");
    expect(bar).toContain("buildPageList");
    expect(bar).toContain("第一页");
    expect(bar).toContain("上一页");
    expect(bar).toContain("下一页");
    expect(bar).toContain("最后一页");
    expect(bar).toContain("Math.min(Math.max(1, page), safeTotalPages)");
  });

  it("回测端点剥离明细，分页端点注册在同一 router", () => {
    const routers = read("./routers.ts");
    expect(routers).toContain("stripLeaderCandidateHistory(await getLeaderCandidateBacktest(input))");
    expect(routers).toContain("getLeaderCandidateHistoryPage: publicProcedure");
    expect(routers).toContain("MAX_LEADER_CANDIDATE_HISTORY_PAGE_SIZE");
  });

  it("磁盘快照在数据写入路径上失效（上传后页面不得读到旧结果）", () => {
    const db = read("./db.ts");
    const invalidations = db.match(/invalidateLeaderCandidateBacktestCaches\(\)/g) ?? [];
    // createLimitUpRecord / createLimitUpRecordsBatch / updateLimitUpRecord / deleteLimitUpRecord /
    // 批量改代码 / upsertStockDailyPrices / upsertSuspensionWindows / deleteSuspensionWindow / 定义处
    expect(invalidations.length).toBeGreaterThanOrEqual(8);
    expect(db).toContain("readLeaderCandidateBacktestSnapshot");
    expect(db).toContain("writeLeaderCandidateBacktestSnapshot");
  });
});
