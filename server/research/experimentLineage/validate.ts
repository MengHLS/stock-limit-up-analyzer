/**
 * STEP 13 / C-13.3 — Experiment Lineage：§28 齐备性校验器（纯函数）。
 *
 * 机器检查「结果怎么产生的」所需的 15 字段齐备性与形态合法性：
 *   - 结构层：字段存在、类型 / 枚举 / 数组形态 / 数值有限性 / 日期与版本格式；
 *   - 齐备层（requireResolvedRefs=true，默认）：dataset/universe/code/cost/slippage/execution
 *     解析为显式 missing 时给出结构化 issue（缺项即机器可见）；
 *   - 结果层语义（metrics/result 可选）：outcome 为 null 表示「结果谱系尚未挂载」（实验输入
 *     阶段记录，合法）；requireOutcome=true 强制要求已挂载；outcome 一旦存在则深度校验其
 *     metrics/result 形态与一致性（metrics === result.performance、config 与记录输入交叉一致）。
 *
 * 与既有校验体系一致：返回 ResearchValidationResult（不抛错）；assert* 入口非法时抛
 * ResearchValidationError。禁止静默 fallback / 兜底。
 */

import { canonicalStringify } from "../../researchDataset/version";
import { isExperimentIdFormat } from "../experimentIdentity";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
} from "../experimentValidation";
import { isValidCodeVersionFormat } from "./codeVersion";
import {
  EXPERIMENT_LINEAGE_RECORD_KIND,
  EXPERIMENT_LINEAGE_RECORD_VERSION,
  REGIME_UNASSESSED_REASON_CODE,
  isLineageMissingCode,
  type ExperimentLineageCostModelRef,
  type ExperimentLineageRecord,
} from "./types";

// ---------------------------------------------------------------------------
// 校验选项
// ---------------------------------------------------------------------------

export interface ExperimentLineageValidationOptions {
  /** true：要求 outcome（metrics/result）已挂载（结果阶段语义）；默认 false（允许实验输入阶段记录）。 */
  readonly requireOutcome?: boolean;
  /** true：版本/模型 ref 为显式 missing 时报告缺项 issue；默认 true。false 仅做结构检查。 */
  readonly requireResolvedRefs?: boolean;
}

// ---------------------------------------------------------------------------
// 格式常量
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** 内容寻址数据集版本（rd-<builder>-<rowSchema>-<sha256 前 16 hex>，见 researchDataset/version.ts）。 */
export const DATASET_VERSION_FORMAT_RE = /^rd-\d+\.\d+\.\d+-\d+-[0-9a-f]{16}$/;

/** 值是否为合法内容寻址数据集版本。 */
export function isValidDatasetVersionFormat(value: string): boolean {
  return DATASET_VERSION_FORMAT_RE.test(value);
}

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function result(issues: ResearchValidationIssue[]): ResearchValidationResult {
  return { valid: issues.length === 0, issues };
}

function assertValid(r: ResearchValidationResult): void {
  if (!r.valid) throw new ResearchValidationError(r.issues);
}

/** 校验日期（YYYY-MM-DD）。 */
function checkDate(value: unknown, path: string, label: string, issues: ResearchValidationIssue[]): void {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    issues.push(issue("LINEAGE_DATE_INVALID", path, `${label} 必须是 YYYY-MM-DD 格式，实际：${String(value)}`));
  }
}

/** 校验 ISO 时间（YYYY-MM-DDTHH:mm:ss[.sss]Z）。 */
function checkDateTime(value: unknown, path: string, label: string, issues: ResearchValidationIssue[]): void {
  if (typeof value !== "string" || !DATE_TIME_RE.test(value)) {
    issues.push(issue("LINEAGE_DATE_TIME_INVALID", path, `${label} 必须是 ISO-8601 UTC 字符串，实际：${String(value)}`));
  }
}

function checkNonEmptyString(value: unknown, path: string, code: string, label: string, issues: ResearchValidationIssue[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(issue(code, path, `${label} 必须是非空字符串，实际：${String(value)}`));
  }
}

