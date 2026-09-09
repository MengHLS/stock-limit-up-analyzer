/**
 * STEP 19 / C-19.2 — OOS 结果聚合报告（描述性；供 C-20 消费，不下过拟合结论）。
 *
 * 职责：
 *   - **完整复用 C-19.1 `computeWalkForwardAggregate`**（import 只读）得到 `WalkForwardAggregate`，
 *     内含 `oosDegradationPp`（口径与 C-19.1 一致 = meanTest − meanTrain）与
 *     `cumulatedTestReturnPct`（分段累计）——本模块不重算这两个口径。
 *   - 逐段（每窗 OOS 权益曲线）用 C-16.1 `evaluatePerformance` + C-16.2
 *     `evaluateRiskAdjustedMetrics`（import 只读，不重算指标定义）做完整评估；
 *   - 对 assessed 段做**分段描述性聚合**（累计收益 / CAGR 均值中位数 / MaxDD 均值最大 /
 *     Sharpe 均值中位数等），**不做跨段连续净值拼接**（段间不连续，伪造连续曲线会引入
 *     虚假回撤/收益——诚实声明）。
 *
 * 诚实边界：
 *   - 某段 OOS 曲线缺失 → assessed=false + `OOS19_NO_OOS_EQUITY_CURVE`（仅标量绩效）；
 *   - 某段 OOS 曲线 < 2 点 → assessed=false + `OOS19_OOS_CURVE_TOO_SHORT`（无法完整评估）；
 *   - 全部段未评估 → 聚合统计为 null（绝不伪造 0）。
 *
 * 铁律：纯函数、确定性、无 IO；退化输入（空记录集）响亮抛错；禁止 NaN / Infinity；
 * 只做描述性对比，**不下「过拟合/未过拟合」结论**（C-20 职责）。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import { ResearchValidationError } from "../experimentValidation";
import { computeWalkForwardAggregate } from "../walkForwardRun/aggregate";
import { evaluatePerformance } from "../performanceMetrics/evaluate";
import { evaluateRiskAdjustedMetrics } from "../riskAdjustedMetrics/evaluate";
import type { WalkForwardRun } from "../walkForwardRun";
import type {
  OosAggregationReport,
  OosSegmentAggregate,
  OosSegmentMetrics,
  WindowResultRecord,
} from "./types";

// ---------------------------------------------------------------------------
// 确定性统计原语（median 取下中位数，对齐 C-19.1 aggregate.ts）
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

// ---------------------------------------------------------------------------
// 单段评估
// ---------------------------------------------------------------------------

/** 对单段 OOS 曲线做 C-16.1 / C-16.2 完整评估（曲线 >= 2 点）。 */
function evaluateSegment(
  record: WindowResultRecord,
): OosSegmentMetrics {
  const { test } = record;
  const base = {
    windowId: record.windowId,
    windowIndex: record.windowIndex,
    totalReturnPct: test.totalReturnPct,
    maxDrawdownPct: test.maxDrawdownPct,
    tradeCount: test.tradeCount,
  };

  // 无 OOS 曲线 → 仅标量绩效，完整指标 unassessed。
  if (test.oosEquityCurve === null || test.status !== "succeeded") {
    return {
      ...base,
      assessed: false,
      skipReasonCode: test.skipReasonCode,
      performance: null,
      riskAdjusted: null,
    };
  }

  // 曲线 < 2 点 → 收益率区间不足，C-16.1 无法评估（响亮记录原因，不伪造）。
  if (test.oosEquityCurve.length < 2) {
    return {
      ...base,
      assessed: false,
      skipReasonCode: "OOS19_OOS_CURVE_TOO_SHORT",
      performance: null,
      riskAdjusted: null,
    };
  }

  const equityCurve = test.oosEquityCurve;
  const performance = evaluatePerformance({ equityCurve });
  const riskAdjusted = evaluateRiskAdjustedMetrics({ equityCurve });

  return {
    ...base,
    assessed: true,
    skipReasonCode: null,
    performance,
    riskAdjusted,
  };
}

// ---------------------------------------------------------------------------
// 分段聚合
// ---------------------------------------------------------------------------

function computeSegmentAggregate(segments: readonly OosSegmentMetrics[]): OosSegmentAggregate {
  const assessed = segments.filter((segment) => segment.assessed);

  const totalReturns = assessed
    .map((segment) => segment.performance?.metrics.returns.totalReturnPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const cagrs = assessed
    .map((segment) => segment.performance?.metrics.returns.cagrPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const drawdowns = assessed
    .map((segment) => segment.performance?.metrics.drawdown.maxDrawdownPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const sharpes = assessed
    .map((segment) => segment.riskAdjusted?.metrics.sharpeRatio)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const sortinos = assessed
    .map((segment) => segment.riskAdjusted?.metrics.sortinoRatio)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const calmars = assessed
    .map((segment) => segment.riskAdjusted?.metrics.calmarRatio)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const cumulatedTotalReturnPct = totalReturns.length === 0
    ? null
    : (totalReturns.reduce((acc, value) => acc * (1 + value / 100), 1) - 1) * 100;

  return {
    assessedSegmentCount: assessed.length,
    unassessedSegmentCount: segments.length - assessed.length,
    cumulatedTotalReturnPct,
    meanTotalReturnPct: mean(totalReturns),
    medianTotalReturnPct: median(totalReturns),
    meanCagrPct: mean(cagrs),
    medianCagrPct: median(cagrs),
    meanMaxDrawdownPct: mean(drawdowns),
    maxMaxDrawdownPct: drawdowns.length === 0 ? null : Math.max(...drawdowns),
    meanSharpeRatio: mean(sharpes),
    medianSharpeRatio: median(sharpes),
    meanSortinoRatio: mean(sortinos),
    meanCalmarRatio: mean(calmars),
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 计算 OOS 结果聚合报告。
 *
 * 输入 records（逐窗隔离记录，windowIndex 升序）与来源 WalkForwardRun（用于复用 C-19.1
 * 的最小聚合口径）。退化输入（records 为空）→ 抛错。
 */
export function computeOosAggregationReport(
  records: readonly WindowResultRecord[],
  walkForwardRun: WalkForwardRun,
): OosAggregationReport {
  if (!Array.isArray(records) || records.length === 0) {
    throw new ResearchValidationError([
      {
        code: "OOS19_EMPTY_RECORDS",
        path: "records",
        message: "隔离记录集不能为空（无窗口可聚合）",
      },
    ]);
  }

  const sorted = [...records].sort((a, b) => a.windowIndex - b.windowIndex);
  const segments = sorted.map((record) => evaluateSegment(record));

  const walkForwardAggregate = computeWalkForwardAggregate(walkForwardRun.windows);
  const skipped = segments
    .filter((segment) => !segment.assessed && segment.skipReasonCode !== null)
    .map((segment) => ({
      windowId: segment.windowId,
      reasonCode: segment.skipReasonCode!,
    }));

  const body: Omit<OosAggregationReport, "fingerprint"> = {
    windowCount: records.length,
    evaluatedWindowCount: records.filter((record) => record.test.status === "succeeded").length,
    skippedWindowCount: skipped.length,
    skipped,
    walkForwardAggregate,
    oosDegradationPp: walkForwardAggregate.oosDegradationPp,
    oosEquityCurveAssessed: segments.some((segment) => segment.assessed),
    segments,
    oosSegmentAggregate: computeSegmentAggregate(segments),
  };

  const fingerprint = createHash("sha256")
    .update(canonicalStringify(body), "utf8")
    .digest("hex");

  return { ...body, fingerprint };
}
