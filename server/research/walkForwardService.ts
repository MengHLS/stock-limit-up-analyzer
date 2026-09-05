/**
 * STEP 6.5 — Walk-Forward Optimization Service（WFO 编排层）。
 *
 * 职责（orchestration，绝不复制 Backtest Core / 策略 / 成交 / 持仓逻辑）：
 *
 *   runWalkForward：
 *     Window → Experiment/Sweep 候选 → Validation 评估 → Validation-only 选择 → 冻结候选 → OOS 评估
 *
 * 每个窗口独立完成这条链路（§十），并强制窗口独立性（§十一）：窗口 N 的参数选择只依赖该窗口
 * 允许的数据，绝不受其它窗口 OOS 影响（复用 STEP 6.4 的 validationOnly / oosLocked 语义锁）。
 *
 * 复用关系（§二，最高优先级架构原则）：
 *   - Validation / OOS 评估复用 `ResearchEvaluationService`（STEP 6.4）→ `ResearchBacktestExecutor`
 *     → Production Backtest Core；
 *   - 参数选择复用 `selectBestValidationResult`（只接受 Validation 结果，不接受 OOS）；
 *   - 策略版本冻结：候选 snapshot 携带 strategyVersion，评估服务用 `strategyRegistry.get(id, version)`
 *     精确解析（绝不 getLatest，§三十二）；
 *   - 成本模型冻结：`retargetSnapshot` 只改日期、保留冻结 costModel（§三十三）。
 *
 * 本服务只做「决定何时运行、如何划分数据、如何比较结果、如何统计」，不实现任何撮合/手续费/滑点/仓位/风控。
 */

import { createHash } from "node:crypto";
import type { PerformanceMetrics } from "../engine/domain";
import { ResearchValidationError } from "./experimentValidation";
import { analyzeParameterStability, type ParameterStabilityReport } from "./parameterStability";
import { computePbo, type PboInput, type PboResult } from "./pbo";
import {
  assessOverfitting,
  analyzeValidationOos,
  type OverfittingAssessment,
  type OverfittingThresholds,
  type ValidationOosAnalysis,
} from "./overfittingAssessment";
import {
  createResearchEvaluationPlan,
  type ResearchEvaluationPlan,
} from "./trainValidationOos";
import type { ResearchDatasetRange, ResearchDatasetSplit } from "./datasetSplit";
import { ResearchEvaluationService } from "./evaluationService";
import { filterEligibleTrainCandidates, type TrainCandidateResult } from "./trainEvaluation";
import type { FrozenOosCandidate } from "./validationSelection";
import type { SelectionDirection, SelectionMetric } from "./validationSelection";
import type { ResearchExperimentSnapshot, ResearchParameterSet } from "./types";
import {
  assertValidWalkForwardConfig,
  computeWalkForwardConfigFingerprint,
  generateWalkForwardWindows,
  type WalkForwardConfig,
  type WalkForwardMode,
} from "./walkForward";

// ---------------------------------------------------------------------------
// WFO Result 模型
// ---------------------------------------------------------------------------

/** 单个 WFO 窗口的运行结果。 */
export interface WalkForwardWindowResult {
  windowIndex: number;
  windowFingerprint: string;
  mode: WalkForwardMode;
  trainRange: ResearchDatasetRange;
  validationRange: ResearchDatasetRange;
  oosRange: ResearchDatasetRange;
  /** 选中实验 id（selection 失败时为 null）。 */
  experimentId: string | null;
  strategyId: string;
  strategyVersion: string;
  parameters: ResearchParameterSet;
  validationMetric: SelectionMetric;
  validationMetricValue: number | null;
  oosMetrics: PerformanceMetrics | null;
  /** Train 阶段逐候选评估结果（STEP 6.5-FIX-1：Train 真实参与候选形成）。 */
  trainResults: TrainCandidateResult[];
  /** 通过 Train eligibility 的候选 experimentId（进入 Validation 的候选）。 */
  eligibleCandidateIds: string[];
  status: "succeeded" | "failed";
  error?: string;
  /** 冻结候选（完整可追溯：snapshot → 策略版本 + 冻结成本模型）。 */
  frozenCandidate?: FrozenOosCandidate;
}

