/**
 * FE-6 — 参数搜索 + 鲁棒性 tRPC Router（STEP 17 C-17.1/17.2 + STEP 18 C-18.1/18.2）。
 *
 * 纪律（对齐 researchRouter FE-5 的「技术预览」哲学 + R7 隔离）：
 * - **只读复用**：调用 C-17.1 runParameterSearch / C-17.2 runRollingOptimization /
 *   C-18.1 runRobustnessStress / C-18.2 runStochasticRobustness 既有纯函数，
 *   不重写任何语义；本层只做「传输 → 领域」的边界投递 + **注入式评估器装配**；
 * - **评估器装配（关键）**：这些引擎的请求对象含同步注入式评估器（把参数集 / 扰动
 *   条目映射为绩效标量），而生产回测 getLeaderCandidateBacktest 是**异步**的（读 DB）。
 *   且 tRPC 无法跨网络序列化函数。因此本层在**服务端异步预计算**所有参数组合 /
 *   扰动条目的回测结果到 Map，再构造一个**同步查表求值器**交给纯函数引擎；
 * - **技术预览口径（R7）**：评估标量来自生产回测 realisticSimulation
 *   （totalReturn / maxDrawdown / tradeCount），非 RESEARCH_READY 口径；
 *   前端必须醒目标注「技术预览·非 RESEARCH_READY 口径」；
 * - **响亮失败**：引擎抛出的结构化错误（ResearchValidationError）原样转译为
 *   tRPC BAD_REQUEST（不吞异常、不返回 NaN 假指标）；回测无数据（equityCurve 为空）
 *   时该样本转记 failed（结构化可见），绝不静默给 0 假成功；
 * - **状态不冒充**：C-17/C-18 仍为 CODE_READY，VALIDATED 依赖数据链认证（§0.2 禁止越级）。
 *
 * 参数空间 → 回测映射（技术预览）：
 *   参数空间的维度名映射到生产回测可选字段（realistic.maxHoldingDays /
 *   realistic.stopLossPercent / minScore / observationDays 等，见
 *   MAPPABLE_PARAMETER_DICTIONARY）。未收录的维度名会被求值器忽略（不产生效果），
 *   describe 端点返回该字典供前端只选用「真实可映射」的维度，避免搜索无效果参数。
 */

import { randomBytes } from "node:crypto";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getIndexDailyTradeDates, getLeaderCandidateBacktest } from "./db";
import { DbStrategyRepository } from "./research/strategyPersistence/db";
import {
  createStrategyBacktestBridge,
  deriveParameterSpaceFromDocument,
  type StrategyBacktestBridge,
} from "./research/strategyEvaluation";
import type { LeaderCandidateBacktestOptions } from "./leaderCandidates";
import type { RealisticBacktestOptions, RealisticBacktestResult } from "./realisticBacktest";
import { ResearchValidationError } from "./research/experimentValidation";
import type {
  ParameterSpace,
  SweepParameterDefinition,
} from "./research/parameterSpace";
import { calculateCombinationCount, DEFAULT_MAX_COMBINATIONS } from "./research/combinationGenerator";
import type { ResearchParameterSet } from "./research/types";
import {
  runParameterSearch,
  gridParameterSets,
  DEFAULT_RANDOM_SEARCH_BUDGET,
  DEFAULT_REGION_ANALYSIS_CONFIG,
  type ParameterSearchEvaluator,
  type ParameterSearchMetricsView,
  type ParameterSearchSampleOutcome,
} from "./research/parameterSearch";
import {
  runRollingOptimization,
  generateRollingOptimizationWindows,
  resolveRollingWindowConfig,
  DEFAULT_ROLLING_STABILITY_CONFIG,
  type RollingOptimizationEvaluatorFactory,
  type RollingOptimizationWindowContext,
} from "./research/rollingOptimization";
import {
  runRobustnessStress,
  generateCostStressVariants,
  generateSlippageStressVariants,
  generateParameterPerturbationVariants,
  generateExecutionPerturbationVariants,
  DEFAULT_ROBUSTNESS_THRESHOLDS,
  ROBUSTNESS_RUN_ID_PREFIX,
  type PerturbationItem,
  type RobustnessEvaluator,
  type RobustnessSampleOutcome,
} from "./research/robustness";
import {
  runStochasticRobustness,
  generateStochasticRobustnessRunId,
  STOCHASTIC_METHODS,
  STOCHASTIC_DEFAULT_ITERATIONS,
  STOCHASTIC_DEFAULT_ALPHA,
  STOCHASTIC_DEFAULT_ANNUALIZATION_FACTOR,
  STOCHASTIC_DEFAULT_TAIL_DRAWDOWN_THRESHOLD_PCT,
  STOCHASTIC_DEFAULT_MIN_ITERATIONS_FOR_VERDICT,
  type StochasticMetricsView,
} from "./research/stochasticRobustness";
import { A_SHARE_DEFAULT_COST_DECLARATION, type CostModelDeclaration } from "./research/costModel";
import {
  createExecutionConstraintDeclaration,
  type ExecutionConstraintDeclaration,
} from "./research/executionConstraints";
// ---------------------------------------------------------------------------
// PARAMETER-001 — 持久化 Parameter Search（创建 / 列表 / 详情 / 启动 / 取消 / 结果 / 重试）
// ---------------------------------------------------------------------------
import {
  createParameterSearchInputSchema,
  executeParameterSearchInputSchema,
  listParameterSearchResultsInputSchema,
  listParameterSearchRunsInputSchema,
  parameterSearchCreateResultSchema,
  parameterSearchExecuteOutcomeSchema,
  parameterSearchResultPageSchema,
  parameterSearchRunDetailSchema,
  parameterSearchRunIdInputSchema,
  parameterSearchRunViewSchema,
  retryParameterSearchCombinationInputSchemaV2,
  type ParameterSearchMethod,
} from "../shared/parameterSearchContracts";
import {
  cancelParameterSearchRun,
  createParameterSearchRun,
  executeParameterSearchRun,
  listParameterSearchCombinations,
  listParameterSearchResults,
  listParameterSearchRuns,
  readParameterSearchRun,
  retryParameterSearchCombination,
} from "./research/parameterSearch/executor";
import {
  resolvePrimaryDatasetVersionId,
  resolvePrimaryDatasetVersionLabel,
} from "./research/parameterSearch/coordinates";
import { computeRunProgress } from "./research/parameterSearch/searchRun";
// PARAMETER-002 — 死参数筛查（唯一权威收集器 = strategyCore/ruleGraph）与数据集窗口前置校验
import { collectRuleParameterReferences } from "./strategyCore/ruleGraph";
import { coreVersionFromDocument } from "./strategyCore/production/versionFromDocument";
import {
  getParameterSearchRunRow,
  listParameterSearchCombinationRows,
  listParameterSearchResultRows,
  readDatasetVersionWindow,
} from "./research/parameterSearch/persistence";
import type { StrategyDocument } from "./research/strategySchema/types";

// ---------------------------------------------------------------------------
// 技术预览常量
// ---------------------------------------------------------------------------

/** 技术预览参数空间组合数上限：超过即拒绝，避免预计算过多回测拖慢响应。 */
const PREVIEW_MAX_COMBINATIONS = 64;
/**
 * 策略评估路径的组合数上限。
 *
 * 🔴 为什么比预览的 64 更严：策略评估每组参数都是**一次完整闭环回测**
 * （`data → research → strategy → backtest → evaluation`，实测数秒级），
 * 64 组就是分钟级同步阻塞。要搜更大空间请用 `method = "random"` + `budget`
 * （另跑离线全网格不在本端点职责内）。
 */
const STRATEGY_EVALUATION_MAX_COMBINATIONS = 16;

/**
 * 技术预览回测区间（最近约 2 年）：收敛价格行到可交互量级（对齐 STEP 7.3 内存安全铁律——
 * 全历史无条件拉取命中 489 万行价格行会卡死/超内存，最近 2 年可收敛到 ~80 万行）。
 * 评估标量口径不因区间截断而改变，仅限制数据规模；describe.preview 可见。
 */
function previewRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const start = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
  const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return { startDate, endDate };
}

/** 技术预览默认研究策略身份（前端可覆盖；与生产 leader-candidate-baseline 对齐）。 */
const DEFAULT_STRATEGY_ID = "leader-candidate-baseline";
const DEFAULT_STRATEGY_VERSION = "0.1.0";

/** 技术预览默认参数空间：2 维 × 2 档 = 4 组合，保证预计算回测可交互。 */
const DEFAULT_PREVIEW_PARAMETER_SPACE: ParameterSpace = {
  parameters: [
    { type: "integer", name: "maxHoldingDays", min: 3, max: 5, step: 2 },
    { type: "number", name: "stopLossPercent", min: 5, max: 8, step: 3 },
  ],
};

/** 参数轴鲁棒性默认基线参数集（与默认参数空间维度一致，保证可映射）。 */
const DEFAULT_PREVIEW_PARAMETER_SET: ResearchParameterSet = {
  maxHoldingDays: 5,
  stopLossPercent: 5,
};

/**
 * 参数空间维度 → 生产回测可选字段字典（技术预览只暴露「真实可映射」的维度）。
 * 前端据此只构造能影响回测结果的参数空间，避免搜索无效果参数。
 */
const MAPPABLE_PARAMETER_DICTIONARY: Readonly<
  Record<string, { readonly target: string; readonly type: string }>
