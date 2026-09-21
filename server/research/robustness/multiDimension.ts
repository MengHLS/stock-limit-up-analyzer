/**
 * C-18.1 泛化扩展 —— **多维稳定性运行器**（规格 §6：一个 Run 内 Baseline + N 维度 × M 变体）。
 *
 * ## 与 C-18.1 的关系（同一种方法，不同被验证对象）
 *
 * 复用的是**同一套纪律**（不是复制一套引擎）：
 *
 * | 纪律 | C-18.1（策略侧） | 本层（跨阶段） |
 * | --- | --- | --- |
 * | baseline-first | 清单索引 0 = 基准、恰一条 | **同**（且基准单列在 `baseline` 字段） |
 * | evaluator 注入 | `RobustnessEvaluator`（本模块零 IO） | **同**（`MultiDimensionRobustnessEvaluator`） |
 * | failed 结构化 | failed 样本带 error、不静默吞 | **同**（含「评估产物非法」转 failed） |
 * | baseline 失败 | 抛 `RB18_BASELINE_FAILED`，拒绝产出无锚点结论 | **同**（`RB18X_BASELINE_FAILED`） |
 * | 容差判定 | `applyDriftThresholds` | **同一个** `evaluateTolerance`（`comparison.ts`） |
 * | fingerprint | canonical SHA-256 | **同一个** `computeCanonicalFingerprint`（`serialize.ts`） |
 * | 确定性 | 无 `Date.now` / `Math.random` / IO | **同** |
 *
 * ## 为什么是「一个 Run 出矩阵」而不是「N 个独立 Run 拼接」（规格 §6 明禁后者）
 *
 * 若每个维度各跑一次，每个 Run 会**各自**产生自己的基准 —— 于是
 * 「A 维度相对 T+3 敏感」与「B 维度相对 T+10 敏感」在统计上**不可比**
 * （分母不同、样本集合不同）。本层强制：**一个 Run、一个 Baseline、N 个维度共享它**，
 * 并把「变体与基准的样本集合是否一致」逐行暴露（`sampleSetChanged`）。
 *
 * ## 与策略侧单轴 `RobustnessRun` 并存（不合并、不替换）
 *
 * `RobustnessRun`（`types.ts:264`）的三个不变量 —— 单轴 / 三标量指标 / 策略身份 ——
 * 是策略侧**既有契约**，有测试与静态守卫钉住。本层是**并列的**记录形态，
 * 面向「维度不可穷举、指标自定义、对象不是策略」的研究语境；两者共用底层原语，
 * **不互相 import 彼此的记录类型**。
 */

import { ResearchValidationError, type ResearchValidationIssue } from "../experimentValidation";
import {
  ROBUSTNESS_SAMPLE_ACCOUNTING_FORMULA,
  assertMetricSnapshotMatchesVocabulary,
  assertSampleAccountingBalanced,
  assertSerializableVariantConfig,
  type RobustnessDimension,
  type RobustnessMetricSnapshot,
  type RobustnessSampleAccounting,
  type RobustnessSubject,
  type RobustnessSubjectKind,
  type RobustnessVariantItem,
} from "./dimension";
import {
  compareMetricSnapshot,
  resolveComparisonSpecs,
  summarizeUnitVerdict,
  type MetricComparisonResult,
  type MetricComparisonSpec,
  type UnitVerdict,
} from "./comparison";
import { computeCanonicalFingerprint, omitFingerprintField } from "./serialize";
import { deepFreeze } from "./evaluate";
import { canonicalStringify } from "../../researchDataset/version";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 记录种类标签（供序列化 / 反序列化判别；与策略侧 `ROBUSTNESS_RUN` **不同**）。 */
export const MULTI_DIMENSION_RUN_RECORD_KIND = "MULTI_DIMENSION_ROBUSTNESS_RUN" as const;

/** 记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const MULTI_DIMENSION_RUN_RECORD_VERSION = 1 as const;

/** 运行 id 前缀（调用方拼装时用；风格对齐 `ROBUST-` / `SEARCH-`）。 */
export const MULTI_DIMENSION_RUN_ID_PREFIX = "RBM" as const;

