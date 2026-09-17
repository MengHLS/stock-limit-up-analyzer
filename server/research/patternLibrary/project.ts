/**
 * PATTERN-LIBRARY-001 — 把交易模式声明**投影成研究侧模块规格**与**候选草图**。
 *
 * 本文件是「声明（纯数据）→ 可执行/可落库实例」的**唯一实现**：
 *   - `projectResearchModule`   → `ResearchModuleSpec`（进研究方法注册表）
 *   - `projectCandidateSketch`  → 候选草图的 `entryRule` / `parameterSpace`（转正入口的输入）
 *   - `projectRecipeDefinition` → 在 `projectRecipe.ts`（执行侧）
 *
 * ## 依赖方向（为什么这里 import `moduleRegistry` 却不会炸）
 *
 * `moduleRegistry.ts` 在模块**末尾**调用本文件的 `buildPatternModuleSpecs()`，
 * 而本文件只在**函数体内**读 `moduleRegistry` 的构造器（`buildGuardRecipe` 等）。
 * 两个模块互相 import，但都只在「对方已求值完」之后才真正调用 —— 这是 ESM 下安全的形状。
 * 反例（会炸）是本文件在**顶层**调用 `buildGuardRecipe(...)`：那一刻
 * `moduleRegistry` 的 `const PULLBACK_GUARD_FLOOR_LABEL` 还在 TDZ 里。
 * ⇒ **纪律：本文件顶层只允许 import 与函数/常量定义，禁止调用外部模块的函数。**
 */

import type { ResearchParameterDefinition } from "../types";
import type { ParameterSpace, SweepParameterDefinition } from "../parameterSpace";
import type { StrategyRecipe } from "../strategySchema/types";
import type { FeatureVersionRef } from "../signalEngine/types";
import type {
  ResearchConditionRecipe,
  ResearchModuleSpec,
} from "../../researchEngine/planner/moduleRegistry";
import {
  buildAboveEventCloseRecipe,
  buildDepthBandRecipe,
  buildGuardControlRecipe,
  buildGuardRecipe,
  buildLastBullishRecipe,
  buildObsDayRecipe,
  buildShrinkVolumeRecipe,
  buildVolumeExpansionRecipe,
} from "../../researchEngine/planner/moduleRegistry";
import { projectRecipeDefinition } from "./projectRecipe";
import type {
  PatternConditionRecipeRef,
  PatternParameterKey,
  TradingPatternSpec,
} from "./types";
import {
  DEFAULT_ENTRY_EVENT_PARAMS,
  DEFAULT_EXECUTION_ASSUMPTIONS,
  DEFAULT_EXIT_RULE,
  DEFAULT_RISK_RULE,
} from "./executionAssumptions";
import { ALL_TRADING_PATTERNS } from "./patterns";

// ---------------------------------------------------------------------------
// 条件配方：声明形态 → 真实构造器
// ---------------------------------------------------------------------------

/**
 * 单条条件配方的投影。
 *
 * `switch` 是**穷尽**的（TS 的 discriminated union narrowing 会保证这一点）：新增一个
 * `kind` 而忘了在这里加分支，`tsc` 立刻报错 —— 这正是「声明与投影不许脱节」的执行机制。
 */
function projectConditionRecipe(ref: PatternConditionRecipeRef): ResearchConditionRecipe {
  switch (ref.kind) {
    case "guard":
      return buildGuardRecipe(ref.floor);
    case "guardControl":
      return buildGuardControlRecipe(ref.floor);
    case "shrinkVolume":
      return buildShrinkVolumeRecipe(ref.ratio, ref.tag);
    case "volumeExpansion":
      return buildVolumeExpansionRecipe();
    case "lastBullish":
      return buildLastBullishRecipe();
    case "aboveEventClose":
      return buildAboveEventCloseRecipe();
    case "depthBand":
      return buildDepthBandRecipe(ref.offset, ref.lower, ref.upper, ref.tag);
    case "obsDay":
      return buildObsDayRecipe(ref.id, ref.label, ref.purpose, ref.field, ref.operator, ref.value);
  }
}

// ---------------------------------------------------------------------------
// 研究侧投影
// ---------------------------------------------------------------------------

/**
 * 把一个模式声明投影成研究模块规格。
 *
 * `research === null` ⇒ 返回 `null`（纯执行模式，没有研究形态）。
 *
 * 🔴 展示元数据的**回落规则**：`moduleLabel` / `modulePurpose` / `moduleWhenToUse`
 * 缺省时回落模式级字段。纯研究模式下两者本就该相同（模式就是那个研究方法）；
 * 双栖模式下必须显式给出 —— 否则研究模块的名字会随策略口径漂移，
 * 而 `moduleRegistry.ts` 文件头纪律 2 明令禁止「把某条策略焊进方法名」。
 */
