/**
 * 运行工作台 — 真实入参装配（从「策略 + 时间窗」到 4 个可执行阶段的真实 `ClosedLoopWiringInputs`）。
 *
 * 解决的问题（见 docs/evidence/_probe_looprun_hang.mts 的取证结论）：
 *   `researchRun.loopRun` 是**注入式**入口，只接受调用方显式声明的真实入参；而运行工作台
 *   此前只传 5 个身份字段（experimentId / strategyId / strategyVersion / dateRange /
 *   executionModel）⇒ 4 个已装配阶段的入参全缺 ⇒ 界面「运行策略」恒 0 执行、13 阶段
 *   `CL_UPSTREAM_BLOCKED`。本模块就是那次缺失的装配。
 *
 * 三条纪律（与 `closedLoopWiring` 完全一致，不得偏离）：
 *   1. **不猜不造**：每个字段都从真实来源**投影**而来 —— 数据集走 `buildResearchDataset`
 *      真构建；策略身份 / 成本模型 / 执行模型 / 初始资金 / 持仓上限走 `strategy_versions`
 *      的 `strategyDocumentJson` 真读；配方（特征 / 信号 / 排序 / 选择）来自**注册表**的
 *      真实可执行实例（`recipeId` 寻址，见 `recipeRegistry.ts`）。拿不到就**抛错**，
 *      不填缺省值冒充。
 *   2. **零 IO 之外只有两个真实 IO**：本模块自己发起两次真实读取 —— `buildResearchDataset`
 *      （真实库）与 `loadStrategyDocumentJson`（真实库）。除此之外不做任何推测性派生。
 *   3. **单一事实来源**：所有枚举常量 / 阈值 / 口径都从各自权威模块 import，禁止在本文件
 *      复制字面量（如成本模型字段、执行模型白名单、builder/schema 版本号）。
 */

import { buildResearchDataset, type ResearchDataset } from "../researchDataset";
import { baseSecurityIdOf } from "../eventIdentity";
import {
  buildResearchDatasetFromRegistry,
  readDatasetUniverseConstraint,
  resolveObservationWindow,
  RegistryDatasetBridgeError,
  type BuildDatasetFromRegistryResult,
  type DatasetUniverseConstraint,
  type ObservationWindowSpec,
} from "./datasetFromRegistry";
import type { CostModel } from "../engine/domain";
import type { ExecutionModelId } from "../backtest/types";
import { deriveDatasetUniverseId } from "../research/datasetAccess/handle";
import type { ExperimentConfig, StrategyContract } from "../research/framework/contract";
import type { Strategy13 } from "../research/signalEngine/types";
import type { SimulationConfig } from "../research/simulator/types";
import { listCorporateActionsForCodesInRange } from "../corporateActions/storage";
import {
  createCorporateActionResolver,
  type CorporateActionResolverLike,
} from "../corporateActions/resolver";
import type { ClosedLoopWiringInputs } from "../research/closedLoopWiring/types";
import { resolveStrategyRecipe, resolveStrategyRecipeById, DEFAULT_STRATEGY_RECIPE_ID, type StrategyRecipeRuntime } from "../research/recipeRegistry";
import { compileConditionRecipe } from "../research/conditionSignal";
// 9cc · PHASE-D（AR-14）—— Pattern 语义 → 策略侧的**消费点**（唯一 Expander 的执行侧出口）。
import {
  resolvePatternIdByRecipeId,
  verifyStrategyConsumption,
} from "../research/patternLibrary/strategyConsumption";
import { getDefaultFeatureRegistry } from "../strategyCore/featureRegistry";
// STRATEGY-ARCH-002 — Strategy Core 生产接线（决策引擎 + 运行留档）。
import {
  createCoreDecisionSource,
  createDatasetEventResolver,
  coreVersionFromDocument,
  type CoreDecisionSource,
  type CoreVersionFromDocumentResult,
  type EventAnchorPolicy,
} from "../strategyCore/production";
// BACKTEST-001 — Backtest Core 执行政策（G1：生产此前不传 executionRules ⇒ 涨跌停默认关闭）。
import {
  BACKTEST_EXECUTION_POLICY_VERSION,
  DEFAULT_BACKTEST_EXECUTION_POLICY,
  checkExecutionSemantics,
  describeExecutionPolicy,
  mapPositionSizing,
  toExecutionRuleSet,
} from "../backtest/context";
import { normalizeStrategyExecutionModel } from "./executionModel";
import type { StrategyDocument, StrategyDocumentInput } from "../research/strategySchema/types";
import type { ResearchParameterSet } from "../research/types";
import type { StrategyVersionRecordInput } from "../research/strategySchema/map";
import type { LifecycleConfigInput } from "./lifecycleConfig";
import { buildLifecycleConfig } from "./lifecycleConfig";
// PARAMETER-001-PRE — 性能剖析（默认关闭；`PARAM_PROFILE=1` 才生效）。
import { perfCount, perfRun, perfRunAsync } from "../observability";
import { LoopRunAssemblyError } from "./errors";
import { mapDeclaredExitPolicy } from "./exitPolicy";

export { LoopRunAssemblyError } from "./errors";

/**
 * BACKTEST-002（R-02）— 文档 `positionSizing` 声明 → 执行层仓位口径（**唯一映射实现**）。
 *
 * 为什么抽成具名纯函数：装配层此前的内联 IIFE 无法被测试直接触及，导致「声明 → 执行口径」
 * 这一步只能靠读代码确认。抽出来后测试可以逐 kind 断言，且装配层仍只调用这一份实现
 * （不产生第二套映射）。
 *
 * 映射表（**机械映射，不猜、不补默认**）：
 *   equal-weight    → EQUAL_WEIGHT
 *   fixed-fraction  → FIXED_FRACTION（带 fraction）
 *   rank-weighted   → RANK_WEIGHTED
 *   fixed-amount    → FIXED_AMOUNT（带 fixedAmount；**缺失 / ≤ 0 ⇒ 响亮抛错**）
 *   其它            → 响亮抛错（拒绝猜）
 */
export function mapDeclaredPositionSizing(declared: unknown): {
  readonly sizingMethod: "EQUAL_WEIGHT" | "FIXED_FRACTION" | "RANK_WEIGHTED" | "FIXED_AMOUNT" | "FIXED_RATIO" | "RISK_BASED";
  readonly fraction: number | null;
  readonly fixedAmount: number | null;
} {
  const sizing = (declared ?? {}) as {
    readonly kind?: string;
    readonly fraction?: number;
    readonly fixedAmount?: number;
  };
  switch (sizing.kind) {
    case "equal-weight":
      return { sizingMethod: "EQUAL_WEIGHT", fraction: null, fixedAmount: null };
    case "fixed-fraction":
      return {
        sizingMethod: "FIXED_FRACTION",
        fraction: typeof sizing.fraction === "number" ? sizing.fraction : null,
        fixedAmount: null,
      };
    case "rank-weighted":
      return { sizingMethod: "RANK_WEIGHTED", fraction: null, fixedAmount: null };
    case "fixed-amount": {
      // 金额必须为正数（文档校验也会拒，这里再兜一层：避免绕过校验的文档把
      // 「无金额的固定金额」带进执行层 ⇒ 静默退化成等权预算）。
      const amount = sizing.fixedAmount;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        throw new LoopRunAssemblyError(
          "LOOP_RUN_ASSEMBLY_POSITION_SIZING_AMOUNT_INVALID",
          "装配层：fixed-amount 需要正的 fixedAmount（元），实际 " +
            JSON.stringify(amount ?? null) +
            " —— 拒绝静默退化为等权预算。",
        );
      }
      return { sizingMethod: "FIXED_AMOUNT", fraction: null, fixedAmount: amount };
    }
    default:
      throw new LoopRunAssemblyError(
        "LOOP_RUN_ASSEMBLY_UNKNOWN_POSITION_SIZING",
        "装配层：未知的仓位声明 kind=" + JSON.stringify(sizing.kind ?? null) +
          "（已登记：equal-weight / fixed-fraction / rank-weighted / fixed-amount）—— 拒绝猜。",
      );
  }
}

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

