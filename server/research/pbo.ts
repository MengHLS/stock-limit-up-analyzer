/**
 * STEP 6.5 — Probability of Backtest Overfitting (PBO) via CSCV。
 *
 * 定位（§十七）：PBO 是**研究统计量**，不是策略质量评分。它估计「在大量候选参数中挑选
 * 历史（样本内）最优者，该候选在样本外表现不佳」的概率。绝不做 `PBO → 策略评分` 的映射。
 *
 * 实现（Combinatorially Symmetric Cross-Validation, Bailey et al.）：
 *   - 把候选时间序列切分为 N 个连续分区（N 偶数、>= 4，保持时间顺序，不 shuffle）；
 *   - 生成 C(N, N/2) / 2 个去对称重复的 Train/Test 划分（Train 与 Test 各 N/2 个分区）；
 *   - 每个划分：按 Train 表现对所有候选排名，取样本内最优；观察其在 Test 上的相对排名；
 *   - 若样本内最优候选落入 Test 表现的「最差一半」→ 记为一次 overfit 观察；
 *   - PBO = overfitObservations / validObservations，恒满足 0 <= PBO <= 1。
 *
 * 关键约定（必须可审计，§二十三/§二十五）：
 *   - 候选的分区指标 `partitionMetrics[i]`（0-based）为选择指标在第 i 个分区上已评估的值；
 *     候选要参与某划分的排名，其**全部分区**指标必须为有限数字（null/NaN/Infinity 视为非法，不得排名）；
 *   - Train / Test 标量 = 涉及分区的指标**算术平均**（各分区等权）；
 *   - 排名方向复用 selectionDirection；同值 tie-break 用 `experimentId` 字典序（§二十四，禁止数组序/DB 序/random）；
 *   - 「最差一半」判定：testPercentile = (testRank - 1) / (nValid - 1)，testPercentile >= 0.5 → overfit。
 *
 * 铁律：
 *   - N 非法（奇数 / < 4）→ fail fast 抛错（§八「禁止 N=3 强行计算」）；
 *   - 候选不足 / 无有效指标 → 返回 status="insufficient_data"、pbo=null（§二十六「禁止 catch → PBO=0」）；
 *   - 纯函数、deterministic、不依赖 Database / Network / Date.now / Math.random。
 */

import { createHash } from "node:crypto";
import { ResearchValidationError } from "./experimentValidation";
import type { ResearchParameterSet } from "./types";
import {
  isSelectableMetric,
  isSelectionDirection,
  type SelectionDirection,
  type SelectionMetric,
} from "./validationSelection";

/** CSCV 单个候选：一次参数组合在 N 个分区上的选择指标序列。 */
export interface PboCandidate {
  experimentId: string;
  /** 参数集合（可追溯「这是哪个参数组合」）。 */
  parameterSet: ResearchParameterSet;
  /** 每个分区上的选择指标值（长度 = numPartitions，按时间顺序；null/NaN/Infinity = 非法）。 */
  partitionMetrics: Array<number | null>;
}

/** PBO 输入（复用已有 Sweep/Experiment 结果，不重新执行 Backtest，§二十一）。 */
export interface PboInput {
  /** 分区数 N（偶数、>= 4）。 */
  numPartitions: number;
  /** 候选列表（>= 2，否则 insufficient_data）。 */
  candidates: readonly PboCandidate[];
  selectionMetric: SelectionMetric;
  selectionDirection: SelectionDirection;
}

/** 一个去对称后的 CSCV Train/Test 划分（分区号 1-based，升序）。 */
export interface CscvSplit {
  trainPartitions: number[];
  testPartitions: number[];
}