export function projectResearchModule(pattern: TradingPatternSpec): ResearchModuleSpec | null {
  const research = pattern.research;
  if (research === null) return null;
  return {
    key: research.moduleKey,
    label: research.moduleLabel ?? pattern.label,
    purpose: research.modulePurpose ?? pattern.purpose,
    whenToUse: research.moduleWhenToUse ?? pattern.whenToUse,
    researchType: research.researchType,
    requiredCapabilities: research.requiredCapabilities,
    keywords: research.keywords,
    primaryKeywords: research.primaryKeywords,
    primaryAnalysisType: research.primaryAnalysisType,
    recommendedAnalysisTypes: research.recommendedAnalysisTypes,
    targetKinds: research.targetKinds,
    preferredHorizons: research.preferredHorizons,
    entryEvaluations: research.entryEvaluations,
    guardRecipes: research.guardRecipes.map(projectConditionRecipe),
    refinementRecipes: research.refinementRecipes.map(projectConditionRecipe),
    controlRecipes: research.controlRecipes.map(projectConditionRecipe),
    quantileFeatures: research.quantileFeatures,
    groupingDimensions: research.groupingDimensions,
    stabilityDimension: research.stabilityDimension,
    conclusionTypes: research.conclusionTypes,
    minSampleCount: research.minSampleCount,
    primaryTargetKinds: research.primaryTargetKinds,
    defaultPriority: research.defaultPriority,
  };
}

/**
 * 全部「有研究形态」的模式 ⇒ 研究模块规格清单（顺序 = `ALL_TRADING_PATTERNS`）。
 *
 * 这是**函数**而不是顶层常量：`moduleRegistry.ts` 在模块末尾调用它，函数包装可避免
 * 「谁先求值」的顺序依赖。调用方请自行缓存（注册表本身就只构造一次）。
 */
