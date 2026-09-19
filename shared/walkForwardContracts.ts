/**
 * WALK-FORWARD-001 — Walk-Forward 验证闭环线级契约（wire + 持久化快照）。
 *
 * 本文件是 **Walk-Forward 验证域唯一对外契约面**：tRPC 入参校验、返回值形态、落库快照
 * 共用同一组 schema。纪律对齐 `shared/oosValidationContracts.ts`：
 *   - **zod schema 与 TS 类型同文件**（`z.infer` 派生，不手抄两份形状）；
 *   - 新增字段一律**可选**（历史行读取不得炸）；
 *   - 只描述**传输 / 持久化**形态，不含任何口径计算。
 *
 * ## 这个域在链路里的位置（规格 §1）
 *
 * ```text
 * 历史数据 → IS Window → Parameter Search → 冻结该窗口候选
 *          → 紧邻 OOS Window → 真实 Strategy Runtime + Backtest
 *          → OOS Metrics → 下一个 Window → 多 Fold 汇总 → Walk-Forward Result
 * ```
 *
 * 🔴 **本域是编排层，不是新引擎**。禁止新建 Backtest / Metrics / Strategy Runtime /
 *   Parameter Search Engine，也禁止复制 OOS 引擎（规格 §6 Step E / §22）。
 *   每个 Fold 的「搜索」与「样本外验证」分别**调用** `parameterSearch/**` 与
 *   `oosValidation/**` 的**既有 application service**（不经 HTTP 自调用，规格 §15）。
 *
 * ## 与既有三个「walk-forward 味道」模块的边界（**必须严格区分**）
 *
 * | 模块 | 是什么 | 与本文档的关系 |
 * | --- | --- | --- |
 * | `server/research/walkForwardRun/**`（C-19.1） | 窗口**几何**纯函数 + 内存态编排原语（需注入 evaluator 工厂） | **只读复用**其 `generateWalkForwardSplits`（本域不重写窗口几何） |
 * | `server/research/rollingOptimization/**`（C-17.2） | 逐窗全量搜索 + 描述性跨窗统计（内存态、不落库） | **不依赖**（新域须真跑持久化 PS / OOS） |
 * | `server/research/walkForward.ts`（LEGACY 6.5） | 旧日历天 WFO 服务 | **不依赖、不修改** |
 *
 * ## 状态词表（规格 §5 / §12）
 *
 * - Run 状态**复用** `PARAMETER_SEARCH_RUN_STATUSES` 唯一词表，迁移表唯一权威仍是
 *   `server/research/parameterSearch/searchRun.ts#PARAMETER_SEARCH_RUN_TRANSITIONS`；
 * - **Fold 状态**是本域独有的细粒度生命周期（比 Run 状态多，因为一个 Fold 要走完
 *   搜索 + 冻结 + 样本外三段），故在本文档定义，并配 `canTransitionWalkForwardFold`。
 *
 * ## 措辞纪律（规格 §7 / §12）
 *
 * 本域**不产出**任何「最佳 / 最优 / 推荐 / winner / best / optimal」语义：
 *   - 候选选择只能是**显式声明且可审计**的 deterministic policy（见
 *     `WALK_FORWARD_SELECTION_POLICIES`），且**必须写进快照**；
 *   - 多 Fold 汇总**只做描述性统计**（计数 / 均值 / 中位数 / 观测区间），
 *     **不排序、不评级、不判定通过或淘汰**，也**不称任何 Fold 为「最好 / 最差」**。
 */

import { z } from "zod";
import {
  PARAMETER_SEARCH_RUN_STATUSES,
  parameterSearchMethodSchema,
  parameterSearchValueSchema,
} from "./parameterSearchContracts";
import {
  oosComparisonSchema,
  oosMetricsSchema,
  oosWindowSchema,
} from "./oosValidationContracts";

// ---------------------------------------------------------------------------
// 记录身份
// ---------------------------------------------------------------------------

