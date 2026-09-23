/**
 * STEP 12.6 — Research Dataset：首板回踩筛选（通用规则，纯函数，无 IO，确定性）。
 *
 * 定位：作为 `universeFilter` 的通用「回踩条件」，在「首板」事件（T0 涨停且 T-1 未涨停）
 * 之上，对 T+1~T+N 观察窗口做「触及且不破」判定，从而把数据集进一步窄化到
 * 「首板后出现有效回踩」的候选。首板判定本身复用 tDayFilter（isRowLimitUp +
 * matchesTDayCondition("firstBoard")），本模块不重复实现首板语义。
 *
 * 口径（与用户确认）：
 *   - 回踩目标位可多选：涨停价(limitPrice) / T0 开盘(t0Open) / T0 最低(t0Low) / 5 日均线(ma5)。
 *   - 触及且不破：窗口内最低价 minLow 落在 [目标位, 目标位×(1+容差)] 区间内，且全程未跌破目标位。
 *   - 涨停价复用 STEP 5 权威 boardRules.resolveLimitRules / limitUpPrice。
 *   - 保守缺省：目标位数据不足（如 MA5 不足 5 日）→ 该目标位不可判定（hit=false），不伪造命中。
 *   - 🔴 **信息边界 = 决策日 d**（`condition.decisionOffsetDays`）：样本资格判定**只能**使用
 *     T+1..T+d。用整段 T+1..T+N 决定样本是否进池，等于在**样本层**使用未来数据
 *     （survivor / look-ahead bias）——之后所有统计都建立在「事后已知会成立」的样本上。
 *     `d < N` 时 T+d+1..T+N 的数据仍然加载（供研究侧观察日变量用），但**不参与**入池判定。
 */

import {
  exchangeLimitUpPrice,
  resolveLimitRulesAt,
} from "../data/boardRules";
import type { CanonicalMarketBar } from "../data/types";
import type { PullbackScreenCondition, PullbackTargetType } from "./types";

// ---------------------------------------------------------------------------
// 领域类型（回踩筛选专属，不并入 dataset 主类型）
// ---------------------------------------------------------------------------

/** 首板事件（T0）——仅保留回踩判定所需字段。 */
export interface FirstBoardEvent {
  /** 完整代码（如 600001.SH）。 */
  securityCode: string;
  /** 首板交易日（T0，YYYY-MM-DD）。 */
  eventDate: string;
  /** T0 开盘价（未复权，元）。 */
  t0Open: number | null;
  /** T0 最低价。 */
  t0Low: number | null;
  /** T0 收盘价。 */
  t0Close: number | null;
  /** T0 前收盘价。 */
  preClose: number | null;
  /** T0 涨停价（四舍五入到分）。 */
  limitPrice: number | null;
  /** 板块（main/chinext/star/bse/unknown）。 */
  board: string;
  /** T0 日 5 日均线（含 T0 的最近 5 个交易日收盘均值）；不足 5 日 → null。 */
  ma5: number | null;
}

/** 回踩窗口内的一根 bar（仅保留判定所需字段）。 */
export interface WindowBar {
  tradeDate: string;
  low: number | null;
}

/**
 * 解析并校验「决策日偏移 d」。
 *
 * 🔴 这是样本资格的信息边界，**唯一实现源**：任何调用方（含绕过 validate 的脚本）都必须经此，
 * 不允许把非法值静默夹成整窗或空窗 —— 前者保留缺陷、后者是「没数据」伪装成「无命中」。
 */
export function resolveDecisionOffsetDays(
  condition: PullbackScreenCondition
): number {
  const d = condition.decisionOffsetDays;
  const n = condition.observationWindowDays;
  if (!Number.isInteger(d) || d < 1 || d > n) {
    throw new Error(
      `pullback.decisionOffsetDays 必须是 [1, observationWindowDays=${String(n)}] 的整数，实得 ${String(d)}。` +
        "该字段是样本资格的唯一信息边界，不允许缺省（缺省即回到「整窗筛选」的 look-ahead 行为）。"
    );
  }
  return d;
}

/** 单个回踩目标位的判定结果。 */
export interface PullbackTargetResult {
  targetType: PullbackTargetType;
  /** 目标价位（null = 该目标位数据不足，不可判定）。 */
  targetPrice: number | null;
  /** 是否命中「触及且不破」。 */
  hit: boolean;
  /** 命中的交易日（窗口内最低价对应日）。 */
  hitDate: string | null;
  /** 窗口内最低价。 */
  hitLow: number | null;
  /** 最低价相对目标位的偏离（%，正=在目标位上方）。 */
  lowPctAboveTarget: number | null;
  /** 是否跌破目标位（true = 回踩失败）。 */
  broken: boolean;
}

