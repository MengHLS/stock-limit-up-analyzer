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
import { getLeaderCandidateBacktest } from "./db";
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
// 技术预览常量
// ---------------------------------------------------------------------------

/** 技术预览参数空间组合数上限：超过即拒绝，避免预计算过多回测拖慢响应。 */
const PREVIEW_MAX_COMBINATIONS = 64;

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
): Promise<Map<string, ParameterSearchSampleOutcome>> {
  const map = new Map<string, ParameterSearchSampleOutcome>();
  for (const set of parameterSets) {
    const key = parameterSetKey(set);
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

const runInputSchema = z.object({
  method: z.enum(["grid", "random"]),
  strategyId: z.string().min(1).optional(),
  strategyVersion: z.string().min(1).optional(),
  parameterSpace: parameterSpaceSchema,
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
    const total = calculateCombinationCount(space);
    if (total > PREVIEW_MAX_COMBINATIONS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `参数空间组合数 ${total} 超过技术预览上限 ${PREVIEW_MAX_COMBINATIONS}，请缩小参数空间（维度 × 档数）。`,
      });
    }
    // 全组合枚举（total <= 上限，无截断）；random 采样落在同一离散格点上，查表覆盖。
    const parameterSets = gridParameterSets(space);
    const outcomes = await precomputeParameterSetOutcomes(parameterSets);

    const evaluator: ParameterSearchEvaluator = (set) =>
      outcomes.get(parameterSetKey(set)) ?? {
        status: "failed",
        error: "该参数组合未预计算（服务端装配缺陷）",
      };

    try {
      return runParameterSearch({
        method: input.method,
        strategyId: input.strategyId ?? DEFAULT_STRATEGY_ID,
        strategyVersion: input.strategyVersion ?? DEFAULT_STRATEGY_VERSION,
        parameterSpace: space,
        evaluator,
        seed: input.seed,
        budget: input.budget,
        maxCombinations: input.maxCombinations,
        analysis: input.analysis,
      });
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
});

export type ParamSearchRouter = typeof paramSearchRouter;
