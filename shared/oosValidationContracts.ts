/**
 * OOS-001 — Out-of-Sample Validation 线级契约（wire + 持久化快照）。
 *
 * 本文件是 **OOS 验证域唯一对外契约面**：tRPC 入参校验、返回值形态、以及落库快照共用
 * 同一组 schema。纪律对齐 `shared/parameterSearchContracts.ts` / `shared/searchRobustnessContracts.ts`：
 *   - **zod schema 与 TS 类型同文件**（`z.infer` 派生，不手抄两份形状）；
 *   - 新增字段一律**可选**（历史行读取不得炸）；
 *   - 只描述**传输 / 持久化**形态，不含任何口径计算；
 *   - 指标口径唯一来源 = `server/backtest/backtestResult.ts#canonicalMetrics()`，
 *     本文件只承载其**读数快照**（IS 侧 = 源 Search 结果的冻结副本；OOS 侧 = 本次重跑读数）。
 *
 * ## 与 Robustness 的边界（规格 §2，**必须严格区分**）
 *
 * |                | Search Robustness            | OOS                                  |
 * | -------------- | ---------------------------- | ------------------------------------ |
 * | 输入            | 已完成 Search Result           | Search Result + **OOS 数据窗口**        |
 * | 是否重跑 Backtest | ❌（静态守卫钉死）              | **✅（必须真跑）**                       |
 * | 是否重算 Metrics  | ❌                            | **✅（必须真算，禁止复制 Search 结果）**      |
 * | 参数            | 邻域组合                       | **冻结候选参数（禁止再搜索 / 再调参）**         |
 * | 目的            | 参数局部稳定性                   | **样本外验证**                            |
 *
 * 🔴 因此本契约里的 `oosWindow` 与源 Search Run 的窗口**必须互不重叠**（规格 §6），
 *   且 `resolvedParameterSet` 是**冻结快照**，不允许由当前策略 Schema 重新推导。
 *
 * ## 状态词表（规格 §12）
 *
 * OOS Run 状态**复用** `PARAMETER_SEARCH_RUN_STATUSES` 这一唯一词表
 * （CREATED / RUNNING / COMPLETED / FAILED / CANCELLED），
 * **不新建**与 Parameter Search 不同的状态语义 —— 迁移表唯一权威仍是
 * `server/research/parameterSearch/searchRun.ts#PARAMETER_SEARCH_RUN_TRANSITIONS`。
 */

import { z } from "zod";
import {
  parameterSearchValueSchema,
  PARAMETER_SEARCH_RUN_STATUSES,
} from "./parameterSearchContracts";

// ---------------------------------------------------------------------------
// 记录身份
// ---------------------------------------------------------------------------

/** OOS Run 记录标签（落库 JSON 的可判别标记）。 */
export const OOS_VALIDATION_RUN_RECORD_KIND = "OOS_VALIDATION_RUN" as const;
/** OOS Result 记录标签。 */
export const OOS_VALIDATION_RESULT_RECORD_KIND = "OOS_VALIDATION_RESULT" as const;
/** schema 版本：字段语义变更必须递增。 */
export const OOS_VALIDATION_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 状态（规格 §12：复用 PS 唯一词表，不另立语义）
// ---------------------------------------------------------------------------

/** OOS Run 状态（= PS 唯一词表）。 */
export const OOS_VALIDATION_RUN_STATUSES = PARAMETER_SEARCH_RUN_STATUSES;
export const oosValidationRunStatusSchema = z.enum(PARAMETER_SEARCH_RUN_STATUSES);
export type OosValidationRunStatus = (typeof PARAMETER_SEARCH_RUN_STATUSES)[number];

/** 单次 OOS 执行产物状态（判据 = 是否产出可用 evaluation 引用）。 */
export const OOS_VALIDATION_RESULT_STATUSES = ["SUCCEEDED", "FAILED"] as const;
export const oosValidationResultStatusSchema = z.enum(OOS_VALIDATION_RESULT_STATUSES);
export type OosValidationResultStatus = (typeof OOS_VALIDATION_RESULT_STATUSES)[number];

/** 指标来源自述（沿用既有 `canonical` / `evaluators` 词表）。 */
export const OOS_METRICS_SOURCES = ["canonical", "evaluators"] as const;
export const oosMetricsSourceSchema = z.enum(OOS_METRICS_SOURCES);
export type OosMetricsSource = (typeof OOS_METRICS_SOURCES)[number];

