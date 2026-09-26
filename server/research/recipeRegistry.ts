/**
 * 运行工作台 — 已注册执行配方（Recipe）注册表。
 *
 * 背景（见 `../runWorkbenchAssembly/assemble.ts` 文件头）：
 *   `signalEngine` 的 `Strategy13` 携带**函数实例**（`FeatureProvider.compute` /
 *   `SignalBuilder`），无法从数据库里的 JSON 还原 —— 策略文档只保存其**可序列化面**
 *   （`StrategyRecipe`：recipeId / point / 特征版本 / 排序 / 选择 / 频率 / 数据域）。
 *
 *   本注册表就是那份「可序列化面 → 真实可执行实例」的桥（与 `StrategyRecipe.recipeId`
 *   的文档注释一致：「可执行实例由策略代码库 / 调用方以 recipeId 为键持有并注册」）。
 *
 * 铁律：
 *   - **只注册能真跑的配方**：`deps` 里每个 featureId 都必须由 `features` 真实产出，
 *     否则注册即抛错（防「声明了却没算」的静默降级）。
 *   - **零猜测**：未注册的 recipeId 一律响亮抛错；本模块**不提供**任何缺省配方。
 *   - 配方内的特征可用性声明 `availability` 是**绝对时点**，由调用方给出（框架不猜）。
 *     这里统一用「决策日当日 + 同点可见」，即 `availableAt === requiredDataThrough === point`，
 *     与 `docs/evidence/_probe_dataset_*` 系列取证所用口径一致。
 */

import type { DecisionPoint } from "../data";
import type { ResearchParameterSchema, ResearchParameterSet } from "./types";
import type {
  FeatureProvider,
  RankingConfig,
  SelectionConfig,
  SignalFrequency,
} from "./framework/contract";
import {
  featureValueOf,
  makeWeightedSignalBuilder,
  weightedValueOf,
  type SignalBuilder,
} from "./framework/signal";
import { makeGatedSignalBuilder, type FeatureGate } from "./framework/gatedSignal";
import type { StrategyRecipe } from "./strategySchema/types";
import { StrategyRecipeRuntimeError } from "./recipeErrors";
import { PULLBACK_PARAMETER_IDS, requireNumericParameter } from "./recipeRegistryAtoms";
import { buildPatternRecipeDefinitions } from "./patternLibrary/projectRecipe";

// ---------------------------------------------------------------------------
// 导出面（保持不变）
// ---------------------------------------------------------------------------

/**
 * 🔴 下列运行时原子已下移到 `recipeRegistryAtoms.ts`（2026-09-17）。
 *
 * 为什么搬：`patternLibrary/project.ts` 投影执行配方时要用同一批原子，若它们留在本文件
 * 就会形成 `recipeRegistry → patternLibrary → recipeRegistry` 的**真循环**（运行时依赖）。
 * 下移后依赖单向：两边都 → `recipeRegistryAtoms.ts`。
 *
 * 这里**逐名 re-export**，因此本模块的对外导出面与迁移前**完全一致** ——
 * `conditionSignal/compile.ts` 等既有消费方不需要任何改动。
 */
export {
  PCT_CHANGE_FEATURE_ID,
  PCT_CHANGE_FEATURE_VERSION,
  PULLBACK_FEATURE_IDS,
  PULLBACK_PARAMETER_IDS,
  buildPctChangeFeatureProvider,
  buildPullbackFeatureProviders,
  requireNumericParameter,
} from "./recipeRegistryAtoms";

// ---------------------------------------------------------------------------
// 运行时配方
// ---------------------------------------------------------------------------