/** 运行工作台「真实跑通」请求（由 `loopRun` 透传；不含任何派生值）。 */
export interface AssembleRunWorkbenchInputsRequest {
  /** 策略身份（与前端一致）。 */
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 决策窗口（闭区间，YYYY-MM-DD）。 */
  readonly startDate: string;
  readonly endDate: string;
  /** 创建时间（ISO-8601；与被编排的 run 同源，避免同一请求内两套时间口径）。 */
  readonly createdAt: string;
  /** 代码版本（注入式；未解析时传 "unknown"，本层不自行读 package.json / git）。 */
  readonly codeVersion: string;
  /**
   * 策略文档（**真实读取** `strategy_versions.strategyDocumentJson` 的结果）。
   *
   * 显式传入而不是本模块自己查库：这样「读哪一版」由 router 决定（唯一入参来源），
   * 本模块保持纯装配（除数据集构建外零 IO）。
   */
  readonly strategyDocument: StrategyDocument;
  /**
   * 已绑定的 Dataset Registry 坐标（`dataset_version.id`，来自策略文档
   * `definition.datasets[PRIMARY].datasetVersionId`）。
   *
   * 给了就**优先直读**已落库 `ds_*` 数据集（`buildResearchDatasetFromRegistry`），
   * 不再从零重算 —— 这是「运行时应消费被绑定的数据集」的落地；
   * 缺省 / 直读失败（非 READY、体系不支持、超行数护栏）才回落 `buildResearchDataset`。
   * 回落事实会如实写进 `assembly.datasetSource` + `assembly.datasetSourceNote`。
   */
  readonly datasetVersionId?: number;
  /** 数据源策略：`prefer-registry`（默认，优先直读）| `rebuild`（强制重建，用于对照/排障）。 */
  readonly datasetSourcePolicy?: DatasetSourcePolicy;
  /**
   * **注入已构建数据集**（给定时跳过一切解析 —— 直读与重建都不做）。
   *
   * 用途：参数搜索 / 走查 / 稳健性检验要在**同一份数据**上跑 N 组参数组合。
   * 每次都重新解析的代价是「分钟级重建 × N」（见 `PROJECT_RULES.md` 的运行工作台性能账），
   * 因此这些场景必须先建一次、再复用 N 次。
   *
   * 🔴 复用时 `assembly.datasetSource` 会**如实**标成 `injected`，不会伪装成 `registry` / `rebuild`。
   */
  readonly researchDataset?: ResearchDataset;
  /**
   * 数据集护栏（对齐 `buildResearchDataset` 选项；用于「先小步验证再放大」）。
   * 缺省不限，与既有 `researchDataset.build` 端点口径一致。
   */
  readonly dataReady?: boolean;
  readonly maxTradingDays?: number;
  readonly maxSecuritiesPerDay?: number;
  /**
   * 显式指定的执行配方 id（**仅当策略文档既没有 `recipe`、也没有声明式条件时生效**）。
   *
   * 「按哪个配方跑」是必须被声明的事实。缺省用 `DEFAULT_STRATEGY_RECIPE_ID`
   * （显式常量，不是猜测），并把来源写进 `assembly.recipeSource`。
   *
   * ⚠️ 2026-09-17 实查更正：本段旧文案写「库里既有策略文档都还没有 recipe 字段」，与事实不符 ——
   * 10 份文档里 7 份**已带** `recipe`（`first-limit-pullback-hold-shrink`），
   * 1 份（`strategy_versions#390001`）无 `recipe` 但**声明了条件**（走声明式条件编译路径），
   * 2 份 `limit-up-baseline` 既无 `recipe` 也无条件（这才是真正的兜底路径）。
   */
  readonly recipeId?: string;
  /**
   * 本次运行的**参数覆写**（缺省 = 全部取策略文档的 `defaultValue`）。
   *
   * 用途：参数搜索 / 走查 / 稳健性检验需要在**同一份策略**上跑不同参数组合；
   * 没有这个入口时，那些功能只能另接一套 legacy 回测（= 审计报告 P0-2 缺陷）。
   *
   * 🔴 覆写键必须**存在于** `document.parameters`，否则 `resolveParameters` 抛
   * `RECIPE_PARAMETER_UNKNOWN` —— 拒绝「以为某维度参与了寻优、实际被丢掉」。
   */
  readonly parameterOverrides?: ResearchParameterSet;
  /** 生命周期推进配置（finalize 阶段；缺省不注入 ⇒ 编排器以 CL_LIFECYCLE_CONFIG_MISSING 阻塞）。 */
  readonly lifecycle?: AssembleLifecycleRequest | null;
}

/** finalize 阶段的调用方输入（真实回测产物指纹由装配层回填）。 */
export interface AssembleLifecycleRequest {
  readonly lifecycleRecord: LifecycleConfigInput["lifecycleRecord"];
  readonly transition: LifecycleConfigInput["transition"];
  readonly allowSyntheticEvidence?: boolean;
}

/** 装配结果（除注入入参外，附带「本次到底装了什么」的可审计摘要）。 */
export interface AssembleRunWorkbenchInputsResult {
  readonly inputs: ClosedLoopWiringInputs;
  readonly dataset: ResearchDataset;
  readonly assembly: LoopRunAssemblySummary;
  /**
   * STRATEGY-ARCH-002 — 策略侧装配产物（含 Core 决策源；**非序列化**）。
   *
   * 为什么要出网到调用方：运行留档（`strategyRun`）必须在**运行结束后**才能组（决策摘要在跑完才有），
   * 而它需要的 Core 版本对象 / 决策源 / 事件判定器都住在策略侧 ⇒ 不暴露就只能在路由层重建一份
   * （= 第二套装配）。
   */
  readonly side: AssembledStrategySide;
}

