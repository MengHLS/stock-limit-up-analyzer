/**
 * RESEARCH-002 — Metric Calculator（**全系统唯一的指标实现层**）。
 *
 * 纪律（指令 §12 / §19）：
 *   - 每个指标码**只有一个实现**；Analysis 内禁止自行实现 mean / median / winRate；
 *   - 数学全部复用 `shared/quant-stats.ts`（不再造第二套统计函数）；
 *   - 样本不足 / 非有限值 → 统一返回 `null`（**绝不产出 NaN / Infinity**）；
 *   - 每个指标的口径在 `definition` 中显式写明，避免同名不同义。
 *
 * 两类指标：
 *   - 一元指标（`METRIC_COMPUTATIONS`）：作用于一个数值序列；
 *   - 二元指标（`BINARY_METRIC_COMPUTATIONS`）：作用于两组数值（对比 / 价差 / 相对差）。
 */

import {
  excessKurtosis,
  mean,
  median,
  neweyWestMeanTStat,
  normalTwoSidedPValue,
  pearsonCorrelation,
  percentile,
  sampleStandardDeviation,
  skewness,
  spearmanCorrelation,
} from "../../shared/quant-stats";

// ---------------------------------------------------------------------------
// 取值清洗（所有指标的统一入口）
// ---------------------------------------------------------------------------

