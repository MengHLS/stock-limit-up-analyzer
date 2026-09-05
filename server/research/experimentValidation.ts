/**
 * STEP 6.1 — Experiment / Parameter / Dataset / Feature / Backtest 校验。
 *
 * 全部校验为纯函数，返回结构化结果（不抛错）；另有 assert* 便捷入口在非法时抛
 * ResearchValidationError。禁止静默 fallback / 默认值兜底掩盖问题。
 *
 * 校验原则：
 *   - 参数名唯一；required 参数必须存在；number 必须有限；min<=max；step>0；
 *   - defaultValue 必须满足自身 schema；禁止 NaN / Infinity / 隐式类型转换；
 *   - 数据集日期 startDate<=endDate；禁止模糊时间范围；
 *   - 回测 initialCapital>0、commissionRate/slippageRate>=0；
 *   - 不创造与生产 BacktestConfig 冲突的规则（本层只描述实验级口径）。
 */

import type { CostModel } from "../engine/domain";
import type { ResearchStrategyDefinition } from "./strategyContract";
import type {
  ResearchBacktestConfig,
  ResearchDatasetSpec,
  ResearchExperiment,
  ResearchExperimentSnapshot,
  ResearchFeatureConfig,
  ResearchParameterDefinition,
  ResearchParameterSchema,
  ResearchParameterSet,
  ResearchParameterValue,
} from "./types";

/** 单条校验问题。 */
export interface ResearchValidationIssue {
  /** 稳定 code（供程序化处理，非自由文本）。 */
  code: string;
  /** 定位路径（点分，如 parameterSet.maxSignals）。 */
  path: string;
  message: string;
}

/** 校验结果：无 issue 即有效。 */
export interface ResearchValidationResult {
  valid: boolean;
  issues: ResearchValidationIssue[];
}

/** 校验错误（供 assert* 抛错）。 */
export class ResearchValidationError extends Error {
  readonly issues: ResearchValidationIssue[];

  constructor(issues: ResearchValidationIssue[]) {
    const lines = issues.map((issue) => `  [${issue.code}] ${issue.path}: ${issue.message}`).join("\n");
    super(`研究实验校验失败：\n${lines}`);
    this.name = "ResearchValidationError";
    this.issues = issues;
  }
}

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

// ---------------------------------------------------------------------------
// 单值校验（value ↔ 单个参数定义）
// ---------------------------------------------------------------------------

function validateValue(value: ResearchParameterValue, def: ResearchParameterDefinition, path: string): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];
  const nullable = def.nullable === true;

  if (value === null) {
    if (!nullable) {
      issues.push(issue("VALUE_NULL_NOT_ALLOWED", path, `参数 ${def.name} 不允许 null（未声明 nullable）`));
    }
    return issues;
  }

  const actualType = typeof value;
  if (actualType !== def.type) {
    issues.push(issue("VALUE_TYPE_MISMATCH", path, `参数 ${def.name} 期望 ${def.type}，实际 ${actualType}（禁止隐式类型转换）`));
    return issues;
  }

  if (def.type === "number") {
    const num = value as number;
    if (!Number.isFinite(num)) {
      issues.push(issue("VALUE_NOT_FINITE", path, `参数 ${def.name} 必须是有限数字（禁止 NaN / Infinity）`));
      return issues;
    }
    if (def.min !== undefined && num < def.min) {
      issues.push(issue("VALUE_BELOW_MIN", path, `参数 ${def.name} = ${num} 小于 min ${def.min}`));
    }
    if (def.max !== undefined && num > def.max) {
      issues.push(issue("VALUE_ABOVE_MAX", path, `参数 ${def.name} = ${num} 大于 max ${def.max}`));
    }
  }

  if (def.type === "string" && def.allowedValues !== undefined && !def.allowedValues.includes(value as string)) {
    issues.push(issue("VALUE_NOT_ALLOWED", path, `参数 ${def.name} = "${String(value)}" 不在允许值 [${def.allowedValues.join(", ")}] 内`));
  }

  return issues;
}

// ---------------------------------------------------------------------------
// 参数 Schema
// ---------------------------------------------------------------------------

