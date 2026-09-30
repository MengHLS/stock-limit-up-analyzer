/**
 * 回测对比页：多条留档权益曲线合并（纯函数，node 环境下无需 jsdom 即可测）。
 *
 * 口径纪律（对齐组合回测页 `Backtest.tsx#buildCurve`）：
 *   - 每条留档各自一条曲线，**不做跨留档账户合并 / 期末对齐 / 插值**；
 *   - 单点数值 = 该留档自己的权益 ÷ 该留档的初始资金 − 1（恒等换算，不预测）；
 *   - 初始资金缺失或 ≤ 0 时该留档不产出曲线点（如实为「无曲线」，不臆造 0）。
 *
 * Recharts 的 `dataKey` 会被当成「点号路径」解析，而留档标签里含 `#id` / `v1.2.3`
 * ⇒ 这里用 `s0` / `s1` 这类安全键，展示标签只作为图例（`label`）出现。
 */

import { buildClosedLoopRunViewModel } from "@/adapters/closedLoopRunAdapter";

/** 多条留档曲线配色（跨色相，避免整页退化成单一色系）。 */
export const VERSION_COMPARE_COLORS = [
  "#0f766e",
  "#b45309",
  "#be123c",
  "#6d28d9",
  "#0369a1",
  "#4d7c0f",
  "#a21caf",
  "#475569",
  "#c2410c",
  "#15803d",
] as const;

/** 曲线合并的输入：一条留档的运行结果（无完整结果时 `result` 为 null）。 */
export interface VersionCompareCurveEntry {
  /** 展示标签（页面自行拼装，如「#12 · v1.2.3」）。 */
  readonly label: string;
  readonly result: unknown;
}

/** 图表上一条序列的元信息（数据键 / 图例 / 颜色 / 摘要）。 */
export interface VersionCompareCurveSeries {
  /** Recharts `dataKey`（安全键，非展示标签）。 */
  readonly key: string;
  /** 图例标签（页面给定的展示标签）。 */
  readonly label: string;
  readonly color: string;
  /** 该留档曲线点数量；0 = 没有可画的权益曲线（如 backtest 未执行）。 */
  readonly pointCount: number;
  readonly totalReturnPct: number | null;
  readonly tradeCount: number;
}

export interface VersionCompareCurve {
  readonly data: Array<Record<string, number | string>>;
  readonly series: VersionCompareCurveSeries[];
}

/**
 * 把多条留档的运行结果合并成一张折线图的数据。
 *
 * 输入顺序即输出顺序（页面按选定留档顺序传入，保证同一组留档每次配色一致）。
 */
export function buildVersionCompareCurve(
  entries: readonly VersionCompareCurveEntry[]
): VersionCompareCurve {
  const series: VersionCompareCurveSeries[] = [];
  const pointsByKey: Array<Map<string, number>> = [];
  const dates = new Set<string>();

  entries.forEach((entry, index) => {
    const key = `s${index}`;
    const viewModel = buildClosedLoopRunViewModel(entry.result);
    const backtest = viewModel?.backtest ?? null;
    const initialCapital =
      backtest !== null && backtest.initialCapital !== null && backtest.initialCapital > 0
        ? backtest.initialCapital
        : null;

    const points = new Map<string, number>();
    if (backtest !== null && initialCapital !== null) {
      for (const point of backtest.equityCurve) {
        if (!Number.isFinite(point.equity)) continue;
        points.set(
          point.date,
          Number(((point.equity / initialCapital - 1) * 100).toFixed(2))
        );
        dates.add(point.date);
      }
    }

    pointsByKey.push(points);
    series.push({
      key,
      label: entry.label,
      color: VERSION_COMPARE_COLORS[index % VERSION_COMPARE_COLORS.length],
      pointCount: points.size,
      totalReturnPct: viewModel?.evaluation?.totalReturnPct ?? null,
      tradeCount: backtest?.tradeCount ?? 0,
    });
  });

  const sortedDates = [...dates].sort();
  const data = sortedDates.map(date => {
    const row: Record<string, number | string> = { date };
    pointsByKey.forEach((points, index) => {
      const value = points.get(date);
      if (value !== undefined) row[series[index].key] = value;
    });
    return row;
  });

  return { data, series };
}
