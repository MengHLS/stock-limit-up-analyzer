/**
 * STEP 10 — Strategy Research Framework 校验层。
 *
 * 全部校验为纯函数，返回结构化结果（不抛错）；另有 assert* 便捷入口在非法时抛
 * ResearchValidationError。禁止静默 fallback / 默认值兜底掩盖问题。
 *
 * 复用 research 层既有 ResearchValidationIssue / ResearchValidationResult /
 * ResearchValidationError，保证错误结构全系统一致。
 */

import type { CostModel } from "../../engine/domain";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
} from "../experimentValidation";
import type {
  ExperimentConfig,
  FeatureProvider,
  RankingConfig,
  ResearchSignal,
  SelectionConfig,
  StrategyContract,
  WinsorizationSpec,
} from "./contract";
import type { DecisionTime, FeatureAvailability } from "./leakage";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 合法信号频率。 */
export const SIGNAL_FREQUENCIES = ["daily", "weekly", "intraday"] as const;

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function result(issues: ResearchValidationIssue[]): ResearchValidationResult {
  return { valid: issues.length === 0, issues };
}

function assertValid(r: ResearchValidationResult): void {
  if (!r.valid) throw new ResearchValidationError(r.issues);
}

// ---------------------------------------------------------------------------
// 时点 / 特征可用性
// ---------------------------------------------------------------------------

export function validateDecisionTime(dt: DecisionTime, path = "decisionTime"): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!dt || typeof dt !== "object") {
    return result([issue("DECISION_TIME_INVALID", path, "决策时点缺失或非对象")]);
  }
  if (typeof dt.date !== "string" || !DATE_RE.test(dt.date)) {
    issues.push(issue("DECISION_TIME_DATE_INVALID", `${path}.date`, "date 必须是 YYYY-MM-DD"));
  }
  if (dt.point !== "open" && dt.point !== "close") {
    issues.push(issue("DECISION_TIME_POINT_INVALID", `${path}.point`, "point 必须是 open 或 close"));
  }
  return result(issues);
}

export function validateFeatureAvailability(avail: FeatureAvailability, path = "availability"): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!avail || typeof avail !== "object") {
    return result([issue("FEATURE_AVAILABILITY_INVALID", path, "特征可用性声明缺失或非对象")]);
  }
  issues.push(...validateDecisionTime(avail.requiredDataThrough, `${path}.requiredDataThrough`).issues);
  issues.push(...validateDecisionTime(avail.availableAt, `${path}.availableAt`).issues);
  return result(issues);
}

// ---------------------------------------------------------------------------
// 策略契约
// ---------------------------------------------------------------------------

export function validateStrategyContract(c: StrategyContract): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!c || typeof c !== "object") {
    return result([issue("STRATEGY_CONTRACT_INVALID", "strategy", "策略契约缺失或非对象")]);
  }
  if (typeof c.strategyId !== "string" || c.strategyId.trim() === "") {
    issues.push(issue("STRATEGY_ID_EMPTY", "strategy.strategyId", "strategyId 不能为空"));
  }
  if (typeof c.strategyVersion !== "string" || c.strategyVersion.trim() === "") {
    issues.push(issue("STRATEGY_VERSION_EMPTY", "strategy.strategyVersion", "strategyVersion 不能为空（版本不可变）"));
  }
  if (typeof c.name !== "string" || c.name.trim() === "") {
    issues.push(issue("STRATEGY_NAME_EMPTY", "strategy.name", "name 不能为空"));
  }
  if (c.description !== undefined && typeof c.description !== "string") {
    issues.push(issue("STRATEGY_DESCRIPTION_INVALID", "strategy.description", "description 必须是字符串"));
  }
  if (!c.parameters || !Array.isArray(c.parameters.parameters)) {
    issues.push(issue("STRATEGY_PARAMETERS_INVALID", "strategy.parameters", "parameters 必须是参数 schema（含 parameters 数组）"));
  }
  if (!Array.isArray(c.requiredData) || c.requiredData.some((d) => typeof d !== "string" || d.trim() === "")) {
    issues.push(issue("STRATEGY_REQUIRED_DATA_INVALID", "strategy.requiredData", "requiredData 必须是非空字符串数组"));
  }
  if (!SIGNAL_FREQUENCIES.includes(c.signalFrequency)) {
    issues.push(issue("STRATEGY_SIGNAL_FREQUENCY_INVALID", "strategy.signalFrequency", `signalFrequency 必须是 ${SIGNAL_FREQUENCIES.join("|")}`));
  }
  return result(issues);
}

// ---------------------------------------------------------------------------
// 信号
// ---------------------------------------------------------------------------

