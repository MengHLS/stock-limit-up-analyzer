/**
 * EVENT-STATE-LONG-EXECUTION-PARITY-001 · S5 指标核验（**只读 DB**）。
 *
 * 目的：
 *   1. 从**已留档的 Run**（`closed_loop_backtest_run.resultJson`）取出 `canonicalMetrics` 与
 *      `riskAdjusted`，确认真实运行走的是**权威指标出口**（`metricsSource="canonical"`）；
 *   2. **不另立公式**：用同一份权威实现（`riskAdjustedMetrics/analyze.ts` +
 *      `shared/quant-stats.ts`）从**同一份权益曲线**独立重算，与留档值逐项比对；
 *   3. 输出「旧报告 / 正式新结果 / 差异原因」表的机器可读输入。
 *
 * 用法：`node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongMetrics.mts`
 */
import 'dotenv/config';
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { computeRiskAdjustedMetrics } from '../../server/research/riskAdjustedMetrics/analyze';
import { sharpeRatio } from '../../shared/quant-stats';

interface EquityPoint { readonly date: string; readonly equity: number; readonly cash?: number; readonly marketValue?: number; readonly openPositions?: number }

/** 旧研究报告（诊断锚点，非验收目标）。 */
const OLD_REPORTS = {
  '780004': {
    window: '2019-01-03~2026-01-28',
    totalReturnPct: 53.88,
    maxDrawdownPct: -18.08,
    tradeCount: 4811,
    note: '研究 harness（脚本自算 Sharpe=CAGR/年化波动、CAGR 用 365.25 自然日、Sortino 仅负日分母）',
  },
  '780005': {
    window: '2026-01-29~2026-10-09',
    totalReturnPct: -7.54,
    maxDrawdownPct: -13.33,
    tradeCount: 468,
    note: '后续验证报告；Stage 1 FAIL（S1-P1 绝对收益 > 0 未通过）',
  },
} as const;

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL missing');
  const u = new URL(raw);
  const m = raw.match(/[?&]ssl=(\{[^&]*\})/);
  const c = await mysql.createConnection({
    host: u.hostname, port: Number(u.port || 4000),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.slice(1), ...(m ? { ssl: JSON.parse(m[1]) } : {}),
    dateStrings: true, connectTimeout: 20000,
  });
  const out: Record<string, unknown> = {};
  try {
    const [rows] = await c.query(
      'SELECT id,runId,strategyId,strategyVersion,status,datasetVersionId,resultJson FROM closed_loop_backtest_run WHERE strategyId=? ORDER BY id',
      ['event-state-long-maxamp5-top3'],
    ) as unknown as [Record<string, unknown>[], unknown];
    for (const row of rows as readonly Record<string, unknown>[]) {
      const parsed = JSON.parse(String(row.resultJson)) as Record<string, unknown>;
      const stages = (parsed.stages ?? []) as readonly { stageId: string; state: string; output?: Record<string, unknown> | null }[];
      const backtest = stages.find((s) => s.stageId === 'backtest')?.output ?? null;
      const evaluation = stages.find((s) => s.stageId === 'evaluation')?.output ?? null;
      const assembly = (parsed.assembly ?? null) as Record<string, unknown> | null;
      const datasetKey = String(row.datasetVersionId) as keyof typeof OLD_REPORTS;

      const equityCurve = (backtest?.equityCurve ?? []) as readonly EquityPoint[];
      const initialCapital = Number(backtest?.initialCapital ?? 1_000_000);
      const recordedCanonical = (evaluation?.canonicalMetrics ?? null) as Record<string, unknown> | null;
      const recordedRisk = (evaluation?.riskAdjusted ?? null) as Record<string, unknown> | null;

      // --- 独立重算（同一份权威实现、同一份权益曲线）---
      const recomputedRisk = equityCurve.length >= 2
        ? computeRiskAdjustedMetrics({ equityCurve: equityCurve as never, annualizationFactor: 252, rfAnnualPct: 0, downsideTarget: 0 })
        : null;
      const returns: number[] = [];
      for (let i = 1; i < equityCurve.length; i += 1) {
        returns.push(equityCurve[i]!.equity / equityCurve[i - 1]!.equity - 1);
      }
      const recomputedSharpeShared = sharpeRatio(returns, 252);
      const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1]!.equity : initialCapital;
      const recomputedTotalReturnPct = (finalEquity / initialCapital - 1) * 100;

      const near = (a: unknown, b: unknown, tol = 1e-9): boolean => {
        const x = Number(a); const y = Number(b);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        return Math.abs(x - y) <= tol * Math.max(1, Math.abs(x));
      };

      const checks = [
        { name: 'totalReturnPct', recorded: recordedCanonical?.totalReturnPct, recomputed: recomputedTotalReturnPct },
        { name: 'maxDrawdownPct', recorded: recordedCanonical?.maxDrawdownPct, recomputed: recomputedRisk?.maxDrawdownPct },
        { name: 'cagrPct（作 Calmar 分子口径）', recorded: recordedCanonical?.cagrPct, recomputed: recomputedRisk?.cagrPct },
        { name: 'sharpeRatio', recorded: recordedRisk?.sharpeRatio, recomputed: recomputedRisk?.sharpeRatio },
        { name: 'sharpeRatio（shared/quant-stats 交叉核对）', recorded: recordedRisk?.sharpeRatio, recomputed: recomputedSharpeShared },
        { name: 'sortinoRatio', recorded: recordedRisk?.sortinoRatio, recomputed: recomputedRisk?.sortinoRatio },
        { name: 'calmarRatio', recorded: recordedRisk?.calmarRatio, recomputed: recomputedRisk?.calmarRatio },
      ].map((x) => ({ ...x, match: near(x.recorded, x.recomputed) }));

      out[datasetKey] = {
        runId: row.runId,
        archiveId: row.id,
        status: row.status,
        strategyVersion: row.strategyVersion,
        metricsSource: evaluation?.metricsSource ?? null,
        annualizationBasis: recordedCanonical?.annualizationBasis ?? null,
        riskFreeRatePct: 0,
        downsideTarget: 0,
        equityStart: equityCurve[0] ?? null,
        equityEnd: equityCurve[equityCurve.length - 1] ?? null,
        equityPoints: equityCurve.length,
        initialCapital,
        finalEquity,
        assembly: assembly === null ? null : {
          datasetVersion: assembly.datasetVersion, datasetSource: assembly.datasetSource,
          datasetVersionId: assembly.datasetVersionId, strategyDecisionEngine: assembly.strategyDecisionEngine,
          eventWindowExitTailTradingDays: assembly.eventWindowExitTailTradingDays,
          simulation: assembly.simulation, dateRange: assembly.dateRange,
        },
        recorded: { canonical: recordedCanonical, riskAdjusted: recordedRisk, tradeQuality: evaluation?.tradeQuality ?? null },
        recomputed: recomputedRisk,
        crossCheckSharpeShared: recomputedSharpeShared,
        checks,
        allChecksMatch: checks.every((x) => x.match),
        executionAndOpen: {
          executionStats: backtest?.executionStats ?? null,
          skippedCounts: backtest?.skippedCounts ?? null,
          tradeCount: backtest?.tradeCount ?? null,
          tradesTruncated: backtest?.tradesTruncated ?? null,
          costs: backtest?.costs ?? null,
          openAtEndCount: recordedCanonical?.openAtEndCount ?? null,
          completedTradeCount: recordedCanonical?.completedTradeCount ?? null,
        },
        oldReport: OLD_REPORTS[datasetKey] ?? null,
      };
    }
  } finally { await c.end(); }

  fs.writeFileSync('_scratch/goalParityS5.json', JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 1));
  console.log('\n=> _scratch/goalParityS5.json');
}
main().catch((e) => { console.error((e as Error).stack ?? String(e)); process.exitCode = 1; });
