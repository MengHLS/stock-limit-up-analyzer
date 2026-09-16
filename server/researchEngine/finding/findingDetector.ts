/**
 * RESEARCH-FINDING-001 B4 —— Finding 探测器（**确定性，非 LLM**，任务书 §4）。
 *
 * 一次只处理**一个 Analysis 的 Result 序列**，产出 0..N 个 `FindingDraft`。
 * 「0 个」是**合法且常见**的结果 —— 任务书 §27 要求如实显示「没有发现」，不得为演示造数。
 *
 * 覆盖（任务书 §6–§12 的六类证据）：
 *   QUANTILE      → §9 单调 / 峰 / 谷 → MONOTONIC_RELATION / PEAK_RELATION / VALLEY_RELATION
 *                                    （分组退化时降级为 EFFECT，**不硬判顺序**）
 *   CONDITIONAL   → §6 + §8 效应与**真实**基准 → EFFECT
 *   EVENT_STUDY   → §10 视界一致性           → HORIZON_PATTERN
 *   STABILITY     → §11 时间（及其他切片）稳定性 → STABILITY
 *   （§12 条件组合由 `findingInteractionAnalyzer` 处理 —— 它需要**跨分析**的 Result 与条件行）
 *
 * 🔴 只读 Result（`AnalysisSeries`），**绝不触碰 Dataset**（任务书 §28）。
 * 🔴 材料性闸门（`materialityAbs`）：差异不达阈值 ⇒ **不产出 Finding**（宁可没有发现）。
 * 🔴 不写 `status`：草稿一律由 Scorer 落 `DISCOVERED`（引擎无权宣布 SUPPORTED）。
 */

import { createHash } from "node:crypto";

import type {
  FindingPolicy,
  ResearchFindingEffect,
  ResearchFindingSample,
  ResearchMonotonicityPattern,
} from "../../researchCore";
import { classifySampleGrade } from "../../researchCore";
import { spearmanCorrelation } from "../../../shared/quant-stats";
import { directionConsistency } from "../metrics";
import { FindingStabilityAnalyzer } from "./findingStabilityAnalyzer";
import { isStrictlyIncreasing } from "./resultView";
import type { AnalysisSeries, FindingDraft, OrderedBucket } from "./types";

// ---------------------------------------------------------------------------
// 基准索引（跨分析的真实「全样本」行）
// ---------------------------------------------------------------------------

/**
 * 基准引用（任务书 §8 的 `groupReturn / benchmarkReturn / excessReturn` 三件套之「基准」）。
 *
 * 🔴 **只认真实 Result 行**。绝不拿「分档均值的平均」之类算出来的数字冒充基准
 *    （审计报告 §5.2：引擎只产 `DIFFERENCE`，无 benchmark 概念 ⇒ 取不到就如实标 `benchmarkUnavailable`）。
 */
export interface BaselineRef {
  metricValue: number | null;
  sampleCount: number | null;
  resultIds: number[];
  /** 来源标识（人读可回溯，如 `descriptive:analysis=570009.variable=future_return_5d`）。 */
  source: string;
}

/**
 * 从同一 Run 的所有序列里建立「变量名 → 全样本均值」索引。
 *
 * 真库实测来源（`docs/evidence/_probe_finding_result_shapes.out.txt`）：
 *   - DESCRIPTIVE：`dimension = { variable: "future_return_5d" }` + `metricCode = MEAN`；
 *   - STABILITY / CONDITIONAL：`dimension = { <key>: "ALL" }` + `metricCode = MEAN_RETURN`。
 * 两者已实测**数值一致**（`0.015210360880304351`）⇒ 该基准是真实且可交叉验证的。
 */
