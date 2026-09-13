/**
 * 探针：**单独**验证 regime 执行器本体正确性（不经过编排器的前驱约束）。
 *
 * 为什么需要单独验：`regime` 的 canonical 前驱是 `overfitting`，而 optimization→overfitting
 * 尚未装配 ⇒ 在 14 阶段全链里 regime 必然 `CL_UPSTREAM_BLOCKED` / `CL_STAGE_INPUT_MISSING`
 * （见 `_probe_realdata_e2e.json` 与 `_probe_regime_subset.json`）。
 * 这**不代表 regime 执行器写错了** —— 本探针直接把它的三步拆开真跑一次：
 *   ① buildRegimeDayFactsSeries(dataset)   ② runMarketRegimeAnalysis(...)   ③ projectRegimeRef(run)
 *
 * 判据：series 非空、tags 数 = 交易日数、compositeSummary 加总 = assessedDayCount、
 *       coverage 两侧相加 = 总天数。
 *
 * 重跑：项目根目录 `npx tsx docs/evidence/_probe_regime_executor.mts`
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { buildResearchDataset } from "../../server/researchDataset";
import {
  buildRegimeDayFactsSeries,
  projectRegimeRef,
} from "../../server/research/closedLoopWiring/executors";
import { runMarketRegimeAnalysis } from "../../server/research/marketRegime/run";
import { REGIME_DIMENSION_IDS } from "../../server/research/marketRegime/types";

const OUT = "docs/evidence/_probe_regime_executor.json";
const report: Record<string, unknown> = {};

const dataset = await buildResearchDataset(
  { name: "probe-regime-executor", startDate: "2025-06-03", endDate: "2025-06-30", asOfPerTradeDate: true },
  { dataReady: true, maxTradingDays: 8, maxSecuritiesPerDay: 300 },
);

report.dataset = {
  datasetVersion: dataset.datasetVersion,
  gate: dataset.gate,
  rowCount: dataset.rows.length,
};

const series = buildRegimeDayFactsSeries(dataset);
report.seriesDayCount = series.length;
report.seriesDates = series.map(d => d.tradeDate);
report.firstDayFacts = series[0]
  ? {
      tradeDate: series[0].tradeDate,
      asOf: series[0].asOf,
      sampleSize: series[0].sampleSize,
      advancingCount: series[0].advancingCount,
      decliningCount: series[0].decliningCount,
      limitUpCount: series[0].limitUpCount,
      limitClassifiableCount: series[0].limitClassifiableCount,
      totalAmount: series[0].totalAmount,
      meanTurnoverRate: series[0].meanTurnoverRate,
      indexCloses: series[0].indexCloses,
      sentiment: series[0].sentiment,
    }
  : null;

const run = runMarketRegimeAnalysis({
  regimeRunId: "REGIME-PROBE-0001",
  series,
  datasetVersion: dataset.datasetVersion,
  createdAt: "2026-09-13T00:00:00.000Z",
});

report.run = {
  regimeRunId: run.regimeRunId,
  datasetVersion: run.datasetVersion,
  coverage: run.coverage,
  tagCount: run.tags.length,
  unassessedStats: run.unassessedStats,
  fingerprint: run.fingerprint,
  benchmarkIndexCode: run.benchmarkIndexCode,
};

const ref = projectRegimeRef(run);
report.regimeRef = ref;

// -- 断言 --
const checks: { name: string; ok: boolean; detail: string }[] = [];
checks.push({ name: "series 非空", ok: series.length > 0, detail: `days=${series.length}` });
checks.push({ name: "tags 数 = 交易日数", ok: run.tags.length === series.length, detail: `${run.tags.length} vs ${series.length}` });
checks.push({
  name: "coverage 相加 = 总天数",
  ok: ref.coverage.assessedDayCount + ref.coverage.unassessedDayCount === run.tags.length,
  detail: `${ref.coverage.assessedDayCount}+${ref.coverage.unassessedDayCount}=${run.tags.length}`,
});
const summarySum = ref.compositeSummary.reduce((s, r) => s + r.dayCount, 0);
checks.push({
  name: "compositeSummary 加总 = assessedDayCount",
  ok: summarySum === ref.coverage.assessedDayCount,
  detail: `${summarySum} vs ${ref.coverage.assessedDayCount}`,
});
checks.push({
  name: "compositeSummary 键升序",
  ok: ref.compositeSummary.every((r, i) => i === 0 || ref.compositeSummary[i - 1]!.compositeKey < r.compositeKey),
  detail: `${ref.compositeSummary.length} keys`,
});
checks.push({
  name: `unassessedStats 七维齐全（${REGIME_DIMENSION_IDS.length}）`,
  ok: Object.keys(run.unassessedStats.byDimension).length === REGIME_DIMENSION_IDS.length,
  detail: Object.entries(run.unassessedStats.byDimension).map(([k, v]) => `${k}=${v}`).join(" "),
});
checks.push({ name: "coverage 区间与 series 一致", ok: run.coverage.startDate === series[0]?.tradeDate && run.coverage.endDate === series[series.length - 1]?.tradeDate, detail: `${run.coverage.startDate}~${run.coverage.endDate}` });

report.checks = checks;
for (const c of checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name} — ${c.detail}`);
console.log(`  compositeSummary 样例 = ${JSON.stringify(ref.compositeSummary.slice(0, 3))}`);
console.log(`  unassessed 按维 = ${JSON.stringify(run.unassessedStats.byDimension)}`);
console.log(`  失败数 = ${checks.filter(c => !c.ok).length}`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
console.log(`报告 → ${OUT}`);
process.exit(checks.some(c => !c.ok) ? 1 : 0);