// ---------------------------------------------------------------------------
// 请求 / 评估器
// ---------------------------------------------------------------------------

/** 单次评估的产物（成功携带指标快照 + 样本账；失败携带结构化错误）。 */
export type MultiDimensionSampleOutcome =
  | {
      readonly status: "succeeded";
      readonly metrics: RobustnessMetricSnapshot;
      readonly sampleAccounting: RobustnessSampleAccounting;
    }
  | { readonly status: "failed"; readonly error: string };

/**
 * 注入式评估器：变体条目 → 评估产物。
 *
 * 🔴 本模块**不执行 IO、不重算**（与 C-18.1 同一条边界）：真实重算（读 Dataset →
 *    应用变体条件 → 重新筛选 / 聚合 → 重新计算指标）由调用方闭包实现 ——
 *    于是「研究侧重算」与「策略侧回测」对核心是不可见的差别。
 */
export type MultiDimensionRobustnessEvaluator = (
  item: RobustnessVariantItem
) => MultiDimensionSampleOutcome;

export interface MultiDimensionRobustnessRequest {
  /** 被验证对象身份（规格 §5）。 */
  readonly subject: RobustnessSubject;
  /** 运行 id（调用方注入 ⇒ 确定性可复现）。 */
  readonly runId: string;
  /**
   * 创建时间。
   *
   * 🔴 **刻意可选**（与 C-18.1 的必填口径不同，理由在此登记）：
   *    wall-clock 时间戳会进入内容指纹 ⇒ 同一数据 + 同一参数跑两次得到**不同指纹**。
   *    研究侧要的是「同输入 ⇒ 逐字节同产物」的可复现证据，因此默认**不注入**；
   *    需要时间的调用方可以显式给（那时它自己承担指纹不可跨运行比对这件事）。
   */
  readonly createdAt?: string;
  /** 维度声明表（本运行的全部维度；变体的 `dimensionId` 必须 ∈ 这里）。 */
  readonly dimensions: readonly RobustnessDimension[];
  /** 指标词表（本运行的指标**唯一**来源；每个样本快照必须恰好覆盖它）。 */
  readonly metricNames: readonly string[];
  /** 比较声明（逐指标一行；决定「比较哪个指标 / 容差多大 / 哪个方向算恶化」）。 */
  readonly comparisons: readonly MetricComparisonSpec[];
  /** 变体清单（**索引 0 = 基准条目**，恰一条 `isBaseline=true`）。 */
  readonly variants: readonly RobustnessVariantItem[];
  /** 注入式评估器（本模块不执行 IO / 重算）。 */
  readonly evaluator: MultiDimensionRobustnessEvaluator;
}

// ---------------------------------------------------------------------------
// 结果结构
// ---------------------------------------------------------------------------

/** 一个变体（含基准）的完整评估结果。 */
export interface MultiDimensionVariantResult {
  readonly item: RobustnessVariantItem;
  readonly dimensionId: string | null;
  readonly status: "succeeded" | "failed";
  /** succeeded 时的指标快照；failed 时 null。 */
  readonly metrics: RobustnessMetricSnapshot | null;
  /** succeeded 时的样本账；failed 时 null。 */
  readonly sampleAccounting: RobustnessSampleAccounting | null;
  /** failed 时的结构化错误；succeeded 时 null。 */
  readonly error: string | null;
  /** 逐指标比较（基准条目为空数组 —— 自己与自己无可比）。 */
  readonly comparisons: readonly MetricComparisonResult[];
  readonly verdict: UnitVerdict;
  /** 变体配置内容指纹（canonical SHA-256）。 */
  readonly configFingerprint: string;
}

/** 维度级结论（归因到维度，与 C-18.1 的轴级结论同构）。 */
export interface MultiDimensionDimensionConclusion {
  readonly dimensionId: string;
  readonly label: string;
  /** 该维度的非基准变体数。 */
  readonly variantCount: number;
  readonly stableCount: number;
  readonly sensitiveCount: number;
  readonly insufficientCount: number;
  readonly failedCount: number;
  readonly verdict: "sensitive" | "stable" | "insufficient" | "failed" | "no-variants";
  /** 敏感变体 code 清单（按清单顺序）。 */
  readonly sensitiveEntries: readonly { readonly code: string; readonly label: string }[];
}

