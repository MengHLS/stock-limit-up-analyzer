/**
 * 只读「干跑」：把 db.ts#advancePaperTradingRunToLatest 的推进循环在内存里跑一遍，
 * **不写库**（不调用 persistPaperTradingRunState），用于回答「点『推进』到底会发生什么」。
 *
 * 🔴 本探针刻意复刻 db.ts 的推进循环（逐日 buildForwardCandidates → advancePaperTradingDay），
 * 属等价验收；产品路径的唯一实现仍是 db.ts，探针不得被当成第二套实现。
 *
 * 用法：npx tsx docs/evidence/_probe_paper_trading_advance_dryrun.mts [runId...]
 */
import "dotenv/config";
import { getPaperTradingRun, loadBacktestBaseContext } from "../../server/db";
import { advancePaperTradingDay } from "../../server/paperTrading";
import { buildLeaderCandidatesForDate } from "../../server/leaderCandidates";

const shiftDate = (dateStr: string, days: number): string => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const ids = process.argv.slice(2).map((v) => Number(v)).filter((v) => Number.isFinite(v));
const targetIds = ids.length > 0 ? ids : [1, 30001];

const report: Array<Record<string, unknown>> = [];

for (const id of targetIds) {
  const run = await getPaperTradingRun(id);
  if (!run) {
    report.push({ id, found: false });
    continue;
  }
  const lastProcessed = run.state.lastProcessedDate;
  const range = lastProcessed ? { startDate: shiftDate(lastProcessed, -45) } : { startDate: shiftDate(new Date().toISOString().slice(0, 10), -365) };
  const { records, context } = await loadBacktestBaseContext(range);
  const priceByStockDate = context.priceByStockDate ?? new Map();
  const tradingDates = context.tradingDates ?? [];
  const datesToAdvance = tradingDates.filter((date) => lastProcessed === null || date > lastProcessed);

  const options = run.options;
  const downside = options.downsideRisk ?? {};
  const realistic = options.realistic ?? {};

  let state = run.state;
  const perDay: Array<Record<string, unknown>> = [];
  for (const today of datesToAdvance) {
    const candidates = buildLeaderCandidatesForDate(records, today, {
      phaseByDate: context.phaseByDate,
      priceByStockDate: context.priceByStockDate,
      marketFactorsByDate: context.marketFactorsByDate,
    }).candidates;
    const beforeOrders = state.orders.length;
    const result = advancePaperTradingDay({
      state,
      today,
      signalCandidates: candidates,
      priceByStockDate,
      tradingDates,
      strategyKey: run.strategyKey,
      realistic,
      appliedMinScore: options.minScore ?? null,
      penaltyWeight: downside.penaltyWeight,
      hardRiskThreshold: downside.hardRiskThreshold ?? 0,
    });
    state = result.state;
    perDay.push({
      today,
      candidates: candidates.length,
      pendingBuysIn: result.events.filledCount + result.events.skippedCount + 0,
      filled: result.events.filledCount,
      skipped: result.events.skippedCount,
      exited: result.events.exitedCount,
      ordersBefore: beforeOrders,
      ordersAfter: state.orders.length,
      equityCurvePoints: state.equityCurve.length,
      cash: state.cash,
      pendingBuysOut: state.pendingBuys.length,
      pendingBuysOutSignalDate: state.pendingBuys[0]?.signalDate ?? null,
    });
  }

  report.push({
    id,
    found: true,
    strategyKey: run.strategyKey,
    status: run.status,
    lastProcessedDate: lastProcessed,
    range,
    tradingDatesCount: tradingDates.length,
    tradingDatesTail: tradingDates.slice(-6),
    datesToAdvance,
    pendingBuysAtStart: run.state.pendingBuys.length,
    perDay,
    finalState: {
      lastProcessedDate: state.lastProcessedDate,
      cash: state.cash,
      positions: state.positions.length,
      orders: state.orders.length,
      equityCurve: state.equityCurve.length,
      pendingBuys: state.pendingBuys.length,
      orderStatuses: state.orders.reduce<Record<string, number>>((acc, o) => {
        acc[o.status] = (acc[o.status] ?? 0) + 1;
        return acc;
      }, {}),
      firstOrders: state.orders.slice(0, 5).map((o) => ({
        code: o.stockCode,
        name: o.stockName,
        signalDate: o.signalDate,
        entryDate: o.entryDate,
        status: o.status,
        reason: o.reason,
      })),
    },
  });
}

console.log(JSON.stringify(report, null, 2));
process.exit(0);
