/**
 * WALK-FORWARD-001 — 多 Fold 汇总（规格 §12：**只做描述性统计**）。
 *
 * ## 这一层**不做**什么（比做什么更重要）
 *
 * 明确**不产出**：推荐 / 最优 / 最差策略 / 应该使用 / 建议参数 / 自动通过或淘汰
 * （规格 §12 逐条点名，§22 再把「自动输出策略评级」列为禁止项）。
 *
 * 因此本文件里：
 *   - **没有**任何排序输出、**没有** `best` / `worst` / `recommended` / `optimal` 字段；
 *   - `observedMin` / `observedMax` 只是**观测区间**（事实：这批 Fold 里这个指标落在哪两个数上），
 *     命名刻意用 `observed*` 而不是 `best` / `worst`，且不附任何判定；
 *   - `null` = 该统计**不可用**（没有 Fold 贡献该指标），**绝不编造成 0**
 *     （0 是「算出来恰好是 0」，与「没数据」是两件事）。
 *
 * ## 统计量的选择
 *
 * 用 `mean` + `median`：两者都是**位置统计量**，对「某一天特别极端」不敏感的程度不同，
 * 并列给出可以让读者自己判断离散程度；再给 `observedMin` / `observedMax` 作为区间。
 * **不**计算夏普 / 信息系数 / t 统计量等需要额外口径的量 —— 那些不在本域职责内（规格 §22）。
 */

import { ResearchValidationError } from "../experimentValidation";
import type {
  WalkForwardAggregate,
  WalkForwardFoldView,
  WalkForwardMetricStat,
  WalkForwardMetricStats,
} from "./types";
import { EMPTY_WALK_FORWARD_METRIC_STAT } from "./types";

/** canonical 六项指标的键（唯一来源 = 契约里的 `oosMetricsSchema` 字段名）。 */
const METRIC_KEYS = [
  "totalReturnPct",
  "annualizedReturnPct",
  "maxDrawdownPct",
  "tradeCount",
  "winRatePct",
  "profitFactor",
] as const;

type MetricKey = (typeof METRIC_KEYS)[number];

/** 计算描述性统计（空集合 ⇒ 全 null + 计数 0，**不编造 0**）。 */
export function describeMetricStat(values: readonly number[]): WalkForwardMetricStat {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return { ...EMPTY_WALK_FORWARD_METRIC_STAT };
  const sorted = [...finite].sort((left, right) => left - right);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const mean = sum / sorted.length;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return {
    availableCount: sorted.length,
    mean,
    median,
    observedMin: sorted[0]!,
    observedMax: sorted[sorted.length - 1]!,
  };
}

/** 从若干 Fold 里按「取值提取器」收集一个指标的全部可用读数。 */
function collect(folds: readonly WalkForwardFoldView[], pick: (fold: WalkForwardFoldView) => number | null | undefined): number[] {
  const out: number[] = [];
  for (const fold of folds) {
    const value = pick(fold);
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** 六项指标 × 一侧（IS 或 OOS）的描述性统计。 */
function buildSideStats(
  folds: readonly WalkForwardFoldView[],
  side: "is" | "oos",
): WalkForwardMetricStats {
  const stats = {} as Record<MetricKey, WalkForwardMetricStat>;
  for (const key of METRIC_KEYS) {
    stats[key] = describeMetricStat(
      collect(folds, (fold) => {
        const metrics = side === "is" ? fold.isMetrics : fold.oosMetrics;
        return metrics === null ? null : metrics[key];
      }),
    );
  }
  return stats as WalkForwardMetricStats;
}

/**
 * 组装多 Fold 汇总（纯函数；输入 = 已落库的 Fold 视图列表）。
 *
 * 🔴 只把 `outcome = SUCCEEDED` 的 Fold 计入指标统计 —— 但**照样如实计数**
 *   `failedFoldCount` / `insufficientTradingActivityCount`，并把「谁缺席、为什么缺席」
 *   写进 `notes`（不静默丢 Fold）。
 */
export function buildWalkForwardAggregate(input: {
  readonly walkForwardRunId: string;
  readonly folds: readonly WalkForwardFoldView[];
}): WalkForwardAggregate {
  const folds = [...input.folds].sort((left, right) => left.foldIndex - right.foldIndex);
  for (let index = 0; index < folds.length; index += 1) {
    if (folds[index]!.foldIndex !== index) {
      throw new ResearchValidationError([
        {
          code: "WALK_FORWARD_AGGREGATE_FOLD_INDEX_INVALID",
          path: `folds[${String(index)}].foldIndex`,
          message:
            `汇总要求 Fold 序号连续且从 0 起：期望 ${String(index)}，`
            + `实际 ${String(folds[index]!.foldIndex)}（Run ${input.walkForwardRunId}）`,
        },
      ]);
    }
  }

  const completed = folds.filter((fold) => fold.status === "OOS_COMPLETED");
  const failed = folds.filter((fold) => fold.status === "FAILED");
  const insufficient = folds.filter((fold) => fold.outcome === "INSUFFICIENT_TRADING_ACTIVITY");
  const contributing = folds.filter((fold) => fold.outcome === "SUCCEEDED");

  const notes: string[] = [];
  notes.push(
    `汇总只做**描述性统计**：不排序、不评级、不判定通过或淘汰，也不称任何 Fold 为「最好 / 最差」（规格 §12）。`,
  );
  notes.push(
    `Fold 计数：总 ${String(folds.length)}，已走完样本外 ${String(completed.length)}，`
    + `失败 ${String(failed.length)}，成交不足 ${String(insufficient.length)}，`
    + `计入统计 ${String(contributing.length)}。`,
  );
  if (failed.length > 0) {
    const detail = failed
      .map((fold) => `#${String(fold.foldIndex)}(${fold.errorCode ?? "未知错误"})`)
      .join("、");
    notes.push(`⚠️ 失败 Fold：${detail} —— 它们**不计入**指标统计（不伪造读数）。`);
  }
  if (insufficient.length > 0) {
    const detail = insufficient.map((fold) => `#${String(fold.foldIndex)}`).join("、");
    notes.push(
      `⚠️ 成交不足 Fold：${detail} —— 样本外 0 笔成交是**如实读数**，`
      + `不代表「差」，也不参与优劣判定；它们同样不计入指标统计。`,
    );
  }
  if (contributing.length === 0) {
    notes.push(
      "⚠️ 没有任何 Fold 走到可用读数 ⇒ 全部统计量为 null（**不编造 0**）。",
    );
  }
  const missingTradeCount = folds.filter((fold) => fold.oosMetrics?.tradeCount === null).length;
  if (missingTradeCount > 0) {
    notes.push(`⚠️ 有 ${String(missingTradeCount)} 个 Fold 的样本外交易笔数为 null（不可用，非 0）。`);
  }

  return {
    foldCount: folds.length,
    completedFoldCount: completed.length,
    failedFoldCount: failed.length,
    insufficientTradingActivityCount: insufficient.length,
    contributingFoldCount: contributing.length,
    isStats: buildSideStats(contributing, "is"),
    oosStats: buildSideStats(contributing, "oos"),
    totalReturnDegradationPct: describeMetricStat(
      collect(contributing, (fold) => fold.comparison?.totalReturnDegradationPct ?? null),
    ),
    drawdownChangePct: describeMetricStat(
      collect(contributing, (fold) => fold.comparison?.drawdownChangePct ?? null),
    ),
    tradeCountChange: describeMetricStat(
      collect(contributing, (fold) => fold.comparison?.tradeCountChange ?? null),
    ),
    notes,
  };
}
