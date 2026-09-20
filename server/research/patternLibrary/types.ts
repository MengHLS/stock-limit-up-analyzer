/**
 * PATTERN-LIBRARY-001 — 交易模式声明库：类型定义。
 *
 * ## 为什么需要它
 *
 * 迁移前，「一种交易模式」被拆散在**四个互不相识的地方**：
 *   1. 研究侧模块规格（`researchEngine/planner/moduleRegistry.ts` 的 7 个工厂）
 *   2. 执行侧配方定义（`research/recipeRegistry.ts` 的 `STRATEGY_RECIPE_DEFINITIONS`）
 *   3. 参数 schema（写在每一份策略文档的 `parameters` 里）
 *   4. 候选草图（`research_candidate` 的 `entryRule` / `filterRule` / `parameterSpace` / `recipe`）
 *
 * 四处靠**人工对齐**，且没有任何机制保证一致。后果（2026-09-17 实查，`RESEARCH-STRATEGY-GAP-AUDIT-001.md`）：
 *   - 研究侧变量名 `pullback_holds_event_open_2d` 到执行侧字段引用 `bar.low` **没有自动翻译**
 *     ⇒ 转正必然失败，除非人肉重写（P0-2）；
 *   - 同一概念两侧算法不同构（窗口布尔 vs 单日连续量）却无人对账（P0-3）；
 *   - 研究侧能表达 `OR` / `NOT`，执行侧存不下 ⇒ 被静默压成 AND（P0-1）。
 *
 * ## 本库的定位
 *
 * **单一真源**：一份 `TradingPatternSpec` 同时派生上述四处。新增一种交易模式 =
 * **新增一个声明文件**，不需要改 Planner、不需要改路由、不需要改前端、不需要改注册表。
 *
 * ## 三条设计纪律
 *
 * 1. **声明是纯数据，不是代码**：本文件与 `patterns/**` 只允许 `import type`，
 *    **零运行时依赖**。这样「AI / vibecoding 生成一个模式声明」产出的是可以逐字段 review
 *    的数据，而不是一段需要人读懂逻辑的代码。所有「把数据变成可执行实例」的动作
 *    集中在 `project.ts`（同一份实现，禁第二套）。
 *
 * 2. **缺哪一侧就如实标 `null`，禁伪造**：执行侧配方的 `buildGates` 与研究侧的条件配方
 *    是两套独立口径，**不能互相推导**。声明里必须**分别**写出两侧；某一侧不存在时应标
 *    `null`（纯研究模式 / 纯执行模式），而不是补一个看起来差不多的默认值。
 *
 * 3. **`role` 必填**：每个参数必须声明自己是「可调」还是「固定」。
 *    实查确认：迁移前 `parameterRole` 有声明却**无人消费**，导致「固定参数只要带了
 *    `min`/`max`/`step` 就会被搜索」——搜索空间里混进不该动的维度，而结果看起来很正常。
 *    这里把 `role` 做成必填字段，派生搜索空间时**必须**尊重它。
 */

import type {
  ResearchAnalysisPriority,
  ResearchAnalysisType,
  ResearchConditionOperator,
  ResearchConditionValue,
  ResearchConclusionType,
  ResearchType,
} from "../vocabulary";
import type { PatternSemanticDeclaration } from "../../../shared/patternSemantics";
import type {
  ResearchModuleCapability,
  ResearchTargetKind,
} from "./moduleRegistry";
import type { ResearchParameterDefinition } from "../types";

// ---------------------------------------------------------------------------
// 条件配方引用（声明形态 = 纯数据）
// ---------------------------------------------------------------------------

/**
 * 回踩守卫的价格基准。
 *
 * 与 `moduleRegistry.ts#PULLBACK_GUARD_FLOORS` **逐字同域**（`"low" | "open"`）。
 * 这里用字面量联合而不是 import 常量 —— 声明层不允许运行时依赖；
 * 一致性由 `tests/server/research/patternLibrary/` 的「构造器覆盖」用例钉死。
 */
export type PatternGuardFloor = "low" | "open";

/**
 * 研究侧条件配方的**声明形态**。
 *
 * 每一个 `kind` 一一对应 `moduleRegistry.ts` 里的一个构造器（见 `project.ts` 的投影表）。
 * 之所以不直接写 `ResearchConditionRecipe`（它含 `build` 函数）：那样声明就必须 import
 * 运行时构造器，声明也就变成了代码 —— 而本库要让声明保持**可序列化、可生成、可 diff**。
 */