// ---------------------------------------------------------------------------
// 目标位解析 + 触及且不破判定
// ---------------------------------------------------------------------------

/** 解析目标位价格（依赖首板事件 T0 数据）。 */
export function resolveTargetPrice(
  event: FirstBoardEvent,
  targetType: PullbackTargetType
): number | null {
  switch (targetType) {
    case "limitPrice":
      return event.limitPrice;
    case "t0Open":
      return event.t0Open;
    case "t0Low":
      return event.t0Low;
    case "ma5":
      return event.ma5;
    default:
      return null;
  }
}

/** 对单一目标位做「触及且不破」判定。 */
export function screenSingleTarget(
  event: FirstBoardEvent,
  windowBars: readonly WindowBar[],
  targetType: PullbackTargetType,
  tolerancePercent: number
): PullbackTargetResult {
  const targetPrice = resolveTargetPrice(event, targetType);
  if (targetPrice === null || targetPrice <= 0) {
    return {
      targetType,
      targetPrice: null,
      hit: false,
      hitDate: null,
      hitLow: null,
      lowPctAboveTarget: null,
      broken: false,
    };
  }

  let hitLow: number | null = null;
  let hitDate: string | null = null;
  let broken = false;

  for (const bar of windowBars) {
    if (bar.low === null) continue;
    if (bar.low < targetPrice) {
      broken = true; // 跌破目标位 → 回踩失败
      continue;
    }
    if (hitLow === null || bar.low < hitLow) {
      hitLow = bar.low;
      hitDate = bar.tradeDate;
    }
  }

  if (broken || hitLow === null) {
    return {
      targetType,
      targetPrice,
      hit: false,
      hitDate: null,
      hitLow,
      lowPctAboveTarget:
        hitLow !== null ? ((hitLow - targetPrice) / targetPrice) * 100 : null,
      broken,
    };
  }

  const tolerance = tolerancePercent / 100;
  const hit = hitLow <= targetPrice * (1 + tolerance);

  return {
    targetType,
    targetPrice,
    hit,
    hitDate: hit ? hitDate : null,
    hitLow,
    lowPctAboveTarget: ((hitLow - targetPrice) / targetPrice) * 100,
    broken: false,
  };
}

/** 对全部目标位做回踩判定。 */
export function screenPullback(
  event: FirstBoardEvent,
  windowBars: readonly WindowBar[],
  targets: readonly PullbackTargetType[],
  tolerancePercent: number
): PullbackTargetResult[] {
  return targets.map(target =>
    screenSingleTarget(event, windowBars, target, tolerancePercent)
  );
}

// ---------------------------------------------------------------------------
// 由逐日 facts 构造首板事件 + 观察窗口（builder 接线用，纯函数）
// ---------------------------------------------------------------------------

/** 计算含 T0 在内的最近 5 个交易日收盘均值；不足 5 日或任一收盘缺失 → null。 */
export function computeMa5FromFacts(
  code: string,
  t0Date: string,
  priceByDate: ReadonlyMap<string, ReadonlyMap<string, CanonicalMarketBar>>,
  calendarDates: readonly string[]
): number | null {
  const idx = calendarDates.indexOf(t0Date);
  if (idx < 0) return null;
  const closes: number[] = [];
  for (let j = idx; j >= 0 && j > idx - 5; j -= 1) {
    const date = calendarDates[j]!;
    const bar = priceByDate.get(date)?.get(code);
    if (!bar || bar.close === null || bar.close === undefined) return null;
    closes.push(bar.close);
  }
  if (closes.length < 5) return null;
  return closes.reduce((sum, value) => sum + value, 0) / closes.length;
}

/** 构造 T+1 ~ T+N 观察窗口 bars（按交易日序；数据缺失的日期 low=null）。 */
export function buildWindowBars(
  code: string,
  t0Date: string,
  priceByDate: ReadonlyMap<string, ReadonlyMap<string, CanonicalMarketBar>>,
  calendarDates: readonly string[],
  observationWindowDays: number
): WindowBar[] {
  const idx = calendarDates.indexOf(t0Date);
  const bars: WindowBar[] = [];
  for (
    let j = idx + 1;
    j < calendarDates.length && j <= idx + observationWindowDays;
    j += 1
  ) {
    const date = calendarDates[j]!;
    const bar = priceByDate.get(date)?.get(code);
    bars.push({ tradeDate: date, low: bar?.low ?? null });
  }
  return bars;
}

/**
 * 由首板行（含 T0 OHLC/preClose）+ 逐日 facts 构造首板事件。
 * 涨停价按板块解析（STEP 5 权威），MA5 由前 4 个交易日 + T0 收盘计算。
 */
