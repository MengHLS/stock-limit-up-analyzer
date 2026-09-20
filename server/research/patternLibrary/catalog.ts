/**
 * PATTERN-LIBRARY-001 — **模式目录查询**（纯数据查找，零跨域依赖）。
 *
 * ## 为什么单独一个文件（RESEARCH-EXPERIMENT-002 · P0 解耦）
 *
 * 这些函数原先定义在 `patternLibrary/index.ts` 里，而 `index.ts` **同时**
 * `export { … } from "./project"`。于是任何「只想要一个模式查询」的调用方，
 * 只要写成 `import { findPatternByRecipeId } from "./index"`，就会在**模块求值期**
 * 把 `project.ts` 一起拉进来 —— 而 `project.ts` 运行时 import
 * `researchEngine/planner/moduleRegistry`。
 *
 * 实测后果（002 的 import 图可达性探针）：
 *
 * ```text
 * runWorkbenchAssembly/assemble.ts
 *   -> research/patternLibrary/strategyConsumption
 *   -> research/patternLibrary/index      ← barrel
 *   -> research/patternLibrary/project
 *   -> researchEngine/planner/moduleRegistry   ← 旧 Research 目录
 * ```
 *
 * ⇒ **生产回测装配链在模块加载期就与旧 Research 目录挂在一起**，
 * 这条边是「按文件 grep 看不到」的典型传递依赖。
 *
 * 解法：把纯查询搬到本文件（只依赖 `./patterns` 与 `./types`），
 * `index.ts` 继续 `export … from "./catalog"`（**对外导出面逐字不变**），
 * 需要查询的调用方改为直接 import 本文件 ⇒ 边被切断，导出面为零破坏。
 */

import { ALL_TRADING_PATTERNS } from "./patterns";
import type { TradingPatternSpec } from "./types";

/** 全部已声明的模式（顺序 = 声明顺序）。 */
export function listTradingPatterns(): readonly TradingPatternSpec[] {
  return ALL_TRADING_PATTERNS;
}

/** 按模式 id 查（不存在 ⇒ `undefined`）。 */
export function findTradingPattern(patternId: string): TradingPatternSpec | undefined {
  return ALL_TRADING_PATTERNS.find((pattern) => pattern.patternId === patternId);
}

/**
 * 按模式 id 取，**不存在即抛错**（附上已声明清单）。
 *
 * 为什么要有 `require` 版本：调用方拿到 `undefined` 后最可能的动作是「当作没有这个模式，
 * 走一条看起来差不多的默认路径」—— 而「静默回落默认」正是本项目反复踩到的缺陷形态。
 */
export function requireTradingPattern(patternId: string): TradingPatternSpec {
  const pattern = findTradingPattern(patternId);
  if (pattern === undefined) {
    throw new Error(
      `未知交易模式：\`${patternId}\`（已声明：`
        + `${ALL_TRADING_PATTERNS.map((item) => item.patternId).join(" / ")}）。`,
    );
  }
  return pattern;
}

/** 按研究模块键反查模式（用于「这条分析属于哪个模式」）。 */
export function findPatternByResearchModuleKey(moduleKey: string): TradingPatternSpec | undefined {
  return ALL_TRADING_PATTERNS.find((pattern) => pattern.research?.moduleKey === moduleKey);
}

/** 按执行配方 id 反查模式（用于「这次回测跑的是哪个模式」）。 */
export function findPatternByRecipeId(recipeId: string): TradingPatternSpec | undefined {
  return ALL_TRADING_PATTERNS.find((pattern) => pattern.execution?.recipeId === recipeId);
}

/**
 * 可转正的模式清单（`execution` 与 `sketch` 都齐）。
 *
 * ⚠️ 判据与 `projectCandidateSketch` 返回 `null` 的两个条件**同源** ——
 * 「能转正」不是这里另定的规则，而是「投影能产出草图」的事实。
 */
export function listPromotablePatternIds(): readonly string[] {
  return ALL_TRADING_PATTERNS
    .filter((pattern) => pattern.execution !== null && pattern.sketch !== undefined && pattern.sketch !== null)
    .map((pattern) => pattern.patternId);
}