// ---------------------------------------------------------------------------
// Ref 检查（resolved | missing）
// ---------------------------------------------------------------------------

/**
 * 检查字符串类 ref。requireResolved=true 时，合法 missing（code 在白名单）也作为缺项 issue 上报；
 * requireResolved=false（结构档）时 missing 仅需形状合法（code+reason），不上报缺项。
 */
function checkStringRefIssues(
  ref: unknown,
  path: string,
  label: string,
  requireResolved: boolean,
  checkFormat?: (value: string) => boolean,
  formatIssueCode?: string,
): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];
  if (ref === null || typeof ref !== "object") {
    issues.push(issue("LINEAGE_REF_INVALID", path, `${label} 引用缺失或非对象`));
    return issues;
  }
  const refObj = ref as { kind?: unknown; value?: unknown; code?: unknown; reason?: unknown };
  if (refObj.kind === "resolved") {
    const value = refObj.value;
    if (typeof value !== "string" || value.trim() === "") {
      issues.push(issue("LINEAGE_REF_VALUE_EMPTY", path, `${label} resolved.value 必须是非空字符串`));
    } else if (checkFormat !== undefined && !checkFormat(value)) {
      issues.push(issue(formatIssueCode ?? "LINEAGE_REF_FORMAT_INVALID", path, `${label} resolved.value 格式非法：${value}`));
    }
    return issues;
  }
  if (refObj.kind === "missing") {
    if (typeof refObj.reason !== "string" || refObj.reason.trim() === "") {
      issues.push(issue("LINEAGE_MISSING_REASON_EMPTY", path, `${label} missing.reason 必须是非空字符串`));
    }
    if (typeof refObj.code !== "string" || !isLineageMissingCode(refObj.code)) {
      issues.push(issue("LINEAGE_MISSING_CODE_INVALID", path, `${label} missing.code 不在 LINEAGE_MISSING_CODES 白名单：${String(refObj.code)}`));
    } else if (requireResolved) {
      issues.push(issue(refObj.code, path, `§28 ${label} 未解析（记录显式标记 missing）：${String(refObj.reason)}`));
    }
    return issues;
  }
  issues.push(issue("LINEAGE_REF_KIND_INVALID", path, `${label} 引用 kind 必须是 resolved | missing，实际：${String(refObj.kind)}`));
  return issues;
}

/** CostModel 数值口径校验（复用于 costModel ref 与 result.config.cost）。 */
function checkCostModelObject(cost: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (cost === null || typeof cost !== "object" || Array.isArray(cost)) {
    issues.push(issue("LINEAGE_COST_MODEL_INVALID", path, "成本模型必须是对象"));
    return;
  }
  const model = cost as Record<string, unknown>;
  for (const [field, label] of [
    ["commissionRate", "佣金费率"],
    ["stampDutyRate", "印花税"],
    ["transferFeeRate", "过户费"],
    ["slippageBps", "滑点基点"],
    ["minCommission", "最低佣金"],
  ] as const) {
    const value = model[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      issues.push(issue("LINEAGE_COST_RATE_INVALID", `${path}.${field}`, `${label} 必须是 >= 0 的有限数字`));
    }
  }
  const lotSize = model.lotSize;
  if (typeof lotSize !== "number" || !Number.isInteger(lotSize) || lotSize < 1) {
    issues.push(issue("LINEAGE_COST_LOT_SIZE_INVALID", `${path}.lotSize`, "lotSize 必须是 >= 1 的整数"));
  }
}

/** 绩效指标数值口径（部分字段允许 null；全字段禁 NaN/Infinity）。 */
const NULLABLE_METRICS_FIELDS = new Set([
  "annualizedReturnPct",
  "annualizedVolatilityPct",
  "sharpeRatio",
  "winRatePct",
  "profitFactor",
  "averageWin",
  "averageLoss",
  "expectancy",
]);

