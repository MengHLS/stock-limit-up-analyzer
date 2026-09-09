/**
 * STEP 15 / C-15.1 — Strategy Schema + Versioning：校验器（纯函数）。
 *
 * 对齐既有校验体系（experimentValidation / experimentLineage）：返回 ResearchValidationResult
 * （不抛错），assert* 入口非法时抛 ResearchValidationError；禁止静默 fallback / 兜底。
 *
 * 校验对象：
 *   - StrategyDocument（策略本体）：字段齐备与形态 / version 严格 semver / datasetVersion
 *     rd-… 内容寻址格式 / universe 派生一致性 / 声明式规则（id 唯一、kind/operator 白名单、
 *     description 必填）/ positionSizing / parameters schema（复用 validateParameterSchema，
 *     含 defaultValue 自洽）/ executionAssumptions（CostModel 六字段口径 + 执行模型白名单）/
 *     recipe（C-13.2 可序列化面：featureVersions 唯一、ranking/selection 委托 framework 校验）；
 *   - StrategyVersionRecord（§17 追溯记录）：嵌套校验 strategy 本体 + parameterSet 与 schema
 *     一致 + dataset/universe/backtest/cost/execution 顶层追溯字段与 strategy 内字段交叉一致 +
 *     codeVersion 格式（复用 experimentLineage codeVersion 口径）+ createdAt ISO 格式。
 */

import { isValidDatasetVersionFormat } from "../experimentLineage/validate";
import { isValidCodeVersionFormat } from "../experimentLineage/codeVersion";
import { deriveDatasetUniverseId } from "../datasetAccess/handle";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
} from "../experimentValidation";
import { validateParameterSchema, validateParameterSet } from "../experimentValidation";
import { validateRankingConfig, validateSelectionConfig } from "../framework/validation";
import type { RankingConfig, SelectionConfig } from "../framework/contract";
import {
  DECLARED_RULE_KINDS,
  POSITION_SIZING_KINDS,
  RULE_COMPARISON_OPERATORS,
  STRATEGY_DOCUMENT_RECORD_KIND,
  STRATEGY_DOCUMENT_RECORD_VERSION,
  STRATEGY_EXECUTION_MODEL_IDS,
  STRATEGY_VERSION_RECORD_KIND,
  STRATEGY_VERSION_RECORD_VERSION,
  isValidStrategyVersionFormat,
  type StrategyDocument,
  type StrategyVersionRecord,
} from "./types";

const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function result(issues: ResearchValidationIssue[]): ResearchValidationResult {
  return { valid: issues.length === 0, issues };
}

function assertValid(r: ResearchValidationResult): void {
  if (!r.valid) throw new ResearchValidationError(r.issues);
}

/** 把一组 issues 重新挂到指定路径前缀下。 */
function rebase(issues: readonly ResearchValidationIssue[], prefix: string): ResearchValidationIssue[] {
  return issues.map((item) => ({ code: item.code, path: `${prefix}.${item.path}`, message: item.message }));
}

/** 把既有校验器的路径根（如 parameterSchema / rankingConfig）替换为本层字段路径（如 parameters / recipe.rankingConfig）。 */
function remapPath(issues: readonly ResearchValidationIssue[], fromRoot: string, toPrefix: string): ResearchValidationIssue[] {
  return issues.map((item) => {
    const path = item.path === fromRoot || item.path.startsWith(`${fromRoot}.`)
      ? `${toPrefix}${item.path.slice(fromRoot.length)}`
      : `${toPrefix}.${item.path}`;
    return { code: item.code, path, message: item.message };
  });
}

function checkNonEmptyString(
  value: unknown,
  path: string,
  code: string,
  label: string,
  issues: ResearchValidationIssue[],
): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(issue(code, path, `${label} 必须是非空字符串，实际：${String(value)}`));
  }
}

function checkOptionalNonEmptyString(
  value: unknown,
  path: string,
  code: string,
  label: string,
  issues: ResearchValidationIssue[],
): void {
  if (value === undefined || value === null) return;
  checkNonEmptyString(value, path, code, label, issues);
}