/** 单个划分的 PBO 审计明细（§二十五 splitResults[]）。 */
export interface PboSplitResult {
  trainPartitions: number[];
  testPartitions: number[];
  /** 样本内（Train）最优候选。 */
  selectedExperimentId: string;
  /** 该候选在 Train 上的标量指标（分区算术平均）。 */
  trainMetric: number;
  /** 该候选在 Train 排名（恒 1，样本内最优）。 */
  trainRank: number;
  /** 该候选在 Test 上的排名（1 = 最优）。 */
  testRank: number;
  /** Test 相对排名：0 = 最优，1 = 最差。 */
  testPercentile: number;
  /** 是否落入 Test 最差一半。 */
  isOverfit: boolean;
}

/** PBO 结果。 */
export interface PboResult {
  numPartitions: number;
  /** 理论去对称划分总数 C(N,N/2)/2。 */
  numCombinations: number;
  /** 实际可评估的划分数（有效候选 >= 2）。 */
  evaluatedCombinations: number;
  /** overfit 观察次数。 */
  overfitCount: number;
  /** overfitCount / evaluatedCombinations；数据不足时为 null。 */
  pbo: number | null;
  status: "computed" | "insufficient_data";
  metric: SelectionMetric;
  direction: SelectionDirection;
  /** canonical fingerprint（覆盖分区数 / 指标 / 方向 / 候选数据）。 */
  fingerprint: string;
  splitResults: PboSplitResult[];
}

// ---------------------------------------------------------------------------
// CSCV 划分生成
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
 * 生成去对称重复的 CSCV 划分（§十九）。
 *
 * 枚举所有 C(N, N/2) 个 Train 组合；其补集为 Test。对称对 (A,B) 与 (B,A) 只保留
 * 「含分区 1」的那个（等价于 combo 包含 0-based 分区 0），恰好去重一半。
 *
 * 对 N=4 产生 3 个划分（与 §十九 完全一致）：
 *   {1,2}|{3,4}、{1,3}|{2,4}、{1,4}|{2,3}
 */
export function generateCscvSplits(numPartitions: number): CscvSplit[] {
  if (!Number.isInteger(numPartitions) || numPartitions < 4) {
    throw new ResearchValidationError([
      { code: "CSCV_PARTITIONS_TOO_SMALL", path: "numPartitions", message: `CSCV 分区数必须 >= 4，实际 ${numPartitions}` },
    ]);
  }
  if (numPartitions % 2 !== 0) {
    throw new ResearchValidationError([
      { code: "CSCV_PARTITIONS_ODD", path: "numPartitions", message: `CSCV 分区数必须是偶数，实际 ${numPartitions}` },
    ]);
  }

  const k = numPartitions / 2;
  const combos = combinations(numPartitions, k);
  const all = Array.from({ length: numPartitions }, (_, i) => i);
  const splits: CscvSplit[] = [];

  for (const combo of combos) {
    const comboSet = new Set(combo);
    const complement = all.filter((i) => !comboSet.has(i));
    // 只保留「含分区 0」的组合，去对称重复（§十九）。
    if (combo[0] !== 0) continue;
    splits.push({
      trainPartitions: combo.map((i) => i + 1),
      testPartitions: complement.map((i) => i + 1),
    });
  }

  return splits;
}

// ---------------------------------------------------------------------------
// PBO 计算
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 候选在指定分区（0-based）上的指标算术平均；任一非法值 → null。 */
function meanOverPartitions(metrics: readonly (number | null)[], indices: readonly number[]): number | null {
  let sum = 0;
  for (const index of indices) {
    const value = metrics[index];
    if (!isFiniteNumber(value)) return null;
    sum += value;
  }
  return sum / indices.length;
}

/** 按指标排名（best first），同值 tie-break experimentId 字典序。返回实验 id 序列。 */
function rankByMetric(
  entries: readonly { experimentId: string; metric: number }[],
  direction: SelectionDirection,
): string[] {
  const sorted = [...entries].sort((left, right) => {
    if (left.metric !== right.metric) {
      return direction === "maximize" ? right.metric - left.metric : left.metric - right.metric;
    }
    return left.experimentId.localeCompare(right.experimentId);
  });
  return sorted.map((entry) => entry.experimentId);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, val]) => [key, canonicalize(val)]),
    );
  }
  return value;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 校验 PBO 结果结构（反序列化用）。 */
