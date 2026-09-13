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

import type { CanonicalMarketBar, DecisionPoint } from "../data";
import type { ResearchParameterSchema, ResearchParameterSet } from "./types";
import type { FeatureProvider, RankingConfig, SelectionConfig } from "./framework/contract";
import type { SignalFrequency } from "./framework/contract";
import { makeBarFeatureProvider } from "./framework/featureProvider";
import { makeWeightedSignalBuilder, type SignalBuilder } from "./framework/signal";
import { makeGatedSignalBuilder, type FeatureGate } from "./framework/gatedSignal";
import {
  computeCloseReturnFromEventClose,
  computeHaircutFromEventLow,
  computeIsBullish,
  computeVolumeRatio,
  eventBaselineOf,
} from "./recipeFeatures/pullbackFeatures";
import type { StrategyRecipe } from "./strategySchema/types";
import { StrategyRecipeRuntimeError } from "./recipeErrors";

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
   * 规则：取 schema 中每个参数的 `defaultValue`；缺省值缺失 → 响亮抛错。
   * 为什么不是「让用户填」：本增量只打通链路，参数覆写属后续增量；此处保证
   * 「策略文档声明什么默认值，就以什么跑」，并且这一事实进入 `ExperimentConfig.parameters`
   * 与结果记录，可复现。
   */
  resolveParameters(schema: ResearchParameterSchema): ResearchParameterSet;
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
type StrategyRecipeDefinition = StrategyRecipeDefinitionCommon &
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

/** 当日涨跌幅特征 id / 版本（决定「按什么排序」；语义见下方 compute）。 */
export const PCT_CHANGE_FEATURE_ID = "pctChange";
export const PCT_CHANGE_FEATURE_VERSION = "1.0.0";

/**
 * 特征「当日涨跌幅」：`close / preClose − 1`。
 *
 * 口径来源：`scripts/runResearchDatasetE2E.mts` 的既有真实 E2E 特征（同一实现，不另立口径）。
 * 取窗口内**最后一根** bar（bars 已按 as-of 过滤），缺失任一价格或 preClose 为 0 → null。
 */
function computePctChange(bars: readonly CanonicalMarketBar[]): number | null {
  const last = bars[bars.length - 1];
  if (last === undefined || last.close === null || last.preClose === null || last.preClose === 0) {
    return null;
  }
  return last.close / last.preClose - 1;
}

/** 「当日涨跌幅」可用性（同点可见：决策所需数据与可用时点都是决策日同一时点）。 */
function samePointAvailability(point: DecisionPoint) {
  // availability 是绝对时点，而决策日逐日变化 —— 框架要求「必须覆盖整个决策窗口」。
  // 用「最早可能决策时点」表达会过窄，因此按框架语义用「不晚于最早决策时点」的写法：
  // 见 `framework/leakage.ts` 的 FeatureAvailability 契约（requiredDataThrough 表示
  // 该特征需要的最新数据时点，availableAt 表示该值何时可知）。
  // 逐日 PIT 数据集保证每一行的 asOf === tradeDate，因此「同点可见」是恒成立的。
  return {
    requiredDataThrough: { date: EPOCH_FLOOR_DATE, point },
    availableAt: { date: EPOCH_FLOOR_DATE, point },
  };
}

/**
 * 可用性声明的日期下界。
 *
 * 为什么是一个很早的固定日而不是动态日期：`FeatureAvailability` 是**静态绝对时点**，
 * 引擎在运行前用它做「是否覆盖整个决策窗口」的泄漏预检（见 `signalEngine/engine.ts`
 * 的 `assertValidStrategy13` 与 framework `LeakageGuard`）。这里声明「该特征不需要任何
 * 未来数据、且在决策日同点即可知」——即要求的数据不晚于任何决策日。
 * 用固定下界表达「不约束到具体某天」，与 `scripts/runResearchDatasetE2E.mts` 用首日表达的
 * 语义一致（都要求「不晚于最早决策时点」），但对任意窗口都成立。
 */
const EPOCH_FLOOR_DATE = "1990-01-01";

// ---------------------------------------------------------------------------
// 「首板回踩 · 守线 + 缩量」配方 — 特征 id / 版本 与 计算包装
// ---------------------------------------------------------------------------

/**
 * 首板回踩配方的特征 id（口径逐字对齐 `researchEngine/variables.ts` 的同名观察日变量，
 * 见 `recipeFeatures/pullbackFeatures.ts` 的对齐表）。
 */
export const PULLBACK_FEATURE_IDS = {
  /** 回撤深度：`(首板日开盘价 − 决策日最低价) / 首板日开盘价`。≤ 阈值即「守线」。 */
  haircut: "haircutFromEventLow",
  /** 量能比：`决策日成交量 / 首板日成交量`。< 1 为缩量。 */
  volumeRatio: "volumeRatio",
  /** 当日阳线（「红盘」）：决策日收盘 > 决策日开盘 取 1，否则 0。 */
  isBullish: "isBullish",
  /** 收盘相对首板日收盘涨幅（供排序）。 */
  momentum: "momentumFromEventClose",
} as const;