/** 一份「可执行」的配方：可序列化面 + 真实特征 / 信号实例 + 参数解析。 */
export interface StrategyRecipeRuntime {
  readonly recipeId: string;
  readonly point: DecisionPoint;
  readonly signalFrequency: SignalFrequency;
  readonly signalDescription?: string;
  readonly features: readonly FeatureProvider[];
  /**
   * 🔴 **由参数集构造**本次运行的信号构造器。
   *
   * 为什么是工厂而不是固定实例：门槛型配方（如「守线 + 缩量 ≤ X%」）的门槛值来自
   * 策略文档的参数（`ResearchParameterSchema`），而参数只有到运行期读到文档才知道。
   * 固定实例会让「文档声明 0.3，实际按登记时常量跑」——正是要消灭的口径漂移。
   *
   * 对无参数配方（如 `leader-candidate-baseline`）该工厂忽略入参、返回同一语义的构造器，
   * 保证既有行为逐字不变。
   */
  buildSignalBuilder(parameters: ResearchParameterSet): SignalBuilder;
  /**
   * STRATEGY-ARCH-002 — 本配方的**排序特征 id**（`gated` 支才有；`weighted` 支为 null）。
   *
   * 为什么要暴露：Core 的 `StrategyDecision` **不产出排序值**（ranking 属消费方职责，
   * 见规格 §12 / §13）⇒ 生产接线需要把「横截面排序取哪个特征」这件事**读**出来，
   * 而不是在接线层按配方名硬编码（那会形成第二套口径）。
   */
  readonly rankFeatureId: string | null;
  /**
   * **排序值取值函数**（唯一权威；供 Core 决策源取横截面排序值）。
   *
   * 🔴 与 `rankFeatureId` 的分工：
   *   - `gated` 支：排序值 = 排序特征的（有限）值 ⇒ 与 `rankFeatureId` 同源；
   *   - `weighted` 支：排序值 = `Σ wᵢ·fᵢ`，**不对应任何单一特征 id**
   *     ⇒ `rankFeatureId` 只能是 `null`（它的语义是「特征 id」，不是「值的算法」）。
   *
   * 此前只有 `rankFeatureId`，`weighted` 支因此恒为 `null`，而 `coreDecision` 的
   * 判据是「`rankValue` 非空才发信号」 ⇒ `weighted` 配方在生产链路**零信号且不报错**
   * （2026-09-26 实测）。本字段把「排序值怎么算」从「特征名的猜测」升级为
   * **配方声明的算法**，两支统一。
   */
  readonly rankValueOf: (features: Readonly<Record<string, number | null>>) => number | null;
  readonly rankingConfig: RankingConfig;
  readonly selectionConfig: SelectionConfig;
  /** 该配方运行所需数据域（进 `StrategyContract.requiredData`）。 */
  readonly requiredData: readonly string[];
  /** 用于审计展示的「选择什么」人话摘要（不参与任何计算）。 */
  readonly selectionSummary: string;
  /** 随机种子（确定性配方恒为固定值；此处显式声明而非散落在调用点）。 */
  readonly randomSeed: number;
  /**
   * 由参数 schema 解析出**本次运行使用的参数集**。
   *
   * 规则：
   *   1. 逐参数取值：`overrides` 里有就用覆写值，否则用 schema 的 `defaultValue`；
   *      两者都没有 ⇒ **响亮抛错**（绝不编值 —— 那会在结果里留下不可复现的参数）。
   *   2. 🔴 `overrides` 里出现 schema **未声明**的参数 ⇒ **响亮抛错**
   *      （`RECIPE_PARAMETER_UNKNOWN`）。这是「未收录维度被静默忽略」这条缺陷的对症修法：
   *      宁可拒绝，也不让调用方以为某个维度参与了寻优、实际却被丢掉。
   *
   * 无覆写时行为与既往**完全一致**（全取 `defaultValue`）；解析结果进
   * `ExperimentConfig.parameters` 与结果记录 ⇒ 可复现。
   */
  resolveParameters(schema: ResearchParameterSchema, overrides?: ResearchParameterSet): ResearchParameterSet;
}

// ---------------------------------------------------------------------------
// 配方定义
// ---------------------------------------------------------------------------

/**
 * 配方定义（注册用；与 `StrategyRecipe` 的可序列化面粘合）。
 *
 * 信号构造器有两种风格（判别联合，**不混用**）：
 *   - `"weighted"`：线性加权（`value = Σ wᵢ·fᵢ`），表达「按综合分择优」；
 *   - `"gated"`：门槛过滤（全部门槛通过才产出信号），表达「守线 + 缩量」这类**硬条件**。
 *
 * 🔴 为什么必须分开而不是都退回加权：加权和里「守线失败」只是让分数变小，**不会剔除**该证券
 * ⇒ 会放行「守线失败但其他特征极高」的样本 —— 这是口径错误，不是实现细节。
 */
