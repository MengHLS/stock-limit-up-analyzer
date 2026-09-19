/**
 * BACKTEST-001 — BacktestResult / Metrics / 有界持久化载荷（规格 §19 §20 §23 §25）。
 *
 * ## 为什么单独成文件
 *
 * Phase A 实测：`simulator/types.ts:182-236` 的 `TradeSimulationRun` **不产出任何绩效指标**，
 * 指标由闭环 `evaluation` 阶段另行消费曲线算出（`closedLoopWiring/executors.ts:516-569`）。
 * ⇒ 「一次回测的结果」在留档里**没有单一对象**。本文件补上这个对象，并给出
 * **有界持久化载荷**（规格 §23：明细可达 10^5 条，禁止无脑塞 JSON）。
 *
 * ## 硬纪律
 *
 * 1. **禁第二套口径**：曲线与成交明细一律取自既有产物
 *    （`EquityPoint` / `Trade`，`backtest/types.ts:302/:280`），本文件只做**聚合**；
 *    「不可靠计算」一律标 `NOT_AVAILABLE`（规格 §19 明文），**绝不编 0**。
 * 2. **确定性**：同输入必得同输出（无 Date.now / Math.random / Set 迭代序）。
 * 3. **有界**：`equityCurve` / `tradeLedger` 保留**摘要 + 有界样本 + 滚动指纹**，
 *    全量明细**不进** `resultJson`。
 */

import { createHash } from "node:crypto";
import { annualizedReturnFromEquityCurve } from "../../shared/quant-stats";
import type { EquityPoint, Trade } from "./types";

// ---------------------------------------------------------------------------
// NOT_AVAILABLE
// ---------------------------------------------------------------------------

/** 不可靠计算时的显式标记（**不用 0 冒充**）。 */
export const NOT_AVAILABLE = "NOT_AVAILABLE" as const;
export type Unavailable = typeof NOT_AVAILABLE;

function num(value: number | string | null | undefined): number | Unavailable {
  return typeof value === "number" && Number.isFinite(value) ? value : NOT_AVAILABLE;
}

// ---------------------------------------------------------------------------
// BacktestResult（规格 §19）
// ---------------------------------------------------------------------------

export interface BacktestMetrics {
  readonly totalReturnPct: number | Unavailable;
  readonly annualizedReturnPct: number | Unavailable;
  /** 最大回撤（**正数幅度**；与 `performanceMetrics` / `riskAdjusted` 同口径）。 */
  readonly maxDrawdownPct: number;
  readonly tradeCount: number;
  readonly winRatePct: number | Unavailable;
  readonly averageWinPct: number | Unavailable;
  readonly averageLossPct: number | Unavailable;
  /** 盈亏比 = 总盈利 / |总亏损|；无亏损笔时为 `NOT_AVAILABLE`（不编 Infinity）。 */
  readonly profitFactor: number | Unavailable;
  /** 期末仍持仓的笔数（口径可辨：它们不进胜率 / 盈亏比）。 */
  readonly openAtEndCount: number;
  /** 年化口径自述（B-04；与 `annualizedReturnPct` 同源）。 */
  readonly annualizationBasis: AnnualizationBasis;
}

/**
 * 🔴 命名的**唯一一处歧义**（显式登记）：`types.ts:401` 已有一个同名的 `BacktestResult`，
 * 那是 **legacy 事件驱动引擎（`runBacktestEngine2`，生产不可达）自己的结果对象**。
 * 本类型是规格 §19 要求的**Core 级统一结果**（runId / strategyVersionId / datasetVersionId /
 * metrics / equityCurve / tradeLedger），与前者字段面不同 ⇒ 用 `BacktestRunResult` 区分，
 * **不合并、不改名既有类型**（改既有类型会牵动它的消费者）。
 */