/** Walk-Forward Run 记录标签（落库 JSON 的可判别标记）。 */
export const WALK_FORWARD_VALIDATION_RUN_RECORD_KIND = "WALK_FORWARD_VALIDATION_RUN" as const;
/** Walk-Forward Fold 记录标签。 */
export const WALK_FORWARD_VALIDATION_FOLD_RECORD_KIND = "WALK_FORWARD_VALIDATION_FOLD" as const;
/** schema 版本：字段语义变更必须递增。 */
export const WALK_FORWARD_VALIDATION_RECORD_VERSION = 1 as const;

/**
 * Run ID 前缀（`WFV-YYYYMMDD-XXXXXXXX`）。
 *
 * ⚠️ **为什么不叫 `WALK_FORWARD_RUN_ID_PREFIX`**：仓库里已有同名的 `"WFA"`
 *   （`server/research/walkForwardRun/types.ts`，C-19.1 的内存态 Run），
 *   且它经 `server/research/index.ts` **全域 re-export**。同名会让读者与 `export *`
 *   发生**静默遮蔽** ⇒ 本域一律带 `VALIDATION` 以示区分。
 */
export const WALK_FORWARD_VALIDATION_RUN_ID_PREFIX = "WFV";

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

/** Run 状态（= PS 唯一词表；不另立语义）。 */
export const WALK_FORWARD_RUN_STATUSES = PARAMETER_SEARCH_RUN_STATUSES;
export const walkForwardRunStatusSchema = z.enum(PARAMETER_SEARCH_RUN_STATUSES);
export type WalkForwardRunStatus = (typeof PARAMETER_SEARCH_RUN_STATUSES)[number];

/** 窗口模式（规格 §4.1）。`EXPANDING` 在既有几何里叫 `anchored`（语义相同：起点固定、末点扩张）。 */
export const WALK_FORWARD_WINDOW_MODES = ["ROLLING", "EXPANDING"] as const;
export const walkForwardWindowModeSchema = z.enum(WALK_FORWARD_WINDOW_MODES);
export type WalkForwardWindowMode = (typeof WALK_FORWARD_WINDOW_MODES)[number];

/**
 * Fold 生命周期（规格 §5）—— 本域独有词表。
 *
 * ```text
 * WINDOW_CREATED → SEARCH_RUNNING → SEARCH_COMPLETED → CANDIDATE_FROZEN
 *                → OOS_RUNNING → OOS_COMPLETED
 * 任一阶段失败 → FAILED（终态；不伪造成功）
 * ```
 */
export const WALK_FORWARD_FOLD_STATUSES = [
  "WINDOW_CREATED",
  "SEARCH_RUNNING",
  "SEARCH_COMPLETED",
  "CANDIDATE_FROZEN",
  "OOS_RUNNING",
  "OOS_COMPLETED",
  "FAILED",
] as const;
export const walkForwardFoldStatusSchema = z.enum(WALK_FORWARD_FOLD_STATUSES);
export type WalkForwardFoldStatus = (typeof WALK_FORWARD_FOLD_STATUSES)[number];

/**
 * Fold **结果语义**（与生命周期正交：生命周期答「走到哪」，本字段答「走出来是什么」）。
 *
 * 🔴 `INSUFFICIENT_TRADING_ACTIVITY` 是**如实读数**（样本外 0 笔成交），
 *   不是「差」也不是「淘汰」—— 本域不对它做任何优劣判定（规格 §12）。
 */
export const WALK_FORWARD_FOLD_OUTCOMES = [
  "PENDING",
  "SUCCEEDED",
  "INSUFFICIENT_TRADING_ACTIVITY",
  "FAILED",
] as const;
export const walkForwardFoldOutcomeSchema = z.enum(WALK_FORWARD_FOLD_OUTCOMES);
export type WalkForwardFoldOutcome = (typeof WALK_FORWARD_FOLD_OUTCOMES)[number];

