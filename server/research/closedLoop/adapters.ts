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
// BACKTEST-002（B-04）— canonical Metrics 的唯一实现（本层只投影，不再自算公式）。
import type { CanonicalMetricsDetail } from "../../backtest/backtestResult";
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
 * 成交明细投影上限。
 *
 * 事件级 3F TopN（N5）当前产生 1,069 笔；旧的 1,000 会静默丢掉尾部成交。
 * 5,000 覆盖当前策略全量，同时保留有界上限，避免把任意大规模运行写成无界长文本。
 */
const BACKTEST_TRADE_DETAIL_LIMIT = 5_000;

/**
 * 把 C-14.1 simulator 产出的 TradeSimulationRun 摘要化为 backtest 阶段交接。
 *
 * 两个层次：
 *   1. **标量摘要**（原有 12 个字段）——回答「跑了多久 / 最终权益 / 成交几笔」；
 *   2. **真实产出明细**（2026-09-13 增补）——`equityCurve`（策略产出的曲线）、
 *      `executionStats.byReason`（**唯一**能解释「为什么没成交」的事实）、`skippedCounts`、
 *      `trades`（有上限）、`costs`。
 *      增补理由：此前只投影标量 ⇒ 界面跑出「0 成交 / 曲线全平」时无从得知原因（实测直读
 *      事件面板时 59/59 单全部 `SUSPENDED`）。
 *
 * 纪律：一下都是**投影**，不重算任何指标、不补齐缺失值、不把截断后的条数当总笔数。
 */
export function summarizeTradeSimulationRun(run: TradeSimulationRun): ClosedLoopBacktestSummary {
  const skippedCounts = new Map<string, number>();
  for (const entry of run.skipped) {
    skippedCounts.set(entry.code, (skippedCounts.get(entry.code) ?? 0) + 1);
  }
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
    equityCurve: run.equityCurve.map(point => ({
      date: point.date,
      equity: point.equity,
      cash: point.cash,
      marketValue: point.marketValue,
      openPositions: point.openPositions,
    })),
    executionStats: {
      totalSignals: run.executionStats.totalSignals,
      totalOrders: run.executionStats.totalOrders,
      totalFills: run.executionStats.totalFills,
      rejectedOrders: run.executionStats.rejectedOrders,
      partialFills: run.executionStats.partialFills,
      byReason: { ...run.executionStats.byReason },
    },
    skippedCounts: [...skippedCounts.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([code, count]) => ({ code, count })),
    trades: run.trades.slice(0, BACKTEST_TRADE_DETAIL_LIMIT).map(trade => ({
      securityId: trade.securityId,
      entryTime: trade.entryTime,
      entryPrice: trade.entryPrice,
      exitTime: trade.exitTime,
      exitPrice: trade.exitPrice,
      quantity: trade.quantity,
      netPnl: trade.netPnl,
      returnPct: trade.returnPct,
      holdingPeriod: trade.holdingPeriod,
      openAtEnd: trade.openAtEnd,
      fees: trade.fees,
      reason: trade.reason ?? null,
    })),
    tradesTruncated: run.trades.length > BACKTEST_TRADE_DETAIL_LIMIT,
    costs: { ...run.costs },
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
  /**
   * BACKTEST-002（B-04）— **canonical Metrics**（由调用方从**同源**回测产物算出）。
   *
   * 给出后：`performance` / `tradeQuality` 里的 5 个重叠标量与 `completedTradeCount`
   * **一律取这里**（含 `null`，即 `NOT_AVAILABLE` 不被评估器的数值顶替）；
   * 未给出：保持既有投影（`metricsSource = "evaluators"`，如实标记未接线）。
   */
  readonly canonicalMetrics?: CanonicalMetricsDetail;
}

/** 由 C-16.x 三个评估 run 组装 evaluationRef（缺省者对应节 = null；不重算指标）。 */
export function composeClosedLoopEvaluationRef(input: ClosedLoopComposeEvaluationRefInput): ClosedLoopEvaluationRef {
  const evaluatorsCovered: string[] = [];

  // B-04：canonical 投影（`NOT_AVAILABLE` → null，与本 ref 既有可空约定一致）。
  const scalar = (value: number | string | undefined): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const canonicalProjection =
    input.canonicalMetrics === undefined
      ? null
      : {
          totalReturnPct: scalar(input.canonicalMetrics.totalReturnPct),
          cagrPct: scalar(input.canonicalMetrics.annualizedReturnPct),
          maxDrawdownPct: scalar(input.canonicalMetrics.maxDrawdownPct),
          winRatePct: scalar(input.canonicalMetrics.winRatePct),
          profitFactor: scalar(input.canonicalMetrics.profitFactor),
          completedTradeCount: input.canonicalMetrics.completedTradeCount,
          annualizationBasis: input.canonicalMetrics.annualizationBasis,
        };

  const performance = input.performance
    ? {
        fingerprint: input.performance.fingerprint,
        inputFingerprint: input.performance.inputFingerprint,
        // 🔴 B-04：重叠标量取自 canonical（无 canonical 时才回落评估器自身值）。
        totalReturnPct:
          canonicalProjection === null
            ? input.performance.metrics.returns.totalReturnPct
            : canonicalProjection.totalReturnPct,
        cagrPct:
          canonicalProjection === null
            ? input.performance.metrics.returns.cagrPct
            : canonicalProjection.cagrPct,
        maxDrawdownPct:
          canonicalProjection === null
            ? input.performance.metrics.drawdown.maxDrawdownPct
            : canonicalProjection.maxDrawdownPct,
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
        // 🔴 B-04：同上，三处重叠量取自 canonical。
        winRatePct:
          canonicalProjection === null
            ? (input.tradeQuality.metrics.tradeQuality?.winRatePct ?? null)
            : canonicalProjection.winRatePct,
        profitFactor:
          canonicalProjection === null
            ? (input.tradeQuality.metrics.tradeQuality?.profitFactor ?? null)
            : canonicalProjection.profitFactor,
        completedTradeCount:
          canonicalProjection === null
            ? (input.tradeQuality.metrics.tradeQuality?.completedTradeCount ?? null)
            : canonicalProjection.completedTradeCount,
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
    canonicalMetrics: canonicalProjection,
    metricsSource: canonicalProjection === null ? "evaluators" : "canonical",
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