export type PatternConditionRecipeRef =
  | { readonly kind: "guard"; readonly floor: PatternGuardFloor }
  | { readonly kind: "guardControl"; readonly floor: PatternGuardFloor }
  | { readonly kind: "shrinkVolume"; readonly ratio: number; readonly tag: string }
  | { readonly kind: "volumeExpansion" }
  | { readonly kind: "lastBullish" }
  | { readonly kind: "aboveEventClose" }
  | {
      readonly kind: "depthBand";
      readonly offset: number;
      readonly lower: number | null;
      readonly upper: number;
      readonly tag: string;
    }
  | {
      readonly kind: "obsDay";
      readonly id: string;
      readonly label: string;
      readonly purpose: string;
      readonly field: string;
      readonly operator: ResearchConditionOperator;
      readonly value: ResearchConditionValue;
    };

// ---------------------------------------------------------------------------
// 执行侧（策略）投影
// ---------------------------------------------------------------------------

/**
 * 执行侧特征键。
 *
 * ⚠️ 这是**语义键**，不是特征 id —— 到真实 `featureId` 的映射只有一份，在
 * `project.ts#PATTERN_FEATURE_ID_BY_KEY`（用 `PULLBACK_FEATURE_IDS` 的值，禁写第二套字面量）。
 * 这样一来「改名」只需改 `recipeRegistry.ts` 的常量，本库自动跟随；映射表缺键则**抛错**。
 */
export type PatternFeatureKey = "haircut" | "volumeRatio" | "isBullish" | "momentum" | "pctChange";

/** 参数键（语义键）。到文档参数名 `max_volume_ratio` 的映射同样只有一份。 */
export type PatternParameterKey =
  | "maxVolumeRatio"
  | "maxDrawdown"
  | "requireBullish"
  | "topN"
  | "pctChangeWeight";

/** 门槛右值：常量，或引用某个已声明的参数。 */
export type PatternGateBound =
  | { readonly kind: "constant"; readonly value: number }
  | { readonly kind: "parameter"; readonly parameter: PatternParameterKey };

/** 单个执行侧门槛（**AND** 语义；顺序即短路顺序，属语义一部分）。 */
export interface PatternGate {
  readonly kind: "lte" | "lt" | "gte" | "gt" | "eq";
  readonly feature: PatternFeatureKey;
  readonly bound: PatternGateBound;
  /** 人读标签（进 `FeatureGate.label`，也会写进诊断消息）。 */
  readonly label: string;
  /**
   * 启用条件（缺省 = 恒启用）。
   *
   * 🔴 为什么门槛需要「条件性」：迁移前的 `buildPullbackGates` 里，「红盘」门槛是
   * `if (requireBullish >= 1) gates.push(...)` —— 也就是说**门槛列表本身依赖运行期参数**。
   * 若声明层用静态数组表达，就会把「require_bullish = 0 时不检查红盘」压成「恒检查」，
   * 直接改变信号集合。这里把它还原成数据：投影时先判 `enabledWhen` 再决定是否入列。
   */
  readonly enabledWhen?: {
    readonly parameter: PatternParameterKey;
    readonly operator: "gte" | "gt" | "lte" | "lt" | "eq";
    readonly value: number;
  };
}

/** 参数声明：`role` 必填（见文件头纪律 3）。 */
export interface PatternParameterDeclaration {
  readonly key: PatternParameterKey;
  /** 策略文档 `parameters[].name` —— 搜索与覆写都用这个名字。 */
  readonly name: string;
  /**
   * `tunable` = 交给 Parameter Search 搜索；`fixed` = **只允许默认值**，不进搜索空间。
   *
   * ⚠️ 迁移前无此区分（`parameterRole` 有声明无消费者）⇒ 派生搜索空间时会**跳过** `fixed`。
   */
  readonly role: "tunable" | "fixed";
  readonly declaration: ResearchParameterDefinition;
}

/**
 * 执行侧投影。
 *
 * `signalKind` 与 `recipeRegistry.ts` 的判别联合同域：
 *   - `weighted`：线性加权，表达「按综合分择优」（`weights` 的键即特征）；
 *   - `gated`：硬门槛过滤（全过才产出信号），表达「守线 + 缩量」这类条件。
 * 两者**不混用** —— 用加权近似硬门槛会放行「门槛失败但其他特征极高」的样本，那
 * 是口径错误而不是实现细节（见 `gatedSignal.ts` 文件头）。
 */