> = Object.freeze({
  maxHoldingDays: { target: "realistic.maxHoldingDays", type: "integer" },
  stopLossPercent: { target: "realistic.stopLossPercent", type: "number" },
  maxPositions: { target: "realistic.maxPositions", type: "integer" },
  trailingDrawdownPercent: { target: "realistic.trailingDrawdownPercent", type: "number" },
  trailingProfitActivationPercent: { target: "realistic.trailingProfitActivationPercent", type: "number" },
  strongHoldMinReturn: { target: "realistic.strongHoldMinReturn", type: "number" },
  minScore: { target: "minScore", type: "number" },
  observationDays: { target: "observationDays", type: "enum(1|2)" },
});

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 结构化校验错误 → tRPC BAD_REQUEST；其余原样冒泡（不吞异常）。 */
function toTrpcError(error: unknown): TRPCError {
  if (error instanceof ResearchValidationError) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: error.issues
        .map((issue) => `[${issue.code}] ${issue.path}: ${issue.message}`)
        .join("；"),
    });
  }
  if (error instanceof TRPCError) return error;
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: errorMessage(error),
  });
}

/** 参数集 canonical 键（键排序 + JSON 值；与 C-17.2 rollingParameterSetKey 同语义）。 */
function parameterSetKey(set: ResearchParameterSet): string {
  return Object.keys(set)
    .sort()
    .map((key) => `${JSON.stringify(key)}=${JSON.stringify(set[key])}`)
    .join("|");
}

/** 参数集 → 生产回测可选字段（仅映射字典收录的维度；未收录维度忽略）。 */
function parameterSetToBacktestOptions(set: ResearchParameterSet): LeaderCandidateBacktestOptions {
  const options: LeaderCandidateBacktestOptions = {};
  const realistic: RealisticBacktestOptions = {};
  for (const [key, value] of Object.entries(set)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    switch (key) {
      case "maxHoldingDays":
        realistic.maxHoldingDays = value;
        break;
      case "stopLossPercent":
        realistic.stopLossPercent = value;
        break;
      case "maxPositions":
        realistic.maxPositions = value;
        break;
      case "trailingDrawdownPercent":
        realistic.trailingDrawdownPercent = value;
        break;
      case "trailingProfitActivationPercent":
        realistic.trailingProfitActivationPercent = value;
        break;
      case "strongHoldMinReturn":
        realistic.strongHoldMinReturn = value;
        break;
      case "minScore":
        options.minScore = value;
        break;
      case "observationDays":
        if (value === 1 || value === 2) options.observationDays = value;
        break;
      default:
        break;
    }
  }
  if (Object.keys(realistic).length > 0) options.realistic = realistic;
  return options;
}

/** 生产回测 realisticSimulation → 搜索/鲁棒性绩效标量（同口径，仅字段映射）。 */
function simulationToMetrics(sim: RealisticBacktestResult): ParameterSearchMetricsView {
  return {
    totalReturnPct: sim.totalReturn,
    maxDrawdownPct: sim.maxDrawdown,
    tradeCount: sim.tradeCount,
  };
}

/**
 * 回测数据为空（equityCurve 无点）→ failed；否则映射为 succeeded 标量。
 * 禁止把「无数据」静默当 0 假成功（§0 纪律：失败响亮）。
 */
function toSearchOutcome(sim: RealisticBacktestResult): ParameterSearchSampleOutcome {
  if (sim.equityCurve.length === 0) {
    return { status: "failed", error: "回测未产生权益曲线（equityCurve 为空，数据未就绪）" };
  }
  return { status: "succeeded", metrics: simulationToMetrics(sim) };
}

/**
 * 预计算一组参数集的回测结果（串行；单参数集失败转记 failed，不整体抛错）。
 * 串行而非并发：同一区间下的 base context（records / rawRows / context）会被
 * backtestBaseContextCache 复用，首个参数集加载后其余仅重算模拟段，峰值内存更稳。
 */
async function precomputeParameterSetOutcomes(
  parameterSets: readonly ResearchParameterSet[],
  range: { startDate: string; endDate: string } = previewRange(),
  bridge?: StrategyBacktestBridge,
): Promise<Map<string, ParameterSearchSampleOutcome>> {
  const map = new Map<string, ParameterSearchSampleOutcome>();
  for (const set of parameterSets) {
    const key = parameterSetKey(set);
    if (bridge !== undefined) {
      // 策略评估路径：真实闭环（桥内部按区间复用数据集；禁第二套子链）
      const sample = await bridge.evaluate(set, range);
      map.set(key, sample.outcome);
      continue;
    }
    try {
      const result = await getLeaderCandidateBacktest({
        ...parameterSetToBacktestOptions(set),
        ...range,
      });
      map.set(key, toSearchOutcome(result.realisticSimulation));
    } catch (error) {
      map.set(key, { status: "failed", error: errorMessage(error) });
    }
  }
  return map;
}

/** 策略评估路径的解析结果（bridge 缺省即回落 legacy，`note` 必须如实说明原因）。 */
interface ResolvedStrategyEvaluation {
  readonly source: "strategy-document" | "legacy-leader-candidate-backtest";
  readonly note: string;
  readonly bridge?: StrategyBacktestBridge;
  /** 仅策略路径给出：从文档派生的参数空间（legacy 路径为 undefined）。 */
  readonly derivedSpace?: ParameterSpace;
}

/**
 * 判断本次能否走**策略评估**（真实闭环），能则建桥。
 *
 * 🔴 四个条件缺一不可（缺哪个都在 note 里写明，**不静默回落**）：
 *   1. 入参给了 `strategyId` + `strategyVersion`；
 *   2. 库中确实能读到该版本的策略文档；
 *   3. 入参给了 `startDate` + `endDate` —— 策略评估必须落在**数据集窗口内**
 *      （预览缺省是「最近约 2 年」，直接拿去撞数据集窗口会 FAIL FAST `SIM_RANGE_OUT_OF_DATASET`）；
 *   4. 文档 `parameters` 能派生出**非空**搜索空间（全是 legacy 维度的话，
 *      覆写会因 `RECIPE_PARAMETER_UNKNOWN` 被拒 —— 那是「参数不在文档里」的正确拒绝）。
 */
async function resolveStrategyEvaluation(input: {
  readonly strategyId?: string;
  readonly strategyVersion?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly createdAt: string;
  readonly codeVersion: string;
}): Promise<ResolvedStrategyEvaluation> {
  const legacy: ResolvedStrategyEvaluation = {
    source: "legacy-leader-candidate-backtest",
    note:
      "legacy 生产回测（realisticSimulation 查表）；非 RESEARCH_READY 口径。",
  };
  if (input.strategyId === undefined || input.strategyVersion === undefined) {
    return { ...legacy, note: `${legacy.note}未走策略评估：入参缺 strategyId / strategyVersion。` };
  }
  if (input.startDate === undefined || input.endDate === undefined) {
    return {
      ...legacy,
      note:
        `${legacy.note}未走策略评估：入参缺 startDate / endDate —— `
          + "策略评估必须显式给决策窗口（预览缺省区间是最近约 2 年，会越出数据集窗口被判 SIM_RANGE_OUT_OF_DATASET）。",
    };
  }

  let document;
  try {
    const record = await new DbStrategyRepository().getVersion(input.strategyId, input.strategyVersion);
    document = record?.strategy;
  } catch (error) {
    return {
      ...legacy,
      note: `${legacy.note}未走策略评估：读取策略版本失败（${errorMessage(error)}）。`,
    };
  }
  if (document === undefined) {
    return {
      ...legacy,
      note: `${legacy.note}未走策略评估：库中不存在 ${input.strategyId}@${input.strategyVersion} 的策略文档。`,
    };
  }

  const derivation = deriveParameterSpaceFromDocument(document);
  if (derivation.space.parameters.length === 0) {
    return {
      ...legacy,
      note:
        `${legacy.note}未走策略评估：文档 ${input.strategyId}@${input.strategyVersion} 的参数`
          + `（${derivation.declaredParameterNames.join(" / ") || "无"}）无一可派生搜索空间`
          + `（需同时具备 min / max / step）。`,
    };
  }

  const primary = document.definition?.datasets?.find(d => d.role === "PRIMARY") ?? document.definition?.datasets?.[0];
  const datasetVersionId = primary?.datasetVersionId ?? document.datasetVersionId ?? undefined;
  const bridge = createStrategyBacktestBridge({
    document,
    codeVersion: input.codeVersion,
    defaultRange: { startDate: input.startDate, endDate: input.endDate },
    createdAt: input.createdAt,
    ...(datasetVersionId !== undefined && datasetVersionId !== null ? { datasetVersionId } : {}),
  });
  return {
    source: "strategy-document",
    note:
      `策略评估端口（真实闭环 data→research→strategy→backtest→evaluation）—— 参数空间由文档派生`
        + `（${derivation.space.parameters.map(p => p.name).join(" / ")}）`
        + (derivation.excluded.length === 0
            ? "；全部声明参数均进搜索空间。"
            : `；未进搜索空间：${derivation.excluded.map(item => item.name + "（" + item.reason + "）").join("；")}。`),
    bridge,
    derivedSpace: derivation.space,
  };
}

/**
 * PARAMETER-001 — 读取策略版本包（canonical 文档 + 5 类投影 + §17 追溯记录）。
 *
 * 🔴 为什么必须 `hasDefinition = true`：FIXED / TUNABLE / DERIVED 分类**只**存在于 canonical
 *   `definition.parameters[].parameterRole`；历史 v1 文档的 `parameters`（有损视图）**没有 role**。
 *   缺定义时若回落 legacy 视图 = 凭猜测决定「谁能被搜索」——那正是 R-05 要根治的缺陷。
 *   ⇒ 响亮拒绝，并要求先补 canonical 定义。
 */
async function loadStrategyBundle(
  strategyId: string,
  strategyVersion: string,
): Promise<Awaited<ReturnType<DbStrategyRepository["getVersionBundle"]>> & object> {
  const bundle = await new DbStrategyRepository().getVersionBundle(strategyId, strategyVersion);
  if (bundle === undefined) {
    throw new ResearchValidationError([
      {
        code: "PARAMETER_SEARCH_STRATEGY_VERSION_NOT_FOUND",
        path: "strategyVersion",
        message: `库中不存在策略版本 ${strategyId}@${strategyVersion}`,
      },
    ]);
  }
  if (!bundle.hasDefinition) {
    throw new ResearchValidationError([
      {
        code: "PARAMETER_SEARCH_STRATEGY_DEFINITION_MISSING",
        path: "strategyVersion",
        message:
          `${strategyId}@${strategyVersion} 缺 canonical 富定义（历史 v1 文档）⇒ 无 parameterRole 可读，`
          + `无法区分 FIXED / TUNABLE / DERIVED；禁止凭 legacy 有损视图猜测可搜索性。`,
      },
    ]);
  }
  return bundle;
}

