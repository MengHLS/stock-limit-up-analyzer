/**
 * STEP 6.4 — Validation-only Selection + Frozen OOS Candidate。
 *
 * 核心铁律（反过拟合边界）：
 *   - 参数选择**只能**发生在 Validation 区域；
 *   - `selectBestValidationResult` 只接受 Validation 候选结果，签名上**不接收 OOS**（见 §26 / §11）；
 *   - OOS 只能消费「已冻结的候选」（`FrozenOosCandidate`），不能再接受 `ParameterSpace`。
 *
 * 本模块只做「选择 + 冻结」的纯逻辑，不实现任何回测 / 交易；Selection Metric 复用
 * Production Backtest Core 的 `PerformanceMetrics` 既有字段（§15：不虚构 sortino/calmar 等
 * 不存在的字段）。
 */

import type { PerformanceMetrics } from "../engine/domain";
import { ResearchValidationError } from "./experimentValidation";
import type { ResearchExperimentSnapshot, ResearchParameterSet } from "./types";

// ---------------------------------------------------------------------------
// Selection Metric / Direction
// ---------------------------------------------------------------------------

/** 选择方向：maximize = 越大越好；minimize = 越小越好。 */
export type SelectionDirection = "maximize" | "minimize";

/**
 * 可选的绩效指标（严格取自 `PerformanceMetrics` 既有字段，不虚构字段）。
 * 注：spec 里提到的 sortinoRatio / calmarRatio 在现有引擎中不存在，故不列入。
 */
export const SELECTABLE_METRICS = [
  "totalReturnPct",
  "annualizedReturnPct",
  "annualizedVolatilityPct",
  "sharpeRatio",
  "maxDrawdownPct",
  "winRatePct",
  "profitFactor",
  "expectancy",
] as const;

/** 选择指标类型。 */
export type SelectionMetric = (typeof SELECTABLE_METRICS)[number];

/** 是否为合法的选择指标（运行时窄化）。 */
export function isSelectableMetric(value: unknown): value is SelectionMetric {
  return typeof value === "string" && (SELECTABLE_METRICS as readonly string[]).includes(value);
}

/** 是否为合法的选择方向。 */
export function isSelectionDirection(value: unknown): value is SelectionDirection {
  return value === "maximize" || value === "minimize";
}

// ---------------------------------------------------------------------------
// Validation Candidate Result
// ---------------------------------------------------------------------------

/** 单个候选在 Validation 区域的运行结果（选择的最小输入单位）。 */
export interface ValidationCandidateResult {
  experimentId: string;
  parameterSet: ResearchParameterSet;
  status: "succeeded" | "failed";
  /** 成功时的绩效指标（复用引擎 PerformanceMetrics）。 */
  metrics?: PerformanceMetrics;
  /** 失败时的错误信息。 */
  error?: string;
}

// ---------------------------------------------------------------------------
// Validation Selection
// ---------------------------------------------------------------------------

/** Validation-only 选择结果。 */
export interface ValidationSelectionResult {
  selectedExperimentId: string;
  selectedParameters: ResearchParameterSet;
  selectionMetric: SelectionMetric;
  selectionValue: number | null;
  direction: SelectionDirection;
  /** 参与本次选择的所有候选 experimentId（保持输入顺序，用于审计）。 */
  candidateExperimentIds: string[];
  /** Validation 数据集指纹（标识本次选择基于哪个数据切分）。 */
  validationFingerprint: string;
}

/** Validation 选择输入。 */
export interface ValidationSelectionInput {
  candidates: readonly ValidationCandidateResult[];
  selectionMetric: SelectionMetric;
  selectionDirection: SelectionDirection;
  validationFingerprint: string;
}

/** 从候选的 metrics 解析选择指标的有限数值；null / NaN / Infinity → null（视为 invalid）。 */
function resolveMetricValue(candidate: ValidationCandidateResult, metric: SelectionMetric): number | null {
  const raw = candidate.metrics?.[metric];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  return null;
}

/** 比较两个指标值（best first）；direction 决定升/降序。 */
function compareMetricValue(left: number, right: number, direction: SelectionDirection): number {
  return direction === "maximize" ? right - left : left - right;
}

/**
 * 从 Validation 候选结果中选择最佳（纯函数、确定性）。
 *
 * 规则：
 *   - 只接受 `status === "succeeded"` 且 selectionMetric 为有限数字的候选；
 *     null / NaN / Infinity / failed 候选一律视为 invalid，不能中选（§13）；
 *   - 全部 invalid → selection 失败（抛错，不偷偷选第一个）；
 *   - 同值 tie-break：按 experimentId 字典序稳定决定（§12），与输入顺序、数据库返回顺序无关；
 *   - 返回的 selectedParameters 为独立副本（mutation isolation）。
 */