const PULLBACK_FEATURE_VERSION = "1.0.0";

/**
 * 构造首板回踩配方的四个特征提供器。
 *
 * 🔴 所有特征共用同一基准（`bars[0]` = 首板日）。基准缺失时**全部返回 null**
 * ⇒ 该证券不进候选（不臆造基准、不填默认值）。
 */
function buildPullbackFeatures(point: DecisionPoint): readonly FeatureProvider[] {
  const availability = samePointAvailability(point);
  const withBaseline = (
    featureId: string,
    compute: (
      bars: readonly CanonicalMarketBar[],
      baseline: NonNullable<ReturnType<typeof eventBaselineOf>>,
    ) => number | null,
  ) =>
    makeBarFeatureProvider({
      featureId,
      version: PULLBACK_FEATURE_VERSION,
      availability,
      compute: (bars) => {
        const baseline = eventBaselineOf(bars);
        if (baseline === null) return null;
        return compute(bars, baseline);
      },
    });

  return [
    withBaseline(PULLBACK_FEATURE_IDS.haircut, computeHaircutFromEventLow),
    withBaseline(PULLBACK_FEATURE_IDS.volumeRatio, computeVolumeRatio),
    // 「红盘」只读决策日当根 bar，不需要首板日基准。
    makeBarFeatureProvider({
      featureId: PULLBACK_FEATURE_IDS.isBullish,
      version: PULLBACK_FEATURE_VERSION,
      availability,
      compute: computeIsBullish,
    }),
    withBaseline(PULLBACK_FEATURE_IDS.momentum, computeCloseReturnFromEventClose),
  ];
}

/**
 * 首板回踩配方参数 id（进 `StrategyDocument.parameters`，供 Parameter Search 搜索）。
 *
 * 🔴 用户裁定「四组一起做成参数化配方」⇒ 买入时点与回撤深度都是**参数**，
 * 不同取值即不同策略变体，无需各建一个 recipeId。
 */
export const PULLBACK_PARAMETER_IDS = {
  /** 缩量阈值：量能比 ≤ 该值才算「缩量」。0.3 = ≤30%，0.5 = ≤50%。 */
  maxVolumeRatio: "max_volume_ratio",
  /** 回撤深度阈值：回撤比例 ≤ 该值才算「守线」。0.02 = 允许跌破首板日开盘价 2% 以内。 */
  maxDrawdown: "max_drawdown",
  /** 是否要求当日阳线（「红盘」）。1 = 要求，0 = 不要求。 */
  requireBullish: "require_bullish",
} as const;

/** 由参数集数值读取助手（缺失/非有限 → 响亮抛错，**不静默取默认**）。 */
function requireNumericParameter(parameters: ResearchParameterSet, name: string): number {
  const value = parameters[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StrategyRecipeRuntimeError(
      "RECIPE_PARAMETER_INVALID",
      `配方参数 \`${name}\` 必须是有限数字，实际 ${JSON.stringify(value)}（拒绝静默取默认值）。`,
    );
  }
  return value;
}

/**
 * 由运行期参数集构造「守线 + 缩量（+ 红盘）」的门槛列表。
 *
 * 语义（**AND**，顺序即短路顺序，属语义一部分）：
 *   ① `haircutFromEventLow <= maxDrawdown` —— 守线（回撤未超阈值）；
 *   ② `volumeRatio <= maxVolumeRatio` —— 缩量；
 *   ③ `isBullish >= 1` —— 红盘（仅当 `require_bullish = 1`）。
 */
function buildPullbackGates(parameters: ResearchParameterSet): readonly FeatureGate[] {
  const maxVolumeRatio = requireNumericParameter(parameters, PULLBACK_PARAMETER_IDS.maxVolumeRatio);
  const maxDrawdown = requireNumericParameter(parameters, PULLBACK_PARAMETER_IDS.maxDrawdown);
  const requireBullish = requireNumericParameter(parameters, PULLBACK_PARAMETER_IDS.requireBullish);

  const gates: FeatureGate[] = [
    { kind: "lte", featureId: PULLBACK_FEATURE_IDS.haircut, bound: maxDrawdown, label: "守线" },
    { kind: "lte", featureId: PULLBACK_FEATURE_IDS.volumeRatio, bound: maxVolumeRatio, label: "缩量" },
  ];
  if (requireBullish >= 1) {
    gates.push({ kind: "gte", featureId: PULLBACK_FEATURE_IDS.isBullish, bound: 1, label: "红盘" });
  }
  return gates;
}

/**
 * 注册表：`recipeId → 可执行配方`。
 *
 * `leader-candidate-baseline` 是既有真实链（`scripts/runResearchDatasetE2E.mts` 与
 * `server/research/strategyPersistence` 内置策略目录）使用的策略身份，故沿用同名配方。
 * `first-limit-pullback-hold-shrink` 是 2026-09-13 新增：承载「守线 + 缩量（+ 红盘）」
 * 的真实可执行条件（此前该条件**无任何配方可执行**，见 `docs/evidence/_probe_promoted_entry_conditions.mts`）。
 */