function validatePboResult(result: PboResult): void {
  if (!result || typeof result !== "object") {
    throw new ResearchValidationError([{ code: "PBO_RESULT_INVALID", path: "pbo", message: "PBO 结果缺失或非对象" }]);
  }
  if (result.status !== "computed" && result.status !== "insufficient_data") {
    throw new ResearchValidationError([{ code: "PBO_STATUS_INVALID", path: "status", message: `非法 PBO 状态：${String(result.status)}` }]);
  }
  if (result.pbo !== null && !(isFiniteNumber(result.pbo) && result.pbo >= 0 && result.pbo <= 1)) {
    throw new ResearchValidationError([{ code: "PBO_OUT_OF_RANGE", path: "pbo", message: `PBO 必须在 [0,1]，实际 ${String(result.pbo)}` }]);
  }
  if (!isSelectableMetric(result.metric)) {
    throw new ResearchValidationError([{ code: "PBO_METRIC_INVALID", path: "metric", message: `非法指标：${String(result.metric)}` }]);
  }
  if (!isSelectionDirection(result.direction)) {
    throw new ResearchValidationError([{ code: "PBO_DIRECTION_INVALID", path: "direction", message: `非法方向：${String(result.direction)}` }]);
  }
  if (typeof result.fingerprint !== "string" || result.fingerprint.trim() === "") {
    throw new ResearchValidationError([{ code: "PBO_FINGERPRINT_EMPTY", path: "fingerprint", message: "fingerprint 不能为空" }]);
  }
  if (!Array.isArray(result.splitResults)) {
    throw new ResearchValidationError([{ code: "PBO_SPLIT_RESULTS_INVALID", path: "splitResults", message: "splitResults 必须是数组" }]);
  }
}

/** PBO canonical fingerprint：覆盖分区数 / 指标 / 方向 / 全部候选数据（§三十五 PBO 使用了什么数据）。 */
function computePboFingerprint(input: PboInput): string {
  const canonical = canonicalize({
    numPartitions: input.numPartitions,
    metric: input.selectionMetric,
    direction: input.selectionDirection,
    candidates: input.candidates.map((candidate) => ({
      experimentId: candidate.experimentId,
      parameterSet: candidate.parameterSet,
      partitionMetrics: candidate.partitionMetrics,
    })),
  });
  return sha256Hex(JSON.stringify(canonical));
}

/**
 * 计算 PBO（纯函数、确定性）。
 *
 * 数据不足（候选 < 2 或无可评估划分）→ 返回 status="insufficient_data"、pbo=null；
 * N 非法在 generateCscvSplits 中 fail fast 抛错（不在此吞掉）。
 */
