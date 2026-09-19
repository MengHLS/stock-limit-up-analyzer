/**
 * STEP 8 — Backtest Engine 2.0 统一出口。
 *
 * 分层导出：领域模型 / 数据接口 / 规则 / 成本 / 执行 / 持仓 / 组合 / 指标 / 审计 / 序列化 /
 * 结果 / 引擎编排。不触碰生产 `server/engine`（Step 2 Core）与 `server/research`（STEP 6）。
 */

export * from "./types";
export * from "./dataSource";
export * from "./dbBarStore";
export * from "./marketRules";
export * from "./cost";
export * from "./execution";
export * from "./position";
export * from "./portfolio";
export * from "./metrics";
export * from "./audit";
export * from "./serialization";
export * from "./result";
export * from "./engine";

// BACKTEST-001 — Backtest Core 补全面（Context / 执行政策 / OrderIntent / 统一结果）。
// ⚠️ 不 `export *`：`backtestResult.ts` 的 `BacktestRunResult` 与 `types.ts` 的
// `BacktestResult` 同域不同形，显式点名导出避免歧义（见 backtestResult.ts 文件头登记）。
export * from "./context";
export {
  // B-04：年化口径（唯一常量 + 可序列化描述）。
  BACKTEST_ANNUALIZATION_BASIS,
  BACKTEST_ANNUALIZATION_DAYS,
  CANONICAL_METRIC_KEYS,
  DEFAULT_BACKTEST_SAMPLE_LIMIT,
  NOT_AVAILABLE,
  analyzeEquityCurve,
  buildBacktestResult,
  buildBacktestRunPayload,
  canonicalMetrics,
  computeTradeMetrics,
  diffCanonicalMetrics,
} from "./backtestResult";
export type {
  AnnualizationBasis,
  BacktestMetrics,
  BacktestRunPayload,
  BacktestRunResult,
  CanonicalMetricKey,
  CanonicalMetrics,
  CanonicalMetricsDetail,
  EquityCurveAnalysis,
  Unavailable,
} from "./backtestResult";
