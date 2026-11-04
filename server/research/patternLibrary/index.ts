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

/**
 * 纯查询（零跨域依赖）—— 从 `./catalog` 再导出，**对外导出面不变**。
 *
 * 🔴 RESEARCH-EXPERIMENT-002：需要「只查一个模式」的调用方**请直接 import `./catalog`**，
 * 不要 import 本 barrel —— 本 barrel 会连带求值 `./project`，而它运行时 import
 * `researchEngine/planner/moduleRegistry`（会把生产链与旧 Research 目录挂在一起）。
 * `server/research/patternLibrary/strategyConsumption.ts` 就是这条边的原发生点。
 */
export {
  findPatternByRecipeId,
  findPatternByResearchModuleKey,
  findTradingPattern,
  listPromotablePatternIds,
  listTradingPatterns,
  requireTradingPattern,
} from "./catalog";
