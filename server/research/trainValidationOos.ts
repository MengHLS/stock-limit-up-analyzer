/**
 * STEP 6.4 — Train / Validation / OOS Research Evaluation Plan。
 *
 * 职责：把「Dataset Split + 选择指标/方向 + 策略身份 + 冻结配置」组织成一个 immutable 的
 * Research Evaluation Plan，并提供 canonical fingerprint 与序列化/反序列化。
 *
 * 关键设计：
 *   - `validationOnly` / `oosLocked` 用 **字面量 true**（`readonly`），类型层面禁止普通调用者
 *     把它们设成 false 绕过隔离（§10）；
 *   - `datasetSplitFingerprint` 由 `computeDatasetSplitFingerprint`（固定字段序 + SHA-256）派生；
 *   - `evaluationPlanFingerprint` 由 strategyId / strategyVersion / parameterSpaceFingerprint /
 *     datasetSplitFingerprint / selectionMetric / selectionDirection / backtestConfig / featureConfig
 *     canonical 序列化后 SHA-256（§37/§38：只改任一字段 → 不同指纹）。
 */

import { createHash } from "node:crypto";
import {
  assertValidResearchDatasetSplit,
  computeDatasetSplitFingerprint,
  toTrainValidationOosRanges,
  validateDatasetRange,
  type ResearchDatasetRange,
  type ResearchDatasetSplit,
  type TrainValidationOosRanges,
} from "./datasetSplit";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
  validateBacktestConfig,
  validateFeatureConfig,
} from "./experimentValidation";
import type { ResearchBacktestConfig, ResearchFeatureConfig } from "./types";
import { isSelectableMetric, isSelectionDirection, type SelectionDirection, type SelectionMetric } from "./validationSelection";

/** Train / Validation / OOS 三段范围（Plan 内的切分表达）。 */
export type TrainValidationOosSplit = TrainValidationOosRanges;

// ---------------------------------------------------------------------------
// Research Evaluation Plan
// ---------------------------------------------------------------------------

/**
 * 研究评估计划（immutable snapshot）。
 *
 * 语义字段 `validationOnly` / `oosLocked` 恒为 `true`（字面量），
 * 不允许被普通调用者设置成 false 来绕过 OOS 隔离。
 */
export interface ResearchEvaluationPlan {
  strategyId: string;
  strategyVersion: string;

  /** Train / Validation / OOS 三段切分。 */
  split: TrainValidationOosSplit;

  /** 选择指标（严格取自 PerformanceMetrics 既有字段）。 */
  selectionMetric: SelectionMetric;
  /** 选择方向。 */
  selectionDirection: SelectionDirection;

  /** 参数空间 canonical fingerprint（来自 Sweep，标识「搜了哪些参数」）。 */
  parameterSpaceFingerprint: string;
  /** 数据集切分 canonical fingerprint。 */
  datasetSplitFingerprint: string;

  /** 冻结的回测配置（含 costModel），保证 Plan 指纹覆盖成本口径（可选，缺省未冻结）。 */
  backtestConfig?: ResearchBacktestConfig;
  /** 冻结的特征配置（可选）。 */
  featureConfig?: ResearchFeatureConfig;

  /** 语义锁：只允许 Validation 参与选择。 */
  readonly validationOnly: true;
  /** 语义锁：OOS 已锁定，只用于最终隔离评估。 */
  readonly oosLocked: true;
}

/** 创建 Plan 的输入。 */
export interface CreateResearchEvaluationPlanInput {
  strategyId: string;
  strategyVersion: string;
  /** 三段切分（平面 6 日期形式）。 */
  split: ResearchDatasetSplit;
  selectionMetric: SelectionMetric;
  selectionDirection: SelectionDirection;
  parameterSpaceFingerprint: string;
  backtestConfig?: ResearchBacktestConfig;
  featureConfig?: ResearchFeatureConfig;
}

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

