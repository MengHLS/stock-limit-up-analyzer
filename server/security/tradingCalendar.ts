/**
 * STEP 11 / Work C + Work E — 统一交易日历（Trading Calendar）唯一事实来源。
 *
 * 全系统「下一个交易日 / 上一个交易日 / T+1 / 交易日区间 / 滚动窗口推进」的唯一权威实现。
 * 禁止用 calendar date + 1（自然日算术）近似交易日——周五的 T+1 是「下周一」，不是「周六」。
 *
 * 数据来源互操作（本文件不负责「日历数据从哪来」，只负责「给定日历如何查询」）：
 *   - STEP 7.3 backfill：`buildTradingCalendar(extractTradingDates(calendarDays))`。
 *   - 生产运行时：`loadTradingCalendar(startDate, endDate)` 复用 server/tushare.ts 的
 *     `fetchTushareTradingDates`（已有缓存 + 并发去重），不另建第二套 fetch。
 *
 * 交易所语义（Work E 明确）：
 *   - SSE（上交所）与 SZSE（深交所）A 股休市日历在实践中一致 → 默认合并为一张 A 股日历。
 *   - BSE（北交所）不被 Tushare trade_cal 直接覆盖，按 SSE/SZSE 日历近似（与 STEP 7.3 约定一致）。
 *   - 若将来 SH/SZ/BJ 出现日历差异，调用方必须按 exchange 分别构造 TradingCalendar 并显式选择，
 *     禁止在 A 股统一逻辑里隐式混用。
 *
 * 自然日 vs 交易日（铁律，Work E）：
 *   - 自然日加减：仅用于区间长度/公告发布时间等非交易语义，工具见 ./dates.ts 的 addDays。
 *   - 交易日推进（T+1 结算/可卖/次一开盘/滚动窗口）：必须用本文件。
 *
 * 确定性：纯函数、无 Date.now / Math.random / IO；相同输入恒相同输出。
 */

import { compareDate } from "./dates";

/**
 * 交易所（交易日历口径，区别于 ./types.ts 的代码段口径 Exchange = SH/SZ/BJ）。
 * BSE 不被 trade_cal 直接覆盖，A 股统一日历按 SSE/SZSE 近似。
 */
export type TradingExchange = "SSE" | "SZSE" | "BSE";

/**
 * 交易日历查询契约（只读）。
 * tradingDays 为升序、去重、闭区间内的开市日（YYYY-MM-DD）。
 */
export interface TradingCalendar {
  /** 日历标识（可追溯来源）。 */
  readonly name: string;
  /** 覆盖的交易所（缺省视为 SSE+SZSE 合并 A 股日历）。 */
  readonly exchange: readonly TradingExchange[];
  /** 开市日（升序、去重）。 */
  readonly tradingDays: readonly string[];
  /** date 是否为开市日。 */
  isTradingDay(date: string): boolean;
  /** 严格晚于 date 的第一个交易日；无则 null（date 非交易日时按其后最近交易日定位）。 */
  nextTradingDay(date: string): string | null;
  /** 严格早于 date 的最后一个交易日；无则 null（date 非交易日时按其前最近交易日定位）。 */
  previousTradingDay(date: string): string | null;
  /**
   * date 向后（n>0）/向前（n<0）偏移 n 个交易日；n=0 且 date 为交易日时返回 date 本身。
   * date 必须为交易日（不在日历内返回 null）；偏移越界返回 null。
   * 这是「T+n / 观察窗口 / 滚动窗口」的统一入口，杜绝自然日 × n 近似。
   */
  addTradingDays(date: string, n: number): string | null;
  /** [from, to]（闭区间，两端点含）内的交易日，升序；无交易日返回空数组。 */
  tradingDaysBetween(from: string, to: string): string[];
  /** [from, to]（闭区间）内的交易日数量。 */
  tradingDayCount(from: string, to: string): number;
  /** date 当日或之后最近的交易日（date 为交易日则返回自身）；无则 null。 */
  firstTradingDayOnOrAfter(date: string): string | null;
  /** date 当日或之前最近的交易日（date 为交易日则返回自身）；无则 null。 */
  lastTradingDayOnOrBefore(date: string): string | null;
}