/** 装配摘要（供前端如实展示「数据从哪来、规模多大」，不参与任何计算）。 */
export interface LoopRunAssemblySummary {
  readonly datasetVersion: string;
  readonly datasetGate: string;
  readonly datasetRowCount: number;
  readonly datasetSecretCount: number;
  /**
   * 数据来源：`registry`（直读已绑定 ds_* 数据集）| `rebuild`（从零重建）|
   * `injected`（调用方注入的已构建数据集，同一份被多次复用）。
   * 前端据此如实展示「本次跑的是哪份数据」，绝不让重建 / 复用伪装成「用了你绑定的数据集」。
   */
  readonly datasetSource: DatasetSourceKind;
  /** 直读失败并回落重建时的原因（`rebuild` 且为直读失败所致时非 null）。 */
  readonly datasetSourceNote: string | null;
  /** 直读命中时回填：已落库数据集坐标（`dataset_version.id`）。 */
  readonly datasetVersionId: number | null;
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly recipeId: string;
  /**
   * 配方来源（**四条**诚实路径）：`strategy-document`（文档带 recipe）|
   * `strategy-declarative-conditions`（文档无 recipe，由 `definition.entry.conditions` 现场合成）|
   * `explicit-request`（**调用方显式指定** recipeId）|
   * `default-fallback`（文档既无 recipe 又无条件 ⇒ 落到默认常量；见 `BD-21`）。
   */
  readonly recipeSource: RecipeResolutionSource;
  readonly recipeFeatureIds: readonly string[];
  readonly selectionSummary: string;
  /**
   * STRATEGY-ARCH-002 — **本次运行的策略判定引擎**。
   *
   * - `strategy-core`：判定由 `StrategyRuntime.evaluate` 产出（Core 为唯一执行入口）；
   * - `legacy-recipe`：Core 定义无法从该文档构造（如存量 `limit-up-baseline` 缺 `definition` 段）
   *   ⇒ 回落既有配方判定器，**原因写在 `strategyDecisionEngineNote`，绝不静默**。
   */
  readonly strategyDecisionEngine: "strategy-core" | "legacy-recipe";
  readonly strategyDecisionEngineNote: string;
  readonly simulation: {
    readonly initialCapital: number;
    readonly maxPositions: number | null;
    readonly maxDailyBuys: number | null;
    readonly executionModel: string;
    readonly costModel: CostModel;
  };
}

// ---------------------------------------------------------------------------
// 成本模型 / 执行模型（一律取自策略文档，不在此处给缺省值）
// ---------------------------------------------------------------------------

/**
 * 取策略文档里冻结的成本模型。
 *
 * 为什么不做缺省：成本模型直接决定回测收益率，任何「没有就抹一个常用值」都会让
 * 结论失去可复现性。策略文档里必然有（`StrategyExecutionAssumptions.costModel` 为必填）。
 */
function requireCostModel(document: StrategyDocument): CostModel {
  const cost = document.executionAssumptions?.costModel;
  if (cost === undefined || cost === null) {
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_MISSING_COST_MODEL",
      `装配层：策略 ${document.strategyId}@${document.version} 的策略文档缺少 executionAssumptions.costModel，` +
        `无法装配回测成本口径（本层不提供缺省值）。请在策略编辑器中补齐成本模型后重新保存版本。`,
    );
  }
  return cost;
}

/** 取执行模型（归一化为 backtest 的 ExecutionModelId；未知写法响亮抛错）。 */
function requireExecutionModel(document: StrategyDocument): ExecutionModelId {
  const raw = document.executionAssumptions?.executionModel;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_MISSING_EXECUTION_MODEL",
      `装配层：策略 ${document.strategyId}@${document.version} 的策略文档缺少 executionAssumptions.executionModel。`,
    );
  }
  return normalizeStrategyExecutionModel(raw);
}

// ---------------------------------------------------------------------------
// 配方（特征 / 信号 / 排序 / 选择）
// ---------------------------------------------------------------------------

/**
 * 配方来源（进审计摘要：让人一眼看出「这次按哪个配方跑的、这个配方是哪儿来的」）。
 *
 * 🔴 `explicit-request` 与 `default-fallback` 必须**分开**（2026-09-21 · `BD-21`）：
 * 两者此前**共用** `explicit-request` ⇒ 「调用方明确要求按 A 跑」与「文档什么都没声明、
 * 系统自己拿默认配方顶上」在摘要里**长得一模一样**，且后者是**静默换规则** ——
 * 产物看起来完全正常，跑的规则却与策略文档无关（参数搜索会把结果记在一个
 * **根本没被执行**的策略定义名下）。拆开后「是否发生兜底」一眼可辨。
 *
 * ⚠️ 第三 / 第四值必须与 `shared/researchContracts.ts` 的 zod 闭集同步，
 * 否则 tRPC `.output()` 会拒值。
 */
export type RecipeResolutionSource =
  | "strategy-document"
  | "strategy-declarative-conditions"
  | "explicit-request"
  | "default-fallback";

// ---------------------------------------------------------------------------
// 数据来源（进审计摘要：让人一眼看出「这次跑的是哪份数据」）
// ---------------------------------------------------------------------------

/**
 * 数据来源：
 *   - `registry`：直读策略已绑定的已落库 `ds_*` 数据集；
 *   - `rebuild`：按窗口从零重建（分钟级）；
 *   - `injected`：**调用方注入的已构建数据集**（同一份数据被多次复用，未重新解析）。
 *
 * 🔴 之所以单列 `injected` 而不是复用 `rebuild`：参数搜索 / 走查要在同一份数据上跑 N 组参数，
 * 若每次都重新解析，代价是分钟级 × N；而复用事实若伪装成 `rebuild`，审计时无法分辨
 * 「这份数据是本次刚建的」还是「被复用的」—— 那正是最不该含糊的地方。
 */
export type DatasetSourceKind = "registry" | "rebuild" | "injected";

/** 数据源策略：优先直读（默认）/ 强制重建。 */
export type DatasetSourcePolicy = "prefer-registry" | "rebuild";

/**
 * 解析数据集：优先直读已绑定 `datasetVersionId` 的已落库 `ds_*` 数据集；
 * 直读不可用（未绑定 / 非 READY / 体系不支持 / 超护栏 / **策略未声明观察窗口** /
 * 观察窗口超出该数据集 post 上限 / DB 不可用）→ 回落从零重建。
 *
 * 🔴 **2026-09-14：直读桥已能支撑撮合，「回落」不再是常态**（这是对 2026-09-13 §「不可撮合
 * 必回落」的收口）。旧桥只投影 `prefix` 的 rd=0 ⇒ 任何证券在其事件日之外没有行 ⇒
 * 交易模拟在决策日下一交易日取不到行情 ⇒ 全部拒单（实测 59 单全 `SUSPENDED`、
 * 0 成交、曲线恒平），因此当时只能回落。现在桥按策略声明的观察窗口把
 * rd=0（首板日，特征基准）+ rd ∈ [1, end+1]（观察日 + 次日执行日）一并投影为**逐日面板**
 * ⇒ `executionBarsAvailable === true` ⇒ 运行**真正消费被绑定的数据集**，不再回查
 * `stock_daily_prices` / `liquidity_daily`。
 *
 * 仍保留回落（且**只在下列可预期情形**触发，原因如实写进 `datasetSourceNote`）：
 *   - `REGISTRY_OBSERVATION_WINDOW_UNDECLARED` —— 策略文档没有 `definition` /
 *     `entry.observationWindow`（如 `limit-up-baseline` 这类 legacy 文档）⇒ 桥不知道要投影
 *     多少 T+N，**不代猜**；
 *   - `REGISTRY_OBSERVATION_WINDOW_INVALID` / `REGISTRY_POST_WINDOW_TOO_SHORT` —— 声明非法，
 *     或声明的窗口超出该数据集 post 的容量（夹取 = 悄悄改窄策略，故拒绝）；
 *   - `REGISTRY_VERSION_NOT_FOUND` / `NOT_READY` / `DEFINITION_MISSING` /
 *     `DATASET_CODE_UNSUPPORTED` / `EMPTY_VERSION` / `POST_WINDOW_MISSING` /
 *     `ROW_BUDGET_EXCEEDED` —— 数据集本身不可用；
 *   - `REGISTRY_SECURITY_IDENTITY_UNRESOLVED` —— 事件 symbol 无法在其 tradeDate 桥接到唯一
 *     canonical `sec_<uuid>`（无生效标识符 / 多段歧义）。**不退回用代码冒充身份**（那会让
 *     成交明细与留档的键域和重建路径分叉），故回落重建；
 *   - `REGISTRY_WINDOW_ROW_CONFLICT` —— 同一 `(securityId, tradeDate)` 的多个事件来源给出
 *     不一致的严格列（OHLCV/量额）⇒ 拒绝编造取舍，回落重建。
 *
 * 除 `RegistryDatasetBridgeError`（可预期的「不该直读」情形）外，其他错误一律上抛 ——
 * 不能把代码 bug 伪装成「直读不可用」。
 */