// ---------------------------------------------------------------------------
// 数据窗口（规格 §6）
// ---------------------------------------------------------------------------

/** 一个闭区间窗口（含两端；`YYYY-MM-DD` 北京业务日）。 */
export const oosWindowSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});
export type OosWindow = z.infer<typeof oosWindowSchema>;

// ---------------------------------------------------------------------------
// 指标读数（canonical 唯一口径面；**本层零重算**）
// ---------------------------------------------------------------------------

/**
 * 六项 canonical 读数（IS / OOS **对称**使用同一形状）。
 *
 * 🔴 口径唯一来源 = `server/backtest/backtestResult.ts#canonicalMetrics()`，
 *   经 `ClosedLoopEvaluationRef#canonicalMetrics` 投影（既有唯一读数面）。
 *   `null` = 该量**不可用**（`NOT_AVAILABLE` / 未接线 / 未产出），**绝不编造成 0**。
 *
 * ⚠️ 规格 §10 还列了 `averageWin` / `averageLoss`：**两侧都拿不到**——
 *   ① 冻结的 `parameter_search_result` 只有这六列（PARAMETER-001 §10 的既定口径）；
 *   ② `ClosedLoopEvaluationRef#canonicalMetrics` 的投影不含这两项。
 *   ⇒ 为避免「OOS 有、IS 没有」的**不对称比较**，本域两侧统一用同一组六项，
 *   并把 `averageWin/Loss` 如实登记为 Known Risk / Deferred（见实施报告 §14/§15）。
 */
export const oosMetricsSchema = z.object({
  totalReturnPct: z.number().nullable(),
  annualizedReturnPct: z.number().nullable(),
  maxDrawdownPct: z.number().nullable(),
  tradeCount: z.number().int().nullable(),
  winRatePct: z.number().nullable(),
  profitFactor: z.number().nullable(),
});
export type OosMetricsView = z.infer<typeof oosMetricsSchema>;

/** 年化基数自述（canonical 缺省时为 null —— 不猜口径）。 */
export const oosAnnualizationBasisSchema = z
  .object({ type: z.literal("TRADING_DAYS"), daysPerYear: z.number().int().positive() })
  .nullable();

// ---------------------------------------------------------------------------
// IS / OOS 对照（规格 §10：事实与比较，**不产出「优秀 / 最优 / 推荐」结论**）
// ---------------------------------------------------------------------------

/**
 * 逐指标对照。`delta` = OOS − IS（单位：百分点 / 笔）；`ratio` = OOS / IS
 * （**IS 为 0 或任一侧不可用 ⇒ null**，不做除零也不编造）。
 * `degradationPct` = IS − OOS（正数 = 样本外**下降**；单位仍是百分点）。
 */
export const oosComparisonSchema = z.object({
  /** 参与对照的指标项数（两侧都非 null 的项数）；0 = 无法比较。 */
  comparableCount: z.number().int().nonnegative(),
  totalReturnPctDelta: z.number().nullable(),
  totalReturnPctRatio: z.number().nullable(),
  annualizedReturnPctDelta: z.number().nullable(),
  annualizedReturnPctRatio: z.number().nullable(),
  maxDrawdownPctDelta: z.number().nullable(),
  maxDrawdownPctRatio: z.number().nullable(),
  tradeCountDelta: z.number().nullable(),
  tradeCountRatio: z.number().nullable(),
  winRatePctDelta: z.number().nullable(),
  winRatePctRatio: z.number().nullable(),
  profitFactorDelta: z.number().nullable(),
  profitFactorRatio: z.number().nullable(),
  /** IS − OOS 的总收益（百分点）；正数 = 样本外下降。任一侧不可用 ⇒ null。 */
  totalReturnDegradationPct: z.number().nullable(),
  /** OOS − IS 的最大回撤（百分点）；正数 = 样本外回撤**加深**。 */
  drawdownChangePct: z.number().nullable(),
  /** OOS − IS 的完成交易数（笔）。 */
  tradeCountChange: z.number().nullable(),
  /** 对照是否成立（两侧都有可用读数）。**不表达好坏**。 */
  comparable: z.boolean(),
  /** 对照说明（含「哪几项因不可用而缺席」；不静默）。 */
  notes: z.array(z.string()),
});
export type OosComparisonView = z.infer<typeof oosComparisonSchema>;

// ---------------------------------------------------------------------------
// Run 视图
// ---------------------------------------------------------------------------

