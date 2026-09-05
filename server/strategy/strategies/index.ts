/**
 * 内置策略清单与注册辅助。
 *
 * 生产启动时调用 registerBuiltInStrategies(strategyRegistry) 即可把内置策略注册进统一
 * Registry；后续 Backtest Core 通过 Registry.get(id) 找到策略，不经过旧入口。
 */

import type { StrategyRegistry } from "../registry";
import { leaderCandidateBaselineStrategy } from "./leaderCandidateBaseline";

/** 全部内置策略（新增策略在此登记）。 */
export const builtInStrategies = [leaderCandidateBaselineStrategy] as const;

/** 幂等注册：把内置策略注册进指定 Registry（已存在则跳过）。 */
export function registerBuiltInStrategies(registry: StrategyRegistry): void {
  for (const strategy of builtInStrategies) {
    if (!registry.has(strategy.metadata.id)) {
      registry.register(strategy);
    }
  }
}

export { leaderCandidateBaselineStrategy };
