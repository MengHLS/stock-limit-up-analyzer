/**
 * STEP 6.1 — Research Adapter（生产策略 → 研究策略定义）。
 *
 * 这里把既有生产策略「leader-candidate-baseline」适配为研究层自描述定义：
 *
 *   Existing Production Strategy ──▶ Research Adapter ──▶ ResearchStrategyDefinition
 *
 * 关键：研究定义只是对生产策略的「元数据 + 参数空间」描述，不含评分 / 信号 / 成交逻辑。
 * Research 层不得绕过 Production Strategy Contract 直接制造交易订单。
 *
 * 策略身份 / 名称 / 描述 / requiredData 一律复用生产策略 metadata（单一事实来源），
 * 不在此处硬编码重复定义。
 */

import { leaderCandidateBaselineStrategy } from "../strategy/strategies/leaderCandidateBaseline";
import type { ResearchStrategyRegistry } from "./registry";
import type { ResearchStrategyDefinition } from "./strategyContract";

/** 构建 leader-candidate-baseline 的研究策略定义（元数据 + 参数 schema）。 */
export function buildLeaderCandidateBaselineResearchDefinition(): ResearchStrategyDefinition {
  const { metadata } = leaderCandidateBaselineStrategy;
  return {
    strategyId: metadata.id,
    version: metadata.version,
    name: metadata.name,
    description: metadata.description,
    // 策略仅在 featureMode="limit-up-confirm" 时消费特征；此处声明其特征依赖。
    requiredFeatures: ["limitUpHit"],
    requiredData: [...metadata.requiredData],
    decisionPoint: "close",
    parameterSchema: {
      parameters: [
        {
          name: "minScore",
          type: "number",
          required: false,
          nullable: true,
          defaultValue: null,
          description: "最低候选评分阈值；null 表示不过滤",
        },
        {
          name: "maxSignals",
          type: "number",
          required: false,
          defaultValue: 5,
          min: 0,
          step: 1,
          description: "策略每信号日最多输出的买入意图数量",
        },
        {
          name: "featureMode",
          type: "string",
          required: false,
          defaultValue: "off",
          allowedValues: ["off", "limit-up-confirm"],
          description: "特征消费模式：off 不读取特征；limit-up-confirm 要求候选被价格库快照确认信号日收盘涨停",
        },
      ],
    },
    metadata: {
      author: "stock-limit-up-analyzer",
      tags: ["打板", "龙头候选", "baseline", "long-only"],
    },
  };
}

/** 幂等注册内置研究策略（已存在同 strategyId+version 则跳过）。 */
export function registerBuiltInResearchStrategies(registry: ResearchStrategyRegistry): void {
  const definition = buildLeaderCandidateBaselineResearchDefinition();
  if (!registry.has(definition.strategyId, definition.version)) {
    registry.register(definition);
  }
}