/**
 * OOS Validation Run 视图。
 *
 * 回答规格 §4 的 10 个问题中的 1~8 与 10 的坐标部分（9 的 BacktestResult 在 Result 视图里）。
 */
export const oosValidationRunViewSchema = z.object({
  recordKind: z.literal(OOS_VALIDATION_RUN_RECORD_KIND),
  recordVersion: z.number().int().positive(),
  /** 业务身份（`OOSV-YYYYMMDD-XXXXXXXX`）。 */
  oosRunId: z.string().min(1),
  /** ① 来自哪个 Parameter Search Run。 */
  sourceSearchRunId: z.string().min(1),
  /** ② 使用哪个 Search Result / parameter combination（冻结身份）。 */
  sourceCombinationIndex: z.number().int().nullable(),
  sourceParameterHash: z.string().min(1),
  /** ③ 使用哪个 StrategyVersion（**冻结**；不是 latest）。 */
  strategyId: z.string().min(1),
  strategyVersion: z.string().min(1),
  strategyVersionId: z.string().min(1),
  /** 策略定义指纹（创建时冻结；执行时复核，漂移即响亮拒绝）。 */
  strategyDefinitionFingerprint: z.string().nullable(),
  /** ④ 使用哪个 DatasetVersion。 */
  datasetVersionId: z.number().int().nullable(),
  datasetVersionLabel: z.string().nullable(),
  /** 源 Search Run 的窗口（IS / Search Window）。 */
  searchWindow: oosWindowSchema,
  /** ⑤ OOS 时间窗口（**必须与 searchWindow 不重叠**）。 */
  oosWindow: oosWindowSchema,
  /** 冻结的 Search 快照指纹（继承自源 Run；不从当前策略重新解释）。 */
  searchSnapshotFingerprint: z.string().min(1),
  /** 冻结的 FIXED 坐标（原样继承）。 */
  fixedCoordinates: z.record(z.string(), parameterSearchValueSchema),
  /** ⑥ 使用什么 execution policy。 */
  executionPolicyVersion: z.number().int(),
  evaluationConfigFingerprint: z.string().min(1),
  /** ⑦ 使用什么参数（**冻结快照**，创建时写死）。 */
  resolvedParameterSet: z.record(z.string(), parameterSearchValueSchema),
  /** ⑧ 使用什么 metrics version（口径自述；本域唯一口径 = canonical）。 */
  metricsVersion: z.string().min(1),
  /** 决策引擎版本自述（来自实际执行的那份文档 / 引擎）。 */
  engineVersion: z.string().min(1),
  status: oosValidationRunStatusSchema,
  /** 运行内容指纹（除 `fingerprint` / 时间戳外全部字段的 canonical sha256）。 */
  runFingerprint: z.string().min(1),
  createdAt: z.string().min(1),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /** 运行说明（冻结来源 / 窗口隔离判定 / 门禁结论；不静默）。 */
  notes: z.array(z.string()).optional(),
});
export type OosValidationRunView = z.infer<typeof oosValidationRunViewSchema>;

// ---------------------------------------------------------------------------
// Result 视图（规格 §13：Result 至少能追溯下列全部）
// ---------------------------------------------------------------------------

export const oosValidationResultViewSchema = z.object({
  recordKind: z.literal(OOS_VALIDATION_RESULT_RECORD_KIND),
  recordVersion: z.number().int().positive(),
  oosRunId: z.string().min(1),
  /** 溯源（与 Run 冗余，便于单表排查）。 */
  sourceSearchRunId: z.string().min(1),
  sourceCombinationIndex: z.number().int().nullable(),
  sourceParameterHash: z.string().min(1),
  strategyVersionId: z.string().min(1),
  datasetVersionId: z.number().int().nullable(),
  resolvedParameterSet: z.record(z.string(), parameterSearchValueSchema),
  oosWindow: oosWindowSchema,
  searchWindow: oosWindowSchema,
  /** ⑩ IS 指标（**源 Search 结果的冻结副本**，零重算）。 */
  isMetrics: oosMetricsSchema,
  isMetricsSource: oosMetricsSourceSchema,
  /** ⑨⑩ OOS 指标（**本次重跑的真实读数**，绝不复制 Search 结果）。 */
  oosMetrics: oosMetricsSchema,
  oosMetricsSource: oosMetricsSourceSchema,
  /** 对照（事实；**不含结论性判定**）。 */
  comparison: oosComparisonSchema,
  status: oosValidationResultStatusSchema,
  error: z.string().nullable(),
  /** 本次 OOS 撮合指纹（`ClosedLoopEvaluationRef#backtestFingerprint`）。 */
  backtestFingerprint: z.string().nullable(),
  /** 本次 OOS 评估产物身份（`deriveExperimentId`）。 */
  evaluationId: z.string().nullable(),
  /** 内存态闭环 run id（`<前缀>::<experimentId>`）。 */
  evaluationRunId: z.string().nullable(),
  executionPolicyVersion: z.number().int(),
  metricsVersion: z.string().min(1),
  engineVersion: z.string().min(1),
  annualizationBasis: oosAnnualizationBasisSchema,
  /** 内容指纹（确定性判据：同输入 ⇒ 同指纹）。 */
  fingerprint: z.string().min(1),
  notes: z.array(z.string()),
  createdAt: z.string().min(1),
});
export type OosValidationResultView = z.infer<typeof oosValidationResultViewSchema>;

