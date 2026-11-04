/**
 * WALK-FORWARD-001 — Walk-Forward 验证领域类型与常量。
 *
 * ## 这个域在链路里的位置（规格 §1）
 *
 * ```text
 * 历史数据 → IS Window → Parameter Search → 冻结该窗口候选
 *          → 紧邻 OOS Window → 真实 Strategy Runtime + Backtest
 *          → OOS Metrics → 下一个 Window → 多 Fold 汇总
 * ```
 *
 * ## 复用的唯一权威（本域**不新建**任何一套）
 *
 * | 能力 | 唯一权威 |
 * | --- | --- |
 * | 窗口几何（rolling / expanding + 无重叠断言） | `server/research/walkForwardRun/windows.ts#generateWalkForwardSplits` |
 * | 参数搜索 | `server/research/parameterSearch/executor.ts#createParameterSearchRun` / `#executeParameterSearchRun` |
 * | 候选 hash 复核 | `server/research/parameterSearch/parameterHash.ts#computeParameterHash` |
 * | 样本外验证（真重跑 + 真重算） | `server/research/oosValidation/executor.ts#createOosValidationRun` / `#startOosValidationRun` |
 * | 指标口径 | `server/backtest/backtestResult.ts#canonicalMetrics()`（经 OOS 域投影） |
 * | canonical 序列化 / 指纹 | `server/researchDataset/version.ts#canonicalStringify` |
 * | Run 状态迁移表 | `server/research/parameterSearch/searchRun.ts#PARAMETER_SEARCH_RUN_TRANSITIONS` |
 *
 * 🔴 本域**禁止**：import 任何 Backtest / Metrics 引擎实现、import `searchRobustness/**`
 *   （两个独立验证维度，规格 §19）、复制 OOS 引擎、用当前策略版本重新推导历史参数。
 *
 * ## 与既有 `walkForwardRun/**`（C-19.1）的区别（**必须分清，名字仅差 3 个字符**）
 *
 * | | `walkForwardRun/**`（C-19.1，已有） | `walkForward/**`（WALK-FORWARD-001，本域） |
 * | --- | --- | --- |
 * | 定位 | 窗口**几何**纯函数 + **内存态**编排原语 | **持久化**多 Fold 编排 + 可追溯 |
 * | 执行方式 | 调用方**注入 evaluator 工厂**，进程内求值 | 每 Fold **真建** PS Run + **真建** OOS Run |
 * | 落库 | ❌ 不落库（跑完即弃） | ✅ 两张表（`walk_forward_run` / `walk_forward_fold`） |
 * | 与 OOS-001 关系 | 无 | **调用** OOS application service（不经 HTTP） |
 *
 * ⇒ 本域**只读复用** C-19.1 的 `generateWalkForwardSplits`（窗口几何），
 *   其余一律不复用；两域并列不合并。
 */

import type {
  WalkForwardAggregate,
  WalkForwardFoldStatus,
  WalkForwardFoldView,
  WalkForwardFoldWindow,
  WalkForwardMetricStat,
  WalkForwardMetricStats,
  WalkForwardRunStatus,
  WalkForwardRunView,
  WalkForwardScheduleSnapshot,
  WalkForwardSelectionPolicy,
  WalkForwardWindowConfig,
} from "../../../shared/walkForwardContracts";
import { OOS_ENGINE_VERSION, OOS_METRICS_VERSION } from "../oosValidation/types";

// ---------------------------------------------------------------------------
// 身份 / 版本自述
// ---------------------------------------------------------------------------

/**
 * Run ID 前缀（`WFV-YYYYMMDD-XXXXXXXX`）—— **唯一来源在 `shared/walkForwardContracts.ts`**，
 * 此处只做转发，避免两处字面量漂移。
 */
export { WALK_FORWARD_VALIDATION_RUN_ID_PREFIX } from "../../../shared/walkForwardContracts";

