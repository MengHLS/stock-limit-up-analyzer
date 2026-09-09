/**
 * STEP 17 / C-17.1 — 绩效标量校验 + C-16.1 适配（metrics 桥）。
 *
 * 设计决策：
 *   - 搜索器只消费稳定区判定实际需要的标量（totalReturnPct / maxDrawdownPct / tradeCount），
 *     以最小可测接口 ParameterSearchMetricsView 承载，避免与具体评估器记录类型强耦合；
 *   - 桥接 C-16.1 performanceMetrics（STEP 16 收益/风险/回撤确定性评估器）：
 *     fromPerformanceEvaluationRun16 / fromPerformanceMetrics16 把其嵌套记录/指标映射为本层
 *     标量形态（import 只读，不重写口径）；未来 C-16.2 / C-16.3 的聚合评估同样可用本标量
 *     接口注入（扩展面，本任务不预埋）。
 *   - 数值纪律：本层成功产物必须有限（NaN / ±Infinity 一律拒绝），maxDrawdownPct >= 0，
 *     tradeCount 为 null 或非负整数。搜索器据此把非法成功产物转记为 failed 样本（响亮可见，
 *     不静默吞掉编程错误）。
 *
 * 铁律：纯函数、确定性；无 IO / Date.now / Math.random。
 */

import type {
  PerformanceEvaluationRun,
  PerformanceMetrics as PerformanceMetrics16,
} from "../performanceMetrics/types";
import type { ParameterSearchMetricsView } from "./types";

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/**
 * 校验绩效标量；合法返回 null，否则返回人类可读错误串（供搜索器转记 failed 样本）。
 * 注意：本函数只判形态，不做业务门槛（收益门槛/回撤门槛在稳定区判定层 RegionAnalysisConfig）。
 */
export function validateParameterSearchMetrics(
  metrics: ParameterSearchMetricsView,
): string | null {
  if (metrics === null || typeof metrics !== "object") {
    return "评估成功产物必须是对象";
  }
  const issues: string[] = [];
  if (typeof metrics.totalReturnPct !== "number" || !Number.isFinite(metrics.totalReturnPct)) {
    issues.push("totalReturnPct 必须是有限数字（禁止 NaN / Infinity）");
  }
  if (typeof metrics.maxDrawdownPct !== "number" || !Number.isFinite(metrics.maxDrawdownPct)) {
    issues.push("maxDrawdownPct 必须是有限数字（禁止 NaN / Infinity）");
  } else if (metrics.maxDrawdownPct < 0) {
    issues.push(`maxDrawdownPct 不能为负（实际 ${metrics.maxDrawdownPct}）`);
  }
  if (metrics.tradeCount !== null) {
    if (typeof metrics.tradeCount !== "number" || !Number.isInteger(metrics.tradeCount)) {
      issues.push("tradeCount 必须为 null 或整数");
    } else if (metrics.tradeCount < 0) {
      issues.push(`tradeCount 不能为负（实际 ${metrics.tradeCount}）`);
    }
  }
  return issues.length === 0 ? null : issues.join("；");
}

// ---------------------------------------------------------------------------
// C-16.1 桥（import 只读，口径对齐 performanceMetrics/types）
// ---------------------------------------------------------------------------

/** 把 C-16.1 评估结果总记录映射为绩效标量（tradeCount 取 run.input.tradeCount）。 */
export function fromPerformanceEvaluationRun16(
  run: PerformanceEvaluationRun,
): ParameterSearchMetricsView {
  return {
    totalReturnPct: run.metrics.returns.totalReturnPct,
    maxDrawdownPct: run.metrics.drawdown.maxDrawdownPct,
    tradeCount: run.input.tradeCount,
  };
}

/** 把 C-16.1 嵌套指标（PerformanceMetrics）映射为绩效标量（tradeCount 未知 → null）。 */
export function fromPerformanceMetrics16(
  metrics: PerformanceMetrics16,
): ParameterSearchMetricsView {
  return {
    totalReturnPct: metrics.returns.totalReturnPct,
    maxDrawdownPct: metrics.drawdown.maxDrawdownPct,
    tradeCount: null,
  };
}
