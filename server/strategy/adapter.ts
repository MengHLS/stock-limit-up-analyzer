/**
 * Strategy Adapter —— Legacy 数据视图构建 + StrategyDecision → Backtest Core Signal 桥接。
 *
 * 职责：
 *  1. 把 Legacy 候选结果（leaderCandidates.buildLeaderCandidatesForDate 的产出）适配为
 *     策略可消费的受控数据视图 LeaderCandidateDataView（Data Provider 角色）。
 *  2. 把策略决策 StrategyDecision 桥接为 Backtest Core 的 Signal（意图 → 订单意图）。
 *
 * 说明：本文件是「边界适配层」，负责打通新旧两套模型；它允许依赖 domain 类型与
 * legacy 只读数据源，但策略本体（strategies/ 下）不得反向依赖本文件。
 */

import type { ReadonlyPortfolioSnapshot, Signal } from "../engine/domain";
import { buildLeaderCandidatesForDate, type LeaderCandidate, type LeaderCandidateResult } from "../leaderCandidates";
import type { StrategyFeatureInput } from "./contract";
import type { StrategyConfig, StrategyDecision } from "./contract";
import { strategyRegistry } from "./registry";
import type { LeaderCandidateDataView, LeaderCandidateScore } from "./strategies/leaderCandidateBaseline";

/** 把 legacy 候选结果映射为策略数据视图（评分字段只读透传，不重复计算）。 */
export function buildLeaderCandidateDataView(result: LeaderCandidateResult): LeaderCandidateDataView {
  return {
    signalDate: result.date ?? "",
    candidates: result.candidates.map(toScore),
  };
}

function toScore(candidate: LeaderCandidate): LeaderCandidateScore {
  return {
    stockCode: candidate.stockCode,
    stockName: candidate.stockName,
    sector: candidate.sector,
    boards: candidate.boards,
    sectorCount: candidate.sectorCount,
    score: candidate.score,
    riskScore: candidate.riskScore,
    riskTier: candidate.riskTier,
    limitUpTime: candidate.limitUpTime,
  };
}

/**
 * 便捷入口：给定原始涨停记录与信号日，构建该日策略数据视图（严格 point-in-time）。
 *
 * 默认 candidateLimit: null（不限），与 legacy 回测口径（buildLeaderCandidateBacktest 内部
 * 硬编码 candidateLimit: null）对齐——准入候选超过默认展示上限 20 只时，策略仍能看到全部
 * 准入候选，避免「策略数据视图」与「回测口径」在候选池上的语义降级。
 * 调用方仍可通过 options 显式传入 candidateLimit 覆盖（展开顺序保证 options 优先生效）。
 */
export function buildLeaderCandidateDataViewForDate(
  records: Parameters<typeof buildLeaderCandidatesForDate>[0],
  signalDate: string,
  options: Parameters<typeof buildLeaderCandidatesForDate>[2] = {},
): LeaderCandidateDataView {
  return buildLeaderCandidateDataView(
    buildLeaderCandidatesForDate(records, signalDate, { candidateLimit: null, ...options }),
  );
}

/** 策略决策 → Backtest Core Signal 的桥接选项。 */
export interface ToCoreSignalsOptions {
  /**
   * 每个 BUY/SELL 意图映射到 Core Signal 的名义请求数量（股）。
   * 策略只表达「意图」，不决定精确数量；最终数量由 Portfolio 的容量/资金/整手约束裁定。
   * 缺省 100（1 手）。HOLD 不产生 Core Signal。
   */
  requestedQuantity?: number;
}

/**
 * 把策略决策桥接为 Backtest Core 的 Signal（意图 → 订单意图）。
 * 策略信号 ≠ Order ≠ Fill：这里仅声明方向与名义数量，成交价/费用/滑点由 Core 决定。
 */
export function toCoreSignals(decision: StrategyDecision, options: ToCoreSignalsOptions = {}): Signal[] {
  const quantity = options.requestedQuantity ?? 100;
  const signals: Signal[] = [];
  for (const signal of decision.signals) {
    if (signal.action === "HOLD") continue;
    signals.push({
      symbol: signal.symbol,
      signalTime: signal.signalTime,
      side: signal.action === "SELL" ? "sell" : "buy",
      quantity,
      score: signal.score,
      reason: signal.reason ?? null,
    });
  }
  return signals;
}

/**
 * 固化「Strategy → StrategyDecision → toCoreSignals → Signal」桥接，返回可直接作为
 * runBacktest.signalProvider 的函数。内部走 registry.evaluate（规范化配置 + 纯函数评估）。
 * buildDataView 由调用方注入（Data Provider 角色，严格 point-in-time）。
 *
 * Step 5 扩展：options.buildFeatures(date) 可注入与 signalTime 同 asOf 的 FeatureSnapshot，
 * 使其经由 strategy context.features 到达策略（不提供时行为与旧版完全一致）。
 */
export function buildStrategySignalProvider(
  strategyId: string,
  buildDataView: (date: string) => unknown,
  options: {
    config?: StrategyConfig;
    requestedQuantity?: number;
    buildFeatures?: (date: string) => StrategyFeatureInput | undefined;
  } = {},
): (date: string, portfolio: ReadonlyPortfolioSnapshot) => Signal[] {
  return (date, portfolio) => {
    const features = options.buildFeatures ? options.buildFeatures(date) : undefined;
    const decision = strategyRegistry.evaluate(strategyId, date, buildDataView(date), portfolio, options.config, features);
    return toCoreSignals(decision, { requestedQuantity: options.requestedQuantity });
  };
}