/** 计数汇总（供页面总览与报告「同一口径」取数）。 */
export interface MultiDimensionRunCounts {
  readonly variantCount: number;
  readonly stableCount: number;
  readonly sensitiveCount: number;
  readonly insufficientCount: number;
  readonly failedCount: number;
}

/** 一次多维稳定性运行的完整记录（不可变、可 JSON 序列化、带 fingerprint）。 */
export interface MultiDimensionRobustnessRun {
  readonly recordKind: typeof MULTI_DIMENSION_RUN_RECORD_KIND;
  readonly recordVersion: typeof MULTI_DIMENSION_RUN_RECORD_VERSION;
  readonly runId: string;
  readonly subject: RobustnessSubject;
  readonly createdAt: string | null;
  readonly dimensions: readonly RobustnessDimension[];
  readonly metricNames: readonly string[];
  readonly comparisonSpecs: readonly MetricComparisonSpec[];
  readonly baseline: MultiDimensionVariantResult;
  /** 非基准变体（按声明顺序）。 */
  readonly variants: readonly MultiDimensionVariantResult[];
  readonly dimensionConclusions: readonly MultiDimensionDimensionConclusion[];
  readonly counts: MultiDimensionRunCounts;
  readonly overallVerdict: "sensitive" | "stable" | "insufficient" | "failed" | "no-variants";
  /** 内容指纹（sha256 十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 请求校验
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertSubject(subject: RobustnessSubject): void {
  const problems: ResearchValidationIssue[] = [];
  if (subject === null || typeof subject !== "object") {
    throw new ResearchValidationError([
      { code: "RB18X_SUBJECT_INVALID", path: "subject", message: "subject 必须是对象" },
    ]);
  }
  const kinds: readonly RobustnessSubjectKind[] = ["strategy", "experiment"];
  if (!kinds.includes(subject.subjectKind)) {
    problems.push({
      code: "RB18X_SUBJECT_KIND_INVALID",
      path: "subject.subjectKind",
      message: `subjectKind 必须是 ${kinds.join(" | ")} 之一，收到 ${String(subject.subjectKind)}`,
    });
  }
  for (const field of ["subjectId", "subjectVersion"] as const) {
    const value = subject[field];
    if (typeof value !== "string" || value.trim() === "") {
      problems.push({
        code: "RB18X_SUBJECT_FIELD_EMPTY",
        path: `subject.${field}`,
        message: `${field} 必须是非空字符串`,
      });
    }
  }
  const runId = subject.subjectRunId;
  if (runId !== null && (typeof runId !== "string" || runId.trim() === "")) {
    problems.push({
      code: "RB18X_SUBJECT_RUN_ID_INVALID",
      path: "subject.subjectRunId",
      message: "subjectRunId 必须是 null 或非空字符串",
    });
  }
  if (subject.subjectKind === "strategy" && runId !== null) {
    problems.push({
      code: "RB18X_SUBJECT_RUN_ID_UNEXPECTED",
      path: "subject.subjectRunId",
      message: "策略语境的 subjectRunId 必须为 null（Run id 是实验语境的坐标）",
    });
  }
  if (problems.length > 0) throw new ResearchValidationError(problems);
}

function assertDimensions(dimensions: readonly RobustnessDimension[]): void {
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    throw new ResearchValidationError([
      { code: "RB18X_DIMENSIONS_EMPTY", path: "dimensions", message: "维度声明表不能为空" },
    ]);
  }
  const seen = new Set<string>();
  const problems: ResearchValidationIssue[] = [];
  dimensions.forEach((dimension, index) => {
    const path = `dimensions[${index}]`;
    if (dimension === null || typeof dimension !== "object") {
      problems.push({ code: "RB18X_DIMENSION_INVALID", path, message: "维度必须是对象" });
      return;
    }
    if (typeof dimension.id !== "string" || dimension.id.trim() === "") {
      problems.push({ code: "RB18X_DIMENSION_ID_EMPTY", path: `${path}.id`, message: "维度 id 必须是非空字符串" });
    } else if (seen.has(dimension.id)) {
      problems.push({
        code: "RB18X_DIMENSION_ID_DUPLICATE",
        path: `${path}.id`,
        message: `维度 id "${dimension.id}" 重复声明`,
      });
    } else {
      seen.add(dimension.id);
    }
    if (typeof dimension.label !== "string" || dimension.label.trim() === "") {
      problems.push({ code: "RB18X_DIMENSION_LABEL_EMPTY", path: `${path}.label`, message: "维度 label 必须是非空字符串" });
    }
  });
  if (problems.length > 0) throw new ResearchValidationError(problems);
}

function assertVariants(
  variants: readonly RobustnessVariantItem[],
  dimensionIds: ReadonlySet<string>
): void {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new ResearchValidationError([
      { code: "RB18X_VARIANTS_EMPTY", path: "variants", message: "变体清单不能为空（至少含基准条目）" },
    ]);
  }
  const problems: ResearchValidationIssue[] = [];
  if (variants[0]!.isBaseline !== true) {
    problems.push({
      code: "RB18X_BASELINE_NOT_FIRST",
      path: "variants[0]",
      message: "变体清单索引 0 必须是基准条目（isBaseline=true）",
    });
  }
  let baselineCount = 0;
  const seenCodes = new Set<string>();
  variants.forEach((item, index) => {
    const path = `variants[${index}]`;
    if (item === null || typeof item !== "object") {
      problems.push({ code: "RB18X_VARIANT_INVALID", path, message: "变体条目必须是对象" });
      return;
    }
    if (item.isBaseline === true) baselineCount += 1;
    for (const field of ["code", "label"] as const) {
      if (typeof item[field] !== "string" || (item[field] as string).trim() === "") {
        problems.push({ code: "RB18X_VARIANT_FIELD_EMPTY", path: `${path}.${field}`, message: `${field} 必须是非空字符串` });
      }
    }
    if (typeof item.code === "string" && item.code.trim() !== "") {
      if (seenCodes.has(item.code)) {
        problems.push({ code: "RB18X_VARIANT_CODE_DUPLICATE", path: `${path}.code`, message: `变体 code "${item.code}" 重复` });
      }
      seenCodes.add(item.code);
    }
    if (item.isBaseline === true) {
      if (item.dimensionId !== null) {
        problems.push({
          code: "RB18X_BASELINE_DIMENSION_INVALID",
          path: `${path}.dimensionId`,
          message: "基准条目的 dimensionId 必须为 null（基准是共享锚点，不属于任何维度）",
        });
      }
    } else if (typeof item.dimensionId !== "string" || !dimensionIds.has(item.dimensionId)) {
      problems.push({
        code: "RB18X_VARIANT_DIMENSION_UNKNOWN",
        path: `${path}.dimensionId`,
        message: `变体的 dimensionId "${String(item.dimensionId)}" 不在维度声明表里（${[...dimensionIds].sort().join(", ")}）`,
      });
    }
  });
  if (baselineCount !== 1) {
    problems.push({
      code: "RB18X_BASELINE_COUNT_INVALID",
      path: "variants",
      message: `基准条目数 = ${baselineCount}（必须恰 1 条且位于索引 0）`,
    });
  }
  if (problems.length > 0) throw new ResearchValidationError(problems);
  // 配置可序列化（逐条断言；单条非法即抛 —— 属编程错误，不进评估）。
  variants.forEach((item, index) => {
    assertSerializableVariantConfig(item.config, `variants[${index}].config`, String(item.code));
  });
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 运行器主入口：一次请求 → 完整多维稳定性记录。 */
export function runMultiDimensionRobustness(
  request: MultiDimensionRobustnessRequest
): MultiDimensionRobustnessRun {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new ResearchValidationError([
      { code: "RB18X_REQUEST_INVALID", path: "request", message: "request 必须是对象" },
    ]);
  }
  const problems: ResearchValidationIssue[] = [];
  for (const field of ["runId"] as const) {
    const value = (request as unknown as Record<string, unknown>)[field];
    if (typeof value !== "string" || (value as string).trim() === "") {
      problems.push({ code: "RB18X_REQUEST_FIELD_EMPTY", path: field, message: `${field} 必须是非空字符串` });
    }
  }
  if (request.createdAt !== undefined && request.createdAt !== null) {
    if (typeof request.createdAt !== "string" || request.createdAt.trim() === "") {
      problems.push({
        code: "RB18X_REQUEST_CREATED_AT_INVALID",
        path: "createdAt",
        message: "createdAt 缺省即为「不注入」；若给必须是 ISO-8601 非空字符串",
      });
    }
  }
  if (typeof request.evaluator !== "function") {
    problems.push({ code: "RB18X_REQUEST_EVALUATOR_INVALID", path: "evaluator", message: "evaluator 必须是函数" });
  }
  if (problems.length > 0) throw new ResearchValidationError(problems);

