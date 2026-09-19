/**
 * ROBUSTNESS-001 §3.2 / §5 / §6 / §11 — 邻域构造 · 稳定性判定 · 敏感性 · 离散度。
 *
 * ## 纯函数纪律
 *
 * 本文件**零 IO / 零 Date.now / 零 Math.random**：输入是「已从库读出的冻结快照 + 组合 + 结果」，
 * 输出是纯数据。因此「同一输入 ⇒ 同一输出」在结构上成立（规格 §21 C / §22 Determinism），
 * 不依赖任何外部状态。
 *
 * ## 邻域语义（规格 §3.2）
 *
 * 沿**单个参数轴**移动 ±1..±`neighborDistance` 步：
 *
 * ```text
 *                    pullbackDepth
 *                  0.03   0.05   0.07
 * entryDay = 2      ←      ←      ←        （±1 步；只动 pullbackDepth）
 * ```
 *
 * 🔴 只使用 **Parameter Search 已经实际算出来的** 组合（`presentNeighborCount`）；
 *   缺失的邻居如实标 `MISSING_COMBINATION`，**绝不假设 / 绝不补值**（规格 §3.2 / §21 E）。
 *
 * ## tradeCount = 0 的处理（规格 §11）
 *
 * `tradeCount = 0` 的组合**不计入** `validNeighborCount`，既不当「稳定」也不当「不稳定」，
 * 而是单列为 `INSUFFICIENT_TRADING_ACTIVITY`（保留 `tradeCount` 与 `statusReason`）。
 *   ⇒ 统计口径上，「没有交易」与「交易结果稳健」是两件事，**不得**混同。
 */

import { mean, median, standardDeviation } from "../../../shared/quant-stats";
import type { ParameterSearchSpaceDefinition } from "../../../shared/parameterSearchContracts";
import { domainValueKey, expandSearchDomainValues, indexOfDomainValue } from "./domainValues";
import { computeSearchRobustnessResultFingerprint } from "./run";
import {
  ROBUSTNESS_DISPERSION_METRICS,
  SEARCH_ROBUSTNESS_RESULT_RECORD_KIND,
  SEARCH_ROBUSTNESS_RESULT_RECORD_VERSION,
  type ResolvedRobustnessAnalysisConfig,
  type RobustnessDispersion,
  type RobustnessDispersionMetric,
  type RobustnessMetricsSnapshot,
  type RobustnessNeighbor,
  type RobustnessNeighborAvailability,
  type RobustnessParameterSensitivity,
  type RobustnessParameterValue,
  type RobustnessSensitivityEntry,
  type RobustnessSourceCombination,
  type RobustnessSourceResult,
  type SearchRobustnessResult,
} from "./types";

// ---------------------------------------------------------------------------
// 轴（冻结快照 → 可变参数的有序取值序列）
// ---------------------------------------------------------------------------

/** 一个**参与搜索**的参数轴（只有 TUNABLE 且带搜索域的才成为轴）。 */
export interface NeighborhoodAxis {
  readonly parameter: string;
  readonly domainMode: string;
  readonly numeric: boolean;
  readonly values: readonly RobustnessParameterValue[];
}

/** 轴构造结果（含如实说明）。 */
export interface NeighborhoodAxisBuild {
  readonly axes: readonly NeighborhoodAxis[];
  /** 未成为轴的参数及原因（不静默丢弃）。 */
  readonly notes: readonly string[];
}

/**
 * 从**冻结快照**构造轴（规格 §3.2：邻域由快照决定，不由当前策略决定）。
 *
 * 判据：`kind === "TUNABLE"` 且 `search` 存在且展开出 >= 1 个取值。
 * 其余（FIXED / DERIVED / 无搜索域 / 取值展开为空）⇒ 如实登记原因，不进轴。
 */