export function buildFirstBoardEvent(
  row: Pick<
    import("./types").ResearchDatasetRow,
    | "code"
    | "tradeDate"
    | "st"
    | "open"
    | "high"
    | "low"
    | "close"
    | "preClose"
  >,
  priceByDate: ReadonlyMap<string, ReadonlyMap<string, CanonicalMarketBar>>,
  calendarDates: readonly string[]
): FirstBoardEvent | null {
  const code = row.code;
  if (!code) return null;
  const rules = resolveLimitRulesAt(code, row.tradeDate, row.st);
  const limitPrice =
    rules.supported &&
    rules.limitUpRatio !== null &&
    row.preClose !== null &&
    row.preClose > 0
      ? exchangeLimitUpPrice(row.preClose, rules.limitUpRatio)
      : null;
  return {
    securityCode: code,
    eventDate: row.tradeDate,
    t0Open: row.open,
    t0Low: row.low,
    t0Close: row.close,
    preClose: row.preClose,
    limitPrice,
    board: rules.board,
    ma5: computeMa5FromFacts(code, row.tradeDate, priceByDate, calendarDates),
  };
}

/** 回踩筛选输出（单事件）。 */
export interface PullbackScreenVerdict {
  event: FirstBoardEvent;
  /** 决策日偏移 d（交易日）—— 判定只用 T+1..T+d。 */
  decisionOffsetDays: number;
  /** **实际参与样本资格判定**的 bars = T+1..T+d。 */
  decisionBars: WindowBar[];
  /** 完整加载窗口 T+1..T+N（供研究侧观察日变量用；**不参与**样本资格判定）。 */
  loadedBars: WindowBar[];
  /** **决策窗口**（T+1..T+d）是否交易日齐备（缺失/停牌导致 low 缺失即不完整）。 */
  windowComplete: boolean;
  /** 决策窗口内缺 bar 的交易日。 */
  missingDates: string[];
  results: PullbackTargetResult[];
  /** 是否至少命中一个目标位（触及且不破）。 */
  matched: boolean;
}

/**
 * 对单个首板行做回踩筛选（纯函数）。
 * 窗口不完整（交易日缺 bar）→ 保守排除（matched=false，由调用方计入完整性排除）。
 */
export function screenFirstBoardRow(
  row: Pick<
    import("./types").ResearchDatasetRow,
    | "code"
    | "tradeDate"
    | "st"
    | "open"
    | "high"
    | "low"
    | "close"
    | "preClose"
  >,
  priceByDate: ReadonlyMap<string, ReadonlyMap<string, CanonicalMarketBar>>,
  calendarDates: readonly string[],
  condition: PullbackScreenCondition
): PullbackScreenVerdict {
  const decisionOffsetDays = resolveDecisionOffsetDays(condition);
  const event = buildFirstBoardEvent(row, priceByDate, calendarDates);
  if (!event) {
    return {
      event: {
        securityCode: row.code ?? "",
        eventDate: row.tradeDate,
        t0Open: row.open,
        t0Low: row.low,
        t0Close: row.close,
        preClose: row.preClose,
        limitPrice: null,
        board: "unknown",
        ma5: null,
      },
      decisionOffsetDays,
      decisionBars: [],
      loadedBars: [],
      windowComplete: false,
      missingDates: [],
      results: [],
      matched: false,
    };
  }

  const loadedBars = buildWindowBars(
    event.securityCode,
    event.eventDate,
    priceByDate,
    calendarDates,
    condition.observationWindowDays
  );
  // 🔴 信息边界：只用 T+1..T+d 判样本资格。`loadedBars` 的其余部分（T+d+1..T+N）
  // 只供研究侧观察日变量使用，**绝不**进入入池判定。
  const decisionBars = loadedBars.slice(0, decisionOffsetDays);
  const missingDates = decisionBars
    .filter(b => b.low === null)
    .map(b => b.tradeDate);
  const windowComplete =
    decisionBars.length === decisionOffsetDays && missingDates.length === 0;

  const results = windowComplete
    ? screenPullback(
        event,
        decisionBars,
        condition.targetTypes,
        condition.tolerancePercent
      )
    : condition.targetTypes.map(targetType => ({
        targetType,
        targetPrice: resolveTargetPrice(event, targetType),
        hit: false,
        hitDate: null,
        hitLow: null,
        lowPctAboveTarget: null,
        broken: false,
      }));

  return {
    event,
    decisionOffsetDays,
    decisionBars,
    loadedBars,
    windowComplete,
    missingDates,
    results,
    matched: windowComplete && results.some(r => r.hit),
  };
}