  assertSubject(request.subject);
  assertDimensions(request.dimensions);
  const dimensionIds = new Set(request.dimensions.map((dimension) => dimension.id));
  assertVariants(request.variants, dimensionIds);
  // 指标词表 + 比较声明（metric 必须 ∈ 词表 ⇒ 「比较的是哪个指标」在声明期就定死）。
  if (!Array.isArray(request.metricNames) || request.metricNames.length === 0) {
    throw new ResearchValidationError([
      { code: "RB18X_METRIC_VOCABULARY_EMPTY", path: "metricNames", message: "指标词表不能为空" },
    ]);
  }
  const comparisonSpecs = resolveComparisonSpecs(request.comparisons, request.metricNames);

  // ---- 逐变体注入式评估（evaluator 抛错 / 返回 failed / 产物非法 → 转 failed 样本）----
  interface RawResult {
    readonly item: RobustnessVariantItem;
    readonly status: "succeeded" | "failed";
    readonly metrics: RobustnessMetricSnapshot | null;
    readonly sampleAccounting: RobustnessSampleAccounting | null;
    readonly error: string | null;
  }

  const raw: RawResult[] = request.variants.map((item, index) => {
    let outcome: MultiDimensionSampleOutcome;
    try {
      outcome = request.evaluator(item);
    } catch (error) {
      return { item, status: "failed", metrics: null, sampleAccounting: null, error: `评估器抛错：${errorMessage(error)}` };
    }
    if (outcome === null || typeof outcome !== "object" || (outcome.status !== "succeeded" && outcome.status !== "failed")) {
      return { item, status: "failed", metrics: null, sampleAccounting: null, error: "评估器返回非法产物（status 必须为 succeeded | failed）" };
    }
    if (outcome.status === "failed") {
      const text = typeof outcome.error === "string" && outcome.error.trim() !== "" ? outcome.error : "评估器返回空错误";
      return { item, status: "failed", metrics: null, sampleAccounting: null, error: text };
    }
    // 成功样本：指标快照与样本账都必须在**评估器之外**再校验一遍（不信任调用方自检）。
    const path = `variants[${index}]`;
    if (outcome.metrics === null || typeof outcome.metrics !== "object") {
      return { item, status: "failed", metrics: null, sampleAccounting: null, error: "评估产物非法（指标）：缺指标快照" };
    }
    if (outcome.sampleAccounting === null || typeof outcome.sampleAccounting !== "object") {
      return {
        item,
        status: "failed",
        metrics: null,
        sampleAccounting: null,
        error: "评估产物非法（样本账）：每个变体必须给出样本账（规格 §13 —— 结论要用多少样本必须可复核）",
      };
    }
    const accounting = outcome.sampleAccounting;
    try {
      assertSampleAccountingBalanced(accounting, `${path}.sampleAccounting`);
    } catch (error) {
      return { item, status: "failed", metrics: null, sampleAccounting: null, error: `评估产物非法（样本账）：${errorMessage(error)}` };
    }
    try {
      assertMetricSnapshotMatchesVocabulary(outcome.metrics, request.metricNames, path);
    } catch (error) {
      return { item, status: "failed", metrics: null, sampleAccounting: null, error: `评估产物非法（指标）：${errorMessage(error)}` };
    }
    return { item, status: "succeeded", metrics: outcome.metrics, sampleAccounting: accounting, error: null };
  });

