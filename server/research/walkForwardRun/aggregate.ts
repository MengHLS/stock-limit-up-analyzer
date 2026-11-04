/**
 * STEP 19 / C-19.1 — OOS 分段绩效聚合（**最小集**）。
 *
 * 范围纪律（与 C-19.2 的边界，ROADMAP §21）：
 *   - 本文件只做「一次 WFO 编排自身的自描述聚合」：每窗 OOS 绩效的计数 + 均值/中位数/极值
 *     + 分段累计 + IS/OOS 均值对照。它让 WalkForwardRun 记录自身可读、可审计、可比较。
 *   - **不做** OOS 曲线拼接与逐日 OOS 净值序列、**不做** OOS 退化归因/结论判定（那是 C-20
 *     过拟合检测的职责）、**不做** 隔离记录持久化与归档报告（C-19.2）。
 *   - `oosDegradationPp` 只是「OOS 均值 − IS 均值（百分点）」的如实呈现，**不是通过/失败
 *     判定**，不得被下游当作 promotion 依据（本模块全链路无 promotion 代码）。
 *
 * 铁律：纯函数、确定性（输入顺序固定 = windowIndex 升序）、退化输入显式 null（无 OOS 窗
 * → 统计为 null，绝不伪造 0）、禁止 NaN / Infinity。
 */

import type { WalkForwardAggregate, WalkForwardWindowRecord } from "./types";

// ---------------------------------------------------------------------------
// 统计工具（确定性；median 取下中位数）
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 下中位数（lower median）：升序后取 index = floor((n-1)/2)；空数组 → null。 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

// ---------------------------------------------------------------------------
// 聚合
// ---------------------------------------------------------------------------

/**
 * 计算 OOS 分段绩效聚合（最小集）。
 *
 * IS 侧：冻结参数在其 Train 段被评样本的收益/回撤（frozen.trainTotalReturnPct 等）。
 * OOS 侧：test.status === "succeeded" 的窗的收益/回撤。
 */
export function computeWalkForwardAggregate(
  windows: readonly WalkForwardWindowRecord[],
): WalkForwardAggregate {
  const tested = windows.filter((window) => window.test.status === "succeeded");
  const testReturns = tested
    .map((window) => window.test.totalReturnPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const testDrawdowns = tested
    .map((window) => window.test.maxDrawdownPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const trainReturns = windows
    .map((window) => window.frozen?.trainTotalReturnPct ?? null)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const trainDrawdowns = windows
    .map((window) => window.frozen?.trainMaxDrawdownPct ?? null)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  // 分段 OOS 累计：各窗 OOS 收益连乘 − 1（分段拼接，非连续净值曲线）。
  const cumulatedTestReturnPct = testReturns.length === 0
    ? null
    : (testReturns.reduce((acc, value) => acc * (1 + value / 100), 1) - 1) * 100;

  const meanTest = mean(testReturns);
  const meanTrain = mean(trainReturns);
  const oosDegradationPp = meanTest === null || meanTrain === null ? null : meanTest - meanTrain;

  return {
    plannedWindowCount: windows.length,
    optimizedWindowCount: windows.filter((window) => window.train.searchRun.sampleCount > 0).length,
    frozenWindowCount: windows.filter((window) => window.frozen !== null).length,
    testedWindowCount: tested.length,
    skippedWindowCount: windows.length - tested.length,
    meanTrainTotalReturnPct: meanTrain,
    meanTrainMaxDrawdownPct: mean(trainDrawdowns),
    meanTestTotalReturnPct: meanTest,
    medianTestTotalReturnPct: median(testReturns),
    minTestTotalReturnPct: testReturns.length === 0 ? null : Math.min(...testReturns),
    maxTestTotalReturnPct: testReturns.length === 0 ? null : Math.max(...testReturns),
    meanTestMaxDrawdownPct: mean(testDrawdowns),
    maxTestMaxDrawdownPct: testDrawdowns.length === 0 ? null : Math.max(...testDrawdowns),
    cumulatedTestReturnPct,
    oosDegradationPp,
  };
}
