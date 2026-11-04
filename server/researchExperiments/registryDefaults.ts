/**
 * RESEARCH-EXPERIMENT-001/002 — 实验注册表的**轻量默认实例**。
 *
 * ## 为什么与 `defaults.ts` 分开
 *
 * `defaults.ts` 是「真实装配」：它 import `DbDatasetRegistry` / `RegistryResearchDatasetReader`
 * （即 DB 与 `researchEngine`）。而有一类消费者**只想知道「某个实验 id 是否还存在」**，
 * 例如 Strategy 溯源视图对独立实验来源做「上游存活探测」
 * （`server/research/strategyCandidate/service.ts`）。
 *
 * 若那类消费者直接 import `defaults.ts`，就会把 DB 与 `researchEngine` 一并拉进自己的
 * 运行时模块图 —— 而本任务（RESEARCH-EXPERIMENT-002）刚刚把「生产链不传递依赖旧 Research」
 * 做成可断言的图可达性判据，**不能一边解耦一边在别处接回来**。
 *
 * 因此本模块只依赖：注册表 + 清单（两者都是纯声明，无 DB / 无 researchEngine）。
 */

import { EXPERIMENT_DEFINITIONS } from "../../research-experiments/manifest";
import { ExperimentRegistry } from "./registry";

/** 用真实清单构造注册表（每次调用都是新实例；测试用得上）。 */
export function createDefaultExperimentRegistry(): ExperimentRegistry {
  const registry = new ExperimentRegistry();
  for (const definition of EXPERIMENT_DEFINITIONS) registry.register(definition);
  return registry;
}

let registryCache: ExperimentRegistry | null = null;

/**
 * 默认注册表（惰性单例）。
 *
 * 🔴 惰性而不是顶层常量：本仓踩过「顶层常量 + 互相 import ⇒ 运行时 `TypeError` 而
 * `tsc --noEmit` 为 0」的坑（见 `.workbuddy/memory/PROJECT_RULES.md`）。
 */
export function defaultExperimentRegistry(): ExperimentRegistry {
  registryCache ??= createDefaultExperimentRegistry();
  return registryCache;
}
