/**
 * PATTERN-LIBRARY-001 — 交易模式声明库（对外入口）。
 *
 * 一句话用法：**新增一种交易模式 = 在 `patterns/` 下加一个声明文件 + 在 `patterns/index.ts` 加一行**
 * ⇒ 研究侧模块注册表与执行侧配方注册表同时多出这一种模式，无需改任何路由 / 页面 / 注册表代码。
 *
 * 派生面（全部由 `patterns/*.ts` 的声明投影而来）：
 *   | 产物 | 投影函数 | 消费方 |
 *   |---|---|---|
 *   | 研究模块规格 | `projectResearchModule` | `createDefaultResearchModuleRegistry()` |
 *   | 执行配方定义 | `projectRecipeDefinition` | `recipeRegistry` 的全局注册表 |
 *   | 候选草图（含 `recipe` 引用与参数空间） | `projectCandidateSketch` | 转正入口（`buildStrategyDefinition`） |
 *   | 可搜索参数空间 | `projectParameterSpace` | 闭环 optimization 阶段 |
 */

export type {
  PatternConditionRecipeRef,
  PatternExecutionProjection,
  PatternFeatureKey,
  PatternGate,
  PatternGateBound,
  PatternGuardFloor,
  PatternParameterDeclaration,
  PatternParameterKey,
  PatternResearchProjection,
  PatternSketchProjection,
  TradingPatternSpec,
} from "./types";

export { ALL_TRADING_PATTERNS } from "./patterns";
export {
  FIRST_LIMIT_PULLBACK_HOLD_SHRINK,
  FIRST_LIMIT_PULLBACK_HOLD_SHRINK_NOTES,
} from "./patterns";

export {
  buildPatternModuleSpecs,
  declaredParameterKeys,
  projectCandidateSketch,
  projectParameterDefinitions,
  projectParameterSpace,
  projectRecipeReference,
  projectResearchModule,
  projectSketchParameterSpace,
  type PatternCandidateSketch,
} from "./project";

export { buildPatternRecipeDefinitions, projectRecipeDefinition } from "./projectRecipe";

import { ALL_TRADING_PATTERNS } from "./patterns";
import type { TradingPatternSpec } from "./types";

/** 全部已声明的模式（顺序 = 声明顺序）。 */
export function listTradingPatterns(): readonly TradingPatternSpec[] {
  return ALL_TRADING_PATTERNS;
}

/** 按模式 id 查（不存在 ⇒ `undefined`）。 */
export function findTradingPattern(patternId: string): TradingPatternSpec | undefined {
  return ALL_TRADING_PATTERNS.find(pattern => pattern.patternId === patternId);
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
        + `${ALL_TRADING_PATTERNS.map(item => item.patternId).join(" / ")}）。`,
    );
  }
  return pattern;
}

/** 按研究模块键反查模式（用于「这条分析属于哪个模式」）。 */
export function findPatternByResearchModuleKey(moduleKey: string): TradingPatternSpec | undefined {
  return ALL_TRADING_PATTERNS.find(pattern => pattern.research?.moduleKey === moduleKey);
}

/** 按执行配方 id 反查模式（用于「这次回测跑的是哪个模式」）。 */
export function findPatternByRecipeId(recipeId: string): TradingPatternSpec | undefined {
  return ALL_TRADING_PATTERNS.find(pattern => pattern.execution?.recipeId === recipeId);
}

/**
 * 可转正的模式清单（`execution` 与 `sketch` 都齐）。
 *
 * ⚠️ 判据与 `projectCandidateSketch` 返回 `null` 的两个条件**同源** ——
 * 「能转正」不是这里另定的规则，而是「投影能产出草图」的事实。
 */
export function listPromotablePatternIds(): readonly string[] {
  return ALL_TRADING_PATTERNS
    .filter(pattern => pattern.execution !== null && pattern.sketch !== undefined && pattern.sketch !== null)
    .map(pattern => pattern.patternId);
}
