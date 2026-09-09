/**
 * STEP 19 / C-19.2 — 样本内/外（IS/OOS）隔离记录与归档：类型契约（权威源）。
 *
 * 背景与边界（ROADMAP §21「STEP 19 — Walk-Forward / OOS」+ TASK_TRACKING §3.6 C-19.2）：
 *
 *   - C-19.1（walkForwardRun）已交付 Train→Optimize→Freeze→Test→Move Window 的窗口划分
 *     + 冻结纪律 + 逐窗编排，产出 `WalkForwardRun`（每窗 train/test 区间与参数、冻结证据、
 *     OOS 分段最小聚合 `WalkForwardAggregate`、指纹）。C-19.1 的注释明确声明：
 *     「OOS 隔离记录持久化 + 聚合报告留 C-19.2」。
 *   - C-19.2 只做**记录层的 IS/OOS 结果隔离 + 可审计归档 + OOS 结果聚合报告**，供 C-20
 *     （PBO / 参数敏感性 / 因子消融 / OOS 退化判定）消费。**不做任何「过拟合结论」**。
 *
 * 本模块的铁律（对齐项目最高规范 §0/§36/§42）：
 *   - **OOS 隔离是核心纪律**：OOS（Test）段数据/结果严禁参与优化或参数选择。本模块用
 *     数据结构 + 机器检查（assertOosIsolationDiscipline）在代码中体现这一纪律：
 *       · Train 与 Test 的 params / result / metrics 字段**分离存储**（两个独立嵌套对象
 *         `WindowTrainResult` / `WindowTestResult`，除身份键 windowId/windowIndex 外键集合
 *         无交集），禁止同一字段被两端共享写入；
 *       · `WindowTestResult` 不含任何「写回 params」的字段（OOS 结果无法反向改参数）；
 *       · `test.testParameterSet` 必须逐字段等于 `train.frozenParameterSet`（机器检查锁定）。
 *   - **PIT 安全**：窗口只看 T 及之前数据；OOS 权益曲线必须严格落在 test 区间内（不得混入
 *     train 区间数据，record.ts 里 assertOosEquityCurveContainedInTest 断言）。
 *   - **确定性**：纯函数、readonly 入参、无 Date.now / Math.random / IO（runId/createdAt 由
 *     调用方注入，缺省才取运行实例值）；日期处理用字符串切片/字典序（YYYY-MM-DD 字典序 =
 *     时间序），无 Date 对象。
 *   - **指纹防篡改**：canonicalStringify（server/researchDataset/version.ts）+ sha256 +
 *     serialize/deserialize/validate round-trip；反序列化后复核指纹 + 隔离纪律。
 *   - **FAIL FAST**：窗口不足 / 参数非法 / 隔离被破坏 / OOS 曲线越界 → 响亮抛错（稳定
 *     error code），禁止静默空结果、禁止静默丢失记录。
 *   - **诚实边界**：数据不足 / 无可评估窗口 → 显式 skipped + reasonCode，绝不编造；
 *     做不到的维度（跨段连续净值拼接等）显式声明为「分段描述性聚合，不做假连续曲线」。
 *
 * 与 C-19.1 的互补关系（隔离纪律的机器检查分两半，各自职责清晰）：
 *   - C-19.1 `verifyWalkForwardFreezeDiscipline` 管「冻结键一致 / 深冻结 / Test 晚于 Train」；
 *   - C-19.2 `verifyOosIsolation` 管「记录层 IS/OOS 结果字段分离 + 无重叠 + window id 唯一 +
 *     参数不回写 + 可审计归档」。
 */

import type { EquityPoint } from "../../backtest/types";
import type { ResearchParameterSet } from "../types";
import type { PerformanceEvaluationRun } from "../performanceMetrics";
import type { RiskAdjustedEvaluationRun } from "../riskAdjustedMetrics";
import type { WalkForwardAggregate, WalkForwardRun } from "../walkForwardRun";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** OosIsolationRun 记录种类标签（供序列化 / 反序列化判别）。 */
export const OOS_ISOLATION_RUN_RECORD_KIND = "OOS_ISOLATION_RUN" as const;

/** OosIsolationRun schema 版本：字段语义变更必须递增。 */
export const OOS_ISOLATION_RUN_RECORD_VERSION = 1 as const;

