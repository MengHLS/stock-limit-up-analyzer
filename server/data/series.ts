/**
 * STEP 5 — 统一时间序列访问（Time-aware Historical Data Access）+ As-Of / Availability。
 *
 * 目标：
 *   1. Feature 不允许直接 bars.slice / bars.filter / bars.sort 后自行判断时间范围；
 *      统一经 MarketBarSeries 访问。
 *   2. 时间可用性（asOf / decisionTime / availableAt）显式化：任何「历史窗口」只能包含
 *      <= 决策时点已可获得的数据，绝不允许把未来 bar 掺入窗口。
 *
 * 决策时点语义：
 *   - "close"（日收盘后决策）：decisionDate 的整根 bar 可见（收盘价/成交额此时已产生）。
 *   - "open"（开盘时决策）：decisionDate 的完整日线不可见；只可见 open 与 preClose
 *     （当日 high/low/close/volume/amount 尚未产生）。任何以 "open" 为决策点的窗口
 *     禁止包含当日 high/low/close/volume/amount。
 */

import type { CanonicalMarketBar } from "./types";

/** 决策时点类型。 */
export type DecisionPoint = "close" | "open";

/**
 * 计算在 decisionDate 的 point 时点「可见」的 bars（升序），不修改入参。
 *   - "close"：可见 timestamp <= decisionDate 的整根 bar（收盘后，当日 full bar 已产生）。
 *   - "open" ：可见 timestamp < decisionDate 的整根 bar；decisionDate 当日的高/低/收/量/额
 *              尚未产生，整根 bar 一并排除（若只暴露当日 open/preClose 会阻塞以 close 为
 *              序列末尾的 feature；"开盘决策用昨日收盘序列"是唯一无歧义语义）。
 * 未来 bar（timestamp > decisionDate）一律不可见。
 */
export function visibleBars(bars: readonly CanonicalMarketBar[], decisionDate: string, point: DecisionPoint): CanonicalMarketBar[] {
  const visible: CanonicalMarketBar[] = [];
  for (const bar of bars) {
    if (point === "close") {
      if (bar.timestamp <= decisionDate) visible.push(bar);
    } else if (bar.timestamp < decisionDate) {
      visible.push(bar);
    }
  }
  return visible;
}

/** 升序时间序列（单 symbol）。 */
export class MarketBarSeries {
  readonly symbol: string;
  private readonly bars: readonly CanonicalMarketBar[];
  private readonly indexByDate: ReadonlyMap<string, number>;

  /**
   * @param bars 无序输入可接受（内部按 timestamp 升序稳定排序）；同一天重复 bar 视为数据错误，抛错。
   */
  constructor(symbol: string, bars: readonly CanonicalMarketBar[]) {
    this.symbol = symbol;
    const sorted = bars.slice().sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const indexByDate = new Map<string, number>();
    sorted.forEach((bar, index) => {
      if (indexByDate.has(bar.timestamp)) {
        throw new Error(`MarketBarSeries：${symbol} 在 ${bar.timestamp} 存在重复 bar，数据质量错误`);
      }
      indexByDate.set(bar.timestamp, index);
    });
    this.bars = sorted;
    this.indexByDate = indexByDate;
  }

  get length(): number {
    return this.bars.length;
  }

  /** 全部可见 bar（升序，只读引用）。 */
  all(): readonly CanonicalMarketBar[] {
    return this.bars;
  }

  /** 距末尾 offset 的 bar：current()=最新，previous(1)=前 1 根。越界返回 null。 */
  at(offsetFromLatest: number): CanonicalMarketBar | null {
    const index = this.bars.length - 1 - offsetFromLatest;
    return index >= 0 ? (this.bars[index] ?? null) : null;
  }

  /** current()：最新一根 bar。 */
  current(): CanonicalMarketBar | null {
    return this.bars.length > 0 ? (this.bars[this.bars.length - 1] ?? null) : null;
  }

  /** previous(n)：最新往前第 n 根（n>=1）。无则 null。 */
  previous(n: number): CanonicalMarketBar | null {
    if (n < 1) throw new Error(`previous(n) 要求 n >= 1，实际 ${n}`);
    return this.at(n);
  }

  /** 最近 count 根 bar（含最新），不足 count 时返回实际数量（升序）。 */
  window(count: number): CanonicalMarketBar[] {
    if (count <= 0) return [];
    return this.bars.slice(Math.max(0, this.bars.length - count));
  }

  /** 是否存在指定交易日。 */
  has(date: string): boolean {
    return this.indexByDate.has(date);
  }

  /** 按日期取 bar；无则 null。 */
  getByDate(date: string): CanonicalMarketBar | null {
    const index = this.indexByDate.get(date);
    return index === undefined ? null : (this.bars[index] ?? null);
  }

  /** 首个交易日。 */
  firstDate(): string | null {
    return this.bars.length > 0 ? (this.bars[0]!.timestamp) : null;
  }

  /** 末个交易日。 */
  lastDate(): string | null {
    return this.bars.length > 0 ? (this.bars[this.bars.length - 1]!.timestamp) : null;
  }
}