export function buildBaselineIndex(seriesList: readonly AnalysisSeries[]): Map<string, BaselineRef> {
  const index = new Map<string, BaselineRef>();
  const put = (key: string, ref: BaselineRef): void => {
    // 先到先得（引擎按「DESCRIPTIVE 优先」的顺序传入）。
    if (!index.has(key)) index.set(key, ref);
  };

  for (const series of seriesList) {
    if (series.analysisType === "DESCRIPTIVE") {
      for (const b of series.buckets) {
        if (b.metricValue === null) continue;
        put(String(b.rawLabel), {
          metricValue: b.metricValue,
          sampleCount: b.sampleCount,
          resultIds: b.resultIds,
          source: `descriptive:analysis=${series.analysisId}.variable=${String(b.rawLabel)}`,
        });
      }
      continue;
    }
    if (series.benchmark !== null && series.benchmark.metricValue !== null && series.target !== null) {
      put(series.target, {
        metricValue: series.benchmark.metricValue,
        sampleCount: series.benchmark.sampleCount,
        resultIds: series.benchmark.resultIds,
        source: `${series.analysisType.toLowerCase()}:analysis=${series.analysisId}.ALL`,
      });
    }
  }
  return index;
}

/** 引擎传入的检测上下文。 */
export interface DetectContext {
  baselines: Map<string, BaselineRef>;
  policy: FindingPolicy;
}

// ---------------------------------------------------------------------------
// 形态判定（§9）
// ---------------------------------------------------------------------------

export interface PatternResult {
  pattern: ResearchMonotonicityPattern;
  /** 反转位置（0 起，对应 buckets 下标）；仅 PEAK / VALLEY 有值。 */
  reversalIndex: number | null;
}

/** 相邻差分全正 / 全负 / 内部极值 → 单调 / 峰 / 谷 / 无。 */
export function detectPattern(values: readonly number[]): PatternResult {
  if (values.length < 3) return { pattern: "NONE", reversalIndex: null };
  let increasing = true;
  let decreasing = true;
  for (let i = 1; i < values.length; i += 1) {
    if (!(values[i]! > values[i - 1]!)) increasing = false;
    if (!(values[i]! < values[i - 1]!)) decreasing = false;
  }
  if (increasing) return { pattern: "MONOTONIC_INCREASING", reversalIndex: null };
  if (decreasing) return { pattern: "MONOTONIC_DECREASING", reversalIndex: null };

  let maxIdx = 0;
  let minIdx = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i]! > values[maxIdx]!) maxIdx = i;
    if (values[i]! < values[minIdx]!) minIdx = i;
  }
  if (maxIdx > 0 && maxIdx < values.length - 1) return { pattern: "PEAK", reversalIndex: maxIdx };
  if (minIdx > 0 && minIdx < values.length - 1) return { pattern: "VALLEY", reversalIndex: minIdx };
  return { pattern: "NONE", reversalIndex: null };
}

/** 有序档位上的秩相关（§9；秩相关实现走 `shared/quant-stats`，全仓唯一）。 */
function rankCorrelationOf(values: readonly number[]): number | null {
  if (values.length < 3) return null;
  const r = spearmanCorrelation(values.map((_, i) => i), [...values]);
  return r === null || !Number.isFinite(r) ? null : r;
}

// ---------------------------------------------------------------------------
// 公共小工具
// ---------------------------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 有限档位值（保序）。 */
function finitePairs(buckets: readonly OrderedBucket[]): Array<{ bucket: OrderedBucket; value: number }> {
  const out: Array<{ bucket: OrderedBucket; value: number }> = [];
  for (const b of buckets) {
    if (b.metricValue !== null && Number.isFinite(b.metricValue)) out.push({ bucket: b, value: b.metricValue });
  }
  return out;
}

/** 最薄档位的样本数（保守：关系由全部档位共同支撑）。 */
function minBucketSample(buckets: readonly OrderedBucket[]): number | null {
  const counts = buckets
    .map((b) => b.sampleCount)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  if (counts.length === 0) return null;
  return Math.min(...counts);
}