/**
 * 指标版本自述。
 *
 * 🔴 **沿用 OOS 域的同一条自述**，不重新拼一遍字面量 —— 本域与 OOS 用的是**同一份**
 *   canonical 指标口径（`server/backtest/backtestResult.ts#canonicalMetrics()`），
 *   两处自述必须永远相等，否则意味着有一处口径已经漂移。
 */
export const WALK_FORWARD_METRICS_VERSION = OOS_METRICS_VERSION;

/** 决策引擎版本自述（同上：沿用 OOS 域，不写第二份字面量）。 */
export const WALK_FORWARD_ENGINE_VERSION = OOS_ENGINE_VERSION;

// ---------------------------------------------------------------------------
// 领域常量
// ---------------------------------------------------------------------------

/** 列表默认返回上限。 */
export const DEFAULT_WALK_FORWARD_RUN_LIST_LIMIT = 50;

/** 单个 Fold 的说明条数上限（防 notes 无限增长）。 */
export const MAX_WALK_FORWARD_FOLD_NOTES = 24;

/** 单个 Run 的说明条数上限。 */
export const MAX_WALK_FORWARD_RUN_NOTES = 24;

/** 空描述性统计（无贡献 Fold 时的如实占位 —— 全 `null` + 计数 0，不是全 0）。 */
export const EMPTY_WALK_FORWARD_METRIC_STAT: WalkForwardMetricStat = {
  availableCount: 0,
  mean: null,
  median: null,
  observedMin: null,
  observedMax: null,
};

export type {
  WalkForwardAggregate,
  WalkForwardFoldStatus,
  WalkForwardFoldView,
  WalkForwardFoldWindow,
  WalkForwardMetricStat,
  WalkForwardMetricStats,
  WalkForwardRunStatus,
  WalkForwardRunView,
  WalkForwardScheduleSnapshot,
  WalkForwardSelectionPolicy,
  WalkForwardWindowConfig,
};

// ---------------------------------------------------------------------------
// 领域中间形态
// ---------------------------------------------------------------------------

/**
 * 一个 Fold 的**完全解析**排程（窗口端点 + 该 Fold 实际使用的 IS 交易日集合）。
 *
 * `searchTradeDates` = IS 窗口剔除 embargo 后的交易日（**搜索只能看这些日子**）；
 * `oosTradeDates` = OOS 窗口的交易日。两者由几何保证无交集，
 * 并由 `leakage.ts#assertFoldLeakageGuard` 在运行时再断言一次。
 */
export interface WalkForwardFoldSchedule {
  readonly foldIndex: number;
  readonly isStart: string;
  readonly isEnd: string;
  readonly oosStart: string;
  readonly oosEnd: string;
  readonly isTradeDates: readonly string[];
  readonly searchTradeDates: readonly string[];
  readonly embargoTradeDates: readonly string[];
  readonly oosTradeDates: readonly string[];
  readonly gapTradeDates: readonly string[];
  readonly isTradingDays: number;
  readonly oosTradingDays: number;
}

/**
 * 冻结的候选选择结果（来自该 Fold 自己的 Search 结果行；**不由调用方提供参数值**）。
 *
 * `hashRecomputed` 是「用命令行重算 hash 并逐字节比对」的结论 —— 不一致即响亮拒绝
 * （行被外部篡改 / 哈希口径漂移过）。
 */
export interface WalkForwardCandidateSelection {
  readonly foldIndex: number;
  readonly sourceSearchRunId: string;
  readonly combinationIndex: number;
  readonly parameterHash: string;
  readonly parameters: Readonly<Record<string, number | string | boolean | null>>;
  readonly hashRecomputed: string;
  readonly policy: WalkForwardSelectionPolicy;
  readonly note: string;
}

// ---------------------------------------------------------------------------
// 归一化读数形状（**本域不新增任何指标**，只转发契约形状）
// ---------------------------------------------------------------------------