function checkFiniteNumber(
  value: unknown,
  path: string,
  code: string,
  label: string,
  issues: ResearchValidationIssue[],
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(issue(code, path, `${label} 必须是有限数字，实际：${String(value)}`));
  }
}

// ---------------------------------------------------------------------------
// CostModel / 声明式规则 / Universe / Execution Assumptions / Recipe
// ---------------------------------------------------------------------------

/** CostModel 六字段口径（引擎/domain 单一事实来源的形态复核）。 */
function checkCostModelObject(cost: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (cost === null || typeof cost !== "object" || Array.isArray(cost)) {
    issues.push(issue("SCHEMA_COST_MODEL_INVALID", path, "成本模型必须是对象"));
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
      issues.push(issue("SCHEMA_COST_RATE_INVALID", `${path}.${field}`, `${label} 必须是 >= 0 的有限数字`));
    }
  }
  const lotSize = model.lotSize;
  if (typeof lotSize !== "number" || !Number.isInteger(lotSize) || lotSize < 1) {
    issues.push(issue("SCHEMA_COST_LOT_SIZE_INVALID", `${path}.lotSize`, "lotSize 必须是 >= 1 的整数"));
  }
}

/** 规则集内 id 唯一 + 描述符形态。 */
function checkRuleList(rules: unknown, pathBase: string, label: string, issues: ResearchValidationIssue[]): void {
  if (rules === null || !Array.isArray(rules)) {
    issues.push(issue("SCHEMA_RULES_NOT_ARRAY", pathBase, `${label} 必须是数组`));
    return;
  }
  const seen = new Set<string>();
  rules.forEach((raw, index) => {
    const base = `${pathBase}[${index}]`;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push(issue("SCHEMA_RULE_INVALID", base, `${label} 第 ${index} 条必须是规则描述符对象`));
      return;
    }
    const rule = raw as Record<string, unknown>;
    const id = rule.id;
    checkNonEmptyString(id, `${base}.id`, "SCHEMA_RULE_ID_EMPTY", `${label} 规则 id`, issues);
    if (typeof id === "string" && id.trim() !== "") {
      if (seen.has(id)) {
        issues.push(issue("SCHEMA_RULE_ID_DUPLICATE", `${base}.id`, `${label} 规则 id=${id} 重复，规则集内必须唯一`));
      }
      seen.add(id);
    }
    const kind = rule.kind;
    if (typeof kind !== "string" || !(DECLARED_RULE_KINDS as readonly string[]).includes(kind)) {
      issues.push(issue(
        "SCHEMA_RULE_KIND_INVALID",
        `${base}.kind`,
        `${label} 规则 kind 必须是 ${DECLARED_RULE_KINDS.join(" | ")} 之一，实际：${String(kind)}`,
      ));
    }
    checkNonEmptyString(rule.description, `${base}.description`, "SCHEMA_RULE_DESCRIPTION_EMPTY", `${label} 规则 description（唯一人类可读语义）`, issues);
    checkOptionalNonEmptyString(rule.field, `${base}.field`, "SCHEMA_RULE_FIELD_EMPTY", `${label} 规则 field`, issues);
    const operator = rule.operator;
    if (operator !== undefined && operator !== null) {
      if (typeof operator !== "string" || !(RULE_COMPARISON_OPERATORS as readonly string[]).includes(operator)) {
        issues.push(issue(
          "SCHEMA_RULE_OPERATOR_INVALID",
          `${base}.operator`,
          `${label} 规则 operator 必须是 ${RULE_COMPARISON_OPERATORS.join(" | ")} 之一，实际：${String(operator)}`,
        ));
      }
    }
    const operand = rule.operand;
    if (operand !== undefined && operand !== null) {
      const scalar = typeof operand === "number" || typeof operand === "string";
      if (!scalar) {
        issues.push(issue("SCHEMA_RULE_OPERAND_INVALID", `${base}.operand`, `${label} 规则 operand 必须是 number | string | null`));
      }
      if (typeof operand === "number" && !Number.isFinite(operand)) {
        issues.push(issue("SCHEMA_RULE_OPERAND_NAN", `${base}.operand`, `${label} 规则 operand 禁止 NaN/Infinity`));
      }
    }
    const note = rule.note;
    if (note !== undefined && note !== null && (typeof note !== "string" || note.trim() === "")) {
      issues.push(issue("SCHEMA_RULE_NOTE_INVALID", `${base}.note`, `${label} 规则 note 若提供必须是非空字符串`));
    }
  });
}

