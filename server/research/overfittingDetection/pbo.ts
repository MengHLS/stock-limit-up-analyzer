/**
 * STEP 20 / C-20.1 — PBO（Probability of Backtest Overfitting）via CSCV。
 *
 * 实现（Combinatorially Symmetric Cross-Validation，Bailey et al.）：
 *   - 把候选的 OOS 时序回报切成 N 个连续分区（N 偶数、>= 4；保持时间顺序，不 shuffle）；
 *   - 生成 C(N, N/2)/2 个去对称重复的 Train/Test 划分；
 *   - 每个划分：按 Train 表现对所有候选排名，取样本内最优；观察其在 Test 上的相对排名；
 *   - 若样本内最优候选落入 Test 表现的「最差一半」（testPercentile >= 0.5）→ 记为一次
 *     overfit 观察；
 *   - PBO = overfitObservations / validObservations，恒满足 0 <= PBO <= 1。
 *
 * ## 与 STEP 6.5 pbo.ts 的区别（诚实声明）
 *   - 本模块的 OfdPboResult **不与 STEP 6.5 的 OfdPboResult 复用**：STEP 6.5 仅做 IS/OOS 倒置
 *     统计 + status="computed|insufficient_data"；本模块在倒置统计基础上加：
 *       · 零分布（per-split 倒置观察的频次分布 + 直方图）；
 *       · 经验分位 + 分位 CI（非 BCa / bootstrap-t，诚实声明）；
 *       · 判定结论 OVERFIT_RISK_HIGH/MODERATE/LOW/INCONCLUSIVE + 原因码；
 *   - 沿用 STEP 6.5 的 CSCV 划分几何（去对称保留含分区 0 的组合）与「同值 tie-break 按
 *     candidateId 字典序」约定；不 import STEP 6.5（避免循环 / 形态耦合）。
 *   - 本模块的 CSCV 划分函数 `generateOfdPboCscvSplits` 与 STEP 6.5 `generateCscvSplits`
 *     输出**完全等价**（N=4 产生 3 个划分 `{1,2}|{3,4}`、`{1,3}|{2,4}`、`{1,4}|{2,3}`），
 *     由单测断言锁定差异。
 *
 * 关键约定（必须可审计）：
 *   - 候选的分区指标 `partitionMetrics[i]`（0-based）为选择指标在第 i 个分区上已评估的
 *     值（null/NaN/Infinity 视为非法，不得参与任何划分的排名）；
 *   - Train / Test 标量 = 涉及分区的指标**算术平均**（各分区等权）；
 *   - 排名方向复用 selectionDirection；同值 tie-break 用 `candidateId` 字典序；
 *   - 「最差一半」判定：testPercentile = (testRank - 1) / (nValid - 1)，
 *     testPercentile >= 0.5 → overfit。
 *
 * 铁律：
 *   - N 非法（奇数 / < 4）→ fail fast 抛错（PBO_BLOCKS_INVALID / PBO_BLOCKS_NOT_EVEN）；
 *   - 候选不足 / 无有效指标 → 返回 status="insufficient_data"、pbo=null，并设置 reasonCode；
 *   - 纯函数、deterministic、不依赖 Database / Network / Date.now / Math.random；
 *   - 拒绝 NaN / Infinity（fail fast，不静默转 0）。
 */

import { mean, percentile, sampleStandardDeviation } from "../../../shared/quant-stats";
import { ResearchValidationError } from "../experimentValidation";
import {
  DEFAULT_PBO_HIGH_THRESHOLD,
  DEFAULT_PBO_MEDIUM_THRESHOLD,
  OFD_PBO_RESULT_RECORD_VERSION,
  type OfdPboCandidate,
  type OfdPboConclusion,
  type OfdPboCscvSplit,
  type OfdPboInsufficientReasonCode,
  type OfdPboInput,
  type OfdPboQuantileCi,
  type OfdPboQuantileSummary,
  type OfdPboResult,
  type OfdPboSelectionDirection,
  type OfdPboSplitResult,
  type OfdPboThresholds,
  type ResolvedOfdPboThresholds,
} from "./types";

// ---------------------------------------------------------------------------
// 阈值解析
// ---------------------------------------------------------------------------

