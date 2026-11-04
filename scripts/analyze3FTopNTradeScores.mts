/**
 * 3F TopN 成交评分统计（只读）。
 *
 * 目的：现有 v1.7.0 留档的成交明细没有保存买入时的 3F 合成分；本脚本从策略绑定的
 * Dataset Registry 数据集重建每个首板事件的 3F 分，再与已落库的 Top3 / Top5 成交逐笔回连，
 * 输出：
 *
 *   1. 全部可评分事件、每日 TopN 入选事件、实际成交事件的分数分布；
 *   2. 每笔成交的决策日、3F 分、横截面 rank / percentile 与交易结果；
 *   3. score >= threshold 的交易层筛选对照。
 *
 * 边界：
 *   - 阈值表是**交易样本层筛选**，不是重跑组合后的收益曲线；改变阈值会释放仓位并改变后续
 *     候选能否买入，因此不能把这里的小计直接冒充策略回测收益。
 *   - 只读数据库，不写回测留档，不改策略或数据集。
 *
 * 用法：
 *   npx tsx scripts/analyze3FTopNTradeScores.mts
 *   npx tsx scripts/analyze3FTopNTradeScores.mts --topn 3
 *   npx tsx scripts/analyze3FTopNTradeScores.mts --strategy-version 1.7.0
 *   npx tsx scripts/analyze3FTopNTradeScores.mts --out docs/evidence/_analysis_3f_score_stats.json
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";
import type { CanonicalMarketBar } from "../server/data";
import { rowToCanonicalBar } from "../server/research/datasetAccess/bars";
import { rankSignals } from "../server/research/framework/ranking";
import { selectCandidates } from "../server/research/framework/selection";
import { computeThreeFactorRaw, threeFactorCompositeScoreOf } from "../server/research/recipeFeatures/threeFactorScoreFeatures";
import {
  THREE_FACTOR_TOPN_OBSERVATION_WINDOW,
} from "../server/research/patternLibrary/patterns/firstLimitPullback3FTopN";
import { threeFactorTopNStrategyId } from "../server/research/patternLibrary/threeFactorTopNStrategy";
import { buildResearchDatasetFromRegistry } from "../server/runWorkbenchAssembly/datasetFromRegistry";
import {
  getClosedLoopBacktestRun,
  listClosedLoopBacktestRuns,
} from "../server/closedLoopBacktestRun/repository";

const DATASET_VERSION_ID = 660001;
const SUPPORTED_TOP_N = [3, 5] as const;

type TopN = (typeof SUPPORTED_TOP_N)[number];

interface StoredTrade {
  readonly securityId: string;
  readonly code?: string | null;
  readonly name?: string | null;
  readonly entryTime: string;
  readonly entryPrice: number;
  readonly exitTime: string | null;
  readonly exitPrice: number | null;
  readonly quantity: number;
  readonly netPnl: number | null;
  readonly returnPct: number | null;
  readonly holdingPeriod: number | null;
  readonly openAtEnd: boolean;
  readonly reason?: string | null;
}

interface EventScore {
  readonly securityId: string;
  readonly code: string | null;
  readonly eventDate: string;
  readonly decisionDate: string;
  readonly score: number;
}

interface RankedEventScore extends EventScore {
  readonly rank: number;
  readonly percentile: number;
  readonly selected: boolean;
}

interface ScoredTrade {
  readonly securityId: string;
  readonly code: string | null;
  readonly name: string | null;
  readonly decisionDate: string;
  readonly entryTime: string;
  readonly exitTime: string | null;
  readonly holdingPeriod: number | null;
  readonly score: number;
  readonly rank: number;
  readonly percentile: number;
  readonly returnPct: number | null;
  readonly netPnl: number | null;
  readonly reason: string | null;
}

interface NumericStats {
  readonly count: number;
  readonly mean: number;
  readonly min: number;
  readonly p10: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly max: number;
}

interface TradeOutcomeStats {
  readonly count: number;
  readonly completedCount: number;
  readonly winRatePct: number | null;
  readonly meanReturnPct: number | null;
  readonly medianReturnPct: number | null;
  readonly totalNetPnl: number;
}

interface ThresholdRow extends TradeOutcomeStats {
  readonly threshold: number;
  readonly retainedPct: number;
}

function argOf(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

function round(value: number, digits = 10): number {
  return Number(value.toFixed(digits));
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function statsOf(values: readonly number[]): NumericStats | null {
  if (values.length === 0) return null;
  return {
    count: values.length,
    mean: round(mean(values)!),
    min: round(Math.min(...values)),
    p10: round(percentile(values, 0.1)!),
    p25: round(percentile(values, 0.25)!),
    p50: round(percentile(values, 0.5)!),
    p75: round(percentile(values, 0.75)!),
    p90: round(percentile(values, 0.9)!),
    max: round(Math.max(...values)),
  };
}

function outcomeStats(trades: readonly ScoredTrade[]): TradeOutcomeStats {
  const completed = trades.filter(trade => trade.returnPct !== null && Number.isFinite(trade.returnPct));
  const returns = completed.map(trade => trade.returnPct as number);
  const wins = returns.filter(value => value > 0);
  const netPnls = trades
    .map(trade => trade.netPnl)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    count: trades.length,
    completedCount: completed.length,
    winRatePct: completed.length === 0 ? null : round((wins.length / completed.length) * 100),
    meanReturnPct: returns.length === 0 ? null : round(mean(returns)!),
    medianReturnPct: returns.length === 0 ? null : round(percentile(returns, 0.5)!),
    totalNetPnl: round(netPnls.reduce((sum, value) => sum + value, 0), 4),
  };
}

function tradeFromUnknown(value: unknown): StoredTrade | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.securityId !== "string"
    || typeof record.entryTime !== "string"
    || typeof record.entryPrice !== "number"
    || !Number.isFinite(record.entryPrice)
  ) {
    return null;
  }
  return {
    securityId: record.securityId,
    code: typeof record.code === "string" ? record.code : null,
    name: typeof record.name === "string" ? record.name : null,
    entryTime: record.entryTime,
    entryPrice: record.entryPrice,
    exitTime: typeof record.exitTime === "string" ? record.exitTime : null,
    exitPrice: typeof record.exitPrice === "number" ? record.exitPrice : null,
    quantity: typeof record.quantity === "number" ? record.quantity : 0,
    netPnl: typeof record.netPnl === "number" ? record.netPnl : null,
    returnPct: typeof record.returnPct === "number" ? record.returnPct : null,
    holdingPeriod: typeof record.holdingPeriod === "number" ? record.holdingPeriod : null,
    openAtEnd: record.openAtEnd === true,
    reason: typeof record.reason === "string" ? record.reason : null,
  };
}

function tradesOfResult(result: unknown): readonly StoredTrade[] {
  if (result === null || typeof result !== "object") return [];
  const stages = (result as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return [];
  const backtest = stages.find(
    stage =>
      stage !== null
      && typeof stage === "object"
      && (stage as { stageId?: unknown }).stageId === "backtest",
  );
  const output =
    backtest !== null && typeof backtest === "object"
      ? (backtest as { output?: unknown }).output
      : null;
  const trades =
    output !== null && typeof output === "object"
      ? (output as { trades?: unknown }).trades
      : null;
  if (!Array.isArray(trades)) return [];
  return trades.map(tradeFromUnknown).filter((trade): trade is StoredTrade => trade !== null);
}

function buildEventScores(
  rows: Awaited<ReturnType<typeof buildResearchDatasetFromRegistry>>["dataset"]["rows"],
): readonly EventScore[] {
  const rowsBySecurity = new Map<string, CanonicalMarketBar[]>();
  const codeBySecurity = new Map<string, string | null>();
  for (const row of rows) {
    const bars = rowsBySecurity.get(row.securityId);
    if (bars === undefined) {
      rowsBySecurity.set(row.securityId, [rowToCanonicalBar(row)]);
      codeBySecurity.set(row.securityId, row.code);
    } else {
      bars.push(rowToCanonicalBar(row));
    }
  }

  const output: EventScore[] = [];
  for (const [securityId, unsortedBars] of rowsBySecurity) {
    const bars = [...unsortedBars].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    if (bars.length < THREE_FACTOR_TOPN_OBSERVATION_WINDOW.start + 1) continue;
    const raw = computeThreeFactorRaw(bars);
    if (raw === null) continue;
    const score = threeFactorCompositeScoreOf(raw);
    if (score === null || !Number.isFinite(score)) continue;
    output.push({
      securityId,
      code: codeBySecurity.get(securityId) ?? null,
      eventDate: bars[0]!.timestamp,
      decisionDate: bars[THREE_FACTOR_TOPN_OBSERVATION_WINDOW.start]!.timestamp,
      score,
    });
  }
  return output;
}

function rankAndSelect(
  events: readonly EventScore[],
  topN: TopN,
  dateRange: { readonly startDate: string; readonly endDate: string },
): readonly RankedEventScore[] {
  const byDate = new Map<string, EventScore[]>();
  for (const event of events) {
    if (event.decisionDate < dateRange.startDate || event.decisionDate > dateRange.endDate) continue;
    const bucket = byDate.get(event.decisionDate);
    if (bucket === undefined) byDate.set(event.decisionDate, [event]);
    else bucket.push(event);
  }

  const ranked: RankedEventScore[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const dayEvents = byDate.get(date)!;
    const rankedSignals = rankSignals(
      dayEvents.map(event => ({ securityId: event.securityId, value: event.score })),
      { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
    );
    const selected = new Set(
      selectCandidates(rankedSignals, { method: { kind: "topN", n: topN } })
        .map(candidate => candidate.securityId),
    );
    const signalBySecurity = new Map(rankedSignals.map(signal => [signal.securityId, signal]));
    for (const event of dayEvents) {
      const signal = signalBySecurity.get(event.securityId);
      if (signal === undefined || signal.rank === null || signal.percentile === null) continue;
      ranked.push({
        ...event,
        rank: signal.rank,
        percentile: signal.percentile,
        selected: selected.has(event.securityId),
      });
    }
  }
  return ranked;
}

function joinTrades(
  trades: readonly StoredTrade[],
  rankedEvents: readonly RankedEventScore[],
): { readonly scored: readonly ScoredTrade[]; readonly unmatched: readonly StoredTrade[] } {
  const bySecurity = new Map<string, RankedEventScore[]>();
  for (const event of rankedEvents) {
    const bucket = bySecurity.get(event.securityId);
    if (bucket === undefined) bySecurity.set(event.securityId, [event]);
    else bucket.push(event);
  }

  const scored: ScoredTrade[] = [];
  const unmatched: StoredTrade[] = [];
  for (const trade of trades) {
    const candidates = (bySecurity.get(trade.securityId) ?? [])
      .filter(event => event.decisionDate < trade.entryTime)
      .sort((left, right) => right.decisionDate.localeCompare(left.decisionDate));
    const event = candidates[0];
    if (event === undefined) {
      unmatched.push(trade);
      continue;
    }
    scored.push({
      securityId: trade.securityId,
      code: trade.code ?? event.code,
      name: trade.name ?? null,
      decisionDate: event.decisionDate,
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      holdingPeriod: trade.holdingPeriod,
      score: event.score,
      rank: event.rank,
      percentile: event.percentile,
      returnPct: trade.returnPct,
      netPnl: trade.netPnl,
      reason: trade.reason ?? null,
    });
  }
  return { scored, unmatched };
}

function buildThresholdRows(trades: readonly ScoredTrade[]): readonly ThresholdRow[] {
  const thresholds = [...new Set(trades.map(trade => round(trade.score, 10)))]
    .sort((left, right) => left - right);
  return thresholds.map(threshold => {
    const kept = trades.filter(trade => trade.score + 1e-12 >= threshold);
    return {
      threshold,
      retainedPct: round((kept.length / trades.length) * 100),
      ...outcomeStats(kept),
    };
  });
}

function summarizeStrategy(
  topN: TopN,
  trades: readonly StoredTrade[],
  rankedEvents: readonly RankedEventScore[],
) {
  const selectedEvents = rankedEvents.filter(event => event.selected);
  const joined = joinTrades(trades, rankedEvents);
  const selectedByKey = new Map(
    selectedEvents.map(event => [`${event.securityId}\u0000${event.decisionDate}`, event]),
  );
  const matchedSelected = new Set<string>();
  for (const trade of joined.scored) {
    matchedSelected.add(`${trade.securityId}\u0000${trade.decisionDate}`);
  }
  const selectedWithoutTrade = selectedEvents.filter(
    event => !matchedSelected.has(`${event.securityId}\u0000${event.decisionDate}`),
  );

  return {
    topN,
    eventScoreCount: rankedEvents.length,
    selectedEventCount: selectedEvents.length,
    selectedWithoutTradeCount: selectedWithoutTrade.length,
    actualTradeCount: trades.length,
    matchedTradeCount: joined.scored.length,
    unmatchedTradeCount: joined.unmatched.length,
    scoreDistributions: {
      allEligibleEvents: statsOf(rankedEvents.map(event => event.score)),
      selectedEvents: statsOf(selectedEvents.map(event => event.score)),
      actualTrades: statsOf(joined.scored.map(trade => trade.score)),
      selectedWithoutTrade: statsOf(selectedWithoutTrade.map(event => event.score)),
    },
    actualTradeOutcome: outcomeStats(joined.scored),
    thresholds: buildThresholdRows(joined.scored),
    trades: joined.scored,
    unmatchedTrades: joined.unmatched,
    selectedWithoutTrade: selectedWithoutTrade.slice(0, 200),
  };
}

async function main(): Promise<void> {
  const rawTopN = argOf("topn");
  const requestedStrategyVersion = argOf("strategy-version");
  const requestedTopN: readonly TopN[] =
    rawTopN === null
      ? SUPPORTED_TOP_N
      : rawTopN
          .split(",")
          .map(value => Number(value.trim()))
          .map(value => {
            if (value !== 3 && value !== 5) {
              throw new Error(`--topn 只能是 3 / 5，实际 ${String(value)}`);
            }
            return value;
          });
  const out = argOf(
    "out",
    requestedTopN.length === 1
      ? `docs/evidence/_analysis_3f_topn_score_stats_top${requestedTopN[0]}.json`
      : "docs/evidence/_analysis_3f_topn_score_stats.json",
  )!;

  console.log(
    `[3f-score] 读取 Dataset Registry dataset_version.id=${DATASET_VERSION_ID} `
    + `并重建 rd=0..${THREE_FACTOR_TOPN_OBSERVATION_WINDOW.end} 事件序列…`,
  );
  const registry = await buildResearchDatasetFromRegistry({
    datasetVersionId: DATASET_VERSION_ID,
    name: "3F TopN score diagnostics",
    observationWindow: { ...THREE_FACTOR_TOPN_OBSERVATION_WINDOW },
    dataReady: true,
  });
  const eventScores = buildEventScores(registry.dataset.rows);
  console.log(
    `[3f-score] 数据集 rows=${registry.dataset.rows.length} / `
    + `可评分事件=${eventScores.length}`,
  );

  const strategies: Record<string, unknown> = {};
  for (const topN of requestedTopN) {
    const strategyId = threeFactorTopNStrategyId(topN);
    const history = await listClosedLoopBacktestRuns({ strategyId, limit: 20 });
    const run =
      requestedStrategyVersion === null
        ? history[0]
        : history.find(item => item.strategyVersion === requestedStrategyVersion);
    if (run === undefined) {
      throw new Error(
        requestedStrategyVersion === null
          ? `${strategyId} 没有可分析留档；先跑正式回测。`
          : `${strategyId} 没有 v${requestedStrategyVersion} 留档；先跑该版本正式回测。`,
      );
    }
    const detail = await getClosedLoopBacktestRun(run.id);
    const trades = tradesOfResult(detail?.result);
    if (detail?.result === null || detail?.result === undefined) {
      throw new Error(`留档 ${run.id} 的 resultJson 不可读。`);
    }
    const resultAssembly =
      typeof detail.result === "object"
      && detail.result !== null
      && typeof (detail.result as { assembly?: unknown }).assembly === "object"
      && (detail.result as { assembly?: unknown }).assembly !== null
        ? (detail.result as {
            assembly: { dateRange?: { startDate?: unknown; endDate?: unknown } };
          }).assembly
        : null;
    const startDate = resultAssembly?.dateRange?.startDate;
    const endDate = resultAssembly?.dateRange?.endDate;
    if (typeof startDate !== "string" || typeof endDate !== "string") {
      throw new Error(`留档 ${run.id} 缺 assembly.dateRange，无法按真实决策窗口统计。`);
    }
    const rankedEvents = rankAndSelect(eventScores, topN, { startDate, endDate });
    const summary = summarizeStrategy(topN, trades, rankedEvents);
    strategies[`top${topN}`] = {
      archiveId: run.id,
      runId: run.runId,
      strategyVersion: run.strategyVersion,
      ...summary,
    };
    console.log(
      `[3f-score] Top${topN}: selected=${summary.selectedEventCount} / `
      + `trades=${summary.actualTradeCount} / matched=${summary.matchedTradeCount}`,
    );
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    datasetVersionId: DATASET_VERSION_ID,
    datasetVersion: registry.dataset.datasetVersion,
    observationWindow: THREE_FACTOR_TOPN_OBSERVATION_WINDOW,
    requestedStrategyVersion,
    semantics: {
      candidateUniverse: "所有 3F 可算且观察窗内发生回踩的首板事件",
      selected: `每个决策日按 3F 分降序取 TopN；rank 使用 average tie，安全序列号同时参与 Core 破平`,
      thresholds:
        "阈值表仅做交易样本层筛选，不重跑组合；释放仓位可能改变后续买入与权益，不能当作完整回测收益",
    },
    strategies,
  };
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[3f-score] 输出：${out}`);
  process.exit(0);
}

await main();
