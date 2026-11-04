import type {
  ExperimentBarRow,
  ExperimentDefinition,
  ExperimentEventRow,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import { resolveThemeWithFallback } from "@shared/fieldAvailability";
import { median } from "@shared/quant-stats";
import {
  COMPUTATION_VERSION,
  MAX_HOLDING_DAYS,
  assembleLeaderCandidateBaselineResult,
  leaderCandidateBaselineSchema,
  type PortfolioMetric,
  type PortfolioTrade,
} from "./result";

const DATASET_CODE = "first_limit_pullback";
const REQUIRED_VERSION_LABEL = "combo-v1";
const POST_DAYS = Array.from(
  { length: MAX_HOLDING_DAYS },
  (_, index) => index + 1
);
const INITIAL_CAPITAL = 100_000;
const MAX_POSITIONS = 5;
const LOT_SIZE = 100;
const COMMISSION_RATE = 0.0003;
const STAMP_DUTY_RATE = 0.0005;
const TRANSFER_FEE_RATE = 0.00001;
const SLIPPAGE_BPS = 10;
const MIN_COMMISSION = 5;
const TIME_EPSILON = 1e-9;

interface SourceEvent {
  eventId: string;
  symbol: string;
  tradeDate: string;
  boardType: string;
  sector: string | null;
  keywords: string | null;
  limitUpTime: string;
  limitUpPrice: number;
  turnoverAmount: number | null;
  circulationValue: number | null;
}

interface ScoredCandidate extends SourceEvent {
  score: number;
  boards: number;
  sector: string;
  sectorCount: number;
  sectorAvailable: boolean;
}

interface Bar {
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  limitDownPrice: number | null;
  canBuyAtOpen: boolean;
}

interface Position {
  signalDate: string;
  entryDate: string;
  entryMarketIndex: number;
  stockCode: string;
  score: number;
  boards: number;
  sector: string;
  shares: number;
  entryPrice: number;
  capitalCost: number;
  previousClose: number | null;
  highestClose: number;
  latestClose: number;
}

function numberValue(
  row: ExperimentEventRow | ExperimentBarRow,
  key: string
): number | null {
  const value = row.values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(
  row: ExperimentEventRow | ExperimentBarRow,
  key: string
): string | null {
  const value = row.values[key];
  return typeof value === "string" ? value : null;
}

function booleanValue(row: ExperimentBarRow, key: string): boolean {
  return row.values[key] === true;
}

function parseSourceEvent(row: ExperimentEventRow): SourceEvent | null {
  const boardType = stringValue(row, "boardType");
  const limitUpTime = stringValue(row, "limitUpTime");
  const sector = stringValue(row, "sector");
  const keywords = stringValue(row, "keywords");
  const limitUpPrice = numberValue(row, "limitUpPrice");
  if (boardType === null || limitUpTime === null || limitUpPrice === null)
    return null;
  return {
    eventId: row.eventId,
    symbol: row.symbol,
    tradeDate: row.tradeDate,
    boardType,
    sector,
    keywords,
    limitUpTime,
    limitUpPrice,
    turnoverAmount: numberValue(row, "sourceTurnoverAmount"),
    circulationValue: numberValue(row, "sourceCirculationValue"),
  };
}

function parseBar(row: ExperimentBarRow): Bar | null {
  const open = numberValue(row, "open");
  const close = numberValue(row, "close");
  if (open === null || close === null || open <= 0 || close <= 0) return null;
  return {
    tradeDate: row.tradeDate,
    open,
    high: numberValue(row, "high"),
    low: numberValue(row, "low"),
    close,
    limitDownPrice: numberValue(row, "limitDownPrice"),
    canBuyAtOpen: booleanValue(row, "canBuyAtOpen"),
  };
}

function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

function marketCapScore(value: number | null): number {
  if (value === null || value <= 0) return 0;
  if (value < 20) return 4;
  if (value < 80) return 12;
  if (value <= 200) return 16;
  if (value <= 500) return 10;
  return 5;
}

function turnoverScore(value: number | null): number {
  if (value === null) return 1;
  if (value >= 20) return 8;
  if (value >= 10) return 6;
  if (value >= 5) return 4;
  if (value >= 2) return 2;
  return 1;
}

function timeScore(value: string): number {
  const minutes = timeToMinutes(value);
  if (minutes === null) return 2;
  if (minutes <= 10 * 60) return 10;
  if (minutes <= 11 * 60 + 30) return 8;
  if (minutes <= 13 * 60 + 30) return 5;
  if (minutes <= 14 * 60 + 30) return 2;
  return 0;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function buildCandidatePools(events: readonly SourceEvent[]): {
  pools: Map<string, ScoredCandidate[]>;
} {
  const dates = [...new Set(events.map(event => event.tradeDate))].sort();
  const symbolDates = new Map<string, Set<string>>();
  for (const event of events) {
    const set = symbolDates.get(event.symbol) ?? new Set<string>();
    set.add(event.tradeDate);
    symbolDates.set(event.symbol, set);
  }
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const byDate = new Map<string, SourceEvent[]>();
  for (const event of events) {
    const list = byDate.get(event.tradeDate) ?? [];
    list.push(event);
    byDate.set(event.tradeDate, list);
  }

  const pools = new Map<string, ScoredCandidate[]>();
  for (const [date, dayEvents] of byDate) {
    const themeByCode = new Map<string, string>();
    const sectorCounts = new Map<string, number>();
    for (const event of dayEvents) {
      const { theme } = resolveThemeWithFallback({
        sector: event.sector,
        keywords: event.keywords,
      });
      if (theme === null) continue;
      themeByCode.set(event.symbol, theme);
      sectorCounts.set(theme, (sectorCounts.get(theme) ?? 0) + 1);
    }
    const neutralSectorCount = median([...sectorCounts.values()]) ?? 1;

    const candidates = dayEvents.map(event => {
      const sectorAvailable = themeByCode.has(event.symbol);
      const sector = sectorAvailable
        ? themeByCode.get(event.symbol)!
        : "题材未采集";
      const sectorCount = sectorAvailable
        ? (sectorCounts.get(sector) ?? 0)
        : neutralSectorCount;
      let boards = 1;
      const index = dateIndex.get(date) ?? 0;
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        const previousDate = dates[previous]!;
        if (!symbolDates.get(event.symbol)?.has(previousDate)) break;
        boards += 1;
      }
      const score = Math.min(
        100,
        Math.min(boards, 6) * 7 +
          Math.min(sectorCount, 6) * 4 +
          timeScore(event.limitUpTime) +
          turnoverScore(event.turnoverAmount) +
          marketCapScore(event.circulationValue)
      );
      return {
        ...event,
        score,
        boards,
        sector,
        sectorCount,
        sectorAvailable,
      };
    });
    const eligible = candidates
      .filter(candidate => candidate.score >= 65)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.boards - left.boards ||
          right.sectorCount - left.sectorCount ||
          left.limitUpTime.localeCompare(right.limitUpTime) ||
          left.symbol.localeCompare(right.symbol)
      );
    pools.set(date, eligible);
  }
  return { pools };
}

export const leaderCandidateBaselineExperiment: ExperimentDefinition = {
  descriptor: {
    id: "combo-backtest/leader-candidate-baseline",
    name: "原组合回测主模式迁移",
    version: COMPUTATION_VERSION,
    description:
      "从 combo-v1 Dataset 读取主板涨停事实，重建原 leader-candidate-baseline 的候选评分、" +
      "T+1 开盘买入、最多 5 仓等权分仓，以及动态止盈、止损、强势续持退出。",
    source: "stock-limit-up-analyzer/combo-backtest",
    tags: [
      "combo-backtest",
      "leader-candidate",
      "portfolio",
      "risk-managed-hold",
    ],
    parameters: [],
    datasetRequirement: {
      datasetCode: DATASET_CODE,
      requiredDatasetVersionLabel: REQUIRED_VERSION_LABEL,
      requiredColumns: {
        events: [
          "boardType",
          "limitUpPrice",
          "limitUpTime",
          "sector",
          "keywords",
          "sourceTurnoverAmount",
          "sourceCirculationValue",
        ],
        observation: [
          "open",
          "high",
          "low",
          "close",
          "limitDownPrice",
          "canBuyAtOpen",
          "canSellAtClose",
        ],
      },
      prefixRelativeDays: [],
      postRelativeDays: POST_DAYS,
      decisionOffsetDays: null,
      usesForwardData: true,
      forwardDataPurpose:
        "T+1 开盘执行买入，持仓不再进入当日候选池后于下一交易日开盘退出。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "combo-backtest/leader-candidate-baseline",
    pageTitle: "组合回测主模式迁移",
  },
  resultSchema: leaderCandidateBaselineSchema,
  run: async (context: ExperimentRunContext) => {
    const eventRows = await context.dataset.events();
    const excludedByReason: Record<string, number> = {};
    const exclude = (reason: string): void => {
      excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
    };

    const sourceEvents: SourceEvent[] = [];
    for (const row of eventRows) {
      const boardType = stringValue(row, "boardType");
      if (boardType !== "main") {
        exclude("NON_MAIN_BOARD");
        continue;
      }
      const parsed = parseSourceEvent(row);
      if (parsed === null) {
        exclude("SOURCE_RECORD_MISSING");
        continue;
      }
      sourceEvents.push(parsed);
    }
    sourceEvents.sort(
      (left, right) =>
        left.tradeDate.localeCompare(right.tradeDate) ||
        left.eventId.localeCompare(right.eventId)
    );
    context.freezeSelection(sourceEvents.map(event => event.eventId));

    const barsByDay = new Map<number, Map<string, Bar>>();
    for (const day of POST_DAYS) {
      const dayBars = new Map<string, Bar>();
      for (const row of await context.dataset.observation(day)) {
        const bar = parseBar(row);
        if (bar === null) continue;
        dayBars.set(row.eventId, bar);
      }
      barsByDay.set(day, dayBars);
    }

    const executableEvents: SourceEvent[] = [];
    for (const event of sourceEvents) {
      const entryBar = barsByDay.get(1)?.get(event.eventId);
      if (!entryBar || !entryBar.canBuyAtOpen) {
        exclude("MISSING_OR_UNFILLABLE_ENTRY_BAR");
        continue;
      }
      executableEvents.push(event);
    }

    const { pools } = buildCandidatePools(sourceEvents);
    const pooledCandidateCount = [...pools.values()].reduce(
      (sum, candidates) => sum + candidates.length,
      0
    );
    const eventById = new Map(
      sourceEvents.map(event => [event.eventId, event])
    );
    const entryDateByEvent = new Map<string, string>();
    for (const event of executableEvents) {
      const entryBar = barsByDay.get(1)?.get(event.eventId);
      if (entryBar) entryDateByEvent.set(event.eventId, entryBar.tradeDate);
    }
    const entriesByDate = new Map<string, SourceEvent[]>();
    for (const event of executableEvents) {
      const entryDate = entryDateByEvent.get(event.eventId);
      if (!entryDate) continue;
      const list = entriesByDate.get(entryDate) ?? [];
      list.push(event);
      entriesByDate.set(entryDate, list);
    }

    const marketDates = [
      ...new Set(
        [...barsByDay.values()].flatMap(day =>
          [...day.values()].map(bar => bar.tradeDate)
        )
      ),
    ].sort();
    const marketDateIndex = new Map(
      marketDates.map((date, index) => [date, index])
    );
    const positions = new Map<string, Position>();
    const trades: PortfolioTrade[] = [];
    const equityCurve: Array<{ date: string; equity: number }> = [];
    let cash = INITIAL_CAPITAL;
    let maxEquity = INITIAL_CAPITAL;
    let maxDrawdown = 0;

    const settle = (
      eventId: string,
      date: string,
      rawPrice: number,
      reason: string
    ): void => {
      const position = positions.get(eventId);
      if (!position) return;
      const slippedExit = rawPrice * (1 - SLIPPAGE_BPS / 10_000);
      const grossExit = slippedExit * position.shares;
      const sellFees = Math.max(
        MIN_COMMISSION,
        grossExit * (COMMISSION_RATE + STAMP_DUTY_RATE + TRANSFER_FEE_RATE)
      );
      const proceeds = grossExit - sellFees;
      const netPnl = proceeds - position.capitalCost;
      cash += proceeds;
      const trade = trades.find(
        item =>
          item.signalDate === position.signalDate &&
          item.stockCode === position.stockCode &&
          item.exitDate === null
      );
      if (trade) {
        trade.exitDate = date;
        trade.exitPrice = round(slippedExit, 3);
        trade.netPnl = round(netPnl);
        trade.netReturn = round((netPnl / position.capitalCost) * 100);
        trade.exitReason = reason;
      }
      positions.delete(eventId);
    };

    for (const date of marketDates) {
      const dateIndex = marketDateIndex.get(date)!;
      for (const [eventId, position] of Array.from(positions.entries())) {
        const holdingDays =
          dateIndex - position.entryMarketIndex + 1;
        if (holdingDays < 2) continue;
        const bar = barsByDay.get(holdingDays)?.get(eventId);
        if (!bar || bar.open === null) continue;
        const openReturnPercent =
          ((bar.open - position.entryPrice) / position.entryPrice) * 100;
        if (openReturnPercent <= -5) {
          settle(
            eventId,
            date,
            bar.open,
            `开盘触发止损（${round(openReturnPercent)}% ≤ -5%）`
          );
        }
      }

      const dateEntries = (entriesByDate.get(date) ?? [])
        .filter(event => {
          const pool = pools.get(event.tradeDate) ?? [];
          return pool.some(candidate => candidate.eventId === event.eventId);
        })
        .sort((left, right) => {
          const leftCandidate = pools
            .get(left.tradeDate)!
            .find(candidate => candidate.eventId === left.eventId)!;
          const rightCandidate = pools
            .get(right.tradeDate)!
            .find(candidate => candidate.eventId === right.eventId)!;
          return (
            rightCandidate.score - leftCandidate.score ||
            rightCandidate.boards - leftCandidate.boards ||
            rightCandidate.sectorCount - leftCandidate.sectorCount ||
            leftCandidate.limitUpTime.localeCompare(
              rightCandidate.limitUpTime
            ) ||
            leftCandidate.symbol.localeCompare(rightCandidate.symbol)
          );
        });
      const heldSymbols = new Set(
        [...positions.values()].map(position => position.stockCode)
      );
      const slots = Math.max(0, MAX_POSITIONS - positions.size);
      const selected = dateEntries
        .filter(event => !heldSymbols.has(event.symbol))
        .slice(0, slots);
      const budgetPerPosition =
        selected.length > 0 ? cash / selected.length : 0;
      for (const event of selected) {
        const bar = barsByDay.get(1)!.get(event.eventId)!;
        const candidate = pools
          .get(event.tradeDate)!
          .find(item => item.eventId === event.eventId)!;
        if (
          bar.open === null ||
          ((bar.open - event.limitUpPrice) / event.limitUpPrice) * 100 < -2
        ) {
          continue;
        }
        const slippedEntry = bar.open! * (1 + SLIPPAGE_BPS / 10_000);
        const shares =
          Math.floor(
            budgetPerPosition /
              (slippedEntry * (1 + COMMISSION_RATE + TRANSFER_FEE_RATE)) /
              LOT_SIZE
          ) * LOT_SIZE;
        if (shares < LOT_SIZE) continue;
        const grossEntry = slippedEntry * shares;
        const buyFees = Math.max(
          MIN_COMMISSION,
          grossEntry * (COMMISSION_RATE + TRANSFER_FEE_RATE)
        );
        const capitalCost = grossEntry + buyFees;
        if (capitalCost > cash + TIME_EPSILON) continue;
        cash -= capitalCost;
        const key = event.eventId;
        positions.set(key, {
          signalDate: event.tradeDate,
          entryDate: date,
          entryMarketIndex: dateIndex,
          stockCode: event.symbol,
          score: candidate.score,
          boards: candidate.boards,
          sector: candidate.sector,
          shares,
          entryPrice: round(slippedEntry, 3),
          capitalCost,
          previousClose: bar.close ?? slippedEntry,
          highestClose: slippedEntry,
          latestClose: bar.close ?? slippedEntry,
        });
        trades.push({
          signalDate: event.tradeDate,
          entryDate: date,
          exitDate: null,
          stockCode: event.symbol,
          score: candidate.score,
          boards: candidate.boards,
          sector: candidate.sector,
          shares,
          entryPrice: round(slippedEntry, 3),
          exitPrice: null,
          netPnl: null,
          netReturn: null,
          exitReason: null,
        });
      }

      const closeBarByEvent = new Map<string, Bar>();
      for (const [eventId, position] of positions) {
        const holdingDays =
          dateIndex - position.entryMarketIndex + 1;
        const bar = barsByDay.get(holdingDays)?.get(eventId);
        if (!bar || bar.close === null) continue;
        closeBarByEvent.set(eventId, bar);
        position.latestClose = bar.close;
        position.highestClose = Math.max(position.highestClose, bar.close);
      }

      for (const [eventId, position] of Array.from(positions.entries())) {
        const holdingDays =
          dateIndex - position.entryMarketIndex + 1;
        if (holdingDays < 2) continue;
        const bar = closeBarByEvent.get(eventId);
        const exitPrice = bar?.close ?? null;
        if (exitPrice === null) continue;

        const closeReturnPercent =
          ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
        const peakReturnPercent =
          ((position.highestClose - position.entryPrice) / position.entryPrice) *
          100;
        const drawdownFromPeakPercent =
          position.highestClose === 0
            ? 0
            : ((exitPrice - position.highestClose) / position.highestClose) *
              100;
        const trailingArmed = peakReturnPercent >= 6;
        let exitReason: string | null = null;

        if (closeReturnPercent <= -5) {
          exitReason = `收盘触发止损（${round(closeReturnPercent)}% ≤ -5%）`;
        } else if (
          trailingArmed &&
          drawdownFromPeakPercent < 0 &&
          drawdownFromPeakPercent <= -3
        ) {
          exitReason =
            `动态回撤止盈（峰值收益${round(peakReturnPercent)}%，` +
            `回撤${round(drawdownFromPeakPercent)}% ≤ -3%）`;
        } else {
          const strongClose =
            closeReturnPercent >= 3 &&
            (position.previousClose === null ||
              exitPrice >= position.previousClose);
          if (holdingDays >= 5) {
            exitReason = "达到最多续持5个交易日";
          } else if (!trailingArmed && !strongClose) {
            exitReason =
              holdingDays === 2
                ? "T+2收盘未满足强势续持条件"
                : "后续收盘未满足强势续持条件";
          } else {
            position.previousClose = exitPrice;
            const trade = trades.find(
              item =>
                item.signalDate === position.signalDate &&
                item.stockCode === position.stockCode &&
                item.exitDate === null
            );
            if (trade) {
              trade.exitReason = trailingArmed
                ? `动态止盈已启动：峰值收益${round(peakReturnPercent)}%，` +
                  `当前回撤${round(drawdownFromPeakPercent)}%，继续持有`
                : `满足强势续持：收盘收益${round(closeReturnPercent)}%，` +
                  "收盘不低于前收；继续持有";
            }
            continue;
          }
        }
        settle(eventId, date, exitPrice, exitReason!);
      }

      const equity =
        cash +
        [...positions.values()].reduce(
          (sum, position) =>
            sum + position.latestClose * position.shares,
          0
        );
      equityCurve.push({ date, equity: round(equity) });
      maxEquity = Math.max(maxEquity, equity);
      maxDrawdown = Math.max(
        maxDrawdown,
        maxEquity > 0 ? ((maxEquity - equity) / maxEquity) * 100 : 0
      );
    }

    const valuationDate = marketDates.at(-1) ?? null;
    for (const position of positions.values()) {
      const trade = trades.find(
        item =>
          item.signalDate === position.signalDate &&
          item.stockCode === position.stockCode &&
          item.exitDate === null
      );
      if (!trade) continue;
      const terminalReason =
        valuationDate === null
          ? "回测结束仍持仓"
          : `回测结束仍持仓，按${valuationDate}收盘价期末估值`;
      trade.exitReason = trade.exitReason
        ? `${trade.exitReason}；${terminalReason}`
        : terminalReason;
    }

    const finalEquity = equityCurve.at(-1)?.equity ?? INITIAL_CAPITAL;
    const closed = trades.filter(trade => trade.netPnl !== null);
    const wins = closed.filter(trade => (trade.netPnl ?? 0) > 0).length;
    const grossProfit = closed
      .filter(trade => (trade.netPnl ?? 0) > 0)
      .reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0);
    const grossLoss = Math.abs(
      closed
        .filter(trade => (trade.netPnl ?? 0) < 0)
        .reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0)
    );
    const averageReturn =
      closed.length === 0
        ? null
        : closed.reduce((sum, trade) => sum + (trade.netReturn ?? 0), 0) /
          closed.length;
    const metric: PortfolioMetric = {
      initialCapital: INITIAL_CAPITAL,
      finalEquity: round(finalEquity),
      netProfit: round(finalEquity - INITIAL_CAPITAL),
      totalReturn: round((finalEquity / INITIAL_CAPITAL - 1) * 100),
      maxDrawdown: round(maxDrawdown),
      filledCount: trades.length,
      closedCount: closed.length,
      openPositionCount: positions.size,
      winningTrades: wins,
      winRate: closed.length === 0 ? null : round((wins / closed.length) * 100),
      averageReturn: averageReturn === null ? null : round(averageReturn),
      profitFactor: grossLoss === 0 ? null : round(grossProfit / grossLoss, 3),
    };

    context.log(
      `Dataset 事件 ${eventRows.length}；来源可评分 ${sourceEvents.length}；` +
        `可执行入场 ${executableEvents.length}；评分池 ${pooledCandidateCount}；` +
        `成交 ${trades.length}；期末持仓 ${positions.size}`
    );

    return assembleLeaderCandidateBaselineResult({
      totalSignals: eventRows.length,
      sourceKnownSignals: sourceEvents.length,
      missingSourceSignals: eventRows.length - sourceEvents.length,
      metric,
      trades,
      equityCurve,
      excludedByReason,
      candidateCount: eventRows.length,
      eligibleCount: executableEvents.length,
    });
  },
};

export default leaderCandidateBaselineExperiment;