export interface BacktestRunResult {
  readonly runId: string;
  readonly strategyVersionId: string;
  readonly datasetVersionId: number | null;
  readonly parameterSet: Readonly<Record<string, unknown>>;
  readonly initialCapital: number;
  readonly finalEquity: number;
  /** B-04：可为 `NOT_AVAILABLE`（初始资金为 0 时不可算）—— 不用 0 冒充。 */
  readonly totalReturnPct: number | Unavailable;
  readonly annualizedReturnPct: number | Unavailable;
  readonly maxDrawdownPct: number;
  readonly tradeCount: number;
  readonly winRatePct: number | Unavailable;
  readonly profitFactor: number | Unavailable;
  readonly metrics: BacktestMetrics;
  /** 权益曲线（**调用方决定是否有界**；持久化请用 `buildBacktestRunPayload`）。 */
  readonly equityCurve: readonly EquityPoint[];
  /** 成交台账（同上）。 */
  readonly tradeLedger: readonly Trade[];
  /** 年化口径自述（B-04）。 */
  readonly annualizationBasis: AnnualizationBasis;
  /** 数据不足 / 口径降级等如实说明。 */
  readonly notes: readonly string[];
}

// ---------------------------------------------------------------------------
// 指标（唯一实现）
// ---------------------------------------------------------------------------

/** 由权益曲线算「每日收益 / 回撤」两列（规格 §13 / §20）。 */
export interface EquityCurveAnalysis {
  readonly points: readonly {
    readonly date: string;
    readonly equity: number;
    readonly dailyReturn: number | null;
    readonly cumulativeReturnPct: number;
    /** 逐点水下深度（**有符号，≤ 0**）。 */
    readonly drawdownPct: number;
  }[];
  /** 全期最大回撤（**正数幅度**，与全项目 `maxDrawdownPct` 同口径）。 */
  readonly maxDrawdownPct: number;
  readonly annualizedReturnPct: number | Unavailable;
  readonly tradingDayCount: number;
  /** 年化口径（自述；`annualizedReturnPct` 按此口径得出）。 */
  readonly annualizationBasis: AnnualizationBasis;
}

/**
 * BACKTEST-002（B-04）— **年化基数（canonical annualization policy）**。
 *
 * 🔴 选 252 的**依据是项目既有契约，不是偏好**：Phase A 全仓实测，除 BACKTEST-001 自己写的
 * `244` 外，**所有**年化路径都已是 252 —— `shared/quant-stats.ts:277`
 * （`annualizedReturnFromEquityCurve` 的 `annualizationTradingDays` 缺省）、
 * `backtest/metrics.ts:57`、`engine/performance.ts:60`、`research/performanceMetrics/*`、
 * `research/riskAdjustedMetrics/*`、`research/marketRegime/config.ts:52`
 * （常量 + 明写理由「252 是国际通行口径…便于跨模块结果可比」）、
 * `research/stochasticRobustness/types.ts:441`、`overfittingGuard.ts:188`。
 *
 * ⇒ 规格 §2 要求「Backtest / Evaluation / Parameter Search 同一基数」，而**异类的那个是我**，
 *   因此把 canonical 对齐到 252（而不是反过来改 8 个既有模块）。
 */
export const BACKTEST_ANNUALIZATION_DAYS = 252;

/** 年化口径的**可序列化描述**（规格 §2C：指标必须能自述口径，不能只把数字写在代码里）。 */
export interface AnnualizationBasis {
  readonly type: "TRADING_DAYS";
  readonly daysPerYear: number;
}

/** 唯一口径实例（进 `BacktestResult` / 载荷 / 闭环评估引用）。 */
export const BACKTEST_ANNUALIZATION_BASIS: AnnualizationBasis = {
  type: "TRADING_DAYS",
  daysPerYear: BACKTEST_ANNUALIZATION_DAYS,
};