/** WFO OOS 汇总指标（§十三：无法合理聚合的明确标记 unavailable）。 */
export interface WfoAggregateMetrics {
  oosWindowCount: number;
  oosSucceededCount: number;
  oosFailedCount: number;
  /** 多窗口 OOS 总收益：各窗口 totalReturnPct 简单加总（不复合）。 */
  oosTotalReturnPct: number | null;
  /** 各窗口 totalReturnPct 均值。 */
  oosMeanReturnPct: number | null;
  /** 各窗口 sharpeRatio 均值（仅统计非 null 窗口）。 */
  oosMeanSharpe: number | null;
  /** 各窗口最差回撤（maxDrawdownPct 取最大，即最差）。 */
  oosWorstMaxDrawdownPct: number | null;
  /** 各窗口 winRatePct 均值（仅统计非 null 窗口）。 */
  oosMeanWinRatePct: number | null;
  /** OOS 盈利窗口占比（totalReturnPct > 0 的窗口比例）。 */
  oosWindowWinRate: number | null;
  /** 无法合理跨窗口聚合的指标名（含原因）。 */
  unavailable: string[];
}

/** WFO 完整结果（§十二）。 */
export interface WalkForwardResult {
  planFingerprint: string;
  config: WalkForwardConfig;
  windows: WalkForwardWindowResult[];
  aggregateMetrics: WfoAggregateMetrics;
  parameterStability: ParameterStabilityReport;
  validationOosAnalysis: ValidationOosAnalysis;
  pbo: PboResult | null;
  overfittingAssessment: OverfittingAssessment;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, val]) => [key, canonicalize(val)]),
    );
  }
  return value;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * 由候选参数集派生 fingerprint（缺省 parameterSpaceFingerprint 时使用）。
 * 对参数集 canonical 化后按字典序排序再哈希（顺序无关、确定性）。
 * 注意：此指纹基于「候选参数组合」，与 STEP 6.3 sweep 的 parameterSpaceFingerprint（基于
 * min/max/step 空间定义）语义不同；如需与 sweep 对齐应显式传入 parameterSpaceFingerprint。
 */
function deriveCandidatesFingerprint(candidates: readonly ResearchExperimentSnapshot[]): string {
  const sets = candidates
    .map((candidate) => JSON.stringify(canonicalize(candidate.parameterSet)))
    .sort((left, right) => left.localeCompare(right));
  return sha256Hex(JSON.stringify(sets));
}

/** 由窗口结果计算 WFO OOS 汇总指标。 */
function aggregateOosMetrics(windows: readonly WalkForwardWindowResult[]): WfoAggregateMetrics {
  const succeeded = windows.filter((w) => w.status === "succeeded" && w.oosMetrics !== null);
  const oosWindowCount = windows.length;
  const oosSucceededCount = succeeded.length;
  const oosFailedCount = oosWindowCount - oosSucceededCount;

  const returns = succeeded.map((w) => w.oosMetrics!.totalReturnPct);
  const sharpes = succeeded
    .map((w) => w.oosMetrics!.sharpeRatio)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const drawdowns = succeeded.map((w) => w.oosMetrics!.maxDrawdownPct);
  const winRates = succeeded
    .map((w) => w.oosMetrics!.winRatePct)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  return {
    oosWindowCount,
    oosSucceededCount,
    oosFailedCount,
    oosTotalReturnPct: returns.length === 0 ? null : returns.reduce((sum, value) => sum + value, 0),
    oosMeanReturnPct: returns.length === 0 ? null : returns.reduce((sum, value) => sum + value, 0) / returns.length,
    oosMeanSharpe: sharpes.length === 0 ? null : sharpes.reduce((sum, value) => sum + value, 0) / sharpes.length,
    oosWorstMaxDrawdownPct: drawdowns.length === 0 ? null : Math.max(...drawdowns),
    oosMeanWinRatePct: winRates.length === 0 ? null : winRates.reduce((sum, value) => sum + value, 0) / winRates.length,
    oosWindowWinRate: returns.length === 0 ? null : returns.filter((value) => value > 0).length / returns.length,
    unavailable: [
      "annualizedReturnPct/annualizedVolatilityPct/profitFactor/averageWin/averageLoss/expectancy/tradeCount：跨窗口不可简单聚合，标记 unavailable",
    ],
  };
}