/** OosIsolationRun ID 前缀（`OOSISO-YYYYMMDD-XXXXXXXX`，风格对齐 WFA-* / SEARCH-*）。 */
export const OOS_ISOLATION_RUN_ID_PREFIX = "OOSISO" as const;

// ---------------------------------------------------------------------------
// 跳过原因码（显式记录，绝不静默跳过）
// ---------------------------------------------------------------------------

/**
 * OOS 窗口 / OOS 段无法评估的原因码。
 *
 * 注意：这里不包含「隔离被破坏」——隔离被破坏必须响亮抛错（FAIL FAST，见 discipline.ts
 * 的 `OOS19_ISOLATION_VIOLATION`），而不是记为「跳过」。跳过只针对「数据不足」的诚实场景。
 */
export type OosSkipReasonCode =
  /** WalkForwardRun 里该窗 test 阶段未评估（如 WFO19_NO_QUALIFIED_PARAMETERS → 无冻结参数）。 */
  | "OOS19_NO_TEST_RESULT"
  /** 有 test 标量绩效，但调用方未提供该窗 OOS 权益曲线 → 完整指标（CAGR/Sharpe/MaxDD 剖面）不可评估。 */
  | "OOS19_NO_OOS_EQUITY_CURVE"
  /** 提供了 OOS 权益曲线但点数 < 2 → C-16.1 无法评估（收益率区间不足），仅保留标量绩效。 */
  | "OOS19_OOS_CURVE_TOO_SHORT";

/** 全部跳过原因码（供校验 / 文档化）。 */
export const OOS_ISOLATION_SKIP_REASON_CODES: readonly OosSkipReasonCode[] = [
  "OOS19_NO_TEST_RESULT",
  "OOS19_NO_OOS_EQUITY_CURVE",
  "OOS19_OOS_CURVE_TOO_SHORT",
];

// ---------------------------------------------------------------------------
// IS / OOS 分离的窗口结果记录
// ---------------------------------------------------------------------------

/**
 * Train（In-Sample）段结果——**只**承载 Train 段自己的参数与绩效，绝不承载任何 OOS 结果。
 *
 * 字段分离纪律：本接口与 `WindowTestResult` 除身份键（windowId / windowIndex）外**键集合无
 * 交集**，由 `discipline.ts` 做键白名单机器检查（禁止同一字段被两端共享写入）。
 */
export interface WindowTrainResult {
  /** 窗口 ID（`${runId}-w${windowIndex}`；与 test.windowId 一致）。 */
  readonly windowId: string;
  readonly windowIndex: number;
  /** Train 段首 / 末交易日（YYYY-MM-DD）。 */
  readonly firstTrainDate: string;
  readonly lastTrainDate: string;
  /** 冻结参数的 canonical 键（复用 C-17.2 rollingParameterSetKey；无冻结参数时为 null）。 */
  readonly frozenParameterSetKey: string | null;
  /** Train 优化冻结的参数集（Test 阶段唯一合法输入；无冻结参数时为 null）。 */
  readonly frozenParameterSet: ResearchParameterSet | null;
  /** Train（IS）段绩效标量（来自 WalkForwardRun.frozen，冻结参数在其 Train 段被评样本的绩效）。 */
  readonly trainTotalReturnPct: number | null;
  readonly trainMaxDrawdownPct: number | null;
  readonly trainTradeCount: number | null;
}

/**
 * Test（Out-of-Sample）段结果——**只**承载 OOS 段自己的参数与绩效。
 *
 * 关键：本接口**不含任何「写回 params」的字段**——OOS 结果在结构上就无法反向修改冻结参数。
 * `testParameterSet` 是「Test 阶段实际使用参数」的逐字段记录，机器检查要求它恒等于
 * `train.frozenParameterSet`（否则视为隔离被破坏）。
 */