export function buildPatternModuleSpecs(): readonly ResearchModuleSpec[] {
  const out: ResearchModuleSpec[] = [];
  for (const pattern of ALL_TRADING_PATTERNS) {
    const spec = projectResearchModule(pattern);
    if (spec !== null) out.push(spec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 参数：声明 → 文档 schema / 搜索空间 / 草图画布
// ---------------------------------------------------------------------------

/** 声明里的参数定义 → 策略文档 `parameters[]` 的那一项（逐字段透传，不补默认值）。 */
export function projectParameterDefinitions(
  pattern: TradingPatternSpec,
): readonly ResearchParameterDefinition[] {
  const execution = pattern.execution;
  if (execution === null) return [];
  return execution.parameters.map(item => item.declaration);
}

/**
 * 声明里的参数 → **候选草图 `parameterSpace`**（`definitionBuild.ts#buildParameters` 的输入形态）。
 *
 * 形态 = `Record<参数名, { type, min?, max?, step?, defaultValue?, parameterRole }>`。
 *
 * 🔴 `parameterRole` 的取值来自声明的 `role`，这是**「声明即生效」的闭环**：
 * 迁移前 `buildParameters` 把 `parameterRole` **恒置为 `TUNABLE`**
 * ⇒ 「固定参数只要带了 min/max/step 就会被搜索」，而结果看起来完全正常。
 * 现在 `role: "fixed"` 会投影成 `FIXED`，由 `buildParameters` 如实透传。
 */
export function projectSketchParameterSpace(
  pattern: TradingPatternSpec,
): Readonly<Record<string, Record<string, unknown>>> {
  const execution = pattern.execution;
  if (execution === null) return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const item of execution.parameters) {
    const declaration = item.declaration;
    const entry: Record<string, unknown> = {
      type: declaration.type,
      parameterRole: item.role === "tunable" ? "TUNABLE" : "FIXED",
    };
    if (declaration.min !== undefined) entry.min = declaration.min;
    if (declaration.max !== undefined) entry.max = declaration.max;
    if (declaration.step !== undefined) entry.step = declaration.step;
    if (declaration.defaultValue !== undefined) entry.defaultValue = declaration.defaultValue;
    if (declaration.allowedValues !== undefined) entry.allowedValues = [...declaration.allowedValues];
    if (declaration.description !== undefined) entry.description = declaration.description;
    out[item.name] = entry;
  }
  return out;
}

/**
 * 声明里的**可搜索**参数 → `ParameterSpace`（Sweep 的输入契约）。
 *
 * 判据与 `strategyEvaluation/parameterSpaceFromDocument.ts` **同源**：
 * 数值参数必须同时有 `min` / `max` / `step > 0` 才是可搜索的
 * （缺任一项就**不进搜索空间**，且不猜边界 —— 猜 `step = 1` 会把 `[0, 0.3]`
 * 变成 31 个臆测搜索点）。
 *
 * 与后者的分工：`parameterSpaceFromDocument` 从**已落库文档**派生（运行期），
 * 本函数从**声明**派生（设计期）。两者输入源不同，判据一致。
 */
export function projectParameterSpace(pattern: TradingPatternSpec): ParameterSpace {
  const execution = pattern.execution;
  if (execution === null) return { parameters: [] };
  const parameters: SweepParameterDefinition[] = [];
  for (const item of execution.parameters) {
    if (item.role !== "tunable") continue;
    const declaration = item.declaration;
    if (declaration.type !== "number") continue;
    const { min, max, step } = declaration;
    if (min === undefined || max === undefined || step === undefined || step <= 0) continue;
    parameters.push({ type: "number", name: declaration.name, min, max, step });
  }
  return { parameters };
}

// ---------------------------------------------------------------------------
// 候选草图投影（「分析 → 转成正式策略」的输入）
// ---------------------------------------------------------------------------

/**
 * 候选草图的可序列化面。
 *
 * 只包含**能从模式声明确定**的部分：入场事件与窗口（`sketch` 段）、执行配方引用、
 * 参数空间。**不含** `filterRule` ——
 *
 * 🔴 为什么刻意不生成 `filterRule`：策略侧的「条件表达式」文法与执行侧的「特征门槛」
 * 是两套表达（`conditionSignal/compile.ts` 的等价改写表已证明二者需要**逐条数学证明**
 * 才能互译）。而**不需要**它：只要文档带 `recipe`，装配层就会走注册表配方的
 * `buildGates`，条件照样进信号（STEP A / `9aw` 已交付并取证）。
 * 生成一份「看起来对」的 `filterRule` 反而是引入语义错误的最短路径。
 */
export interface PatternCandidateSketch {
  readonly entryRule: {
    readonly event: string;
    readonly timing: string;
    /**
     * 入场扩展槽（`CANDIDATE_SKETCH_EXTENSION_KEYS` 闭集，`definitionBuild.ts` 校验）。
     *
     * 用宽松记录而不是逐键声明：**语义面**（`observationWindow` / `trigger` / `recipe`）
     * 由模式声明投影，**执行假设面**（`execution` / `position` / `risk` / `document` /
     * `eventParams`）来自 `executionAssumptions.ts` 的文档级默认值，调用方还可逐键覆盖。
     *
     * 🔴 逐键声明会诱使「只投影自己声明的键」，而 `buildStrategyDefinition` 的必填面
     * 会随策略 schema 演进 —— 漏一个键的症状是**转正失败**（`PROMOTE_SKETCH_INCOMPLETE`）。
     * 2026-09-17 真实库全链验收真实踩到（少 `trigger`）。
     */
    readonly extra: Readonly<Record<string, unknown>>;
  };
  readonly parameterSpace: Readonly<Record<string, Record<string, unknown>>>;
  /** 退出规则（文档级默认；调用方可覆盖）。promote 的**必填**段。 */
  readonly exitRule: Readonly<Record<string, unknown>>;
  /** 风控规则（文档级默认；调用方可覆盖）。promote 的**必填**段。 */
  readonly riskRule: Readonly<Record<string, unknown>>;
  /** 人读备注（语义差异、口径提醒等），进转正报告。 */
  readonly notes: readonly string[];
}

/**
 * 从模式声明投影候选草图。
 *
 * 返回 `null` 的两种情形（都是**如实**的「还不能转正」）：
 *   1. 该模式没有执行形态（纯研究模式）⇒ 没有可跑的配方；
 *   2. 该模式没有 `sketch` 段 ⇒ 入场事件 / 窗口未经人工确认，**不由投影编造**。
 */
export function projectCandidateSketch(pattern: TradingPatternSpec): PatternCandidateSketch | null {
  const execution = pattern.execution;
  const sketch = pattern.sketch;
  if (execution === null) return null;
  if (sketch === undefined || sketch === null) return null;

  /**
   * 结构性校验（非空字符串）。
   *
   * 🔴 **为什么不在这里 import 策略侧词表**（`STRATEGY_EVENT_TYPES` /
   * `ENTRY_TIMING_TO_EXECUTION` 都在 `strategyCandidate/definitionBuild.ts`）：
   * `moduleRegistry.ts` 会调用本文件的 `buildPatternModuleSpecs()`，一旦这里 import
   * 那个模块，「研究规划域」就反向依赖了「策略候选域」—— 依赖图会立刻变脏，
   * 且每次 planner 加载都会拉进整条转正链路。
   *
   * ⇒ 分工：**投影器做结构性校验**（能独立判定的部分），**词表一致性交给单测**
   *   （`tests/server/research/patternLibrary/patternLibrary.test.ts` 里断言
   *   每个声明的 `event` / `timing` 都在策略侧真实词表内）。测试可以自由 import 两边，
   *   于是「拼错的词表值」依然会在 CI 阶段失败，只是失败点从运行时前移到测试。
   */
  if (typeof sketch.event !== "string" || sketch.event.trim() === "") {
    throw new Error(`模式投影：${pattern.patternId} 的 sketch.event 必须是非空字符串。`);
  }
  if (typeof sketch.timing !== "string" || sketch.timing.trim() === "") {
    throw new Error(`模式投影：${pattern.patternId} 的 sketch.timing 必须是非空字符串。`);
  }
  if (sketch.observationWindow.start < 1 || sketch.observationWindow.end < sketch.observationWindow.start) {
    throw new Error(
      `模式投影：${pattern.patternId} 的 observationWindow 必须满足 start >= 1 且 end >= start`
        + `（实际 start=${sketch.observationWindow.start} / end=${sketch.observationWindow.end}）。`,
    );
  }
  if (typeof sketch.observationWindow.unit !== "string" || sketch.observationWindow.unit.trim() === "") {
    throw new Error(`模式投影：${pattern.patternId} 的 observationWindow.unit 必须显式声明（禁默认）。`);
  }

  const recipe = projectRecipeReference(pattern);
  if (recipe === null) return null;

  return {
    entryRule: {
      event: sketch.event,
      timing: sketch.timing,
      extra: {
        // ---- 语义面（由模式声明投影）----
        observationWindow: {
          start: sketch.observationWindow.start,
          end: sketch.observationWindow.end,
          unit: sketch.observationWindow.unit,
        },
        trigger: sketch.trigger,
        recipe,
        // ---- 事件参数 + 执行假设（文档级默认，与模式正交，可被调用方逐键覆盖）----
        eventParams: { ...DEFAULT_ENTRY_EVENT_PARAMS },
        ...DEFAULT_EXECUTION_ASSUMPTIONS,
      },
    },
    parameterSpace: projectSketchParameterSpace(pattern),
    // 退出 / 风控：文档级默认（与模式正交），promote 的必填段。调用方可在 create 时覆盖。
    exitRule: { ...DEFAULT_EXIT_RULE },
    riskRule: { ...DEFAULT_RISK_RULE },
    notes: sketch.notes ?? [],
  };
}

/**
 * 声明 → 策略文档的 `recipe` 可序列化面（`StrategyRecipe`）。
 *
 * 🔴 特征版本清单**从配方定义反查**（`projectRecipeDefinition().features`），
 * 不另写一张表 —— 否则「文档声明的特征」与「配方真实产出的特征」会各自漂移，
 * 而 `resolveStrategyRecipe` 的校验会把它变成运行期失败。
 */
export function projectRecipeReference(pattern: TradingPatternSpec): StrategyRecipe | null {
  const definition = projectRecipeDefinition(pattern);
  if (definition === null) return null;
  const featureVersions: FeatureVersionRef[] = definition.features
    .map(feature => ({ featureId: feature.featureId, version: feature.version }))
    .sort((left, right) => left.featureId.localeCompare(right.featureId));
  return {
    kind: "signalEngine",
    recipeId: definition.recipeId,
    point: definition.point,
    signalFrequency: definition.signalFrequency,
    signalDescription: definition.signalDescription,
    featureVersions,
    rankingConfig: definition.rankingConfig,
    selectionConfig: definition.selectionConfig,
    requiredData: definition.requiredData,
  };
}

/** 供投影器内部与单测复用的参数键集合（避免各处重复写 `execution.parameters.map`）。 */
export function declaredParameterKeys(pattern: TradingPatternSpec): readonly PatternParameterKey[] {
  const execution = pattern.execution;
  if (execution === null) return [];
  return execution.parameters.map(item => item.key);
}
