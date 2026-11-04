/**
 * 运行工作台装配层 — finalize 阶段生命周期配置组装。
 *
 * 为什么单独成文件：`researchRunRouter` 原本内联了同样的组装（`input.lifecycle` → 
 * `ClosedLoopLifecycleConfig`），而运行工作台的装配层也走同一条路 —— 两处各写一遍
 * 必然漂移（漏传 `allowSyntheticEvidence` 之类）。此处收敛为唯一实现。
 *
 * 纪律：**纯透传，不做任何派生**。`lifecycleRecord` / `transition` 的四个要素（证据 /
 * experiment / dataset 等）全部由调用方显式声明；本层不补、不猜、不给缺省。
 */

import type { ClosedLoopLifecycleConfig } from "../research/closedLoop/types";
import type {
  LifecycleTransitionInput,
  StrategyLifecycleRecord,
} from "../research/lifecycle/types";

/** finalize 配置的调用方输入（传输层形态；已在 schema 校验，此处只做断言式收窄）。 */
export interface LifecycleConfigInput {
  readonly lifecycleRecord: StrategyLifecycleRecord;
  readonly transition: LifecycleTransitionInput;
  readonly allowSyntheticEvidence?: boolean;
}

/** 组装 `ClosedLoopLifecycleConfig`（纯透传）。 */
export function buildLifecycleConfig(input: LifecycleConfigInput): ClosedLoopLifecycleConfig {
  return {
    lifecycleRecord: input.lifecycleRecord,
    transition: input.transition,
    ...(input.allowSyntheticEvidence !== undefined
      ? { allowSyntheticEvidence: input.allowSyntheticEvidence }
      : {}),
  };
}