// ---------------------------------------------------------------------------
// Window Contract（规格 §4）
// ---------------------------------------------------------------------------

/**
 * 窗口排程配置（**交易日锚定**，规格 §4.2）。
 *
 * 🔴 字段单位是**交易日个数**，不是日历天 —— 与既有窗口几何
 *   （`walkForwardRun/windows.ts` 的锚定决策）保持一致：窗内评估消费的是逐交易日数据流，
 *   日历天切片会把休市空隙卷进来，导致「窗切片」与「评估曲线实际覆盖的交易日」错位。
 *
 * `gapDays` 缺省 0 ⇒ `oosStart` 就是 `isEnd` 的**下一个交易日**
 *   （规格 §4 的 `oosStart = isEnd + 1 trading day`）。
 */
export const walkForwardWindowConfigSchema = z.object({
  /** 交易日序列的取样区间（含两端，`YYYY-MM-DD`）；实际 Fold 窗口落在此区间内。 */
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  /** IS（样本内）窗口长度（交易日个数）。ROLLING 下固定；EXPANDING 下是**首个**窗口长度。 */
  isWindowDays: z.number().int().positive(),
  /** OOS（样本外）窗口长度（交易日个数）。 */
  oosWindowDays: z.number().int().positive(),
  /** 相邻 Fold 之间的推进步长（交易日个数）。 */
  stepDays: z.number().int().positive(),
  windowMode: walkForwardWindowModeSchema,
  /** IS 与 OOS 之间的间隔（交易日个数）；缺省 0 = 紧邻。 */
  gapDays: z.number().int().nonnegative().optional(),
  /** IS 尾部 embargo（交易日个数，从 IS 末尾剔除，不参与搜索）；缺省 0。 */
  isEmbargoDays: z.number().int().nonnegative().optional(),
  /** Fold 数上限（生成前强制，不截断）；缺省不设上限。 */
  maxFolds: z.number().int().positive().optional(),
});
export type WalkForwardWindowConfig = z.infer<typeof walkForwardWindowConfigSchema>;

/** 单个 Fold 的四个窗口端点（规格 §4：每个 Fold 必须生成明确的 isStart/isEnd/oosStart/oosEnd）。 */
export const walkForwardFoldWindowSchema = z.object({
  foldIndex: z.number().int().nonnegative(),
  isStart: z.string().min(1),
  isEnd: z.string().min(1),
  oosStart: z.string().min(1),
  oosEnd: z.string().min(1),
  /** 实际交易日个数（IS 侧剔除 embargo 前）。 */
  isTradingDays: z.number().int().positive(),
  oosTradingDays: z.number().int().positive(),
});
export type WalkForwardFoldWindow = z.infer<typeof walkForwardFoldWindowSchema>;

/**
 * 窗口排程指纹（规格 §16：同指纹 + 同 dataset + 同 policy ⇒ 同 schedule）。
 *
 * 🔴 只覆盖**确定性输入**（配置 + 实际选中的交易日序列），不含时间戳 ⇒ 可跨运行比对。
 */
export const walkForwardScheduleSnapshotSchema = z.object({
  config: walkForwardWindowConfigSchema,
  /** 实际用于生成窗口的交易日序列（升序、无重复）。 */
  tradeDates: z.array(z.string()),
  /** 交易日序列指纹（canonical sha256）。 */
  tradeDatesFingerprint: z.string().min(1),
  /** 排程指纹：覆盖 config + tradeDates + 生成出的全部 Fold 端点。 */
  scheduleFingerprint: z.string().min(1),
  windows: z.array(walkForwardFoldWindowSchema),
});
export type WalkForwardScheduleSnapshot = z.infer<typeof walkForwardScheduleSnapshotSchema>;

// ---------------------------------------------------------------------------
// Candidate Selection Policy（规格 §7：显式、可审计、零「推荐」语义）
// ---------------------------------------------------------------------------

