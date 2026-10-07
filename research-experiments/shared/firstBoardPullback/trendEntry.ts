/**
 * 趋势入场 / 条件退出 —— **配置驱动**的求值器（纯函数，零 IO）。
 *
 * 定位（用户 2026-10-07 裁定）：
 *   - 入场**不钉死固定日**（不是「T+6 开盘」），而是「观察窗内**首个**满足全部条件的交易日」；
 *   - 收益**不钉死固定日期**（不是「T+6 买 / T+10 卖」），而是「**实际入场 → 实际退出**」；
 *   - 条件词表**恰好四类**（用户明确「就这四类」）：
 *       ① PRICE_VS_MA   收盘 vs MA_N
 *       ② MA_ORDER      MA_fast vs MA_slow
 *       ③ MA_SLOPE      MA_N 的 lookback 日斜率
 *       ④ RETURN_OVER   N 日收益
 *
 * 纪律：
 *   - **PIT**：rd 日的条件只用「rd 及以前」的收盘；绝不用 rd 之后的 bar；
 *   - **不插补**：MA / 收益窗口内任一根缺失或非法 ⇒ 该条件**不可评估**（返回 null），
 *     在触发判定中按「不通过」处理，并如实计数（不得当成 0 或前值）；
 *   - **不自定义成交**：入场价 = 触发日**次一交易日开盘**（须 `canBuyAtOpen`）；退出按配置；
 *   - 本模块**不执行**、不写库、不建第二套引擎 —— 它只把「事件 × 窗口 bar」映射成
 *     「触发日 / 入场 / 退出 / 毛收益」，供实验层聚合。
 */
import type { NormalizedFoundationBar } from "./types";

/** 允许的均线窗口（MA5/10/20/60）—— 与 v9 的 preWindowDays=60 对齐。 */
export const TREND_MA_WINDOWS = [5, 10, 20, 60] as const;
export type TrendMaWindow = (typeof TREND_MA_WINDOWS)[number];

export type TrendOperator = "GT" | "LT";

/** 四类条件（用户裁定：只此四类）。 */
export type TrendCondition =
  | { readonly kind: "PRICE_VS_MA"; readonly ma: TrendMaWindow; readonly op: TrendOperator }
  | { readonly kind: "MA_ORDER"; readonly fast: TrendMaWindow; readonly slow: TrendMaWindow; readonly op: TrendOperator }
  | { readonly kind: "MA_SLOPE"; readonly ma: TrendMaWindow; readonly lookback: number; readonly op: TrendOperator; readonly pct: number }
  | { readonly kind: "RETURN_OVER"; readonly days: number; readonly op: TrendOperator; readonly pct: number };

export interface TrendEntryConfig {
  /** 观察窗（事件相对日；fromRd ≥ 1 = 首板日之后才开始看）。 */
  readonly window: { readonly fromRd: number; readonly toRd: number };
  /** 触发条件：`all` 全真（AND）；`any` 至少一真（OR，可为空 = 不启用）。 */
  readonly trigger: { readonly all: readonly TrendCondition[]; readonly any: readonly TrendCondition[] };
  /** 触发后的入场执行（当前仅支持次一交易日开盘 —— 与既有执行口径一致）。 */
  readonly execution: "NEXT_OPEN";
  /** 未触发时的处置（当前仅支持作废）。 */
  readonly onNoTrigger: "SKIP";
}

export interface TrendExitConfig {
  /** HORIZON_FROM_ENTRY = 自入场起 N 日；CONDITION = 条件触发；MIXED = 两者取先到。 */
  readonly mode: "HORIZON_FROM_ENTRY" | "CONDITION" | "MIXED";
  /** 自**实际入场日**起持有的交易日数（null = 不设）。 */
  readonly horizonDays: number | null;
  /** 退出条件（在入场日及之后逐日按收盘判定）。 */
  readonly conditions: readonly TrendCondition[];
  /** 盘中固定止损比例（如 0.06 = −6%）；null = 不设。 */
  readonly stopRatio: number | null;
  /** 条件命中后的成交时点。 */
  readonly exitAt: "NEXT_OPEN" | "SAME_CLOSE";
}

/** 按相对日索引的 bar 序列（含负相对日 = 事件日前预热）。 */
export type TrendBarSeries = ReadonlyMap<number, NormalizedFoundationBar>;

export interface ConditionOutcome {
  readonly satisfied: boolean;
  /** 数据不足 / 非法 ⇒ true（不可评估按不通过处理）。 */
  readonly unevaluable: boolean;
}

export interface EntryOutcome {
  readonly status: "TRIGGERED" | "NO_TRIGGER" | "UNFILLABLE";
  readonly triggerRd: number | null;
  readonly entryRd: number | null;
  readonly entryPrice: number | null;
  /** 观察窗内被评估的交易日数（用于如实报告）。 */
  readonly evaluatedDays: number;
  readonly unevaluableDays: number;
}