export function validateParameterSchema(schema: ResearchParameterSchema): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!schema || !Array.isArray(schema.parameters)) {
    return { valid: false, issues: [issue("PARAMETER_SCHEMA_INVALID", "parameterSchema", "parameterSchema.parameters 必须是数组")] };
  }

  const seen = new Set<string>();
  for (const param of schema.parameters) {
    if (!param || typeof param !== "object") {
      issues.push(issue("PARAMETER_INVALID", "parameterSchema", "参数定义必须是对象"));
      continue;
    }
    const path = `parameterSchema.${param.name}`;
    if (typeof param.name !== "string" || param.name.trim() === "") {
      issues.push(issue("PARAM_NAME_EMPTY", "parameterSchema", "参数名不能为空"));
      continue;
    }
    if (seen.has(param.name)) {
      issues.push(issue("PARAM_NAME_DUPLICATE", path, `参数名重复：${param.name}`));
      continue;
    }
    seen.add(param.name);

    if (param.type !== "number" && param.type !== "string" && param.type !== "boolean") {
      issues.push(issue("PARAM_TYPE_INVALID", `${path}.type`, `非法参数类型：${String(param.type)}`));
      continue;
    }

    const hasNumericConstraint = param.min !== undefined || param.max !== undefined || param.step !== undefined;
    if (hasNumericConstraint && param.type !== "number") {
      issues.push(issue("PARAM_CONSTRAINT_TYPE_MISMATCH", path, `min/max/step 仅对 number 类型生效，但该参数类型为 ${param.type}`));
    }
    if (param.allowedValues !== undefined && param.type !== "string") {
      issues.push(issue("PARAM_ALLOWED_VALUES_TYPE_MISMATCH", path, "allowedValues 仅对 string 类型生效"));
    }

    if (param.type === "number") {
      if (param.min !== undefined && !Number.isFinite(param.min)) {
        issues.push(issue("PARAM_MIN_NOT_FINITE", `${path}.min`, "min 必须是有限数字"));
      }
      if (param.max !== undefined && !Number.isFinite(param.max)) {
        issues.push(issue("PARAM_MAX_NOT_FINITE", `${path}.max`, "max 必须是有限数字"));
      }
      if (param.step !== undefined && (!Number.isFinite(param.step) || param.step <= 0)) {
        issues.push(issue("PARAM_STEP_INVALID", `${path}.step`, "step 必须是 > 0 的有限数字"));
      }
      if (
        param.min !== undefined && param.max !== undefined
        && Number.isFinite(param.min) && Number.isFinite(param.max)
        && param.min > param.max
      ) {
        issues.push(issue("PARAM_MIN_MAX_ORDER", path, `min(${param.min}) 不能大于 max(${param.max})`));
      }
    }

    if (param.defaultValue !== undefined) {
      issues.push(...validateValue(param.defaultValue, param, `${path}.defaultValue`));
    }
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 参数集合（对 schema）
// ---------------------------------------------------------------------------

export function validateParameterSet(parameterSet: ResearchParameterSet, schema: ResearchParameterSchema): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!parameterSet || typeof parameterSet !== "object" || Array.isArray(parameterSet)) {
    return { valid: false, issues: [issue("PARAMETER_SET_INVALID", "parameterSet", "parameterSet 必须是对象")] };
  }

  issues.push(...validateParameterSchema(schema).issues);

  const byName = new Map<string, ResearchParameterDefinition>(schema.parameters.map((param) => [param.name, param]));

  for (const param of schema.parameters) {
    if (param.required && !(param.name in parameterSet)) {
      issues.push(issue("REQUIRED_PARAM_MISSING", "parameterSet", `必填参数缺失：${param.name}`));
    }
  }

  for (const [name, value] of Object.entries(parameterSet)) {
    const def = byName.get(name);
    if (!def) {
      issues.push(issue("UNKNOWN_PARAM", `parameterSet.${name}`, `参数 ${name} 未在 schema 中定义`));
      continue;
    }
    issues.push(...validateValue(value, def, `parameterSet.${name}`));
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 数据集 / Feature / Backtest
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateDatasetSpec(dataset: ResearchDatasetSpec): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!dataset || typeof dataset !== "object") {
    return { valid: false, issues: [issue("DATASET_MISSING", "dataset", "数据集描述缺失或非对象")] };
  }
  if (typeof dataset.startDate !== "string" || !DATE_RE.test(dataset.startDate)) {
    issues.push(issue("DATASET_START_DATE_INVALID", "dataset.startDate", "startDate 必须是 YYYY-MM-DD 格式"));
  }
  if (typeof dataset.endDate !== "string" || !DATE_RE.test(dataset.endDate)) {
    issues.push(issue("DATASET_END_DATE_INVALID", "dataset.endDate", "endDate 必须是 YYYY-MM-DD 格式"));
  }
  if (DATE_RE.test(dataset.startDate) && DATE_RE.test(dataset.endDate) && dataset.startDate > dataset.endDate) {
    issues.push(issue("DATASET_DATE_REVERSED", "dataset", `startDate(${dataset.startDate}) 晚于 endDate(${dataset.endDate})`));
  }
  if (dataset.datasetVersion !== undefined && (typeof dataset.datasetVersion !== "string" || dataset.datasetVersion.trim() === "")) {
    issues.push(issue("DATASET_VERSION_INVALID", "dataset.datasetVersion", "datasetVersion 若提供必须是非空字符串（当前系统无版本机制时应保持 undefined）"));
  }
  return { valid: issues.length === 0, issues };
}