/** Position sizing 声明形态。 */
function checkPositionSizing(positionSizing: unknown, issues: ResearchValidationIssue[]): void {
  if (positionSizing === null || typeof positionSizing !== "object" || Array.isArray(positionSizing)) {
    issues.push(issue("SCHEMA_POSITION_SIZING_INVALID", "positionSizing", "positionSizing 必须是声明对象"));
    return;
  }
  const ps = positionSizing as Record<string, unknown>;
  const kind = ps.kind;
  if (typeof kind !== "string" || !(POSITION_SIZING_KINDS as readonly string[]).includes(kind)) {
    issues.push(issue(
      "SCHEMA_POSITION_SIZING_KIND_INVALID",
      "positionSizing.kind",
      `positionSizing.kind 必须是 ${POSITION_SIZING_KINDS.join(" | ")} 之一，实际：${String(kind)}`,
    ));
    return;
  }
  const maxPositions = ps.maxPositions;
  if (typeof maxPositions !== "number" || !Number.isInteger(maxPositions) || maxPositions < 1) {
    issues.push(issue("SCHEMA_POSITION_SIZING_MAX_INVALID", "positionSizing.maxPositions", "maxPositions 必须是 >= 1 的整数"));
  }
  if (kind === "fixed-fraction") {
    const fraction = ps.fraction;
    if (typeof fraction !== "number" || !Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
      issues.push(issue("SCHEMA_POSITION_SIZING_FRACTION_INVALID", "positionSizing.fraction", "fixed-fraction.fraction 必须是 (0, 1] 的有限数字"));
    }
  }
}

/** Universe 声明 + 与 datasetVersion 的派生一致性。 */
function checkUniverse(universe: unknown, datasetVersion: string | undefined, issues: ResearchValidationIssue[]): void {
  if (universe === null || typeof universe !== "object" || Array.isArray(universe)) {
    issues.push(issue("SCHEMA_UNIVERSE_INVALID", "universe", "universe 必须是声明对象"));
    return;
  }
  const u = universe as Record<string, unknown>;
  checkNonEmptyString(u.universeId, "universe.universeId", "SCHEMA_UNIVERSE_ID_EMPTY", "universeId", issues);
  const universeId = u.universeId as string | undefined;

  const members = u.members;
  if (members !== undefined && members !== null) {
    if (!Array.isArray(members)) {
      issues.push(issue("SCHEMA_UNIVERSE_MEMBERS_INVALID", "universe.members", "universe.members 必须是字符串数组"));
    } else {
      const seen = new Set<string>();
      members.forEach((member, index) => {
        if (typeof member !== "string" || member.trim() === "") {
          issues.push(issue("SCHEMA_UNIVERSE_MEMBER_EMPTY", `universe.members[${index}]`, "universe.members 元素必须是非空字符串"));
        } else if (seen.has(member)) {
          issues.push(issue("SCHEMA_UNIVERSE_MEMBER_DUPLICATE", `universe.members[${index}]`, `universe.members 证券 ${member} 重复`));
        }
        seen.add(member as string);
      });
    }
  }
  checkOptionalNonEmptyString(u.description, "universe.description", "SCHEMA_UNIVERSE_DESCRIPTION_EMPTY", "universe.description", issues);

  // research-dataset 派生 universe 一致性（= deriveDatasetUniverseId(datasetVersion)）。
  if (typeof universeId === "string" && typeof datasetVersion === "string") {
    const derivedPrefix = "research-dataset:";
    if (universeId.startsWith(derivedPrefix)) {
      const suffix = universeId.slice(derivedPrefix.length);
      if (!isValidDatasetVersionFormat(suffix)) {
        issues.push(issue(
          "SCHEMA_UNIVERSE_DERIVED_FORMAT_INVALID",
          "universe.universeId",
          `research-dataset 派生 universeId 的后缀必须是 rd-… 数据集版本，实际：${suffix}`,
        ));
      } else if (suffix !== datasetVersion) {
        issues.push(issue(
          "SCHEMA_UNIVERSE_DATASET_MISMATCH",
          "universe.universeId",
          `派生 universe（${universeId}）引用的数据集版本与 document.datasetVersion（${datasetVersion}）不一致`,
        ));
      } else if (members !== undefined && members !== null && Array.isArray(members) && members.length > 0) {
        issues.push(issue(
          "SCHEMA_UNIVERSE_DERIVED_WITH_MEMBERS",
          "universe.members",
          "research-dataset 派生 universe 的成员由数据集 universeDefinition 决议，禁止同时提供显式 members",
        ));
      }
    }
  }
}