/** 校验三段范围（各段 start<=end，且 train.end < validation.start、validation.end < oos.start）。 */
export function validateTrainValidationOosSplit(split: TrainValidationOosSplit): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!split || typeof split !== "object") {
    return { valid: false, issues: [issue("TVO_SPLIT_INVALID", "split", "三段切分缺失或非对象")] };
  }
  const train = (split as { train?: ResearchDatasetRange }).train;
  const validation = (split as { validation?: ResearchDatasetRange }).validation;
  const oos = (split as { oos?: ResearchDatasetRange }).oos;

  if (train === undefined || train === null || typeof train !== "object") {
    issues.push(issue("TVO_TRAIN_MISSING", "split.train", "train 范围缺失"));
  } else {
    issues.push(...validateDatasetRange(train).issues.map((i) => ({ ...i, path: `split.train.${i.path.replace("range.", "")}` })));
  }
  if (validation === undefined || validation === null || typeof validation !== "object") {
    issues.push(issue("TVO_VALIDATION_MISSING", "split.validation", "validation 范围缺失"));
  } else {
    issues.push(...validateDatasetRange(validation).issues.map((i) => ({ ...i, path: `split.validation.${i.path.replace("range.", "")}` })));
  }
  if (oos === undefined || oos === null || typeof oos !== "object") {
    issues.push(issue("TVO_OOS_MISSING", "split.oos", "oos 范围缺失"));
  } else {
    issues.push(...validateDatasetRange(oos).issues.map((i) => ({ ...i, path: `split.oos.${i.path.replace("range.", "")}` })));
  }

  const trainEnd = train?.end;
  const validationStart = validation?.start;
  const validationEnd = validation?.end;
  const oosStart = oos?.start;

  if (typeof trainEnd === "string" && typeof validationStart === "string" && trainEnd >= validationStart) {
    issues.push(issue("TRAIN_VALIDATION_OVERLAP", "split", `Train 与 Validation 重叠或相邻重叠：train.end(${trainEnd}) >= validation.start(${validationStart})`));
  }
  if (typeof validationEnd === "string" && typeof oosStart === "string" && validationEnd >= oosStart) {
    issues.push(issue("VALIDATION_OOS_OVERLAP", "split", `Validation 与 OOS 重叠或相邻重叠：validation.end(${validationEnd}) >= oos.start(${oosStart})`));
  }

  return { valid: issues.length === 0, issues };
}

/** 校验 Research Evaluation Plan。 */
export function validateResearchEvaluationPlan(plan: ResearchEvaluationPlan): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!plan || typeof plan !== "object") {
    return { valid: false, issues: [issue("PLAN_INVALID", "plan", "评估计划缺失或非对象")] };
  }

  if (typeof plan.strategyId !== "string" || plan.strategyId.trim() === "") {
    issues.push(issue("PLAN_STRATEGY_ID_EMPTY", "plan.strategyId", "strategyId 不能为空"));
  }
  if (typeof plan.strategyVersion !== "string" || plan.strategyVersion.trim() === "") {
    issues.push(issue("PLAN_STRATEGY_VERSION_EMPTY", "plan.strategyVersion", "strategyVersion 不能为空"));
  }
  if (!isSelectableMetric(plan.selectionMetric)) {
    issues.push(issue("PLAN_SELECTION_METRIC_INVALID", "plan.selectionMetric", `非法选择指标：${String(plan.selectionMetric)}`));
  }
  if (!isSelectionDirection(plan.selectionDirection)) {
    issues.push(issue("PLAN_SELECTION_DIRECTION_INVALID", "plan.selectionDirection", `非法选择方向：${String(plan.selectionDirection)}`));
  }
  if (typeof plan.parameterSpaceFingerprint !== "string" || plan.parameterSpaceFingerprint.trim() === "") {
    issues.push(issue("PLAN_PARAM_SPACE_FP_EMPTY", "plan.parameterSpaceFingerprint", "parameterSpaceFingerprint 不能为空"));
  }
  if (typeof plan.datasetSplitFingerprint !== "string" || plan.datasetSplitFingerprint.trim() === "") {
    issues.push(issue("PLAN_SPLIT_FP_EMPTY", "plan.datasetSplitFingerprint", "datasetSplitFingerprint 不能为空"));
  }

  // 语义锁：必须是字面量 true（任何非 true 都是绕过隔离的非法调用）。
  if (plan.validationOnly !== true) {
    issues.push(issue("PLAN_VALIDATION_ONLY_VIOLATED", "plan.validationOnly", "validationOnly 必须恒为 true（禁止设 false 绕过隔离）"));
  }
  if (plan.oosLocked !== true) {
    issues.push(issue("PLAN_OOS_LOCKED_VIOLATED", "plan.oosLocked", "oosLocked 必须恒为 true（禁止设 false 绕过隔离）"));
  }

  issues.push(...validateTrainValidationOosSplit(plan.split).issues);

  if (plan.backtestConfig !== undefined) {
    const bc = validateBacktestConfig(plan.backtestConfig);
    issues.push(...bc.issues.map((i) => ({ ...i, path: `plan.${i.path}` })));
  }
  if (plan.featureConfig !== undefined) {
    const fc = validateFeatureConfig(plan.featureConfig);
    issues.push(...fc.issues.map((i) => ({ ...i, path: `plan.${i.path}` })));
  }

  return { valid: issues.length === 0, issues };
}

