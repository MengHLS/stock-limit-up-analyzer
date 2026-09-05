/**
 * STEP 6.2 — Research → Production Backtest Core Adapter。
 *
 * 把冻结的 Experiment Snapshot 映射到 Production Strategy Engine 的输入，并复用
 * runStrategyEngineBacktest（Feature → Strategy → PositionSizer → Risk → Core 黄金管线）。
 *
 * 铁律：
 *   - Runner 是 orchestration，绝不复制 Backtest Core / 策略 / 成交 / 持仓逻辑；
 *   - 映射是确定性的纯函数，无 Date.now / Math.random / 隐式可变默认值；
 *   - 缺失必需字段（非法 executionModel / 未知策略版本由上层 registry 拦截）→ throw，不静默降级；
 *   - 快照未覆盖的口径用「固定代码常量」补齐，并在 Run 的 config 摘要中回显（可复现，不随运行时漂移）。
 */

import type { BacktestResult, CostModel } from "../engine/domain";
import { DEFAULT_PRODUCTION_FEATURES, runStrategyEngineBacktest, type StrategyEngineBacktestOptions } from "../strategy/strategyBacktest";
import type { LeaderCandidateSourceRecord } from "../leaderCandidates";
import type { RawDailyPriceRow } from "../data";
import type { ResearchStrategyDefinition } from "./strategyContract";
import type { ResearchBacktestConfig, ResearchDatasetSpec, ResearchExperimentSnapshot } from "./types";
import type { ResearchRunResultSummary } from "./run";

// 快照未覆盖的固定口径（代码常量，可复现；非「可漂移的当前默认配置」）。
const RESEARCH_MAX_POSITIONS = 5;
const RESEARCH_MAX_POSITION_AMOUNT_RATIO = 0;
const RESEARCH_REQUESTED_QUANTITY = 100;

/**
 * 快照回测配置 → 引擎 CostModel。
 *
 * STEP 6.2-FIX-1：Research Run 运行时只消费 Snapshot 已冻结的 `backtestConfig.costModel`
 * （在 Experiment 创建阶段由 createExperiment 解析并深拷贝），禁止重新读取当前
 * DEFAULT_COST_MODEL——否则未来默认成本模型漂移会导致历史实验重跑结果不一致。
 * 缺失冻结 costModel（旧快照 / 损坏快照）时响亮抛错，绝不静默回退默认值。
 */
function buildCostModel(config: ResearchBacktestConfig): CostModel {
  if (config.costModel === undefined) {
    throw new Error("快照缺少冻结的成本模型 costModel（旧快照不支持运行，请重新创建实验）");
  }
  return structuredClone(config.costModel);
}

/** 校验 executionModel：当前生产仅支持 next-open；其它一律 throw（不静默降级）。 */
function assertSupportedExecutionModel(config: ResearchBacktestConfig): void {
  if (config.executionModel !== undefined && config.executionModel !== "next-open") {
    throw new Error(`不支持的执行模型：${String(config.executionModel)}（当前仅支持 next-open）`);
  }
}

/** 快照 + 策略定义 → 引擎选项（确定性映射）。 */
export function researchSnapshotToEngineOptions(
  snapshot: ResearchExperimentSnapshot,
  definition: ResearchStrategyDefinition,
): StrategyEngineBacktestOptions {
  assertSupportedExecutionModel(snapshot.backtestConfig);
  return {
    strategyId: snapshot.strategyId,
    // 研究参数集（已应用 schema 默认值）即生产策略的 raw config；ResearchParameterValue ⊆ unknown，无需类型逃逸。
    strategyConfig: snapshot.parameterSet,
    decisionPoint: definition.decisionPoint,
    features: [...DEFAULT_PRODUCTION_FEATURES],
    requestedQuantity: RESEARCH_REQUESTED_QUANTITY,
    initialCapital: snapshot.backtestConfig.initialCapital,
    maxPositions: snapshot.backtestConfig.maxPositions ?? RESEARCH_MAX_POSITIONS,
    maxPositionAmountRatio: RESEARCH_MAX_POSITION_AMOUNT_RATIO,
    startDate: snapshot.dataset.startDate,
    endDate: snapshot.dataset.endDate,
    cost: buildCostModel(snapshot.backtestConfig),
  };
}

/** 数据加载产物（Runner 依赖注入；生产接 DB，测试注入 fixture）。 */
export interface ResearchBacktestData {
  records: readonly LeaderCandidateSourceRecord[];
  rawRows: ReadonlyArray<RawDailyPriceRow>;
  tradingDates?: readonly string[];
}

/** 数据加载器签名。 */
export type ResearchDataLoader = (dataset: ResearchDatasetSpec) => Promise<ResearchBacktestData>;

/** 执行真实 Production Backtest Core，返回 BacktestResult。 */
export function runResearchBacktest(
  snapshot: ResearchExperimentSnapshot,
  definition: ResearchStrategyDefinition,
  data: ResearchBacktestData,
): BacktestResult {
  const options = researchSnapshotToEngineOptions(snapshot, definition);
  const probe = runStrategyEngineBacktest({
    records: [...data.records],
    rawRows: [...data.rawRows],
    options: { ...options, tradingDates: data.tradingDates },
  });
  return probe.result;
}

/** 从 BacktestResult 提取结构化摘要（复用既有 metadata/config/performance，不重实现统计）。 */
export function summarizeBacktestResult(result: BacktestResult): ResearchRunResultSummary {
  return {
    metadata: structuredClone(result.metadata),
    config: structuredClone(result.config),
    performance: structuredClone(result.performance),
    finalEquity: result.finalPortfolio.equity,
  };
}