export function validateFeatureConfig(featureConfig: ResearchFeatureConfig | undefined): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (featureConfig === undefined || featureConfig === null) return { valid: true, issues };
  if (typeof featureConfig !== "object") {
    return { valid: false, issues: [issue("FEATURE_CONFIG_INVALID", "featureConfig", "featureConfig 必须是对象")] };
  }
  if (featureConfig.featureMode !== undefined && (typeof featureConfig.featureMode !== "string" || featureConfig.featureMode.trim() === "")) {
    issues.push(issue("FEATURE_MODE_INVALID", "featureConfig.featureMode", "featureMode 若提供必须是非空字符串"));
  }
  if (featureConfig.featureVersion !== undefined && (typeof featureConfig.featureVersion !== "string" || featureConfig.featureVersion.trim() === "")) {
    issues.push(issue("FEATURE_VERSION_INVALID", "featureConfig.featureVersion", "featureVersion 若提供必须是非空字符串（STEP 7 前应保持 undefined）"));
  }
  if (featureConfig.requiredFeatures !== undefined) {
    if (!Array.isArray(featureConfig.requiredFeatures)) {
      issues.push(issue("REQUIRED_FEATURES_NOT_ARRAY", "featureConfig.requiredFeatures", "requiredFeatures 必须是数组"));
    } else if (featureConfig.requiredFeatures.some((feature) => typeof feature !== "string" || feature.trim() === "")) {
      issues.push(issue("REQUIRED_FEATURES_INVALID_ENTRY", "featureConfig.requiredFeatures", "requiredFeatures 每项必须是非空字符串"));
    }
  }
  return { valid: issues.length === 0, issues };
}