async function resolveDataset(
  request: AssembleRunWorkbenchInputsRequest,
): Promise<{
  dataset: ResearchDataset;
  source: DatasetSourceKind;
  sourceNote: string | null;
  registry: BuildDatasetFromRegistryResult | null;
}> {
  // 🔴 注入路径优先：调用方已构建好数据集（参数搜索 / 走查等需要在同一份数据上跑 N 组参数）
  //    ⇒ 直接复用，并**如实**标记来源。放在最前面：注入时不重新解析，也不需要观察窗口。
  if (request.researchDataset !== undefined) {
    return {
      dataset: request.researchDataset,
      source: "injected",
      sourceNote:
        "调用方注入的已构建数据集（同一份数据被多次复用，未重新解析）—— 参数搜索 / 走查等场景的正常路径。",
      registry: null,
    };
  }

  const policy: DatasetSourcePolicy = request.datasetSourcePolicy ?? "prefer-registry";
  const boundId = request.datasetVersionId;

  /**
   * 🔴 策略声明的观察窗口 ⇒ 直读桥投影多少 T+N 行情。
   *
   * **必须来自策略文档**（`definition.entry.observationWindow`）：它同时决定
   * ①哪些行情进面板（rd=0 + rd ∈ [1, end+1]，撮合可行性的来源）、
   * ②哪些交易日有决策日资格（rd ∈ [start, end]，候选产生的位置）。
   *
   * 解析失败（值存在但非法）会抛 `REGISTRY_OBSERVATION_WINDOW_INVALID`；未声明返回 null，
   * 桥会以 `REGISTRY_OBSERVATION_WINDOW_UNDECLARED` 拒绝直读 ⇒ 均回落重建并如实记录原因。
   * 本层**不给缺省窗口**（代猜窗口 = 让数据面与策略声明不一致）。
   */
  const observationWindow: ObservationWindowSpec | null = resolveObservationWindow(
    request.strategyDocument.definition?.entry?.observationWindow,
  );

  if (policy === "prefer-registry" && boundId !== undefined) {
    try {
      const registry = await buildResearchDatasetFromRegistry({
        datasetVersionId: boundId,
        name: `run-workbench-${request.strategyId}-${request.startDate}_${request.endDate}`,
        observationWindow,
        ...(request.dataReady !== undefined ? { dataReady: request.dataReady } : {}),
      });
      if (registry.executionBarsAvailable) {
        return { dataset: registry.dataset, source: "registry", sourceNote: null, registry };
      }
      // 直读成功但**不可撮合**（本桥当前只在「读不到 post 行」时走到这里）：按契约回落重建。
      // 🔴 回落前先继承该数据集的 universe 约束（板块 / ST）：重建默认是全市场证券池。
      const constraint = await readDatasetUniverseConstraint(boundId);
      const rebuilt = await rebuildDataset(request, constraint);
      return {
        dataset: rebuilt,
        source: "rebuild",
        sourceNote:
          `直读成功但该数据集不可用于撮合（dataset_version.id=${registry.version.id} / ` +
          `${registry.stats.rowCount} 行）：读不到可执行的 T+N 行情（post 行为空）` +
          `⇒ 交易模拟在决策日下一交易日取不到行情，订单会被全部拒为 SUSPENDED（0 成交、曲线恒平）。` +
          `已回落 buildResearchDataset 重建逐日面板。` +
          constraintNote(constraint),
        // 保留 registry：装配摘要须仍能显示「策略绑定的是哪个 dataset_version.id」，
        // 否则界面会误读成「这个策略根本没绑数据集」。本次**实际使用**的面板由
        // source=rebuild 与 sourceNote 表达。
        registry,
      };
    } catch (error) {
      if (!(error instanceof RegistryDatasetBridgeError)) throw error;
      // 可预期的「不该直读」：如实记录原因，回落重建（不静默、不冒充）。
      const constraint = await readDatasetUniverseConstraint(boundId);
      const rebuilt = await rebuildDataset(request, constraint);
      return {
        dataset: rebuilt,
        source: "rebuild",
        sourceNote:
          `直读已绑定数据集失败（${error.code}）：${error.message}` + constraintNote(constraint),
        registry: null,
      };
    }
  }

  // 走到这里说明「未直读」：可能是显式强制重建、未绑定、或已绑定但被上面的分支处理。
  // 只要**绑定了** datasetVersionId，仍要继承它的 universe 约束（强制重建不该改变证券范围）。
  const constraint = boundId === undefined ? null : await readDatasetUniverseConstraint(boundId);
  const rebuilt = await rebuildDataset(request, constraint);
  return {
    dataset: rebuilt,
    source: "rebuild",
    sourceNote:
      policy === "rebuild"
        ? "调用方显式指定 datasetSourcePolicy=rebuild（强制重建，未直读已绑定数据集）。" +
          constraintNote(constraint)
        : boundId === undefined
          ? "策略文档未绑定 datasetVersionId（无已落库数据集可直读），按窗口从零重建。"
          : null,
    registry: null,
  };
}

/**
 * 把「本次重建继承了什么 universe 约束」写进审计说明（可审计，不靠猜）。
 *
 * 🔴 无约束时**必须明说**：那是一句「本次跑的是全板块」的诚实声明 —— 否则用户会以为
 * 结果仍然出自他绑定的主板数据集。
 */
function constraintNote(constraint: DatasetUniverseConstraint | null): string {
  if (constraint === null) {
    return "本次重建未继承任何板块约束（数据源未声明）⇒ 证券池为全板块（含创业板 300/301、科创板 688、北交所）。";
  }
  const parts: string[] = [];
  if (constraint.boards.length > 0) parts.push(`板块=${[...constraint.boards].sort().join("/")}`);
  if (constraint.excludeSt) parts.push("排除 ST/*ST");
  if (parts.length === 0) {
    return `本次重建沿用该数据集声明的 universe 约束：未限定板块、不排除 ST ⇒ 证券池为全板块（来源=${constraint.source}）。`;
  }
  return `本次重建已继承该数据集的 universe 约束：${parts.join("、")}（来源=${constraint.source}）。`;
}

/**
 * 从零重建数据集（原路径；窗口 = 调用方给的决策窗口）。
 *
 * 🔴 `constraint` = **从已绑定数据集继承的 universe 约束**（板块 / ST），必须继承：
 * 重建路径的默认证券池是**全市场**，不继承就等于把「用户绑定的主板数据集」**悄悄换成**
 * 全市场面板。实测（2026-09-14）：`dataset_version.id=390002` 声明 `boards:["main"]`，
 * 回落重建却产出 `datasetSecurityCount=5146` 且成交明细含 300/301/688 标的。
 *
 * 无约束（`null` / 全空）时**不传** `universeFilter` —— 与既有行为及版本指纹保持一致。
 */
