import "dotenv/config";

async function main() {
  const { loadBacktestBaseContext } = await import("./server/db");
  const { runLeaderCandidateStrategyBacktest, runLeaderCandidateResearchReport } = await import("./server/leaderCandidateStrategyBacktest");

  const range = { startDate: "2024-09-09", endDate: "2026-09-09" };

  const t0 = Date.now();
  const base = await loadBacktestBaseContext(range);
  const t1 = Date.now();
  console.log(`[1] DB load (loadBacktestBaseContext): ${t1 - t0}ms | records=${base.records.length} rawRows=${base.rawRows.length} tradingDates=${(base.context.tradingDates ?? []).length}`);

  const t2 = Date.now();
  const core = runLeaderCandidateStrategyBacktest(base.records, base.rawRows, base.context, {});
  const t3 = Date.now();
  console.log(`[2] production core (no research): ${t3 - t2}ms | trades=${core.realisticSimulation.trades.length}`);

  const t4 = Date.now();
  const full = runLeaderCandidateResearchReport(base.records, base.rawRows, base.context, {});
  const t5 = Date.now();
  console.log(`[3] full research report: ${t5 - t4}ms`);
  console.log(`    research-only delta: ${t5 - t4 - (t3 - t2)}ms`);
  console.log(`    TOTAL (DB + research): ${t5 - t0}ms`);
  console.log(`    fullCycle experiments=${full.downsideRiskResearch?.fullCycle.experiments.length} rollingWindows=${full.downsideRiskResearch?.rollingWindows.length} factorAblations=${full.downsideRiskResearch?.factorAblations.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