export interface WindowTestResult {
  readonly windowId: string;
  readonly windowIndex: number;
  /** Test（OOS）段首 / 末交易日（YYYY-MM-DD）。 */
  readonly firstTestDate: string;
  readonly lastTestDate: string;
  /** 阶段状态：succeeded（有 OOS 绩效）/ skipped（未评估）。 */
  readonly status: "succeeded" | "skipped";
  /** Test 阶段实际使用参数的 canonical 键（= 冻结参数键；succeeded 时非 null）。 */
  readonly testParameterSetKey: string | null;
  /** Test 阶段实际使用参数（逐字段记录；succeeded 时必须 === 冻结参数，机器检查锁定）。 */
  readonly testParameterSet: ResearchParameterSet | null;
  /** OOS 段绩效标量（来自 WalkForwardRun.test）。 */
  readonly totalReturnPct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly tradeCount: number | null;
  /** 跳过原因码（succeeded 且无 OOS 曲线时记录 NO_OOS_EQUITY_CURVE；skipped 时记录 NO_TEST_RESULT）。 */
  readonly skipReasonCode: OosSkipReasonCode | null;
  /** OOS 段权益曲线归档（可选；缺窗 → 完整指标 unassessed）。 */
  readonly oosEquityCurve: readonly EquityPoint[] | null;
}

/**
 * 单窗 IS/OOS 隔离元数据（机器记录隔离状态，供 `verifyOosIsolation` 与归档审计）。
 *
 * 这不是注释承诺，而是运行时计算的事实快照：
 *   - `trainTestOverlapCount`：Train 与 Test 日期集合交集大小（必须为 0）；
 *   - `testStrictlyAfterTrain`：Test 首日严格晚于 Train 末日；
 *   - `paramsFrozenFromTrain`：test 参数 === 冻结参数（OOS 段未改参数）；
 *   - `testResultWritesBackParams`：OOS 结果是否回写参数（结构上恒 false，机器检查保证）。
 */
export interface WindowIsolationMetadata {
  /** Train 与 Test 日期集合交集大小（0 = 无重叠；> 0 = 隔离被破坏）。 */
  readonly trainTestOverlapCount: number;
  /** Test 首日是否严格晚于 Train 末日。 */
  readonly testStrictlyAfterTrain: boolean;
  /** OOS 段实际使用参数是否 === Train 冻结参数（未回写/未改写参数）。 */
  readonly paramsFrozenFromTrain: boolean;
  /** OOS 结果是否回写了参数（结构上恒 false；机器检查以键白名单再次锁定）。 */
  readonly testResultWritesBackParams: boolean;
  /** 该窗隔离是否成立（= 上述全部成立）。 */
  readonly isolationHolds: boolean;
}

/**
 * 单个 WFO 窗口的 IS/OOS 隔离结果记录（不可变、可 JSON 序列化、带指纹）。
 *
 * Train 与 Test 的 params / result / metrics 分离存储（`train` / `test` 两个独立对象），
 * 由 `discipline.ts` 做键白名单 + 参数一致性 + 无重叠的机器检查。
 */
