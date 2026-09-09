/**
 * STEP 25 / C-25.1 — Closed Loop：阶段适配器（纯映射，不计算策略）。
 *
 * 两类适配器：
 *   1) 模块 run 记录 → 闭环交接摘要（真实复用 C-14.1/16.x 的 run 摘要字段；type-only import）：
 *        summarizeTradeSimulationRun / composeClosedLoopEvaluationRef；
 *   2) 上一阶段交接 → 下一阶段「输入声明」（模块 input 形态的纯映射声明；为 VALIDATED
 *      阶段真实接线提供确定性形状，编排器本身不消费）。
 *
 * 边界：适配器只做类型/形态转换与一致性提取；不做任何收益/回测/优化计算；不触碰
 * rows 级数据（rows 不经编排器）。
 */

import type { TradeSimulationRun } from "../simulator/types";
import type { PerformanceEvaluationRun } from "../performanceMetrics/types";
import type { RiskAdjustedEvaluationRun } from "../riskAdjustedMetrics/types";
import type { TradeQualityEvaluationRun } from "../tradeQualityMetrics/types";
import type {
  ClosedLoopBacktestSummary,
  ClosedLoopDatasetGate,
  ClosedLoopDatasetSummary,
  ClosedLoopEvaluationRef,
  ClosedLoopHandoff,
  ClosedLoopReviewRef,
  ClosedLoopSourceRef,
} from "./types";

// ---------------------------------------------------------------------------
// 来源 ref helpers（各记录 id/指纹约定见 types.ts 各模块文件头）
// ---------------------------------------------------------------------------

/** 内容寻址记录（无独立 runId）：ref.runId=null、ref.fingerprint=内容指纹。 */
function sourceRef(module: string, moduleRunKind: string, runId: string | null, fingerprint: string): ClosedLoopSourceRef {
  return { module, moduleRunKind, runId, fingerprint };
}

// ---------------------------------------------------------------------------
// ① C-14.1 TradeSimulationRun → backtestSummary（复用其 run 摘要字段）
// ---------------------------------------------------------------------------

/**
 * 把 C-14.1 simulator 产出的 TradeSimulationRun 摘要化为 backtest 阶段交接。
 * 只摘取轻量字段（不拷贝 equityCurve/trades rows）；source 指向内容指纹。
 */
export function summarizeTradeSimulationRun(run: TradeSimulationRun): ClosedLoopBacktestSummary {
  return {
    kind: "backtestSummary",
    handoffVersion: 1,
    synthetic: false,
    source: sourceRef("simulator", "TRADE_SIMULATION_RUN", null, run.fingerprint),
    datasetVersion: run.datasetVersion,
    datasetGate: run.datasetGate,
    dateRange: { startDate: run.dateRange.startDate, endDate: run.dateRange.endDate },
    initialCapital: run.initialCapital,
    finalEquity: run.finalEquity,
    decisionDayCount: run.decisionDayCount,
    equityCurvePointCount: run.equityCurve.length,
    tradeCount: run.trades.length,
  };
}

// ---------------------------------------------------------------------------
// ② C-16.1/16.2/16.3 评估 run → evaluationRef（引用 + 标量结论，不重算）
// ---------------------------------------------------------------------------

export interface ClosedLoopComposeEvaluationRefInput {
  /** 被评回测指纹（= TradeSimulationRun.fingerprint；evaluationRef 绑定断言）。 */
  readonly backtestFingerprint: string;
  readonly performance?: PerformanceEvaluationRun;
  readonly riskAdjusted?: RiskAdjustedEvaluationRun;
  readonly tradeQuality?: TradeQualityEvaluationRun;
}

/** 由 C-16.x 三个评估 run 组装 evaluationRef（缺省者对应节 = null；不重算指标）。 */
export function composeClosedLoopEvaluationRef(input: ClosedLoopComposeEvaluationRefInput): ClosedLoopEvaluationRef {
  const evaluatorsCovered: string[] = [];
  const performance = input.performance
    ? {
        fingerprint: input.performance.fingerprint,
        inputFingerprint: input.performance.inputFingerprint,
        totalReturnPct: input.performance.metrics.returns.totalReturnPct,
        cagrPct: input.performance.metrics.returns.cagrPct,
        maxDrawdownPct: input.performance.metrics.drawdown.maxDrawdownPct,
      }
    : null;
  if (input.performance) evaluatorsCovered.push("performanceMetrics");
  const riskAdjusted = input.riskAdjusted
    ? {
        fingerprint: input.riskAdjusted.fingerprint,
        sharpeRatio: input.riskAdjusted.metrics.sharpeRatio,
        sortinoRatio: input.riskAdjusted.metrics.sortinoRatio,
        calmarRatio: input.riskAdjusted.metrics.calmarRatio,
      }
    : null;
  if (input.riskAdjusted) evaluatorsCovered.push("riskAdjustedMetrics");
  const tradeQuality = input.tradeQuality
    ? {
        fingerprint: input.tradeQuality.fingerprint,
        winRatePct: input.tradeQuality.metrics.tradeQuality?.winRatePct ?? null,
        profitFactor: input.tradeQuality.metrics.tradeQuality?.profitFactor ?? null,
        completedTradeCount: input.tradeQuality.metrics.tradeQuality?.completedTradeCount ?? null,
      }
    : null;
  if (input.tradeQuality) evaluatorsCovered.push("tradeQualityMetrics");
  return {
    kind: "evaluationRef",
    handoffVersion: 1,
    synthetic: false,
    source: {
      module: "performanceMetrics",
      moduleRunKind: null,
      runId: null,
      fingerprint: input.performance?.fingerprint ?? null,
    },
    backtestFingerprint: input.backtestFingerprint,
    performance,
    riskAdjusted,
    tradeQuality,
    evaluatorsCovered,
  };
}

