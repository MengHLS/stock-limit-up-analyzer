/**
 * FE-7 — Walk-Forward / OOS 隔离 / 过拟合检测 tRPC Router
 *（STEP 19 C-19.1 Walk-Forward Optimization + C-19.2 OOS Isolation
 *  + STEP 20 C-20.1 Overfitting Detection）。
 *
 * 纪律（对齐 researchRouter FE-5 / paramSearchRouter FE-6 的「技术预览」哲学 + R7 隔离）：
 * - **只读复用**：调用 C-19.1 runWalkForward / C-19.2 runOosIsolation /
 *   C-20.1 runOverfittingDetection 既有纯函数，不重写任何语义；本层只做
 *   「传输 → 领域」边界投递 + **注入式评估器装配**；
 * - **评估器装配（关键）**：这些引擎的请求对象含同步注入式评估器（把参数集映射为
 *   绩效标量），而生产回测 getLeaderCandidateBacktest 是**异步**的（读 DB），且 tRPC
 *   无法跨网络序列化函数。因此本层在**服务端异步预计算**所有参数组合 / 扰动条目的
 *   回测结果到 Map，再构造**同步查表求值器**交给纯函数引擎；
 * - **WFO 窗口几何预生成**：为在预计算前获知每窗的 Train/OOS 日期范围，本层用与引擎
 *   相同的 resolveWalkForwardSplitConfig + generateWalkForwardSplits 预先生成窗口，
 *   再按 windowIndex 逐窗预计算 Train（optimizationDates）与 Test（testDates）回测；
 *   同时捕获冻结参数在 Test 段的 OOS 权益曲线（equityCurve → EquityPoint），供 C-19.2
 *   OOS 隔离做段级完整指标评估（CAGR/Sharpe/MaxDD），不伪造连续净值；
 * - **技术预览口径（R7）**：评估标量来自生产回测 realisticSimulation
 *   （totalReturn / maxDrawdown / tradeCount），非 RESEARCH_READY 口径；前端必须醒目
 *   标注「技术预览·非 RESEARCH_READY 口径」；
 * - **响亮失败**：引擎抛出的结构化错误（ResearchValidationError）原样转译为
 *   tRPC BAD_REQUEST（不吞异常、不返回 NaN 假指标）；回测无数据（equityCurve 为空）
 *   时该样本转记 failed（结构化可见），绝不静默给 0 假成功；
 * - **状态不冒充**：C-19/C-20 仍为 CODE_READY，VALIDATED 依赖数据链认证（§0.2 禁止越级）。
 *
 * 参数空间 → 回测映射（技术预览，与 paramSearchRouter FE-6 同口径）：
 *   参数空间的维度名映射到生产回测可选字段（realistic.maxHoldingDays /
 *   realistic.stopLossPercent / minScore / observationDays 等，见
 *   MAPPABLE_PARAMETER_DICTIONARY）。未收录维度会被求值器忽略；describe 端点返回该
 *   字典供前端只选用「真实可映射」的维度。
 */

import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getLeaderCandidateBacktest, loadBacktestBaseContext } from "./db";
import type { LeaderCandidateBacktestOptions } from "./leaderCandidates";
import type { RealisticBacktestOptions, RealisticBacktestResult, RealisticEquityPoint } from "./realisticBacktest";
import { ResearchValidationError } from "./research/experimentValidation";
import type { ParameterSpace } from "./research/parameterSpace";
import { calculateCombinationCount, DEFAULT_MAX_COMBINATIONS } from "./research/combinationGenerator";
import type { ResearchParameterSet } from "./research/types";
import {
  gridParameterSets,
  DEFAULT_RANDOM_SEARCH_BUDGET,
  DEFAULT_REGION_ANALYSIS_CONFIG,
  type ParameterSearchMetricsView,
  type ParameterSearchSampleOutcome,
} from "./research/parameterSearch";
import {
  runWalkForward,
  generateWalkForwardRunId,
  generateWalkForwardSplits,
  resolveWalkForwardSplitConfig,
  DEFAULT_WALK_FORWARD_FREEZE_SELECTION,
  type WalkForwardRun,
  type WalkForwardOptimizeEvaluatorFactory,
  type WalkForwardTestEvaluatorFactory,
} from "./research/walkForwardRun";
import { runOosIsolation } from "./research/oosIsolation";
import {
  runOverfittingDetection,
  DEFAULT_PBO_HIGH_THRESHOLD,
  DEFAULT_PBO_MEDIUM_THRESHOLD,
  type OfdPboInput,
  type OfdPboCandidate,
  type ParameterSensitivityEvaluator,
  type ParameterSensitivityRule,
} from "./research/overfittingDetection";
import {
  generateParameterPerturbationVariants,
  DEFAULT_RETURN_DRIFT_THRESHOLD_PCT,
  DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT,
} from "./research/robustness";
import type { EquityPoint } from "./backtest/types";