export type StrategyRecipeDefinition = StrategyRecipeDefinitionCommon &
  (
    | {
        readonly signalKind: "weighted";
        readonly defaultWeights: Readonly<Record<string, number>>;
      }
    | {
        readonly signalKind: "gated";
        /** 由**运行期参数集**构造门槛列表（参数来自策略文档，故此处是工厂）。 */
        readonly buildGates: (parameters: ResearchParameterSet) => readonly FeatureGate[];
        /** 排序特征 id（信号值取自它，供横截面取 topN）。 */
        readonly rankFeatureId: string;
        /**
         * 探测用参数 code（**仅注册期「门槛引用面」校验用**；不给缺省 ⇒ `[]`）。
         *
         * 🔴 为什么必须有（STRATEGY-RESEARCH-BRIDGE-001 §15 实测缺陷）：
         * 注册期会用「探测参数集」调一次 `buildGates` 以收集门槛引用的 featureId，而
         * `buildGatesProbe` 原先把探测集**写死**为 `Object.values(PULLBACK_PARAMETER_IDS)`
         * —— 那是**已注册配方**的参数面。合成配方（`conditionSignal/compile.ts`）的参数 code
         * 来自**策略文档**，与这三个 code 无关 ⇒ 探测时 `requireNumericParameter` 取不到值，
         * 抛 `RECIPE_PARAMETER_INVALID` ⇒ **「文档声明式条件」这条路径对任何参数 code 不等于
         * 注册配方三参数的策略都不可用**（`assemble.ts#requireRecipe` 路径 2 结构性失败）。
         *
         * 语义：定义方**显式声明**自己 `buildGates` 会读的额外参数 code。探测集 = 既有
         * `PULLBACK_PARAMETER_IDS` 值 ∪ 本字段（一律给 `0` —— 数值合法，只为让 `buildGates`
         * 走完全程；**不参与任何计算与落库**）。
         */
        readonly gateProbeParameterCodes?: readonly string[];
      }
  );

interface StrategyRecipeDefinitionCommon {
  readonly recipeId: string;
  readonly point: DecisionPoint;
  readonly signalFrequency: SignalFrequency;
  readonly signalDescription: string;
  readonly requiredData: readonly string[];
  readonly selectionSummary: string;
  readonly randomSeed: number;
  readonly features: readonly FeatureProvider[];
  readonly rankingConfig: RankingConfig;
  readonly selectionConfig: SelectionConfig;
}

/**
 * 注册表：`recipeId → 可执行配方`。
 *
 * `leader-candidate-baseline` 是既有真实链（`scripts/runResearchDatasetE2E.mts` 与
 * `server/research/strategyPersistence` 内置策略目录）使用的策略身份，故沿用同名配方。
 * `first-limit-pullback-hold-shrink` 是 2026-09-13 新增：承载「守线 + 缩量（+ 红盘）」
 * 的真实可执行条件（此前该条件**无任何配方可执行**，见 `docs/evidence/_probe_promoted_entry_conditions.mts`）。
 */
/**
 * 配方定义清单（**惰性**，理由同 `moduleRegistry.defaultResearchModuleRegistry`：
 * 顶层表达式会撞上互相 import 的求值顺序问题）。
 */
let definitionsCache: readonly StrategyRecipeDefinition[] | null = null;
function strategyRecipeDefinitions(): readonly StrategyRecipeDefinition[] {
  if (definitionsCache === null) definitionsCache = buildPatternRecipeDefinitions();
  return definitionsCache;
}

// ---------------------------------------------------------------------------
// 注册与解析
// ---------------------------------------------------------------------------


/**
 * 由配方定义构造可执行运行时。
 *
 * 🔴 注册表与「声明式条件合成」（`conditionSignal/compile.ts`，STEP A-1）**共用本函数** ——
 * 运行时构造与注册期校验只有这一份实现（禁第二套）。
 */