function checkMetricsObject(metrics: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (metrics === null || typeof metrics !== "object" || Array.isArray(metrics)) {
    issues.push(issue("LINEAGE_METRICS_INVALID", path, "绩效指标必须是对象"));
    return;
  }
  const m = metrics as Record<string, unknown>;
  for (const [field, label] of [
    ["totalReturnPct", "累计收益"],
    ["annualizedReturnPct", "年化收益"],
    ["annualizedVolatilityPct", "年化波动"],
    ["sharpeRatio", "夏普"],
    ["maxDrawdownPct", "最大回撤"],
    ["tradeCount", "成交笔数"],
    ["completedTradeCount", "已完成笔数"],
    ["winRatePct", "胜率"],
    ["profitFactor", "盈亏比"],
    ["averageWin", "平均盈利"],
    ["averageLoss", "平均亏损"],
    ["expectancy", "期望"],
    ["openPositionCount", "期末未平仓数"],
  ] as const) {
    const value: unknown = m[field];
    if (value === null && NULLABLE_METRICS_FIELDS.has(field)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(issue("LINEAGE_METRICS_FIELD_INVALID", `${path}.${field}`, `${label} 必须是有限数字（允许 null 的字段除外）`));
    }
  }
}

// ---------------------------------------------------------------------------
// 主校验
// ---------------------------------------------------------------------------

export function validateExperimentLineageRecord(
  record: ExperimentLineageRecord | null | undefined,
  options?: ExperimentLineageValidationOptions,
): ResearchValidationResult {
  const requireOutcome = options?.requireOutcome ?? false;
  const requireResolvedRefs = options?.requireResolvedRefs ?? true;
  const issues: ResearchValidationIssue[] = [];

  if (record === null || typeof record !== "object") {
    return result([issue("LINEAGE_RECORD_INVALID", "record", "谱系记录缺失或非对象")]);
  }
  const r = record as unknown as ExperimentLineageRecord;

  // -- 记录书签 --
  if (r.recordKind !== EXPERIMENT_LINEAGE_RECORD_KIND) {
    issues.push(issue("LINEAGE_KIND_INVALID", "recordKind", `recordKind 必须是 ${EXPERIMENT_LINEAGE_RECORD_KIND}，实际：${String(r.recordKind)}`));
  }
  if (r.recordVersion !== EXPERIMENT_LINEAGE_RECORD_VERSION) {
    issues.push(issue("LINEAGE_VERSION_INVALID", "recordVersion", `recordVersion 必须是 ${EXPERIMENT_LINEAGE_RECORD_VERSION}，实际：${String(r.recordVersion)}`));
  }

  // -- §28 身份 --
  if (typeof r.experimentId !== "string" || !isExperimentIdFormat(r.experimentId)) {
    issues.push(issue("LINEAGE_EXPERIMENT_ID_INVALID", "experimentId", `experimentId 必须匹配 EXP-YYYYMMDD-XXXXXXXX 形态，实际：${String(r.experimentId)}`));
  }
  checkNonEmptyString(r.strategyId, "strategyId", "LINEAGE_STRATEGY_ID_EMPTY", "strategyId", issues);
  checkNonEmptyString(r.strategyVersion, "strategyVersion", "LINEAGE_STRATEGY_VERSION_EMPTY", "strategyVersion", issues);

  // -- §28 版本 ref（dataset 带格式校验；universe/code 见各 check） --
  issues.push(...checkStringRefIssues(r.datasetVersion, "datasetVersion", "dataset_version", requireResolvedRefs, isValidDatasetVersionFormat, "LINEAGE_DATASET_VERSION_FORMAT_INVALID"));
  issues.push(...checkStringRefIssues(r.universeVersion, "universeVersion", "universe_version", requireResolvedRefs));
  issues.push(...checkStringRefIssues(r.codeVersion, "codeVersion", "code_version", requireResolvedRefs, isValidCodeVersionFormat, "LINEAGE_CODE_VERSION_FORMAT_INVALID"));

  // -- §28 参数集 --
  const parameterSet = r.parameterSet as unknown;
  if (parameterSet === null || typeof parameterSet !== "object" || Array.isArray(parameterSet)) {
    issues.push(issue("LINEAGE_PARAMETER_SET_INVALID", "parameterSet", "parameterSet 必须是参数值对象"));
  } else {
    for (const [name, value] of Object.entries(parameterSet as Record<string, unknown>)) {
      const scalar = value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean";
      if (!scalar) {
        issues.push(issue("LINEAGE_PARAMETER_VALUE_INVALID", `parameterSet.${name}`, "参数值不是可序列化原子值（number/string/boolean/null）"));
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        issues.push(issue("LINEAGE_PARAMETER_NAN", `parameterSet.${name}`, "参数值禁止 NaN/Infinity"));
      }
    }
  }

  // -- §28 日期窗口 --
  const dateRange = r.dateRange as unknown;
  if (dateRange === null || typeof dateRange !== "object") {
    issues.push(issue("LINEAGE_DATE_RANGE_INVALID", "dateRange", "dateRange 缺失或非对象"));
  } else {
    const range = dateRange as { startDate?: unknown; endDate?: unknown };
    checkDate(range.startDate, "dateRange.startDate", "dateRange.startDate", issues);
    checkDate(range.endDate, "dateRange.endDate", "dateRange.endDate", issues);
    if (typeof range.startDate === "string" && typeof range.endDate === "string" && DATE_RE.test(range.startDate) && DATE_RE.test(range.endDate)) {
      if (range.startDate > range.endDate) {
        issues.push(issue("LINEAGE_DATE_RANGE_REVERSED", "dateRange", `startDate(${range.startDate}) 晚于 endDate(${range.endDate})`));
      }
    }
  }

  // -- §28 成本模型 --
  checkCostModelRefIssues(r.costModel, requireResolvedRefs, issues);

  // -- §28 滑点模型 --
  checkSlippageRefIssues(r.slippageModel, r.costModel, requireResolvedRefs, issues);

  // -- §28 执行模型 --
  issues.push(...checkStringRefIssues(r.executionModel, "executionModel", "execution_model", requireResolvedRefs));

  // -- §28 regime --
  checkRegimeIssues(r.regime as unknown, issues);

  // -- §28 metrics/result（outcome 挂载语义） --
  checkOutcomeIssues(r, requireOutcome, issues);

  // -- §28 createdAt --
  checkDateTime(r.createdAt, "createdAt", "createdAt", issues);

  // -- fingerprint --
  checkNonEmptyString(r.fingerprint, "fingerprint", "LINEAGE_FINGERPRINT_EMPTY", "fingerprint", issues);

  return result(issues);
}