/** §7 样本充分性（阈值**配置化**，快照进 Finding，可复核）。 */
function sampleSection(sampleCount: number | null, policy: FindingPolicy): ResearchFindingSample | null {
  if (sampleCount === null) return null;
  return {
    sampleCount,
    grade: classifySampleGrade(sampleCount, policy),
    thresholds: { weak: policy.sampleWeak, medium: policy.sampleMedium, strong: policy.sampleStrong },
  };
}

/** 统一的局限清单（Finding 必须自带局限，不许只报喜）。 */
function baseLimitations(policy: FindingPolicy): string[] {
  return [
    "本发现来自既有 Analysis 的**统计结果层**，非样本级重算；未做多重比较校正。",
    "事件样本存在**重叠视界**，独立性假设不严格成立；t / p 类统计仅作研究辅助。",
    `材料性阈值 materialityAbs=${policy.materialityAbs}；样本分级阈值 ${policy.sampleWeak}/${policy.sampleMedium}/${policy.sampleStrong}（可配置、可复核）。`,
  ];
}

/** 确定性指纹（幂等键；同 Run 重复 detect 不产生重复行）。 */
export function buildFingerprint(parts: {
  runId: number;
  findingType: string;
  primaryAnalysisId: number | null;
  dimension: Record<string, string | number> | null;
}): string {
  const dim =
    parts.dimension === null
      ? null
      : Object.keys(parts.dimension)
          .sort()
          .map((k) => [k, parts.dimension![k]]);
  const canonical = JSON.stringify([parts.runId, parts.findingType, parts.primaryAnalysisId, dim]);
  return createHash("sha1").update(canonical, "utf8").digest("hex");
}

/** 目标变量名（找不到就如实写「目标变量」，不编造）。 */
function targetLabelOf(series: AnalysisSeries): string {
  return series.target ?? str(series.meta["outcomeVariable"]) ?? "目标变量";
}