/** 去掉 null / undefined / NaN / ±Infinity，不修改原数组。 */
export function finiteValues(values: readonly (number | null | undefined)[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** 缺失统计（样本层：看的是「原始数组里有多少不可用」，不是过滤后的分布）。 */
export interface MissingStatistics {
  sampleCount: number;
  missingCount: number;
  missingRate: number;
}

/** 缺失统计；空数组时 missingRate = 0（无样本 ≠ 全缺失）。 */
export function missingStatistics(values: readonly (number | null | undefined)[]): MissingStatistics {
  const sampleCount = values.length;
  const missingCount = sampleCount - finiteValues(values).length;
  return {
    sampleCount,
    missingCount,
    missingRate: sampleCount === 0 ? 0 : missingCount / sampleCount,
  };
}

// ---------------------------------------------------------------------------
// 一元指标
// ---------------------------------------------------------------------------

export interface MetricComputation {
  /** 指标码（与 `researchCore/results.ts#RESEARCH_METRIC_CODES` 一致）。 */
  readonly code: string;
  readonly label: string;
  /** 精确口径（进结果 metadata / 报告）。 */
  readonly definition: string;
  /** 是否需要至少 1 个有限值才有意义。 */
  readonly minSamples: number;
  /** 计算入口；内部自行过滤 null / NaN / ±Infinity（返回值同参不受影响）。 */
  readonly compute: (values: readonly (number | null | undefined)[]) => number | null;
}

/** 组合指标：先过滤有限值，再判断最小样本数。 */
function metric(
  code: string,
  label: string,
  definition: string,
  minSamples: number,
  core: (finite: number[]) => number | null,
): MetricComputation {
  return {
    code,
    label,
    definition,
    minSamples,
    compute: (values) => {
      const finite = finiteValues(values);
      if (finite.length < minSamples) return null;
      return core(finite);
    },
  };
}

/** 一元指标表（**唯一权威**）。 */
export const METRIC_COMPUTATIONS: Readonly<Record<string, MetricComputation>> = Object.freeze(
  Object.fromEntries(
    [
      metric("MEAN", "均值", "有限样本的算术平均。", 1, (v) => mean(v)),
      metric("MEAN_RETURN", "平均收益", "有限样本的算术平均（作用于收益型变量）。", 1, (v) => mean(v)),
      metric("MEDIAN", "中位数", "有限样本的中位数（偶数取中间两者均值）。", 1, (v) => median(v)),
      metric("MEDIAN_RETURN", "收益中位数", "有限样本的中位数（作用于收益型变量）。", 1, (v) => median(v)),
      metric("STD", "标准差", "有限样本的标准差（除以 n−1）。", 2, (v) => sampleStandardDeviation(v)),
      metric("STD_RETURN", "收益标准差", "有限样本的标准差（除以 n−1，作用于收益型变量）。", 2, (v) => sampleStandardDeviation(v)),
      metric("VOLATILITY", "波动率", "样本标准差（与 STD 同一实现；用于「波动率」语义位）。", 2, (v) => sampleStandardDeviation(v)),
      metric("MIN", "最小值", "有限样本最小值。", 1, (v) => Math.min(...v)),
      metric("MAX", "最大值", "有限样本最大值。", 1, (v) => Math.max(...v)),
      metric("P01", "1% 分位", "线性插值分位数（shared/quant-stats.percentile）。", 1, (v) => percentile(v, 1)),
      metric("P05", "5% 分位", "线性插值分位数。", 1, (v) => percentile(v, 5)),
      metric("P10", "10% 分位", "线性插值分位数。", 1, (v) => percentile(v, 10)),
      metric("P25", "25% 分位", "线性插值分位数。", 1, (v) => percentile(v, 25)),
      metric("P50", "50% 分位", "线性插值分位数（= 分位定义下的中位数）。", 1, (v) => percentile(v, 50)),
      metric("P75", "75% 分位", "线性插值分位数。", 1, (v) => percentile(v, 75)),
      metric("P90", "90% 分位", "线性插值分位数。", 1, (v) => percentile(v, 90)),
      metric("P95", "95% 分位", "线性插值分位数。", 1, (v) => percentile(v, 95)),
      metric("P99", "99% 分位", "线性插值分位数。", 1, (v) => percentile(v, 99)),
      metric("SKEWNESS", "偏度", "adjusted Fisher-Pearson g1；n < 3 返回 null。", 3, (v) => skewness(v)),
      metric("KURTOSIS", "超额峰度", "adjusted Fisher-Pearson g2；n < 4 返回 null。", 4, (v) => excessKurtosis(v)),
      metric(
        "WIN_RATE",
        "胜率",
        "**严格大于 0** 的样本占比（v > 0；v == 0 计为未胜，不四舍五入）。",
        1,
        (v) => v.filter((x) => x > 0).length / v.length,
      ),
      metric(
        "PROFIT_FACTOR",
        "盈亏比",
        "Σ(正收益) / |Σ(负收益)|；无亏损样本时返回 null（避免 Infinity）。",
        2,
        (v) => {
          let win = 0;
          let loss = 0;
          for (const x of v) {
            if (x > 0) win += x;
            else if (x < 0) loss += -x;
          }
          if (loss === 0) return null;
          return win / loss;
        },
      ),
      metric(
        "AVG_WIN",
        "平均盈利",
        "正收益样本的均值；无正样本返回 null。",
        1,
        (v) => {
          const wins = v.filter((x) => x > 0);
          return wins.length === 0 ? null : mean(wins);
        },
      ),
      metric(
        "AVG_LOSS",
        "平均亏损",
        "负收益样本的均值（负值）；无负样本返回 null。",
        1,
        (v) => {
          const losses = v.filter((x) => x < 0);
          return losses.length === 0 ? null : mean(losses);
        },
      ),
      metric(
        "PAYOFF_RATIO",
        "盈亏比（均值比）",
        "AVG_WIN / |AVG_LOSS|；任一侧缺失返回 null。",
        2,
        (v) => {
          const wins = v.filter((x) => x > 0);
          const losses = v.filter((x) => x < 0);
          if (wins.length === 0 || losses.length === 0) return null;
          const avgLoss = mean(losses);
          if (avgLoss === null || avgLoss === 0) return null;
          const avgWin = mean(wins);
          return avgWin === null ? null : avgWin / Math.abs(avgLoss);
        },
      ),
      metric(
        "DOWNSIDE_DEVIATION",
        "下行偏差",
        "sqrt(mean(min(0, x)²))；空样本返回 null。",
        1,
        (v) => {
          const sum = v.reduce((acc, x) => acc + Math.min(0, x) ** 2, 0);
          return Math.sqrt(sum / v.length);
        },
      ),
      metric(
        "MAX_DRAWDOWN",
        "区间最大回撤（均值）",
        "**对事件级 `max_drawdown_{h}d` 变量取均值**（回撤本身为负）。"
          + "注意：本码**不是**净值曲线回撤（那属 Backtest 阶段，不在 RESEACH-002 范围）。",
        1,
        (v) => mean(v),
      ),
      metric(
        "MAX_FAVORABLE_EXCURSION",
        "最大有利偏移（均值）",
        "对事件级 `max_return_{h}d` 变量取均值（[T+1, T+h] 区间内最大有利偏移）。",
        1,
        (v) => mean(v),
      ),
      metric(
        "MAX_ADVERSE_EXCURSION",
        "最大不利偏移（均值）",
        "对事件级 `min_return_{h}d` 变量取均值（[T+1, T+h] 区间内最大不利偏移）。",
        1,
        (v) => mean(v),
      ),
      metric(
        "SAMPLE_COUNT",
        "有效样本数",
        "过滤非有限值后的样本数。",
        0,
        (v) => v.length,
      ),
      metric(
        "BREAKOUT_RATE",
        "突破率",
        "对 0/1 型 `is_breakout_{h}d` 变量取均值（[T+1, T+h] 区间内突破事件日高点的比例）。",
        1,
        (v) => mean(v),
      ),
      metric(
        "MEAN_DAYS_TO_BREAKOUT",
        "平均到突破天数",
        "对 `days_to_breakout_{h}d` 变量取均值（仅统计已突破样本；未突破为 null 不参与）。",
        1,
        (v) => mean(v),
      ),
      metric(
        "T_STAT",
        "t 统计量",
        "Newey-West HAC 稳健 t 统计量（shared/quant-stats.neweyWestMeanTStat，默认滞后 L=floor(4·(n/100)^(2/9))）。"
          + "**仅作研究辅助**：事件样本存在重叠视界，独立性假设不严格成立。",
        3,
        (v) => {
          const r = neweyWestMeanTStat([...v]);
          return r === null ? null : r.tStat;
        },
      ),
      metric(
        "P_VALUE",
        "双尾 p 值",
        "正态近似的双尾 p 值 2·(1−Φ(|t|))（由 HAC t 统计量推出）。**不是**多重比较校正后的值。",
        3,
        (v) => {
          const r = neweyWestMeanTStat([...v]);
          if (r === null) return null;
          return normalTwoSidedPValue(r.tStat);
        },
      ),
    ].map((m) => [m.code, m]),
  ),
);

/** 一元指标码清单（稳定排序）。 */
export function listMetricCodes(): string[] {
  return Object.keys(METRIC_COMPUTATIONS).sort();
}

// ---------------------------------------------------------------------------
// 二元指标（对比 / 价差 / 相对差）
// ---------------------------------------------------------------------------

export interface BinaryMetricComputation {
  readonly code: string;
  readonly label: string;
  readonly definition: string;
  readonly compute: (
    left: readonly (number | null | undefined)[],
    right: readonly (number | null | undefined)[],
  ) => number | null;
}

/**
 * Welch 两样本 t 统计量：(m₁ − m₂) / √(s₁²/n₁ + s₂²/n₂)。
 *
 * 口径声明：使用**样本**方差（除以 n−1）；任一组样本数 < 2 或标准误为 0 → null。
 * 注意这不是配对检验，也不校正重叠视界带来的样本相关 —— 因此只作研究辅助，
 * 由调用方在 `notes` / `evidence` 中如实转述该局限。
 */
export function welchTStatistic(
  left: readonly (number | null | undefined)[],
  right: readonly (number | null | undefined)[],
): number | null {
  const a = finiteValues(left);
  const b = finiteValues(right);
  if (a.length < 2 || b.length < 2) return null;
  const varA = sampleStandardDeviation(a);
  const varB = sampleStandardDeviation(b);
  if (varA === null || varB === null) return null;
  const seSquared = (varA ** 2) / a.length + (varB ** 2) / b.length;
  if (!(seSquared > 0)) return null;
  const diff = mean(a);
  const meanB = mean(b);
  if (diff === null || meanB === null) return null;
  return (diff - meanB) / Math.sqrt(seSquared);
}

/** 二元指标表（**唯一权威**）。`left` = 待评估组，`right` = 基准组。 */
export const BINARY_METRIC_COMPUTATIONS: Readonly<Record<string, BinaryMetricComputation>> = Object.freeze({
  SPREAD_TOP_BOTTOM: {
    code: "SPREAD_TOP_BOTTOM",
    label: "顶底分位差",
    definition: "**最高分位组均值 − 最低分位组均值**（left = 最高分位组，right = 最低分位组）。",
    compute: (left, right) => {
      const a = mean(finiteValues(left));
      const b = mean(finiteValues(right));
      if (a === null || b === null) return null;
      return a - b;
    },
  },
  DIFFERENCE: {
    code: "DIFFERENCE",
    label: "差值",
    definition: "**条件组均值 − 全部样本均值**（left = 条件组，right = 全样本）。",
    compute: (left, right) => {
      const a = mean(finiteValues(left));
      const b = mean(finiteValues(right));
      if (a === null || b === null) return null;
      return a - b;
    },
  },
  RELATIVE_DIFFERENCE: {
    code: "RELATIVE_DIFFERENCE",
    label: "相对差值",
    definition: "(条件组均值 − 全样本均值) / |全样本均值|；基准均值为 0 时返回 null。",
    compute: (left, right) => {
      const a = mean(finiteValues(left));
      const b = mean(finiteValues(right));
      if (a === null || b === null || b === 0) return null;
      const value = (a - b) / Math.abs(b);
      return Number.isFinite(value) ? value : null;
    },
  },
  T_STAT_DIFFERENCE: {
    code: "T_STAT_DIFFERENCE",
    label: "组间差 Welch t",
    definition: "Welch 两样本 t 统计量 (m₁ − m₂)/√(s₁²/n₁ + s₂²/n₂)（left − right）。"
      + "**不校正重叠视界带来的样本相关**，仅作研究辅助。",
    compute: (left, right) => welchTStatistic(left, right),
  },
  P_VALUE_DIFFERENCE: {
    code: "P_VALUE_DIFFERENCE",
    label: "组间差 p 值",
    definition: "由 Welch t 统计量经**正态近似**得到的双尾 p 值（与 T_STAT 的 p 值同一近似口径）。"
      + "未做多重比较校正，也不是交易有效性的证据。",
    compute: (left, right) => {
      const t = welchTStatistic(left, right);
      if (t === null) return null;
      return normalTwoSidedPValue(t);
    },
  },
});

// ---------------------------------------------------------------------------
// 配对指标（同一样本的两条序列 → 关系度量）
// ---------------------------------------------------------------------------

/**
 * 配对指标（RESEARCH-004）。
 *
 * 与二元指标的**语义差别**（这是本层独立存在而不是塞进 `BINARY_METRIC_COMPUTATIONS` 的原因）：
 *   - 二元指标：`left` = 待评估组、`right` = 基准组，算的是**两组之间的差**（左右不对称）；
 *   - 配对指标：两条序列**同下标 = 同一个样本**，算的是**同一样本两个量的共变**（左右对称）。
 * 把相关系数塞进「对比 / 价差」的二元层会让那一层的契约（左右有序）名不副实。
 */
export interface PairedMetricComputation {
  readonly code: string;
  readonly label: string;
  /** 精确口径（进结果 metadata / 报告）。 */
  readonly definition: string;
  /**
   * 计算入口。入参为**按事件对齐**的两条等长序列（同下标 = 同一事件）。
   * 长度不一致直接抛错（调用方错，不静默截断 —— 截断会让「配错对」看起来像正常结果）。
   */
  readonly compute: (
    xs: readonly (number | null | undefined)[],
    ys: readonly (number | null | undefined)[],
  ) => number | null;
}

/**
 * 对齐配对：只保留**同下标且两侧都有限**的样本。
 *
 * 这是配对层的唯一配对口径：任一侧缺失即整对丢弃（不做插补、不用均值填补）。
 * 「缺失不是 0」这条铁律在配对场景同样成立 —— 插补会凭空造出相关性。
 */
export function alignedPairs(
  xs: readonly (number | null | undefined)[],
  ys: readonly (number | null | undefined)[],
): Array<[number, number]> {
  if (xs.length !== ys.length) {
    throw new Error(`配对指标要求两条序列等长（实得 ${xs.length} vs ${ys.length}）`);
  }
  const out: Array<[number, number]> = [];
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i];
    const b = ys[i];
    if (typeof a === "number" && Number.isFinite(a) && typeof b === "number" && Number.isFinite(b)) {
      out.push([a, b]);
    }
  }
  return out;
}

