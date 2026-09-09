/**
 * STEP 13 / C-13.2 — Signal 与 Candidate 框架：校验层。
 *
 * 全部校验为纯函数，返回结构化结果（不抛错）；另有 assert* 便捷入口在非法时抛
 * ResearchValidationError。复用 research 层既有 ResearchValidationIssue / Result /
 * Error（与 framework validation.ts 同一错误体系）。
 *
 * 校验对象：
 *   - Strategy13（引擎输入配方）：决策时点 / 特征集合唯一性 / 排序与选择配置 /
 *     signalBuilder 可调用性（Ranking / Selection / Feature 形状直接委托 framework
 *     校验器，不另造口径）；
 *   - CandidateEvaluationRun（运行记录）：供反序列化后结构复核（字段种类、枚举、
 *     数组形态、数值有限性），保证 JSON → 对象不回退类型边界。
 */

import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
} from "../experimentValidation";
import type { RankingConfig, SelectionConfig } from "../framework/contract";
import { validateFeatureProvider, validateRankingConfig, validateSelectionConfig } from "../framework/validation";
import type { CandidateDayRecord, CandidateEvaluationRun, DirectionCounts, Strategy13 } from "./types";

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function result(issues: ResearchValidationIssue[]): ResearchValidationResult {
  return { valid: issues.length === 0, issues };
}

function assertValid(r: ResearchValidationResult): void {
  if (!r.valid) throw new ResearchValidationError(r.issues);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 把一个 framework 校验结果的 issues 重新挂到指定路径前缀下。 */
function rebase(issues: readonly ResearchValidationIssue[], prefix: string): ResearchValidationIssue[] {
  return issues.map((i) => ({ code: i.code, path: `${prefix}.${i.path}`, message: i.message }));
}

// ---------------------------------------------------------------------------
// Strategy13
// ---------------------------------------------------------------------------

/** 校验引擎输入配方 Strategy13。 */
export function validateStrategy13(s: Strategy13 | undefined | null): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (s === null || typeof s !== "object") {
    return result([issue("STRATEGY13_INVALID", "strategy13", "策略配方缺失或非对象")]);
  }
  if (s.point !== "open" && s.point !== "close") {
    issues.push(issue("STRATEGY13_POINT_INVALID", "strategy13.point", "point 必须是 open 或 close"));
  }
  if (!Array.isArray(s.features) || s.features.length === 0) {
    issues.push(issue("STRATEGY13_FEATURES_EMPTY", "strategy13.features", "features 必须是非空数组（C-13.2 链路以特征为起点）"));
  } else {
    const seen = new Set<string>();
    s.features.forEach((feature, index) => {
      const base = `strategy13.features[${index}]`;
      issues.push(...rebase(validateFeatureProvider(feature).issues, base));
      if (seen.has(feature.featureId)) {
        issues.push(issue("STRATEGY13_FEATURE_ID_DUPLICATE", `${base}.featureId`, `featureId=${feature.featureId} 重复，特征必须唯一`));
      }
      seen.add(feature.featureId);
    });
  }
  if (typeof s.signalBuilder !== "function") {
    issues.push(issue("STRATEGY13_SIGNAL_BUILDER_INVALID", "strategy13.signalBuilder", "signalBuilder 必须是函数"));
  }
  issues.push(...rebase(validateRankingConfig(s.rankingConfig).issues, "strategy13.rankingConfig"));
  issues.push(...rebase(validateSelectionConfig(s.selectionConfig).issues, "strategy13.selectionConfig"));
  if (s.signalDescription !== undefined && typeof s.signalDescription !== "string") {
    issues.push(issue("STRATEGY13_SIGNAL_DESCRIPTION_INVALID", "strategy13.signalDescription", "signalDescription 必须是字符串"));
  }
  return result(issues);
}

/** 引擎输入配方非法即抛 ResearchValidationError。 */
export function assertValidStrategy13(s: Strategy13 | undefined | null): void {
  assertValid(validateStrategy13(s));
}

// ---------------------------------------------------------------------------
// CandidateEvaluationRun（反序列化复核用）
// ---------------------------------------------------------------------------

