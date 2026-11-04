/**
 * STEP 8 — Backtest Result + Run Identity。
 *
 * runId 缺省由可序列化规范（strategy/version/dataset/cost/execution/universe/rules/seed）
 * 确定性派生，保证「同一规范 → 同一 runId → 同一结果」（幂等、可复现）；需要区分多次运行
 * 时由调用方显式传入 runId。生成过程不使用真实时钟/随机数。
 */

import type { BacktestSpec } from "./types";
import { canonicalJson, sha256Hex } from "./serialization";

/** 提取规范中可序列化字段（剔除函数，供确定性指纹）。 */
function serializableSpec(spec: BacktestSpec): Record<string, unknown> {
  const executionModel = typeof spec.executionModel === "string" ? spec.executionModel : spec.executionModel.id;
  return {
    strategyId: spec.strategyId,
    strategyVersion: spec.strategyVersion,
    datasetVersion: spec.datasetVersion,
    startDate: spec.startDate,
    endDate: spec.endDate,
    initialCapital: spec.initialCapital,
    cost: spec.cost,
    executionModel,
    universe: spec.universe,
    maxPositions: spec.maxPositions ?? 5,
    maxPositionAmountRatio: spec.maxPositionAmountRatio ?? 0,
    allowPartialFill: spec.allowPartialFill ?? false,
    seed: spec.seed ?? 0,
    rules: {
      tPlus1: spec.marketRules?.tPlus1 ?? true,
      blockLimitUpBuy: spec.executionRules?.blockLimitUpBuy ?? false,
      blockLimitDownSell: spec.executionRules?.blockLimitDownSell ?? false,
    },
  };
}

/** 规范指纹（SHA-256，键排序）。 */
export function specFingerprint(spec: BacktestSpec): string {
  return sha256Hex(canonicalJson(serializableSpec(spec)));
}

/** 派生 runId：显式传入优先，否则确定性派生。 */
export function deriveRunId(spec: BacktestSpec): string {
  if (spec.runId) return spec.runId;
  return `RUN-${specFingerprint(spec).slice(0, 16)}`;
}