/**
 * 候选选择策略词表。
 *
 * 🔴 **本域刻意不提供任何「按收益 / 风险指标排序取极值」的生产策略** ——
 *   那会把「自动挑最优参数」偷偷带进来（规格 §7 / §22 明禁）。
 *   两种策略都**不含指标**：
 *   - `FIRST_ELIGIBLE_COMBINATION`：按 `combinationIndex` **升序**取第一个
 *     「有成功结果行」的组合 ⇒ 纯位置规则，完全确定；
 *   - `EXPLICIT_PARAMETER_HASH`：调用方显式给出 `parameterHash`，
 *     在本 Fold 的搜索结果里查找；找不到即该 Fold **显式失败**（不回落、不代选）。
 */
export const WALK_FORWARD_SELECTION_POLICIES = [
  "FIRST_ELIGIBLE_COMBINATION",
  "EXPLICIT_PARAMETER_HASH",
] as const;
export const walkForwardSelectionPolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FIRST_ELIGIBLE_COMBINATION") }),
  z.object({ kind: z.literal("EXPLICIT_PARAMETER_HASH"), parameterHash: z.string().min(1) }),
]);
export type WalkForwardSelectionPolicy = z.infer<typeof walkForwardSelectionPolicySchema>;

// ---------------------------------------------------------------------------
// Fold 视图（规格 §8 Fold 必存字段）
// ---------------------------------------------------------------------------

/**
 * Fold 记录视图。所有 snapshot 均为**写入即冻结**，读取方不得回读当前策略版本重建。
 */
export const walkForwardFoldViewSchema = z.object({
  recordKind: z.literal(WALK_FORWARD_VALIDATION_FOLD_RECORD_KIND),
  recordVersion: z.number().int().positive(),
  walkForwardRunId: z.string().min(1),
  foldIndex: z.number().int().nonnegative(),
  /** 窗口端点（`isEnd < oosStart` 为硬约束，创建时即断言）。 */
  isStart: z.string().min(1),
  isEnd: z.string().min(1),
  oosStart: z.string().min(1),
  oosEnd: z.string().min(1),
  /** 该 Fold 自己的 Parameter Search Run（**独立搜索**，规格 §11）。 */
  sourceSearchRunId: z.string().nullable(),
  /** 该 Fold 的 Search 窗口（与 `isStart/isEnd` **必须相等**；泄漏守卫会断言）。 */
  searchWindow: oosWindowSchema.nullable(),
  /** 冻结的候选身份（组合序号 + parameterHash）。 */
  sourceCombinationIndex: z.number().int().nullable(),
  parameterHash: z.string().nullable(),
  /** 冻结的参数快照（原样来自源组合行，禁止由当前 Schema 重新推导）。 */
  resolvedParameterSet: z.record(z.string(), parameterSearchValueSchema).nullable(),
  /** 策略身份与定义指纹（继承创建时冻结值）。 */
  strategyVersionId: z.string().min(1),
  strategyFingerprint: z.string().nullable(),
  datasetVersionId: z.number().int().nullable(),
  /** 该 Fold 自己的 OOS Run（**独立验证**）。 */
  oosRunId: z.string().nullable(),
  oosWindow: oosWindowSchema.nullable(),
  status: walkForwardFoldStatusSchema,
  outcome: walkForwardFoldOutcomeSchema,
  /** IS 指标快照（来自源 Search 结果行的冻结副本，零重算）。 */
  isMetrics: oosMetricsSchema.nullable(),
  isMetricsSource: z.string().nullable(),
  /** OOS 指标快照（来自本次真实重跑读数）。 */
  oosMetrics: oosMetricsSchema.nullable(),
  oosMetricsSource: z.string().nullable(),
  /** 该 Fold 的 IS/OOS 对照（复用 OOS 域既有对照，零重算）。 */
  comparison: oosComparisonSchema.nullable(),
  /** 本次 Fold 的 OOS 撮合指纹（证明「真在不同数据上重跑」的主判据）。 */
  oosBacktestFingerprint: z.string().nullable(),
  /** Fold 级执行指纹（覆盖窗口 + 全部冻结坐标 + 两个子 Run 身份）。 */
  executionFingerprint: z.string().min(1),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  notes: z.array(z.string()),
  createdAt: z.string().min(1),
  completedAt: z.string().nullable(),
});
export type WalkForwardFoldView = z.infer<typeof walkForwardFoldViewSchema>;