export interface ExitOutcome {
  readonly status: "EXITED" | "OPEN_AT_END" | "NO_ENTRY";
  readonly exitRd: number | null;
  readonly exitPrice: number | null;
  readonly reason: "STOP_INTRADAY" | "CONDITION_NEXT_OPEN" | "CONDITION_SAME_CLOSE" | "HORIZON_CLOSE" | "WINDOW_END_CLOSE" | null;
  readonly holdingDays: number | null;
}

function closeAt(series: TrendBarSeries, rd: number): number | null {
  const bar = series.get(rd);
  if (bar === undefined || !bar.structurallyValid || !bar.barPresent) return null;
  return bar.close !== null && Number.isFinite(bar.close) ? bar.close : null;
}

/**
 * 相对日 `rd` 处、含当日的 `window` 根收盘均值（PIT：只用 rd-window+1..rd）。
 *
 * 任一根缺失 / 非法 ⇒ null（不插补、不回退前值）。
 */
export function movingAverageAt(series: TrendBarSeries, rd: number, window: number): number | null {
  if (!Number.isInteger(window) || window <= 0) return null;
  let sum = 0;
  for (let offset = window - 1; offset >= 0; offset -= 1) {
    const close = closeAt(series, rd - offset);
    if (close === null) return null;
    sum += close;
  }
  return sum / window;
}

/** 判断 `left op right`（阈值型条件将其化为同一比较）。 */
function compare(left: number, right: number, op: TrendOperator): boolean {
  return op === "GT" ? left > right : left < right;
}

/** 单个条件在相对日 `rd` 的求值结果。 */
export function evaluateCondition(
  series: TrendBarSeries,
  rd: number,
  condition: TrendCondition,
): ConditionOutcome {
  switch (condition.kind) {
    case "PRICE_VS_MA": {
      const close = closeAt(series, rd);
      const ma = movingAverageAt(series, rd, condition.ma);
      if (close === null || ma === null) return { satisfied: false, unevaluable: true };
      return { satisfied: compare(close, ma, condition.op), unevaluable: false };
    }
    case "MA_ORDER": {
      const fast = movingAverageAt(series, rd, condition.fast);
      const slow = movingAverageAt(series, rd, condition.slow);
      if (fast === null || slow === null) return { satisfied: false, unevaluable: true };
      return { satisfied: compare(fast, slow, condition.op), unevaluable: false };
    }
    case "MA_SLOPE": {
      const now = movingAverageAt(series, rd, condition.ma);
      const before = movingAverageAt(series, rd - condition.lookback, condition.ma);
      if (now === null || before === null || before === 0) return { satisfied: false, unevaluable: true };
      const slopePct = (now / before - 1) * 100;
      return { satisfied: compare(slopePct, condition.pct, condition.op), unevaluable: false };
    }
    case "RETURN_OVER": {
      const close = closeAt(series, rd);
      const before = closeAt(series, rd - condition.days);
      if (close === null || before === null || before === 0) return { satisfied: false, unevaluable: true };
      const returnPct = (close / before - 1) * 100;
      return { satisfied: compare(returnPct, condition.pct, condition.op), unevaluable: false };
    }
    default: {
      return { satisfied: false, unevaluable: true };
    }
  }
}

/** `all` 全真且 `any` 至少一真（`any` 为空 = 不启用）。任一条件不可评估 ⇒ 不通过。 */
function triggerSatisfied(series: TrendBarSeries, rd: number, trigger: TrendEntryConfig["trigger"]): { satisfied: boolean; unevaluable: boolean } {
  let unevaluable = false;
  for (const condition of trigger.all) {
    const outcome = evaluateCondition(series, rd, condition);
    if (outcome.unevaluable) unevaluable = true;
    if (!outcome.satisfied) return { satisfied: false, unevaluable };
  }
  if (trigger.any.length === 0) return { satisfied: true, unevaluable };
  let anySatisfied = false;
  for (const condition of trigger.any) {
    const outcome = evaluateCondition(series, rd, condition);
    if (outcome.unevaluable) unevaluable = true;
    if (outcome.satisfied) anySatisfied = true;
  }
  return { satisfied: anySatisfied, unevaluable };
}

/**
 * 在观察窗内找**首个**满足触发条件的交易日，并按 `NEXT_OPEN` 给出入场。
 *
 * 入场要求：触发日的次一交易日 bar 存在、结构有效、`canBuyAtOpen !== false`，
 * 且开盘价有效 —— 任一不满足 ⇒ `UNFILLABLE`（不向前/向后顺延，不假设成交）。
 */