/**
 * 六项 canonical 读数快照（形状 = 契约 `oosMetricsSchema`；`null` = 不可用，不是 0）。
 *
 * 🔴 口径唯一来源 = `server/backtest/backtestResult.ts#canonicalMetrics()`；
 *   本域**不重算、不新增、不改名**任何一项。
 */
export type WalkForwardMetricsSnapshot = WalkForwardFoldView["isMetrics"];

/** IS/OOS 对照快照（形状 = 契约 `oosComparisonSchema`；由 OOS 域产出，本域零重算）。 */
export type WalkForwardComparisonSnapshot = WalkForwardFoldView["comparison"];

/**
 * 组合行 / 结果行的**结构**（与 `selection.ts#CandidateCombinationRow` /
 * `CandidateResultRow` 逐字段一致）。
 *
 * ⚠️ 刻意在此**内联**而不是 import：`selection.ts` 反过来 import 本文件，
 *   若在此 import 会形成类型层的循环依赖。两处形状由测试断言保持相等。
 */
export interface WalkForwardCombinationSnapshot {
  readonly combinationIndex: number;
  readonly parameterHash: string;
  /** 参数取值（`longtext` 读回来是**字符串**，`selection.ts` 负责解析两种形态）。 */
  readonly parametersJson: string | Record<string, unknown>;
}

export interface WalkForwardResultSnapshot {
  readonly combinationIndex: number;
  readonly parameterHash: string;
  /** `SUCCEEDED` / `FAILED`。 */
  readonly status: string;
  /** 该组合的 IS 读数（源 Search 结果行的冻结副本；本域零重算）。 */
  readonly metrics: WalkForwardMetricsSnapshot;
  /** IS 读数来源自述（`canonical` / `evaluators`）。 */
  readonly metricsSource: string | null;
}

/**
 * Fold 的 IS / OOS 读数快照（从该 Fold 的 OOS 结果行读出；**本域零重算**）。
 *
 * 🔴 「零重算」不等于「零重跑」：真正的重跑发生在 `oosValidation/**` 里
 *   （它调 `createStrategyBacktestBridge` 真跑回测并 `projectCanonicalMetrics` 重算）。
 *   本域只是把那条已重跑出来的读数**搬进** Fold 行，绝不自己算指标。
 */
export interface WalkForwardFoldReadouts {
  readonly isMetrics: WalkForwardMetricsSnapshot;
  readonly isMetricsSource: string | null;
  readonly oosMetrics: WalkForwardMetricsSnapshot;
  readonly oosMetricsSource: string | null;
  readonly comparison: WalkForwardComparisonSnapshot;
  readonly oosBacktestFingerprint: string | null;
  readonly oosRunStatus: string;
}

/**
 * 冻结主体的**当前**坐标 —— 执行前拿去与创建时冻结值逐值比对（规格 §10 FAIL LOUDLY）。
 *
 * 由组合根（router）读回，因为「当前策略文档指纹 / 当前数据集版本」只能由
 * 策略域与数据集域回答；本域**不 import** 它们的读实现（也绝不回读后自动修复）。
 */
export interface WalkForwardCurrentContext {
  readonly strategyFingerprint: string | null;
  readonly datasetVersionId: number | null;
  readonly datasetVersionLabel: string | null;
  readonly datasetWindow: { readonly startDate: string; readonly endDate: string } | null;
}

// ---------------------------------------------------------------------------
// 注入式 Fold 执行钩子
// ---------------------------------------------------------------------------

export interface WalkForwardFoldSearchRequest {
  readonly walkForwardRunId: string;
  readonly foldIndex: number;
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 该 Fold 的 IS 窗口（搜索窗口，硬约束 = 只能等于它）。 */
  readonly isWindow: { readonly startDate: string; readonly endDate: string };
  readonly isTradeDates: readonly string[];
  readonly maxCombinations: number | null;
}

/**
 * 搜索钩子的回执（**归一化读数**）。
 *
 * 🔴 组合根必须从**落库的行**读回这些坐标再返回（不是把请求参数回传）——
 *   泄漏守卫的意义正是「用真实落库的事实复核内存里的意图」；
 *   若把入参原样回传，守卫就退化成自证。
 */