export function analyzeEquityCurve(
  curve: readonly EquityPoint[],
  initialCapital: number,
): EquityCurveAnalysis {
  if (curve.length === 0) {
    return {
      points: [],
      maxDrawdownPct: 0,
      annualizedReturnPct: NOT_AVAILABLE,
      tradingDayCount: 0,
      annualizationBasis: BACKTEST_ANNUALIZATION_BASIS,
    };
  }
  const points: {
    date: string;
    equity: number;
    dailyReturn: number | null;
    cumulativeReturnPct: number;
    drawdownPct: number;
  }[] = [];
  let peak = curve[0]?.equity ?? initialCapital;
  /**
   * 🔴 最大回撤**正数幅度**（项目既有口径，全项目统一）：
   *   ① `research/performanceMetrics/analyze.ts#analyzeDrawdown` 的 `depthPct =
   *      (peak − trough) / peak × 100`（正值）；
   *   ② `riskAdjustedMetrics` 的 calmar = CAGR / maxDrawdown（若为负，calmar 符号就反了）；
   *   ③ `engine/performance.ts`、`downsideRisk.ts` 同。
   *
   * ⚠️ BACKTEST-001 曾按「drawdown = equity/peak − 1 的最小值」输出**负数** ⇒ 与闭环
   * `performance.maxDrawdownPct` 符号相反，B-04 收口时按「项目既有定义优先」（规格 §18 末句）
   * 改为正数幅度。**逐点 `drawdownPct`（水面下深度）仍为 ≤ 0 的有符号值**（水下曲线语义，
   * 与聚合量是两个不同的量：一个是曲线上的一点，一个是全期标量）。
   */
  let maxDrawdownPct = 0;
  let previousEquity: number | null = null;

  for (const point of curve) {
    const equity = point.equity;
    const dailyReturn =
      previousEquity === null || previousEquity === 0 ? null : (equity - previousEquity) / previousEquity;
    if (equity > peak) peak = equity;
    // 逐点：有符号（≤ 0），表示「当前处于水面下多深」。
    const drawdownPct = peak === 0 ? 0 : ((equity - peak) / peak) * 100;
    // 聚合：正数幅度，与全项目 `maxDrawdownPct` 同口径。
    const drawdownMagnitudePct = peak === 0 ? 0 : ((peak - equity) / peak) * 100;
    if (drawdownMagnitudePct > maxDrawdownPct) maxDrawdownPct = drawdownMagnitudePct;
    points.push({
      date: point.date,
      equity,
      dailyReturn,
      cumulativeReturnPct: initialCapital === 0 ? 0 : ((equity - initialCapital) / initialCapital) * 100,
      drawdownPct,
    });
    previousEquity = equity;
  }

  const finalEquity = curve[curve.length - 1]?.equity ?? initialCapital;
  /**
   * 🔴 B-04：年化**复用全项目唯一原语**，不再自己写指数运算。
   *
   * ① 基数 = `BACKTEST_ANNUALIZATION_DAYS`（252），与 `performanceMetrics.cagrPct` 同源；
   * ② `n` = **收益区间数 = 权益点数 − 1**，与 `shared/quant-stats#annualizedReturnFromEquityCurve`
   *    的 `n` 定义、以及 `performanceMetrics/analyze.ts:15` 文档化的口径一致。
   *    ⚠️ BACKTEST-001 曾用 `244 / 点数` ⇒ 与闭环 CAGR **必然不一致**（已修；这是本轮要收口的差异）。
   * ③ 锚点 = `initialCapital`（规格 §18）；C-14.1 输出首点 equity == initialCapital ⇒ 与用
   *    `equityCurve[0].equity` 的实际结果相同（该差异已在 performanceMetrics 文档化）。
   */
  const intervals = curve.length - 1;
  const annualizedFraction = annualizedReturnFromEquityCurve(
    initialCapital,
    finalEquity,
    intervals,
    BACKTEST_ANNUALIZATION_DAYS,
  );

  return {
    points,
    maxDrawdownPct,
    annualizedReturnPct: annualizedFraction === null ? NOT_AVAILABLE : annualizedFraction * 100,
    tradingDayCount: curve.length,
    annualizationBasis: BACKTEST_ANNUALIZATION_BASIS,
  };
}

/**
 * 由成交台账算交易层指标（规格 §20）。
 *
 * 🔴 口径必须可辨：**期末未平仓的笔不进胜率 / 盈亏比**（其 `netPnl` 通常为 null），
 * 并单独计数 `openAtEndCount`。把未平仓按 0 计入胜率会**系统性低估**胜率。
 */