/**
 * PARAMETER-002 — 策略**规则图实际引用**的参数 code（决定一个 TUNABLE 参数是不是「死参数」）。
 *
 * 唯一权威收集器 = `strategyCore/ruleGraph.ts#collectRuleParameterReferences`（入口规则图 +
 * 出场规则图），另加声明式出场规则（阈值型出场可携带 `parameterCode`）。
 *
 * 🔴 为什么必须有这一层：参数「声明在 schema 里」**不等于**「决策引擎会读它」。
 *   实测 `cand-360001@1.0.0` 声明 3 个 TUNABLE 参数、规则图引用 **0** 个 ⇒
 *   3 组不同取值产出的权益曲线**逐字节相同**。
 *
 * 决策引擎不可构造（存量 v1 文档 / Core 构造失败）⇒ 返回 `null`（**不做**筛查并如实说明），
 * 绝不假装查过。
 */
function referencedParameterCodesOf(document: StrategyDocument): {
  readonly refs: ReadonlySet<string> | null;
  readonly note: string;
} {
  const core = coreVersionFromDocument({ document, createdAt: new Date().toISOString() });
  if (!core.ok) {
    return {
      refs: null,
      note:
        `⚠️ 未做死参数筛查：Core 定义不可构造（${core.reason}）⇒ 决策引擎为既有配方，`
        + "参数由配方门槛消费，本层无法枚举其引用面。",
    };
  }
  const refs = new Set<string>(collectRuleParameterReferences(core.version.definition.ruleGraph));
  const exitGraph = core.version.definition.exitRuleGraph;
  if (exitGraph !== null) {
    for (const code of collectRuleParameterReferences(exitGraph)) refs.add(code);
  }
  for (const rule of core.version.definition.exitRules) {
    const code = (rule as { readonly parameterCode?: unknown }).parameterCode;
    if (typeof code === "string" && code !== "") refs.add(code);
  }
  return {
    refs,
    note:
      `死参数筛查已启用：规则图引用 ${String(refs.size)} 个参数`
      + `（${[...refs].sort().join(" / ") || "（无）"}）。`,
  };
}

// ---------------------------------------------------------------------------
// ROBUSTNESS-001 — 稳健性分析（下游消费者；零重跑、零指标重算）
// ---------------------------------------------------------------------------
import {
  createRobustnessRunInputSchema,
  listRobustnessResultsInputSchema,
  listRobustnessRunsInputSchema,
  robustnessRunIdInputSchema,
  searchRobustnessCreateResultSchema,
  searchRobustnessExecuteOutcomeSchema,
  searchRobustnessResultPageSchema,
  searchRobustnessRunDetailSchema,
  searchRobustnessRunViewSchema,
} from "../shared/searchRobustnessContracts";
import {
  buildMatrixForRun,
  cancelSearchRobustnessRun,
  computeRobustnessProgress,
  createSearchRobustnessRun,
  listSearchRobustnessParameterAnalyses,
  listSearchRobustnessResults,
  listSearchRobustnessRuns,
  readSearchRobustnessRun,
  startSearchRobustnessRun,
} from "./research/searchRobustness";
import {
  createOosValidationInputSchema,
  getOosResultInputSchema,
  listOosValidationRunsInputSchema,
  oosValidationCreateResultSchema,
  oosValidationExecuteOutcomeSchema,
  oosValidationResultViewSchema,
  oosValidationRunDetailSchema,
  oosValidationRunIdInputSchema,
  oosValidationRunViewSchema,
} from "../shared/oosValidationContracts";
import {
  cancelOosValidationRun,
  createOosValidationRun,
  definitionFingerprintOfDocument,
  listOosValidationRuns,
  readOosValidationResult,
  readOosValidationRun,
  startOosValidationRun,
} from "./research/oosValidation";
// WALK-FORWARD-001 — Walk-Forward 验证（时间滚动编排层；**只调用**上面两个域的
// application service，不走 HTTP 自调用、不新建 Router）。
import {
  cancelWalkForwardRun as cancelWalkForwardValidationRun,
  createWalkForwardRun as createWalkForwardValidationRunService,
  listWalkForwardRuns as listWalkForwardValidationRunsService,
  readWalkForwardFold as readWalkForwardValidationFoldService,
  readWalkForwardRunDetail,
  startWalkForwardRun as startWalkForwardValidationRunService,
} from "./research/walkForward/executor";
import type {
  WalkForwardExecutionHooks,
  WalkForwardRunView,
} from "./research/walkForward/types";
import {
  createWalkForwardValidationInputSchema,
  listWalkForwardRunsInputSchema,
  walkForwardCancelOutcomeSchema,
  walkForwardCreateResultSchema,
  walkForwardExecuteOutcomeSchema,
  walkForwardFoldInputSchema,
  walkForwardFoldViewSchema,
  walkForwardRunDetailSchema,
  walkForwardRunIdInputSchema,
  walkForwardRunViewSchema,
} from "../shared/walkForwardContracts";

// ---------------------------------------------------------------------------
// 鲁棒性：扰动生成 + 扰动条目 → 回测选项映射
// ---------------------------------------------------------------------------

function costDeclarationToBacktestOptions(decl: CostModelDeclaration): LeaderCandidateBacktestOptions {
  return {
    realistic: {
      commissionRate: decl.commissionRate,
      stampDutyRate: decl.stampDutyRate,
      transferFeeRate: decl.transferFeeRate,
      slippageBps: decl.slippageBps,
      lotSize: decl.lotSize,
    },
  };
}

function executionDeclarationToBacktestOptions(
  decl: ExecutionConstraintDeclaration,
): LeaderCandidateBacktestOptions {
  const realistic: RealisticBacktestOptions = {};
  if (decl.positions.maxPositionCount !== null) {
    realistic.maxPositions = decl.positions.maxPositionCount;
  }
  return Object.keys(realistic).length > 0 ? { realistic } : {};
}

/** 扰动条目 → 生产回测可选字段（按轴分支；仅映射可执行维度）。 */
function perturbationToBacktestOptions(item: PerturbationItem): LeaderCandidateBacktestOptions {
  switch (item.axis) {
    case "cost":
    case "slippage":
      return costDeclarationToBacktestOptions(item.config);
    case "parameter":
      return parameterSetToBacktestOptions(item.config);
    case "execution":
      return executionDeclarationToBacktestOptions(item.config);
  }
}

/** 按轴生成技术预览扰动清单（首条恒为基准条目；只扰动可映射到回测的维度）。 */
function generatePreviewPerturbations(axis: PerturbationItem["axis"], baseParameterSet: ResearchParameterSet): readonly PerturbationItem[] {
  switch (axis) {
    case "cost":
      // 只扰动佣金 / 印花税 / 过户费（均可映射到 realistic 费率）；市场冲击不可映射故不扰动。
      return generateCostStressVariants(A_SHARE_DEFAULT_COST_DECLARATION, {
        commissionRateFactors: [2, 4],
        stampDutyRateFactors: [2, 4],
        transferFeeRateFactors: [2, 4],
      }).variants;
    case "slippage":
      return generateSlippageStressVariants(A_SHARE_DEFAULT_COST_DECLARATION, {
        factors: [2, 4],
      }).variants;
    case "parameter": {
      const rules = ["maxHoldingDays", "stopLossPercent"]
        .filter((name) => typeof baseParameterSet[name] === "number" && Number.isFinite(baseParameterSet[name]))
        .map((name) => ({ parameterName: name, additiveSteps: [-2, 2] as const }));
      return generateParameterPerturbationVariants(baseParameterSet, { rules }).variants;
    }
    case "execution":
      // 只扰动并发持仓上限（映射 realistic.maxPositions）；成交时机 / 部分成交不可映射故显式不扰动。
      return generateExecutionPerturbationVariants(
        createExecutionConstraintDeclaration({ initialCapital: 100_000 }),
        { executionModels: [], allowPartialFillValues: [], maxPositionCountValues: [2, 8, null] },
      ).variants;
  }
}

/** 预计算扰动清单的评估产物（串行；身份 Map：引擎按同引用迭代扰动清单，故可按键定位）。 */
async function precomputePerturbationOutcomes(
  perturbations: readonly PerturbationItem[],
  range: { startDate: string; endDate: string } = previewRange(),
): Promise<Map<PerturbationItem, RobustnessSampleOutcome>> {
  const map = new Map<PerturbationItem, RobustnessSampleOutcome>();
  for (const item of perturbations) {
    try {
      const result = await getLeaderCandidateBacktest({
        ...perturbationToBacktestOptions(item),
        ...range,
      });
      map.set(item, toSearchOutcome(result.realisticSimulation) as RobustnessSampleOutcome);
    } catch (error) {
      map.set(item, { status: "failed", error: errorMessage(error) });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// 随机化：源序列推导（生产回测 → dailyReturns / tradeReturns + 基准绩效）
// ---------------------------------------------------------------------------

/** equityCurve 逐点收益率（小数；+0.01 = +1%）。 */
function dailyReturnsFromEquityCurve(sim: RealisticBacktestResult): number[] {
  const curve = sim.equityCurve;
  const returns: number[] = [];
  for (let index = 1; index < curve.length; index++) {
    const prev = curve[index - 1]!.equity;
    const current = curve[index]!.equity;
    if (prev > 0) returns.push(current / prev - 1);
  }
  return returns;
}

/** 已平仓 trade 收益（小数；netReturn 为 %，除以 100）。 */
function tradeReturnsFromSimulation(sim: RealisticBacktestResult): number[] {
  return sim.trades
    .filter((trade) => trade.netReturn !== null && trade.netReturn !== undefined && Number.isFinite(trade.netReturn))
    .map((trade) => trade.netReturn! / 100);
}

// ---------------------------------------------------------------------------
// zod 输入 schema（本文件内联；不含函数字段）
// ---------------------------------------------------------------------------

const sweepParameterSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("number"),
    name: z.string().min(1),
    min: z.number(),
    max: z.number(),
    step: z.number(),
  }),
  z.object({
    type: z.literal("integer"),
    name: z.string().min(1),
    min: z.number(),
    max: z.number(),
    step: z.number(),
  }),
  z.object({
    type: z.literal("boolean"),
    name: z.string().min(1),
    values: z.array(z.boolean()).optional(),
  }),
  z.object({
    type: z.literal("enum"),
    name: z.string().min(1),
    values: z.array(z.string()),
  }),
]);