// ---------------------------------------------------------------------------
// WalkForwardService
// ---------------------------------------------------------------------------

export interface WalkForwardServiceDeps {
  evaluationService: ResearchEvaluationService;
}

export interface RunWalkForwardInput {
  config: WalkForwardConfig;
  /** 候选实验快照（每个参数组合一个，来自 Sweep；策略身份必须一致）。 */
  candidates: readonly ResearchExperimentSnapshot[];
  /** 与 sweep 对齐的参数空间 fingerprint（缺省由候选参数集派生）。 */
  parameterSpaceFingerprint?: string;
  /** 可选的独立 CSCV 分区矩阵（用于 PBO；缺省 pbo = null）。 */
  pboInput?: PboInput;
  /** 过拟合阈值（缺省 DEFAULT_OVERFITTING_THRESHOLDS）。 */
  thresholds?: OverfittingThresholds;
}

export class WalkForwardService {
  constructor(private readonly deps: WalkForwardServiceDeps) {}

  /**
   * 运行 WFO：逐窗口执行 Train → Validation → Selection → Freeze → OOS，并汇总
   * 稳定性 / degradation / PBO / overfitting assessment。
   *
   * 窗口独立性（§十一）：每个窗口独立走完整链路，Selection 只依赖该窗口 Validation；
   * 单个窗口 selection/OOS 失败记录为 failed（不吞异常、不 return 空结果）。
   */
  async runWalkForward(input: RunWalkForwardInput): Promise<WalkForwardResult> {
    assertValidWalkForwardConfig(input.config);
    if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
      throw new Error("runWalkForward: candidates 必须非空");
    }

    // 策略身份一致性（全部候选同 strategyId + strategyVersion）。
    const base = input.candidates[0]!;
    for (const candidate of input.candidates) {
      if (candidate.strategyId !== base.strategyId || candidate.strategyVersion !== base.strategyVersion) {
        throw new Error(
          `runWalkForward: 候选策略身份不一致（${base.strategyId}@${base.strategyVersion} vs ${candidate.strategyId}@${candidate.strategyVersion}）`,
        );
      }
    }

    const parameterSpaceFingerprint = input.parameterSpaceFingerprint ?? deriveCandidatesFingerprint(input.candidates);
    const windows = generateWalkForwardWindows(input.config);
    const windowResults: WalkForwardWindowResult[] = [];

    for (const window of windows) {
      windowResults.push(await this.runWindow(input, window, parameterSpaceFingerprint, base));
    }

    const parameterStability = analyzeParameterStability(
      windowResults.filter((w) => w.status === "succeeded").map((w) => w.parameters),
    );

    const validationOosAnalysis = analyzeValidationOos(
      windowResults
        .filter((w) => w.status === "succeeded")
        .map((w) => ({
          windowIndex: w.windowIndex,
          validationValue: w.validationMetricValue ?? 0,
          oosMetricValue: resolveOosMetricValue(w, input.config.selectionMetric),
        })),
      input.config.selectionMetric,
      input.config.selectionDirection,
    );

    const pbo = input.pboInput === undefined ? null : computePbo(input.pboInput);
    const overfittingAssessment = assessOverfitting({
      pbo,
      parameterStability,
      validationOosAnalysis,
      thresholds: input.thresholds,
    });