export function buildNeighborhoodAxes(
  snapshot: ParameterSearchSpaceDefinition,
): NeighborhoodAxisBuild {
  const axes: NeighborhoodAxis[] = [];
  const notes: string[] = [];
  snapshot.parameters.forEach((parameter, index) => {
    const path = `parameters[${index}].search`;
    if (parameter.search === undefined) {
      notes.push(
        `参数 ${parameter.name}（${parameter.kind}）无搜索域 ⇒ 不参与邻域分析`
          + `${parameter.exclusionReason === undefined ? "" : `（原因：${parameter.exclusionReason}）`}。`,
      );
      return;
    }
    const expanded = expandSearchDomainValues(parameter.search, path);
    if (!expanded.searchable) {
      notes.push(`参数 ${parameter.name} 的搜索域形态为 FIXED ⇒ 不进搜索空间，不参与邻域分析。`);
      return;
    }
    if (expanded.duplicateKeys.length > 0) {
      notes.push(
        `参数 ${parameter.name} 的冻结搜索域含 ${String(expanded.duplicateKeys.length)} 个重复取值`
          + `（键：${expanded.duplicateKeys.join(" / ")}）⇒ 已按稳定键合并，未静默丢弃。`,
      );
    }
    axes.push({
      parameter: parameter.name,
      domainMode: expanded.domainMode,
      numeric: expanded.numeric,
      values: expanded.values,
    });
  });
  return { axes, notes };
}

// ---------------------------------------------------------------------------
// 组合键（参数取值 → 稳定字符串键；**不重算 parameterHash**）
// ---------------------------------------------------------------------------

/**
 * 参数取值组合的稳定键（键按字典序，值走 `domainValueKey`）。
 *
 * 🔴 只用于**查找**已存在的组合行（`parameterHash` 由源 Search Run 落库时算好、
 *   本域**不重算**）—— 重算等于制造第二套 hash 实现，一旦口径不同就静默查不到邻居。
 */
export function combinationLookupKey(
  parameters: Readonly<Record<string, RobustnessParameterValue>>,
): string {
  return Object.keys(parameters)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => `${JSON.stringify(name)}=${domainValueKey(parameters[name] ?? null)}`)
    .join("|");
}

/** 查找索引（从源 Run 的行构建；只读）。 */
export interface SourceIndex {
  /** 参数键 → 源组合（含 `parameterHash` / `combinationIndex`）。 */
  readonly combinationByKey: ReadonlyMap<string, RobustnessSourceCombination>;
  /** `parameterHash` → 源结果。 */
  readonly resultByHash: ReadonlyMap<string, RobustnessSourceResult>;
}

/** 构建查找索引（纯函数；不重算任何 hash）。 */
export function buildSourceIndex(input: {
  readonly combinations: readonly RobustnessSourceCombination[];
  readonly results: readonly RobustnessSourceResult[];
}): SourceIndex {
  const combinationByKey = new Map<string, RobustnessSourceCombination>();
  for (const combination of input.combinations) {
    combinationByKey.set(combinationLookupKey(combination.parameters), combination);
  }
  const resultByHash = new Map<string, RobustnessSourceResult>();
  for (const result of input.results) {
    resultByHash.set(result.parameterHash, result);
  }
  return { combinationByKey, resultByHash };
}

// ---------------------------------------------------------------------------
// 邻居可用性（**唯一判据**；统计与展示共用）
// ---------------------------------------------------------------------------

/** 单个组合的**基准侧**可用性判定（结果行存在性与两个容差指标齐备性）。 */
interface BaseMetricUsability {
  readonly usable: boolean;
  readonly availability: RobustnessNeighborAvailability;
  readonly reason: string | null;
}

