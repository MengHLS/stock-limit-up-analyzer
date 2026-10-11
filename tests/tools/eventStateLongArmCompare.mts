/**
 * EVENT-STATE-LONG-STRONG-HOLD-001 · 三臂对照（只读 DB，按预注册判据输出）。
 *
 * 臂：A 控制 = `2.0.0`（rule-list TIME_EXIT 40，无 policy）· C 止损 = `3.0.0` · B 强势续持 = `4.0.0`
 *
 * 输出（判据见 `docs/research/PREREG-EVENT-STATE-LONG-STRONG-HOLD-001.md` §6）：
 *   - canonical 指标（`metricsSource="canonical"`）逐臂；
 *   - **B−C**（强势续持纯增量）与 **C−A**（止损效应）**分开报**；
 *   - 🔴 **延长持仓的资金占用代价**：峰值占用、候选因无槽/预算被跳过的计数、成交笔数差；
 *   - 出场原因分布、平均持有天数；
 *   - 逐年收益符号（避免单一年份主导）。
 *
 * 用法：`node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongArmCompare.mts`
 */
import 'dotenv/config';
import fs from 'node:fs';
import mysql from 'mysql2/promise';

const STRATEGY_ID = 'event-state-long-maxamp5-top3';
/**
 * 臂坐标（**EQUITY_RATIO 口径下的修正臂**）。
 * 历史版本不参与对照：`3.0.0`/`4.0.0`（丢了 candidateExitPolicy）· `5.0.0`/`6.0.0`（FIXED_RATIO 旧口径）
 * ⇒ 见 `PREREG-…-STRONG-HOLD-001.md` §11。
 */
const ARMS: Record<string, string> = { A: '7.0.0', C: '8.0.0', B: '9.0.0' };