/** 配对指标表（**唯一权威**）。 */
export const PAIRED_METRIC_COMPUTATIONS: Readonly<Record<string, PairedMetricComputation>> = Object.freeze({
  PAIR_CORRELATION: {
    code: "PAIR_CORRELATION",
    label: "配对相关系数",
    definition:
      "两条**按事件对齐**序列的皮尔逊相关系数（shared/quant-stats.pearsonCorrelation）。"
      + "仅使用两侧同时有限的配对样本；配对 < 3 或任一侧变差为 0 → null。"
      + "⚠️ 相关系数**不是**因果、也不是可交易信号；样本存在重叠视界时独立性假设不严格成立。",
    compute: (xs, ys) => {
      const pairs = alignedPairs(xs, ys);
      return pearsonCorrelation(
        pairs.map((p) => p[0]),
        pairs.map((p) => p[1]),
      );
    },
  },
  PAIR_RANK_CORRELATION: {
    code: "PAIR_RANK_CORRELATION",
    label: "配对秩相关",
    definition:
      "两条按事件对齐序列的斯皮尔曼秩相关（并列值取平均秩，shared/quant-stats.spearmanCorrelation）。"
      + "对极端值不敏感，用于判断「关系是否单调」而不受量纲与离群值主导；配对 < 3 → null。",
    compute: (xs, ys) => {
      const pairs = alignedPairs(xs, ys);
      return spearmanCorrelation(
        pairs.map((p) => p[0]),
        pairs.map((p) => p[1]),
      );
    },
  },
  PAIR_SAMPLE_COUNT: {
    code: "PAIR_SAMPLE_COUNT",
    label: "配对有效样本数",
    definition:
      "两侧同时有限、真正进入关系计算的**配对**样本数（不是任一单侧的样本数）。"
      + "同一分析里各窗口统计量的单侧样本数可以更大，读数时不要混用。",
    compute: (xs, ys) => alignedPairs(xs, ys).length,
  },
});