  // 基准失败 ⇒ 无锚点：拒绝产出无意义的稳定性结论（C-18.1 同一条纪律）。
  const baselineRaw = raw[0]!;
  if (baselineRaw.status !== "succeeded" || baselineRaw.metrics === null) {
    throw new ResearchValidationError([
      {
        code: "RB18X_BASELINE_FAILED",
        path: "variants[0]",
        message:
          `基准条目评估失败（${baselineRaw.error ?? "无错误信息"}）；` +
          "比较无锚点，拒绝产出稳定性结论",
      },
    ]);
  }
  /** 收窄后的基准指标快照（TS 的收窄在闭包内会失效 ⇒ 显式落一个非空引用）。 */
  const baselineMetrics: RobustnessMetricSnapshot = baselineRaw.metrics;

  const baselineComparisons: readonly MetricComparisonResult[] = [];
  const baselineResult: MultiDimensionVariantResult = {
    item: baselineRaw.item,
    dimensionId: null,
    status: "succeeded",
    metrics: baselineRaw.metrics,
    sampleAccounting: baselineRaw.sampleAccounting,
    error: null,
    comparisons: baselineComparisons,
    verdict: "baseline",
    configFingerprint: computeCanonicalFingerprint(baselineRaw.item.config),
  };

  const variantResults: MultiDimensionVariantResult[] = raw.slice(1).map((entry) => {
    const comparisons =
      entry.status === "succeeded" && entry.metrics !== null
        ? compareMetricSnapshot({
            baseline: baselineMetrics,
            variant: entry.metrics,
            baselineAccounting: baselineRaw.sampleAccounting,
            variantAccounting: entry.sampleAccounting,
            specs: comparisonSpecs,
          })
        : [];
    return {
      item: entry.item,
      dimensionId: entry.item.dimensionId,
      status: entry.status,
      metrics: entry.metrics,
      sampleAccounting: entry.sampleAccounting,
      error: entry.error,
      comparisons,
      verdict: summarizeUnitVerdict({ anyFailed: entry.status === "failed", comparisons }),
      configFingerprint: computeCanonicalFingerprint(entry.item.config),
    };
  });