const parameterSpaceSchema = z.object({ parameters: z.array(sweepParameterSchema) });

const parameterSetSchema = z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()]));

const regionAnalysisSchema = z
  .object({
    minReturnPct: z.number().optional(),
    maxDrawdownPct: z.number().optional(),
    maxBadPointRatePct: z.number().optional(),
    minQualifiedSamples: z.number().int().optional(),
    maxCandidates: z.number().int().optional(),
    requireStableCandidates: z.boolean().optional(),
  })
  .optional();

const thresholdsSchema = z
  .object({
    returnDriftThresholdPct: z.number().min(0).optional(),
    drawdownWorseningThresholdPct: z.number().min(0).optional(),
  })
  .optional();

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const runInputSchema = z.object({
  method: z.enum(["grid", "random"]),
  strategyId: z.string().min(1).optional(),
  strategyVersion: z.string().min(1).optional(),
  parameterSpace: parameterSpaceSchema,
  /**
   * 决策窗口（**策略评估路径必需**）。
   *
   * 给了 `strategyId` + `strategyVersion` + 本组两个日期，且库中确有该版本时，
   * 评估改走**策略评估端口**（真实闭环），参数空间亦改为**从文档派生**（入参 parameterSpace 仅 legacy 路径使用）。
   */
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
  seed: z.number().int().optional(),
  budget: z.number().int().min(1).optional(),
  maxCombinations: z.number().int().min(1).optional(),
  analysis: regionAnalysisSchema,
});

const rollingInputSchema = z.object({
  method: z.enum(["grid", "random"]),
  strategyId: z.string().min(1).optional(),
  strategyVersion: z.string().min(1).optional(),
  parameterSpace: parameterSpaceSchema,
  tradeDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
  windowConfig: z.object({
    windowLength: z.number().int().min(1),
    stepLength: z.number().int().min(1),
    maxWindows: z.number().int().min(1).nullable().optional(),
  }),
  analysis: regionAnalysisSchema,
  stability: z
    .object({
      minEvaluatedWindows: z.number().int().min(1).optional(),
      maxCandidates: z.number().int().min(1).nullable().optional(),
    })
    .optional(),
  seed: z.number().int().optional(),
  budget: z.number().int().min(1).optional(),
  maxCombinations: z.number().int().min(1).optional(),
});

const robustnessInputSchema = z.object({
  axis: z.enum(["cost", "slippage", "parameter", "execution"]),
  strategyId: z.string().min(1).optional(),
  strategyVersion: z.string().min(1).optional(),
  parameterSet: parameterSetSchema.optional(),
  thresholds: thresholdsSchema,
});

