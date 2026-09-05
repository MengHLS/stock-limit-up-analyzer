/**
 * Strategy Registry —— 统一策略注册中心。
 *
 * 提供 register / get / has / list / evaluate。
 * 约束：
 *  - strategy id 唯一，重复注册抛错
 *  - 未知 id 查询抛错
 *  - 不依赖数据库、网络、UI、execution、portfolio 可变 API
 *  - 可独立单元测试
 *  - 不产生循环依赖（仅依赖 contract.ts）
 */

import type { StrategyFeatureInput } from "./contract";
import type { AnyStrategy, ReadonlyPortfolioContext, StrategyConfig, StrategyDecision, StrategyMetadata } from "./contract";

export class StrategyRegistry {
  private readonly strategies = new Map<string, AnyStrategy>();

  /** 注册策略。id 已存在时抛错。 */
  register(strategy: AnyStrategy): void {
    const { id } = strategy.metadata;
    if (this.strategies.has(id)) {
      throw new Error(`策略已注册，拒绝重复注册：${id}`);
    }
    this.strategies.set(id, strategy);
  }

  /** 是否已注册指定 id。 */
  has(id: string): boolean {
    return this.strategies.has(id);
  }

  /** 按 id 取策略；未知 id 抛错。 */
  get(id: string): AnyStrategy {
    const strategy = this.strategies.get(id);
    if (!strategy) {
      throw new Error(`未注册的策略：${id}`);
    }
    return strategy;
  }

  /** 列出全部策略元数据（按 id 字典序稳定排序）。 */
  list(): StrategyMetadata[] {
    return Array.from(this.strategies.values())
      .map((strategy) => ({ ...strategy.metadata }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /**
   * 便捷评估：规范化配置后调用策略 evaluate。
   * data 为策略所需的受控数据视图（由调用方注入），配置缺省时使用策略默认配置。
   * features 为可选 Feature 输入（Step 5，单标快照或同 asOf 多标 bundle），与 signalTime 同 asOf，
   * 透传给策略 context。
   */
  evaluate(
    id: string,
    signalTime: string,
    data: unknown,
    portfolio: ReadonlyPortfolioContext,
    rawConfig?: StrategyConfig,
    features?: StrategyFeatureInput,
  ): StrategyDecision {
    const strategy = this.get(id);
    const config = strategy.normalizeConfig(rawConfig ?? {});
    return strategy.evaluate({ signalTime, data, portfolio, config, features });
  }
}

/** 全系统单例注册中心。 */
export const strategyRegistry = new StrategyRegistry();