/** 判定「这份读数能不能进入容差判定」。 */
function judgeMetricUsability(input: {
  readonly presentCombination: boolean;
  readonly result: RobustnessSourceResult | undefined;
}): BaseMetricUsability {
  if (!input.presentCombination) {
    return {
      usable: false,
      availability: "MISSING_COMBINATION",
      reason: "该组合不在源 Parameter Search 中（缺失格）；不假设、不补值。",
    };
  }
  const result = input.result;
  if (result === undefined) {
    return { usable: false, availability: "NO_METRICS", reason: "源 Search 没有该组合的结果行。" };
  }
  if (result.status !== "SUCCEEDED") {
    return {
      usable: false,
      availability: "NO_METRICS",
      reason: `源结果状态为 ${result.status}${result.error === null ? "" : `（${result.error}）`}。`,
    };
  }
  const { totalReturnPct, maxDrawdownPct, tradeCount } = result.metrics;
  if (tradeCount === null) {
    return {
      usable: false,
      availability: "NO_METRICS",
      reason: "源结果缺少 tradeCount，无法判断是否存在交易活动。",
    };
  }
  if (tradeCount === 0) {
    return {
      usable: false,
      availability: "INSUFFICIENT_TRADING_ACTIVITY",
      reason: "tradeCount = 0（无交易活动）⇒ 不作为有效样本，也不据此判「稳健」或「不稳健」（规格 §11）。",
    };
  }
  if (totalReturnPct === null || maxDrawdownPct === null) {
    return {
      usable: false,
      availability: "METRICS_INCOMPLETE",
      reason:
        `tradeCount = ${String(tradeCount)} 但容差判定所需指标缺失`
        + `（totalReturnPct=${String(totalReturnPct)} / maxDrawdownPct=${String(maxDrawdownPct)}）⇒ 无从判定。`,
    };
  }
  return { usable: true, availability: "VALID", reason: null };
}

// ---------------------------------------------------------------------------
// 邻域构造
// ---------------------------------------------------------------------------

/** 单组合的邻域评估结果。 */
export interface NeighborhoodAssessment {
  readonly neighbors: readonly RobustnessNeighbor[];
  readonly expectedNeighborCount: number;
  readonly presentNeighborCount: number;
  readonly validNeighborCount: number;
  readonly stableNeighborCount: number;
  readonly stabilityRatio: number | null;
}

/**
 * 构造并评估一个基组合的邻域（轴对齐、±1..±distance 步）。
 *
 * `baseParameters` 里的轴上取值必须能在冻结序列里定位；定位不到的轴记一条
 * `unresolvedAxes` 说明（**不猜**），该轴不产生邻居。
 */
export function assessNeighborhood(input: {
  readonly baseParameters: Readonly<Record<string, RobustnessParameterValue>>;
  readonly axes: readonly NeighborhoodAxis[];
  readonly index: SourceIndex;
  readonly config: ResolvedRobustnessAnalysisConfig;
  /** 基准侧的容差衡量指标（已确认可用）。 */
  readonly baseTotalReturnPct: number;
  readonly baseMaxDrawdownPct: number;
}): NeighborhoodAssessment & { readonly unresolvedAxes: readonly string[] } {
  const { axes, index, config } = input;
  const neighbors: RobustnessNeighbor[] = [];
  const unresolvedAxes: string[] = [];
  const seenKeys = new Set<string>();
  const baseKey = combinationLookupKey(input.baseParameters);

  for (const axis of axes) {
    const baseValue = input.baseParameters[axis.parameter] ?? null;
    const baseIndex = indexOfDomainValue(axis.values, baseValue);
    if (baseIndex < 0) {
      unresolvedAxes.push(axis.parameter);
      continue;
    }
    for (let offset = -config.neighborDistance; offset <= config.neighborDistance; offset += 1) {
      if (offset === 0) continue;
      const targetIndex = baseIndex + offset;
      if (targetIndex < 0 || targetIndex >= axis.values.length) continue;
      const targetValue = axis.values[targetIndex];
      if (targetValue === undefined) continue;
      const parameters: Record<string, RobustnessParameterValue> = {
        ...input.baseParameters,
        [axis.parameter]: targetValue,
      };
      const key = combinationLookupKey(parameters);
      if (key === baseKey || seenKeys.has(key)) continue;
      seenKeys.add(key);

      const combination = index.combinationByKey.get(key);
      const result = combination === undefined ? undefined : index.resultByHash.get(combination.parameterHash);
      const usability = judgeMetricUsability({
        presentCombination: combination !== undefined,
        result,
      });

      let deltaTotalReturnPct: number | null = null;
      let deltaMaxDrawdownPct: number | null = null;
      let withinTolerance: boolean | null = null;
      if (usability.usable && result !== undefined) {
        const totalReturnPct = result.metrics.totalReturnPct as number;
        const maxDrawdownPct = result.metrics.maxDrawdownPct as number;
        deltaTotalReturnPct = totalReturnPct - input.baseTotalReturnPct;
        deltaMaxDrawdownPct = maxDrawdownPct - input.baseMaxDrawdownPct;
        withinTolerance =
          Math.abs(deltaTotalReturnPct) <= config.returnTolerancePct
          && Math.abs(deltaMaxDrawdownPct) <= config.drawdownTolerancePct;
      }

      neighbors.push({
        axis: axis.parameter,
        stepOffset: offset,
        parameters,
        parameterHash: combination?.parameterHash ?? null,
        availability: usability.availability,
        metrics: usability.usable && result !== undefined ? { ...result.metrics } : null,
        deltaTotalReturnPct,
        deltaMaxDrawdownPct,
        withinTolerance,
        unavailableReason: usability.reason,
      });
    }
  }

  const presentNeighborCount = neighbors.filter((item) => item.parameterHash !== null).length;
  const validNeighborCount = neighbors.filter((item) => item.availability === "VALID").length;
  const stableNeighborCount = neighbors.filter((item) => item.withinTolerance === true).length;

  return {
    neighbors,
    expectedNeighborCount: neighbors.length,
    presentNeighborCount,
    validNeighborCount,
    stableNeighborCount,
    stabilityRatio:
      validNeighborCount === 0
        ? null
        : Math.round((stableNeighborCount / validNeighborCount) * 1e6) / 1e6,
    unresolvedAxes,
  };
}

