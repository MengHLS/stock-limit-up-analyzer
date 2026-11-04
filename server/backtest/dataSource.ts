/**
 * STEP 8 — Data Layer：Canonical Market Data Interface（规范数据接口）。
 *
 * 引擎**不得**直接调用 Tushare / BaoStock / Sina / DB 行。引擎只消费本层定义的
 * `HistoricalBarStore`（异步、按日取数、逐标的取历史），数据以 CanonicalMarketBar 表达。
 *
 * 内存安全（Memory Safety）铁律：
 *   - 引擎绝不把 9M bars 一次性装入单个巨型 JS object（禁止 Map<date, Map<symbol, bar>>）；
 *   - 引擎按「日期推进」消费：每个交易日仅通过 `barsForDate(date)` 拉取当日 bar（一个 chunk），
 *     处理完即丢弃；`seriesFor(securityId)` 仅按需、逐标的加载历史（内存上界 = universe 大小 ×
 *     单标的序列长度，而非全市场 × 全历史）。
 *   - 未来函数防护：策略阶段的数据视图经 asOf 过滤，只暴露 <= decisionDate 的 bar。
 */

import { visibleBars, type DecisionPoint } from "../data/series";
import type { CanonicalMarketBar } from "../data/types";
import type { CorporateActionMode, Security, SignalDataView } from "./types";

/**
 * 规范历史行情存储接口（Engine 的唯一数据边界）。
 *
 * 实现方可以是内存 fixture、DB 查询、Tushare 适配器等；引擎对实现一无所知。
 */
export interface HistoricalBarStore {
  /** Corporate Action 处理口径（RAW / ADJUSTED / CORPORATE_ACTION_UNAVAILABLE）。 */
  readonly corporateActionMode: CorporateActionMode;

  /** 全市场证券列表（潜在 universe 来源）。 */
  securities(): Promise<readonly Security[]>;

  /** [startDate, endDate] 内的交易日历（升序）。 */
  tradingDates(startDate: string, endDate: string): Promise<readonly string[]>;

  /** 单个交易日的全部 bar（一个 chunk；升序）。 */
  barsForDate(date: string): Promise<readonly CanonicalMarketBar[]>;

  /** 单只证券的完整有序序列（用于策略 lookback；按需加载）。 */
  seriesFor(securityId: string): Promise<readonly CanonicalMarketBar[]>;
}

/** 按 symbol 升序组织后的单日 bar 索引（供引擎执行阶段瞬态查询）。 */
export function indexBarsBySymbol(bars: readonly CanonicalMarketBar[]): Map<string, CanonicalMarketBar> {
  const index = new Map<string, CanonicalMarketBar>();
  for (const bar of bars) index.set(bar.symbol, bar);
  return index;
}

/**
 * 构造信号阶段数据视图：只暴露 <= decisionDate 的可见 bar（asOf 过滤，防未来函数）。
 * 决策点固定为 "close"（日收盘后决策，当日整根 bar 可见）。
 */
export function createSignalDataView(
  decisionDate: string,
  universe: readonly Security[],
  historyBySymbol: ReadonlyMap<string, readonly CanonicalMarketBar[]>,
  decisionPoint: DecisionPoint = "close",
): SignalDataView {
  return {
    decisionDate,
    universe,
    bars(securityId: string): readonly CanonicalMarketBar[] | undefined {
      const series = historyBySymbol.get(securityId);
      if (!series) return undefined;
      return visibleBars(series, decisionDate, decisionPoint);
    },
  };
}

/**
 * 内存实现（测试 fixture / 小数据集）。全部数据驻留内存是「存储层」的选择，
 * 不代表引擎强制全量驻留；生产应接 DB/Tushare 适配器实现逐日/逐标的流式加载。
 */
export class InMemoryBarStore implements HistoricalBarStore {
  readonly corporateActionMode: CorporateActionMode;

  private readonly bySymbol = new Map<string, CanonicalMarketBar[]>();
  private readonly byDate = new Map<string, CanonicalMarketBar[]>();
  private readonly sortedDates: string[];
  private readonly securitiesList: Security[];

  constructor(options: {
    bars: readonly CanonicalMarketBar[];
    corporateActionMode?: CorporateActionMode;
    securities?: readonly Security[];
  }) {
    this.corporateActionMode = options.corporateActionMode ?? "RAW";

    const symbolSet = new Map<string, CanonicalMarketBar[]>();
    const dateSet = new Map<string, CanonicalMarketBar[]>();
    for (const bar of options.bars) {
      const series = symbolSet.get(bar.symbol) ?? [];
      series.push(bar);
      symbolSet.set(bar.symbol, series);

      const day = dateSet.get(bar.timestamp) ?? [];
      day.push(bar);
      dateSet.set(bar.timestamp, day);
    }

    for (const [symbol, series] of Array.from(symbolSet.entries())) {
      series.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      this.bySymbol.set(symbol, series);
    }
    for (const [date, day] of Array.from(dateSet.entries())) {
      day.sort((a, b) => a.symbol.localeCompare(b.symbol));
      this.byDate.set(date, day);
    }
    this.sortedDates = Array.from(dateSet.keys()).sort();

    if (options.securities && options.securities.length > 0) {
      this.securitiesList = [...options.securities];
    } else {
      this.securitiesList = Array.from(symbolSet.keys()).map((securityId) => ({ securityId }));
    }
  }

  async securities(): Promise<readonly Security[]> {
    return this.securitiesList;
  }

  async tradingDates(startDate: string, endDate: string): Promise<readonly string[]> {
    return this.sortedDates.filter((date) => date >= startDate && date <= endDate);
  }

  async barsForDate(date: string): Promise<readonly CanonicalMarketBar[]> {
    return this.byDate.get(date) ?? [];
  }

  async seriesFor(securityId: string): Promise<readonly CanonicalMarketBar[]> {
    return this.bySymbol.get(securityId) ?? [];
  }
}