export function computePbo(input: PboInput): PboResult {
  if (!input || typeof input !== "object" || !Array.isArray(input.candidates)) {
    throw new ResearchValidationError([
      { code: "PBO_INPUT_INVALID", path: "input", message: "PBO 输入缺失或 candidates 非数组" },
    ]);
  }
  if (!isSelectableMetric(input.selectionMetric)) {
    throw new ResearchValidationError([
      { code: "PBO_METRIC_INVALID", path: "selectionMetric", message: `非法指标：${String(input.selectionMetric)}` },
    ]);
  }
  if (!isSelectionDirection(input.selectionDirection)) {
    throw new ResearchValidationError([
      { code: "PBO_DIRECTION_INVALID", path: "selectionDirection", message: `非法方向：${String(input.selectionDirection)}` },
    ]);
  }

  const fingerprint = computePboFingerprint(input);
  const splits = generateCscvSplits(input.numPartitions);

  const insufficient = (): PboResult => ({
    numPartitions: input.numPartitions,
    numCombinations: splits.length,
    evaluatedCombinations: 0,
    overfitCount: 0,
    pbo: null,
    status: "insufficient_data",
    metric: input.selectionMetric,
    direction: input.selectionDirection,
    fingerprint,
    splitResults: [],
  });

  if (input.candidates.length < 2) {
    return insufficient();
  }

  // 预校验每个候选分区指标长度；非法候选（长度不符 / 全非法）确定性标记，不参与任何排名。
  const candidates = input.candidates.map((candidate) => {
    if (candidate.partitionMetrics.length !== input.numPartitions) {
      throw new ResearchValidationError([
        {
          code: "PBO_PARTITION_METRICS_LENGTH_MISMATCH",
          path: "candidates",
          message: `候选 ${candidate.experimentId} 的分区指标数(${candidate.partitionMetrics.length}) != numPartitions(${input.numPartitions})`,
        },
      ]);
    }
    return { experimentId: candidate.experimentId, partitionMetrics: candidate.partitionMetrics };
  });

  const splitResults: PboSplitResult[] = [];
  let overfitCount = 0;
  let evaluatedCombinations = 0;

  for (const split of splits) {
    const trainIdx = split.trainPartitions.map((p) => p - 1);
    const testIdx = split.testPartitions.map((p) => p - 1);

    const valid = candidates
      .map((candidate) => ({
        experimentId: candidate.experimentId,
        trainMetric: meanOverPartitions(candidate.partitionMetrics, trainIdx),
        testMetric: meanOverPartitions(candidate.partitionMetrics, testIdx),
      }))
      .filter((entry): entry is { experimentId: string; trainMetric: number; testMetric: number } =>
        entry.trainMetric !== null && entry.testMetric !== null,
      );

    if (valid.length < 2) {
      continue; // 无可评估候选 → 该划分不计入（确定性跳过）
    }

    const trainRanked = rankByMetric(
      valid.map((entry) => ({ experimentId: entry.experimentId, metric: entry.trainMetric })),
      input.selectionDirection,
    );
    const testRanked = rankByMetric(
      valid.map((entry) => ({ experimentId: entry.experimentId, metric: entry.testMetric })),
      input.selectionDirection,
    );
    const selectedExperimentId = trainRanked[0]!;
    const testRank = testRanked.indexOf(selectedExperimentId) + 1;
    const testPercentile = (testRank - 1) / (valid.length - 1);
    const isOverfit = testPercentile >= 0.5;

    const selected = valid.find((entry) => entry.experimentId === selectedExperimentId)!;
    splitResults.push({
      trainPartitions: [...split.trainPartitions],
      testPartitions: [...split.testPartitions],
      selectedExperimentId,
      trainMetric: selected.trainMetric,
      trainRank: 1,
      testRank,
      testPercentile,
      isOverfit,
    });

    evaluatedCombinations += 1;
    if (isOverfit) overfitCount += 1;
  }

  if (evaluatedCombinations === 0) {
    return insufficient();
  }

  return {
    numPartitions: input.numPartitions,
    numCombinations: splits.length,
    evaluatedCombinations,
    overfitCount,
    pbo: overfitCount / evaluatedCombinations,
    status: "computed",
    metric: input.selectionMetric,
    direction: input.selectionDirection,
    fingerprint,
    splitResults,
  };
}

// ---------------------------------------------------------------------------
// 序列化 / 反序列化
// ---------------------------------------------------------------------------

/** 严格 replacer：拒绝非有限数字（NaN/Infinity 不得静默转 null）。 */
function strictReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`拒绝序列化非有限数字：${String(value)}`);
  }
  return value;
}

/** 序列化 PBO 结果。 */
export function serializePboResult(result: PboResult): string {
  validatePboResult(result);
  return JSON.stringify(result, strictReplacer);
}

/** 反序列化 PBO 结果（结构校验 + 深拷贝，mutation isolation）。 */
export function deserializePboResult(json: string): PboResult {
  const parsed: unknown = JSON.parse(json);
  const result = parsed as PboResult;
  validatePboResult(result);
  return structuredClone(result);
}