const STRATEGY_RECIPE_DEFINITIONS: readonly StrategyRecipeDefinition[] = [
  {
    recipeId: "leader-candidate-baseline",
    point: "close",
    signalFrequency: "daily",
    signalDescription: "按当日涨跌幅择优（long-only 候选研究，close 决策）",
    requiredData: ["OHLCV"],
    selectionSummary: "按当日涨跌幅由高到低取前 5 名",
    randomSeed: 7,
    signalKind: "weighted",
    features: [
      makeBarFeatureProvider({
        featureId: PCT_CHANGE_FEATURE_ID,
        version: PCT_CHANGE_FEATURE_VERSION,
        availability: samePointAvailability("close"),
        compute: computePctChange,
      }),
    ],
    defaultWeights: { [PCT_CHANGE_FEATURE_ID]: 1 },
    rankingConfig: { higherIsBetter: true },
    selectionConfig: { method: { kind: "topN", n: 5 } },
  },
  {
    recipeId: "first-limit-pullback-hold-shrink",
    point: "close",
    signalFrequency: "daily",
    signalDescription:
      "首板回踩守线 + 缩量（+ 红盘）：观察日未跌破首板日开盘价超过阈值、且量能相对首板日收缩到阈值以内",
    requiredData: ["OHLCV"],
    selectionSummary: "在满足「守线 + 缩量（+ 红盘）」的候选中，按相对首板日收盘的涨幅由高到低取前 N 名",
    randomSeed: 11,
    signalKind: "gated",
    features: buildPullbackFeatures("close"),
    buildGates: buildPullbackGates,
    rankFeatureId: PULLBACK_FEATURE_IDS.momentum,
    rankingConfig: { higherIsBetter: true },
    selectionConfig: { method: { kind: "topN", n: 5 } },
  },
];

// ---------------------------------------------------------------------------
// 注册与解析
// ---------------------------------------------------------------------------

const REGISTERED_RECIPES: ReadonlyMap<string, StrategyRecipeRuntime> = new Map(
  STRATEGY_RECIPE_DEFINITIONS.map(definition => {
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
      selectionConfig: definition.selectionConfig,
      requiredData: definition.requiredData,
      selectionSummary: definition.selectionSummary,
      randomSeed: definition.randomSeed,
      resolveParameters(schema: ResearchParameterSchema): ResearchParameterSet {
        const resolved: Record<string, unknown> = {};
        for (const parameter of schema.parameters) {
          if (parameter.defaultValue === undefined) {
            throw new StrategyRecipeRuntimeError(
              "RECIPE_PARAMETER_NO_DEFAULT",
              `配方 ${definition.recipeId}：参数 schema 中的 \`${parameter.name}\` 没有 defaultValue，` +
                `本增量不提供参数覆写入口（会在结果里留下不可复现的参数）。请在策略文档中为该参数声明 defaultValue。`,
            );
          }
          resolved[parameter.name] = parameter.defaultValue;
        }
        return resolved as ResearchParameterSet;
      },
    };
    return [definition.recipeId, runtime] as const;
  }),
);

/**
 * 门槛引用面探测（仅注册期校验用）。
 *
 * 用「覆盖两个分支的探测参数集」调 `buildGates`，把返回值里的 featureId 全收集起来。
 * 之所以要覆盖分支：`require_bullish` 会决定是否追加「红盘」门槛 ⇒ 只探测一个取值会漏掉另一支。
 */
function buildGatesProbe(definition: StrategyRecipeDefinition): readonly FeatureGate[] {
  if (definition.signalKind !== "gated") return [];
  const probeValues = [0, 1];
  const out: FeatureGate[] = [];
  for (const requireBullish of probeValues) {
    const probe: ResearchParameterSet = {};
    // 只填能影响引用面的参数；其余给 0（数值合法，仅用于让 buildGates 走完全程）。
    for (const name of Object.values(PULLBACK_PARAMETER_IDS)) probe[name] = 0;
    probe[PULLBACK_PARAMETER_IDS.requireBullish] = requireBullish;
    out.push(...definition.buildGates(probe));
  }
  return out;
}

/** 已注册的配方 id（升序；供 UI 下拉与诊断）。 */
export function registeredStrategyRecipeIds(): readonly string[] {
  return [...REGISTERED_RECIPES.keys()].sort();
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
  const runtime = REGISTERED_RECIPES.get(recipe.recipeId);
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
  const runtime = REGISTERED_RECIPES.get(recipeId);
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
 * 装配层 `requireRecipe()` 会落到本常量，事实写进 `assembly.recipeSource = "explicit-request"`。
 *
 * 🔴 兜底 ≠ 正确：若一份文档声明的是「守线 + 缩量」而缺 `recipe`，兜底会让它按
 * `leader-candidate-baseline`（涨跌幅取前 5 名）跑 —— **这就是「条件进不了回测」的机理**。
 * 因此新转正的策略**必须**在文档里带 `recipe`（由候选草稿的扩展槽提供）。
 */
export const DEFAULT_STRATEGY_RECIPE_ID = "leader-candidate-baseline";