/** 断言评估计划合法，否则抛 ResearchValidationError。 */
export function assertValidResearchEvaluationPlan(plan: ResearchEvaluationPlan): void {
  const result = validateResearchEvaluationPlan(plan);
  if (!result.valid) throw new ResearchValidationError(result.issues);
}

/** 构造 Train / Validation / OOS 三段范围（校验平面切分并派生）。 */
export function createTrainValidationOosSplit(split: ResearchDatasetSplit): TrainValidationOosSplit {
  assertValidResearchDatasetSplit(split);
  return toTrainValidationOosRanges(split);
}

/** 构造 Research Evaluation Plan（校验 + 派生 fingerprint + 深拷贝冻结配置）。 */
export function createResearchEvaluationPlan(input: CreateResearchEvaluationPlanInput): ResearchEvaluationPlan {
  const plan: ResearchEvaluationPlan = {
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    split: createTrainValidationOosSplit(input.split),
    selectionMetric: input.selectionMetric,
    selectionDirection: input.selectionDirection,
    parameterSpaceFingerprint: input.parameterSpaceFingerprint,
    datasetSplitFingerprint: computeDatasetSplitFingerprint(input.split),
    backtestConfig: input.backtestConfig === undefined ? undefined : structuredClone(input.backtestConfig),
    featureConfig: input.featureConfig === undefined ? undefined : structuredClone(input.featureConfig),
    validationOnly: true,
    oosLocked: true,
  };
  assertValidResearchEvaluationPlan(plan);
  return plan;
}

// ---------------------------------------------------------------------------
// Fingerprint（canonical SHA-256）
// ---------------------------------------------------------------------------

/** 递归 canonical 化：数组保持顺序、对象键按字典序排序（用于稳定 fingerprint）。 */
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

/**
 * Research Evaluation Plan canonical fingerprint（SHA-256）。
 * 覆盖 strategyId / strategyVersion / parameterSpaceFingerprint / datasetSplitFingerprint /
 * selectionMetric / selectionDirection / backtestConfig / featureConfig。
 * 只改任一字段（含 costModel / validationEnd / selectionMetric）→ 不同指纹。
 */
export function computeEvaluationPlanFingerprint(plan: ResearchEvaluationPlan): string {
  assertValidResearchEvaluationPlan(plan);
  const canonical = canonicalize({
    strategyId: plan.strategyId,
    strategyVersion: plan.strategyVersion,
    parameterSpaceFingerprint: plan.parameterSpaceFingerprint,
    datasetSplitFingerprint: plan.datasetSplitFingerprint,
    selectionMetric: plan.selectionMetric,
    selectionDirection: plan.selectionDirection,
    backtestConfig: plan.backtestConfig,
    featureConfig: plan.featureConfig,
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
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

/** 序列化评估计划（JSON、确定性）。 */
export function serializeResearchEvaluationPlan(plan: ResearchEvaluationPlan): string {
  assertValidResearchEvaluationPlan(plan);
  return JSON.stringify(plan, strictReplacer);
}

/** 反序列化评估计划（结构校验 + 语义锁校验，非法抛 ResearchValidationError）。 */
export function deserializeResearchEvaluationPlan(json: string): ResearchEvaluationPlan {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ResearchValidationError([{ code: "PLAN_DESERIALIZE_INVALID", path: "plan", message: "反序列化评估计划失败：结果不是对象" }]);
  }
  const plan = parsed as unknown as ResearchEvaluationPlan;
  assertValidResearchEvaluationPlan(plan);
  return structuredClone(plan);
}
