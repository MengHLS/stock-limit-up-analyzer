/**
 * STEP 24 / C-24.2 — ③ 最差执行策略排序（rankExecutionQuality）。
 *
 * 按策略引用（runRef.strategyId@strategyVersion）分组聚合**机器可计算的执行偏差**：
 *   价格偏差率（|实际成交价 − planned 参考价| / 参考价）、未成交/部分成交率、
 *   时机偏移（executedInPlannedWindow=false 比例）。
 *
 * 诚实边界：
 *   - 执行偏差事实与 annotation 无关：已标注与未标注（draft）entry 都按同一事实口径计入
 *     （执行质量是机器可观测事实；纪律归因仍只依赖已落账标注）；
 *   - 样本数 < minSamples 的策略维度标 INSUFFICIENT_SAMPLES，**不参与排序**（不强行排名），
 *     但仍完整展示（不隐藏）；
 *   - 价格偏差率为**偏差幅度**口径（绝对值）。带符号均值仅作附注：
 *     机械符号 = 实际 − 参考，对 buy 为正 = 成交更贵；对 sell 需反向理解（不做方向修正，
 *     避免编造口径——排序与主指标一律用绝对值幅度）；
 *   - 排序 = 描述性最差候选，非「该策略必须改」结论。
 *
 * 铁律：纯函数、readonly、先排序后输出；确定性。
 */

import type { TradeJournalEntry } from "../tradeJournal/types";
import { DFA_ERROR_CODES, DisciplineFeedbackError } from "./errors";
import type {
  ExecutionQualityConfig,
  ExecutionQualityConfigInput,
  ExecutionQualityGroup,
  ExecutionQualityRankMetric,
  ExecutionQualityReport,
} from "./types";
import { resolveFeedbackEntries, stableMean, stablePercent, strategyKeyOf } from "./common";

/** ③ 默认值（唯一权威来源）。 */
export const DFA_DEFAULT_EXECUTION_RANK_METRIC: ExecutionQualityRankMetric =
  "meanAbsPriceDeviationPct";
export const DFA_DEFAULT_EXECUTION_MIN_SAMPLES = 3 as const;

function isRankMetric(value: unknown): value is ExecutionQualityRankMetric {
  return (
    value === "meanAbsPriceDeviationPct" ||
    value === "nonFullFillRatePct" ||
    value === "timingLateRatePct"
  );
}

/** 解析③ 配置（非法值响亮拒绝，不 clamp）。 */
export function resolveExecutionQualityConfig(
  config?: ExecutionQualityConfigInput
): ExecutionQualityConfig {
  const rankBy = config?.rankBy ?? DFA_DEFAULT_EXECUTION_RANK_METRIC;
  if (!isRankMetric(rankBy)) {
    throw new DisciplineFeedbackError(DFA_ERROR_CODES.CONFIG_INVALID, `rankBy（${String(rankBy)}）非法`);
  }
  const minSamples = config?.minSamples ?? DFA_DEFAULT_EXECUTION_MIN_SAMPLES;
  if (!Number.isInteger(minSamples) || minSamples < 1) {
    throw new DisciplineFeedbackError(
      DFA_ERROR_CODES.CONFIG_INVALID,
      `minSamples（${String(minSamples)}）必须是 ≥1 的整数`
    );
  }
  return { rankBy, minSamples };
}

/** 单 entry 价格偏差幅度（%）；不可算 → null。 */
function absPriceDeviationPctOf(entry: TradeJournalEntry): number | null {
  const reference = entry.planned.referencePrice;
  const deviation = entry.deviation.priceDeviation;
  if (entry.actual === null || reference === null || !(reference > 0) || deviation === null) {
    return null;
  }
  return (Math.abs(deviation) / reference) * 100;
}