function rebuildDataset(
  request: AssembleRunWorkbenchInputsRequest,
  constraint: DatasetUniverseConstraint | null,
): Promise<ResearchDataset> {
  const base = {
    name: `run-workbench-${request.strategyId}-${request.startDate}_${request.endDate}`,
    startDate: request.startDate,
    endDate: request.endDate,
    asOfPerTradeDate: true,
  };
  const narrowed =
    constraint !== null && (constraint.boards.length > 0 || constraint.excludeSt)
      ? {
          ...base,
          universeFilter: { boards: [...constraint.boards], excludeSt: constraint.excludeSt },
        }
      : base;
  return buildResearchDataset(narrowed, {
    ...(request.dataReady !== undefined ? { dataReady: request.dataReady } : {}),
    ...(request.maxTradingDays !== undefined ? { maxTradingDays: request.maxTradingDays } : {}),
    ...(request.maxSecuritiesPerDay !== undefined
      ? { maxSecuritiesPerDay: request.maxSecuritiesPerDay }
      : {}),
  });
}

/**
 * 由策略文档解析**真实可执行**配方（三条诚实路径，优先级自上而下）：
 *
 *   1. 文档带 `recipe` ⇒ 按注册表解析（既有链，不改）；
 *   2. 文档不带 `recipe`，但 `definition.entry.conditions` **声明了条件** ⇒
 *      现场编译成执行门槛（`compileConditionRecipe`）—— 这是「声明与执行同源」；
 *   3. 两者都没有 ⇒ 调用方显式指定（`explicit-request`）/
 *      显式默认常量（`default-fallback`）—— 两条**分别留痕**，绝不伪装成「文档声明」。
 *
 * 🔴 路径 2 的存在理由（修复「条件进不了回测」）：此前「无 recipe 但有条件」会静默落到
 * `DEFAULT_STRATEGY_RECIPE_ID`（涨跌幅加权取前 5 名），让「守线 + 缩量」的文档实际跑成
 * 另一个模式 —— 产物看起来完全正常，是最难发现的那种错。
 * 现在该分支**真编译**；编译不出来就**响亮抛错并逐条列出**，绝不回落默认配方。
 *
 * 🔴 顺序约束（零回归，勿调换）：路径 1 必须先于路径 2。库里 8 份 `cand-3600xx` 文档
 * `hasRecipe=true`（recipeId=first-limit-pullback-hold-shrink），而它们的 conditions 里
 * 存有转正期遗留的**字符串常量**（`"prefix.rd0.volume * 0.3"`，现行 schema 下已是死写法）。
 * 若把条件编译提到 recipe 之前，这 8 份会从「能跑」变成「一跑就报错」。
 */
function requireRecipe(
  document: StrategyDocument,
  explicitRecipeId: string | undefined,
): { runtime: StrategyRecipeRuntime; source: RecipeResolutionSource } {
  const recipe = document.recipe;
  if (recipe !== undefined && recipe !== null) {
    return { runtime: resolveStrategyRecipe(recipe), source: "strategy-document" };
  }

  // -- 路径 2：文档没带 recipe，但**声明了条件** ⇒ 现场编译（不回落默认配方）--
  //    只判「有没有条件」，「有没有**启用**的条件」由编译器唯一裁定（禁两套口径）。
  const declaredConditions = document.definition?.entry.conditions ?? [];
  if (declaredConditions.length > 0) {
    return {
      runtime: compileConditionRecipe({
        strategyId: document.strategyId,
        strategyVersion: document.version,
        conditions: declaredConditions,
        parameters: document.parameters,
      }),
      source: "strategy-declarative-conditions",
    };
  }

  // -- 路径 3：既无 recipe 又无条件 ⇒ 两条诚实兜底，事实都进 `assembly.recipeSource` --
  if (explicitRecipeId !== undefined && explicitRecipeId.trim().length > 0) {
    return { runtime: resolveStrategyRecipeById(explicitRecipeId), source: "explicit-request" };
  }
  // 🔴 `BD-21`：走到这里时**没有任何人**要求按默认配方跑 —— 是系统自己顶上来的。
  // 此前它被标成 `explicit-request`（语义 =「调用方明确要求」），于是「静默换规则」
  // 在审计摘要里**根本看不见**。现在单列 `default-fallback` 并**响亮留痕**：
  //   ⒜ 结构化字段 `assembly.recipeSource = "default-fallback"`（可检索、可断言）；
  //   ⒝ 本行 stderr 日志（人看得见）。
  // ⚠️ 这里刻意打日志而不新增 schema 字段：`recipeSource` + `recipeId`（=落到的配方）
  //   两个既有字段已构成完整溯源；再加一个 note 字段属重复表达。
  // ⚠️ 日志放在**唯一判定点**（本函数）而不是调用方 —— `assembleStrategySide` 被
  //   主入口与 `strategyEvaluation` 两条路径共用，放在调用方必漏其中一条。
  // 实测（2026-09-21）：库里 `limit-up-baseline` 2 份文档走的**正是**这条路径。
  console.warn(
    `[RunWorkbenchAssembly] 策略 ${document.strategyId}@${document.version} 的文档` +
      `既没有 recipe、也没有 definition.entry.conditions ⇒ 装配层兜底到默认配方 ` +
      `"${DEFAULT_STRATEGY_RECIPE_ID}"（assembly.recipeSource="default-fallback"）。` +
      `这不是调用方指定的配方；若不符合预期，请在策略文档里声明 recipe 或声明式条件。`,
  );
  return {
    runtime: resolveStrategyRecipeById(DEFAULT_STRATEGY_RECIPE_ID),
    source: "default-fallback",
  };
}

// ---------------------------------------------------------------------------
// 装配主流程
// ---------------------------------------------------------------------------

/**
 * STRATEGY-ARCH-002 — 策略运行上下文（**非序列化**；留在内存侧供 `loopRun` 落 Run Record）。
 *
 * 为什么不放进 `LoopRunAssemblySummary`：摘要要经由 tRPC 契约（zod）出网，
 * 而这里带着 `CoreDecisionSource`（闭包）与 Core 版本对象。落库走
 * `strategyCore/production/runRecord.ts`，摘要只出「用了哪个引擎」这类可序列化事实。
 */
export interface StrategyRunContext {
  readonly engine: "strategy-core" | "legacy-recipe";
  readonly note: string;
  readonly coreDecisionSource: CoreDecisionSource | null;
  readonly coreVersion: CoreVersionFromDocumentResult | null;
  readonly point: "close" | "open";
  readonly anchorPolicy: EventAnchorPolicy;
  readonly eventTypes: readonly string[];
  readonly limitUpRatio: number | null;
  readonly universeId: string;
}

/**
 * 「策略侧」装配产物（**全部同步可得**，不含任何数据集内容）。
 */
export interface AssembledStrategySide {
  readonly recipeRuntime: StrategyRecipeRuntime;
  readonly recipeSource: RecipeResolutionSource;
  readonly parameterSet: ResearchParameterSet;
  readonly costModel: CostModel;
  readonly executionModel: ExecutionModelId;
  readonly strategyContract: StrategyContract;
  readonly strategy13: Strategy13;
  readonly experimentConfig: ExperimentConfig;
  readonly simulationConfig: SimulationConfig;
  readonly strategyDocumentInput: StrategyDocumentInput;
  readonly strategyVersionRecordInput: StrategyVersionRecordInput;
  readonly lifecycle: ClosedLoopWiringInputs["lifecycle"] | undefined;
  /** STRATEGY-ARCH-002 — 判定引擎与运行留档所需的非序列化上下文。 */
  readonly strategyRunContext: StrategyRunContext;
}

