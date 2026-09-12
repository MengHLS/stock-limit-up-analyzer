/**
 * STEP DATASET-001 — 首板事件检测（纯函数，无 IO，确定性）。
 *
 * 复用 STEP 5 涨跌停权威 `server/data/boardRules`（classifyBoard + exchangeLimitUpPrice），
 * 不重复实现「+10%」近似。涨停比例按板块 + PIT ST 维度：
 *   主板 10%（ST/*ST 5%）、创业板/科创板 20%、北交所 30%、unknown 板块不可判。
 *
 * 首板定义（与 researchDataset/tDayFilter 口径一致）：T 日涨停 且 T-1（上一交易日）未涨停；
 * T-1 无数据 / 窗口首日视作「非连板」→ 弱化为首板。
 *
 * 反泄漏：首板判定只依赖 T 日 close/preClose + 截至 T 日的滚动状态，绝不触碰未来。
 */

import { classifyBoard, exchangeLimitUpPrice } from "../data/boardRules";

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

/** 收盘价是否触及涨停（close ≥ 交易所口径涨停价）；价格缺失 / 比例不可判 → false（保守）。 */
export function isLimitUpClose(close: number | null, preClose: number | null, ratio: number | null): boolean {
  if (ratio === null) return false;
  if (close === null || preClose === null || preClose <= 0) return false;
  // 阈值必须取「四舍五入到分」的交易所口径涨停价：真实封板收盘价恰等于该值，
  // 用未四舍五入的浮点乘积作阈值会系统性漏判（实测漏判率 38%，详见 boardRules.exchangeLimitUpPrice）。
  // 容差 1e-9 仅用于抵御「两位小数 double 表示」的比较误差，不放松任何业务口径。
  return close >= exchangeLimitUpPrice(preClose, ratio) - 1e-9;
}

/** 由 (symbol, tradeDate) 派生确定性事件 id（唯一 ≤ 64 字符）。 */
export function computeEventId(symbol: string, tradeDate: string): string {
  return `${symbol}@${tradeDate}`;
}

// ---------------------------------------------------------------------------
// 涨停候选「SQL 粗筛」下推（性能：把 8.9M 行大表的取数从「全市场」收敛到「接近涨停」）
// ---------------------------------------------------------------------------
//
// 动机（实测）：全市场逐日拉取 stock_daily_prices 时，一次 61 天区间要传 21.9 万行（16.9s），
// 而其中真正可能封板的只有约 8% —— 其余 92% 是纯浪费的跨境流量与解析开销。
//
// 语义约束（**必须**是 isLimitUpClose 的超集，否则静默漏判）：
//   `isLimitUpClose(close, preClose, ratio)` 要求 `close ≥ exchangeLimitUpPrice(preClose, ratio)`
//   即 `close ≥ Math.round(preClose × (1+ratio) × 100) / 100`，ratio ∈ {0.05, 0.10, 0.20, 0.30}。
//   最低比例是 0.05（ST/*ST 主板），因此只需保证
//     `close ≥ Math.round(preClose × 1.05 × 100) / 100` 的行全部被保留 即可。
//
// 为什么阈值取 1.045（而非 1.05）：直接下推 `close ≥ preClose × 1.05` 会因**四舍五入到分**
// 而漏判（如 preClose=0.29 的涨停价恰为 0.30 = ×1.0345）。枚举 2 位小数昨收（k = preClose×100）：
//   - k ≥ 100（昨收 ≥ 1.00 元）：`Math.round(k×1.05)/k` 的最小值 = **1.0458716**（k=109），
//     故 `close ≥ preClose × 1.045` 是严格超集（余量 0.083%）；
//   - k < 100（昨收 < 1.00 元，面值退市股）：k=1..9 时涨停价 == 昨收（比值 1.0），
//     任何 > 1.0 的阈值都会漏判 → **低价股整段不做粗筛**（用 `preClose < 1.00 AND close ≥ preClose`）。
//
// 该谓词的正确性由 `scripts/verifyDatasetBuildPerf.mts` 在**真实 DB** 上做「全市场逐 bar 精确判定」
// 对照实证（断言：粗筛结果经 isLimitUpClose 判定后与全量判定逐条一致，零漏判）。

/** `stock_daily_prices` 涨停候选 SQL 谓词（列名为该表真实列名）。 */
export const LIMIT_UP_CANDIDATE_SQL_PREDICATE =
  "(`closePrice` >= `preClosePrice` * 1.045 OR (`preClosePrice` < 1.00 AND `closePrice` >= `preClosePrice`))";

/**
 * `LIMIT_UP_CANDIDATE_SQL_PREDICATE` 的 JS 等价实现（同一语义的单一来源，供内存实现与单测复用）。
 * 只保证「是 isLimitUpClose 的超集」，粗筛命中 ≠ 涨停，仍须 `isLimitUpClose` 精确判定。
 */
export function isLimitUpCandidateBar(close: number | null, preClose: number | null): boolean {
  if (close === null || preClose === null) return false;
  if (close >= preClose * 1.045) return true;
  return preClose < 1.0 && close >= preClose;
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
