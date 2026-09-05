/**
 * STEP 7.4 — Security Identity Layer 统一出口。
 */

export * from "./types";
export * from "./dates";
export * from "./code";
export * from "./securityId";
export * from "./identifierHistory";
export * from "./universe";
export * from "./historicalUniverse";
export * from "./provider";
export * from "./master";

// tradingCalendar 导出「交易日历口径」的 Exchange（"SSE"|"SZSE"|"BSE"），
// 与 ./types 的 Exchange（"SH"|"SZ"|"BJ"）同名不同义，若走 export * 会产生歧义。
// 因此这里显式导出稳定符号，且不重导出日历口径的 Exchange（它属数据源内部细节）。
export {
  buildTradingCalendar,
  buildNextTradingDayMap,
  buildPreviousTradingDayMap,
  isTradingDayIn,
  loadTradingCalendar,
} from "./tradingCalendar";
export type { TradingCalendar } from "./tradingCalendar";
