/**
 * STEP DATASET-001 — 首板事件检测（纯函数，无 IO，确定性）。
 *
 * 复用 STEP 5 涨跌停权威 `server/data/boardRules`（classifyBoard + limitUpPrice），
 * 不重复实现「+10%」近似。涨停比例按板块 + PIT ST 维度：
 *   主板 10%（ST/*ST 5%）、创业板/科创板 20%、北交所 30%、unknown 板块不可判。
 *
 * 首板定义（与 researchDataset/tDayFilter 口径一致）：T 日涨停 且 T-1（上一交易日）未涨停；
 * T-1 无数据 / 窗口首日视作「非连板」→ 弱化为首板。
 *
 * 反泄漏：首板判定只依赖 T 日 close/preClose + 截至 T 日的滚动状态，绝不触碰未来。
 */

import { classifyBoard, limitUpPrice } from "../data/boardRules";

/** PIT ST 状态（来自 research_security_status_history，ST 维度解析）。 */
export type StStatus = "NORMAL" | "ST" | "*ST" | "UNKNOWN";

/** 日线 bar（Dataset 模块自持的轻量类型，与 canonical 解耦，由 db.ts 映射）。 */
export interface DailyBar {
  symbol: string;
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  preClose: number | null;
  volume: number | null;
  amount: number | null;
}

/** 按板块 + ST 解析涨停比例；unknown 板块 → null（不可判）。 */
export function limitUpRatio(code: string, st: StStatus): number | null {
  const board = classifyBoard(code);
  switch (board) {
    case "main":
      return st === "ST" || st === "*ST" ? 0.05 : 0.1;
    case "chinext":
    case "star":
      return 0.2;
    case "bse":
      return 0.3;
    default:
      return null;
  }
}

/** 收盘价是否触及涨停（close ≥ 涨停价）；价格缺失 / 比例不可判 → false（保守）。 */
export function isLimitUpClose(close: number | null, preClose: number | null, ratio: number | null): boolean {
  if (ratio === null) return false;
  if (close === null || preClose === null || preClose <= 0) return false;
  return close >= limitUpPrice(preClose, ratio);
}

/** 由 (symbol, tradeDate) 派生确定性事件 id（唯一 ≤ 64 字符）。 */
export function computeEventId(symbol: string, tradeDate: string): string {
  return `${symbol}@${tradeDate}`;
}

// ---------------------------------------------------------------------------
// 首板检测（按 symbol 逐日滚动，PIT 安全）
// ---------------------------------------------------------------------------

/** 某 symbol 的滚动涨停状态（截至上一交易日）。 */
export interface SymbolLimitState {
  /** 上一交易日是否涨停（首板 vs 连板判定）。 */
  prevTradingDayLimitUp: boolean;
  /** 上一个涨停交易日（不含今日）；null = 窗口内尚无涨停。 */
  previousLimitDate: string | null;
  /** 历史涨停次数（截至上一交易日，不含今日）。 */
  historicalLimitCount: number;
}

export const INITIAL_SYMBOL_LIMIT_STATE: SymbolLimitState = {
  prevTradingDayLimitUp: false,
  previousLimitDate: null,
  historicalLimitCount: 0,
};

/** 把今日涨停事实合并进滚动状态（纯函数，返回新状态）。 */
export function advanceSymbolLimitState(
  state: SymbolLimitState,
  tradeDate: string,
  isLimitUp: boolean,
): SymbolLimitState {
  return {
    prevTradingDayLimitUp: isLimitUp,
    previousLimitDate: isLimitUp ? tradeDate : state.previousLimitDate,
    historicalLimitCount: state.historicalLimitCount + (isLimitUp ? 1 : 0),
  };
}

/** 单日首板判定结果。 */
export interface DayLimitClassification {
  isFirstLimit: boolean;
  previousLimitDate: string | null;
  daysSincePreviousLimit: number | null;
  /** 截至上一交易日的历史涨停次数（不含今日）。 */
  historicalLimitCount: number;
}

/**
 * 判定某交易日是否为首板（以及历史涨停元数据）。
 * @param state 截至上一交易日的滚动状态。
 * @param tradeDate 今日（交易日）。
 * @param isLimitUp 今日是否涨停。
 * @param tradingDayIndex tradeDate → 交易日序号的索引（用于 daysSincePreviousLimit）。
 */
export function classifyLimitDay(
  state: SymbolLimitState,
  tradeDate: string,
  isLimitUp: boolean,
  tradingDayIndex: ReadonlyMap<string, number>,
): DayLimitClassification {
  const isFirstLimit = isLimitUp && !state.prevTradingDayLimitUp;
  let daysSincePreviousLimit: number | null = null;
  if (state.previousLimitDate !== null) {
    const todayIdx = tradingDayIndex.get(tradeDate);
    const prevIdx = tradingDayIndex.get(state.previousLimitDate);
    if (todayIdx !== undefined && prevIdx !== undefined) {
      daysSincePreviousLimit = todayIdx - prevIdx;
    }
  }
  return {
    isFirstLimit,
    previousLimitDate: state.previousLimitDate,
    daysSincePreviousLimit,
    historicalLimitCount: state.historicalLimitCount,
  };
}

/** 板块类别字符串（用于事件行 boardType 落库）。 */
export function boardTypeOf(code: string): string {
  return classifyBoard(code);
}