function makeStrategyRecipeRuntime(definition: StrategyRecipeDefinition): StrategyRecipeRuntime {
  // 注册期强制「声明的特征都真实产出」——防「文档声明了却没人算」的静默降级。
  const produced = new Set(definition.features.map(feature => feature.featureId));
  /**
   * 注册期强制「声明的特征都真实产出」（防「文档声明了却没人算」的静默降级）。
   *
   * 两种信号风格各自要校验的引用面：
   *   - `weighted`：每个权重键必须是某 FeatureProvider 的 featureId；
   *   - `gated`：门槛引用 + 排序特征都必须是已产出特征。
   * 注意 `gated` 的门槛由**运行期参数**构造，因此这里用「无参时空门槛探测 + 参数面清单」
   * 的方式无法穷尽 —— 改为**对全部已产出特征做一次构造校验**（见下方 `assertGatedReferences`）。
   */
  if (definition.signalKind === "weighted") {
    for (const featureId of Object.keys(definition.defaultWeights)) {
      if (!produced.has(featureId)) {
        throw new StrategyRecipeRuntimeError(
          "RECIPE_FEATURE_NOT_PRODUCED",
          `配方 ${definition.recipeId}：信号权重引用了未被任何 FeatureProvider 产出的特征 \`${featureId}\`（注册即拒绝）。`,
        );
      }
    }
  } else {
    if (!produced.has(definition.rankFeatureId)) {
      throw new StrategyRecipeRuntimeError(
        "RECIPE_FEATURE_NOT_PRODUCED",
        `配方 ${definition.recipeId}：排序特征 \`${definition.rankFeatureId}\` 未被任何 FeatureProvider 产出（注册即拒绝）。`,
      );
    }
    /**
     * 门槛引用的特征同样必须真实产出。
     *
     * ⚠️ 门槛由**运行期参数**构造，注册期拿不到真实参数 ⇒ 用一个「探测参数集」调一次
     * `buildGates`，把它引用的 featureId 逐一核对。探测参数只用于**取引用面**，不参与
     * 任何计算与落库；若某配方在特定参数下才引用某特征，本校验会漏 —— 因此
     * `buildGates` 的实现被要求「引用面与参数取值无关」（本项目两个配方都满足）。
     */
    const probe = buildGatesProbe(definition);
    for (const gate of probe) {
      if (!produced.has(gate.featureId)) {
        throw new StrategyRecipeRuntimeError(
          "RECIPE_FEATURE_NOT_PRODUCED",
          `配方 ${definition.recipeId}：门槛条件引用了未被任何 FeatureProvider 产出的特征 \`${gate.featureId}\`（注册即拒绝）。`,
        );
      }
    }
  }
  const runtime: StrategyRecipeRuntime = {
    recipeId: definition.recipeId,
    point: definition.point,
    signalFrequency: definition.signalFrequency,
    signalDescription: definition.signalDescription,
    features: definition.features,
    buildSignalBuilder(parameters: ResearchParameterSet): SignalBuilder {
      if (definition.signalKind === "weighted") {
        return makeWeightedSignalBuilder(definition.defaultWeights);
      }
      return makeGatedSignalBuilder({
        gates: definition.buildGates(parameters),
        rankFeatureId: definition.rankFeatureId,
      });
    },
    rankingConfig: definition.rankingConfig,
    rankFeatureId: definition.signalKind === "gated" ? definition.rankFeatureId : null,
    /**
     * 排序值语义与信号值**同源**：`weighted` 支复用 `Σ wᵢ·fᵢ`（与
     * `makeWeightedSignalBuilder` 走同一实现），`gated` 支取排序特征的有限值
     * （与 `makeGatedSignalBuilder` 走同一实现）。
     *
     * 🔴 两者若各写一遍，Core 会出现「信号值非空但排序值为空」的非对称 ⇒ 静默少选。
     */
    rankValueOf:
      definition.signalKind === "weighted"
        ? (features: Readonly<Record<string, number | null>>) =>
            weightedValueOf(definition.defaultWeights, features)
        : (features: Readonly<Record<string, number | null>>) =>
            featureValueOf(features, definition.rankFeatureId),
    selectionConfig: definition.selectionConfig,
    requiredData: definition.requiredData,
    selectionSummary: definition.selectionSummary,
    randomSeed: definition.randomSeed,
    resolveParameters(
      schema: ResearchParameterSchema,
      overrides?: ResearchParameterSet,
    ): ResearchParameterSet {
      const resolved: Record<string, unknown> = {};
      for (const parameter of schema.parameters) {
        const overridden = overrides?.[parameter.name];
        // 用 `overridden !== undefined` 而非真值判断：nullable 参数的合法值可以是 null。
        const value = overridden !== undefined ? overridden : parameter.defaultValue;
        if (value === undefined) {
          throw new StrategyRecipeRuntimeError(
            "RECIPE_PARAMETER_NO_DEFAULT",
            `配方 ${definition.recipeId}：参数 \`${parameter.name}\` 既没有本次覆写值，` +
              `schema 里也没有 defaultValue（拒绝在结果里留下不可复现的参数）。` +
              `请在策略文档中为该参数声明 defaultValue，或在本次调用里显式传入覆写值。`,
          );
        }
        resolved[parameter.name] = value;
      }
      // 🔴 未知覆写参数：响亮拒绝，绝不静默忽略
      //    （静默忽略会让「调用方以为参与寻优的维度」与「实际参与计算的维度」不一致 —— 那正是 P0-2 缺陷的成因）
      for (const name of Object.keys(overrides ?? {})) {
        if (!(name in resolved)) {
          throw new StrategyRecipeRuntimeError(
            "RECIPE_PARAMETER_UNKNOWN",
            `配方 ${definition.recipeId}：本次覆写提供了参数 \`${name}\`，但它不在策略文档的参数 schema 里` +
              `（已声明：${schema.parameters.map(item => item.name).join("、") || "（无）"}）。` +
              `拒绝静默忽略 —— 那会让调用方以为该维度参与了寻优、实际却被丢掉。`,
          );
        }
      }
      return resolved as ResearchParameterSet;
    },
  };
  return runtime;
}