/**
 * **同步**装配「策略侧」全部入参（**完全不碰数据集**）。
 *
 * 🔴 存在的理由（STEP B 落点③ 的解锁点）：闭环的 `ClosedLoopStageExecutor` 与
 * `parameterSearch` / `robustness` 的 `evaluator` **都是同步**的，而本模块的
 * `assembleRunWorkbenchInputs` 只是因为**数据集解析**（`resolveDataset`，可能是分钟级重建）
 * 才是 `async`。把这层剥出来后，闭环内的「参数集 → 绩效标量」评估器就能**同步**装配，
 * 而不必手写第二条 `dataset→signalEngine→simulator→evaluate` 子链 ——
 * 那正是 `requirements.ts` 拒绝为 `optimization`/`robustness`/`oos`/`overfitting` 接线的理由。
 *
 * ⚠️ `assembleRunWorkbenchInputs` 必须调本函数（唯一实现，**禁复制第二份**）。
 *
 * @param request       与主入口同一份请求（本函数不读其数据集相关字段）。
 * @param datasetVersion 数据集内容指纹 —— `experimentConfig.datasetVersion` 需要它，
 *                       由调用方从已解析的数据集传入（本函数自己不做任何数据集解析）。
 */
export function assembleStrategySide(
  request: AssembleRunWorkbenchInputsRequest,
  datasetVersion: string,
): AssembledStrategySide {
  // -- 2. 策略文档：身份必须与请求一致（防「读错版本」这种最危险的静默错误）--
  const document = request.strategyDocument;
  if (document.strategyId !== request.strategyId) {
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_STRATEGY_MISMATCH",
      `装配层：策略文档 strategyId=${document.strategyId} 与请求 ${request.strategyId} 不一致（拒绝用错版本文档装配）。`,
    );
  }
  if (document.version !== request.strategyVersion) {
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_STRATEGY_MISMATCH",
      `装配层：策略文档 version=${document.version} 与请求 ${request.strategyVersion} 不一致（拒绝用错版本文档装配）。`,
    );
  }

  const costModel = requireCostModel(document);
  const executionModel = requireExecutionModel(document);
  const { runtime: recipeRuntime, source: recipeSource } = requireRecipe(document, request.recipeId);

  // 🔴 参数集必须**先**解析，再据此构造信号构造器。
  // 顺序理由（2026-09-13）：门槛型配方（「守线 + 缩量 ≤ X%」）的门槛值来自策略文档参数，
  // 若先建构造器再解析参数，就会「文档声明 0.3、实际按登记时常量跑」= 口径漂移。
  // 参数集同时喂 experimentConfig 与 §17 版本记录 —— 两处必须是同一份，只解析一次。
  const parameterSet = recipeRuntime.resolveParameters(document.parameters, request.parameterOverrides);

  // -- 3. 装配四入参 --
  const strategyContract: StrategyContract = {
    strategyId: document.strategyId,
    strategyVersion: document.version,
    name: document.name,
    ...(document.description !== undefined ? { description: document.description } : {}),
    parameters: document.parameters,
    requiredData: recipeRuntime.requiredData,
    signalFrequency: recipeRuntime.signalFrequency,
  };

  // ------------------------------------------------------------------
  // STRATEGY-ARCH-002 — 策略判定引擎：Strategy Core 优先（**唯一执行入口**）
  //
  // 契约：策略「要不要出信号」这件事由 `StrategyRuntime.evaluate` 决定。
  // 装配层只做三件事：把落库文档翻译成 Core 版本（`coreVersionFromDocument`）、
  // 按数据集事件源构造事件判定器、把 Core 决策源接到既有的 `strategy13.signalBuilder` 槽位。
  //
  // 🔴 回落是**例外而非常态**，且必须带原因出网：
  //    存量 `limit-up-baseline`（2 份）文档没有 `definition` 段 ⇒ 无法构造 Core 定义。
  //    此时继续用既有配方判定器，并把原因写进 `assembly.strategyDecisionEngineNote`。
  // ------------------------------------------------------------------
  const legacySignalBuilder = recipeRuntime.buildSignalBuilder(parameterSet);
  const coreVersionResult = coreVersionFromDocument({
    document,
    createdAt: request.createdAt,
  });

  let coreDecisionSource: CoreDecisionSource | null = null;
  let strategyDecisionEngine: "strategy-core" | "legacy-recipe" = "legacy-recipe";
  let strategyDecisionEngineNote: string;

  if (!coreVersionResult.ok) {
    strategyDecisionEngineNote =
      "Core 定义不可构造（" + coreVersionResult.reason + "）：" + coreVersionResult.detail +
      " ⇒ 本次回落既有配方判定器（" + recipeRuntime.recipeId + "）。";
  } else {
    const eventTypes = coreVersionResult.eventType === null ? [] : [coreVersionResult.eventType];
    if (eventTypes.length === 0) {
      strategyDecisionEngineNote =
        "Core 定义可构造，但文档未声明事件类型 ⇒ 事件判定器不参与（纯条件策略）。";
    } else {
      strategyDecisionEngineNote =
        "Core 定义可构造（事件 " + eventTypes.join("、") + "）⇒ 事件判定器由本层按数据集事件源注入。";
    }
    try {
      // 事件源声明：本层是唯一知道「这份数据集是不是事件窗」的层（它绑定了 dataset 坐标）。
      // 数据集与策略都来自同一份已落库文档 + 已绑定 datasetVersionId ⇒ 声明为事件窗。
      const eventResolver =
        eventTypes.length === 0
          ? undefined
          : createDatasetEventResolver({
              eventAnchored: true,
              eventTypes,
              limitUpRatio: coreVersionResult.limitUpRatio,
              declaredBy:
                "runWorkbenchAssembly：策略文档 " + document.strategyId + "@" + document.version +
                " 声明事件类型，" + (request.datasetVersionId !== undefined
                  ? "且已绑定 datasetVersionId=" + String(request.datasetVersionId)
                  : "数据集由本层解析"),
            });
      coreDecisionSource = createCoreDecisionSource({
        version: coreVersionResult.version,
        parameterSet,
        rankFeatureId: recipeRuntime.rankFeatureId,
        rankValueOf: recipeRuntime.rankValueOf,
        point: recipeRuntime.point,
        ...(eventResolver !== undefined ? { eventResolver } : {}),
        ...(eventTypes.length > 0 ? { eventTypes } : {}),
      });
      strategyDecisionEngine = "strategy-core";
    } catch (error) {
      const detail = error instanceof Error ? error.name + ": " + error.message : String(error);
      coreDecisionSource = null;
      strategyDecisionEngineNote =
        "Core 决策源构造失败（" + detail + "）⇒ 本次回落既有配方判定器（" + recipeRuntime.recipeId + "）。";
    }
  }

  const strategy13: Strategy13 = {
    point: recipeRuntime.point,
    features: recipeRuntime.features,
    signalBuilder: coreDecisionSource?.signalBuilder ?? legacySignalBuilder,
    rankingConfig: recipeRuntime.rankingConfig,
    selectionConfig: recipeRuntime.selectionConfig,
    ...(recipeRuntime.signalDescription !== undefined
      ? { signalDescription: recipeRuntime.signalDescription }
      : {}),
  };

  /**
   * 9cc · PHASE-D（AR-14）—— **Pattern 语义 → 策略侧的消费点**。
   *
   * 修复前的断链（9cc 审计实测）：`patternLibrary/strategyProjection.ts`（PHASE-B-001 交付）
   * 全仓**只被它自己的单测引用** —— 执行侧从不读语义注册表 ⇒「Research 与 Strategy 用同一份
   * `pat_*` semantic definition」只在**文件层面**成立，在**执行路径上不成立**。
   *
   * 本段把「语义声明里的执行侧投影」与**真实能力面**对表：
   *   - `strategyProjection.featureId` 必须在 Core 特征注册表里真的登记过；
   *   - `strategyProjection.thresholdParam` 必须在本文档声明的参数里真的存在。
   *
   * 🔴 三条纪律：
   *   ① **不复制 Expander**：只消费 `listPatternSemantics()`（唯一 Expander 的产物）；
   *   ② **不改任何计算**：特征值仍由 Core 注册表算，本段**不产出**任何执行用数值；
   *   ③ **非致命**：结论并进既有的 `strategyDecisionEngineNote`（契约里已有该 string 字段，
   *      零 schema 变更）；不一致时**点名到 semanticId**，绝不静默。
   */
  const semanticConsumption = verifyStrategyConsumption({
    patternId: resolvePatternIdByRecipeId(recipeRuntime.recipeId),
    isFeatureRegistered: (featureId) => getDefaultFeatureRegistry().has(featureId),
    declaredParameterCodes: new Set(document.parameters.parameters.map((parameter) => parameter.name)),
  });
  strategyDecisionEngineNote = `${strategyDecisionEngineNote} / ${semanticConsumption.note}`;

  // BACKTEST-002（B-01）— 执行政策（含**版本号**）在此固定下来：
  // 它既是执行输入，也是「这条历史结果按哪套政策跑的」的可复现坐标。
  const backtestPolicy = DEFAULT_BACKTEST_EXECUTION_POLICY;

  const strategyRunContext: StrategyRunContext = {
    engine: strategyDecisionEngine,
    note:
      strategyDecisionEngineNote +
      " / 回测执行政策 v" + String(BACKTEST_EXECUTION_POLICY_VERSION) + "：" +
      describeExecutionPolicy(backtestPolicy).join("；") +
      " / 仓位口径：" + "见 assembly.positionSizingNote",
    coreDecisionSource,
    coreVersion: coreVersionResult.ok ? coreVersionResult : null,
    point: recipeRuntime.point,
    anchorPolicy: "SERIES_START",
    eventTypes:
      coreVersionResult.ok && coreVersionResult.eventType !== null ? [coreVersionResult.eventType] : [],
    limitUpRatio: coreVersionResult.ok ? coreVersionResult.limitUpRatio : null,
    universeId: document.universe.universeId,
  };

  const experimentConfig: ExperimentConfig = {
    datasetVersion: datasetVersion,
    strategyId: document.strategyId,
    strategyVersion: document.version,
    parameters: parameterSet,
    universe: { universeId: deriveDatasetUniverseId(datasetVersion) },
    dateRange: { startDate: request.startDate, endDate: request.endDate },
    costModel,
    randomSeed: recipeRuntime.randomSeed,
  };

  const backtestConfig = document.executionAssumptions?.backtestConfig;
  if (backtestConfig === undefined || backtestConfig === null) {
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_MISSING_BACKTEST_CONFIG",
      `装配层：策略文档缺少 executionAssumptions.backtestConfig（初始资金 / 持仓上限），无法装配 backtest 阶段。`,
    );
  }

  // ------------------------------------------------------------------
  // BACKTEST-001 — 执行政策 / 执行语义校验 / 仓位口径如实登记
  //
  // 🔴 三件事在这里一次做完（都是 Phase A 实测出的真实缺口）：
  //    G1 政策显式化并传下去（此前不传 ⇒ 涨跌停默认关闭）；
  //    G3 执行语义与实现的一致性校验（此前 signalTiming/executionTiming/priceReference 全仓零消费）；
  //    G2 仓位口径映射（positionRatio/fixedAmount 在引擎里无消费者 ⇒ 如实登记，不静默）。
  // ------------------------------------------------------------------
  const executionSemanticsCheck = checkExecutionSemantics({
    signalTiming: document.definition?.execution?.signalTiming ?? "T_CLOSE",
    executionTiming: document.definition?.execution?.executionTiming ?? "T_PLUS_1_OPEN",
    priceReference: document.definition?.execution?.priceType ?? "OPEN",
    decisionPoint: recipeRuntime.point,
  });
  if (!executionSemanticsCheck.supported) {
    // 规格 §9：声明与实现不一致时**绝不静默按默认口径跑**。
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_EXECUTION_SEMANTICS_UNSUPPORTED",
      "装配层：" + executionSemanticsCheck.detail,
    );
  }
  // BACKTEST-002（B-02/R-02）— 文档声明的仓位口径 → 执行层口径（**唯一实现**，见 `mapDeclaredPositionSizing`）。
  const declaredPositionSizing = mapDeclaredPositionSizing(document.positionSizing);
  const declaredExitPolicy = mapDeclaredExitPolicy(document.definition?.exit?.rules, parameterSet);
  const positionSizingMapping = mapPositionSizing({
    sizingMethod: declaredPositionSizing.sizingMethod,
    maxPositions: backtestConfig.maxPositions ?? null,
    positionRatio: declaredPositionSizing.fraction,
    fixedAmount: declaredPositionSizing.fixedAmount,
  });

  const simulationConfig: SimulationConfig = {
    name: `run-workbench-${document.strategyId}@${document.version}`,
    dateRange: { startDate: request.startDate, endDate: request.endDate },
    initialCapital: backtestConfig.initialCapital,
    cost: costModel,
    executionModel,
    maxPositions: backtestConfig.maxPositions ?? null,
    maxDailyBuys: backtestConfig.maxDailyBuys ?? null,
    directionPolicy: "longOnly",
    // 🔴 BACKTEST-001（G1）：此前不传 ⇒ 走默认 false ⇒ 涨停买得进、跌停卖得出。
    //    改为显式传保守口径，并把政策写进 Run Record（可解释「为什么这笔没成交」）。
    executionRules: toExecutionRuleSet(backtestPolicy),
    allowPartialFill: backtestPolicy.allowPartialFill,
    // BACKTEST-002（B-02）— 把策略文档声明的仓位口径真正传进执行层。
    positionSizing: {
      sizingMethod: declaredPositionSizing.sizingMethod,
      fraction: declaredPositionSizing.fraction,
      fixedAmount: declaredPositionSizing.fixedAmount,
    },
    ...(declaredExitPolicy !== undefined
      ? { exitPolicy: declaredExitPolicy }
      : {}),
    // BACKTEST-002（B-05）— 零成交量政策（保守：不可成交）。
    zeroVolumePolicy: backtestPolicy.zeroVolumePolicy,
  };

  // -- 4.（可选）finalize 生命周期配置 --
  const lifecycle =
    request.lifecycle === undefined || request.lifecycle === null
      ? undefined
      : buildLifecycleConfig({
          lifecycleRecord: request.lifecycle.lifecycleRecord,
          transition: request.lifecycle.transition,
          ...(request.lifecycle.allowSyntheticEvidence !== undefined
            ? { allowSyntheticEvidence: request.lifecycle.allowSyntheticEvidence }
            : {}),
        });

  // -- 5. strategy 阶段入参 --
  //
  // 策略文档是**真实读出来**的（`strategy_versions.strategyDocumentJson`），因此
  // strategy 阶段可以真跑 —— 它本来就在链上（位于 backtest 之前），不装配它就等于
  // 让下游全部 `CL_UPSTREAM_BLOCKED`。
  //
  // `strategyDocumentInput` 形态是 `Omit<StrategyDocument,"recordKind"|"recordVersion"|"fingerprint">`；
  // 直接传入完整文档即可 —— `createStrategyDocument` 会重新盖上这三个书签字段，
  // 且**重新计算指纹**（所以传完整文档不会造成「指纹被外部指定」的风险）。
  const strategyDocumentInput = document as unknown as StrategyDocumentInput;

  // 版本记录（§17 九项追溯）：codeVersion / createdAt 是注入式元数据。
  // codeVersion 由调用方注入（本层不读 package.json / git）——「unknown」是**如实**表达
  // 「本次未解析代码版本」，而不是编一个版本号。
  const strategyVersionRecordInput: StrategyVersionRecordInput = {
    document: strategyDocumentInput as unknown as StrategyDocument,
    context: { codeVersion: request.codeVersion, createdAt: request.createdAt },
    parameterSet,
  };


  return {
    recipeRuntime,
    recipeSource,
    parameterSet,
    costModel,
    executionModel,
    strategyContract,
    strategy13,
    experimentConfig,
    simulationConfig,
    strategyDocumentInput,
    strategyVersionRecordInput,
    lifecycle,
    strategyRunContext,
  };
}