/** Backtest config 声明。 */
function checkBacktestConfig(backtest: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (backtest === null || typeof backtest !== "object" || Array.isArray(backtest)) {
    issues.push(issue("SCHEMA_BACKTEST_CONFIG_INVALID", path, "backtestConfig 必须是对象"));
    return;
  }
  const bt = backtest as Record<string, unknown>;
  const capital = bt.initialCapital;
  if (typeof capital !== "number" || !Number.isFinite(capital) || capital <= 0) {
    issues.push(issue("SCHEMA_BACKTEST_CAPITAL_INVALID", `${path}.initialCapital`, "initialCapital 必须是 > 0 的有限数字"));
  }
  const maxPositions = bt.maxPositions;
  if (maxPositions !== undefined && maxPositions !== null) {
    if (typeof maxPositions !== "number" || !Number.isInteger(maxPositions) || maxPositions < 1) {
      issues.push(issue("SCHEMA_BACKTEST_MAX_POSITIONS_INVALID", `${path}.maxPositions`, "maxPositions 必须是 >= 1 的整数"));
    }
  }
}

/** Execution assumptions（backtest config + costModel + executionModel 白名单）。 */
function checkExecutionAssumptions(assumptions: unknown, issues: ResearchValidationIssue[]): void {
  if (assumptions === null || typeof assumptions !== "object" || Array.isArray(assumptions)) {
    issues.push(issue("SCHEMA_EXECUTION_ASSUMPTIONS_INVALID", "executionAssumptions", "executionAssumptions 必须是对象"));
    return;
  }
  const a = assumptions as Record<string, unknown>;
  checkBacktestConfig(a.backtestConfig, "executionAssumptions.backtestConfig", issues);
  checkCostModelObject(a.costModel, "executionAssumptions.costModel", issues);
  const executionModel = a.executionModel;
  if (typeof executionModel !== "string" || !(STRATEGY_EXECUTION_MODEL_IDS as readonly string[]).includes(executionModel)) {
    issues.push(issue(
      "SCHEMA_EXECUTION_MODEL_INVALID",
      "executionAssumptions.executionModel",
      `executionModel 必须是 ${STRATEGY_EXECUTION_MODEL_IDS.join(" | ")} 之一，实际：${String(executionModel)}`,
    ));
  }
}