  const dimensionConclusions = request.dimensions.map((dimension) =>
    concludeDimension(dimension, variantResults)
  );
  const counts = countVariants(variantResults);
  const overallVerdict = verdictOf(counts);

  const body: Omit<MultiDimensionRobustnessRun, "fingerprint"> = {
    recordKind: MULTI_DIMENSION_RUN_RECORD_KIND,
    recordVersion: MULTI_DIMENSION_RUN_RECORD_VERSION,
    runId: request.runId,
    subject: request.subject,
    createdAt: request.createdAt ?? null,
    dimensions: request.dimensions,
    metricNames: request.metricNames,
    comparisonSpecs,
    baseline: baselineResult,
    variants: variantResults,
    dimensionConclusions,
    counts,
    overallVerdict,
  };
  const fingerprint = computeCanonicalFingerprint(body);
  return deepFreeze<MultiDimensionRobustnessRun>({ ...body, fingerprint });
}

// ---------------------------------------------------------------------------
// 聚合
// ---------------------------------------------------------------------------

function countVariants(variants: readonly MultiDimensionVariantResult[]): MultiDimensionRunCounts {
  let stableCount = 0;
  let sensitiveCount = 0;
  let insufficientCount = 0;
  let failedCount = 0;
  for (const variant of variants) {
    if (variant.verdict === "sensitive") sensitiveCount += 1;
    else if (variant.verdict === "stable") stableCount += 1;
    else if (variant.verdict === "insufficient") insufficientCount += 1;
    else failedCount += 1;
  }
  return { variantCount: variants.length, stableCount, sensitiveCount, insufficientCount, failedCount };
}

/** 计数 → 总判定。优先级：sensitive > insufficient > failed > stable（口径与 `summarizeUnitVerdict` 一致）。 */
function verdictOf(counts: MultiDimensionRunCounts): MultiDimensionRobustnessRun["overallVerdict"] {
  if (counts.variantCount === 0) return "no-variants";
  if (counts.sensitiveCount > 0) return "sensitive";
  if (counts.insufficientCount > 0) return "insufficient";
  if (counts.failedCount > 0) return "failed";
  return "stable";
}

