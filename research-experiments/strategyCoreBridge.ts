/**
 * Strategy Core ↔ 独立研究实验体系 的**唯一引桥**（`maxAmp5` 权威口径）。
 *
 * ## 为什么需要这一层
 *
 * `FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001` 的 M 臂要用**既有 Strategy Core 定义**的
 * `maxAmp5`（后事件状态振幅，`rd11~15` 链式前收，决策时点下界 `rd15`）。
 *
 * 🔴 该口径的**唯一权威**是 `server/strategyCore/featureRegistry.ts#makeEventStateAmplitudeFeatures`。
 *    `research-experiments/**` 里**目前没有任何 bridge 能到达它**（实查：grep
 *    `strategyCore|featureRegistry|makeEventStateAmplitude|getDefaultFeatureRegistry`
 *    在 `research-experiments/**` 下 0 命中）。
 *    按规格 §S2「`maxAmp5` 调用既有权威特征 / 合法 bridge，**不逐字复制策略语义**」，
 *    这里建立唯一一条引桥。
 *
 * ## 它**不是**第二套实现（同 `robustnessBridge.ts` 的纪律）
 *
 * 本文件**零实现、零状态、零 IO** —— 只有 re-export。实验侧拿到的是 Core 的
 * `FeatureDefinition` 本身并调用它的 `compute()`，因此：
 * - 振幅公式、窗口 `{11,15}`、链式前收起点、完整性断言（恰 5 个值）、
 *   决策时点下界 —— **全部只有一份**，改动 Core 即自动同步；
 * - 桥里**不允许**出现任何计算。
 *
 * ## 浏览器安全的强制约束（不是口头约定）
 *
 * `page.tsx` 跑在浏览器里，**不得**引 `server/**` 运行时
 * （`tests/server/researchExperiments/manifest.test.ts` 有闸门钉住）。因此本文件分成两段：
 *
 *   1. `export type { … }` —— 纯类型，`import type` 时被 TS 完全擦除；
 *   2. `export { … }` —— 运行时值，**只允许** `experiment.ts`（服务端 Runner 内）使用。
 */

// ---------------------------------------------------------------------------
// 一、纯类型（`result.ts` / `page.tsx` 侧只允许用这一段）
// ---------------------------------------------------------------------------

export type {
  FeatureComputeContext,
  FeatureDefinition,
} from "../server/strategyCore/featureRegistry";
export type { EvaluationTime, RelativeDay } from "../server/strategyCore/types";
export type { BarUniverse, VisibleBar } from "../server/strategyCore/temporal";

// ---------------------------------------------------------------------------
// 二、运行时值（**只允许** `experiment.ts` 使用）
// ---------------------------------------------------------------------------

export {
  EVENT_STATE_AMPLITUDE_FEATURE_IDS,
  EVENT_STATE_AMPLITUDE_WINDOW,
  getDefaultFeatureRegistry,
} from "../server/strategyCore/featureRegistry";
/**
 * Core 的 PIT 唯一关卡与决策时点构造。
 *
 * 逐日池的因子计算**必须**经它们：先把「rd0..当日」的 bar 装进 `BarUniverse`，
 * 再用 `createDayScopedBarAccess(universe, 当日 rd).barsUpTo(当日 rd)` 取可见序列。
 * 这样「只读 ≤ 决策日」不是靠本实验的纪律，而是 Core 访问器的结构保证。
 */
export { createDayScopedBarAccess } from "../server/strategyCore/temporal";
export { makeEvaluationTime } from "../server/strategyCore/temporal";