export function validateResearchSignal(s: ResearchSignal): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!s || typeof s !== "object") {
    return result([issue("SIGNAL_INVALID", "signal", "信号缺失或非对象")]);
  }
  if (typeof s.securityId !== "string" || s.securityId.trim() === "") {
    issues.push(issue("SIGNAL_SECURITY_EMPTY", "signal.securityId", "securityId 不能为空"));
  }
  if (typeof s.date !== "string" || !DATE_RE.test(s.date)) {
    issues.push(issue("SIGNAL_DATE_INVALID", "signal.date", "date 必须是 YYYY-MM-DD"));
  }
  if (typeof s.value !== "number" || !Number.isFinite(s.value)) {
    issues.push(issue("SIGNAL_VALUE_NOT_FINITE", "signal.value", "value 必须是有限数字（禁止 NaN/Infinity）"));
  }
  if (s.direction !== "long" && s.direction !== "short" && s.direction !== "neutral") {
    issues.push(issue("SIGNAL_DIRECTION_INVALID", "signal.direction", "direction 必须是 long|short|neutral"));
  }
  if (s.confidence !== undefined && s.confidence !== null && (typeof s.confidence !== "number" || !Number.isFinite(s.confidence))) {
    issues.push(issue("SIGNAL_CONFIDENCE_INVALID", "signal.confidence", "confidence 若提供必须是有限数字"));
  }
  return result(issues);
}

// ---------------------------------------------------------------------------
// Ranking / Winsorization
// ---------------------------------------------------------------------------

export function validateWinsorizationSpec(w: WinsorizationSpec | undefined): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (w === undefined) return result(issues);
  if (!w || typeof w !== "object") {
    return result([issue("WINSORIZATION_INVALID", "winsorization", "winsorization 必须是对象")]);
  }
  if (typeof w.lowerQuantile !== "number" || !Number.isFinite(w.lowerQuantile) || w.lowerQuantile < 0 || w.lowerQuantile > 1) {
    issues.push(issue("WINSORIZATION_LOWER_INVALID", "winsorization.lowerQuantile", "lowerQuantile 必须是 [0,1] 有限数字"));
  }
  if (typeof w.upperQuantile !== "number" || !Number.isFinite(w.upperQuantile) || w.upperQuantile < 0 || w.upperQuantile > 1) {
    issues.push(issue("WINSORIZATION_UPPER_INVALID", "winsorization.upperQuantile", "upperQuantile 必须是 [0,1] 有限数字"));
  }
  if (issues.length === 0 && w.lowerQuantile > w.upperQuantile) {
    issues.push(issue("WINSORIZATION_ORDER", "winsorization", "lowerQuantile 不能大于 upperQuantile"));
  }
  return result(issues);
}

export function validateRankingConfig(c: RankingConfig): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!c || typeof c !== "object") {
    return result([issue("RANKING_CONFIG_INVALID", "ranking", "排序配置缺失或非对象")]);
  }
  if (typeof c.higherIsBetter !== "boolean") {
    issues.push(issue("RANKING_HIGHER_IS_BETTER_INVALID", "ranking.higherIsBetter", "higherIsBetter 必须是 boolean"));
  }
  if (c.tieBreaking !== undefined && c.tieBreaking !== "stable" && c.tieBreaking !== "average") {
    issues.push(issue("RANKING_TIE_BREAKING_INVALID", "ranking.tieBreaking", "tieBreaking 必须是 stable|average"));
  }
  if (c.missingPolicy !== undefined && c.missingPolicy !== "exclude" && c.missingPolicy !== "rankLast") {
    issues.push(issue("RANKING_MISSING_POLICY_INVALID", "ranking.missingPolicy", "missingPolicy 必须是 exclude|rankLast"));
  }
  issues.push(...validateWinsorizationSpec(c.winsorization).issues);
  return result(issues);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function validateSelectionConfig(c: SelectionConfig): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!c || typeof c !== "object" || !c.method || typeof c.method !== "object") {
    return result([issue("SELECTION_CONFIG_INVALID", "selection", "选择配置缺失或非对象")]);
  }
  const m = c.method;
  if (m.kind === "topN") {
    if (typeof m.n !== "number" || !Number.isInteger(m.n) || m.n < 1) {
      issues.push(issue("SELECTION_TOPN_INVALID", "selection.method.n", "topN 的 n 必须是 >= 1 的整数"));
    }
  } else if (m.kind === "topPercentile") {
    if (typeof m.pct !== "number" || !Number.isFinite(m.pct) || m.pct <= 0 || m.pct > 1) {
      issues.push(issue("SELECTION_TOPPCT_INVALID", "selection.method.pct", "topPercentile 的 pct 必须是 (0,1] 有限数字"));
    }
  } else {
    issues.push(issue("SELECTION_METHOD_INVALID", "selection.method.kind", "method.kind 必须是 topN|topPercentile"));
  }
  return result(issues);
}

// ---------------------------------------------------------------------------
// Feature Provider
// ---------------------------------------------------------------------------

export function validateFeatureProvider(p: FeatureProvider): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!p || typeof p !== "object") {
    return result([issue("FEATURE_PROVIDER_INVALID", "featureProvider", "特征提供器缺失或非对象")]);
  }
  if (typeof p.featureId !== "string" || p.featureId.trim() === "") {
    issues.push(issue("FEATURE_ID_EMPTY", "featureProvider.featureId", "featureId 不能为空"));
  }
  if (typeof p.version !== "string" || p.version.trim() === "") {
    issues.push(issue("FEATURE_VERSION_EMPTY", "featureProvider.version", "version 不能为空"));
  }
  issues.push(...validateFeatureAvailability(p.availability, "featureProvider.availability").issues);
  if (typeof p.compute !== "function") {
    issues.push(issue("FEATURE_COMPUTE_INVALID", "featureProvider.compute", "compute 必须是函数"));
  }
  return result(issues);
}