export function computeTradeMetrics(trades: readonly Trade[]): {
  readonly tradeCount: number;
  readonly closedCount: number;
  readonly openAtEndCount: number;
  readonly winRatePct: number | Unavailable;
  readonly averageWinPct: number | Unavailable;
  readonly averageLossPct: number | Unavailable;
  readonly profitFactor: number | Unavailable;
} {
  const closed = trades.filter((trade) => !trade.openAtEnd && trade.netPnl !== null);
  const openAtEndCount = trades.length - closed.length;
  const wins = closed.filter((trade) => (trade.netPnl as number) > 0);
  const losses = closed.filter((trade) => (trade.netPnl as number) < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + (trade.netPnl as number), 0);
  const grossLoss = losses.reduce((sum, trade) => sum + Math.abs(trade.netPnl as number), 0);

  const avgOf = (list: readonly Trade[]): number | Unavailable => {
    if (list.length === 0) return NOT_AVAILABLE;
    const pcts = list
      .map((trade) => trade.returnPct)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (pcts.length === 0) return NOT_AVAILABLE;
    return pcts.reduce((sum, value) => sum + value, 0) / pcts.length;
  };

  return {
    tradeCount: trades.length,
    closedCount: closed.length,
    openAtEndCount,
    winRatePct: closed.length === 0 ? NOT_AVAILABLE : (wins.length / closed.length) * 100,
    averageWinPct: avgOf(wins),
    averageLossPct: avgOf(losses),
    profitFactor: grossLoss === 0 ? NOT_AVAILABLE : grossProfit / grossLoss,
  };
}

/** 组装 `BacktestResult`（唯一入口）。 */
export function buildBacktestResult(input: {
  readonly runId: string;
  readonly strategyVersionId: string;
  readonly datasetVersionId: number | null;
  readonly parameterSet: Readonly<Record<string, unknown>>;
  readonly initialCapital: number;
  readonly equityCurve: readonly EquityPoint[];
  readonly tradeLedger: readonly Trade[];
  readonly notes?: readonly string[];
}): BacktestRunResult {
  // B-04：单一出口 —— `buildBacktestResult` 与闭环 evaluation 取**同一份** canonicalMetrics。
  const canonical = canonicalMetrics({
    equityCurve: input.equityCurve,
    tradeLedger: input.tradeLedger,
    initialCapital: input.initialCapital,
  });
  const analysis = analyzeEquityCurve(input.equityCurve, input.initialCapital);
  const tradeMetrics = computeTradeMetrics(input.tradeLedger);
  const finalEquity = input.equityCurve[input.equityCurve.length - 1]?.equity ?? input.initialCapital;
  const totalReturnPct = canonical.totalReturnPct;

  const notes = [...(input.notes ?? [])];
  if (input.equityCurve.length === 0) notes.push("权益曲线为空 ⇒ 收益 / 回撤类指标按「无交易日」口径给出（0 / NOT_AVAILABLE），非伪造");
  if (tradeMetrics.openAtEndCount > 0) {
    notes.push("期末未平仓 " + String(tradeMetrics.openAtEndCount) + " 笔不计入胜率 / 盈亏比（口径可辨）");
  }

  return {
    runId: input.runId,
    strategyVersionId: input.strategyVersionId,
    datasetVersionId: input.datasetVersionId,
    parameterSet: input.parameterSet,
    initialCapital: input.initialCapital,
    finalEquity,
    totalReturnPct,
    annualizedReturnPct: canonical.annualizedReturnPct,
    maxDrawdownPct: canonical.maxDrawdownPct,
    tradeCount: canonical.tradeCount,
    winRatePct: canonical.winRatePct,
    profitFactor: canonical.profitFactor,
    metrics: {
      totalReturnPct,
      annualizedReturnPct: canonical.annualizedReturnPct,
      maxDrawdownPct: canonical.maxDrawdownPct,
      tradeCount: canonical.tradeCount,
      winRatePct: canonical.winRatePct,
      averageWinPct: canonical.averageWinPct,
      averageLossPct: canonical.averageLossPct,
      profitFactor: canonical.profitFactor,
      openAtEndCount: tradeMetrics.openAtEndCount,
      annualizationBasis: BACKTEST_ANNUALIZATION_BASIS,
    },
    equityCurve: input.equityCurve,
    tradeLedger: input.tradeLedger,
    annualizationBasis: BACKTEST_ANNUALIZATION_BASIS,
    notes,
  };
}