const stochasticInputSchema = z.object({
  method: z.enum(["monteCarlo", "bootstrap", "orderRandomization"]),
  seed: z.number().int(),
  strategyId: z.string().min(1).optional(),
  strategyVersion: z.string().min(1).optional(),
  iterations: z.number().int().min(1).optional(),
  alpha: z.number().gt(0).lt(1).optional(),
  annualizationFactor: z.number().positive().optional(),
  monteCarloMode: z.enum(["dailyReturn", "tradeReturn"]).optional(),
  tailDrawdownThresholdPct: z.number().min(0).optional(),
  minIterationsForVerdict: z.number().int().min(1).optional(),
  thresholds: thresholdsSchema,
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WALK-FORWARD-001 — 执行钩子装配（组合根）
// ---------------------------------------------------------------------------

/**
 * 装配 Walk-Forward 的执行钩子（规格 §15：**复用** OOS-001 与 Parameter Search 的
 * application service；**禁止** `WalkForward → HTTP → OOS API → HTTP → Backtest`）。
 *
 * 本函数就是「零复制」的落点：
 *   - 每个 Fold 的搜索 = `createParameterSearchRun` + `executeParameterSearchRun`
 *     （搜索窗口**硬绑**该 Fold 的 IS 区间）；
 *   - 每个 Fold 的样本外 = `createOosValidationRun` + `startOosValidationRun`
 *     （候选只能用 `parameterHash` 指定 —— 参数值由 OOS 域从源组合行读出并**重算 hash 复核**）。
 *
 * 🔴 回执里的坐标一律**从落库的行读回**（`getParameterSearchRunRow` / `executed.run`），
 *   不是把请求参数原样回传 —— 否则领域层的泄漏守卫就退化成「自己证明自己」。
 */
async function buildWalkForwardExecutionHooks(
  run: WalkForwardRunView,
): Promise<WalkForwardExecutionHooks> {
  const bundle = await loadStrategyBundle(run.strategyId, run.strategyVersion);
  const document = bundle.document;
  const reference = referencedParameterCodesOf(document);
  const datasetWindow =
    run.datasetVersionId === null ? null : await readDatasetVersionWindow(run.datasetVersionId);
  const documentFingerprint = definitionFingerprintOfDocument(document);
  const codeVersion = bundle.versionRecord.codeVersion;

  return {
    readCurrentContext: async () => {
      // 重新按**冻结的** strategyId@version 读一次策略包（不是「当前最新版本」）
      const fresh = await loadStrategyBundle(run.strategyId, run.strategyVersion);
      const fingerprint = definitionFingerprintOfDocument(fresh.document);
      /**
       * 🔴 数据集坐标的「当前值」按**两处权威的一致性**取，而不是直接把冻结值回传
       *   （否则 `assertDatasetVersionUnchanged` 就成了恒真的空转）：
       *     - Run 行上冻结的 `datasetVersionId`（运行时唯一权威坐标）；
       *     - **当前**策略文档解析出的主数据集绑定。
       *   两者都非空且不相等 ⇒ 文档绑定在执行前被改过 ⇒ 返回文档侧的值，
       *   让领域层以 `WALK_FORWARD_DATASET_VERSION_DRIFT` 响亮拒绝（规格 §10：不自动修复）。
       *   只在「两个权威打架」时才报，不对「调用方显式指定了与文档不同的数据集」误报。
       */
      const documentBoundDatasetId = resolvePrimaryDatasetVersionId(fresh.document);
      const conflicted =
        run.datasetVersionId !== null
        && documentBoundDatasetId !== null
        && documentBoundDatasetId !== run.datasetVersionId;
      return {
        strategyFingerprint: fingerprint.fingerprint,
        datasetVersionId: conflicted ? documentBoundDatasetId : run.datasetVersionId,
        datasetVersionLabel: run.datasetVersionLabel,
        // 窗口按**冻结坐标**重新读一次 ⇒ 泄漏守卫用的是「此刻真实可用的数据范围」
        datasetWindow,
      };
    },

    runFoldSearch: async (request) => {
      const created = await createParameterSearchRun({
        strategyId: request.strategyId,
        strategyVersion: request.strategyVersion,
        datasetVersionId: run.datasetVersionId,
        datasetVersionLabel: run.datasetVersionLabel,
        // 🔴 搜索窗口 = 该 Fold 的 IS 窗口（唯一取值来源；不得放宽，也不得看未来）
        startDate: request.isWindow.startDate,
        endDate: request.isWindow.endDate,
        searchMethod: run.searchMethod as ParameterSearchMethod,
        projectionParameters: bundle.projections.parameters,
        ...(reference.refs === null ? {} : { referencedParameterCodes: reference.refs }),
        ...(datasetWindow === null ? {} : { datasetWindow }),
        ...(request.maxCombinations === null ? {} : { maxCombinations: request.maxCombinations }),
      });
      const searchRunId = created.run.searchRunId;
      const executed = await executeParameterSearchRun(searchRunId, {
        document,
        codeVersion,
        ...(request.maxCombinations === null ? {} : { maxCombinations: request.maxCombinations }),
      });
      const [runRow, combinations, results] = await Promise.all([
        getParameterSearchRunRow(searchRunId),
        listParameterSearchCombinationRows(searchRunId),
        listParameterSearchResultRows(searchRunId),
      ]);
      if (runRow === null) {
        throw new ResearchValidationError([
          {
            code: "WALK_FORWARD_FOLD_SEARCH_ROW_MISSING",
            path: "sourceSearchRunId",
            message: `Fold 搜索 Run ${searchRunId} 落库后回读为空 ⇒ 拒绝把不存在的搜索当作已执行。`,
          },
        ]);
      }
      const searchStart = String(runRow.startDate);
      const searchEnd = String(runRow.endDate);
      return {
        searchRunId,
        // 从落库行读回的真实窗口（泄漏守卫判据 ①）
        searchWindow: { startDate: searchStart, endDate: searchEnd },
        // 该窗口内**真实存在的交易日**（唯一日历来源 = index_daily）⇒ 让判据 ⑤ 真正生效
        searchTradeDates: await getIndexDailyTradeDates(searchStart, searchEnd),
        combinations: combinations.map((row) => ({
          combinationIndex: row.combinationIndex,
          parameterHash: row.parameterHash,
          parametersJson: row.parametersJson,
        })),
        results: results.map((row) => ({
          combinationIndex: row.combinationIndex,
          parameterHash: row.parameterHash,
          status: row.status,
          metrics: {
            totalReturnPct: row.totalReturnPct,
            annualizedReturnPct: row.annualizedReturnPct,
            maxDrawdownPct: row.maxDrawdownPct,
            tradeCount: row.tradeCount,
            winRatePct: row.winRatePct,
            profitFactor: row.profitFactor,
          },
          metricsSource: row.metricsSource,
        })),
        notes: [
          `该 Fold 的**独立**搜索 Run = ${searchRunId}（窗口 ${searchStart}..${searchEnd}，`
            + `组合 ${String(combinations.length)} 个，本次评估 ${String(executed.evaluatedCount)} 次、`
            + `跳过 ${String(executed.skippedCount)} 次、缓存复用 ${String(executed.reusedFromCacheCount)} 次）`,
          reference.note,
          ...created.derivationNotes,
          ...executed.notes,
        ],
      };
    },

    runFoldOos: async (request) => {
      const created = await createOosValidationRun({
        sourceSearchRunId: request.sourceSearchRunId,
        parameterHash: request.parameterHash,
        oosWindow: request.oosWindow,
        strategyDefinitionFingerprint: documentFingerprint.fingerprint,
        definitionFingerprintNote: documentFingerprint.note,
      });
      const oosRunId = created.run.oosRunId;
      const executed = await startOosValidationRun(oosRunId, {
        document,
        codeVersion,
        currentDefinitionFingerprint: documentFingerprint.fingerprint,
      });
      const result = executed.result;
      return {
        oosRunId,
        executed: executed.executed,
        // 从落库的 Run 视图读回真实窗口（不是回传入参；泄漏守卫判据 ④）
        oosWindow: {
          startDate: executed.run.oosWindow.startDate,
          endDate: executed.run.oosWindow.endDate,
        },
        oosRunStatus: executed.run.status,
        oosMetrics: result === null ? null : result.oosMetrics,
        oosMetricsSource: result === null ? null : result.oosMetricsSource,
        comparison: result === null ? null : result.comparison,
        oosBacktestFingerprint: result === null ? null : result.backtestFingerprint,
        notes: [...created.notes, ...executed.notes],
      };
    },
  };
}

export const paramSearchRouter = router({
  /** 引擎配置默认值 / 参数空间字典 / 方法枚举（供前端表单填充，字段名逐字取自引擎常量）。 */
  describe: publicProcedure.query(() => ({
    methods: ["grid", "random"] as const,
    stochasticMethods: [...STOCHASTIC_METHODS],
    robustnessAxes: ["cost", "slippage", "parameter", "execution"] as const,
    defaultParameterSpace: DEFAULT_PREVIEW_PARAMETER_SPACE,
    mappableParameters: MAPPABLE_PARAMETER_DICTIONARY,
    defaults: {
      randomSearchBudget: DEFAULT_RANDOM_SEARCH_BUDGET,
      gridMaxCombinations: DEFAULT_MAX_COMBINATIONS,
      regionAnalysis: { ...DEFAULT_REGION_ANALYSIS_CONFIG },
      rollingStability: { ...DEFAULT_ROLLING_STABILITY_CONFIG },
      robustnessThresholds: { ...DEFAULT_ROBUSTNESS_THRESHOLDS },
      stochastic: {
        iterations: STOCHASTIC_DEFAULT_ITERATIONS,
        alpha: STOCHASTIC_DEFAULT_ALPHA,
        annualizationFactor: STOCHASTIC_DEFAULT_ANNUALIZATION_FACTOR,
        tailDrawdownThresholdPct: STOCHASTIC_DEFAULT_TAIL_DRAWDOWN_THRESHOLD_PCT,
        minIterationsForVerdict: STOCHASTIC_DEFAULT_MIN_ITERATIONS_FOR_VERDICT,
      },
    },
    /** 策略评估路径说明（入参齐备时评估标量改由**真实闭环**产出，参数空间从文档派生）。 */
    strategyEvaluation: {
      requiredInputs: [
        "strategyId",
        "strategyVersion",
        "startDate",
        "endDate",
      ] as const,
      note:
        "四者齐备且库中存在该版本时：评估标量来自策略评估端口（真实闭环 data→research→strategy→backtest→evaluation），"
          + "参数空间从文档 parameters 派生；否则回落 legacy 生产回测，返回里的 evaluationSource 会如实标注。",
    },
    preview: {
      maxCombinations: PREVIEW_MAX_COMBINATIONS,
      range: previewRange(),
      note:
        "技术预览：参数空间组合数上限 64；评估标量由生产回测 realisticSimulation 同步查表注入，非 RESEARCH_READY 口径（R7）。回测区间默认取最近约 2 年（内存安全铁律，见 preview.range）。",
    },
  })),

  /** C-17.1 Grid / Random 参数搜索：预计算回测 → 查表求值器 → runParameterSearch。 */
  run: publicProcedure.input(runInputSchema).mutation(async ({ input }) => {
    const space = input.parameterSpace;
    const createdAt = new Date().toISOString();
    const evaluation = await resolveStrategyEvaluation({
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      startDate: input.startDate,
      endDate: input.endDate,
      createdAt,
      codeVersion: "unknown",
    });
    // 🔴 策略评估路径下参数空间**以文档为准**（入参那个是 legacy 8 维度，对策略文档不存在）。
    const effectiveSpace = evaluation.derivedSpace ?? space;
    // 🔴 上限按路径分档：策略评估每组都是一次完整闭环回测（数秒级），
    //    沿用预览的 64 组会变成分钟级同步阻塞；legacy 路径保持原上限不变。
    const strategyPath = evaluation.bridge !== undefined;
    const combinationLimit = strategyPath ? STRATEGY_EVALUATION_MAX_COMBINATIONS : PREVIEW_MAX_COMBINATIONS;
    const total = calculateCombinationCount(effectiveSpace);
    // 🔴 判据是**实际计划评估数**而非全组合数：random 只采样 min(budget, 全组合) 组，
    //    按全组合判会把「1240 组空间 × budget=12」这种完全正当的请求误拦。
    const plannedEvaluations =
      input.method === "grid" ? total : Math.min(input.budget ?? DEFAULT_RANDOM_SEARCH_BUDGET, total);
    if (plannedEvaluations > combinationLimit) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `本次计划评估 ${plannedEvaluations} 组（参数空间全组合 ${total}）`
            + `超过${strategyPath ? "策略评估" : "技术预览"}上限 ${combinationLimit}`
            + "，请缩小参数空间（维度 × 档数）"
            + (strategyPath
                ? "；或改用 method=random 并调小 budget —— 策略评估每组都是一次完整闭环回测（数秒级）。"
                : "。"),
      });
    }
    const range =
      input.startDate !== undefined && input.endDate !== undefined
        ? { startDate: input.startDate, endDate: input.endDate }
        : previewRange();
    const parameterSets = gridParameterSets(effectiveSpace);
    const outcomes = await precomputeParameterSetOutcomes(parameterSets, range, evaluation.bridge);

    const evaluator: ParameterSearchEvaluator = (set) =>
      outcomes.get(parameterSetKey(set)) ?? {
        status: "failed",
        error: "该参数组合未预计算（服务端装配缺陷）",
      };

    try {
      const run = runParameterSearch({
        method: input.method,
        strategyId: input.strategyId ?? DEFAULT_STRATEGY_ID,
        strategyVersion: input.strategyVersion ?? DEFAULT_STRATEGY_VERSION,
        parameterSpace: effectiveSpace,
        evaluator,
        seed: input.seed,
        budget: input.budget,
        maxCombinations: input.maxCombinations,
        analysis: input.analysis,
      });
      // 🔴 如实标注口径来源（禁静默）：调用方据此分辨「数字是不是真实策略闭环来的」
      return {
        ...run,
        evaluationSource: evaluation.source,
        evaluationNote: evaluation.note,
        effectiveParameterSpace: effectiveSpace,
      };
    } catch (error) {
      throw toTrpcError(error);
    }
  }),

  /** C-17.2 Rolling Optimization：逐窗预计算回测 → 窗内查表求值器工厂。 */
  rolling: publicProcedure.input(rollingInputSchema).mutation(async ({ input }) => {
    const space = input.parameterSpace;
    const total = calculateCombinationCount(space);
    if (total > PREVIEW_MAX_COMBINATIONS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `参数空间组合数 ${total} 超过技术预览上限 ${PREVIEW_MAX_COMBINATIONS}，请缩小参数空间。`,
      });
    }
    const parameterSets = gridParameterSets(space);

    // 用与引擎相同的窗口配置解析 + 窗口生成，保证逐窗日期范围与引擎一致。
    const resolved = resolveRollingWindowConfig(input.windowConfig);
    if (resolved.config === null) throw toTrpcError(new ResearchValidationError(resolved.issues));
    const windows = generateRollingOptimizationWindows(input.tradeDates, resolved.config);

    const windowOutcomes: Map<string, ParameterSearchSampleOutcome>[] = [];
    for (const window of windows) {
      windowOutcomes.push(
        await precomputeParameterSetOutcomes(parameterSets, {
          startDate: window.firstTradeDate,
          endDate: window.lastTradeDate,
        }),
      );
    }

    const evaluatorFactory: RollingOptimizationEvaluatorFactory = (window: RollingOptimizationWindowContext) => {
      const map = windowOutcomes[window.windowIndex] ?? new Map<string, ParameterSearchSampleOutcome>();
      return (set) =>
        map.get(parameterSetKey(set)) ?? {
          status: "failed",
          error: "该参数组合在该窗口未预计算（服务端装配缺陷）",
        };
    };

    try {
      return runRollingOptimization({
        strategyId: input.strategyId ?? DEFAULT_STRATEGY_ID,
        strategyVersion: input.strategyVersion ?? DEFAULT_STRATEGY_VERSION,
        method: input.method,
        parameterSpace: space,
        tradeDates: input.tradeDates,
        evaluatorFactory,
        windowConfig: input.windowConfig,
        analysis: input.analysis,
        stability: input.stability,
        seed: input.seed,
        budget: input.budget,
        maxCombinations: input.maxCombinations,
      });
    } catch (error) {
      throw toTrpcError(error);
    }
  }),

  /** C-18.1 四轴扰动鲁棒性：生成扰动清单 → 预计算回测 → 查表求值器。 */
  robustness: publicProcedure.input(robustnessInputSchema).mutation(async ({ input }) => {
    const baseParameterSet = input.parameterSet ?? DEFAULT_PREVIEW_PARAMETER_SET;
    const perturbations = generatePreviewPerturbations(input.axis, baseParameterSet);
    const outcomes = await precomputePerturbationOutcomes(perturbations);

    const evaluator: RobustnessEvaluator = (item) =>
      outcomes.get(item) ?? { status: "failed", error: "该扰动条目未预计算（服务端装配缺陷）" };

    const now = new Date();
    const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
    const robustnessRunId = `${ROBUSTNESS_RUN_ID_PREFIX}-${date}-${randomBytes(4).toString("hex").toUpperCase()}`;

    try {
      return runRobustnessStress({
        strategyId: input.strategyId ?? DEFAULT_STRATEGY_ID,
        strategyVersion: input.strategyVersion ?? DEFAULT_STRATEGY_VERSION,
        perturbations,
        thresholds: input.thresholds,
        evaluator,
        robustnessRunId,
        createdAt: now.toISOString(),
      });
    } catch (error) {
      throw toTrpcError(error);
    }
  }),

  /** C-18.2 随机化鲁棒性：从生产回测推导源序列 + 基准绩效 → runStochasticRobustness。 */
  stochastic: publicProcedure.input(stochasticInputSchema).mutation(async ({ input }) => {
    const result = await getLeaderCandidateBacktest(previewRange());
    const sim = result.realisticSimulation;

    const dailyReturns = dailyReturnsFromEquityCurve(sim);
    const tradeReturns = tradeReturnsFromSimulation(sim);

    // 源序列合法性前置校验（给出比引擎更清晰的可读错误）。
    const needsDaily = input.method === "monteCarlo" && input.monteCarloMode !== "tradeReturn";
    const needsTrade = input.method !== "monteCarlo" || input.monteCarloMode === "tradeReturn";
    if (needsDaily && dailyReturns.length < 2) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `monteCarlo 日收益重采样需要 >= 2 个权益点，实际权益曲线点 ${sim.equityCurve.length}（数据未就绪）。`,
      });
    }
    if (needsTrade && tradeReturns.length < 2) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${input.method} 需要 >= 2 笔已平仓交易收益，实际 ${tradeReturns.length} 笔（数据未就绪）。`,
      });
    }

    const baseline: StochasticMetricsView = {
      totalReturnPct: sim.totalReturn,
      maxDrawdownPct: sim.maxDrawdown,
      sharpe: null,
      tradeCount: sim.tradeCount,
    };

    try {
      return runStochasticRobustness({
        strategyId: input.strategyId ?? DEFAULT_STRATEGY_ID,
        strategyVersion: input.strategyVersion ?? DEFAULT_STRATEGY_VERSION,
        method: input.method,
        seed: input.seed,
        stochasticRunId: generateStochasticRobustnessRunId(input.method, input.seed),
        createdAt: new Date().toISOString(),
        iterations: input.iterations,
        alpha: input.alpha,
        annualizationFactor: input.annualizationFactor,
        monteCarloMode: input.monteCarloMode,
        tailDrawdownThresholdPct: input.tailDrawdownThresholdPct,
        minIterationsForVerdict: input.minIterationsForVerdict,
        thresholds: input.thresholds,
        dailyReturns,
        tradeReturns,
        tradeCount: sim.tradeCount,
        baseline,
      });
    } catch (error) {
      throw toTrpcError(error);
    }
  }),

  // =========================================================================
  // PARAMETER-001 — Parameter Search 完整闭环（持久化）
  //
  // 与上方技术预览端点（run / rolling / robustness / stochastic）的分工：
  //   - 上方：**内存态**技术预览，结果跑完即弃（不落库）；
  //   - 本组：**持久化**搜索 Run（可回看 / 可续跑 / 可重试），执行链同样复用评估端口。
  // 两组共用同一 domain（`server/research/parameterSearch/**`），不构成第二套体系。
  // =========================================================================

  /** 创建 Search Run：只落 Run + 组合计划（**不执行回测**；执行走 `startSearch`）。 */
  createSearch: publicProcedure
    .input(createParameterSearchInputSchema)
    .output(parameterSearchCreateResultSchema)
    .mutation(async ({ input }) => {
      try {
        const bundle = await loadStrategyBundle(input.strategyId, input.strategyVersion);
        const document = bundle.document;
        const datasetVersionId =
          input.datasetVersionId ?? resolvePrimaryDatasetVersionId(document);
        /**
         * PARAMETER-002 §9（N-01）— **前置窗口校验**：读数据集窗口，越界即拒。
         *
         * 目的是避免「创建 Search → N 个组合全部因窗口越界失败 → 白付 N 次回测」
         * （N-02 排查中实测：4 个组合 62 s 全失败）。日期口径按**北京业务日**比较
         * （`dataset_version.startDate/endDate` 是 UTC 时间戳，直接取日会少一天）。
         */
        const datasetWindow =
          datasetVersionId === null ? null : await readDatasetVersionWindow(datasetVersionId);
        /** PARAMETER-002 — 死参数筛查引用面（Core 规则图）。 */
        const reference = referencedParameterCodesOf(document);
        const created = await createParameterSearchRun({
          strategyId: input.strategyId,
          strategyVersion: input.strategyVersion,
          datasetVersionId,
          datasetVersionLabel: resolvePrimaryDatasetVersionLabel(document),
          startDate: input.startDate,
          endDate: input.endDate,
          searchMethod: input.searchMethod,
          projectionParameters: bundle.projections.parameters,
          ...(input.parameterSearchSpace === undefined
            ? {}
            : {
                domainOverrides: input.parameterSearchSpace.map((item) => ({
                  name: item.name,
                  domain: item.domain,
                })),
              }),
          ...(reference.refs === null ? {} : { referencedParameterCodes: reference.refs }),
          ...(datasetWindow === null ? {} : { datasetWindow }),
          ...(input.maxCombinations === undefined ? {} : { maxCombinations: input.maxCombinations }),
          ...(input.datasetSourcePolicy === undefined
            ? {}
            : { datasetSourcePolicy: input.datasetSourcePolicy }),
        });
        return {
          run: created.run,
          summary: {
            searchable: [...created.summary.searchable],
            fixed: [...created.summary.fixed],
            derived: [...created.summary.derived],
            excluded: created.summary.excluded.map((item) => ({ ...item })),
          },
          derivationNotes: [reference.note, ...created.derivationNotes],
          referenceCheckApplied: created.referenceCheckApplied,
          unreferencedTunableCodes: [...created.unreferencedTunableCodes],
        };
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** Search 列表（不含参数空间快照长文本）。 */
  listSearches: publicProcedure
    .input(listParameterSearchRunsInputSchema)
    .output(parameterSearchRunViewSchema.array())
    .query(async ({ input }) => {
      try {
        return await listParameterSearchRuns({
          limit: input.limit ?? 50,
          ...(input.offset === undefined ? {} : { offset: input.offset }),
          ...(input.strategyId === undefined ? {} : { strategyId: input.strategyId }),
        });
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** Search 详情：Run（含参数空间快照）+ 进度 + 组合计划。 */
  getSearch: publicProcedure
    .input(parameterSearchRunIdInputSchema)
    .output(parameterSearchRunDetailSchema)
    .query(async ({ input }) => {
      try {
        const run = await readParameterSearchRun(input.searchRunId);
        if (run === null) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `[PARAMETER_SEARCH_RUN_NOT_FOUND] searchRunId: Search Run 不存在：${input.searchRunId}`,
          });
        }
        return {
          run,
          progress: computeRunProgress({
            combinationCount: run.combinationCount,
            completedCount: run.completedCount,
            failedCount: run.failedCount,
          }),
          combinations: await listParameterSearchCombinations(input.searchRunId),
        };
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** 启动 / 续跑（Resume + Cache）。 */
  startSearch: publicProcedure
    .input(executeParameterSearchInputSchema)
    .output(parameterSearchExecuteOutcomeSchema)
    .mutation(async ({ input }) => {
      try {
        const run = await readParameterSearchRun(input.searchRunId);
        if (run === null) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `[PARAMETER_SEARCH_RUN_NOT_FOUND] searchRunId: Search Run 不存在：${input.searchRunId}`,
          });
        }
        const bundle = await loadStrategyBundle(run.strategyId, run.strategyVersion);
        return await executeParameterSearchRun(input.searchRunId, {
          document: bundle.document,
          codeVersion: bundle.versionRecord.codeVersion,
          ...(input.maxCombinations === undefined ? {} : { maxCombinations: input.maxCombinations }),
        });
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** 取消（对正在执行的循环生效：下一个组合前重读状态即停）。 */
  cancelSearch: publicProcedure
    .input(parameterSearchRunIdInputSchema)
    .output(parameterSearchRunViewSchema)
    .mutation(async ({ input }) => {
      try {
        return await cancelParameterSearchRun(input.searchRunId);
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** 结果列表（排序 / 过滤在服务端做；**不产出「最佳参数」结论**）。 */
  getSearchResults: publicProcedure
    .input(listParameterSearchResultsInputSchema)
    .output(parameterSearchResultPageSchema)
    .query(async ({ input }) => {
      try {
        return await listParameterSearchResults(input.searchRunId, {
          ...(input.sortBy === undefined ? {} : { sortBy: input.sortBy }),
          ...(input.sortDirection === undefined ? {} : { sortDirection: input.sortDirection }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.minTradeCount === undefined ? {} : { minTradeCount: input.minTradeCount }),
          ...(input.maxDrawdownPct === undefined ? {} : { maxDrawdownPct: input.maxDrawdownPct }),
          ...(input.minTotalReturnPct === undefined
            ? {}
            : { minTotalReturnPct: input.minTotalReturnPct }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.offset === undefined ? {} : { offset: input.offset }),
        });
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** 重试单个失败组合（`force` 才允许重跑已成功的组合 —— 那会覆盖已有结果）。 */
  retrySearchCombination: publicProcedure
    .input(retryParameterSearchCombinationInputSchemaV2)
    .output(parameterSearchExecuteOutcomeSchema)
    .mutation(async ({ input }) => {
      try {
        const run = await readParameterSearchRun(input.searchRunId);
        if (run === null) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `[PARAMETER_SEARCH_RUN_NOT_FOUND] searchRunId: Search Run 不存在：${input.searchRunId}`,
          });
        }
        const bundle = await loadStrategyBundle(run.strategyId, run.strategyVersion);
        return await retryParameterSearchCombination(input.searchRunId, input.parameterHash, {
          document: bundle.document,
          codeVersion: bundle.versionRecord.codeVersion,
          ...(input.force === undefined ? {} : { force: input.force }),
        });
      } catch (error) {
        throw toTrpcError(error);
      }
    }),
  // =========================================================================
  // ROBUSTNESS-001 — Search-Result Robustness Analysis（消费冻结结果 · 零重跑）
  //
  // 🔴 与上方技术预览端点（`robustness` / `stochastic`）的**分工必须分清**：
  //   - `robustness` / `stochastic`：C-18.1 / C-18.2，对**一条已评估策略**做
  //     扰动 / 随机化**重估** ⇒ 内部注入 evaluator 并**重跑**回测；
  //   - 本组：消费**已经算完**的 Parameter Search 结果，在**冻结快照**上做邻域稳定性分析
  //     ⇒ **零重跑、零指标重算**（判据：`searchRobustness/**` 不 import 任何 backtest /
  //     评估端口，只读 `parameter_search_*` 三表）。
  // 两组同属 `robustness:` 域，但输入与执行语义不同，因此**并列不合并**
  //   （同 `robustness` 与 `stochasticRobustness` 的既有并列关系；见 searchRobustness/index.ts 文件头）。
  // 另外：本组**不产出**「最佳 / 最优 / 推荐参数」——只给稳定性、敏感性、离散度与描述性排序。
  // =========================================================================

  /** 创建分析：对某个**已完成**的 Search Run 建稳健性分析（只做 gate + 冻结快照 + 落 Run 行）。 */
  createRobustnessRun: publicProcedure
    .input(createRobustnessRunInputSchema)
    .output(searchRobustnessCreateResultSchema)
    .mutation(async ({ input }) => {
      try {
        const created = await createSearchRobustnessRun({
          sourceSearchRunId: input.sourceSearchRunId,
          ...(input.analysisConfig === undefined ? {} : { analysisConfig: input.analysisConfig }),
        });
        return { run: created.run, notes: [...created.notes] };
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** 分析列表（可按源 Search Run 过滤；不取冻结快照长文本）。 */
  listRobustnessRuns: publicProcedure
    .input(listRobustnessRunsInputSchema)
    .output(searchRobustnessRunViewSchema.array())
    .query(async ({ input }) => {
      try {
        return await listSearchRobustnessRuns({
          limit: input.limit ?? 50,
          ...(input.offset === undefined ? {} : { offset: input.offset }),
          ...(input.sourceSearchRunId === undefined
            ? {}
            : { sourceSearchRunId: input.sourceSearchRunId }),
        });
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** 分析详情：Run（含冻结快照与口径）+ 进度 + 单参数分析 + 二维稳定性矩阵。 */
  getRobustnessRun: publicProcedure
    .input(robustnessRunIdInputSchema)
    .output(searchRobustnessRunDetailSchema)
    .query(async ({ input }) => {
      try {
        const run = await readSearchRobustnessRun(input.robustnessRunId);
        if (run === null) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `[ROBUSTNESS_RUN_NOT_FOUND] robustnessRunId: 稳健性分析不存在：${input.robustnessRunId}`,
          });
        }
        return {
          run,
          progress: computeRobustnessProgress({
            sourceCombinationCount: run.summary.sourceCombinationCount,
            analyzedCombinationCount: run.summary.analyzedCombinationCount,
          }),
          parameterAnalyses: await listSearchRobustnessParameterAnalyses(input.robustnessRunId),
          matrix: await buildMatrixForRun(input.robustnessRunId),
        };
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** 执行分析（重跑 = 确定性重算并覆盖同一批行；幂等键 = `(robustnessRunId, parameterHash)`）。 */
  startRobustnessRun: publicProcedure
    .input(robustnessRunIdInputSchema)
    .output(searchRobustnessExecuteOutcomeSchema)
    .mutation(async ({ input }) => {
      try {
        const outcome = await startSearchRobustnessRun({
          robustnessRunId: input.robustnessRunId,
        });
        return {
          run: outcome.run,
          resultCount: outcome.resultCount,
          parameterCount: outcome.parameterCount,
          notes: [...outcome.notes],
        };
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** 取消（只允许从 CREATED / RUNNING 出发；同态重放幂等）。 */
  cancelRobustnessRun: publicProcedure
    .input(robustnessRunIdInputSchema)
    .output(searchRobustnessRunViewSchema)
    .mutation(async ({ input }) => {
      try {
        return await cancelSearchRobustnessRun(input.robustnessRunId);
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** 结果列表（排序 / 过滤在服务端做；**只提供描述性排序，不产出推荐**）。 */
  getRobustnessResults: publicProcedure
    .input(listRobustnessResultsInputSchema)
    .output(searchRobustnessResultPageSchema)
    .query(async ({ input }) => {
      try {
        return await listSearchRobustnessResults(input.robustnessRunId, {
          ...(input.sortBy === undefined ? {} : { sortBy: input.sortBy }),
          ...(input.sortDirection === undefined ? {} : { sortDirection: input.sortDirection }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.neighborhoodIncompleteOnly === undefined
            ? {}
            : { neighborhoodIncompleteOnly: input.neighborhoodIncompleteOnly }),
          ...(input.minTradeCount === undefined ? {} : { minTradeCount: input.minTradeCount }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.offset === undefined ? {} : { offset: input.offset }),
        });
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  // =========================================================================
  // OOS-001 — Out-of-Sample Validation（消费冻结结果 · **必须重跑**）
  //
  // 🔴 与上方 ROBUSTNESS-001 的**分工必须分清**（两者语义相反，不是同一件事的两种做法）：
  //   - `searchRobustness/**`：冻结结果上的邻域稳定性分析 ⇒ **零重跑、零重算**；
  //   - 本组：在**未参与搜索**的 OOS 窗口上**重新执行 Backtest 并重算 canonical metrics**
  //     ⇒ **必须重跑**（判据：本组 import `backtestBridge` / `projectCanonicalMetrics`，
  //     而 `searchRobustness/**` 被静态守卫测试钉死不 import 任何回测 / 评估端口）。
  // 两组同属「消费 Parameter Search 结果」的输入姿态，因此**并列不合并**
  //   （同 `robustness` 与 `stochasticRobustness` 的既有并列关系；见
  //   `server/research/oosValidation/index.ts` 文件头）。
  //
  // 🔴 本组**不产出**「最佳 / 最优 / 推荐 / 更优参数」：
  //   `createOosRun` 的入参里**没有参数值位置**（只有 `parameterHash`）⇒
  //   「OOS 不允许调参」是接口层事实，而不是注释里的承诺（规格 §5）。
  // =========================================================================

  /**
   * 创建 OOS 验证：**只冻结配置，不执行**（规格 §14：`create` 与 `start` 必须区分）。
   *
   * 本端点只做「读源 → 窗口隔离 → 冻结候选 → IS 读数 canonical 门禁 → 落 Run 行」，
   * **不跑任何回测**。真正执行必须显式再调 `startOosRun`。
   */
  createOosRun: publicProcedure
    .input(createOosValidationInputSchema)
    .output(oosValidationCreateResultSchema)
    .mutation(async ({ input }) => {
      try {
        /**
         * 先自读一次源 Run：**只为**拿到 `strategyId@version` 去 load 策略文档，
         * 好在**创建时**就把「定义指纹」冻进 Run 行（规格 §8 要求记录 definition fingerprint）。
         * 真正的门禁判定仍全部在领域层做 —— 这里读到 null 就按同一领域码响亮拒绝。
         */
        const sourceRunRow = await getParameterSearchRunRow(input.sourceSearchRunId);
        if (sourceRunRow === null) {
          throw new ResearchValidationError([
            {
              code: "OOS_SOURCE_RUN_NOT_FOUND",
              path: "sourceSearchRunId",
              message: `源 Parameter Search Run 不存在：${input.sourceSearchRunId}`,
            },
          ]);
        }
        const bundle = await loadStrategyBundle(
          sourceRunRow.strategyId,
          sourceRunRow.strategyVersion,
        );
        const definitionFingerprint = definitionFingerprintOfDocument(bundle.document);
        const created = await createOosValidationRun({
          sourceSearchRunId: input.sourceSearchRunId,
          parameterHash: input.parameterHash,
          oosWindow: input.oosWindow,
          strategyDefinitionFingerprint: definitionFingerprint.fingerprint,
          definitionFingerprintNote: definitionFingerprint.note,
          ...(input.metricsVersion === undefined ? {} : { metricsVersion: input.metricsVersion }),
        });
        return { run: created.run, notes: [...created.notes] };
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** OOS Run 列表（可按源 Search Run 过滤；不取冻结快照长文本）。 */
  listOosRuns: publicProcedure
    .input(listOosValidationRunsInputSchema)
    .output(oosValidationRunViewSchema.array())
    .query(async ({ input }) => {
      try {
        return await listOosValidationRuns({
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.offset === undefined ? {} : { offset: input.offset }),
          ...(input.sourceSearchRunId === undefined
            ? {}
            : { sourceSearchRunId: input.sourceSearchRunId }),
        });
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** OOS Run 详情：Run（含冻结快照 / 窗口 / 口径）+ Result（可为 null —— `CREATED` 态的正常形态）。 */
  getOosRun: publicProcedure
    .input(oosValidationRunIdInputSchema)
    .output(oosValidationRunDetailSchema)
    .query(async ({ input }) => {
      try {
        const run = await readOosValidationRun(input.oosRunId);
        if (run === null) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `[OOS_RUN_NOT_FOUND] oosRunId: OOS 验证不存在：${input.oosRunId}`,
          });
        }
        return { run, result: await readOosValidationResult(input.oosRunId) };
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /**
   * 执行 OOS 验证（**真正重跑 Backtest、真正重算 canonical metrics**；规格 §9）。
   *
   * 🔴 `COMPLETED` 不允许再次执行（规格 §12）：已完成的 Run 走**幂等返回**
   *   （`executed: false` + 既有结果），既有的 OOS 产物不会被重跑覆盖。
   */
  startOosRun: publicProcedure
    .input(oosValidationRunIdInputSchema)
    .output(oosValidationExecuteOutcomeSchema)
    .mutation(async ({ input }) => {
      try {
        const run = await readOosValidationRun(input.oosRunId);
        if (run === null) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `[OOS_RUN_NOT_FOUND] oosRunId: OOS 验证不存在：${input.oosRunId}`,
          });
        }
        /**
         * 策略文档按 **Run 行上冻结的 `strategyId@strategyVersion`** 加载
         * —— **不是**「当前最新版本」（规格 §8）。
         * 领域层还会再比对一次身份（`OOS_STRATEGY_VERSION_MISMATCH`）并复核定义指纹
         * （`OOS_STRATEGY_DEFINITION_DRIFT`），所以这一步不构成「信任调用方」。
         */
        const bundle = await loadStrategyBundle(run.strategyId, run.strategyVersion);
        const currentFingerprint = definitionFingerprintOfDocument(bundle.document);
        const outcome = await startOosValidationRun(input.oosRunId, {
          document: bundle.document,
          codeVersion: bundle.versionRecord.codeVersion,
          currentDefinitionFingerprint: currentFingerprint.fingerprint,
        });
        return {
          run: outcome.run,
          executed: outcome.executed,
          result: outcome.result,
          notes: [...outcome.notes],
        };
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** 取消（只允许从 CREATED / RUNNING 出发；`COMPLETED` 不可取消；同态重放幂等）。 */
  cancelOosRun: publicProcedure
    .input(oosValidationRunIdInputSchema)
    .output(oosValidationRunViewSchema)
    .mutation(async ({ input }) => {
      try {
        return await cancelOosValidationRun(input.oosRunId);
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** 读取 OOS 结果（IS / OOS 逐项指标 + derived 对照；不存在 ⇒ `null`）。 */
  getOosResult: publicProcedure
    .input(getOosResultInputSchema)
    .output(oosValidationResultViewSchema.nullable())
    .query(async ({ input }) => {
      try {
        return await readOosValidationResult(input.oosRunId);
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  // =========================================================================
  // WALK-FORWARD-001 — Walk-Forward 验证（时间滚动编排；规格 §13）
  //
  // 定位：**编排层**，不是新引擎。它只负责「时间滚动 + Fold 隔离 + 结果汇总 + 可追溯」，
  // 每一步的策略求值 / 回测 / 指标都由既有唯一权威完成（规格 §3 / §6 / §15）。
  //
  // 🔴 本组**不产出**「最佳 / 最优 / 推荐 Fold」、不做策略评级、不自动淘汰 ——
  //   候选选择策略是**显式声明并写进快照**的（见 `WALK_FORWARD_SELECTION_POLICIES`），
  //   多 Fold 汇总**只做描述性统计**（规格 §7 / §12）。
  //
  // 🔴 本组**不**新建独立 Router：与 PS / OOS / 稳健性端点同挂本 Router（规格 §13）。
  // =========================================================================

  /**
   * 创建 Walk-Forward 验证：**只冻结排程与身份，不执行**（规格 §6 Step A / §14）。
   *
   * 本端点只做「读策略文档 → 读数据集窗口 → 读交易日序列 → 生成 Fold → 落两表」，
   * **不跑任何搜索、任何回测**。真正执行必须显式再调 `startWalkForwardRun`。
   */
  createWalkForwardRun: publicProcedure
    .input(createWalkForwardValidationInputSchema)
    .output(walkForwardCreateResultSchema)
    .mutation(async ({ input }) => {
      try {
        const bundle = await loadStrategyBundle(input.strategyId, input.strategyVersion);
        const document = bundle.document;
        const datasetVersionId = input.datasetVersionId ?? resolvePrimaryDatasetVersionId(document);
        const fingerprint = definitionFingerprintOfDocument(document);
        const created = await createWalkForwardValidationRunService({
          request: input,
          strategyVersionId: `${input.strategyId}@${input.strategyVersion}`,
          strategyFingerprint: fingerprint.fingerprint,
          datasetVersionId,
          datasetVersionLabel: resolvePrimaryDatasetVersionLabel(document),
          /**
           * 交易日序列唯一来源 = `index_daily`（既有约定）；取样区间 = 窗口配置的
           * `startDate..endDate`，域层会再按该区间投影一次（两侧都收口，不重复实现日历）。
           */
          tradeDates: await getIndexDailyTradeDates(
            input.windowConfig.startDate,
            input.windowConfig.endDate,
          ),
          datasetWindow:
            datasetVersionId === null ? null : await readDatasetVersionWindow(datasetVersionId),
        });
        return { run: created.run, folds: [...created.folds], notes: [...created.notes] };
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** Walk-Forward Run 列表（可按策略过滤；不取排程 / 汇总长文本之外的额外内容）。 */
  listWalkForwardRuns: publicProcedure
    .input(listWalkForwardRunsInputSchema)
    .output(walkForwardRunViewSchema.array())
    .query(async ({ input }) => {
      try {
        return [...(await listWalkForwardValidationRunsService(input))];
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** Run 详情：Run（含冻结排程 / 选择策略 / 汇总）+ 全部 Fold（按序号升序）。 */
  getWalkForwardRun: publicProcedure
    .input(walkForwardRunIdInputSchema)
    .output(walkForwardRunDetailSchema)
    .query(async ({ input }) => {
      try {
        const detail = await readWalkForwardRunDetail(input.walkForwardRunId);
        if (detail === null) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              `[WALK_FORWARD_RUN_NOT_FOUND] walkForwardRunId: Walk-Forward 验证不存在：`
              + input.walkForwardRunId,
          });
        }
        return { run: detail.run, folds: [...detail.folds] };
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** 单个 Fold 详情（不含地给出它自己的 Search Run / OOS Run 身份，便于逐 Fold 追溯）。 */
  getWalkForwardFold: publicProcedure
    .input(walkForwardFoldInputSchema)
    .output(walkForwardFoldViewSchema)
    .query(async ({ input }) => {
      try {
        const fold = await readWalkForwardValidationFoldService(input);
        if (fold === null) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              `[WALK_FORWARD_FOLD_NOT_FOUND] foldIndex: Fold 不存在：`
              + `${input.walkForwardRunId}/folds[${String(input.foldIndex)}]`,
          });
        }
        return fold;
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /**
   * 执行 Walk-Forward 验证（**逐 Fold 串行真跑搜索 + 真跑样本外**；规格 §6 Step B~D）。
   *
   * 🔴 `COMPLETED` 不允许再次执行（规格 §12）：已完成的 Run 走**幂等返回**
   *   （`executed: false` + 既有 Fold），既不重跑也不重算。
   */
  startWalkForwardRun: publicProcedure
    .input(walkForwardRunIdInputSchema)
    .output(walkForwardExecuteOutcomeSchema)
    .mutation(async ({ input }) => {
      try {
        const detail = await readWalkForwardRunDetail(input.walkForwardRunId);
        if (detail === null) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              `[WALK_FORWARD_RUN_NOT_FOUND] walkForwardRunId: Walk-Forward 验证不存在：`
              + input.walkForwardRunId,
          });
        }
        /**
         * 策略文档按 **Run 行上冻结的 `strategyId@strategyVersion`** 加载，**不是**「当前最新版本」；
         * 域层还会在执行前比对定义指纹与数据集坐标（规格 §10 FAIL LOUDLY），
         * 所以这一步不构成「信任调用方」。
         */
        const hooks = await buildWalkForwardExecutionHooks(detail.run);
        const outcome = await startWalkForwardValidationRunService({
          walkForwardRunId: input.walkForwardRunId,
          hooks,
        });
        return {
          run: outcome.run,
          executed: outcome.executed,
          folds: [...outcome.folds],
          notes: [...outcome.notes],
        };
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /**
   * 取消（**协作式**：在当前 Fold 走完后的下一个 Fold 边界生效；`COMPLETED` 不可取消）。
   *
   * 为什么不是「立即中止」：执行是一个进程内的串行 Fold 循环，无法从外部打断已经发出的一次
   * 搜索 / 回测；假装立即停止会让 Fold 行出现无法审计的中间态（规格 §9：不得改语义）。
   */
  cancelWalkForwardRun: publicProcedure
    .input(walkForwardRunIdInputSchema)
    .output(walkForwardCancelOutcomeSchema)
    .mutation(async ({ input }) => {
      try {
        const cancelled = await cancelWalkForwardValidationRun(input);
        return { run: cancelled.run, notes: [...cancelled.notes] };
      } catch (error) {
        throw toTrpcError(error);
      }
    }),
});

export type ParamSearchRouter = typeof paramSearchRouter;