/** assert*：非法即抛 ResearchValidationError。 */
export function assertValidExperimentLineageRecord(
  record: ExperimentLineageRecord | null | undefined,
  options?: ExperimentLineageValidationOptions,
): void {
  assertValid(validateExperimentLineageRecord(record, options));
}

// ---------------------------------------------------------------------------
// 分块检查
// ---------------------------------------------------------------------------

function checkMissingOrValidRef(
  ref: unknown,
  path: string,
  label: string,
  requireResolved: boolean,
  issues: ResearchValidationIssue[],
): void {
  issues.push(...checkStringRefIssues(ref, path, label, requireResolved));
}

function checkCostModelRefIssues(ref: unknown, requireResolved: boolean, issues: ResearchValidationIssue[]): void {
  if (ref === null || typeof ref !== "object") {
    issues.push(issue("LINEAGE_COST_REF_INVALID", "costModel", "costModel 引用缺失或非对象"));
    return;
  }
  const refObj = ref as { kind?: unknown };
  if (refObj.kind === "frozen") {
    const model = (ref as { model?: unknown }).model;
    checkCostModelObject(model, "costModel.model", issues);
    return;
  }
  checkMissingOrValidRef(ref, "costModel", "cost_model", requireResolved, issues);
}

function checkSlippageRefIssues(
  ref: unknown,
  costModelRef: ExperimentLineageCostModelRef | unknown,
  requireResolved: boolean,
  issues: ResearchValidationIssue[],
): void {
  if (ref === null || typeof ref !== "object") {
    issues.push(issue("LINEAGE_SLIPPAGE_REF_INVALID", "slippageModel", "slippageModel 引用缺失或非对象"));
    return;
  }
  const refObj = ref as { kind?: unknown; model?: unknown; slippageBps?: unknown };
  if (refObj.kind === "resolved") {
    if (refObj.model !== "fixed-bps") {
      issues.push(issue("LINEAGE_SLIPPAGE_MODEL_INVALID", "slippageModel.model", `滑点模型必须为 fixed-bps（当前引擎唯一实现），实际：${String(refObj.model)}`));
    }
    const bps = refObj.slippageBps;
    if (typeof bps !== "number" || !Number.isFinite(bps) || bps < 0) {
      issues.push(issue("LINEAGE_SLIPPAGE_BPS_INVALID", "slippageModel.slippageBps", "slippageBps 必须是 >= 0 的有限数字"));
    }
    // 交叉一致性：滑点必须来自冻结 costModel.slippageBps。
    if (costModelRef !== null && typeof costModelRef === "object" && (costModelRef as { kind?: unknown }).kind === "frozen") {
      const model = (costModelRef as { model?: { slippageBps?: unknown } }).model;
      if (typeof model?.slippageBps === "number" && typeof bps === "number" && model.slippageBps !== bps) {
        issues.push(issue("LINEAGE_SLIPPAGE_COST_MISMATCH", "slippageModel", `slippageModel.slippageBps(${bps}) 与冻结 costModel.slippageBps(${model.slippageBps}) 不一致`));
      }
    }
    return;
  }
  checkMissingOrValidRef(ref, "slippageModel", "slippage_model", requireResolved, issues);
}