// ---------------------------------------------------------------------------
// API 入参
// ---------------------------------------------------------------------------

/**
 * 创建 OOS Run：**只冻结配置，不立即执行**（规格 §14：create 与 start 必须区分）。
 *
 * 🔴 `parameterHash` 是**唯一**指定候选的方式 —— 参数值不在入参里，
 *   一律从源 Search Run 的冻结组合行读取（防止调用方「顺手传一组更好的参数」）。
 *   这正是「OOS 不允许调参」在接口层的落地。
 */
export const createOosValidationInputSchema = z.object({
  sourceSearchRunId: z.string().min(1),
  /** 要验证的冻结候选（源 Run 内的组合身份）。 */
  parameterHash: z.string().min(1),
  /** OOS 数据窗口。必须 `startDate > 源 Search 窗口 endDate`（默认禁止重叠）。 */
  oosWindow: oosWindowSchema,
  /** 指标版本自述；缺省由服务端填唯一口径。 */
  metricsVersion: z.string().min(1).optional(),
});
export type CreateOosValidationInput = z.infer<typeof createOosValidationInputSchema>;

/** Run 身份入参（start / cancel）。 */
export const oosValidationRunIdInputSchema = z.object({
  oosRunId: z.string().min(1),
});
export type OosValidationRunIdInput = z.infer<typeof oosValidationRunIdInputSchema>;

/** 列表入参。 */
export const listOosValidationRunsInputSchema = z.object({
  sourceSearchRunId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type ListOosValidationRunsInput = z.infer<typeof listOosValidationRunsInputSchema>;

/** 结果读取入参。 */
export const getOosResultInputSchema = z.object({
  oosRunId: z.string().min(1),
});
export type GetOosResultInput = z.infer<typeof getOosResultInputSchema>;

// ---------------------------------------------------------------------------
// 视图聚合（详情 / 创建回执 / 执行回执）
// ---------------------------------------------------------------------------

/** 创建回执（如实回报冻结了什么、窗口隔离判定的结论）。 */
export const oosValidationCreateResultSchema = z.object({
  run: oosValidationRunViewSchema,
  notes: z.array(z.string()),
});
export type OosValidationCreateResultView = z.infer<typeof oosValidationCreateResultSchema>;

/** 执行回执（`executed=false` = 已 COMPLETED 且未重跑；幂等重放语义）。 */
export const oosValidationExecuteOutcomeSchema = z.object({
  run: oosValidationRunViewSchema,
  executed: z.boolean(),
  result: oosValidationResultViewSchema.nullable(),
  notes: z.array(z.string()),
});
export type OosValidationExecuteOutcomeView = z.infer<
  typeof oosValidationExecuteOutcomeSchema
>;

/** 详情（Run + Result（可为 null）+ 对照摘要）。 */
export const oosValidationRunDetailSchema = z.object({
  run: oosValidationRunViewSchema,
  result: oosValidationResultViewSchema.nullable(),
});
export type OosValidationRunDetailView = z.infer<typeof oosValidationRunDetailSchema>;

// ---------------------------------------------------------------------------
// 契约 ↔ 领域类型的双向结构断言锚点（编译期；由测试引用，防止两处形状漂移）
// ---------------------------------------------------------------------------

/** 编译期断言工具：两侧必须互相可赋值，否则本文件编译失败。 */
export type OosContractAssertion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