    return {
      planFingerprint: computeWalkForwardConfigFingerprint(input.config),
      config: structuredClone(input.config),
      windows: windowResults,
      aggregateMetrics: aggregateOosMetrics(windowResults),
      parameterStability,
      validationOosAnalysis,
      pbo,
      overfittingAssessment,
    };
  }

  /** 单窗口执行完整链路。 */
  private async runWindow(
    input: RunWalkForwardInput,
    window: ReturnType<typeof generateWalkForwardWindows>[number],
    parameterSpaceFingerprint: string,
    base: ResearchExperimentSnapshot,
  ): Promise<WalkForwardWindowResult> {
    const split: ResearchDatasetSplit = {
      trainStart: window.trainRange.start,
      trainEnd: window.trainRange.end,
      validationStart: window.validationRange.start,
      validationEnd: window.validationRange.end,
      oosStart: window.oosRange.start,
      oosEnd: window.oosRange.end,
    };
    const plan: ResearchEvaluationPlan = createResearchEvaluationPlan({
      strategyId: base.strategyId,
      strategyVersion: base.strategyVersion,
      split,
      selectionMetric: input.config.selectionMetric,
      selectionDirection: input.config.selectionDirection,
      parameterSpaceFingerprint,
      backtestConfig: base.backtestConfig,
      featureConfig: base.featureConfig,
    });

    const common = {
      windowIndex: window.windowIndex,
      windowFingerprint: window.fingerprint,
      mode: window.mode,
      trainRange: window.trainRange,
      validationRange: window.validationRange,
      oosRange: window.oosRange,
      strategyId: base.strategyId,
      strategyVersion: base.strategyVersion,
      validationMetric: input.config.selectionMetric,
      trainResults: [] as TrainCandidateResult[],
      eligibleCandidateIds: [] as string[],
    };

    try {
      // STEP 6.5-FIX-1：Train 真正参与候选形成（评估 + eligibility 预筛选）。
      const trainResults = await this.deps.evaluationService.evaluateTrain(input.candidates, plan);
      const eligibility = filterEligibleTrainCandidates(trainResults, plan.selectionMetric);
      if (eligibility.eligibleExperimentIds.length === 0) {
        throw new ResearchValidationError([
          {
            code: "WFO_TRAIN_NO_ELIGIBLE_CANDIDATE",
            path: "window.train",
            message: "Train 阶段无候选通过 eligibility（所有候选 Train 评估失败或指标无效，可能为 insufficient_data）",
          },
        ]);
      }
      const eligibleCandidates = input.candidates.filter((candidate) =>
        eligibility.eligibleExperimentIds.includes(candidate.experimentId),
      );

      // Validation 仍是唯一 Selection Authority（§十四）。
      const validationResults = await this.deps.evaluationService.evaluateValidation(eligibleCandidates, plan);
      const selection = this.deps.evaluationService.selectValidationCandidate(validationResults, plan);
      const frozen = this.deps.evaluationService.freezeSelectedCandidate(selection, eligibleCandidates);
      const oos = await this.deps.evaluationService.evaluateOos(frozen, plan);

      return {
        ...common,
        trainResults,
        eligibleCandidateIds: eligibility.eligibleExperimentIds,
        experimentId: selection.selectedExperimentId,
        parameters: structuredClone(frozen.parameters),
        validationMetricValue: selection.selectionValue,
        oosMetrics: oos.status === "succeeded" ? oos.metrics! : null,
        status: oos.status,
        error: oos.status === "failed" ? oos.error : undefined,
        frozenCandidate: frozen,
      };
    } catch (error) {
      // Train / eligibility / selection / 评估前置失败 → 记录为 failed，不吞异常信息。
      return {
        ...common,
        experimentId: null,
        parameters: {},
        validationMetricValue: null,
        oosMetrics: null,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/** 从窗口 OOS 指标解析选择指标值（null → null）。 */
function resolveOosMetricValue(window: WalkForwardWindowResult, metric: SelectionMetric): number | null {
  const raw = window.oosMetrics?.[metric];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

// ---------------------------------------------------------------------------
// 序列化 / 反序列化（§三十六）
// ---------------------------------------------------------------------------

function strictReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`拒绝序列化非有限数字：${String(value)}`);
  }
  return value;
}

/** 序列化 WFO 结果（JSON、确定性）。 */
export function serializeWalkForwardResult(result: WalkForwardResult): string {
  return JSON.stringify(result, strictReplacer);
}

/** 反序列化 WFO 结果（校验 config + 基础结构 + 深拷贝）。 */
export function deserializeWalkForwardResult(json: string): WalkForwardResult {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("反序列化 WFO 结果失败：结果不是对象");
  }
  const result = parsed as WalkForwardResult;
  if (typeof result.planFingerprint !== "string" || result.planFingerprint.trim() === "") {
    throw new Error("反序列化 WFO 结果失败：planFingerprint 缺失");
  }
  if (!Array.isArray(result.windows)) {
    throw new Error("反序列化 WFO 结果失败：windows 缺失");
  }
  assertValidWalkForwardConfig(result.config);
  return structuredClone(result);
}