/** 校验运行记录的形态（供 deserialize 复核；不重算统计一致性）。 */
export function validateCandidateEvaluationRun(record: CandidateEvaluationRun | undefined | null): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (record === null || typeof record !== "object") {
    return result([issue("RECORD_INVALID", "record", "运行记录缺失或非对象")]);
  }
  if (record.recordKind !== "CANDIDATE_EVALUATION_RUN") {
    issues.push(issue("RECORD_KIND_INVALID", "record.recordKind", "recordKind 必须是 CANDIDATE_EVALUATION_RUN"));
  }
  if (record.recordVersion !== 1) {
    issues.push(issue("RECORD_VERSION_INVALID", "record.recordVersion", "recordVersion 必须是 1"));
  }
  for (const [field, label] of [
    ["datasetVersion", "datasetVersion"],
    ["builderVersion", "builderVersion"],
    ["rowSchemaVersion", "rowSchemaVersion"],
    ["universeId", "universeId"],
    ["strategyId", "strategyId"],
    ["strategyVersion", "strategyVersion"],
  ] as const) {
    const value = (record as unknown as Record<string, unknown>)[field];
    if (typeof value !== "string" || value.trim() === "") {
      issues.push(issue("RECORD_FIELD_EMPTY", `record.${field}`, `${label} 不能为空字符串`));
    }
  }
  if (typeof record.datasetGate !== "string") {
    issues.push(issue("RECORD_DATASET_GATE_INVALID", "record.datasetGate", "datasetGate 必须是字符串"));
  }
  if (record.point !== "open" && record.point !== "close") {
    issues.push(issue("RECORD_POINT_INVALID", "record.point", "point 必须是 open 或 close"));
  }
  const range = record.dateRange;
  if (
    typeof range.startDate !== "string" || !DATE_RE.test(range.startDate)
    || typeof range.endDate !== "string" || !DATE_RE.test(range.endDate)
  ) {
    issues.push(issue("RECORD_DATE_RANGE_INVALID", "record.dateRange", "dateRange 必须含合法 startDate/endDate（YYYY-MM-DD）"));
  } else if (range.startDate > range.endDate) {
    issues.push(issue("RECORD_DATE_RANGE_REVERSED", "record.dateRange", "dateRange.startDate 不能晚于 endDate"));
  }
  if (record.parameters === null || typeof record.parameters !== "object" || Array.isArray(record.parameters)) {
    issues.push(issue("RECORD_PARAMETERS_INVALID", "record.parameters", "parameters 必须是参数值对象"));
  } else {
    for (const value of Object.values(record.parameters)) {
      const v: unknown = value;
      const isScalar = v === null || typeof v === "number" || typeof v === "string" || typeof v === "boolean";
      if (!isScalar) {
        issues.push(issue("RECORD_PARAMETERS_VALUE_INVALID", "record.parameters", "参数值不是可序列化原子值"));
      }
      if (typeof v === "number" && !Number.isFinite(v)) {
        issues.push(issue("RECORD_PARAMETERS_NAN", "record.parameters", "参数值禁止 NaN/Infinity"));
      }
    }
  }
  if (!Array.isArray(record.featureVersions)) {
    issues.push(issue("RECORD_FEATURE_VERSIONS_INVALID", "record.featureVersions", "featureVersions 必须是数组"));
  } else {
    record.featureVersions.forEach((ref, index) => {
      if (!ref || typeof ref !== "object" || typeof ref.featureId !== "string" || typeof ref.version !== "string") {
        issues.push(issue("RECORD_FEATURE_REF_INVALID", `record.featureVersions[${index}]`, "featureVersions 元素必须是 {featureId, version}"));
      }
    });
  }
  // 排序/选择配置形状：委托 framework 校验器（保证记录可被既有校验器理解）。
  issues.push(...rebase(validateRankingConfig(record.rankingConfig as unknown as RankingConfig).issues, "record.rankingConfig"));
  issues.push(...rebase(validateSelectionConfig(record.selectionConfig as unknown as SelectionConfig).issues, "record.selectionConfig"));
  if (!Array.isArray(record.days) || record.days.length === 0) {
    issues.push(issue("RECORD_DAYS_EMPTY", "record.days", "days 必须是非空数组（引擎保证至少一个决策日）"));
  } else {
    record.days.forEach((day: CandidateDayRecord, index: number) => {
      const base = `record.days[${index}]`;
      if (typeof day.date !== "string" || !DATE_RE.test(day.date)) {
        issues.push(issue("RECORD_DAY_DATE_INVALID", `${base}.date`, "date 必须是 YYYY-MM-DD"));
      }
      if (!Array.isArray(day.universeMembers) || day.universeMembers.some((m) => typeof m !== "string")) {
        issues.push(issue("RECORD_DAY_UNIVERSE_INVALID", `${base}.universeMembers`, "universeMembers 必须是字符串数组"));
      }
      if (typeof day.signalCount !== "number" || !Number.isInteger(day.signalCount) || day.signalCount < 0) {
        issues.push(issue("RECORD_DAY_SIGNAL_COUNT_INVALID", `${base}.signalCount`, "signalCount 必须是非负整数"));
      }
      if (!Array.isArray(day.dropped)) issues.push(issue("RECORD_DAY_DROPPED_INVALID", `${base}.dropped`, "dropped 必须是数组"));
      if (!Array.isArray(day.selected)) issues.push(issue("RECORD_DAY_SELECTED_INVALID", `${base}.selected`, "selected 必须是数组"));
      if (!Array.isArray(day.positionIntents)) {
        issues.push(issue("RECORD_DAY_INTENTS_INVALID", `${base}.positionIntents`, "positionIntents 必须是数组"));
      }
    });
  }
  // 统计块基本形态（详细一致性由引擎构造保证，此处只防类型退化）。
  const evaluation = record.evaluation;
  if (!evaluation || typeof evaluation !== "object") {
    issues.push(issue("RECORD_EVALUATION_INVALID", "record.evaluation", "evaluation 缺失或非对象"));
  } else {
    const numericFields: Array<[keyof CandidateEvaluationRun["evaluation"], string]> = [
      ["decisionDayCount", "decisionDayCount"],
      ["totalSelectedSlots", "totalSelectedSlots"],
      ["meanSelectedPerDay", "meanSelectedPerDay"],
      ["minSelectedPerDay", "minSelectedPerDay"],
      ["maxSelectedPerDay", "maxSelectedPerDay"],
      ["universeCoveragePct", "universeCoveragePct"],
      ["meanSelectedValue", "meanSelectedValue"],
      ["minSelectedValue", "minSelectedValue"],
      ["maxSelectedValue", "maxSelectedValue"],
    ];
    for (const [field, label] of numericFields) {
      const value: unknown = evaluation[field];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push(issue("RECORD_EVALUATION_NUMERIC_INVALID", `record.evaluation.${label}`, `${label} 必须是有限数字`));
      }
    }
    if (typeof evaluation.decisionDayCount !== "number" || !Number.isInteger(evaluation.decisionDayCount) || evaluation.decisionDayCount < 0) {
      issues.push(issue("RECORD_EVALUATION_DAY_COUNT_INVALID", "record.evaluation.decisionDayCount", "decisionDayCount 必须是非负整数"));
    }
    if (!Array.isArray(evaluation.dates) || evaluation.dates.some((d) => typeof d !== "string")) {
      issues.push(issue("RECORD_EVALUATION_DATES_INVALID", "record.evaluation.dates", "evaluation.dates 必须是字符串数组"));
    }
    const dc: DirectionCounts | undefined = evaluation.selectedDirectionCounts;
    for (const key of ["long", "short", "neutral"] as const) {
      const v: unknown = dc?.[key];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        issues.push(issue("RECORD_EVALUATION_DIRECTION_INVALID", `record.evaluation.selectedDirectionCounts.${key}`, `${key} 必须是非负整数`));
      }
    }
  }
  if (typeof record.fingerprint !== "string" || record.fingerprint.trim() === "") {
    issues.push(issue("RECORD_FINGERPRINT_INVALID", "record.fingerprint", "fingerprint 不能为空"));
  }
  return result(issues);
}

/** 运行记录非法即抛 ResearchValidationError。 */
export function assertValidCandidateEvaluationRun(record: CandidateEvaluationRun | undefined | null): void {
  assertValid(validateCandidateEvaluationRun(record));
}