function concludeDimension(
  dimension: RobustnessDimension,
  variants: readonly MultiDimensionVariantResult[]
): MultiDimensionDimensionConclusion {
  const members = variants.filter((variant) => variant.dimensionId === dimension.id);
  const counts = countVariants(members);
  return {
    dimensionId: dimension.id,
    label: dimension.label,
    variantCount: counts.variantCount,
    stableCount: counts.stableCount,
    sensitiveCount: counts.sensitiveCount,
    insufficientCount: counts.insufficientCount,
    failedCount: counts.failedCount,
    verdict: counts.variantCount === 0 ? "no-variants" : verdictOf(counts),
    sensitiveEntries: members
      .filter((variant) => variant.verdict === "sensitive")
      .map((variant) => ({ code: variant.item.code, label: variant.item.label })),
  };
}

// ---------------------------------------------------------------------------
// 结构校验 / 序列化（与 C-18.1 的 `serialize.ts` 同构；不做跨记录类型复用）
// ---------------------------------------------------------------------------

const HEX64_RE = /^[0-9a-f]{64}$/;

/** 多维运行记录的内容指纹（除 `fingerprint` 外全部字段的 canonical SHA-256）。 */
export function computeMultiDimensionRunFingerprint(
  record: Omit<MultiDimensionRobustnessRun, "fingerprint"> | MultiDimensionRobustnessRun
): string {
  // 🔴 必须先剔除 `fingerprint`：生成期是对「无指纹的 body」取摘要的，
  //    若此处把整条记录（含 fingerprint）喂进去，反序列化必然 mismatch。
  return computeCanonicalFingerprint(omitFingerprintField(record));
}

/** 序列化（canonical JSON；拒绝 NaN/Infinity；同内容必同串）。 */
export function serializeMultiDimensionRobustnessRun(record: MultiDimensionRobustnessRun): string {
  computeMultiDimensionRunFingerprint(record); // 顺带触发非有限值检查（失败响亮）
  return canonicalStringify(record);
}