/** Recipe（C-13.2 可序列化面）。 */
function checkRecipe(recipe: unknown, issues: ResearchValidationIssue[]): void {
  if (recipe === undefined || recipe === null) return;
  if (typeof recipe !== "object" || Array.isArray(recipe)) {
    issues.push(issue("SCHEMA_RECIPE_INVALID", "recipe", "recipe 必须是对象"));
    return;
  }
  const r = recipe as Record<string, unknown>;
  if (r.kind !== "signalEngine") {
    issues.push(issue("SCHEMA_RECIPE_KIND_INVALID", "recipe.kind", `recipe.kind 必须是 signalEngine（当前唯一载体），实际：${String(r.kind)}`));
  }
  checkNonEmptyString(r.recipeId, "recipe.recipeId", "SCHEMA_RECIPE_ID_EMPTY", "recipe.recipeId", issues);
  if (r.point !== "open" && r.point !== "close") {
    issues.push(issue("SCHEMA_RECIPE_POINT_INVALID", "recipe.point", "recipe.point 必须是 open 或 close"));
  }
  const frequency = r.signalFrequency;
  if (frequency !== "daily" && frequency !== "weekly" && frequency !== "intraday") {
    issues.push(issue("SCHEMA_RECIPE_FREQUENCY_INVALID", "recipe.signalFrequency", "recipe.signalFrequency 必须是 daily | weekly | intraday"));
  }
  checkOptionalNonEmptyString(r.signalDescription, "recipe.signalDescription", "SCHEMA_RECIPE_SIGNAL_DESCRIPTION_EMPTY", "recipe.signalDescription", issues);

  const featureVersions = r.featureVersions;
  if (featureVersions === null || !Array.isArray(featureVersions) || featureVersions.length === 0) {
    issues.push(issue("SCHEMA_RECIPE_FEATURES_EMPTY", "recipe.featureVersions", "recipe.featureVersions 必须是非空数组（C-13.2 链路以特征为起点）"));
  } else {
    const seen = new Set<string>();
    featureVersions.forEach((ref: unknown, index: number) => {
      const base = `recipe.featureVersions[${index}]`;
      if (ref === null || typeof ref !== "object") {
        issues.push(issue("SCHEMA_RECIPE_FEATURE_REF_INVALID", base, "featureVersions 元素必须是 {featureId, version}"));
        return;
      }
      const f = ref as Record<string, unknown>;
      checkNonEmptyString(f.featureId, `${base}.featureId`, "SCHEMA_RECIPE_FEATURE_ID_EMPTY", "featureId", issues);
      checkNonEmptyString(f.version, `${base}.version`, "SCHEMA_RECIPE_FEATURE_VERSION_EMPTY", "feature 版本", issues);
      if (typeof f.featureId === "string" && f.featureId.trim() !== "") {
        if (seen.has(f.featureId)) {
          issues.push(issue("SCHEMA_RECIPE_FEATURE_ID_DUPLICATE", `${base}.featureId`, `featureId=${f.featureId} 重复，配方依赖的特征必须唯一`));
        }
        seen.add(f.featureId);
      }
    });
  }
  const rankingConfig = r.rankingConfig as unknown as RankingConfig;
  issues.push(...rebase(validateRankingConfig(rankingConfig).issues, "recipe.rankingConfig"));
  const selectionConfig = r.selectionConfig as unknown as SelectionConfig;
  issues.push(...rebase(validateSelectionConfig(selectionConfig).issues, "recipe.selectionConfig"));

  const requiredData = r.requiredData;
  if (requiredData === null || !Array.isArray(requiredData)) {
    issues.push(issue("SCHEMA_RECIPE_REQUIRED_DATA_INVALID", "recipe.requiredData", "recipe.requiredData 必须是字符串数组"));
  } else {
    requiredData.forEach((domain, index) => {
      if (typeof domain !== "string" || domain.trim() === "") {
        issues.push(issue("SCHEMA_RECIPE_REQUIRED_DATA_EMPTY", `recipe.requiredData[${index}]`, "requiredData 元素必须是非空字符串"));
      }
    });
  }
}

/** 元数据（author / tags）。 */
function checkMetadata(metadata: unknown, issues: ResearchValidationIssue[]): void {
  if (metadata === undefined || metadata === null) return;
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    issues.push(issue("SCHEMA_METADATA_INVALID", "metadata", "metadata 必须是对象"));
    return;
  }
  const m = metadata as Record<string, unknown>;
  checkOptionalNonEmptyString(m.author, "metadata.author", "SCHEMA_METADATA_AUTHOR_EMPTY", "metadata.author", issues);
  const tags = m.tags;
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || tag.trim() === "")) {
      issues.push(issue("SCHEMA_METADATA_TAGS_INVALID", "metadata.tags", "metadata.tags 必须是非空字符串数组"));
    }
  }
}

// ---------------------------------------------------------------------------
// 主校验：StrategyDocument
// ---------------------------------------------------------------------------