/** 单 entry 带符号价格偏差率（%）；不可算 → null。 */
function signedPriceDeviationPctOf(entry: TradeJournalEntry): number | null {
  const reference = entry.planned.referencePrice;
  const deviation = entry.deviation.priceDeviation;
  if (entry.actual === null || reference === null || !(reference > 0) || deviation === null) {
    return null;
  }
  return (deviation / reference) * 100;
}

/** ③ 最差执行策略排序（确定性输出）。 */
export function rankExecutionQuality(
  entries: readonly TradeJournalEntry[],
  config?: ExecutionQualityConfigInput
): ExecutionQualityReport {
  const resolvedConfig = resolveExecutionQualityConfig(config);
  const { resolved } = resolveFeedbackEntries(entries);

  // 策略键 → 原始累计（聚合后统一计算百分比/均值）
  interface Acc {
    key: string;
    id: string;
    version: string;
    entryCount: number;
    full: number;
    partial: number;
    unfilled: number;
    priceAbs: number[];
    priceSigned: number[];
    timingTotal: number;
    timingLate: number;
    deviationFree: number;
  }
  const accMap = new Map<string, Acc>();
  for (const entry of resolved) {
    const key = strategyKeyOf(entry);
    let acc = accMap.get(key);
    if (acc === undefined) {
      acc = {
        key,
        id: entry.runRef.strategyId,
        version: entry.runRef.strategyVersion,
        entryCount: 0,
        full: 0,
        partial: 0,
        unfilled: 0,
        priceAbs: [],
        priceSigned: [],
        timingTotal: 0,
        timingLate: 0,
        deviationFree: 0,
      };
      accMap.set(key, acc);
    }
    acc.entryCount += 1;
    const fillState = entry.deviation.fillState;
    if (fillState === "FULL") acc.full += 1;
    else if (fillState === "PARTIAL") acc.partial += 1;
    else acc.unfilled += 1;
    if (entry.deviation.machineDeviationDimensions.length === 0) acc.deviationFree += 1;
    const absPct = absPriceDeviationPctOf(entry);
    if (absPct !== null) {
      acc.priceAbs.push(absPct);
      const signedPct = signedPriceDeviationPctOf(entry);
      if (signedPct !== null) acc.priceSigned.push(signedPct);
    }
    if (entry.deviation.executedInPlannedWindow !== null) {
      acc.timingTotal += 1;
      if (entry.deviation.executedInPlannedWindow === false) acc.timingLate += 1;
    }
  }

  // 内部可变形（只读接口在装配时才定型，避免对 readonly 对象做原地变异）。
  interface GroupBuild {
    readonly strategyKey: string;
    readonly strategyId: string;
    readonly strategyVersion: string;
    readonly entryCount: number;
    readonly fullFillCount: number;
    readonly partialFillCount: number;
    readonly unfilledCount: number;
    readonly unfilledRatePct: number;
    readonly partialFillRatePct: number;
    readonly nonFullFillRatePct: number;
    readonly priceDeviationSampleCount: number;
    readonly meanAbsPriceDeviationPct: number | null;
    readonly meanSignedPriceDeviationPct: number | null;
    readonly timingSampleCount: number;
    readonly timingLateRatePct: number | null;
    readonly deviationFreeCount: number;
    readonly primaryMetricValue: number | null;
  }

  const builds: GroupBuild[] = Array.from(accMap.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((acc) => {
      const nonFull = acc.partial + acc.unfilled;
      const priceMetricSamples = acc.priceAbs.length;
      return {
        strategyKey: acc.key,
        strategyId: acc.id,
        strategyVersion: acc.version,
        entryCount: acc.entryCount,
        fullFillCount: acc.full,
        partialFillCount: acc.partial,
        unfilledCount: acc.unfilled,
        unfilledRatePct: stablePercent(acc.unfilled, acc.entryCount) ?? 0,
        partialFillRatePct: stablePercent(acc.partial, acc.entryCount) ?? 0,
        nonFullFillRatePct: stablePercent(nonFull, acc.entryCount) ?? 0,
        priceDeviationSampleCount: priceMetricSamples,
        meanAbsPriceDeviationPct: stableMean(acc.priceAbs),
        meanSignedPriceDeviationPct: stableMean(acc.priceSigned),
        timingSampleCount: acc.timingTotal,
        timingLateRatePct: stablePercent(acc.timingLate, acc.timingTotal),
        deviationFreeCount: acc.deviationFree,
        primaryMetricValue: null,
      };
    });

  // 主指标取值 + 可排序判定（不同主指标门槛口径不同）
  const metricValueOf = (build: GroupBuild): number | null => {
    if (resolvedConfig.rankBy === "meanAbsPriceDeviationPct") return build.meanAbsPriceDeviationPct;
    if (resolvedConfig.rankBy === "nonFullFillRatePct") return build.nonFullFillRatePct;
    return build.timingLateRatePct;
  };
  const sampleSufficient = (build: GroupBuild): boolean => {
    const { rankBy, minSamples } = resolvedConfig;
    if (rankBy === "meanAbsPriceDeviationPct") {
      return build.priceDeviationSampleCount >= minSamples && build.meanAbsPriceDeviationPct !== null;
    }
    if (rankBy === "nonFullFillRatePct") return build.entryCount >= minSamples;
    return build.timingSampleCount >= minSamples && build.timingLateRatePct !== null;
  };

  const withMetric = builds.map((build) => ({ ...build, primaryMetricValue: metricValueOf(build) }));
  const toGroup = (build: GroupBuild & { readonly primaryMetricValue: number | null }, status: "RANKED" | "INSUFFICIENT_SAMPLES", rank: number | null): ExecutionQualityGroup => ({
    strategyKey: build.strategyKey,
    strategyId: build.strategyId,
    strategyVersion: build.strategyVersion,
    entryCount: build.entryCount,
    fullFillCount: build.fullFillCount,
    partialFillCount: build.partialFillCount,
    unfilledCount: build.unfilledCount,
    unfilledRatePct: build.unfilledRatePct,
    partialFillRatePct: build.partialFillRatePct,
    nonFullFillRatePct: build.nonFullFillRatePct,
    priceDeviationSampleCount: build.priceDeviationSampleCount,
    meanAbsPriceDeviationPct: build.meanAbsPriceDeviationPct,
    meanSignedPriceDeviationPct: build.meanSignedPriceDeviationPct,
    timingSampleCount: build.timingSampleCount,
    timingLateRatePct: build.timingLateRatePct,
    deviationFreeCount: build.deviationFreeCount,
    status,
    rank,
    primaryMetricValue: build.primaryMetricValue,
  });

  const ranked = withMetric
    .filter((b) => sampleSufficient(b))
    .sort((a, b) => {
      const av = a.primaryMetricValue as number;
      const bv = b.primaryMetricValue as number;
      return bv - av || a.strategyKey.localeCompare(b.strategyKey);
    })
    .map((b, index) => toGroup(b, "RANKED", index + 1));
  const insufficient = withMetric
    .filter((b) => !sampleSufficient(b))
    .sort((a, b) => a.strategyKey.localeCompare(b.strategyKey))
    .map((b) => toGroup(b, "INSUFFICIENT_SAMPLES", null));

  const rows: ExecutionQualityGroup[] = [...ranked, ...insufficient];

  const note =
    `执行偏差按策略引用（strategyId@strategyVersion）聚合；样本 < minSamples(${resolvedConfig.minSamples}) 的维度标 ` +
    `INSUFFICIENT_SAMPLES 不参与排序。主指标=${resolvedConfig.rankBy}：均值为描述性偏差幅度（绝对值口径），` +
    `未做方向修正，排序只表示「偏差最大的候选」，不下「必须修改」结论。`;

  return {
    config: resolvedConfig,
    rows,
    rankedCount: ranked.length,
    insufficientSampleCount: insufficient.length,
    note,
  };
}