function dedupe(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

/** 分析级 evidence 通用字段（Result 行数 —— 用来证明「只消费 Result」）。 */
function provenanceOf(series: AnalysisSeries): { analysisId: number; resultRowCount: number; resultIds: number[] } {
  return {
    analysisId: series.analysisId,
    resultRowCount: series.allResultIds.length,
    resultIds: series.allResultIds,
  };
}

// ---------------------------------------------------------------------------
// §6/§8/§9 —— QUANTILE（分档关系）
// ---------------------------------------------------------------------------

function detectQuantile(series: AnalysisSeries, ctx: DetectContext): FindingDraft[] {
  const { policy, baselines } = ctx;
  const pairs = finitePairs(series.buckets);
  if (pairs.length < 2) return [];

  const values = pairs.map((p) => p.value);
  const spread = Math.max(...values) - Math.min(...values);

  // ---- 退化分组守卫（真库实测：0/1 特征 × 10 分位 ⇒ cutPoints 全 0）----
  const cutPoints = series.meta["cutPoints"];
  const degenerate = Array.isArray(cutPoints) && !isStrictlyIncreasing(cutPoints as number[]);
  const actualGroups = num(series.meta["actualGroups"]);
  const requestedGroups = num(series.meta["requestedGroups"]);
  const groupShrunk = actualGroups !== null && requestedGroups !== null && actualGroups < requestedGroups;
  const unusableOrder = degenerate || groupShrunk;

  const shape = unusableOrder ? { pattern: "NONE" as ResearchMonotonicityPattern, reversalIndex: null } : detectPattern(values);
  const enoughForOrder = values.length >= policy.monotonicMinBuckets;

  // ---- 基准：QUANTILE 自身没有全样本行 ⇒ 只能借同 Run 的描述统计 / 稳定性行 ----
  const featureName = str(series.meta["featureVariable"]) ?? "特征";
  const target = targetLabelOf(series);
  const baseline = baselines.get(target) ?? null;
  const benchmarkReturn = baseline?.metricValue ?? null;

  const extremumIndex = pickExtremumIndex(values, benchmarkReturn, shape.pattern, shape.reversalIndex);
  const chosen = pairs[extremumIndex]!;
  const excess = benchmarkReturn === null ? null : chosen.value - benchmarkReturn;

  // ---- 材料性闸门（不达阈值 ⇒ 没有发现）----
  const effectiveAbs = excess === null ? spread : Math.abs(excess);
  if (!(effectiveAbs >= policy.materialityAbs)) return [];

  const canClaimOrder = enoughForOrder && !unusableOrder && shape.pattern !== "NONE";
  const findingType = !canClaimOrder
    ? ("EFFECT" as const)
    : shape.pattern === "MONOTONIC_INCREASING" || shape.pattern === "MONOTONIC_DECREASING"
      ? ("MONOTONIC_RELATION" as const)
      : shape.pattern === "PEAK"
        ? ("PEAK_RELATION" as const)
        : ("VALLEY_RELATION" as const);

  const limitations = baseLimitations(policy);
  if (unusableOrder) {
    limitations.push(
      `⚠️ 分组退化：${degenerate ? "切点非严格递增" : `实际分组数 ${actualGroups} 少于请求的 ${requestedGroups}`}`
        + "，档位顺序**不代表特征量级**，故不判定单调 / 峰谷关系，只报告极值档位的差异。",
    );
  }
  if (baseline === null) {
    limitations.push("无可用基准（同 Run 内没有覆盖该目标变量的全样本统计）⇒ 只报告档位间差异，不报告超额收益。");
  }
  if (!enoughForOrder) {
    limitations.push(`有效档位仅 ${values.length} 个（< ${policy.monotonicMinBuckets}），不足以判定单调性。`);
  }
  if (chosen.bucket.sampleCount !== null && chosen.bucket.sampleCount < policy.sampleMedium) {
    limitations.push(`极值档位样本 ${chosen.bucket.sampleCount} 低于 ${policy.sampleMedium}，效应量稳定性存疑。`);
  }

  const effect: ResearchFindingEffect = {
    groupReturn: chosen.value,
    benchmarkReturn,
    excessReturn: excess,
    benchmarkUnavailable: benchmarkReturn === null,
    benchmarkSource: baseline?.source ?? "unavailable",
    medianReturn: chosen.bucket.medianReturn,
    winRate: chosen.bucket.winRate,
    buckets: series.buckets.map((b) => ({
      label: b.label,
      metricValue: b.metricValue,
      sampleCount: b.sampleCount,
    })),
  };

  const dimension: Record<string, string | number> = {
    dimensionKey: series.dimensionKey,
    feature: featureName,
    bucketCount: values.length,
  };
  if (canClaimOrder) dimension["extremeBucket"] = chosen.bucket.label;

  return [
    {
      findingType,
      title: buildQuantileTitle({ findingType, featureName, target, pattern: shape.pattern, bucket: chosen.bucket }),
      summary:
        `${featureName} 的 ${values.length} 个分档在 ${target} 上极值差 ${spread.toFixed(4)}`
        + (benchmarkReturn === null ? "" : `；极值档超额 ${excess === null ? "不可算" : excess.toFixed(4)}`)
        + `。证据来自 ${series.allResultIds.length} 行 Result。`,
      target: series.target,
      dimension,
      primaryAnalysisId: series.analysisId,
      sourceResultIds: dedupe([...series.allResultIds]),
      effect,
      sample: sampleSection(canClaimOrder ? minBucketSample(series.buckets) : chosen.bucket.sampleCount, policy),
      horizon: null,
      stability: null,
      monotonicity:
        canClaimOrder
          ? {
              pattern: shape.pattern,
              reversalAt: shape.reversalIndex === null ? null : pairs[shape.reversalIndex]!.bucket.label,
              buckets: series.buckets.map((b) => ({
                label: b.label,
                metricValue: b.metricValue,
                sampleCount: b.sampleCount,
              })),
              rankCorrelation: rankCorrelationOf(values),
            }
          : null,
      interaction: null,
      limitations,
      evidence: {
        detector: "QUANTILE",
        featureVariable: featureName,
        outcomeVariable: target,
        groupingRule: str(series.meta["groupingRule"]),
        cutPoints: Array.isArray(cutPoints) ? cutPoints : null,
        requestedGroups,
        actualGroups,
        degenerateGrouping: unusableOrder,
        bucketCount: values.length,
        spread,
        extremeBucket: chosen.bucket.label,
        extremeBucketRange: chosen.bucket.rangeText,
        extremumSelectionRule:
          "单调 ⇒ 末端档位；峰/谷 ⇒ 反转档位；其余 ⇒ 偏离基准最大（无基准则绝对值最大）者。规则写死，非事后挑选。",
        benchmarkSource: baseline?.source ?? null,
        pattern: shape.pattern,
        ...provenanceOf(series),
      },
      fingerprint: buildFingerprint({
        runId: 0, // 由引擎回填（探测器不持有 runId）
        findingType,
        primaryAnalysisId: series.analysisId,
        dimension,
      }),
    },
  ];
}

/** 极值档位选择规则（**写死并进证据**，避免「按效应大小事后挑选」）。 */
function pickExtremumIndex(
  values: readonly number[],
  benchmark: number | null,
  pattern: ResearchMonotonicityPattern,
  reversalIndex: number | null,
): number {
  if (pattern === "MONOTONIC_INCREASING") return values.length - 1;
  if (pattern === "MONOTONIC_DECREASING") return 0;
  if (pattern === "PEAK" && reversalIndex !== null) return reversalIndex;
  if (pattern === "VALLEY" && reversalIndex !== null) return reversalIndex;
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < values.length; i += 1) {
    const score = benchmark === null ? Math.abs(values[i]!) : Math.abs(values[i]! - benchmark);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function buildQuantileTitle(args: {
  findingType: FindingDraft["findingType"];
  featureName: string;
  target: string;
  pattern: ResearchMonotonicityPattern;
  bucket: OrderedBucket;
}): string {
  const { findingType, featureName, target, pattern, bucket } = args;
  if (findingType === "MONOTONIC_RELATION") {
    const dir = pattern === "MONOTONIC_INCREASING" ? "单调上升" : "单调下降";
    return `${featureName} 分档与 ${target} 存在${dir}关系`;
  }
  if (findingType === "PEAK_RELATION") {
    return `${featureName} 分档与 ${target} 呈「先升后反转」形态（峰值出现在 ${bucket.label}）`;
  }
  if (findingType === "VALLEY_RELATION") {
    return `${featureName} 分档与 ${target} 呈「先降后回升」形态（谷值出现在 ${bucket.label}）`;
  }
  return `${featureName} 的 ${bucket.label} 档位在 ${target} 上与其他档位存在明显差异`;
}

// ---------------------------------------------------------------------------
// §6/§8 —— CONDITIONAL（条件效应 + 真实基准）
// ---------------------------------------------------------------------------

function detectConditional(series: AnalysisSeries, ctx: DetectContext): FindingDraft[] {
  const { policy } = ctx;
  const condition = series.buckets[0];
  if (condition === undefined || condition.metricValue === null) return [];

  const benchmarkReturn = series.benchmark?.metricValue ?? null;
  const storedDiff = series.scalars.get("DIFFERENCE")?.metricValue ?? null;
  const excess = storedDiff ?? (benchmarkReturn === null ? null : condition.metricValue - benchmarkReturn);
  if (excess === null || !(Math.abs(excess) >= policy.materialityAbs)) return [];

  const target = targetLabelOf(series);
  const rule = str(series.meta["conditionRule"]) ?? "(未登记条件表达式)";
  const conditionSample = condition.sampleCount;

  const limitations = baseLimitations(policy);
  limitations.push("条件组与全样本**并非独立样本**（条件组是全样本的子集），组间检验的独立性假设不严格成立。");
  if (conditionSample !== null && conditionSample < policy.sampleWeak) {
    limitations.push(`条件组样本 ${conditionSample} 低于 ${policy.sampleWeak}（INSUFFICIENT），效应量不可靠。`);
  }
  limitations.push("该条件是否构成**可交易**信号尚未验证：本阶段只回答「值得进一步研究」（任务书 §14/§26）。");

  const effect: ResearchFindingEffect = {
    groupReturn: condition.metricValue,
    benchmarkReturn,
    excessReturn: excess,
    benchmarkUnavailable: benchmarkReturn === null,
    benchmarkSource:
      series.benchmark === null
        ? "unavailable"
        : `in-analysis:analysis=${series.analysisId}.group=${series.benchmark.label}`,
    medianReturn: condition.medianReturn,
    winRate: condition.winRate,
    buckets: [
      ...(series.benchmark === null
        ? []
        : [
            {
              label: series.benchmark.label,
              metricValue: series.benchmark.metricValue,
              sampleCount: series.benchmark.sampleCount,
            },
          ]),
      { label: condition.label, metricValue: condition.metricValue, sampleCount: condition.sampleCount },
    ],
  };

  const dimension: Record<string, string | number> = {
    dimensionKey: series.dimensionKey,
    conditionRule: rule,
    conditionCount: num(series.meta["conditionCount"]) ?? 0,
  };

  const findingType = "EFFECT" as const;
  return [
    {
      findingType,
      title: `满足条件「${rule}」的样本在 ${target} 上优于全样本（超额 ${excess.toFixed(4)}）`,
      summary:
        `条件组均值 ${condition.metricValue.toFixed(4)} vs 全样本 ${benchmarkReturn === null ? "不可用" : benchmarkReturn.toFixed(4)}；`
        + `条件组样本 ${conditionSample ?? "未知"}，全样本 ${series.benchmark?.sampleCount ?? "未知"}。`,
      target: series.target,
      dimension,
      primaryAnalysisId: series.analysisId,
      sourceResultIds: dedupe([...series.allResultIds]),
      effect,
      sample: sampleSection(conditionSample, policy),
      horizon: null,
      stability: null,
      monotonicity: null,
      interaction: null,
      limitations,
      evidence: {
        detector: "CONDITIONAL",
        conditionRule: rule,
        conditionSampleCount: num(series.meta["conditionSampleCount"]),
        totalSampleCount: num(series.meta["totalSampleCount"]),
        differenceSource: storedDiff === null ? "computed-from-group-means" : "stored-DIFFERENCE-result",
        relativeDifference: series.scalars.get("RELATIVE_DIFFERENCE")?.metricValue ?? null,
        tStat: series.scalars.get("T_STAT_DIFFERENCE")?.metricValue ?? null,
        pValue: series.scalars.get("P_VALUE_DIFFERENCE")?.metricValue ?? null,
        ...provenanceOf(series),
      },
      fingerprint: buildFingerprint({ runId: 0, findingType, primaryAnalysisId: series.analysisId, dimension }),
    },
  ];
}

// ---------------------------------------------------------------------------
// §10 —— EVENT_STUDY（视界一致性）
// ---------------------------------------------------------------------------

function detectEventStudy(series: AnalysisSeries, ctx: DetectContext): FindingDraft[] {
  const { policy } = ctx;
  const pairs = finitePairs(series.buckets);
  if (pairs.length < 2) return [];

  const horizons = pairs.map((p) => Number(p.bucket.rawLabel));
  if (horizons.some((h) => !Number.isFinite(h))) return [];
  const values = pairs.map((p) => p.value);

  // 峰值视界 = |均值| 最大者（规则写死并进证据）。
  let peakIdx = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (Math.abs(values[i]!) > Math.abs(values[peakIdx]!)) peakIdx = i;
  }
  const peakHorizon = horizons[peakIdx]!;
  const peakMagnitude = Math.abs(values[peakIdx]!);
  if (!(peakMagnitude >= policy.materialityAbs)) return [];

  // 有效视界区间：围绕峰值向两侧扩展、|值| ≥ 峰值 × horizonEffectiveRatio 的**连续**区间。
  const threshold = peakMagnitude * policy.horizonEffectiveRatio;
  let lo = peakIdx;
  let hi = peakIdx;
  while (lo - 1 >= 0 && Math.abs(values[lo - 1]!) >= threshold) lo -= 1;
  while (hi + 1 < values.length && Math.abs(values[hi + 1]!) >= threshold) hi += 1;

  const consistency = directionConsistency(values);
  const target = targetLabelOf(series);

  const limitations = baseLimitations(policy);
  limitations.push("本发现描述的是**跨视界的形态**，没有单一基准可比 ⇒ 不报告超额收益（`benchmarkUnavailable`）。");
  limitations.push("视界由 Dataset 的 path 覆盖决定；未覆盖的视界不出现在证据里（不插值、不外推）。");

  const effect: ResearchFindingEffect = {
    groupReturn: values[peakIdx]!,
    benchmarkReturn: null,
    excessReturn: null,
    benchmarkUnavailable: true,
    benchmarkSource: "unavailable:horizon-shape",
    medianReturn: pairs[peakIdx]!.bucket.medianReturn,
    winRate: pairs[peakIdx]!.bucket.winRate,
    buckets: series.buckets.map((b) => ({ label: b.label, metricValue: b.metricValue, sampleCount: b.sampleCount })),
  };

  const dimension: Record<string, string | number> = {
    dimensionKey: series.dimensionKey,
    horizonCount: horizons.length,
    peakHorizon,
  };

  const findingType = "HORIZON_PATTERN" as const;
  return [
    {
      findingType,
      title: `${target} 的效果集中在 T+${horizons[lo]}~T+${horizons[hi]}（峰值 T+${peakHorizon}）`,
      summary:
        `在 ${horizons.length} 个视界上峰值出现在 T+${peakHorizon}（均值 ${values[peakIdx]!.toFixed(4)}）；`
        + `有效区间 T+${horizons[lo]}~T+${horizons[hi]}；跨视界方向一致性 ${consistency === null ? "不可算" : consistency.toFixed(3)}。`,
      target: series.target,
      dimension,
      primaryAnalysisId: series.analysisId,
      sourceResultIds: dedupe([...series.allResultIds]),
      effect,
      sample: sampleSection(minBucketSample(series.buckets), policy),
      horizon: {
        peakHorizon,
        effectiveHorizonRange: [horizons[lo]!, horizons[hi]!],
        directionConsistency: consistency,
        points: horizons.map((h, i) => ({
          horizon: h,
          metricValue: values[i]!,
          sampleCount: pairs[i]!.bucket.sampleCount,
        })),
      },
      stability: null,
      monotonicity: null,
      interaction: null,
      limitations,
      evidence: {
        detector: "EVENT_STUDY",
        selectionRule:
          "峰值视界 = |均值| 最大者；有效区间 = 围绕峰值 |值| ≥ 峰值 × horizonEffectiveRatio 的连续区间（规则写死，非事后挑选）。",
        horizonEffectiveRatio: policy.horizonEffectiveRatio,
        peakMagnitude,
        ...provenanceOf(series),
      },
      fingerprint: buildFingerprint({ runId: 0, findingType, primaryAnalysisId: series.analysisId, dimension }),
    },
  ];
}

// ---------------------------------------------------------------------------
// §11 —— STABILITY（切片稳定性）
// ---------------------------------------------------------------------------

function detectStability(series: AnalysisSeries, ctx: DetectContext): FindingDraft[] {
  const { policy } = ctx;
  const slices = series.buckets.map((b) => ({
    label: b.label,
    metricValue: b.metricValue,
    sampleCount: b.sampleCount,
  }));
  const assessment = FindingStabilityAnalyzer.assess(slices, policy);
  if (assessment === null) return []; // 切片不足 ⇒ 不可评估，**不产出**（不编造「稳定」）

  const dimensionKey = str(series.meta["dimension"]) ?? series.dimensionKey;
  const target = targetLabelOf(series);
  const overall = series.benchmark?.metricValue ?? null;

  const limitations = baseLimitations(policy);
  limitations.push(
    "稳定性发现只回答「方向是否跨切片一致」，**不含效应量大小**（总体均值不得视为稳定效果，任务书 §11）。",
  );
  limitations.push(assessment.note);
  if (assessment.section.contradicted) {
    limitations.push("⚠️ 各切片出现明显方向冲突：该关系**不可**作为稳定规律使用（状态可标 CONTRADICTED）。");
  }

  const dimension: Record<string, string | number> = {
    dimensionKey: series.dimensionKey,
    sliceDimension: dimensionKey,
    sliceCount: assessment.section.slices.length,
  };

  const findingType = "STABILITY" as const;
  const verb = assessment.section.stable
    ? "方向一致"
    : assessment.section.contradicted
      ? "方向明显冲突"
      : "方向不稳定";
  return [
    {
      findingType,
      title: `${target} 在按 ${dimensionKey} 分片的 ${assessment.section.slices.length} 个切片上${verb}`,
      summary: `${assessment.note}；全样本均值 ${overall === null ? "不可用" : overall.toFixed(4)}（仅作参照，不作为稳定性依据）。`,
      target: series.target,
      dimension,
      primaryAnalysisId: series.analysisId,
      sourceResultIds: dedupe([...series.allResultIds]),
      // 稳定性发现**不主张效应量** ⇒ effect 恒为 null（Scorer 因此不给 effect 维打分）。
      effect: null,
      sample: sampleSection(minBucketSample(series.buckets), policy),
      horizon: null,
      stability: assessment.section,
      monotonicity: null,
      interaction: null,
      limitations,
      evidence: {
        detector: "STABILITY",
        sliceDimension: dimensionKey,
        wholeSampleMean: overall,
        wholeSampleResultIds: series.benchmark?.resultIds ?? [],
        consistencyMin: policy.consistencyMin,
        stabilityMinSlices: policy.stabilityMinSlices,
        ...provenanceOf(series),
      },
      fingerprint: buildFingerprint({ runId: 0, findingType, primaryAnalysisId: series.analysisId, dimension }),
    },
  ];
}

// ---------------------------------------------------------------------------
// 对外：探测器集合
// ---------------------------------------------------------------------------

export const FindingDetector = {
  /** 单个序列 → 草稿（**不含** interaction —— 那需要跨分析的 Result 与条件行）。 */
  detect(series: AnalysisSeries, ctx: DetectContext): FindingDraft[] {
    if (!series.assessable) return [];
    switch (series.analysisType) {
      case "QUANTILE":
        return detectQuantile(series, ctx);
      case "CONDITIONAL":
        return detectConditional(series, ctx);
      case "EVENT_STUDY":
        return detectEventStudy(series, ctx);
      case "STABILITY":
        return detectStability(series, ctx);
      default:
        return [];
    }
  },

  /** 批量（保持输入顺序 ⇒ 结果可复现）。 */
  detectAll(seriesList: readonly AnalysisSeries[], ctx: DetectContext): FindingDraft[] {
    const out: FindingDraft[] = [];
    for (const s of seriesList) out.push(...FindingDetector.detect(s, ctx));
    return out;
  },
};