/** 配对指标码清单（稳定排序）。 */
export function listPairedMetricCodes(): string[] {
  return Object.keys(PAIRED_METRIC_COMPUTATIONS).sort();
}

// ---------------------------------------------------------------------------
// 稳定性
// ---------------------------------------------------------------------------

/**
 * 方向一致性比例：各子区间效应与整体效应**同号**的占比 [0,1]。
 * 子区间效应为 0 或 null 时不计入分子（保守）。
 */
export function directionConsistency(
  subEffects: readonly (number | null | undefined)[],
): number | null {
  const overall = mean(finiteValues(subEffects));
  if (overall === null || overall === 0) return null;
  const usable = subEffects.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (usable.length === 0) return null;
  const same = usable.filter((x) => Math.sign(x) === Math.sign(overall)).length;
  return same / usable.length;
}

export const STABILITY_RATIO_DEFINITION =
  "各子区间均值的符号与整体均值符号一致的占比 [0,1]；整体均值为 0 时返回 null。";

// ---------------------------------------------------------------------------
// MetricCalculator（对外统一入口）
// ---------------------------------------------------------------------------

export class UnknownMetricError extends Error {
  constructor(code: string) {
    super(`未登记的一元指标码："${code}"（禁止在 Analysis 内自行实现统计）`);
    this.name = "UnknownMetricError";
  }
}