// ---------------------------------------------------------------------------
// BACKTEST-002（B-04）— **Canonical Metrics（唯一出口）**
// ---------------------------------------------------------------------------

/**
 * 规格 §17 要求统一的 8 项指标的**唯一字段清单**（顺序即展示顺序）。
 *
 * 🔴 纪律：任何消费方（闭环 evaluation / Parameter Search / 前端）取这些量时
 * **必须**经 `canonicalMetrics()`，不得自行从曲线/台账再算一遍。
 */
export const CANONICAL_METRIC_KEYS = [
  "totalReturnPct",
  "annualizedReturnPct",
  "maxDrawdownPct",
  "tradeCount",
  "winRatePct",
  "averageWinPct",
  "averageLossPct",
  "profitFactor",
] as const;
export type CanonicalMetricKey = (typeof CANONICAL_METRIC_KEYS)[number];

/**
 * Canonical Metrics 的**逐字段可空性**（比 `Record<..., number|Unavailable>` 更精确：
 * 回撤与交易数**永远可算**，不需要 `NOT_AVAILABLE` 这条退路）。
 */
export interface CanonicalMetrics {
  readonly totalReturnPct: number | Unavailable;
  readonly annualizedReturnPct: number | Unavailable;
  readonly maxDrawdownPct: number;
  readonly tradeCount: number;
  readonly winRatePct: number | Unavailable;
  readonly averageWinPct: number | Unavailable;
  readonly averageLossPct: number | Unavailable;
  readonly profitFactor: number | Unavailable;
}

/**
 * Canonical Metrics 的**完整形态**（8 项 + 口径 + 交易计数）。
 *
 * `CANONICAL_METRIC_KEYS` 仍是「规格 §17 要求统一的那 8 项」**纯数值子集**；
 * 这里的额外字段是**口径元数据**与**口径可辨所需的计数**（不参与逐项数值比对）。
 */
export interface CanonicalMetricsDetail extends CanonicalMetrics {
  /** 已平仓笔数（= 胜率 / 盈亏比的分母）。 */
  readonly completedTradeCount: number;
  /** 期末未平仓笔数（不进胜率 / 盈亏比）。 */
  readonly openAtEndCount: number;
  /** 年化口径。 */
  readonly annualizationBasis: AnnualizationBasis;
}

/**
 * **Canonical Metrics（唯一实现）**：由「权益曲线 + 成交台账 + 初始资金」算出规格 §17 的 8 项。
 *
 * 公式（规格 §18；年化已按 B-04 统一到 252 / `n = 点数 − 1`）：
 *   totalReturn        = finalEquity / initialCapital − 1
 *   annualizedReturn   = (finalEquity/initialCapital)^(252/n) − 1，n = 权益点数 − 1
 *                        （起点/终点 ≤ 0 或 n < 1 ⇒ NOT_AVAILABLE；复用 `shared/quant-stats` 原语）
 *   maxDrawdown        = max((峰值 − 权益) / 峰值) × 100（**正数幅度**，项目既有口径）
 *   winRate            = 盈利笔 / **已平仓笔**
 *   averageWin/Loss    = 已平仓笔的 returnPct 均值
 *   profitFactor       = grossProfit / |grossLoss|（**无亏损笔 ⇒ NOT_AVAILABLE，不是 Infinity**）
 *
 * ⚠️ 口径可辨：期末未平仓笔**不进**胜率 / 盈亏比（另见 `metrics.openAtEndCount`）。
 */