// ---------------------------------------------------------------------------
// 技术预览常量
// ---------------------------------------------------------------------------

/** 技术预览参数空间组合数上限：超过即拒绝，避免预计算过多回测拖慢响应。 */
const PREVIEW_MAX_COMBINATIONS = 64;

/** 技术预览 WFO 窗口数上限：约束预计算规模（每窗 train + test 各一遍回测）。 */
const PREVIEW_MAX_WINDOWS = 8;

/** 技术预览 PBO 分区数上限（CSCV 需偶数 >= 4）。 */
const PREVIEW_MAX_PBO_PARTITIONS = 16;

/** 技术预览默认研究策略身份（前端可覆盖；与生产 leader-candidate-baseline 对齐）。 */
const DEFAULT_STRATEGY_ID = "leader-candidate-baseline";
const DEFAULT_STRATEGY_VERSION = "0.1.0";

/** 技术预览默认参数空间：2 维 × 2 档 = 4 组合，保证逐窗预计算可交互。 */
const DEFAULT_PREVIEW_PARAMETER_SPACE: ParameterSpace = {
  parameters: [
    { type: "integer", name: "maxHoldingDays", min: 3, max: 5, step: 2 },
    { type: "number", name: "stopLossPercent", min: 5, max: 8, step: 3 },
  ],
};

/** 技术预览默认窗口划分配置（单位：交易日）。 */
const DEFAULT_PREVIEW_SPLIT_CONFIG = {
  mode: "rolling" as const,
  trainWindow: 20,
  testWindow: 5,
  step: 5,
  gap: 0,
  embargo: 0,
  maxWindows: 6,
};

/**
 * 参数空间维度 → 生产回测可选字段字典（与 paramSearchRouter FE-6 保持一致）。
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

/** 生产回测 realisticSimulation → 绩效标量（同口径，仅字段映射）。 */
function simulationToMetrics(sim: RealisticBacktestResult): ParameterSearchMetricsView {
  return {
    totalReturnPct: sim.totalReturn,
    maxDrawdownPct: sim.maxDrawdown,
    tradeCount: sim.tradeCount,
  };
}

/** 回测数据为空（equityCurve 无点）→ failed；否则映射为 succeeded 标量。 */
function toSearchOutcome(sim: RealisticBacktestResult): ParameterSearchSampleOutcome {
  if (sim.equityCurve.length === 0) {
    return { status: "failed", error: "回测未产生权益曲线（equityCurve 为空，数据未就绪）" };
  }
  return { status: "succeeded", metrics: simulationToMetrics(sim) };
}

/** 生产回测权益点 → 研究层 EquityPoint（marketValue = equity - cash 派生）。 */
function toEquityPoint(point: RealisticEquityPoint): EquityPoint {
  return {
    date: point.date,
    cash: point.cash,
    marketValue: Number((point.equity - point.cash).toFixed(4)),
    equity: point.equity,
    openPositions: point.openPositions,
  };
}

/** 单个参数集在给定日期范围上的回测：绩效标量 + OOS 权益曲线。 */
async function runBacktestForSet(
  set: ResearchParameterSet,
  range?: { startDate: string; endDate: string },
): Promise<{ outcome: ParameterSearchSampleOutcome; curve: EquityPoint[] }> {
  try {
    const result = await getLeaderCandidateBacktest({
      ...parameterSetToBacktestOptions(set),
      ...(range ? { startDate: range.startDate, endDate: range.endDate } : {}),
    });
    const sim = result.realisticSimulation;
    return {
      outcome: toSearchOutcome(sim),
      curve: sim.equityCurve.map(toEquityPoint),
    };
  } catch (error) {
    return { outcome: { status: "failed", error: errorMessage(error) }, curve: [] };
  }
}