// ---------------------------------------------------------------------------
// 离散度（规格 §5.1）
// ---------------------------------------------------------------------------

/** 从样本集合里抽某个指标的数值序列（`null` 不参与，**不补 0**）。 */
function metricSeries(
  samples: readonly RobustnessMetricsSnapshot[],
  metric: RobustnessDispersionMetric,
): number[] {
  const values: number[] = [];
  for (const sample of samples) {
    const value = sample[metric];
    if (value === null) continue;
    if (!Number.isFinite(value)) continue;
    values.push(value);
  }
  return values;
}

/**
 * 计算指定样本集在六个指标上的描述性统计（规格 §5.1）。
 *
 * 🔴 `count = 0` ⇒ 其余字段**全部 null**（不编造 0）：这是「没有可统计的样本」，
 *   与「统计出来是 0」是两件事。
 */
export function computeDispersion(
  samples: readonly RobustnessMetricsSnapshot[],
): readonly RobustnessDispersion[] {
  return ROBUSTNESS_DISPERSION_METRICS.map((metric) => {
    const values = metricSeries(samples, metric);
    if (values.length === 0) {
      return {
        metric,
        count: 0,
        mean: null,
        median: null,
        min: null,
        max: null,
        stdDev: null,
        range: null,
      };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    return {
      metric,
      count: values.length,
      // 复用 `shared/quant-stats` 唯一权威统计实现，不另写一套 mean/median/stdDev。
      mean: mean(values),
      median: median(values),
      stdDev: standardDeviation(values),
      min,
      max,
      range: max - min,
    };
  });
}

// ---------------------------------------------------------------------------
// 敏感性（规格 §5.2）
// ---------------------------------------------------------------------------

/** 单参数轴上、跨全部基组合的敏感性汇聚。 */
export function summarizeParameterSensitivity(input: {
  readonly axis: NeighborhoodAxis;
  /** 每个基组合的「轴 → 邻居条目」，按轴归并。 */
  readonly entries: readonly RobustnessSensitivityEntry[];
}): RobustnessParameterSensitivity {
  const entries = [...input.entries];
  const absoluteChanges: number[] = [];
  const relativeChanges: number[] = [];
  for (const entry of entries) {
    if (entry.absoluteChangePct !== null) absoluteChanges.push(Math.abs(entry.absoluteChangePct));
    if (entry.relativeChange !== null) relativeChanges.push(Math.abs(entry.relativeChange));
  }
  return {
    parameter: input.axis.parameter,
    domainMode: input.axis.domainMode,
    numeric: input.axis.numeric,
    entries,
    measuredCount: absoluteChanges.length,
    meanAbsoluteChangePct: mean(absoluteChanges),
    maxAbsoluteChangePct: absoluteChanges.length === 0 ? null : Math.max(...absoluteChanges),
    meanRelativeChange: mean(relativeChanges),
    maxRelativeChange: relativeChanges.length === 0 ? null : Math.max(...relativeChanges),
  };
}

/**
 * 由邻居条目生成敏感性条目。
 *
 * 🔴 相对变化**只在数值型参数且基值 ≠ 0** 时给出（规格 §5.2：枚举参数只算离散变化，
 *   不制造连续意义；基值为 0 时相对变化无定义 ⇒ null，不编造）。
 */
export function toSensitivityEntry(input: {
  readonly axis: NeighborhoodAxis;
  readonly neighbor: RobustnessNeighbor;
  readonly baseTotalReturnPct: number;
}): RobustnessSensitivityEntry {
  const { neighbor, axis } = input;
  if (neighbor.availability !== "VALID" || neighbor.deltaTotalReturnPct === null) {
    return {
      axis: axis.parameter,
      stepOffset: neighbor.stepOffset,
      parameterHash: neighbor.parameterHash,
      absoluteChangePct: null,
      relativeChange: null,
      withinTolerance: neighbor.withinTolerance,
    };
  }
  const absoluteChangePct = neighbor.deltaTotalReturnPct;
  const relativeChange =
    axis.numeric && input.baseTotalReturnPct !== 0
      ? Math.round((absoluteChangePct / Math.abs(input.baseTotalReturnPct)) * 1e6) / 1e6
      : null;
  return {
    axis: axis.parameter,
    stepOffset: neighbor.stepOffset,
    parameterHash: neighbor.parameterHash,
    absoluteChangePct,
    relativeChange,
    withinTolerance: neighbor.withinTolerance,
  };
}

// ---------------------------------------------------------------------------
// 单组合判定（规格 §6 / §11）
// ---------------------------------------------------------------------------

/**
 * 判定一个基组合（**包含指纹签发**）。
 *
 * 判定顺序（不可交换 —— 顺序本身就是语义）：
 *   1. 源结果不存在 / 失败          ⇒ `SOURCE_RESULT_UNAVAILABLE`
 *   2. `tradeCount = 0`            ⇒ `INSUFFICIENT_TRADING_ACTIVITY`（**先于**邻域判定）
 *   3. 容差指标缺一                 ⇒ `SOURCE_RESULT_UNAVAILABLE`
 *   4. 有效邻居 < `minValidNeighbors` ⇒ `INSUFFICIENT_NEIGHBORHOOD`
 *   5. 全部有效邻居在容差内         ⇒ `STABLE`，否则 `UNSTABLE`
 */
export function assessBaseCombination(input: {
  readonly robustnessRunId: string;
  readonly sourceSearchRunId: string;
  readonly combination: RobustnessSourceCombination;
  readonly axes: readonly NeighborhoodAxis[];
  readonly index: SourceIndex;
  readonly config: ResolvedRobustnessAnalysisConfig;
  readonly metricsSource: string;
}): SearchRobustnessResult {
  const { combination, config, index } = input;
  const result = index.resultByHash.get(combination.parameterHash);
  const metrics: RobustnessMetricsSnapshot =
    result === undefined
      ? {
          totalReturnPct: null,
          annualizedReturnPct: null,
          maxDrawdownPct: null,
          tradeCount: null,
          winRatePct: null,
          profitFactor: null,
        }
      : { ...result.metrics };

  const usability = judgeMetricUsability({ presentCombination: true, result });
  const emptyNeighborhood: NeighborhoodAssessment = {
    neighbors: [],
    expectedNeighborCount: 0,
    presentNeighborCount: 0,
    validNeighborCount: 0,
    stableNeighborCount: 0,
    stabilityRatio: null,
  };

  let status: SearchRobustnessResult["status"];
  let statusReason: string | null;
  let neighborhood = emptyNeighborhood;
  const sensitivityEntries: RobustnessSensitivityEntry[] = [];

  if (!usability.usable) {
    status =
      usability.availability === "INSUFFICIENT_TRADING_ACTIVITY"
        ? "INSUFFICIENT_TRADING_ACTIVITY"
        : "SOURCE_RESULT_UNAVAILABLE";
    statusReason = usability.reason;
  } else {
    const baseTotalReturnPct = metrics.totalReturnPct as number;
    const baseMaxDrawdownPct = metrics.maxDrawdownPct as number;
    const assessed = assessNeighborhood({
      baseParameters: combination.parameters,
      axes: input.axes,
      index,
      config,
      baseTotalReturnPct,
      baseMaxDrawdownPct,
    });
    neighborhood = assessed;
    for (const axis of input.axes) {
      for (const neighbor of assessed.neighbors) {
        if (neighbor.axis !== axis.parameter) continue;
        sensitivityEntries.push(
          toSensitivityEntry({ axis, neighbor, baseTotalReturnPct }),
        );
      }
    }
    if (assessed.validNeighborCount < config.minValidNeighbors) {
      status = "INSUFFICIENT_NEIGHBORHOOD";
      statusReason =
        `有效邻居 ${String(assessed.validNeighborCount)} < 要求 ${String(config.minValidNeighbors)}`
        + `（理论邻居 ${String(assessed.expectedNeighborCount)}，其中源 Search 实存 `
        + `${String(assessed.presentNeighborCount)}）⇒ 证据不足，既判不稳也不判不稳（规格 §3.2/§11）。`;
    } else if (assessed.stableNeighborCount === assessed.validNeighborCount) {
      status = "STABLE";
      statusReason = null;
    } else {
      status = "UNSTABLE";
      statusReason =
        `有效邻居中 ${String(assessed.validNeighborCount - assessed.stableNeighborCount)} 条超出容差`
        + `（收益 ±${String(config.returnTolerancePct)} 个百分点 / 回撤 ±${String(config.drawdownTolerancePct)} 个百分点）。`;
    }
    if (assessed.unresolvedAxes.length > 0) {
      const suffix =
        `基组合的取值在冻结搜索域里定位不到（轴：${assessed.unresolvedAxes.join(" / ")}）`
        + `⇒ 该轴不产生邻居，如实登记，不猜测。`;
      statusReason = statusReason === null ? suffix : `${statusReason} ${suffix}`;
    }
  }

  // 离散度样本 = 基准自身 + 有效邻居（均要求有交易活动；规格 §11）。
  const dispersionSamples: RobustnessMetricsSnapshot[] = [metrics];
  for (const neighbor of neighborhood.neighbors) {
    if (neighbor.availability === "VALID" && neighbor.metrics !== null) {
      dispersionSamples.push(neighbor.metrics);
    }
  }

  const draft: Omit<SearchRobustnessResult, "fingerprint"> = {
    recordKind: SEARCH_ROBUSTNESS_RESULT_RECORD_KIND,
    recordVersion: SEARCH_ROBUSTNESS_RESULT_RECORD_VERSION,
    robustnessRunId: input.robustnessRunId,
    sourceSearchRunId: input.sourceSearchRunId,
    parameterHash: combination.parameterHash,
    combinationIndex: combination.combinationIndex,
    parameters: { ...combination.parameters },
    metrics,
    metricsSource: input.metricsSource,
    status,
    stable: status === "STABLE",
    stabilityRatio: neighborhood.stabilityRatio,
    stableNeighborCount: neighborhood.stableNeighborCount,
    validNeighborCount: neighborhood.validNeighborCount,
    expectedNeighborCount: neighborhood.expectedNeighborCount,
    presentNeighborCount: neighborhood.presentNeighborCount,
    neighborhoodIncomplete: neighborhood.presentNeighborCount < neighborhood.expectedNeighborCount,
    statusReason,
    neighbors: neighborhood.neighbors,
    dispersion: computeDispersion(dispersionSamples),
    sensitivity: [],
  };

  // 敏感性按轴归并（每轴一条），保证「一次只改一个参数」的归因结构。
  const sensitivity = input.axes.map((axis) =>
    summarizeParameterSensitivity({
      axis,
      entries: sensitivityEntries.filter((entry) => entry.axis === axis.parameter),
    }),
  );

  const withSensitivity = { ...draft, sensitivity };
  return {
    ...withSensitivity,
    fingerprint: computeSearchRobustnessResultFingerprint(withSensitivity),
  };
}