/**
 * 组装 `ClosedLoopWiringInputs`（**唯一实现**：主入口与闭环内的参数评估器共用）。
 *
 * 抽出来的理由：`strategyEvaluation` 的同步评估需要在**不重建数据集**的前提下组装
 * 同一份 wiring inputs；若在那边再拼一遍，就是「第二套装配」（违反唯一实现纪律）。
 */
export function buildClosedLoopWiringInputs(
  dataset: ResearchDataset,
  side: AssembledStrategySide,
  corporateActionResolver?: CorporateActionResolverLike,
): ClosedLoopWiringInputs {
  return {
    researchDataset: dataset,
    experimentConfig: side.experimentConfig,
    strategyContract: side.strategyContract,
    strategy13: side.strategy13,
    strategyDocumentInput: side.strategyDocumentInput,
    strategyVersionRecordInput: side.strategyVersionRecordInput,
    simulationConfig:
      corporateActionResolver === undefined
        ? side.simulationConfig
        : { ...side.simulationConfig, corporateActionResolver },
    ...(side.lifecycle !== undefined ? { lifecycle: side.lifecycle } : {}),
  };
}

/**
 * 装配一次「真实跑通」的全部入参。
 *
 * 步骤（每步都可能响亮抛错，绝不静默降级）：
 *   1. 真实构建 `ResearchDataset`（窗口 = 用户所选决策窗口）；
 *   2. 真实读取策略文档 → 成本模型 / 执行模型 / 初始资金 / 持仓上限；
 *   3. 解析已注册配方 → 特征提供器 / 信号构造器 / 排序与选择配置；
 *   4. 组装 `experimentConfig` / `strategyContract` / `strategy13` / `simulationConfig`；
 *   5. （可选）组装 `lifecycle`（finalize 阶段；回测指纹由本层从真实产物回填）。
 */
