/**
 * STOCK-SELECTION-002 —— `live` 载体：从**当日原始行情**读候选事件窗（日常选股口径）。
 *
 * 🔴 **不依赖任何数据集版本**：交易日历来自行情表自身的交易日、首板判定复用
 * `datasetRegistry/detection#isLimitUpClose` + 同一个 PIT ST 比例、事件行由
 * `datasetRegistry/builder#assembleEventRow`（与构建链**同一实现**）装配。
 *
 * ## 首板规则（与 `datasetRegistry/builder.ts` 逐字同源）
 *   `isFirstLimit = 当日涨停 && 上一交易日未涨停`
 *   （builder 内为 `anchorIsLimitUp && !anchorPrevIsLimitUp`）。
 *
 * ## PIT 边界
 *   每一步只用 `<= 决策日` 的信息：先定 T0 = 决策日往前 N 个交易日，再读 T0..T0+N+1 的行情；
 *   读不到的行**不补**（停牌 = 无行 ⇒ 观察窗不完整 ⇒ 该候选被如实剔除，与数据集口径一致）。
 *
 * ## 诚实边界（不编数据）
 *   - 富集字段（换手率 / 市值 / 板块 / 关键词）live 载体**不读** ⇒ 如实 `null`；
 *   - 历史涨停次数 / 距上次涨停 live 载体**不计算** ⇒ 传 `null` / `0` 占位，并在此声明
 *     —— 3F 选股口径**不读**这两个字段（只读 rd0..5 的行情 + 回踩/振幅）。
 */

import { addDays } from "../../security/dates";
import { assembleEventRow } from "../../datasetRegistry/builder";
import { classifyBoard } from "../../data/boardRules";
import { computeEventId, isLimitUpClose, limitUpRatio, type DailyBar, type StStatus } from "../../datasetRegistry/detection";
import { StockSelectionError } from "../types";
import type {
  SelectionBarRow,
  SelectionDataSource,
  SelectionDataSourceRequest,
  SelectionDataSourceResult,
  SelectionEventRow,
} from "../dataSource";
import type { CanonicalMarketBar } from "../../data/types";

/** live 载体的行情读取口（生产实现 = `DbBarStore`）。 */
export interface LiveSelectionBarReader {
  /** 交易日序列（升序；`[startDate, endDate]` 闭区间）。 */
  tradingDates(startDate: string, endDate: string): Promise<readonly string[]>;
  barsForDate(date: string): Promise<readonly CanonicalMarketBar[]>;
  barsForSecuritiesDateRange(
    securityIds: readonly string[],
    startDate: string,
    endDate: string,
  ): Promise<readonly CanonicalMarketBar[]>;
}

/** PIT ST 解析口（生产实现 = `DbDatasetBuildIO#resolveSt`，与构建链同一实现）。 */
export interface LiveSelectionReferenceData {
  resolveSt(symbol: string, tradeDate: string): Promise<StStatus>;
}

export interface LiveSelectionDataSourceOptions {
  readonly bars: LiveSelectionBarReader;
  readonly referenceData: LiveSelectionReferenceData;
  readonly label?: string;
  /** 首板候选数护栏（缺省 2000）；超出即响亮失败，不静默截断。 */
  readonly maxCandidates?: number;
  /** 日历回退自然日数（缺省 45）；只为取回 N+2 个交易日。 */
  readonly lookbackCalendarDays?: number;
}

const DEFAULT_MAX_CANDIDATES = 2000;
const DEFAULT_LOOKBACK_CALENDAR_DAYS = 45;

function toDailyBar(bar: CanonicalMarketBar): DailyBar {
  return {
    symbol: bar.symbol,
    tradeDate: bar.timestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    preClose: bar.preClose,
    volume: bar.volume,
    amount: bar.amount,
  } as DailyBar;
}

function toSelectionBarRow(
  bar: CanonicalMarketBar,
  relativeDay: number,
): SelectionBarRow {
  return {
    datasetVersionId: null,
    eventId: computeEventId(bar.symbol, ""),
    symbol: bar.symbol,
    tradeDate: bar.timestamp,
    relativeDay,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    preClose: bar.preClose,
    volume: bar.volume,
    amount: bar.amount,
    barPresent: true,
    suspensionStatus: "NOT_SUSPENDED",
  };
}