/**
 * 校验 §16 策略本体（结构化 issue 清单）。
 * 缺字段 / version 或 datasetVersion 格式非法 / 参数 schema 自洽性（defaultValue 越界、
 * min>max 等，委托 validateParameterSchema）/ universe 派生一致性 / 规则与执行假设形态，全部覆盖。
 */
export function validateStrategyDocument(document: StrategyDocument | undefined | null): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return result([issue("SCHEMA_DOCUMENT_INVALID", "document", "策略本体缺失或非对象")]);
  }
  const d = document as unknown as StrategyDocument;

  // -- 书签 --
  if (d.recordKind !== STRATEGY_DOCUMENT_RECORD_KIND) {
    issues.push(issue("SCHEMA_KIND_INVALID", "recordKind", `recordKind 必须是 ${STRATEGY_DOCUMENT_RECORD_KIND}，实际：${String(d.recordKind)}`));
  }
  if (d.recordVersion !== STRATEGY_DOCUMENT_RECORD_VERSION) {
    issues.push(issue("SCHEMA_RECORD_VERSION_INVALID", "recordVersion", `recordVersion 必须是 ${STRATEGY_DOCUMENT_RECORD_VERSION}，实际：${String(d.recordVersion)}`));
  }

  // -- §16 身份 --
  checkNonEmptyString(d.strategyId, "strategyId", "SCHEMA_STRATEGY_ID_EMPTY", "strategyId", issues);
  if (typeof d.version !== "string" || !isValidStrategyVersionFormat(d.version)) {
    issues.push(issue(
      "SCHEMA_VERSION_INVALID",
      "version",
      `version 必须是 major.minor.patch 且禁止前导零（如 1.0.0，兼容 §17 V1.0/V1.1/V2.0 语义），实际：${String(d.version)}`,
    ));
  }
  checkNonEmptyString(d.name, "name", "SCHEMA_NAME_EMPTY", "策略 name", issues);
  checkOptionalNonEmptyString(d.description, "description", "SCHEMA_DESCRIPTION_EMPTY", "description", issues);

  // -- §16 rules --
  checkUniverse(d.universe as unknown, d.datasetVersion as string | undefined, issues);
  checkRuleList(d.entryRules as unknown, "entryRules", "entryRules", issues);
  checkRuleList(d.exitRules as unknown, "exitRules", "exitRules", issues);
  checkRuleList(d.riskRules as unknown, "riskRules", "riskRules", issues);
  checkPositionSizing(d.positionSizing as unknown, issues);

  // -- §16 参数空间（含 defaultValue 自洽，非法即结构化 issue） --
  const parameters = d.parameters as unknown;
  if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) {
    issues.push(issue("SCHEMA_PARAMETERS_INVALID", "parameters", "parameters 必须是参数 schema 对象"));
  } else {
    issues.push(...remapPath(validateParameterSchema(d.parameters).issues, "parameterSchema", "parameters"));
  }

  // -- §16 dataset 绑定（C-12.6.1 rd-… 内容寻址格式） --
  if (typeof d.datasetVersion !== "string" || !isValidDatasetVersionFormat(d.datasetVersion)) {
    issues.push(issue(
      "SCHEMA_DATASET_VERSION_INVALID",
      "datasetVersion",
      `datasetVersion 必须是 rd-… 内容寻址数据集版本（rd-<builder>-<rowSchema>-<sha256 前 16 hex>），实际：${String(d.datasetVersion)}`,
    ));
  }

  // -- §16 execution assumptions --
  checkExecutionAssumptions(d.executionAssumptions as unknown, issues);

  // -- 执行配方引用（可选） --
  checkRecipe(d.recipe as unknown, issues);

  // -- 元数据 / 指纹 --
  checkMetadata(d.metadata as unknown, issues);
  if (typeof d.fingerprint !== "string" || d.fingerprint.trim() === "") {
    issues.push(issue("SCHEMA_FINGERPRINT_EMPTY", "fingerprint", "fingerprint 必须是非空字符串"));
  }

  return result(issues);
}

/** 策略本体非法即抛 ResearchValidationError。 */
export function assertValidStrategyDocument(document: StrategyDocument | undefined | null): void {
  assertValid(validateStrategyDocument(document));
}