export function selectBestValidationResult(input: ValidationSelectionInput): ValidationSelectionResult {
  if (!isSelectableMetric(input.selectionMetric)) {
    throw new ResearchValidationError([
      { code: "SELECTION_METRIC_INVALID", path: "selectionMetric", message: `非法选择指标：${String(input.selectionMetric)}` },
    ]);
  }
  if (!isSelectionDirection(input.selectionDirection)) {
    throw new ResearchValidationError([
      { code: "SELECTION_DIRECTION_INVALID", path: "selectionDirection", message: `非法选择方向：${String(input.selectionDirection)}` },
    ]);
  }
  if (typeof input.validationFingerprint !== "string" || input.validationFingerprint.trim() === "") {
    throw new ResearchValidationError([
      { code: "VALIDATION_FINGERPRINT_EMPTY", path: "validationFingerprint", message: "validationFingerprint 不能为空" },
    ]);
  }
  if (!Array.isArray(input.candidates)) {
    throw new ResearchValidationError([
      { code: "CANDIDATES_INVALID", path: "candidates", message: "candidates 必须是数组" },
    ]);
  }

  const resolved = input.candidates.map((candidate) => ({
    candidate,
    metricValue: candidate.status === "succeeded" ? resolveMetricValue(candidate, input.selectionMetric) : null,
  }));

  const valid = resolved.filter((entry) => entry.metricValue !== null);

  if (valid.length === 0) {
    throw new ResearchValidationError([
      {
        code: "NO_VALID_CANDIDATE",
        path: "selection",
        message: "所有候选的 selectionMetric 均无效（failed / null / NaN / Infinity），selection 失败",
      },
    ]);
  }

  // 确定性排序：指标最优在前，同值按 experimentId 字典序（与输入顺序无关）。
  valid.sort((left, right) => {
    const byMetric = compareMetricValue(left.metricValue!, right.metricValue!, input.selectionDirection);
    if (byMetric !== 0) return byMetric;
    return left.candidate.experimentId.localeCompare(right.candidate.experimentId);
  });

  const best = valid[0]!;
  return {
    selectedExperimentId: best.candidate.experimentId,
    selectedParameters: structuredClone(best.candidate.parameterSet),
    selectionMetric: input.selectionMetric,
    selectionValue: best.metricValue,
    direction: input.selectionDirection,
    candidateExperimentIds: input.candidates.map((candidate) => candidate.experimentId),
    validationFingerprint: input.validationFingerprint,
  };
}

// ---------------------------------------------------------------------------
// Frozen OOS Candidate
// ---------------------------------------------------------------------------

/**
 * 冻结的 OOS 候选（§17）。
 *
 * 一旦进入 OOS，参数 / 策略版本 / 成本模型 / 数据集切分全部冻结：
 *   - `snapshot` 保存 canonical Experiment Snapshot（含冻结 costModel / backtestConfig / featureConfig），
 *     是 OOS 复现的唯一事实来源（§18 可追溯性：OOS → Candidate → Snapshot → Strategy Version）；
 *   - `strategyId` / `strategyVersion` / `parameters` 由 snapshot 派生，保证与 snapshot 一致（单一事实来源）；
 *   - `validationMetric` / `validationValue` 记录「凭哪个 Validation 结果选中」。
 */
export interface FrozenOosCandidate {
  experimentId: string;
  strategyId: string;
  strategyVersion: string;
  parameters: ResearchParameterSet;
  /** 冻结的 canonical 实验快照（含冻结 costModel / backtestConfig / featureConfig）。 */
  snapshot: ResearchExperimentSnapshot;
  validationMetric: SelectionMetric;
  validationValue: number | null;
  validationFingerprint: string;
  frozenAt: string;
}

/** 冻结 OOS 候选的输入。snapshot 为身份 / 参数 / 成本模型的单一事实来源。 */
export interface FreezeOosCandidateInput {
  experimentId: string;
  snapshot: ResearchExperimentSnapshot;
  validationMetric: SelectionMetric;
  validationValue: number | null;
  validationFingerprint: string;
  /** 冻结时间（元数据；测试可注入，缺省当前时间）。 */
  frozenAt?: string;
}

/**
 * 冻结 OOS 候选（纯函数）。
 *
 * 返回全新深拷贝（structuredClone），外部修改返回对象（如 `candidate.parameters.foo = ...`）
 * 不影响原 snapshot / 输入对象（§40 / §46 mutation isolation）。
 */
export function freezeOosCandidate(input: FreezeOosCandidateInput): FrozenOosCandidate {
  if (!isSelectableMetric(input.validationMetric)) {
    throw new ResearchValidationError([
      { code: "SELECTION_METRIC_INVALID", path: "validationMetric", message: `非法选择指标：${String(input.validationMetric)}` },
    ]);
  }
  if (input.validationValue !== null && (typeof input.validationValue !== "number" || !Number.isFinite(input.validationValue))) {
    throw new ResearchValidationError([
      { code: "VALIDATION_VALUE_INVALID", path: "validationValue", message: "validationValue 必须是有限数字或 null" },
    ]);
  }
  if (typeof input.validationFingerprint !== "string" || input.validationFingerprint.trim() === "") {
    throw new ResearchValidationError([
      { code: "VALIDATION_FINGERPRINT_EMPTY", path: "validationFingerprint", message: "validationFingerprint 不能为空" },
    ]);
  }

  const snapshot = structuredClone(input.snapshot);
  if (snapshot.experimentId !== input.experimentId) {
    throw new ResearchValidationError([
      { code: "SNAPSHOT_EXPERIMENT_MISMATCH", path: "snapshot.experimentId", message: `snapshot.experimentId(${snapshot.experimentId}) 与 experimentId(${input.experimentId}) 不一致` },
    ]);
  }

  return {
    experimentId: input.experimentId,
    strategyId: snapshot.strategyId,
    strategyVersion: snapshot.strategyVersion,
    parameters: structuredClone(snapshot.parameterSet),
    snapshot,
    validationMetric: input.validationMetric,
    validationValue: input.validationValue,
    validationFingerprint: input.validationFingerprint,
    frozenAt: input.frozenAt ?? new Date().toISOString(),
  };
}