export function createLiveSelectionDataSource(options: LiveSelectionDataSourceOptions): SelectionDataSource {
  const label = options.label ?? "当日行情（live）";
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const lookbackCalendarDays = options.lookbackCalendarDays ?? DEFAULT_LOOKBACK_CALENDAR_DAYS;
  const empty = (calendarDays: readonly string[]): SelectionDataSourceResult => ({
    kind: "live", label, calendarDays, events: [], zeroBars: [], postBars: [],
  });

  /** 某日某 bar 是否收盘涨停（同一 `isLimitUpClose` + 同一 PIT ST 口径）。 */
  async function limitUpAt(bar: CanonicalMarketBar, tradeDate: string): Promise<{ limitUp: boolean; st: StStatus; ratio: number | null }> {
    const st = await options.referenceData.resolveSt(bar.symbol, tradeDate);
    const ratio = limitUpRatio(bar.symbol, st, tradeDate);
    return { limitUp: isLimitUpClose(bar.close, bar.preClose, ratio), st, ratio };
  }

  return {
    kind: "live",
    label,
    async load(request: SelectionDataSourceRequest): Promise<SelectionDataSourceResult> {
      const decisionDate = request.decisionDate;
      const n = request.decisionRelativeDay;

      // 🔴 日历（含决策日之后的短期日期）是**已知信息**，可以读；但**行情只读 <= 决策日**
      //    —— 执行日 T0+(n+1) 是决策日的下一交易日，其 bar 在决策时不存在（读它就是未来函数）。
      const dates = [...(await options.bars.tradingDates(addDays(decisionDate, -lookbackCalendarDays), addDays(decisionDate, 10)))].sort();
      const decisionIndex = dates.indexOf(decisionDate);
      if (decisionIndex < 0) {
        throw new StockSelectionError(
          "SELECTION_CALENDAR_INCONSISTENT",
          `决策日 ${decisionDate} 不在交易日历内（窗口 [${addDays(decisionDate, -lookbackCalendarDays)}, ${addDays(decisionDate, 10)}] 无此交易日）⇒ 拒绝在非交易日选股。`,
        );
      }
      if (decisionIndex < n + 1) return empty([]); // 事件日之前交易日不足（含 T0 的前一交易日）
      const t0Index = decisionIndex - n;
      /** 只读行情的天数：rd0..rd n（T0..决策日）。 */
      const windowDays = dates.slice(t0Index, decisionIndex + 1);
      /** 窗口引用的交易日（含执行日，仅用于给出计划买入日，不读其 bar）。 */
      const calendarDays = dates.slice(t0Index, decisionIndex + 2);
      const previousTradingDay = dates[t0Index - 1];
      if (previousTradingDay === undefined) return empty(calendarDays);

      // ① T0 涨停事实（全市场当日 bar）。
      // 候选宇宙（策略口径）：板块白名单 + PIT ST 排除；ST 复用同一次解析结果，不重复判定。
      const allowedBoards = new Set(request.universe.boards);
      const inUniverse = (symbol: string, st: StStatus): boolean => {
        if (allowedBoards.size > 0 && !allowedBoards.has(classifyBoard(symbol))) return false;
        if (request.universe.excludeSt && (st === "ST" || st === "*ST")) return false;
        return true;
      };

      const t0Bars = await options.bars.barsForDate(windowDays[0]!);
      const limitUpOnT0: Array<{ bar: CanonicalMarketBar; st: StStatus; ratio: number | null }> = [];
      for (const bar of t0Bars) {
        const classified = await limitUpAt(bar, windowDays[0]!);
        if (!classified.limitUp) continue;
        if (!inUniverse(bar.symbol, classified.st)) continue;
        limitUpOnT0.push({ bar, st: classified.st, ratio: classified.ratio });
      }
      if (limitUpOnT0.length === 0) return empty(calendarDays);

      // ② 上一交易日涨停事实（只查 ① 的候选，避免全市场回看）。
      const candidateCodes = limitUpOnT0.map((item) => item.bar.symbol);
      const previousBars = await options.bars.barsForSecuritiesDateRange(candidateCodes, previousTradingDay, previousTradingDay);
      const limitUpOnPreviousDay = new Set<string>();
      for (const bar of previousBars) {
        if ((await limitUpAt(bar, previousTradingDay)).limitUp) limitUpOnPreviousDay.add(bar.symbol);
      }

      // ③ 首板 = 当日涨停 && 上一交易日未涨停（与 builder 同一规则）。
      const firstBoard = limitUpOnT0.filter((item) => !limitUpOnPreviousDay.has(item.bar.symbol));
      if (firstBoard.length === 0) return empty(calendarDays);
      if (firstBoard.length > maxCandidates) {
        throw new StockSelectionError(
          "SELECTION_PAGE_LIMIT_EXCEEDED",
          `首板候选 ${firstBoard.length} 只超过 ${maxCandidates} 只护栏；拒绝在可能截断的数据上选股。`,
        );
      }

      // ④ 窗口行（rd0..rd(n+1)）。
      const windowBars = await options.bars.barsForSecuritiesDateRange(
        firstBoard.map((item) => item.bar.symbol),
        windowDays[0]!,
        windowDays[windowDays.length - 1]!,
      );
      const relativeDayOfDate = new Map(windowDays.map((day, index) => [day, index]));
      const wantedDays = new Set(request.relativeDays);
      const zeroBars: SelectionBarRow[] = [];
      const postBars: SelectionBarRow[] = [];
      const eventIdsBySymbol = new Map<string, string>();
      for (const item of firstBoard) {
        eventIdsBySymbol.set(item.bar.symbol, computeEventId(item.bar.symbol, item.bar.timestamp));
      }
      for (const bar of windowBars) {
        const relativeDay = relativeDayOfDate.get(bar.timestamp);
        if (relativeDay === undefined || !wantedDays.has(relativeDay)) continue;
        const row = toSelectionBarRow(bar, relativeDay);
        row.eventId = eventIdsBySymbol.get(bar.symbol) ?? row.eventId;
        if (relativeDay === 0) zeroBars.push(row);
        else postBars.push(row);
      }

      // ⑤ 事件行：复用构建链的装配（同一 boardType / 涨跌停价口径）。
      const events: SelectionEventRow[] = [];
      for (const item of firstBoard) {
        const assembled = assembleEventRow(
          0, // 占位：live 载体无数据集坐标（下方显式改 null，绝不入库、绝不当坐标）
          toDailyBar(item.bar),
          item.st,
          item.ratio,
          true,
          null, // 历史涨停间隔 / 次数：live 不计算（3F 选股口径不读）⇒ 如实 null / 0
          null,
          0,
          null,
          null,
          null,
        );
        events.push({ ...assembled, datasetVersionId: null });
      }

      return { kind: "live", label, calendarDays, events, zeroBars, postBars };
    },
  };
}