export function canonicalMetrics(input: {
  readonly equityCurve: readonly EquityPoint[];
  readonly tradeLedger: readonly Trade[];
  readonly initialCapital: number;
}): CanonicalMetricsDetail {
  const analysis = analyzeEquityCurve(input.equityCurve, input.initialCapital);
  const tradeMetrics = computeTradeMetrics(input.tradeLedger);
  const finalEquity = input.equityCurve[input.equityCurve.length - 1]?.equity ?? input.initialCapital;
  /**
   * 🔴 表达式形式必须与 `performanceMetrics` **逐字符一致**（`(end/start − 1) × 100`），
   * 不能写成代数等价但浮点不同的 `((end − start) / start) × 100`。
   *
   * 实测（闭环 `closedLoopWiring.test.ts` / `researchRunRouter.test.ts`）：
   * 后者的写法会给出 `5.3`，前者给出 `5.299999999999994` ⇒ 同一量在两条路径上**不是同一个 double**，
   * 「唯一口径」就只剩口号。锚点仍是 `initialCapital`（规格 §18），只是算式形式统一。
   */
  const totalReturnPct =
    input.initialCapital === 0 ? NOT_AVAILABLE : (finalEquity / input.initialCapital - 1) * 100;
  return {
    totalReturnPct: num(totalReturnPct),
    annualizedReturnPct: num(analysis.annualizedReturnPct),
    maxDrawdownPct: analysis.maxDrawdownPct,
    tradeCount: tradeMetrics.tradeCount,
    winRatePct: num(tradeMetrics.winRatePct),
    averageWinPct: num(tradeMetrics.averageWinPct),
    averageLossPct: num(tradeMetrics.averageLossPct),
    profitFactor: num(tradeMetrics.profitFactor),
    completedTradeCount: tradeMetrics.closedCount,
    openAtEndCount: tradeMetrics.openAtEndCount,
    annualizationBasis: BACKTEST_ANNUALIZATION_BASIS,
  };
}

/** 逐项比对两组 canonical 指标（供闭环「两套口径是否漂移」的守卫与测试使用）。 */
export function diffCanonicalMetrics(
  left: CanonicalMetrics,
  right: CanonicalMetrics,
  tolerance = 1e-9,
): readonly { readonly key: CanonicalMetricKey; readonly left: number | Unavailable; readonly right: number | Unavailable }[] {
  const out: { key: CanonicalMetricKey; left: number | Unavailable; right: number | Unavailable }[] = [];
  for (const key of CANONICAL_METRIC_KEYS) {
    const a = left[key];
    const b = right[key];
    if (a === NOT_AVAILABLE || b === NOT_AVAILABLE) {
      if (a !== b) out.push({ key, left: a, right: b });
      continue;
    }
    if (Math.abs(a - b) > tolerance) out.push({ key, left: a, right: b });
  }
  return out;
}

// ---------------------------------------------------------------------------
// §23 — 有界持久化载荷（摘要 + 有界样本 + 滚动指纹）
// ---------------------------------------------------------------------------

/** 默认样本上限（诊断用，不参与计算）。 */
export const DEFAULT_BACKTEST_SAMPLE_LIMIT = 60;

export interface BacktestRunPayload {
  /**
   * BACKTEST-002（B-04）— **Canonical Metrics（唯一读数面）**。
   *
   * 闭环 evaluation / Parameter Search / 前端都从这里取数字，不再各自计算。
   */
  readonly canonicalMetrics: CanonicalMetricsDetail;
  /** 摘要：全部标量指标 + 规模。 */
  readonly summary: {
    readonly initialCapital: number;
    readonly finalEquity: number;
    readonly totalReturnPct: number | Unavailable;
    readonly annualizedReturnPct: number | Unavailable;
    readonly maxDrawdownPct: number;
    readonly tradeCount: number;
    readonly winRatePct: number | Unavailable;
    readonly profitFactor: number | Unavailable;
    readonly averageWinPct: number | Unavailable;
    readonly averageLossPct: number | Unavailable;
    readonly openAtEndCount: number;
    readonly equityPointCount: number;
    readonly tradingDayCount: number;
  };
  /** 有界样本（**均匀抽样**，确定性；首尾必含）。 */
  readonly equitySamples: readonly EquityCurveAnalysis["points"][number][];
  readonly tradeSamples: readonly Trade[];
  /** 是否发生了截断（界面须如实提示「明细已抽样」）。 */
  readonly truncated: { readonly equity: boolean; readonly trades: boolean };
  /** 全量明细的滚动指纹（**可逐字节比对**，用于「同配置重跑是否相同」）。 */
  readonly equityDigest: string;
  readonly tradeDigest: string;
  /** 回撤曲线（与 equitySamples 同索引，供画图；有界）。 */
  readonly notes: readonly string[];
}