export interface WindowResultRecord {
  readonly windowId: string;
  readonly windowIndex: number;
  /** Train（IS）段结果（参数 + 绩效）。 */
  readonly train: WindowTrainResult;
  /** Test（OOS）段结果（参数 + 绩效 + 权益曲线归档）。 */
  readonly test: WindowTestResult;
  /** 隔离元数据（机器计算的隔离事实）。 */
  readonly isolation: WindowIsolationMetadata;
  /** 本窗内容指纹（sha256，十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// OOS 结果聚合报告
// ---------------------------------------------------------------------------

/**
 * 单个 OOS 段的评估结果（复用 C-16.1 / C-16.2 计算器，不重算指标定义）。
 *
 * 当 `assessed = true` 时，`performance` / `riskAdjusted` 非 null（该段 OOS 曲线经 C-16.1
 * `evaluatePerformance` 与 C-16.2 `evaluateRiskAdjustedMetrics` 完整评估）；当 `assessed =
 * false` 时，两者为 null，`skipReasonCode` 说明原因，仅保留 `totalReturnPct` 等标量（来自
 * WalkForwardRun.test，供最小聚合）。
 */
export interface OosSegmentMetrics {
  readonly windowId: string;
  readonly windowIndex: number;
  /** 是否有完整 C-16.1/C-16.2 评估。 */
  readonly assessed: boolean;
  /** 未评估原因（assessed=false 时非 null）。 */
  readonly skipReasonCode: OosSkipReasonCode | null;
  /** OOS 段标量绩效（来自 WalkForwardRun.test；succeeded 时非 null）。 */
  readonly totalReturnPct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly tradeCount: number | null;
  /** C-16.1 完整评估（assessed 时非 null）。 */
  readonly performance: PerformanceEvaluationRun | null;
  /** C-16.2 完整评估（assessed 时非 null）。 */
  readonly riskAdjusted: RiskAdjustedEvaluationRun | null;
}

/**
 * OOS 分段绩效聚合（**分段描述性聚合**，基于 assessed 段的完整指标）。
 *
 * 口径纪律：
 *   - `cumulatedTotalReturnPct` = 各 assessed 段 totalReturnPct 连乘 − 1（分段拼接，非连续
 *     净值曲线；与 C-19.1 `WalkForwardAggregate.cumulatedTestReturnPct` 同公式）；
 *   - `meanCagrPct` / `medianCagrPct` = 各段几何 CAGR 的算术均值 / 中位数（**描述性**，非
 *     整体 CAGR——段间不连续，不伪造跨段连续净值曲线）；
 *   - `maxMaxDrawdownPct` / `meanMaxDrawdownPct` = 各段 MaxDD 的最大值 / 均值；
 *   - `meanSharpeRatio` 等 = 各段 Sharpe/Sortino/Calmar 的算术均值（null 段跳过）。
 *   全部仅为描述性对比，**不下「过拟合/未过拟合」结论**（C-20 职责）。
 */
export interface OosSegmentAggregate {
  /** 有完整评估的段数。 */
  readonly assessedSegmentCount: number;
  /** 未完整评估的段数（skipped）。 */
  readonly unassessedSegmentCount: number;
  /** 分段累计总收益（%，各 assessed 段 totalReturnPct 连乘 − 1；无段 → null）。 */
  readonly cumulatedTotalReturnPct: number | null;
  readonly meanTotalReturnPct: number | null;
  readonly medianTotalReturnPct: number | null;
  /** 分段 CAGR（%）均值 / 中位数（描述性）。 */
  readonly meanCagrPct: number | null;
  readonly medianCagrPct: number | null;
  /** 分段最大回撤（%）均值 / 最大值。 */
  readonly meanMaxDrawdownPct: number | null;
  readonly maxMaxDrawdownPct: number | null;
  /** 分段 Sharpe / Sortino / Calmar 均值（null 段跳过；全 null → null）。 */
  readonly meanSharpeRatio: number | null;
  readonly medianSharpeRatio: number | null;
  readonly meanSortinoRatio: number | null;
  readonly meanCalmarRatio: number | null;
}

/**
 * OOS 结果聚合报告（描述性；供 C-20 消费，不下过拟合结论）。
 *
 * 结构：
 *   - 计数与跳过明细（可评估 / 跳过 + reasonCode）；
 *   - `walkForwardAggregate`：**完整复用 C-19.1 `computeWalkForwardAggregate`**（import 只读），
 *     内含 `oosDegradationPp`（口径与 C-19.1 一致 = meanTest − meanTrain）与
 *     `cumulatedTestReturnPct`（分段累计）；
 *   - `segments` / `oosSegmentAggregate`：基于 C-16.1/C-16.2 计算器的段级完整指标聚合。
 */
export interface OosAggregationReport {
  /** 计划窗口数（= records.length）。 */
  readonly windowCount: number;
  /** 有 OOS 绩效（test.status === succeeded）的窗口数。 */
  readonly evaluatedWindowCount: number;
  /** 被跳过的窗口数。 */
  readonly skippedWindowCount: number;
  /** 跳过明细（windowId + reasonCode）。 */
  readonly skipped: readonly { readonly windowId: string; readonly reasonCode: OosSkipReasonCode }[];
  /** C-19.1 最小 OOS 聚合（完整复用，含 oosDegradationPp / cumulatedTestReturnPct）。 */
  readonly walkForwardAggregate: WalkForwardAggregate;
  /** IS→OOS 均值退化（百分点，= walkForwardAggregate.oosDegradationPp；口径与 C-19.1 一致）。 */
  readonly oosDegradationPp: number | null;
  /** 是否存在任何有完整 OOS 曲线评估的段。 */
  readonly oosEquityCurveAssessed: boolean;
  /** 逐段评估结果（windowIndex 升序）。 */
  readonly segments: readonly OosSegmentMetrics[];
  /** 分段完整指标聚合。 */
  readonly oosSegmentAggregate: OosSegmentAggregate;
  /** 内容指纹（sha256，十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 隔离纪律审计
// ---------------------------------------------------------------------------

/**
 * 隔离纪律机器检查结果（对整条记录集合）。
 *
 * 检查项（任一失败 → violations 非空、passed = false）：
 *   - records 非空；
 *   - 每个 windowId 唯一、windowIndex 唯一且非负；
 *   - 每窗 Test 严格晚于 Train、Train/Test 日期集合无重叠；
 *   - 每窗 paramsFrozenFromTrain（OOS 参数 === 冻结参数，未改写）；
 *   - 每窗 testResultWritesBackParams === false（结构分离，键白名单锁定）。
 */
export interface OosIsolationAudit {
  readonly windowCount: number;
  readonly allWindowIdsUnique: boolean;
  readonly allWindowIndexesUnique: boolean;
  readonly allTestStrictlyAfterTrain: boolean;
  readonly allTrainTestNonOverlapping: boolean;
  readonly allParamsFrozenFromTrain: boolean;
  readonly noTestResultWritesBackParams: boolean;
  readonly violations: readonly string[];
  readonly passed: boolean;
}

// ---------------------------------------------------------------------------
// OosIsolationRun（一次 IS/OOS 隔离记录与归档的完整结果）
// ---------------------------------------------------------------------------

/**
 * 一次 IS/OOS 隔离记录与归档的完整结果（不可变、可 JSON 序列化、带指纹）。
 *
 * 与 WalkForwardRun 的关系：**不内嵌完整 WalkForwardRun**（重复存储），而是通过
 * `sourceWalkForwardRunId` + `sourceWalkForwardRunFingerprint` 绑定来源（防脱钩/可追溯）。
 * 逐窗隔离记录内嵌在 `windows`；`discipline` 为机器检查结果；`report` 为聚合报告。
 *
 * **无 promotion**：本记录不含候选策略 / 生命周期状态 / Final|Production 标记，也不下
 * 「过拟合/未过拟合」结论——止于「每窗 IS/OOS 隔离结果 + 描述性聚合」这一事实。
 */
export interface OosIsolationRun {
  readonly recordKind: typeof OOS_ISOLATION_RUN_RECORD_KIND;
  readonly recordVersion: typeof OOS_ISOLATION_RUN_RECORD_VERSION;
  readonly runId: string;
  /** 来源 WalkForwardRun.runId（溯源）。 */
  readonly sourceWalkForwardRunId: string;
  /** 来源 WalkForwardRun.fingerprint（防脱钩：绑定到具体的 WFO 运行内容）。 */
  readonly sourceWalkForwardRunFingerprint: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 交易日历内容指纹（= WalkForwardRun.tradeDatesFingerprint，绑定输入快照）。 */
  readonly tradeDatesFingerprint: string;
  /** 窗口数（= windows.length）。 */
  readonly windowCount: number;
  /** 逐窗 IS/OOS 隔离记录（windowIndex 升序）。 */
  readonly windows: readonly WindowResultRecord[];
  /** 隔离纪律机器检查结果。 */
  readonly discipline: OosIsolationAudit;
  /** OOS 结果聚合报告。 */
  readonly report: OosAggregationReport;
  /** 运行记录创建时间（ISO-8601 UTC；由调用方/入口注入）。 */
  readonly createdAt: string;
  /** 内容指纹（sha256，十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

/**
 * 一次 IS/OOS 隔离记录与归档请求。
 *
 * 输入只读引用 C-19.1 的 `WalkForwardRun`（不修改）；OOS 权益曲线为可选补充（缺窗 → 该窗
 * 完整指标 unassessed，仅保留标量绩效）。
 */
export interface OosIsolationRequest {
  /** 来源 WalkForwardRun（只读引用，不修改）。 */
  readonly walkForwardRun: WalkForwardRun;
  /** 每窗 OOS 权益曲线（可选；key = windowId）。缺窗 → 该窗完整指标 unassessed。 */
  readonly oosEquityCurves?: ReadonlyMap<string, readonly EquityPoint[]>;
  /** runId（缺省自动生成 OOSISO-YYYYMMDD-XXXXXXXX；注入则确定性）。 */
  readonly runId?: string;
  /** 创建时间（ISO-8601 UTC；缺省当前时间；元数据非复现输入）。 */
  readonly createdAt?: string;
}