export interface WalkForwardFoldSearchHandle {
  readonly searchRunId: string;
  /** 该 Search Run 行上的窗口（从库里读回；泄漏守卫判据 ①）。 */
  readonly searchWindow: { readonly startDate: string; readonly endDate: string };
  /** 搜索实际使用的交易日；不可得时传 `null`（守卫跳过该判据，不假装查过）。 */
  readonly searchTradeDates: readonly string[] | null;
  /** 该 Fold 搜索产出的**全部**组合行（组合根**必须**已按 `combinationIndex` 升序）。 */
  readonly combinations: readonly WalkForwardCombinationSnapshot[];
  /** 该 Fold 搜索产出的**全部**结果行（每行都带该组合自己的 IS 读数）。 */
  readonly results: readonly WalkForwardResultSnapshot[];
  /**
   * 🔴 IS 读数**刻意不在这一层**：它属于**被选中的那个组合**，而「选中谁」要到
   *   `selection.ts#selectFoldCandidate` 才知道（本域不给钩子「替我们挑一个」的机会）。
   *   ⇒ 执行器按 `selection.parameterHash` 从 `results` 里取那一行的读数，
   *     取不到即 `WALK_FORWARD_CANDIDATE_RESULT_MISSING`（不编造 IS 读数）。
   */
  readonly notes: readonly string[];
}

export interface WalkForwardFoldOosRequest {
  readonly walkForwardRunId: string;
  readonly foldIndex: number;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly sourceSearchRunId: string;
  readonly parameterHash: string;
  readonly oosWindow: { readonly startDate: string; readonly endDate: string };
}

/** 样本外钩子的回执（同样是从落库行读回的归一化读数）。 */
export interface WalkForwardFoldOosHandle {
  readonly oosRunId: string;
  readonly executed: boolean;
  /** 该 OOS Run 行上的窗口（从库里读回；泄漏守卫判据 ④ 会要求它与排程**逐字相等**）。 */
  readonly oosWindow: { readonly startDate: string; readonly endDate: string };
  readonly oosRunStatus: string;
  readonly oosMetrics: WalkForwardMetricsSnapshot;
  readonly oosMetricsSource: string | null;
  readonly comparison: WalkForwardComparisonSnapshot;
  readonly oosBacktestFingerprint: string | null;
  readonly notes: readonly string[];
}

/**
 * 注入式 Fold 执行钩子（**本域不做策略 IO / 不碰 tRPC / 不发 HTTP**）。
 *
 * 与仓库既有模式一致：C-19.1 `runWalkForward` 注入 evaluator 工厂、
 * C-17.2 `runRollingOptimization` 注入 `RollingOptimizationEvaluatorFactory`。
 * 本域注入的是「怎么读当前上下文 / 怎么跑一个 Fold 的搜索 / 怎么跑一个 Fold 的样本外」，
 * 由 router（组合根）用既有 PS / OOS application service 实现 ⇒
 * **零复制**、**零 HTTP 自调用**（规格 §15）。
 */
export interface WalkForwardExecutionHooks {
  /** 读回冻结主体（策略定义指纹 / 数据集坐标与可用窗口）的**当前**值。 */
  readonly readCurrentContext: () => Promise<WalkForwardCurrentContext>;
  /** 跑该 Fold 的参数搜索（建 PS Run + 执行 + 读回组合/结果行）。抛错 ⇒ 该 Fold FAILED。 */
  readonly runFoldSearch: (
    request: WalkForwardFoldSearchRequest,
  ) => Promise<WalkForwardFoldSearchHandle>;
  /** 跑该 Fold 的样本外验证（建 OOS Run + 执行 + 读回结果行）。抛错 ⇒ 该 Fold FAILED。 */
  readonly runFoldOos: (
    request: WalkForwardFoldOosRequest,
  ) => Promise<WalkForwardFoldOosHandle>;
}