/** 二分查找：返回第一个 >= target 的下标；无则返回数组长度。 */
function lowerBound(sorted: readonly string[], target: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareDate(sorted[mid]!, target) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 由升序交易日列表构造 TradingCalendar。
 * 内部会去重并排序（容忍乱序/重复输入），保证查询确定性。
 * @param name 日历标识；缺省 "trading-calendar"。
 */
export function buildTradingCalendar(
  dates: readonly string[],
  name = "trading-calendar",
  exchange: readonly TradingExchange[] = ["SSE", "SZSE"],
): TradingCalendar {
  const tradingDays = Array.from(new Set(dates)).sort(compareDate);
  const index = new Map<string, number>(tradingDays.map((d, i) => [d, i]));

  return {
    name,
    exchange,
    tradingDays,
    isTradingDay(date: string): boolean {
      const idx = lowerBound(tradingDays, date);
      return idx < tradingDays.length && tradingDays[idx] === date;
    },
    nextTradingDay(date: string): string | null {
      const idx = lowerBound(tradingDays, date);
      // lowerBound 返回第一个 >= date 的下标；若恰好等于 date 则取下一个（严格晚于）。
      const nextIdx = idx < tradingDays.length && tradingDays[idx] === date ? idx + 1 : idx;
      return nextIdx < tradingDays.length ? tradingDays[nextIdx]! : null;
    },
    previousTradingDay(date: string): string | null {
      const idx = lowerBound(tradingDays, date);
      // 第一个 >= date 的前一个元素（严格早于）。
      return idx > 0 ? tradingDays[idx - 1]! : null;
    },
    addTradingDays(date: string, n: number): string | null {
      if (!Number.isInteger(n)) throw new Error(`addTradingDays 偏移量必须为整数：${n}`);
      const pos = index.get(date);
      if (pos === undefined) return null; // 非交易日：T+n 语义无定义
      const target = pos + n;
      if (target < 0 || target >= tradingDays.length) return null;
      return tradingDays[target]!;
    },
    tradingDaysBetween(from: string, to: string): string[] {
      if (compareDate(to, from) < 0) return [];
      return tradingDays.filter((d) => d >= from && d <= to);
    },
    tradingDayCount(from: string, to: string): number {
      if (compareDate(to, from) < 0) return 0;
      const lo = lowerBound(tradingDays, from);
      const hi = lowerBound(tradingDays, to);
      const last = hi < tradingDays.length && tradingDays[hi] === to ? hi : hi - 1;
      return last >= lo ? last - lo + 1 : 0;
    },
    firstTradingDayOnOrAfter(date: string): string | null {
      const idx = lowerBound(tradingDays, date);
      return idx < tradingDays.length ? tradingDays[idx]! : null;
    },
    lastTradingDayOnOrBefore(date: string): string | null {
      const idx = lowerBound(tradingDays, date);
      const last = idx < tradingDays.length && tradingDays[idx] === date ? idx : idx - 1;
      return last >= 0 ? tradingDays[last]! : null;
    },
  };
}

/** 便捷：在升序交易日数组中判定是否为交易日（纯函数，不构造对象）。 */
export function isTradingDayIn(dates: readonly string[], date: string): boolean {
  return buildTradingCalendar(dates).isTradingDay(date);
}

/** 构造 date → 下一交易日 的邻接映射（供事件驱动引擎把「T 收盘信号」映射到「T+1 成交日」）。 */
export function buildNextTradingDayMap(dates: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < dates.length - 1; i += 1) map.set(dates[i]!, dates[i + 1]!);
  return map;
}

/** 构造 date → 上一交易日 的邻接映射。 */
export function buildPreviousTradingDayMap(dates: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 1; i < dates.length; i += 1) map.set(dates[i]!, dates[i - 1]!);
  return map;
}

// ---------------------------------------------------------------------------
// Loader：复用现有 Tushare 交易日历拉取（唯一数据源），不另建第二套 fetch。
// ---------------------------------------------------------------------------

type FetchTradingDates = (startDate: string, endDate: string) => Promise<string[]>;

/**
 * 加载 [startDate, endDate] 内的 A 股交易日历，构造 TradingCalendar。
 * 默认复用 server/tushare.ts 的 `fetchTushareTradingDates`（生产已用、带缓存 + 并发去重）。
 * 测试可注入自定义 fetcher，避免网络依赖。
 */
export async function loadTradingCalendar(
  startDate: string,
  endDate: string,
  options: { name?: string; exchange?: readonly TradingExchange[]; fetchDates?: FetchTradingDates } = {},
): Promise<TradingCalendar> {
  // 延迟 import，避免纯计算场景被迫加载 tushare 模块的顶层副作用。
  const { fetchTushareTradingDates } = await import("../tushare");
  const fetchDates = options.fetchDates ?? fetchTushareTradingDates;
  const dates = await fetchDates(startDate, endDate);
  return buildTradingCalendar(dates, options.name ?? "trading-calendar", options.exchange ?? ["SSE", "SZSE"]);
}