/** 校验结构（形态 + 计数自洽 + 指纹形态）。 */
export function validateMultiDimensionRobustnessRun(record: unknown): {
  valid: boolean;
  issues: ResearchValidationIssue[];
} {
  const issues: ResearchValidationIssue[] = [];
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return { valid: false, issues: [{ code: "RB18X_RUN_INVALID", path: "record", message: "记录必须是对象" }] };
  }
  const r = record as Record<string, unknown>;
  if (r.recordKind !== MULTI_DIMENSION_RUN_RECORD_KIND) {
    issues.push({
      code: "RB18X_RUN_KIND_MISMATCH",
      path: "recordKind",
      message: `recordKind=${String(r.recordKind)} 不是 ${MULTI_DIMENSION_RUN_RECORD_KIND}`,
    });
  }
  if (r.recordVersion !== MULTI_DIMENSION_RUN_RECORD_VERSION) {
    issues.push({
      code: "RB18X_RUN_VERSION_MISMATCH",
      path: "recordVersion",
      message: `recordVersion=${String(r.recordVersion)} 不受支持（期望 ${MULTI_DIMENSION_RUN_RECORD_VERSION}）`,
    });
  }
  if (typeof r.runId !== "string" || r.runId.trim() === "") {
    issues.push({ code: "RB18X_RUN_FIELD_EMPTY", path: "runId", message: "runId 必须是非空字符串" });
  }
  if (r.createdAt !== null && typeof r.createdAt !== "string") {
    issues.push({ code: "RB18X_RUN_CREATED_AT_INVALID", path: "createdAt", message: "createdAt 必须是 null 或字符串" });
  }
  if (!Array.isArray(r.metricNames) || r.metricNames.length === 0) {
    issues.push({ code: "RB18X_RUN_METRIC_NAMES_INVALID", path: "metricNames", message: "metricNames 必须是非空数组" });
  }
  if (!Array.isArray(r.dimensions)) {
    issues.push({ code: "RB18X_RUN_DIMENSIONS_INVALID", path: "dimensions", message: "dimensions 必须是数组" });
  }
  if (!Array.isArray(r.comparisonSpecs) || r.comparisonSpecs.length === 0) {
    issues.push({ code: "RB18X_RUN_SPECS_INVALID", path: "comparisonSpecs", message: "comparisonSpecs 必须是非空数组" });
  }
  const counts = r.counts;
  if (counts === null || typeof counts !== "object" || Array.isArray(counts)) {
    issues.push({ code: "RB18X_RUN_COUNTS_INVALID", path: "counts", message: "counts 必须是对象" });
  } else {
    const c = counts as Record<string, unknown>;
    for (const field of ["variantCount", "stableCount", "sensitiveCount", "insufficientCount", "failedCount"] as const) {
      const value = c[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        issues.push({ code: "RB18X_RUN_COUNT_INVALID", path: `counts.${field}`, message: `${field} 必须是非负整数` });
      }
    }
    const parts = (c.stableCount as number) + (c.sensitiveCount as number) + (c.insufficientCount as number) + (c.failedCount as number);
    if (typeof c.variantCount === "number" && parts !== c.variantCount) {
      issues.push({
        code: "RB18X_RUN_COUNTS_IMBALANCE",
        path: "counts",
        message: `stable+sensitive+insufficient+failed = ${parts} ≠ variantCount ${String(c.variantCount)}`,
      });
    }
  }
  if (!Array.isArray(r.variants)) {
    issues.push({ code: "RB18X_RUN_VARIANTS_INVALID", path: "variants", message: "variants 必须是数组" });
  } else if (typeof counts === "object" && counts !== null && Array.isArray(r.variants)) {
    if ((r.variants as unknown[]).length !== (counts as Record<string, unknown>).variantCount) {
      issues.push({
        code: "RB18X_RUN_VARIANTS_COUNT_MISMATCH",
        path: "variants",
        message: "variants 长度与 counts.variantCount 不一致",
      });
    }
  }
  const baseline = r.baseline;
  if (baseline === null || typeof baseline !== "object" || Array.isArray(baseline)) {
    issues.push({ code: "RB18X_RUN_BASELINE_INVALID", path: "baseline", message: "baseline 必须是对象" });
  } else {
    const b = baseline as Record<string, unknown>;
    if (b.verdict !== "baseline") {
      issues.push({ code: "RB18X_RUN_BASELINE_VERDICT_INVALID", path: "baseline.verdict", message: "基准条目 verdict 必须是 baseline" });
    }
    if (b.status !== "succeeded") {
      issues.push({
        code: "RB18X_RUN_BASELINE_NOT_SUCCEEDED",
        path: "baseline.status",
        message: "基准条目必须 succeeded（失败时运行器会抛错，不应产出记录）",
      });
    }
  }
  if (typeof r.fingerprint !== "string" || !HEX64_RE.test(r.fingerprint)) {
    issues.push({ code: "RB18X_RUN_FP_INVALID", path: "fingerprint", message: "fingerprint 必须是 64 位十六进制字符串" });
  }
  if (!Array.isArray(r.dimensionConclusions)) {
    issues.push({
      code: "RB18X_RUN_DIMENSION_CONCLUSIONS_INVALID",
      path: "dimensionConclusions",
      message: "dimensionConclusions 必须是数组",
    });
  }
  return { valid: issues.length === 0, issues };
}

/** 反序列化：结构校验 + 指纹复核（防篡改 / 防字段退化）。 */
export function deserializeMultiDimensionRobustnessRun(json: string): MultiDimensionRobustnessRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`多维稳定性记录反序列化失败：JSON 解析错误（${(error as Error).message}）`);
  }
  const validation = validateMultiDimensionRobustnessRun(parsed);
  if (!validation.valid) throw new ResearchValidationError(validation.issues);
  const record = parsed as MultiDimensionRobustnessRun;
  const recomputed = computeMultiDimensionRunFingerprint(record);
  if (record.fingerprint !== recomputed) {
    throw new ResearchValidationError([
      {
        code: "RB18X_RUN_FINGERPRINT_MISMATCH",
        path: "fingerprint",
        message: `指纹不匹配：记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`,
      },
    ]);
  }
  return record;
}

/** 默认账目公式（转发；页面与报告取同一文本，避免各写一份）。 */
export const MULTI_DIMENSION_ACCOUNTING_FORMULA = ROBUSTNESS_SAMPLE_ACCOUNTING_FORMULA;