export type PatternExecutionProjection =
  | {
      readonly signalKind: "weighted";
      readonly recipeId: string;
      readonly point: "close";
      readonly signalFrequency: "daily";
      readonly signalDescription: string;
      readonly requiredData: readonly string[];
      readonly selectionSummary: string;
      readonly randomSeed: number;
      /**
       * 线性加权权重（`value = Σ wᵢ·fᵢ`）。
       *
       * 🔴 用数组而不是 `Record`：`Record<PatternFeatureKey, number>` 会要求**每个**特征键都有值，
       * 而一个配方通常只用一两个特征；用 `Partial<Record<...>>` 又会让 `undefined`
       * 悄悄流进求和（`NaN` 与「缺失」不可辨）。数组形式让「参与了哪些特征」一目了然。
       */
      readonly weights: readonly { readonly feature: PatternFeatureKey; readonly weight: number }[];
      readonly rankHigherIsBetter: boolean;
      readonly topN: number;
      readonly parameters: readonly PatternParameterDeclaration[];
    }
  | {
      readonly signalKind: "gated";
      readonly recipeId: string;
      readonly point: "close";
      readonly signalFrequency: "daily";
      readonly signalDescription: string;
      readonly requiredData: readonly string[];
      readonly selectionSummary: string;
      readonly randomSeed: number;
      /** 特征产出面（必须**完整列出**该配方要算的特征；漏写会在注册期被拒绝）。 */
      readonly features: readonly PatternFeatureKey[];
      /** 门槛列表（顺序即短路顺序）。 */
      readonly gates: readonly PatternGate[];
      /** 排序特征（信号值取自它，供横截面取 topN）。 */
      readonly rankFeature: PatternFeatureKey;
      readonly rankHigherIsBetter: boolean;
      readonly topN: number;
      readonly parameters: readonly PatternParameterDeclaration[];
    };

// ---------------------------------------------------------------------------
// 研究侧投影
// ---------------------------------------------------------------------------

/**
 * 研究侧投影。
 *
 * 字段与 `ResearchModuleSpec`（`moduleRegistry.ts:186`）**一一对应**，
 * 只把三个「配方数组」换成声明形态的 `PatternConditionRecipeRef`。
 * 投影由 `project.ts#projectResearchModule` 完成，产出可直接 `registry.register(spec)`。
 */
export interface PatternResearchProjection {
  readonly moduleKey: string;
  /**
   * 研究模块的人读名。缺省 ⇒ 回落 `TradingPatternSpec.label`。
   *
   * 为什么需要独立字段：双栖模式下「模式名」与「研究模块名」**天然不同** ——
   * 同一个研究模块（回踩有效性）可以服务多条候选策略，而模式名描述的是**这一条**
   * （如「首板回踩 · 守线 + 缩量」）。把两者压成一个字段，就会让研究侧的名字随策略口径漂移
   * （`moduleRegistry.ts` 文件头纪律 2 明确禁止「把某条策略焊进方法名」）。
   */
  readonly moduleLabel?: string;
  /** 研究模块的一句话目的。缺省 ⇒ 回落 `TradingPatternSpec.purpose`。 */
  readonly modulePurpose?: string;
  /** 研究模块的适用场景。缺省 ⇒ 回落 `TradingPatternSpec.whenToUse`。 */
  readonly moduleWhenToUse?: readonly string[];
  readonly researchType: ResearchType;
  readonly requiredCapabilities: readonly ResearchModuleCapability[];
  readonly keywords: readonly string[];
  readonly primaryKeywords: readonly string[];
  readonly primaryAnalysisType: ResearchAnalysisType;
  readonly recommendedAnalysisTypes: readonly ResearchAnalysisType[];
  readonly targetKinds: readonly ResearchTargetKind[];
  readonly preferredHorizons: readonly number[];
  readonly entryEvaluations: readonly number[];
  readonly guardRecipes: readonly PatternConditionRecipeRef[];
  readonly refinementRecipes: readonly PatternConditionRecipeRef[];
  readonly controlRecipes: readonly PatternConditionRecipeRef[];
  readonly quantileFeatures: readonly string[];
  readonly groupingDimensions: readonly string[];
  readonly stabilityDimension: string;
  readonly conclusionTypes: readonly ResearchConclusionType[];
  readonly minSampleCount: number;
  readonly primaryTargetKinds: readonly ResearchTargetKind[];
  readonly defaultPriority: ResearchAnalysisPriority;
}

// ---------------------------------------------------------------------------
// 交易模式声明
// ---------------------------------------------------------------------------