/** 预计算一组参数集的回测结果（并发；单参数集失败转记 failed，不整体抛错）。 */
async function precomputeOutcomes(
  parameterSets: readonly ResearchParameterSet[],
  range?: { startDate: string; endDate: string },
): Promise<Map<string, ParameterSearchSampleOutcome>> {
  const map = new Map<string, ParameterSearchSampleOutcome>();
  const entries = await Promise.all(
    parameterSets.map(async (set) => {
      const { outcome } = await runBacktestForSet(set, range);
      return { key: parameterSetKey(set), outcome };
    }),
  );
  for (const entry of entries) map.set(entry.key, entry.outcome);
  return map;
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

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const splitConfigSchema = z.object({
  mode: z.enum(["rolling", "anchored"]).optional(),
  trainWindow: z.number().int().min(1),
  testWindow: z.number().int().min(1),
  step: z.number().int().min(1),
  gap: z.number().int().min(0).optional(),
  embargo: z.number().int().min(0).optional(),
  maxWindows: z.number().int().min(1).max(PREVIEW_MAX_WINDOWS).optional(),
});

const runInputSchema = z.object({
  method: z.enum(["grid", "random"]),
  strategyId: z.string().min(1).optional(),
  strategyVersion: z.string().min(1).optional(),
  parameterSpace: parameterSpaceSchema,
  splitConfig: splitConfigSchema,
  analysis: regionAnalysisSchema,
  freezeSelection: z.literal("median-qualified").optional(),
  seed: z.number().int().optional(),
  budget: z.number().int().min(1).optional(),
  maxCombinations: z.number().int().min(1).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  tradeDates: z.array(dateSchema).min(1).optional(),
});

const equityPointSchema = z.object({
  date: z.string(),
  cash: z.number(),
  marketValue: z.number(),
  equity: z.number(),
  openPositions: z.number(),
});

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** WalkForwardRun 记录透传（结构由 runOosIsolation 权威校验）。 */
const walkForwardRunSchema = z.custom<WalkForwardRun>(isPlainObject, {
  message: "oos.walkForwardRun 必须是 WalkForwardRun 对象",
});

const oosInputSchema = z.object({
  walkForwardRun: walkForwardRunSchema,
  oosEquityCurves: z.record(z.string(), z.array(equityPointSchema)).optional(),
});

const partitionRangeSchema = z.object({ startDate: dateSchema, endDate: dateSchema });

const sensitivitySpecSchema = z.object({
  baseParameterSet: parameterSetSchema,
  rules: z.array(
    z.object({
      parameterName: z.string().min(1),
      percentSteps: z.array(z.number()).optional(),
      additiveSteps: z.array(z.number()).optional(),
    }),
  ),
  startDate: dateSchema,
  endDate: dateSchema,
});

const overfitInputSchema = z.object({
  strategyId: z.string().min(1).optional(),
  strategyVersion: z.string().min(1).optional(),
  pbo: z.object({
    numPartitions: z.number().int().min(4).max(PREVIEW_MAX_PBO_PARTITIONS),
    metric: z.literal("totalReturnPct"),
    direction: z.enum(["maximize", "minimize"]),
    parameterSpace: parameterSpaceSchema,
    partitionRanges: z.array(partitionRangeSchema).min(2),
  }),
  sensitivity: sensitivitySpecSchema.optional(),
  thresholds: z
    .object({ pboHigh: z.number().optional(), pboMedium: z.number().optional() })
    .optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const walkForwardRouter = router({
  /**
   * 引擎配置默认值 / 窗口几何 / 参数空间字典 / 判定词汇（供前端表单填充，
   * 字段名逐字取自引擎常量）。
   */
  describe: publicProcedure.query(() => ({
    methods: ["grid", "random"] as const,
    freezeSelections: [DEFAULT_WALK_FORWARD_FREEZE_SELECTION],
    pboMetrics: ["totalReturnPct", "sharpeRatio", "custom"] as const,
    pboDirections: ["maximize", "minimize"] as const,
    overfitConclusions: ["OVERFIT", "OVERFIT_RISK", "NOT_OVERFIT", "INCONCLUSIVE", "NO_EVAL"] as const,
    defaultParameterSpace: DEFAULT_PREVIEW_PARAMETER_SPACE,
    defaultSplitConfig: { ...DEFAULT_PREVIEW_SPLIT_CONFIG },
    mappableParameters: MAPPABLE_PARAMETER_DICTIONARY,
    defaults: {
      freezeSelection: DEFAULT_WALK_FORWARD_FREEZE_SELECTION,
      regionAnalysis: { ...DEFAULT_REGION_ANALYSIS_CONFIG },
      pboThresholds: {
        pboHigh: DEFAULT_PBO_HIGH_THRESHOLD,
        pboMedium: DEFAULT_PBO_MEDIUM_THRESHOLD,
      },
      sensitivityThresholds: {
        returnDriftThresholdPct: DEFAULT_RETURN_DRIFT_THRESHOLD_PCT,
        drawdownWorseningThresholdPct: DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT,
      },
      randomSearchBudget: DEFAULT_RANDOM_SEARCH_BUDGET,
      gridMaxCombinations: DEFAULT_MAX_COMBINATIONS,
    },
    windowGeometry: {
      rolling:
        "trainStart=i*step；trainEnd=trainStart+trainWindow；testStart=trainEnd+gap；testEnd=testStart+testWindow（完整窗口条件 testEnd<=tradeDates.length）",
      anchored:
        "trainStart=0；trainEnd=i*step+trainWindow（Train 随窗扩张）；test 段同上；完整窗口条件相同",
      embargo:
        "optimizationDates = trainDates 去掉尾部 embargo 个交易日（防标签重叠泄漏，仍在 trainDates 记档）",
      constraints: [
        "trainWindow - embargo >= 1（优化段至少一个交易日）",
        "testWindow >= 1；step >= 1；gap >= 0；embargo >= 0",
        "maxWindows 为 null 或 >= 1（仅限体积）",
        "Test 段严格晚于 Train 段且集合无重叠（assertWalkForwardSplitInvariants）",
      ],
    },
    preview: {
      maxCombinations: PREVIEW_MAX_COMBINATIONS,
      maxWindows: PREVIEW_MAX_WINDOWS,
      maxPboPartitions: PREVIEW_MAX_PBO_PARTITIONS,
      note:
        "技术预览：评估标量由生产回测 realisticSimulation 同步查表注入，非 RESEARCH_READY 口径（R7）；PBO 仅服务端可计算 totalReturnPct 分区指标。",
    },
  })),

  /**
   * C-19.1 Walk-Forward Optimization：逐窗预计算回测 → 查表求值器工厂 → runWalkForward。
   * 返回 WalkForwardRun + 逐窗 OOS 权益曲线（供 C-19.2 OOS 隔离消费）。
   */
  run: publicProcedure.input(runInputSchema).mutation(async ({ input }) => {
    const space = input.parameterSpace;
    const total = calculateCombinationCount(space);
    if (total > PREVIEW_MAX_COMBINATIONS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `参数空间组合数 ${total} 超过技术预览上限 ${PREVIEW_MAX_COMBINATIONS}，请缩小参数空间（维度 × 档数）。`,
      });
    }
    const hasMappable = space.parameters.some(
      (param) => MAPPABLE_PARAMETER_DICTIONARY[param.name] !== undefined,
    );
    if (!hasMappable) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "参数空间不含任何可映射到生产回测的维度（见 describe.mappableParameters），搜索将无效果。",
      });
    }

    // 解析交易日历：优先客户端注入（可复现 / 测试），否则按 startDate/endDate 服务端加载。
    let tradeDates: string[];
    if (input.tradeDates && input.tradeDates.length > 0) {
      tradeDates = input.tradeDates;
    } else {
      if (!input.startDate || !input.endDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "未提供 tradeDates 时，必须提供 startDate 与 endDate（用于服务端加载交易日历）。",
        });
      }
      const baseContext = await loadBacktestBaseContext({
        startDate: input.startDate,
        endDate: input.endDate,
      });
      tradeDates = baseContext.context.tradingDates ?? [];
    }
    if (tradeDates.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "交易日历为空（数据未就绪或日期区间无数据），无法执行 Walk-Forward。",
      });
    }

    // 用与引擎相同的窗口配置解析 + 窗口生成，保证逐窗日期范围与引擎一致。
    const effectiveSplitConfig = {
      ...input.splitConfig,
      maxWindows: input.splitConfig.maxWindows ?? PREVIEW_MAX_WINDOWS,
    };
    const resolved = resolveWalkForwardSplitConfig(effectiveSplitConfig);
    if (resolved.config === null) {
      throw toTrpcError(new ResearchValidationError([...resolved.issues]));
    }
    const splits = generateWalkForwardSplits(tradeDates, effectiveSplitConfig);

    const parameterSets = gridParameterSets(space);

    // 逐窗预计算 Train（optimizationDates）与 Test（testDates）回测结果 + OOS 权益曲线。
    const trainOutcomes: Map<string, ParameterSearchSampleOutcome>[] = [];
    const testOutcomes: Map<string, ParameterSearchSampleOutcome>[] = [];
    const testCurves: Map<string, EquityPoint[]>[] = [];
    for (const split of splits) {
      const trainRange = {
        startDate: split.optimizationDates[0]!,
        endDate: split.optimizationDates[split.optimizationDates.length - 1]!,
      };
      const testRange = {
        startDate: split.testDates[0]!,
        endDate: split.testDates[split.testDates.length - 1]!,
      };
      const [trainMap, testMap, testCurveMap] = await Promise.all([
        precomputeOutcomes(parameterSets, trainRange),
        precomputeOutcomes(parameterSets, testRange),
        (async () => {
          const map = new Map<string, EquityPoint[]>();
          const entries = await Promise.all(
            parameterSets.map(async (set) => {
              const { curve } = await runBacktestForSet(set, testRange);
              return { key: parameterSetKey(set), curve };
            }),
          );
          for (const entry of entries) map.set(entry.key, entry.curve);
          return map;
        })(),
      ]);
      trainOutcomes.push(trainMap);
      testOutcomes.push(testMap);
      testCurves.push(testCurveMap);
    }

    const optimizeEvaluatorFactory: WalkForwardOptimizeEvaluatorFactory = (context) => {
      const map = trainOutcomes[context.windowIndex] ?? new Map<string, ParameterSearchSampleOutcome>();
      return (set) =>
        map.get(parameterSetKey(set)) ?? {
          status: "failed",
          error: "该参数组合在该窗口未预计算（服务端装配缺陷）",
        };
    };
    const testEvaluatorFactory: WalkForwardTestEvaluatorFactory = (context) => {
      const map = testOutcomes[context.windowIndex] ?? new Map<string, ParameterSearchSampleOutcome>();
      return (set) =>
        map.get(parameterSetKey(set)) ?? {
          status: "failed",
          error: "该参数组合在该窗口未预计算（服务端装配缺陷）",
        };
    };

    try {
      const run = runWalkForward({
        strategyId: input.strategyId ?? DEFAULT_STRATEGY_ID,
        strategyVersion: input.strategyVersion ?? DEFAULT_STRATEGY_VERSION,
        method: input.method,
        parameterSpace: space,
        tradeDates,
        optimizeEvaluatorFactory,
        testEvaluatorFactory,
        splitConfig: effectiveSplitConfig,
        analysis: input.analysis,
        freezeSelection: input.freezeSelection,
        seed: input.seed,
        budget: input.budget,
        maxCombinations: input.maxCombinations,
        runId: generateWalkForwardRunId(),
      });

      // 冻结参数在 Test 段实际使用的 OOS 权益曲线（仅 succeeded 窗）。
      const oosEquityCurves: Record<string, EquityPoint[]> = {};
      for (const window of run.windows) {
        if (window.frozen === null || window.test.status !== "succeeded") continue;
        const curve = testCurves[window.windowIndex]?.get(
          parameterSetKey(window.frozen.parameterSet),
        );
        if (curve && curve.length > 0) {
          oosEquityCurves[window.windowId] = curve;
        }
      }

      return { run, oosEquityCurves };
    } catch (error) {
      throw toTrpcError(error);
    }
  }),

  /**
   * C-19.2 IS/OOS 隔离：接收 WalkForwardRun + 可选 OOS 权益曲线 → runOosIsolation。
   * 曲线由 C-19.1 run 端点捕获并回传（缺窗 → 该窗完整指标 unassessed，仅保留标量）。
   */
  oos: publicProcedure.input(oosInputSchema).mutation(({ input }) => {
    try {
      const oosEquityCurves = new Map<string, readonly EquityPoint[]>(
        Object.entries(input.oosEquityCurves ?? {}),
      );
      return runOosIsolation({
        walkForwardRun: input.walkForwardRun,
        oosEquityCurves,
      });
    } catch (error) {
      throw toTrpcError(error);
    }
  }),

  /**
   * C-20.1 过拟合检测：PBO（CSCV）+ 可选参数敏感性。
   * - PBO 候选分区指标由服务端按 parameterSpace × partitionRanges 预计算（totalReturnPct）；
   * - 参数敏感性扰动由服务端按 baseParameterSet + rules 预生成 + 在 OOS 区间预计算回测。
   */
  overfit: publicProcedure.input(overfitInputSchema).mutation(async ({ input }) => {
    const pbo = input.pbo;
    if (pbo.numPartitions % 2 !== 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `PBO 分区数必须是偶数且 >= 4，实际 ${pbo.numPartitions}（CSCV 切分几何要求）。`,
      });
    }
    if (pbo.partitionRanges.length !== pbo.numPartitions) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `partitionRanges 长度 ${pbo.partitionRanges.length} 必须等于 numPartitions ${pbo.numPartitions}。`,
      });
    }

    const candidateSets = gridParameterSets(pbo.parameterSpace);
    if (candidateSets.length < 2) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `PBO 至少需要 2 个候选参数组合，实际 ${candidateSets.length} 个。`,
      });
    }

    // 逐候选 × 逐分区预计算 totalReturnPct（作为 CSCV 分区指标）。
    const candidates: OfdPboCandidate[] = [];
    for (const set of candidateSets) {
      const metrics: (number | null)[] = [];
      for (const range of pbo.partitionRanges) {
        const { outcome } = await runBacktestForSet(set, {
          startDate: range.startDate,
          endDate: range.endDate,
        });
        metrics.push(
          outcome.status === "succeeded" ? outcome.metrics.totalReturnPct : null,
        );
      }
      candidates.push({
        candidateId: parameterSetKey(set),
        parameterSet: set,
        partitionMetrics: metrics,
      });
    }

    const pboInput: OfdPboInput = {
      numPartitions: pbo.numPartitions,
      candidates,
      metric: "totalReturnPct",
      direction: pbo.direction,
    };

    // 可选参数敏感性：服务端预生成扰动 + 预计算回测 → 注入式评估器。
    let parameterSensitivity:
      | { baseParameterSet: ResearchParameterSet; rules: readonly ParameterSensitivityRule[]; evaluator: ParameterSensitivityEvaluator }
      | undefined;
    if (input.sensitivity) {
      const baseParameterSet = input.sensitivity.baseParameterSet as ResearchParameterSet;
      const rules = input.sensitivity.rules as readonly ParameterSensitivityRule[];
      const { variants } = generateParameterPerturbationVariants(baseParameterSet, { rules });
      const map = new Map<string, ParameterSearchSampleOutcome>();
      const entries = await Promise.all(
        variants.map(async (item) => {
          const set = item.config as ResearchParameterSet;
          const { outcome } = await runBacktestForSet(set, {
            startDate: input.sensitivity!.startDate,
            endDate: input.sensitivity!.endDate,
          });
          return { key: parameterSetKey(set), outcome };
        }),
      );
      for (const entry of entries) map.set(entry.key, entry.outcome);
      const evaluator: ParameterSensitivityEvaluator = (set) =>
        map.get(parameterSetKey(set)) ?? {
          status: "failed",
          error: "该扰动参数集未预计算（服务端装配缺陷）",
        };
      parameterSensitivity = { baseParameterSet, rules, evaluator };
    }

    try {
      return runOverfittingDetection({
        strategyId: input.strategyId ?? DEFAULT_STRATEGY_ID,
        strategyVersion: input.strategyVersion ?? DEFAULT_STRATEGY_VERSION,
        pboInput,
        ...(parameterSensitivity ? { parameterSensitivity } : {}),
        thresholds: input.thresholds,
      });
    } catch (error) {
      throw toTrpcError(error);
    }
  }),
});

export type WalkForwardRouter = typeof walkForwardRouter;