// ---------------------------------------------------------------------------
// 主校验：StrategyVersionRecord（§17 追溯记录）
// ---------------------------------------------------------------------------

/** 顶层追溯字段与 strategy 内对应字段的一致性检查（canonical 比较）。 */
function checkTopLevelConsistency(record: StrategyVersionRecord, issues: ResearchValidationIssue[]): void {
  const doc = record.strategy;
  const canonicalDoc = (value: unknown): string => JSON.stringify(value, null, 0);
  const left = (value: unknown, right: unknown, path: string, code: string, label: string): void => {
    if (canonicalDoc(value) !== canonicalDoc(right)) {
      issues.push(issue(code, path, `${label} 与 strategy 内对应字段不一致（§17 追溯字段必须是本版本 strategy 的投影）`));
    }
  };
  if (typeof doc === "object" && doc !== null) {
    const s = doc as unknown as StrategyDocument;
    if (typeof record.datasetVersion === "string" && typeof s.datasetVersion === "string") {
      left(record.datasetVersion, s.datasetVersion, "datasetVersion", "SCHEMA_RECORD_DATASET_MISMATCH", "datasetVersion");
    }
    if (typeof record.universeId === "string" && typeof s.universe?.universeId === "string") {
      left(record.universeId, s.universe.universeId, "universeId", "SCHEMA_RECORD_UNIVERSE_MISMATCH", "universeId");
    }
    const assumptions = s.executionAssumptions as unknown as Record<string, unknown> | null | undefined;
    if (record.backtestConfig !== null && typeof record.backtestConfig === "object" && assumptions?.backtestConfig !== undefined) {
      left(record.backtestConfig, assumptions.backtestConfig, "backtestConfig", "SCHEMA_RECORD_BACKTEST_MISMATCH", "backtestConfig");
    }
    if (record.costModel !== null && typeof record.costModel === "object" && assumptions?.costModel !== undefined) {
      left(record.costModel, assumptions.costModel, "costModel", "SCHEMA_RECORD_COST_MODEL_MISMATCH", "costModel");
    }
    if (typeof record.executionModel === "string" && typeof assumptions?.executionModel === "string") {
      left(record.executionModel, assumptions.executionModel, "executionModel", "SCHEMA_RECORD_EXECUTION_MODEL_MISMATCH", "executionModel");
    }
  }
}

/**
 * 校验 §17 版本追溯记录。
 * 嵌套校验 strategy 本体 + parameterSet 与 schema 一致 + 顶层追溯字段与 strategy 交叉一致 +
 * codeVersion（复用 experimentLineage 口径）与 createdAt（ISO-8601 UTC）格式。
 */