export class MetricCalculator {
  /** 一元指标；未登记的指标码直接抛错（防「分析里偷偷自己算」）。 */
  compute(code: string, values: readonly (number | null | undefined)[]): number | null {
    const def = METRIC_COMPUTATIONS[code];
    if (!def) throw new UnknownMetricError(code);
    return def.compute(values);
  }

  /** 批量一元指标（保序）。 */
  computeMany(
    codes: readonly string[],
    values: readonly (number | null | undefined)[],
  ): Array<{ code: string; value: number | null }> {
    return codes.map((code) => ({ code, value: this.compute(code, values) }));
  }

  /** 二元指标；未登记直接抛错。 */
  computeBinary(
    code: string,
    left: readonly (number | null | undefined)[],
    right: readonly (number | null | undefined)[],
  ): number | null {
    const def = BINARY_METRIC_COMPUTATIONS[code];
    if (!def) throw new UnknownMetricError(code);
    return def.compute(left, right);
  }

  /** 配对指标；未登记直接抛错。两条序列必须等长（不同下标错位会让「相关性」变成噪音）。 */
  computePaired(
    code: string,
    xs: readonly (number | null | undefined)[],
    ys: readonly (number | null | undefined)[],
  ): number | null {
    const def = PAIRED_METRIC_COMPUTATIONS[code];
    if (!def) throw new UnknownMetricError(code);
    return def.compute(xs, ys);
  }

  /** 口径查询（写结果 metadata 用）。 */
  definitionOf(code: string): string | undefined {
    return (
      METRIC_COMPUTATIONS[code]?.definition ??
      BINARY_METRIC_COMPUTATIONS[code]?.definition ??
      PAIRED_METRIC_COMPUTATIONS[code]?.definition
    );
  }

  /** 展示名查询（口径登记表里的 label；未登记返回 undefined，由调用方决定怎么显示）。 */
  labelOf(code: string): string | undefined {
    return (
      METRIC_COMPUTATIONS[code]?.label ??
      BINARY_METRIC_COMPUTATIONS[code]?.label ??
      PAIRED_METRIC_COMPUTATIONS[code]?.label
    );
  }
}

/** 默认单例（无状态，可直接用）。 */
export const metricCalculator = new MetricCalculator();