function rollingDigest(seed: string, lines: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update(seed);
  for (const line of lines) {
    hash.update("\u0000");
    hash.update(line);
  }
  return hash.digest("hex");
}

/** 均匀抽样（确定性；首尾必含；`limit >= 2`）。 */
function sampleEvenly<T>(items: readonly T[], limit: number): readonly T[] {
  if (items.length <= limit) return [...items];
  const n = Math.max(2, limit);
  const picked: T[] = [];
  for (let index = 0; index < n; index += 1) {
    const at = Math.round((index * (items.length - 1)) / (n - 1));
    picked.push(items[at] as T);
  }
  return picked;
}

/**
 * 构造**有界**持久化载荷（规格 §23）。
 *
 * 🔴 为什么必须这样做：Phase A 实测 `simulator/engine.ts:422,703,709` 对
 * `trades` / `equityCurve` **无 cap / 无采样 / 无截断**，全量随 `resultJson`（longtext）落库。
 * 一年 × 全市场的曲线可达 10^4~10^5 点 ⇒ 单行数百 KB~数 MB。
 * 载荷保留**全部标量 + 有界样本 + 全量滚动指纹**：结论可比对，明细可抽样回看。
 *
 * `canonicalMetrics.annualizationBasis` 自述年化口径（B-04 规格 §2C）——
 * 消费方无需知道 252 这个数字从哪来。
 */
export function buildBacktestRunPayload(input: {
  readonly result: BacktestRunResult;
  readonly sampleLimit?: number;
}): BacktestRunPayload {
  const limit = Math.max(2, input.sampleLimit ?? DEFAULT_BACKTEST_SAMPLE_LIMIT);
  const analysis = analyzeEquityCurve(input.result.equityCurve, input.result.initialCapital);
  const availableCurve = analysis.points.filter((point): point is NonNullable<typeof point> => point !== undefined);
  const equitySamples = sampleEvenly(availableCurve, limit);
  const tradeSamples = sampleEvenly(input.result.tradeLedger, limit);

  const equityDigest = rollingDigest(
    "equity/v1",
    input.result.equityCurve.map(
      (point) => [point.date, point.equity, point.cash, point.marketValue, point.openPositions].join("|"),
    ),
  );
  const tradeDigest = rollingDigest(
    "trade/v1",
    input.result.tradeLedger.map((trade) =>
      [
        trade.securityId,
        trade.entryTime,
        trade.entryPrice,
        trade.exitTime ?? "",
        trade.exitPrice ?? "",
        trade.quantity,
        trade.netPnl ?? "",
        trade.fees,
        trade.slippageAmount,
      ].join("|"),
    ),
  );

  return {
    canonicalMetrics: canonicalMetrics({
      equityCurve: input.result.equityCurve,
      tradeLedger: input.result.tradeLedger,
      initialCapital: input.result.initialCapital,
    }),
    summary: {
      initialCapital: input.result.initialCapital,
      finalEquity: input.result.finalEquity,
      totalReturnPct: input.result.totalReturnPct,
      annualizedReturnPct: input.result.annualizedReturnPct,
      maxDrawdownPct: input.result.maxDrawdownPct,
      tradeCount: input.result.metrics.tradeCount,
      winRatePct: input.result.metrics.winRatePct,
      profitFactor: input.result.metrics.profitFactor,
      averageWinPct: input.result.metrics.averageWinPct,
      averageLossPct: input.result.metrics.averageLossPct,
      openAtEndCount: input.result.metrics.openAtEndCount,
      equityPointCount: input.result.equityCurve.length,
      tradingDayCount: analysis.tradingDayCount,
    },
    equitySamples,
    tradeSamples,
    truncated: {
      equity: input.result.equityCurve.length > limit,
      trades: input.result.tradeLedger.length > limit,
    },
    equityDigest,
    tradeDigest,
    notes: [
      ...input.result.notes,
      input.result.equityCurve.length > limit || input.result.tradeLedger.length > limit
        ? "明细已抽样（equity ≤ " + String(limit) + " / trades ≤ " + String(limit) + "）；全量指纹见 equityDigest / tradeDigest"
        : "明细未截断（全量已入载荷）",
    ],
  };
}