let registeredRecipesCache: ReadonlyMap<string, StrategyRecipeRuntime> | null = null;

/** 已注册配方（**惰性单例**；理由同上）。 */
function registeredRecipes(): ReadonlyMap<string, StrategyRecipeRuntime> {
  if (registeredRecipesCache === null) {
    registeredRecipesCache = new Map(
      strategyRecipeDefinitions().map(
        definition => [definition.recipeId, makeStrategyRecipeRuntime(definition)] as const,
      ),
    );
  }
  return registeredRecipesCache;
}

/**
 * 门槛引用面探测（仅注册期校验用）。
 *
 * 用「覆盖两个分支的探测参数集」调 `buildGates`，把返回值里的 featureId 全收集起来。
 * 之所以要覆盖分支：`require_bullish` 会决定是否追加「红盘」门槛 ⇒ 只探测一个取值会漏掉另一支。
 */
function buildGatesProbe(definition: StrategyRecipeDefinition): readonly FeatureGate[] {
  if (definition.signalKind !== "gated") return [];
  const probeValues = [0, 1];
  /**
   * 🔴 定义方声明的额外参数 code（`gateProbeParameterCodes`）。
   *
   * 合成配方（声明式条件）的门槛右值是**文档参数**，不在 `PULLBACK_PARAMETER_IDS` 里；
   * 不补进探测集就会在注册期校验里抛 `RECIPE_PARAMETER_INVALID`
   * （实测见 `docs/evidence/_probe_srb001_doc_params.mts`）。缺省 `[]` ⇒ 已注册配方零回归。
   */
  const extraCodes = definition.gateProbeParameterCodes ?? [];
  const out: FeatureGate[] = [];
  for (const requireBullish of probeValues) {
    const probe: ResearchParameterSet = {};
    // 只填能影响引用面的参数；其余给 0（数值合法，仅用于让 buildGates 走完全程）。
    for (const name of Object.values(PULLBACK_PARAMETER_IDS)) probe[name] = 0;
    for (const name of extraCodes) probe[name] = 0;
    probe[PULLBACK_PARAMETER_IDS.requireBullish] = requireBullish;
    out.push(...definition.buildGates(probe));
  }
  return out;
}

/** 已注册的配方 id（升序；供 UI 下拉与诊断）。 */
export function registeredStrategyRecipeIds(): readonly string[] {
  return [...registeredRecipes().keys()].sort();
}

/**
 * 由策略文档里的可序列化面解析出真实可执行配方。
 *
 * 校验四项（任一不符即抛错，不做兼容猜测）：
 *   1. `kind` 必须是 `signalEngine`；
 *   2. `recipeId` 必须已注册；
 *   3. 文档声明的 `featureVersions` 必须被该配方真实产出（防「换了特征却还在跑老配方」）；
 *   4. 文档声明的 `point` / `signalFrequency` 必须与配方一致（防「文档说 open 决策、
 *      实际按 close 跑」这种最隐蔽的口径漂移）。
 */