// ---------------------------------------------------------------------------
// ③ 交接 → 模块输入声明（纯映射；未来真实执行器消费这些声明去装配模块 input）
// ---------------------------------------------------------------------------

/** research 阶段执行器的输入声明（signalEngine input 形态，防串库）。 */
export interface ClosedLoopSignalEngineInputDeclaration {
  readonly datasetVersion: string | null;
  readonly datasetGate: ClosedLoopDatasetGate;
  readonly dateRange: ClosedLoopDatasetSummary["dateRange"];
  /** 要求 dataset gate PASS 才允许运行研究管线（§45.2）。 */
  readonly requiresGatePass: true;
}

/** datasetSummary → signalEngine 输入声明。 */
export function datasetSummaryToSignalEngineDeclaration(
  dataset: ClosedLoopDatasetSummary,
): ClosedLoopSignalEngineInputDeclaration {
  return {
    datasetVersion: dataset.datasetVersion,
    datasetGate: dataset.gate,
    dateRange: dataset.dateRange,
    requiresGatePass: true,
  };
}

/** evaluation 阶段输入声明（metrics 评估输入：来源回测 ref 必填）。 */
export interface ClosedLoopMetricsEvaluationDeclaration {
  readonly backtestFingerprint: string;
  readonly dateRange: { startDate: string; endDate: string };
  readonly initialCapital: number;
  readonly finalEquity: number;
}

/** backtestSummary → C-16.x metrics 评估输入声明。 */
export function backtestSummaryToMetricsDeclaration(
  backtest: ClosedLoopBacktestSummary,
): ClosedLoopMetricsEvaluationDeclaration {
  return {
    backtestFingerprint: backtest.source.fingerprint ?? backtest.source.runId ?? "",
    dateRange: backtest.dateRange,
    initialCapital: backtest.initialCapital,
    finalEquity: backtest.finalEquity,
  };
}

/** optimization 参数域声明（evaluation run 引用 → 参数域：baseline + 被搜键来源）。 */
export interface ClosedLoopOptimizationDomainDeclaration {
  readonly baseline: {
    readonly backtestFingerprint: string;
    readonly totalReturnPct: number | null;
    readonly maxDrawdownPct: number | null;
  };
  /** 参数域取值区间留待优化器（C-17.x）注入——本层只声明「域存在」与基准。 */
  readonly domainKeysHint: readonly string[];
}

/** evaluationRef → optimization 参数域声明（纯引用提取；不计算策略）。 */
export function evaluationRefToOptimizationDomain(
  evaluation: ClosedLoopEvaluationRef,
  hintKeys: readonly string[] = [],
): ClosedLoopOptimizationDomainDeclaration {
  return {
    baseline: {
      backtestFingerprint: evaluation.backtestFingerprint,
      totalReturnPct: evaluation.performance?.totalReturnPct ?? null,
      maxDrawdownPct: evaluation.performance?.maxDrawdownPct ?? null,
    },
    domainKeysHint: hintKeys,
  };
}

/** review → discipline 输入声明（复盘产出喂给 C-24.2 discipline feedback）。 */
export interface ClosedLoopDisciplineDeclaration {
  readonly sourceReviewFingerprint: string;
  readonly journalEntryCount: number;
}

/** reviewRef → discipline 输入声明。 */
export function reviewRefToDisciplineDeclaration(
  review: ClosedLoopReviewRef,
): ClosedLoopDisciplineDeclaration {
  return {
    sourceReviewFingerprint: review.source.fingerprint ?? review.source.runId ?? "",
    journalEntryCount: review.journalEntryCount,
  };
}

// ---------------------------------------------------------------------------
// synthetic 聚合（辅助）
// ---------------------------------------------------------------------------

/** 判断一条交接是否 synthetic（或来源链路携带合成标记）。 */
export function isClosedLoopHandoffSynthetic(handoff: ClosedLoopHandoff): boolean {
  return handoff.synthetic === true;
}