/**
 * 解析 PBO 判定阈值（缺省补齐 + 形态校验；非法 → ResearchValidationError）。
 */
export function resolveOfdPboThresholds(input?: OfdPboThresholds): ResolvedOfdPboThresholds {
  if (input === undefined) {
    return {
      pboHigh: DEFAULT_PBO_HIGH_THRESHOLD,
      pboMedium: DEFAULT_PBO_MEDIUM_THRESHOLD,
    };
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ResearchValidationError([
      { code: "PBO_THRESHOLDS_INVALID", path: "thresholds", message: "thresholds 必须是对象" },
    ]);
  }
  const pboHigh = input.pboHigh ?? DEFAULT_PBO_HIGH_THRESHOLD;
  const pboMedium = input.pboMedium ?? DEFAULT_PBO_MEDIUM_THRESHOLD;
  if (typeof pboHigh !== "number" || !Number.isFinite(pboHigh) || pboHigh < 0 || pboHigh > 1) {
    throw new ResearchValidationError([
      {
        code: "PBO_THRESHOLD_HIGH_INVALID",
        path: "thresholds.pboHigh",
        message: `pboHigh 必须是 [0,1] 的有限数字，收到 ${String(pboHigh)}`,
      },
    ]);
  }
  if (typeof pboMedium !== "number" || !Number.isFinite(pboMedium) || pboMedium < 0 || pboMedium > 1) {
    throw new ResearchValidationError([
      {
        code: "PBO_THRESHOLD_MEDIUM_INVALID",
        path: "thresholds.pboMedium",
        message: `pboMedium 必须是 [0,1] 的有限数字，收到 ${String(pboMedium)}`,
      },
    ]);
  }
  if (pboMedium > pboHigh) {
    throw new ResearchValidationError([
      {
        code: "PBO_THRESHOLDS_ORDER",
        path: "thresholds",
        message: `pboMedium (${pboMedium}) 不能大于 pboHigh (${pboHigh})`,
      },
    ]);
  }
  return { pboHigh, pboMedium };
}

// ---------------------------------------------------------------------------
// CSCV 划分生成（与 STEP 6.5 pbo.ts generateCscvSplits 等价，独立实现）
// ---------------------------------------------------------------------------

/** 生成 0..n-1 中大小为 k 的全部组合（升序、确定性）。 */
function combinations(n: number, k: number): number[][] {
  const result: number[][] = [];
  const current: number[] = [];
  const backtrack = (start: number): void => {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i <= n - (k - current.length); i++) {
      current.push(i);
      backtrack(i + 1);
      current.pop();
    }
  };
  backtrack(0);
  return result;
}

/**
 * 生成去对称重复的 CSCV 划分。
 *
 * 枚举所有 C(N, N/2) 个 Train 组合；其补集为 Test。对称对 (A,B) 与 (B,A) 只保留
 * 「含分区 1」的那个（等价于 combo 包含 0-based 分区 0），恰好去重一半。
 *
 *   N=4 → 3 划分（与 STEP 6.5 一致）：{1,2}|{3,4}、{1,3}|{2,4}、{1,4}|{2,3}
 *   N=6 → C(6,3)/2 = 10 划分。
 */