export function resolveStrategyRecipe(recipe: StrategyRecipe): StrategyRecipeRuntime {
  if (recipe.kind !== "signalEngine") {
    throw new StrategyRecipeRuntimeError(
      "RECIPE_KIND_UNSUPPORTED",
      `配方：本增量只支持 recipe.kind="signalEngine"，实际 ${String(recipe.kind)}。`,
    );
  }
  const runtime = registeredRecipes().get(recipe.recipeId);
  if (runtime === undefined) {
    throw new StrategyRecipeRuntimeError(
      "RECIPE_NOT_REGISTERED",
      `配方：recipeId=\`${recipe.recipeId}\` 未在本层注册（已注册：${registeredStrategyRecipeIds().join("、") || "（无）"}）。` +
        `请在 server/research/recipeRegistry.ts 中注册对应的真实可执行实例。`,
    );
  }
  const produced = new Set(runtime.features.map(feature => feature.featureId));
  for (const ref of recipe.featureVersions) {
    if (!produced.has(ref.featureId)) {
      throw new StrategyRecipeRuntimeError(
        "RECIPE_FEATURE_VERSION_MISMATCH",
        `配方 ${recipe.recipeId}：策略文档声明依赖特征 \`${ref.featureId}\`，但已注册配方未产出该特征（拒绝按过时声明运行）。`,
      );
    }
  }
  if (recipe.point !== runtime.point) {
    throw new StrategyRecipeRuntimeError(
      "RECIPE_POINT_MISMATCH",
      `配方 ${recipe.recipeId}：策略文档声明决策时点 point=${recipe.point}，但已注册配方为 ${runtime.point}（口径不一致，拒绝运行）。`,
    );
  }
  if (recipe.signalFrequency !== runtime.signalFrequency) {
    throw new StrategyRecipeRuntimeError(
      "RECIPE_FREQUENCY_MISMATCH",
      `配方 ${recipe.recipeId}：策略文档声明 signalFrequency=${recipe.signalFrequency}，但已注册配方为 ${runtime.signalFrequency}（口径不一致，拒绝运行）。`,
    );
  }
  return runtime;
}

/** 由 recipeId 直接解析（供「调用方显式指定配方」路径；不读策略文档的 recipe 字段）。 */
export function resolveStrategyRecipeById(recipeId: string): StrategyRecipeRuntime {
  const runtime = registeredRecipes().get(recipeId);
  if (runtime === undefined) {
    throw new StrategyRecipeRuntimeError(
      "RECIPE_NOT_REGISTERED",
      `配方：recipeId=\`${recipeId}\` 未在本层注册（已注册：${registeredStrategyRecipeIds().join("、") || "（无）"}）。`,
    );
  }
  return runtime;
}

/**
 * 当策略文档**没有** `recipe` 字段时的兜底配方（显式声明的常量，不是猜测）。
 *
 * ⚠️ 这是**兼容旧文档**的兜底：库里存量 3 份文档（#360001 / #360002 / #390001）都缺 `recipe`，
 * 装配层 `requireRecipe()` 会落到本常量，事实写进
 * `assembly.recipeSource = "default-fallback"`（🔴 与「调用方显式指定 recipeId」的
 * `explicit-request` **分开** —— `BD-21`：兜底曾被标成 `explicit-request`，使
 * 「系统自己顶上来的」与「有人要求的」在审计摘要里根本无法区分）。
 *
 * 🔴 兜底 ≠ 正确：若一份文档声明的是「守线 + 缩量」而缺 `recipe`，兜底会让它按
 * `leader-candidate-baseline`（涨跌幅取前 5 名）跑 —— **这就是「条件进不了回测」的机理**。
 * 因此新转正的策略**必须**在文档里带 `recipe`（由候选草稿的扩展槽提供）。
 */
export const DEFAULT_STRATEGY_RECIPE_ID = "leader-candidate-baseline";

/**
 * 门槛型配方定义（判别联合的 `gated` 支；导出以便 `conditionSignal` 构造合成配方）。
 */
export type GatedRecipeDefinition = Extract<
  StrategyRecipeDefinition,
  { readonly signalKind: "gated" }
>;

/**
 * 由「门槛 + 排序特征」构造可执行配方，**不注册进 `REGISTERED_RECIPES`**。
 *
 * 唯一消费方 = `server/research/conditionSignal/compile.ts`（STEP A-1 声明式条件编译）。
 * 走的是与注册表**同一份** `makeStrategyRecipeRuntime` ⇒ 注册期校验（排序特征 / 门槛引用面
 * 必须真实产出）与运行时行为逐字一致，不产生第二套口径。
 *
 * 之所以不注册：它由**某一份策略文档的条件**现场合成，recipeId 不表征任何全局身份；
 * 注册表只放「能真跑的全局配方」，把合成配方塞进去会让「已注册配方清单」失真。
 */
export function buildGatedRecipeRuntime(definition: GatedRecipeDefinition): StrategyRecipeRuntime {
  return makeStrategyRecipeRuntime(definition);
}