export function evaluateEntry(config: TrendEntryConfig, series: TrendBarSeries): EntryOutcome {
  if (config.window.fromRd < 1 || config.window.toRd < config.window.fromRd) {
    return { status: "NO_TRIGGER", triggerRd: null, entryRd: null, entryPrice: null, evaluatedDays: 0, unevaluableDays: 0 };
  }
  let evaluatedDays = 0;
  let unevaluableDays = 0;
  for (let rd = config.window.fromRd; rd <= config.window.toRd; rd += 1) {
    evaluatedDays += 1;
    const outcome = triggerSatisfied(series, rd, config.trigger);
    if (outcome.unevaluable) unevaluableDays += 1;
    if (!outcome.satisfied) continue;
    const entryRd = rd + 1;
    const bar = series.get(entryRd);
    const fillable =
      bar !== undefined
      && bar.structurallyValid
      && bar.barPresent
      && bar.canBuyAtOpen !== false
      && bar.open !== null
      && Number.isFinite(bar.open)
      && bar.open > 0;
    if (!fillable) {
      return { status: "UNFILLABLE", triggerRd: rd, entryRd, entryPrice: null, evaluatedDays, unevaluableDays };
    }
    return { status: "TRIGGERED", triggerRd: rd, entryRd, entryPrice: bar.open, evaluatedDays, unevaluableDays };
  }
  return { status: "NO_TRIGGER", triggerRd: null, entryRd: null, entryPrice: null, evaluatedDays, unevaluableDays };
}

/**
 * 自 `entryRd` 起按配置判定退出（PIT：逐日只用该日及以前）。
 *
 * 优先级（逐日）：盘中固定止损 → 退出条件 → 持有期到点。
 * 直至系列末端仍未触发 ⇒ `OPEN_AT_END`（按最后一个有效收盘估值，如实标记）。
 */
export function evaluateExit(
  config: TrendExitConfig,
  series: TrendBarSeries,
  entryRd: number,
  entryPrice: number,
  maxRelativeDay: number,
): ExitOutcome {
  if (!(entryPrice > 0)) return { status: "NO_ENTRY", exitRd: null, exitPrice: null, reason: null, holdingDays: null };
  let lastValidRd: number | null = null;
  let lastValidClose: number | null = null;
  for (let rd = entryRd; rd <= maxRelativeDay; rd += 1) {
    const bar = series.get(rd);
    if (bar === undefined || !bar.structurallyValid || !bar.barPresent) continue;
    const close = closeAt(series, rd);
    if (close === null) continue;
    lastValidRd = rd;
    lastValidClose = close;
    const holdingDays = rd - entryRd;
    // ① 盘中固定止损（同日成交，按止损价，不假设更好）
    if (config.stopRatio !== null && config.stopRatio > 0 && bar.low !== null && Number.isFinite(bar.low)) {
      const stopPrice = entryPrice * (1 - config.stopRatio);
      if (bar.low <= stopPrice) {
        return { status: "EXITED", exitRd: rd, exitPrice: stopPrice, reason: "STOP_INTRADAY", holdingDays };
      }
    }
    // ② 退出条件
    if (config.mode === "CONDITION" || config.mode === "MIXED") {
      let allSatisfied = config.conditions.length > 0;
      for (const condition of config.conditions) {
        const outcome = evaluateCondition(series, rd, condition);
        if (!outcome.satisfied) { allSatisfied = false; break; }
      }
      if (allSatisfied) {
        if (config.exitAt === "SAME_CLOSE") {
          return { status: "EXITED", exitRd: rd, exitPrice: close, reason: "CONDITION_SAME_CLOSE", holdingDays };
        }
        const nextBar = series.get(rd + 1);
        const canSell = nextBar !== undefined
          && nextBar.structurallyValid
          && nextBar.barPresent
          && nextBar.canSellAtClose !== false
          && nextBar.open !== null
          && Number.isFinite(nextBar.open)
          && nextBar.open > 0;
        if (canSell) {
          return { status: "EXITED", exitRd: rd + 1, exitPrice: nextBar.open, reason: "CONDITION_NEXT_OPEN", holdingDays: rd + 1 - entryRd };
        }
        // 不可卖 ⇒ 继续持有（不假设成交）
      }
    }
    // ③ 持有期到点（自实际入场日）
    if ((config.mode === "HORIZON_FROM_ENTRY" || config.mode === "MIXED")
      && config.horizonDays !== null && holdingDays >= config.horizonDays) {
      return { status: "EXITED", exitRd: rd, exitPrice: close, reason: "HORIZON_CLOSE", holdingDays };
    }
  }
  if (lastValidRd === null || lastValidClose === null) {
    return { status: "NO_ENTRY", exitRd: null, exitPrice: null, reason: null, holdingDays: null };
  }
  return { status: "OPEN_AT_END", exitRd: lastValidRd, exitPrice: lastValidClose, reason: "WINDOW_END_CLOSE", holdingDays: lastValidRd - entryRd };
}

/** 单边成本（bps）：佣金 + 滑点 + 冲击；卖出再加印花税。 */
export interface TrendCostConfig {
  readonly commissionBpsPerSide: number;
  readonly slippageBpsPerSide: number;
  readonly impactBpsPerSide: number;
  readonly stampDutyBps: number;
}

export function netReturnPct(grossReturnPct: number, cost: TrendCostConfig): number {
  const buyBps = cost.commissionBpsPerSide + cost.slippageBpsPerSide + cost.impactBpsPerSide;
  const sellBps = buyBps + cost.stampDutyBps;
  return grossReturnPct - (buyBps + sellBps) / 100;
}