function checkRegimeIssues(regime: unknown, issues: ResearchValidationIssue[]): void {
  if (regime === null || typeof regime !== "object") {
    issues.push(issue("LINEAGE_REGIME_INVALID", "regime", "regime 缺失或非对象（C-22.1 前必须显式 unassessed 占位，不可缺省）"));
    return;
  }
  const kind = (regime as { kind?: unknown }).kind;
  if (kind === "assessed") {
    checkNonEmptyString((regime as { regimeId?: unknown }).regimeId, "regime.regimeId", "LINEAGE_REGIME_ID_EMPTY", "regime.regimeId（assessed）", issues);
    const note = (regime as { note?: unknown }).note;
    if (note !== undefined && (typeof note !== "string" || note.trim() === "")) {
      issues.push(issue("LINEAGE_REGIME_NOTE_INVALID", "regime.note", "regime.note 若提供必须是非空字符串"));
    }
    return;
  }
  if (kind === "unassessed") {
    const reasonCode = (regime as { reasonCode?: unknown }).reasonCode;
    if (reasonCode !== REGIME_UNASSESSED_REASON_CODE) {
      issues.push(issue("LINEAGE_REGIME_REASON_CODE_INVALID", "regime.reasonCode", `unassessed reasonCode 必须是 ${REGIME_UNASSESSED_REASON_CODE}，实际：${String(reasonCode)}`));
    }
    checkNonEmptyString((regime as { reason?: unknown }).reason, "regime.reason", "LINEAGE_REGIME_REASON_EMPTY", "regime.reason（unassessed 原因）", issues);
    return;
  }
  issues.push(issue("LINEAGE_REGIME_KIND_INVALID", "regime.kind", `regime.kind 必须是 assessed | unassessed，实际：${String(kind)}`));
}