// ---------------------------------------------------------------------------
// Experiment Config
// ---------------------------------------------------------------------------

export function validateExperimentConfig(c: ExperimentConfig): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!c || typeof c !== "object") {
    return result([issue("EXPERIMENT_CONFIG_INVALID", "config", "实验配置缺失或非对象")]);
  }
  if (typeof c.datasetVersion !== "string" || c.datasetVersion.trim() === "") {
    issues.push(issue("CONFIG_DATASET_VERSION_EMPTY", "config.datasetVersion", "datasetVersion 不能为空"));
  }
  if (typeof c.strategyId !== "string" || c.strategyId.trim() === "") {
    issues.push(issue("CONFIG_STRATEGY_ID_EMPTY", "config.strategyId", "strategyId 不能为空"));
  }
  if (typeof c.strategyVersion !== "string" || c.strategyVersion.trim() === "") {
    issues.push(issue("CONFIG_STRATEGY_VERSION_EMPTY", "config.strategyVersion", "strategyVersion 不能为空"));
  }
  if (!c.parameters || typeof c.parameters !== "object" || Array.isArray(c.parameters)) {
    issues.push(issue("CONFIG_PARAMETERS_INVALID", "config.parameters", "parameters 必须是对象"));
  }
  if (!c.universe || typeof c.universe !== "object" || typeof c.universe.universeId !== "string" || c.universe.universeId.trim() === "") {
    issues.push(issue("CONFIG_UNIVERSE_INVALID", "config.universe", "universe.universeId 不能为空"));
  }
  if (
    !c.dateRange || typeof c.dateRange !== "object"
    || typeof c.dateRange.startDate !== "string" || !DATE_RE.test(c.dateRange.startDate)
    || typeof c.dateRange.endDate !== "string" || !DATE_RE.test(c.dateRange.endDate)
  ) {
    issues.push(issue("CONFIG_DATE_RANGE_INVALID", "config.dateRange", "dateRange 必须是含 startDate/endDate(YYYY-MM-DD) 的对象"));
  } else if (c.dateRange.startDate > c.dateRange.endDate) {
    issues.push(issue("CONFIG_DATE_RANGE_REVERSED", "config.dateRange", "startDate 不能晚于 endDate"));
  }
  if (typeof c.randomSeed !== "number" || !Number.isInteger(c.randomSeed)) {
    issues.push(issue("CONFIG_RANDOM_SEED_INVALID", "config.randomSeed", "randomSeed 必须是整数"));
  }

  const cost = c.costModel;
  if (!cost || typeof cost !== "object" || Array.isArray(cost)) {
    issues.push(issue("CONFIG_COST_MODEL_INVALID", "config.costModel", "costModel 必须是完整 CostModel 对象"));
  } else {
    const rates: Array<[keyof CostModel, string]> = [
      ["commissionRate", "佣金费率"],
      ["stampDutyRate", "印花税"],
      ["transferFeeRate", "过户费"],
      ["slippageBps", "滑点基点"],
    ];
    for (const [field, label] of rates) {
      const value = cost[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        issues.push(issue("CONFIG_COST_RATE_INVALID", `config.costModel.${field}`, `${label} 必须是 >= 0 的有限数字`));
      }
    }
    if (typeof cost.minCommission !== "number" || !Number.isFinite(cost.minCommission) || cost.minCommission < 0) {
      issues.push(issue("CONFIG_COST_MIN_COMMISSION_INVALID", "config.costModel.minCommission", "minCommission 必须是 >= 0 的有限数字"));
    }
    if (typeof cost.lotSize !== "number" || !Number.isInteger(cost.lotSize) || cost.lotSize < 1) {
      issues.push(issue("CONFIG_COST_LOT_SIZE_INVALID", "config.costModel.lotSize", "lotSize 必须是 >= 1 的整数"));
    }
  }
  return result(issues);
}

// ---------------------------------------------------------------------------
// assert* 便捷入口
// ---------------------------------------------------------------------------

export function assertValidStrategyContract(c: StrategyContract): void {
  assertValid(validateStrategyContract(c));
}
export function assertValidExperimentConfig(c: ExperimentConfig): void {
  assertValid(validateExperimentConfig(c));
}
export function assertValidFeatureProvider(p: FeatureProvider): void {
  assertValid(validateFeatureProvider(p));
}
export function assertValidRankingConfig(c: RankingConfig): void {
  assertValid(validateRankingConfig(c));
}
export function assertValidSelectionConfig(c: SelectionConfig): void {
  assertValid(validateSelectionConfig(c));
}
export function assertValidDecisionTime(dt: DecisionTime): void {
  assertValid(validateDecisionTime(dt));
}
export function assertValidFeatureAvailability(a: FeatureAvailability): void {
  assertValid(validateFeatureAvailability(a));
}