// ---------------------------------------------------------------------------
// 多 Fold 汇总（规格 §12：**只做描述性统计**）
// ---------------------------------------------------------------------------

/**
 * 单个指标的描述性统计。
 *
 * 🔴 `null` = 该统计**不可用**（无任何 Fold 贡献该指标），绝不编造成 0。
 *   `observedMin` / `observedMax` 是**观测区间**（描述性事实），
 *   **不代表优 / 劣**，代码与 UI 均不得据此排序或评级。
 */
export const walkForwardMetricStatSchema = z.object({
  /** 参与统计的 Fold 数（该指标两侧都非 null 的 Fold 数）。 */
  availableCount: z.number().int().nonnegative(),
  mean: z.number().nullable(),
  median: z.number().nullable(),
  observedMin: z.number().nullable(),
  observedMax: z.number().nullable(),
});
export type WalkForwardMetricStat = z.infer<typeof walkForwardMetricStatSchema>;

/** 六项指标 × 两侧（IS / OOS）的描述性统计（键集合与 canonical 六项一致）。 */
export const walkForwardMetricStatsSchema = z.object({
  totalReturnPct: walkForwardMetricStatSchema,
  annualizedReturnPct: walkForwardMetricStatSchema,
  maxDrawdownPct: walkForwardMetricStatSchema,
  tradeCount: walkForwardMetricStatSchema,
  winRatePct: walkForwardMetricStatSchema,
  profitFactor: walkForwardMetricStatSchema,
});
export type WalkForwardMetricStats = z.infer<typeof walkForwardMetricStatsSchema>;

/**
 * 多 Fold 汇总结果（规格 §12）。
 *
 * 🔴 本对象里**没有** `recommended` / `best` / `optimal` / `winner` 之类字段，
 *   也不含「自动通过 / 淘汰」判定 —— 这是接口层事实，不是注释承诺。
 */
export const walkForwardAggregateSchema = z.object({
  foldCount: z.number().int().nonnegative(),
  completedFoldCount: z.number().int().nonnegative(),
  failedFoldCount: z.number().int().nonnegative(),
  /** 走出结果但成交不足的 Fold 数（如实计数，不代表差）。 */
  insufficientTradingActivityCount: z.number().int().nonnegative(),
  /** 参与汇总的 Fold 数（`outcome = SUCCEEDED`）。 */
  contributingFoldCount: z.number().int().nonnegative(),
  isStats: walkForwardMetricStatsSchema,
  oosStats: walkForwardMetricStatsSchema,
  /** IS/OOS 退化的描述性统计（逐 Fold delta 的均值 / 中位数；正数 = 样本外下降）。 */
  totalReturnDegradationPct: walkForwardMetricStatSchema,
  drawdownChangePct: walkForwardMetricStatSchema,
  tradeCountChange: walkForwardMetricStatSchema,
  /** 汇总说明（含「哪些 Fold 因不可用而缺席」；不静默）。 */
  notes: z.array(z.string()),
});
export type WalkForwardAggregate = z.infer<typeof walkForwardAggregateSchema>;

// ---------------------------------------------------------------------------
// Run 视图（规格 §8 Run 必存字段）
// ---------------------------------------------------------------------------