export async function assembleRunWorkbenchInputs(
  request: AssembleRunWorkbenchInputsRequest,
): Promise<AssembleRunWorkbenchInputsResult> {
  // -- 1. 数据集：优先直读已绑定 datasetVersionId 的已落库 ds_* 数据集；缺失才回落重建 --
  //    （原路径无条件重建 ⇒ 无视已绑定数据集、分钟级等待、产物可能漂移；见模块头与
  //     docs/evidence/_probe_ds_rows.mts。）
  const datasetResolution = await perfRunAsync("dataset.resolve", () => resolveDataset(request));
  const dataset = datasetResolution.dataset;

  // -- 2~5. 策略侧装配（**同步**；抽成 `assembleStrategySide` 供闭环内的参数评估器复用）--
  const side = perfRun("research.context_build", () => assembleStrategySide(request, dataset.datasetVersion));

  const securityIdByCode = new Map<string, string[]>();
  for (const row of dataset.rows) {
    if (row.code !== null && row.code !== undefined) {
      const ids = securityIdByCode.get(row.code) ?? [];
      if (!ids.includes(row.securityId)) ids.push(row.securityId);
      securityIdByCode.set(row.code, ids);
    }
  }
  const corporateActions = await perfRunAsync("corporate_actions.load", () =>
    listCorporateActionsForCodesInRange([...securityIdByCode.keys()], {
      startDate: request.startDate,
      endDate: request.endDate,
    }),
  );
  const corporateActionResolver = createCorporateActionResolver(corporateActions, securityIdByCode);

  const inputs = buildClosedLoopWiringInputs(dataset, side, corporateActionResolver);

  // Registry runs use event-scoped ids so one security can contribute multiple independent
  // first-limit events. The summary still reports underlying securities, not event series.
  const distinctSecurities = perfRun(
    "research.candidate_preparation",
    () => new Set(dataset.rows.map(row => baseSecurityIdOf(row.securityId))),
  );
  perfCount("research.dataset_rows", dataset.rows.length);

  return {
    inputs,
    dataset,
    side,
    assembly: {
      datasetVersion: dataset.datasetVersion,
      datasetGate: dataset.gate,
      datasetRowCount: dataset.rows.length,
      datasetSecretCount: distinctSecurities.size,
      datasetSource: datasetResolution.source,
      datasetSourceNote: datasetResolution.sourceNote,
      datasetVersionId: datasetResolution.registry?.version.id ?? null,
      dateRange: { startDate: request.startDate, endDate: request.endDate },
      strategyId: request.strategyDocument.strategyId,
      strategyVersion: request.strategyDocument.version,
      recipeId: side.recipeRuntime.recipeId,
      recipeSource: side.recipeSource,
      recipeFeatureIds: side.recipeRuntime.features.map(feature => feature.featureId),
      selectionSummary: side.recipeRuntime.selectionSummary,
      strategyDecisionEngine: side.strategyRunContext.engine,
      strategyDecisionEngineNote:
        side.strategyRunContext.note +
        " / 回测执行政策 v" + String(BACKTEST_EXECUTION_POLICY_VERSION) + "：" +
        describeExecutionPolicy(DEFAULT_BACKTEST_EXECUTION_POLICY).join("；") +
        " / 仓位口径（B-02 起真正参与成交预算）：" +
        "sizingMethod=" + String(side.simulationConfig.positionSizing?.sizingMethod ?? "（未声明=等权）") +
        "；fraction=" + String(side.simulationConfig.positionSizing?.fraction ?? "—") +
        "（预算 = min(等权现金预算, 初始资金 × fraction)）",
      simulation: {
        initialCapital: side.simulationConfig.initialCapital,
        maxPositions: side.simulationConfig.maxPositions ?? null,
        maxDailyBuys: side.simulationConfig.maxDailyBuys ?? null,
        executionModel: side.executionModel,
        costModel: side.costModel,
      },
    },
  };
}