export function validateStrategyVersionRecord(record: StrategyVersionRecord | undefined | null): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return result([issue("SCHEMA_RECORD_INVALID", "record", "版本追溯记录缺失或非对象")]);
  }
  const r = record as unknown as StrategyVersionRecord;

  // -- 书签 --
  if (r.recordKind !== STRATEGY_VERSION_RECORD_KIND) {
    issues.push(issue("SCHEMA_RECORD_KIND_INVALID", "recordKind", `recordKind 必须是 ${STRATEGY_VERSION_RECORD_KIND}，实际：${String(r.recordKind)}`));
  }
  if (r.recordVersion !== STRATEGY_VERSION_RECORD_VERSION) {
    issues.push(issue("SCHEMA_RECORD_VERSION_INVALID", "recordVersion", `recordVersion 必须是 ${STRATEGY_VERSION_RECORD_VERSION}，实际：${String(r.recordVersion)}`));
  }

  // -- §17 身份 --
  checkNonEmptyString(r.strategyId, "strategyId", "SCHEMA_RECORD_STRATEGY_ID_EMPTY", "strategyId", issues);
  if (typeof r.version !== "string" || !isValidStrategyVersionFormat(r.version)) {
    issues.push(issue("SCHEMA_RECORD_VERSION_INVALID", "version", "version 必须是合法 major.minor.patch 版本号"));
  }
  if (typeof r.strategyId === "string" && typeof r.strategy?.strategyId === "string" && r.strategyId !== r.strategy.strategyId) {
    issues.push(issue("SCHEMA_RECORD_STRATEGY_ID_MISMATCH", "strategyId", "顶层 strategyId 与 strategy.strategyId 不一致"));
  }
  if (typeof r.version === "string" && typeof r.strategy?.version === "string" && r.version !== r.strategy.version) {
    issues.push(issue("SCHEMA_RECORD_VERSION_MISMATCH", "version", "顶层 version 与 strategy.version 不一致"));
  }

  // -- §17 strategy（完整本体嵌套校验） --
  if (r.strategy === null || typeof r.strategy !== "object") {
    issues.push(issue("SCHEMA_RECORD_STRATEGY_MISSING", "strategy", "strategy 快照缺失或非对象"));
  } else {
    issues.push(...rebase(validateStrategyDocument(r.strategy).issues, "strategy"));
  }

  // -- §17 parameters（与 strategy.parameters schema 一致） --
  const parameterSet = r.parameterSet as unknown;
  const strategyParameters = (r.strategy as unknown as StrategyDocument | null | undefined)?.parameters as unknown;
  if (parameterSet === null || typeof parameterSet !== "object" || Array.isArray(parameterSet)) {
    issues.push(issue("SCHEMA_RECORD_PARAMETER_SET_INVALID", "parameterSet", "parameterSet 必须是参数值对象"));
  } else if (
    strategyParameters !== null && typeof strategyParameters === "object"
    && (strategyParameters as { parameters?: unknown }).parameters !== undefined
    && Array.isArray((strategyParameters as { parameters: unknown }).parameters)
  ) {
    issues.push(...validateParameterSet(r.parameterSet, strategyParameters as never).issues);
  }

  // -- §17 dataset / universe --
  if (typeof r.datasetVersion !== "string" || !isValidDatasetVersionFormat(r.datasetVersion)) {
    issues.push(issue("SCHEMA_RECORD_DATASET_VERSION_INVALID", "datasetVersion", "datasetVersion 必须是 rd-… 内容寻址数据集版本"));
  }
  checkNonEmptyString(r.universeId, "universeId", "SCHEMA_RECORD_UNIVERSE_ID_EMPTY", "universeId", issues);

  // -- §17 backtest config / cost model / execution model --
  checkBacktestConfig(r.backtestConfig as unknown, "backtestConfig", issues);
  checkCostModelObject(r.costModel as unknown, "costModel", issues);
  const executionModel = r.executionModel;
  if (typeof executionModel !== "string" || !(STRATEGY_EXECUTION_MODEL_IDS as readonly string[]).includes(executionModel)) {
    issues.push(issue(
      "SCHEMA_RECORD_EXECUTION_MODEL_INVALID",
      "executionModel",
      `executionModel 必须是 ${STRATEGY_EXECUTION_MODEL_IDS.join(" | ")} 之一，实际：${String(executionModel)}`,
    ));
  }

  // -- §17 code version / created_at --
  if (typeof r.codeVersion !== "string" || !isValidCodeVersionFormat(r.codeVersion)) {
    issues.push(issue("SCHEMA_RECORD_CODE_VERSION_INVALID", "codeVersion", "codeVersion 格式非法（须符合 composeCodeVersion 产物形态，如 1.0.0+g2b786f7）"));
  }
  if (typeof r.createdAt !== "string" || !DATE_TIME_RE.test(r.createdAt)) {
    issues.push(issue("SCHEMA_RECORD_CREATED_AT_INVALID", "createdAt", "createdAt 必须是 ISO-8601 UTC 字符串（YYYY-MM-DDTHH:mm:ss[.sss]Z）"));
  }

  // -- 交叉一致 --
  checkTopLevelConsistency(r, issues);

  // -- fingerprint --
  checkNonEmptyString(r.fingerprint, "fingerprint", "SCHEMA_RECORD_FINGERPRINT_EMPTY", "fingerprint", issues);

  return result(issues);
}

/** 版本追溯记录非法即抛 ResearchValidationError。 */
export function assertValidStrategyVersionRecord(record: StrategyVersionRecord | undefined | null): void {
  assertValid(validateStrategyVersionRecord(record));
}