interface EquityPoint { readonly date: string; readonly equity: number; readonly openPositions?: number }

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL missing');
  const u = new URL(raw);
  const m = raw.match(/[?&]ssl=(\{[^&]*\})/);
  const conn = await mysql.createConnection({
    host: u.hostname, port: Number(u.port || 4000),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.slice(1), ...(m ? { ssl: JSON.parse(m[1]) } : {}),
    dateStrings: true, connectTimeout: 20000,
  });

  const out: Record<string, unknown> = {};
  try {
    const [rows] = await conn.query(
      'SELECT id,runId,strategyVersion,status,startDate,endDate,resultJson FROM closed_loop_backtest_run WHERE strategyId=? ORDER BY id',
      [STRATEGY_ID],
    ) as unknown as [Record<string, unknown>[], unknown];

    for (const [armKey, version] of Object.entries(ARMS)) {
      const row = (rows as readonly Record<string, unknown>[]).find((r) => r.strategyVersion === version);
      if (row === undefined) { out[armKey] = { version, missing: true }; continue; }
      const parsed = JSON.parse(String(row.resultJson)) as { stages?: readonly { stageId: string; output?: Record<string, unknown> | null }[] };
      const backtest = parsed.stages?.find((s) => s.stageId === 'backtest')?.output ?? null;
      const evaluation = parsed.stages?.find((s) => s.stageId === 'evaluation')?.output ?? null;
      const equityCurve = (backtest?.equityCurve ?? []) as readonly EquityPoint[];
      const trades = (backtest?.trades ?? []) as readonly Record<string, unknown>[];
      const stats = (backtest?.executionStats ?? {}) as Record<string, unknown>;

      // 出场原因分布 + 平均持有天数
      const byReason = new Map<string, number>();
      let holdingSum = 0; let holdingCount = 0;
      for (const t of trades) {
        const reason = String(t.reason ?? 'UNKNOWN');
        byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
        const h = Number(t.holdingPeriod ?? NaN);
        if (Number.isFinite(h)) { holdingSum += h; holdingCount += 1; }
      }

      // 逐年收益（按权益曲线年末值）
      const yearEnd = new Map<string, number>();
      for (const p of equityCurve) yearEnd.set(p.date.slice(0, 4), p.equity);
      const initial = Number(backtest?.initialCapital ?? 1_000_000);
      const years: Record<string, number> = {};
      let prev = initial;
      for (const [year, equity] of [...yearEnd.entries()].sort()) {
        years[year] = Number((((equity / prev) - 1) * 100).toFixed(2));
        prev = equity;
      }

      out[armKey] = {
        version, archiveId: row.id, runId: row.runId, status: row.status,
        dateRange: `${String(row.startDate)}~${String(row.endDate)}`,
        canonical: evaluation?.canonicalMetrics ?? null,
        riskAdjusted: evaluation?.riskAdjusted ?? null,
        tradeQuality: evaluation?.tradeQuality ?? null,
        finalEquity: backtest?.finalEquity ?? null,
        equityPoints: equityCurve.length,
        peakOpenPositions: equityCurve.reduce((mx, p) => Math.max(mx, Number(p.openPositions ?? 0)), 0),
        endOpenPositions: equityCurve[equityCurve.length - 1]?.openPositions ?? null,
        executionStats: stats,
        skippedCounts: backtest?.skippedCounts ?? null,
        tradeCount: backtest?.tradeCount ?? trades.length,
        avgHoldingDays: holdingCount > 0 ? Number((holdingSum / holdingCount).toFixed(2)) : null,
        exitReasons: [...byReason.entries()].sort((a, b) => b[1] - a[1]),
        yearlyReturnPct: years,
      };
    }

    // 增量（分开报）
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const canon = (k: string, field: string) => num((out[k] as { canonical?: Record<string, unknown> } | undefined)?.canonical?.[field]);
    const risk = (k: string, field: string) => num((out[k] as { riskAdjusted?: Record<string, unknown> } | undefined)?.riskAdjusted?.[field]);
    const delta = (hi: string, lo: string, field: string) => {
      const a = canon(hi, field); const b = canon(lo, field);
      return a === null || b === null ? null : Number((a - b).toFixed(6));
    };
    const deltaRisk = (hi: string, lo: string, field: string) => {
      const a = risk(hi, field); const b = risk(lo, field);
      return a === null || b === null ? null : Number((a - b).toFixed(6));
    };
    out.deltas = {
      note: 'B−C = 强势续持纯增量；C−A = 止损效应（必须分开解读）',
      strongHold_B_minus_C: {
        totalReturnPct: delta('B', 'C', 'totalReturnPct'),
        maxDrawdownPct: delta('B', 'C', 'maxDrawdownPct'),
        cagrPct: delta('B', 'C', 'cagrPct'),
        sharpeRatio: deltaRisk('B', 'C', 'sharpeRatio'),
        sortinoRatio: deltaRisk('B', 'C', 'sortinoRatio'),
        calmarRatio: deltaRisk('B', 'C', 'calmarRatio'),
        tradeCount: delta('B', 'C', 'completedTradeCount'),
        peakOpenPositions: delta('B', 'C', 'peakOpenPositions'),
      },
      stop_C_minus_A: {
        totalReturnPct: delta('C', 'A', 'totalReturnPct'),
        maxDrawdownPct: delta('C', 'A', 'maxDrawdownPct'),
        cagrPct: delta('C', 'A', 'cagrPct'),
        sharpeRatio: deltaRisk('C', 'A', 'sharpeRatio'),
        sortinoRatio: deltaRisk('C', 'A', 'sortinoRatio'),
        calmarRatio: deltaRisk('C', 'A', 'calmarRatio'),
        tradeCount: delta('C', 'A', 'completedTradeCount'),
        peakOpenPositions: delta('C', 'A', 'peakOpenPositions'),
      },
    };
  } finally { await conn.end(); }

  fs.writeFileSync('_scratch/goalArmCompare.json', JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 1));
  console.log('\n=> _scratch/goalArmCompare.json');
}
main().catch((e) => { console.error((e as Error).stack ?? String(e)); process.exitCode = 1; });