function checkOutcomeIssues(record: ExperimentLineageRecord, requireOutcome: boolean, issues: ResearchValidationIssue[]): void {
  const outcome = record.outcome as unknown;
  if (outcome === null) {
    if (requireOutcome) {
      issues.push(issue("LINEAGE_OUTCOME_REQUIRED", "outcome", "已要求结果谱系（metrics/result）但 outcome 为 null（运行结果未挂载）"));
    }
    return;
  }
  if (typeof outcome !== "object" || Array.isArray(outcome)) {
    issues.push(issue("LINEAGE_OUTCOME_INVALID", "outcome", "outcome 必须是对象或 null"));
    return;
  }
  const o = outcome as {
    runId?: unknown;
    status?: unknown;
    metrics?: unknown;
    result?: unknown;
    recordedAt?: unknown;
  };
  checkNonEmptyString(o.runId, "outcome.runId", "LINEAGE_OUTCOME_RUN_ID_EMPTY", "outcome.runId", issues);
  if (o.status !== "succeeded") {
    issues.push(issue("LINEAGE_OUTCOME_STATUS_INVALID", "outcome.status", `outcome 只允许挂载 succeeded 运行结果，实际：${String(o.status)}`));
  }
  checkDateTime(o.recordedAt, "outcome.recordedAt", "outcome.recordedAt", issues);
  checkMetricsObject(o.metrics, "outcome.metrics", issues);

  const resultSummary = o.result;
  if (resultSummary === null || typeof resultSummary !== "object" || Array.isArray(resultSummary)) {
    issues.push(issue("LINEAGE_OUTCOME_RESULT_INVALID", "outcome.result", "outcome.result 必须是运行结果摘要对象"));
    return;
  }
  const rs = resultSummary as {
    metadata?: unknown;
    config?: unknown;
    performance?: unknown;
    finalEquity?: unknown;
  };
  const finalEquity = rs.finalEquity;
  if (typeof finalEquity !== "number" || !Number.isFinite(finalEquity)) {
    issues.push(issue("LINEAGE_OUTCOME_FINAL_EQUITY_INVALID", "outcome.result.finalEquity", "finalEquity 必须是有限数字"));
  }

  // metadata 形态。
  const metadata = rs.metadata as Record<string, unknown> | null | undefined;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    issues.push(issue("LINEAGE_OUTCOME_METADATA_INVALID", "outcome.result.metadata", "result.metadata 必须是对象"));
  } else {
    checkNonEmptyString(metadata.strategyId, "outcome.result.metadata.strategyId", "LINEAGE_OUTCOME_METADATA_STRING_INVALID", "metadata.strategyId", issues);
    checkNonEmptyString(metadata.strategyVersion, "outcome.result.metadata.strategyVersion", "LINEAGE_OUTCOME_METADATA_STRING_INVALID", "metadata.strategyVersion", issues);
    checkDate(metadata.startDate, "outcome.result.metadata.startDate", "metadata.startDate", issues);
    checkDate(metadata.endDate, "outcome.result.metadata.endDate", "metadata.endDate", issues);
    if (typeof metadata.initialCapital !== "number" || !Number.isFinite(metadata.initialCapital) || metadata.initialCapital <= 0) {
      issues.push(issue("LINEAGE_OUTCOME_INITIAL_CAPITAL_INVALID", "outcome.result.metadata.initialCapital", "metadata.initialCapital 必须是 > 0 的有限数字"));
    }
    checkNonEmptyString(metadata.generatedAt, "outcome.result.metadata.generatedAt", "LINEAGE_OUTCOME_METADATA_STRING_INVALID", "metadata.generatedAt", issues);
  }

  // config 形态 + 与记录输入交叉一致。
  const config = rs.config as Record<string, unknown> | null | undefined;
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    issues.push(issue("LINEAGE_OUTCOME_CONFIG_INVALID", "outcome.result.config", "result.config 必须是回测配置对象"));
  } else {
    checkNonEmptyString(config.strategyId, "outcome.result.config.strategyId", "LINEAGE_OUTCOME_CONFIG_STRING_INVALID", "config.strategyId", issues);
    checkNonEmptyString(config.strategyVersion, "outcome.result.config.strategyVersion", "LINEAGE_OUTCOME_CONFIG_STRING_INVALID", "config.strategyVersion", issues);
    checkDate(config.startDate, "outcome.result.config.startDate", "config.startDate", issues);
    checkDate(config.endDate, "outcome.result.config.endDate", "config.endDate", issues);
    if (typeof config.initialCapital !== "number" || !Number.isFinite(config.initialCapital) || config.initialCapital <= 0) {
      issues.push(issue("LINEAGE_OUTCOME_CONFIG_INITIAL_CAPITAL_INVALID", "outcome.result.config.initialCapital", "config.initialCapital 必须是 > 0 的有限数字"));
    }
    if (typeof config.maxPositions !== "number" || !Number.isInteger(config.maxPositions) || config.maxPositions < 1) {
      issues.push(issue("LINEAGE_OUTCOME_CONFIG_MAX_POSITIONS_INVALID", "outcome.result.config.maxPositions", "config.maxPositions 必须是 >= 1 的整数"));
    }
    const amountRatio = config.maxPositionAmountRatio;
    if (typeof amountRatio !== "number" || !Number.isFinite(amountRatio) || amountRatio < 0) {
      issues.push(issue("LINEAGE_OUTCOME_CONFIG_AMOUNT_RATIO_INVALID", "outcome.result.config.maxPositionAmountRatio", "maxPositionAmountRatio 必须是 >= 0 的有限数字"));
    }
    checkCostModelObject(config.cost, "outcome.result.config.cost", issues);

    const strategyMatched =
      config.strategyId === record.strategyId && config.strategyVersion === record.strategyVersion;
    if (!strategyMatched) {
      issues.push(issue(
        "LINEAGE_OUTCOME_CONFIG_STRATEGY_MISMATCH",
        "outcome.result.config",
        `result.config 策略身份（${String(config.strategyId)}@${String(config.strategyVersion)}）与记录（${record.strategyId}@${record.strategyVersion}）不一致`,
      ));
    }
    const windowMatched =
      (typeof config.startDate !== "string" || !DATE_RE.test(config.startDate) || config.startDate === record.dateRange.startDate)
      && (typeof config.endDate !== "string" || !DATE_RE.test(config.endDate) || config.endDate === record.dateRange.endDate);
    if (!windowMatched) {
      issues.push(issue(
        "LINEAGE_OUTCOME_CONFIG_DATE_MISMATCH",
        "outcome.result.config",
        `result.config 窗口（${String(config.startDate)}~${String(config.endDate)}）与记录 dateRange（${record.dateRange.startDate}~${record.dateRange.endDate}）不一致`,
      ));
    }
  }

  // performance 形态 + metrics 一致性。
  checkMetricsObject(rs.performance, "outcome.result.performance", issues);
  if (o.metrics !== undefined && o.metrics !== null && typeof o.metrics === "object") {
    const metrics = o.metrics as unknown;
    if (rs.performance !== null && typeof rs.performance === "object" && canonicalStringify(metrics) !== canonicalStringify(rs.performance)) {
      issues.push(issue("LINEAGE_OUTCOME_METRICS_MISMATCH", "outcome.metrics", "outcome.metrics 必须等于 result.performance（§28 metrics 与 result 同一结果口径）"));
    }
  }

  // 成本模型交叉一致：记录冻结 costModel === result.config.cost。
  const costRef = record.costModel as unknown;
  if (costRef !== null && typeof costRef === "object" && (costRef as { kind?: unknown }).kind === "frozen" && config !== null && typeof config === "object") {
    const frozen = (costRef as { model?: unknown }).model;
    const runCost = (config as Record<string, unknown>).cost;
    if (frozen !== undefined && runCost !== undefined && canonicalStringify(frozen) !== canonicalStringify(runCost)) {
      issues.push(issue(
        "LINEAGE_OUTCOME_COST_MISMATCH",
        "outcome.result.config.cost",
        "result.config.cost 与记录冻结 costModel 不一致（运行必须消费创建期冻结的成本口径）",
      ));
    }
  }
}