export function generateOfdPboCscvSplits(numPartitions: number): OfdPboCscvSplit[] {
  if (!Number.isInteger(numPartitions) || numPartitions < 4) {
    throw new ResearchValidationError([
      {
        code: "PBO_BLOCKS_INVALID",
        path: "numPartitions",
        message: `PBO 分区数必须 >= 4 且为整数，实际 ${String(numPartitions)}`,
      },
    ]);
  }
  if (numPartitions % 2 !== 0) {
    throw new ResearchValidationError([
      {
        code: "PBO_BLOCKS_NOT_EVEN",
        path: "numPartitions",
        message: `PBO 分区数必须是偶数，实际 ${numPartitions}`,
      },
    ]);
  }

  const k = numPartitions / 2;
  const combos = combinations(numPartitions, k);
  const all = Array.from({ length: numPartitions }, (_, i) => i);
  const splits: OfdPboCscvSplit[] = [];

  for (const combo of combos) {
    const comboSet = new Set(combo);
    const complement = all.filter((i) => !comboSet.has(i));
    // 只保留「含分区 0」的组合，去对称重复。
    if (combo[0] !== 0) continue;
    splits.push({
      trainPartitions: combo.map((i) => i + 1),
      testPartitions: complement.map((i) => i + 1),
    });
  }

  return splits;
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 候选在指定分区（0-based）上的指标算术平均；任一非法值 → null。 */
function meanOverPartitions(
  metrics: readonly (number | null)[],
  indices: readonly number[],
): number | null {
  let sum = 0;
  for (const index of indices) {
    const value = metrics[index];
    if (!isFiniteNumber(value)) return null;
    sum += value;
  }
  return sum / indices.length;
}

/** 按指标排名（best first），同值 tie-break candidateId 字典序。返回 id 序列。 */
function rankByMetric(
  entries: ReadonlyArray<{ readonly candidateId: string; readonly metric: number }>,
  direction: OfdPboSelectionDirection,
): string[] {
  const sorted = [...entries].sort((left, right) => {
    if (left.metric !== right.metric) {
      return direction === "maximize" ? right.metric - left.metric : left.metric - right.metric;
    }
    return left.candidateId.localeCompare(right.candidateId);
  });
  return sorted.map((entry) => entry.candidateId);
}

// ---------------------------------------------------------------------------
// 零分布统计
// ---------------------------------------------------------------------------

/** 计算过拟合率（0~1）的经验分位摘要。空样本 → null。 */
function summarizeQuantile(values: readonly number[]): OfdPboQuantileSummary | null {
  if (values.length === 0) return null;
  const finite = values.filter((v): v is number => isFiniteNumber(v));
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const meanValue = mean(finite);
  const stdDev = sampleStandardDeviation(finite);
  if (meanValue === null || stdDev === null) return null;

  const pct = (p: number): number => {
    const v = percentile(finite, p);
    return v === null ? meanValue : v;
  };

  return {
    count: finite.length,
    mean: meanValue,
    stdDev,
    min,
    max,
    p05: pct(5),
    p25: pct(25),
    median: pct(50),
    p75: pct(75),
    p95: pct(95),
  };
}

/**
 * 计算 PBO 零分布（per-split 的 testPercentile 频次分布 + 直方图）。
 *
 * 直方图固定 10 个 bin，每个 bin 宽度 0.1（覆盖 [0, 1]）；落入下边界 x ∈ [0, 1) 的样本
 * 进入 bin = floor(x * 10)；testPercentile === 1.0 落入最后一 bin（闭区间）。
 */
function computeZeroDistribution(
  splitResults: readonly OfdPboSplitResult[],
): {
  readonly zeroDistribution: import("./types").OfdPboZeroDistribution;
} {
  const percentiles: number[] = [];
  for (const split of splitResults) {
    if (split.testPercentile !== null) percentiles.push(split.testPercentile);
  }
  const histogram = new Array<number>(10).fill(0);
  for (const p of percentiles) {
    let idx = Math.floor(p * 10);
    if (idx < 0) idx = 0;
    if (idx > 9) idx = 9;
    histogram[idx]! += 1;
  }
  const overfitCount = splitResults.filter((s) => s.isOverfit).length;
  const evaluated = splitResults.length;
  const quantiles = summarizeQuantile(percentiles);
  const zeroDistribution = {
    overfitCount,
    evaluatedCombinations: evaluated,
    overfitRate: evaluated === 0 ? 0 : overfitCount / evaluated,
    quantiles,
    histogram,
  };
  return { zeroDistribution };
}

/** 分位置信区间（百分位 CI；非 BCa / bootstrap-t）。 */
function computeQuantileCi(
  splitResults: readonly OfdPboSplitResult[],
  confidenceLevel: number,
): OfdPboQuantileCi {
  if (confidenceLevel <= 0 || confidenceLevel >= 1 || !Number.isFinite(confidenceLevel)) {
    throw new ResearchValidationError([
      {
        code: "PBO_CI_LEVEL_INVALID",
        path: "confidenceLevel",
        message: `confidenceLevel 必须在 (0, 1)，实际 ${String(confidenceLevel)}`,
      },
    ]);
  }
  const percentiles: number[] = [];
  for (const split of splitResults) {
    if (split.testPercentile !== null) percentiles.push(split.testPercentile);
  }
  if (percentiles.length === 0) {
    return { confidenceLevel, lower: null, upper: null };
  }
  const alpha = (1 - confidenceLevel) / 2;
  const lowerP = percentile(percentiles, alpha * 100);
  const upperP = percentile(percentiles, (1 - alpha) * 100);
  return {
    confidenceLevel,
    lower: lowerP,
    upper: upperP,
  };
}

// ---------------------------------------------------------------------------
// 判定结论
// ---------------------------------------------------------------------------

function deriveConclusion(
  pbo: number | null,
  thresholds: ResolvedOfdPboThresholds,
): OfdPboConclusion {
  if (pbo === null) return "INCONCLUSIVE";
  if (pbo >= thresholds.pboHigh) return "OVERFIT_RISK_HIGH";
  if (pbo >= thresholds.pboMedium) return "OVERFIT_RISK_MODERATE";
  return "OVERFIT_RISK_LOW";
}

// ---------------------------------------------------------------------------
// 输入校验
// ---------------------------------------------------------------------------

function assertInputValid(input: OfdPboInput): void {
  if (!input || typeof input !== "object" || !Array.isArray(input.candidates)) {
    throw new ResearchValidationError([
      { code: "PBO_INPUT_INVALID", path: "input", message: "PBO 输入缺失或 candidates 非数组" },
    ]);
  }
  if (input.metric !== "totalReturnPct" && input.metric !== "sharpeRatio" && input.metric !== "custom") {
    throw new ResearchValidationError([
      { code: "PBO_METRIC_INVALID", path: "metric", message: `非法 metric：${String(input.metric)}` },
    ]);
  }
  if (input.direction !== "maximize" && input.direction !== "minimize") {
    throw new ResearchValidationError([
      { code: "PBO_DIRECTION_INVALID", path: "direction", message: `非法 direction：${String(input.direction)}` },
    ]);
  }
  if (!Number.isInteger(input.numPartitions) || input.numPartitions < 4) {
    throw new ResearchValidationError([
      {
        code: "PBO_BLOCKS_INVALID",
        path: "numPartitions",
        message: `PBO 分区数必须 >= 4 且为整数，实际 ${String(input.numPartitions)}`,
      },
    ]);
  }
  if (input.numPartitions % 2 !== 0) {
    throw new ResearchValidationError([
      {
        code: "PBO_BLOCKS_NOT_EVEN",
        path: "numPartitions",
        message: `PBO 分区数必须是偶数，实际 ${input.numPartitions}`,
      },
    ]);
  }
}

// ---------------------------------------------------------------------------
// 指纹
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";

function computeOfdPboResultFingerprint(body: Omit<OfdPboResult, "fingerprint">): string {
  return createHash("sha256").update(canonicalStringify(body), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 计算 PBO（纯函数、确定性）。
 *
 * 数据不足（候选 < 2 / 所有划分都因有效候选 < 2 被跳过 / 输入非法）→ 返回
 * status="insufficient_data"、pbo=null + 精确 reasonCode；N 非法在调用前 fail fast 抛错。
 */
export function computeOfdPbo(input: OfdPboInput): OfdPboResult {
  assertInputValid(input);

  // 复用阈值（缺省 = DEFAULT_PBO_HIGH/MEDIUM_THRESHOLD）。
  // thresholds 不参与指纹，因为它们只是评估口径，不影响数据本身的 CSCV 数学。
  const thresholds = resolveOfdPboThresholds();

  const splits = generateOfdPboCscvSplits(input.numPartitions);

  // 指纹基体（不含 fingerprint 字段），status / pbo 等占位随后填。
  const baseBody = {
    numPartitions: input.numPartitions,
    numCombinations: splits.length,
    evaluatedCombinations: 0,
    overfitCount: 0,
    pbo: null as number | null,
    status: "insufficient_data" as const,
    metric: input.metric,
    direction: input.direction,
    zeroDistribution: null as import("./types").OfdPboZeroDistribution | null,
    quantileCi: null as OfdPboQuantileCi | null,
    conclusion: "INCONCLUSIVE" as OfdPboConclusion,
    reasonCode: null as OfdPboInsufficientReasonCode | null,
    splitResults: [] as readonly OfdPboSplitResult[],
    recordVersion: OFD_PBO_RESULT_RECORD_VERSION,
  };

  // 候选数检查（含 None/空）→ 显式 INSUFFICIENT_CANDIDATES（不抛错、不 PBO=0 冒充）。
  if (input.candidates.length < 2) {
    const reasonCode: OfdPboInsufficientReasonCode = "PBO_INSUFFICIENT_CANDIDATES";
    const fingerprint = computeOfdPboResultFingerprint({
      ...baseBody,
      conclusion: "INCONCLUSIVE",
      reasonCode,
    });
    return {
      ...baseBody,
      conclusion: "INCONCLUSIVE",
      reasonCode,
      fingerprint,
    };
  }

  // 校验每个候选分区指标长度（不合法 → 抛错，编程错误契约）。
  for (const candidate of input.candidates) {
    if (candidate.partitionMetrics.length !== input.numPartitions) {
      throw new ResearchValidationError([
        {
          code: "PBO_PARTITION_METRICS_LENGTH_MISMATCH",
          path: "candidates",
          message: `候选 ${candidate.candidateId} 的分区指标数(${candidate.partitionMetrics.length}) != numPartitions(${input.numPartitions})`,
        },
      ]);
    }
  }

  const splitResults: OfdPboSplitResult[] = [];
  let overfitCount = 0;
  let evaluatedCombinations = 0;

  for (const split of splits) {
    const trainIdx = split.trainPartitions.map((p) => p - 1);
    const testIdx = split.testPartitions.map((p) => p - 1);

    const valid = input.candidates
      .map((candidate) => ({
        candidateId: candidate.candidateId,
        trainMetric: meanOverPartitions(candidate.partitionMetrics, trainIdx),
        testMetric: meanOverPartitions(candidate.partitionMetrics, testIdx),
      }))
      .filter(
        (entry): entry is { candidateId: string; trainMetric: number; testMetric: number } =>
          entry.trainMetric !== null && entry.testMetric !== null,
      );

    if (valid.length < 2) {
      continue; // 无可评估候选 → 该划分不计入（确定性跳过）
    }

    const trainRanked = rankByMetric(
      valid.map((entry) => ({ candidateId: entry.candidateId, metric: entry.trainMetric })),
      input.direction,
    );
    const testRanked = rankByMetric(
      valid.map((entry) => ({ candidateId: entry.candidateId, metric: entry.testMetric })),
      input.direction,
    );
    const selectedCandidateId = trainRanked[0]!;
    const testRank = testRanked.indexOf(selectedCandidateId) + 1;
    const testPercentile = valid.length > 1 ? (testRank - 1) / (valid.length - 1) : null;
    const isOverfit = testPercentile !== null && testPercentile >= 0.5;

    const selected = valid.find((entry) => entry.candidateId === selectedCandidateId)!;
    splitResults.push({
      trainPartitions: [...split.trainPartitions],
      testPartitions: [...split.testPartitions],
      selectedCandidateId,
      trainMetric: selected.trainMetric,
      testRank,
      testPercentile,
      isOverfit,
    });

    evaluatedCombinations += 1;
    if (isOverfit) overfitCount += 1;
  }

  if (evaluatedCombinations === 0) {
    const reasonCode: OfdPboInsufficientReasonCode = "PBO_NO_VALID_SPLIT";
    const fingerprint = computeOfdPboResultFingerprint({
      ...baseBody,
      conclusion: "INCONCLUSIVE",
      reasonCode,
    });
    return {
      ...baseBody,
      conclusion: "INCONCLUSIVE",
      reasonCode,
      fingerprint,
    };
  }

  const pbo = overfitCount / evaluatedCombinations;
  const { zeroDistribution } = computeZeroDistribution(splitResults);
  const quantileCi = computeQuantileCi(splitResults, 0.95);
  const conclusion = deriveConclusion(pbo, thresholds);

  const body: Omit<OfdPboResult, "fingerprint"> = {
    ...baseBody,
    evaluatedCombinations,
    overfitCount,
    pbo,
    status: "computed",
    zeroDistribution,
    quantileCi,
    conclusion,
    reasonCode: null,
    splitResults,
  };
  const fingerprint = computeOfdPboResultFingerprint(body);
  return { ...body, fingerprint };
}