export function validateBacktestConfig(config: ResearchBacktestConfig): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!config || typeof config !== "object") {
    return { valid: false, issues: [issue("BACKTEST_CONFIG_MISSING", "backtestConfig", "回测配置缺失或非对象")] };
  }
  if (typeof config.initialCapital !== "number" || !Number.isFinite(config.initialCapital) || config.initialCapital <= 0) {
    issues.push(issue("INITIAL_CAPITAL_INVALID", "backtestConfig.initialCapital", "initialCapital 必须是 > 0 的有限数字"));
  }
  if (config.commissionRate !== undefined && (typeof config.commissionRate !== "number" || !Number.isFinite(config.commissionRate) || config.commissionRate < 0)) {
    issues.push(issue("COMMISSION_RATE_INVALID", "backtestConfig.commissionRate", "commissionRate 必须是 >= 0 的有限数字"));
  }
  if (config.slippageRate !== undefined && (typeof config.slippageRate !== "number" || !Number.isFinite(config.slippageRate) || config.slippageRate < 0)) {
    issues.push(issue("SLIPPAGE_RATE_INVALID", "backtestConfig.slippageRate", "slippageRate 必须是 >= 0 的有限数字"));
  }
  if (config.maxPositions !== undefined && (typeof config.maxPositions !== "number" || !Number.isInteger(config.maxPositions) || config.maxPositions < 1)) {
    issues.push(issue("MAX_POSITIONS_INVALID", "backtestConfig.maxPositions", "maxPositions 必须是 >= 1 的整数"));
  }
  if (config.lotSize !== undefined && (typeof config.lotSize !== "number" || !Number.isInteger(config.lotSize) || config.lotSize < 1)) {
    issues.push(issue("LOT_SIZE_INVALID", "backtestConfig.lotSize", "lotSize 必须是 >= 1 的整数"));
  }
  if (config.executionModel !== undefined && (typeof config.executionModel !== "string" || config.executionModel.trim() === "")) {
    issues.push(issue("EXECUTION_MODEL_INVALID", "backtestConfig.executionModel", "executionModel 若提供必须是非空字符串"));
  }

  // STEP 6.2-FIX-1：校验冻结的 costModel（若提供，必须是完整、可序列化的 CostModel 六字段）。
  if (config.costModel !== undefined) {
    const cost = config.costModel;
    if (cost === null || typeof cost !== "object" || Array.isArray(cost)) {
      issues.push(issue("COST_MODEL_INVALID", "backtestConfig.costModel", "costModel 必须是对象"));
    } else {
      const rateFields: Array<[keyof CostModel, string, string]> = [
        ["commissionRate", "commissionRate", "佣金费率"],
        ["stampDutyRate", "stampDutyRate", "印花税"],
        ["transferFeeRate", "transferFeeRate", "过户费"],
        ["slippageBps", "slippageBps", "滑点基点"],
      ];
      for (const [field, name, label] of rateFields) {
        const value = cost[field];
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
          issues.push(issue("COST_MODEL_RATE_INVALID", `backtestConfig.costModel.${name}`, `${label} 必须是 >= 0 的有限数字`));
        }
      }
      if (typeof cost.minCommission !== "number" || !Number.isFinite(cost.minCommission) || cost.minCommission < 0) {
        issues.push(issue("COST_MODEL_MIN_COMMISSION_INVALID", "backtestConfig.costModel.minCommission", "minCommission 必须是 >= 0 的有限数字"));
      }
      if (typeof cost.lotSize !== "number" || !Number.isInteger(cost.lotSize) || cost.lotSize < 1) {
        issues.push(issue("COST_MODEL_LOT_SIZE_INVALID", "backtestConfig.costModel.lotSize", "lotSize 必须是 >= 1 的整数"));
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 身份 / 实验 / 快照
// ---------------------------------------------------------------------------

export function validateExperimentId(experimentId: string): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (typeof experimentId !== "string" || experimentId.trim() === "") {
    issues.push(issue("EXPERIMENT_ID_EMPTY", "experimentId", "experimentId 不能为空"));
  }
  return { valid: issues.length === 0, issues };
}

export function validateStrategyIdentity(strategyId: string, strategyVersion: string): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (typeof strategyId !== "string" || strategyId.trim() === "") {
    issues.push(issue("STRATEGY_ID_EMPTY", "strategyId", "strategyId 不能为空"));
  }
  if (typeof strategyVersion !== "string" || strategyVersion.trim() === "") {
    issues.push(issue("STRATEGY_VERSION_EMPTY", "strategyVersion", "strategyVersion 不能为空"));
  }
  return { valid: issues.length === 0, issues };
}

/** 校验实验快照（无 status / createdAt）。 */
export function validateExperimentSnapshot(snapshot: ResearchExperimentSnapshot, parameterSchema?: ResearchParameterSchema): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { valid: false, issues: [issue("SNAPSHOT_INVALID", "snapshot", "实验快照缺失或非对象")] };
  }
  issues.push(...validateExperimentId(snapshot.experimentId).issues);
  issues.push(...validateStrategyIdentity(snapshot.strategyId, snapshot.strategyVersion).issues);
  if (snapshot.parameterSet === undefined || snapshot.parameterSet === null || typeof snapshot.parameterSet !== "object" || Array.isArray(snapshot.parameterSet)) {
    issues.push(issue("PARAMETER_SET_INVALID", "parameterSet", "parameterSet 必须是对象"));
  } else if (parameterSchema) {
    issues.push(...validateParameterSet(snapshot.parameterSet, parameterSchema).issues);
  }
  issues.push(...validateDatasetSpec(snapshot.dataset).issues);
  issues.push(...validateFeatureConfig(snapshot.featureConfig).issues);
  issues.push(...validateBacktestConfig(snapshot.backtestConfig).issues);
  return { valid: issues.length === 0, issues };
}