export const walkForwardRunViewSchema = z.object({
  recordKind: z.literal(WALK_FORWARD_VALIDATION_RUN_RECORD_KIND),
  recordVersion: z.number().int().positive(),
  /** 业务身份（`WFV-YYYYMMDD-XXXXXXXX`）。 */
  walkForwardRunId: z.string().min(1),
  /** 滚动的是哪个策略版本（**创建时冻结**，不是 latest）。 */
  strategyId: z.string().min(1),
  strategyVersion: z.string().min(1),
  strategyVersionId: z.string().min(1),
  strategyFingerprint: z.string().nullable(),
  datasetVersionId: z.number().int().nullable(),
  datasetVersionLabel: z.string().nullable(),
  /** 窗口配置 + 交易日序列 + 生成出的 Fold 端点（创建时冻结）。 */
  schedule: walkForwardScheduleSnapshotSchema,
  /** 候选选择策略快照（规格 §7：必须写入快照）。 */
  selectionPolicy: walkForwardSelectionPolicySchema,
  /** 每 Fold 的 Parameter Search 方法（复用 PS 词表）。 */
  searchMethod: z.string().min(1),
  /** 每 Fold 的组合数上限（可为 null）。 */
  maxCombinationsPerFold: z.number().int().positive().nullable(),
  totalFoldCount: z.number().int().nonnegative(),
  completedFoldCount: z.number().int().nonnegative(),
  failedFoldCount: z.number().int().nonnegative(),
  /** 当前 Fold 序号（推进中；全部完成时为 null）。 */
  currentFoldIndex: z.number().int().nonnegative().nullable(),
  metricsVersion: z.string().min(1),
  engineVersion: z.string().min(1),
  status: walkForwardRunStatusSchema,
  /** 运行内容指纹（除 `fingerprint` / 时间戳外全部冻结字段的 canonical sha256）。 */
  runFingerprint: z.string().min(1),
  /** 是否可以（重新）执行：`CREATED` / `FAILED` / `CANCELLED` ⇒ true；`COMPLETED` ⇒ false。 */
  canExecute: z.boolean(),
  aggregate: walkForwardAggregateSchema.nullable(),
  notes: z.array(z.string()),
  createdAt: z.string().min(1),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type WalkForwardRunView = z.infer<typeof walkForwardRunViewSchema>;

// ---------------------------------------------------------------------------
// API 入参
// ---------------------------------------------------------------------------

/**
 * 创建 Walk-Forward Run（**只冻结排程与策略身份，不立即执行**）。
 *
 * 🔴 入参里**没有**任何「每 Fold 用哪组参数」的位置（除了策略名显式要求的
 *   `selectionPolicy.parameterHash`）⇒ 「Walk-Forward 不允许自动挑最优参数」
 *   是接口层事实。
 *
 * 🔴 入参里也**刻意没有**「参数空间覆盖」——搜索空间唯一来源 = **策略文档声明的
 *   `parameterRole` / 上下界 / 步长**（经 `bundle.projections.parameters` 派生）。
 *
 *   为什么不做成入参：若要支持「每次运行覆盖搜索空间」，那它就是**运行配置**的一部分，
 *   而 §10 要求运行配置在**创建时冻结** ⇒ 必须落进 `walk_forward_run` 行、进 `runFingerprint`、
 *   并在重执行时逐字节复核。把它做成「接受但无处存放」的入参，只会得到一个
 *   **静默失效的旋钮**（本项在施工自审中就是这样一个缺陷：字段被 schema 接受、
 *   被端点原样转交，却从未影响任何一个 Fold 的搜索）。
 *   ⇒ 在「有冻结列」之前**不暴露**该旋钮；搜索空间过大时由既有
 *   `MAX_COMBINATIONS_EXCEEDED` 响亮拒绝（禁止截断），而不是让调用方以为覆盖生效了。
 */
export const createWalkForwardValidationInputSchema = z.object({
  strategyId: z.string().min(1),
  strategyVersion: z.string().min(1),
  /** Dataset Registry 权威坐标；缺省时回落策略文档绑定（与 `createSearch` 同一回落规则）。 */
  datasetVersionId: z.number().int().positive().nullish(),
  windowConfig: walkForwardWindowConfigSchema,
  selectionPolicy: walkForwardSelectionPolicySchema,
  /** 每 Fold 的搜索方法；缺省 `GRID_SEARCH`。 */
  searchMethod: parameterSearchMethodSchema.optional(),
  /** 每 Fold 的组合数上限。 */
  maxCombinationsPerFold: z.number().int().positive().optional(),
  /** 指标版本自述；缺省由服务端填唯一口径。 */
  metricsVersion: z.string().min(1).optional(),
});
export type CreateWalkForwardValidationInput = z.infer<
  typeof createWalkForwardValidationInputSchema
>;

/** Run 身份入参（start / cancel / get）。 */
export const walkForwardRunIdInputSchema = z.object({
  walkForwardRunId: z.string().min(1),
});
export type WalkForwardRunIdInput = z.infer<typeof walkForwardRunIdInputSchema>;

/** 单个 Fold 读取入参。 */
export const walkForwardFoldInputSchema = z.object({
  walkForwardRunId: z.string().min(1),
  foldIndex: z.number().int().nonnegative(),
});
export type WalkForwardFoldInput = z.infer<typeof walkForwardFoldInputSchema>;

/** 列表入参。 */
export const listWalkForwardRunsInputSchema = z.object({
  strategyId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type ListWalkForwardRunsInput = z.infer<typeof listWalkForwardRunsInputSchema>;

// ---------------------------------------------------------------------------
// 视图聚合（创建回执 / 执行回执 / 详情）
// ---------------------------------------------------------------------------

/** 创建回执（如实回报窗口排程与冻结坐标）。 */
export const walkForwardCreateResultSchema = z.object({
  run: walkForwardRunViewSchema,
  folds: z.array(walkForwardFoldViewSchema),
  notes: z.array(z.string()),
});
export type WalkForwardCreateResultView = z.infer<typeof walkForwardCreateResultSchema>;

/** 执行回执（`executed=false` = 已 COMPLETED / CANCELLED 且未重跑；幂等重放语义）。 */
export const walkForwardExecuteOutcomeSchema = z.object({
  run: walkForwardRunViewSchema,
  executed: z.boolean(),
  folds: z.array(walkForwardFoldViewSchema),
  notes: z.array(z.string()),
});
export type WalkForwardExecuteOutcomeView = z.infer<
  typeof walkForwardExecuteOutcomeSchema
>;

/**
 * 取消回执。
 *
 * `notes` **必须**存在：取消在本域是**协作式**的（执行是一个进程内的串行 Fold 循环，
 * 无法从外部打断已经发出的一次搜索 / 回测），因此「什么时候真正停下来」必须如实说明，
 * 而不是假装「立即停了」。
 */
export const walkForwardCancelOutcomeSchema = z.object({
  run: walkForwardRunViewSchema,
  notes: z.array(z.string()),
});
export type WalkForwardCancelOutcomeView = z.infer<typeof walkForwardCancelOutcomeSchema>;

/** 详情（Run + 全部 Fold）。 */
export const walkForwardRunDetailSchema = z.object({
  run: walkForwardRunViewSchema,
  folds: z.array(walkForwardFoldViewSchema),
});
export type WalkForwardRunDetailView = z.infer<typeof walkForwardRunDetailSchema>;

// ---------------------------------------------------------------------------
// 契约 ↔ 领域类型的双向结构断言锚点（编译期；由测试引用，防止两处形状漂移）
// ---------------------------------------------------------------------------

/** 编译期断言工具：两侧必须互相可赋值，否则本文件编译失败。 */
export type WalkForwardContractAssertion<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
