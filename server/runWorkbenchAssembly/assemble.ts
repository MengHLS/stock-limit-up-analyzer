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
import type { ClosedLoopWiringInputs } from "../research/closedLoopWiring/types";
import { resolveStrategyRecipe, resolveStrategyRecipeById, DEFAULT_STRATEGY_RECIPE_ID, type StrategyRecipeRuntime } from "../research/recipeRegistry";
import { normalizeStrategyExecutionModel } from "./executionModel";
import type { StrategyDocument, StrategyDocumentInput } from "../research/strategySchema/types";
import type { StrategyVersionRecordInput } from "../research/strategySchema/map";
import type { LifecycleConfigInput } from "./lifecycleConfig";
import { buildLifecycleConfig } from "./lifecycleConfig";

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/** 装配错误（消息必须能直接指向「缺哪个字段 / 去改哪里」）。 */
export class LoopRunAssemblyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LoopRunAssemblyError";
    this.code = code;
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
   * 数据集护栏（对齐 `buildResearchDataset` 选项；用于「先小步验证再放大」）。
   * 缺省不限，与既有 `researchDataset.build` 端点口径一致。
   */
  readonly dataReady?: boolean;
  readonly maxTradingDays?: number;
  readonly maxSecuritiesPerDay?: number;
  /**
   * 显式指定的执行配方 id（**仅当策略文档没有 `recipe` 时生效**）。
   *
   * 为什么需要：库里既有策略文档都还没有 recipe 字段（配方编辑入口属后续增量），
   * 而「按哪个配方跑」是必须被声明的事实。缺省用 `DEFAULT_STRATEGY_RECIPE_ID`
   * （显式常量，不是猜测），并把来源写进 `assembly.recipeSource`。
   */
  readonly recipeId?: string;
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
}

/** 装配摘要（供前端如实展示「数据从哪来、规模多大」，不参与任何计算）。 */
export interface LoopRunAssemblySummary {
  readonly datasetVersion: string;
  readonly datasetGate: string;
  readonly datasetRowCount: number;
  readonly datasetSecretCount: number;
  /**
   * 数据来源：`registry`（直读已绑定 ds_* 数据集）| `rebuild`（从零重建）。
   * 前端据此如实展示「本次跑的是哪份数据」，绝不让重建伪装成「用了你绑定的数据集」。
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
  /** 配方来源：`strategy-document`（文档里写着）| `explicit-request`（调用方指定 / 默认常量）。 */
  readonly recipeSource: RecipeResolutionSource;
  readonly recipeFeatureIds: readonly string[];
  readonly selectionSummary: string;
  readonly simulation: {
    readonly initialCapital: number;
    readonly maxPositions: number | null;
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

/** 配方来源（进审计摘要：让人一眼看出「这次按哪个配方跑的、这个配方是哪儿来的」）。 */
export type RecipeResolutionSource = "strategy-document" | "explicit-request";

// ---------------------------------------------------------------------------
// 数据来源（进审计摘要：让人一眼看出「这次跑的是哪份数据」）
// ---------------------------------------------------------------------------

/** 数据来源：直读已绑定数据集 / 从零重建。 */
export type DatasetSourceKind = "registry" | "rebuild";

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

/** 由策略文档的 recipe 解析真实可执行配方；文档无 recipe 时按显式请求 / 默认值兜底。 */
function requireRecipe(
  document: StrategyDocument,
  explicitRecipeId: string | undefined,
): { runtime: StrategyRecipeRuntime; source: RecipeResolutionSource } {
  const recipe = document.recipe;
  if (recipe !== undefined && recipe !== null) {
    return { runtime: resolveStrategyRecipe(recipe), source: "strategy-document" };
  }
  // 文档里没有配方（当前库里 3 份文档全部如此 —— 见 docs/evidence/_probe_strategy_doc_shape.json）。
  // 两条诚实路径：① 调用方显式指定；② 显式声明的默认配方常量。
  // 无论哪条，事实都进 `assembly.recipeSource`，绝不让「隐式兜底」伪装成「文档声明」。
  if (explicitRecipeId !== undefined && explicitRecipeId.trim().length > 0) {
    return { runtime: resolveStrategyRecipeById(explicitRecipeId), source: "explicit-request" };
  }
  return {
    runtime: resolveStrategyRecipeById(DEFAULT_STRATEGY_RECIPE_ID),
    source: "explicit-request",
  };
}

// ---------------------------------------------------------------------------
// 装配主流程
// ---------------------------------------------------------------------------

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
  const datasetResolution = await resolveDataset(request);
  const dataset = datasetResolution.dataset;

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
  const parameterSet = recipeRuntime.resolveParameters(document.parameters);

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

  const strategy13: Strategy13 = {
    point: recipeRuntime.point,
    features: recipeRuntime.features,
    signalBuilder: recipeRuntime.buildSignalBuilder(parameterSet),
    rankingConfig: recipeRuntime.rankingConfig,
    selectionConfig: recipeRuntime.selectionConfig,
    ...(recipeRuntime.signalDescription !== undefined
      ? { signalDescription: recipeRuntime.signalDescription }
      : {}),
  };

  const experimentConfig: ExperimentConfig = {
    datasetVersion: dataset.datasetVersion,
    strategyId: document.strategyId,
    strategyVersion: document.version,
    parameters: parameterSet,
    universe: { universeId: deriveDatasetUniverseId(dataset.datasetVersion) },
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

  const simulationConfig: SimulationConfig = {
    name: `run-workbench-${document.strategyId}@${document.version}`,
    dateRange: { startDate: request.startDate, endDate: request.endDate },
    initialCapital: backtestConfig.initialCapital,
    cost: costModel,
    executionModel,
    maxPositions: backtestConfig.maxPositions ?? null,
    directionPolicy: "longOnly",
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

  const inputs: ClosedLoopWiringInputs = {
    researchDataset: dataset,
    experimentConfig,
    strategyContract,
    strategy13,
    strategyDocumentInput,
    strategyVersionRecordInput,
    simulationConfig,
    ...(lifecycle !== undefined ? { lifecycle } : {}),
  };

  const distinctSecurities = new Set(dataset.rows.map(row => row.securityId));

  return {
    inputs,
    dataset,
    assembly: {
      datasetVersion: dataset.datasetVersion,
      datasetGate: dataset.gate,
      datasetRowCount: dataset.rows.length,
      datasetSecretCount: distinctSecurities.size,
      datasetSource: datasetResolution.source,
      datasetSourceNote: datasetResolution.sourceNote,
      datasetVersionId: datasetResolution.registry?.version.id ?? null,
      dateRange: { startDate: request.startDate, endDate: request.endDate },
      strategyId: document.strategyId,
      strategyVersion: document.version,
      recipeId: recipeRuntime.recipeId,
      recipeSource,
      recipeFeatureIds: recipeRuntime.features.map(feature => feature.featureId),
      selectionSummary: recipeRuntime.selectionSummary,
      simulation: {
        initialCapital: simulationConfig.initialCapital,
        maxPositions: simulationConfig.maxPositions ?? null,
        executionModel,
        costModel,
      },
    },
  };
}