/** 校验完整实验对象（快照字段 + status / createdAt）。 */
export function validateResearchExperiment(experiment: ResearchExperiment, parameterSchema?: ResearchParameterSchema): ResearchValidationResult {
  const base = validateExperimentSnapshot(experiment, parameterSchema);
  const issues: ResearchValidationIssue[] = [...base.issues];

  const validStatuses: string[] = ["created", "running", "completed", "failed"];
  if (experiment.status === undefined || !validStatuses.includes(experiment.status)) {
    issues.push(issue("STATUS_INVALID", "status", `非法实验状态：${String(experiment.status)}`));
  }
  if (typeof experiment.createdAt !== "string" || experiment.createdAt.trim() === "") {
    issues.push(issue("CREATED_AT_INVALID", "createdAt", "createdAt 必须是非空字符串"));
  }
  return { valid: issues.length === 0, issues };
}

/** 校验研究策略定义。 */
export function validateStrategyDefinition(definition: ResearchStrategyDefinition): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!definition || typeof definition !== "object") {
    return { valid: false, issues: [issue("STRATEGY_DEF_INVALID", "strategyDefinition", "策略定义缺失或非对象")] };
  }
  issues.push(...validateStrategyIdentity(definition.strategyId, definition.version).issues);
  if (typeof definition.name !== "string" || definition.name.trim() === "") {
    issues.push(issue("STRATEGY_NAME_EMPTY", "name", "策略 name 不能为空"));
  }
  if (!Array.isArray(definition.requiredFeatures) || definition.requiredFeatures.some((feature) => typeof feature !== "string" || feature.trim() === "")) {
    issues.push(issue("REQUIRED_FEATURES_INVALID", "requiredFeatures", "requiredFeatures 必须是非空字符串数组"));
  }
  if (!Array.isArray(definition.requiredData) || definition.requiredData.some((data) => typeof data !== "string" || data.trim() === "")) {
    issues.push(issue("REQUIRED_DATA_INVALID", "requiredData", "requiredData 必须是非空字符串数组"));
  }
  if (definition.decisionPoint !== "open" && definition.decisionPoint !== "close") {
    issues.push(issue("DECISION_POINT_INVALID", "decisionPoint", `非法 decisionPoint：${String(definition.decisionPoint)}`));
  }
  issues.push(...validateParameterSchema(definition.parameterSchema).issues);
  if (definition.metadata !== undefined) {
    if (definition.metadata === null || typeof definition.metadata !== "object") {
      issues.push(issue("METADATA_INVALID", "metadata", "metadata 必须是对象"));
    } else {
      if (definition.metadata.author !== undefined && typeof definition.metadata.author !== "string") {
        issues.push(issue("METADATA_AUTHOR_INVALID", "metadata.author", "metadata.author 必须是字符串"));
      }
      if (definition.metadata.tags !== undefined && (!Array.isArray(definition.metadata.tags) || definition.metadata.tags.some((tag) => typeof tag !== "string"))) {
        issues.push(issue("METADATA_TAGS_INVALID", "metadata.tags", "metadata.tags 必须是字符串数组"));
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// assert* 便捷入口
// ---------------------------------------------------------------------------

function assertValid(result: ResearchValidationResult): void {
  if (!result.valid) throw new ResearchValidationError(result.issues);
}

export function assertValidResearchExperiment(experiment: ResearchExperiment, parameterSchema?: ResearchParameterSchema): void {
  assertValid(validateResearchExperiment(experiment, parameterSchema));
}

export function assertValidExperimentSnapshot(snapshot: ResearchExperimentSnapshot, parameterSchema?: ResearchParameterSchema): void {
  assertValid(validateExperimentSnapshot(snapshot, parameterSchema));
}

export function assertValidStrategyDefinition(definition: ResearchStrategyDefinition): void {
  assertValid(validateStrategyDefinition(definition));
}