/**
 * 候选草图投影的**人工选择面**（无法从其它字段推导的部分）。
 *
 * 为什么这些必须显式写在声明里而不是由投影推导：
 *   - `event` / `timing` 是**策略侧词表**，与研究的「求值日 offset」不是一回事
 *     （offset 是研究回看的相对日；timing 是「信号产生后何时成交」）；
 *   - `observationWindow` 决定**哪些日有决策日资格**（`rd ∈ [start, end]`）。
 *     猜一个窗口 = 悄悄改窄或放宽策略；`datasetFromRegistry.ts` 对「未声明/非法」
 *     一律抛错，这里也一样：**声明里没有就不投影，绝不填默认**。
 */
export interface PatternSketchProjection {
  /** 策略侧事件类型（必须是 `STRATEGY_EVENT_TYPES` 之一，投影时校验）。 */
  readonly event: string;
  /** 入场时点（必须是 `ENTRY_TIMING_TO_EXECUTION` 的键，投影时校验）。 */
  readonly timing: string;
  /**
   * 触发时点（`STRATEGY_TRIGGER_TYPES`：`FIRST_VALID_DAY` / `LAST_VALID_DAY` /
   * `EVERY_VALID_DAY` / `NEXT_TRADING_DAY`）——「条件满足后何时产生 Signal」。
   *
   * 🔴 为什么必填而不是给默认：它是**入场语义的一部分**（窗口内首日就出手，还是等窗口走完）。
   * 2026-09-17 真实库全链验收实测：漏了它 ⇒ `promote` 直接抛
   * `PROMOTE_SKETCH_INCOMPLETE`（「Promote 不会替你选一个」）。
   * 词表合法性由 `tests/server/research/patternLibrary/patternLibrary.test.ts` 钉死
   * （`project.ts` 刻意不 import 策略候选域，理由见该文件注释）。
   */
  readonly trigger: string;
  /** 观察窗口（策略侧必填；单位显式声明，禁默认）。`rd ∈ [start, end]` 为决策日资格。 */
  readonly observationWindow: {
    readonly start: number;
    readonly end: number;
    readonly unit: string;
  };
  /** 人读备注（进转正报告；不参与计算）。 */
  readonly notes?: readonly string[];
}

/**
 * 一种交易模式的**完整声明** —— 本库的唯一真源。
 *
 * `research` 与 `execution` **都可为 `null`**，且必须显式二选一以上：
 *   - 两侧都有 ⇒ 双栖模式（研究出来的结论可以**直接**变成同名配方跑回测，这是目标态）；
 *   - 只有 `research` ⇒ 纯研究模式（可被研究，但还没有可执行形态）；
 *   - 只有 `execution` ⇒ 纯执行模式（能跑，但没有配套研究模块；如基准配方）。
 *
 * 为什么要显式 `null` 而不是省略字段：`null` 是一个**被声明的结论**（「这一侧不存在」），
 * 省略则是「作者忘了写」。两者在 review 时含义完全不同。
 */
export interface TradingPatternSpec {
  /** 稳定 id（小写连字符）。与执行侧 `recipeId` 同域（双栖模式下二者相等）。 */
  readonly patternId: string;
  /** 人读名。 */
  readonly label: string;
  /** 一句话：这个模式在赌什么。 */
  readonly purpose: string;
  /** 适用场景（人读，用于向用户解释「为什么这么设计」）。 */
  readonly whenToUse: readonly string[];
  /**
   * 候选草图投影的人工选择面。缺省 ⇒ 该模式**尚不可转正**（投影返回 `null`）。
   *
   * ⚠️ 这不是「可选优化」，而是**诚实边界**：研究出结论 ≠ 知道该用什么入场时点、
   * 该在窗口的哪一天决策。缺这段就必须由人显式决定，而不是由投影编一个。
   */
  readonly sketch?: PatternSketchProjection | null;
  readonly research: PatternResearchProjection | null;
  readonly execution: PatternExecutionProjection | null;
  /**
   * **受控语义声明槽**（PHASE-B-001）：让 Pattern 在不改 Core 白名单的前提下，
   * 声明一个研究 / 策略两侧都能用的新语义字段。
   *
   * 省略 ⇒ 该 Pattern 不声明新语义（沿用 Core 已有变量）。
   * 形态是**纯数据**：`{ version, declarations[] }`，不含任何可执行内容
   * （见 `shared/patternSemantics.ts` 的三条边界）。
   */
  readonly semantics?: PatternSemanticsSection | null;
}

/** Pattern 的语义声明段（唯一键 = `patternId + version`）。 */
export interface PatternSemanticsSection {
  /** 语义版本；与 `patternId` 组成唯一键，注册后**不可重新定义**（见 `semanticRegistry.ts`）。 */
  readonly version: string;
  readonly declarations: readonly PatternSemanticDeclaration[];
}
