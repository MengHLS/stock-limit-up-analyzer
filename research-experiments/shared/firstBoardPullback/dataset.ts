import type {
  ExperimentBarRow,
  ExperimentEventRow,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  FIRST_BOARD_PULLBACK_EPSILON,
  FIRST_BOARD_PULLBACK_MAX_RELATIVE_DAY,
  type NormalizedFoundationBar,
  type NormalizedFoundationEvent,
} from "./types";

function numberValue(
  values: Readonly<Record<string, number | boolean | string | null>>,
  key: string
): number | null {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(
  values: Readonly<Record<string, number | boolean | string | null>>,
  key: string
): boolean | null {
  const value = values[key];
  return typeof value === "boolean" ? value : null;
}

function stringValue(
  values: Readonly<Record<string, number | boolean | string | null>>,
  key: string
): string | null {
  const value = values[key];
  return typeof value === "string" ? value : null;
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= FIRST_BOARD_PULLBACK_EPSILON;
}

function normalizeBar(row: ExperimentBarRow | undefined, relativeDay: number): NormalizedFoundationBar {
  const values = row?.values ?? {};
  const open = numberValue(values, "open");
  const high = numberValue(values, "high");
  const low = numberValue(values, "low");
  const close = numberValue(values, "close");
  const preClose = numberValue(values, "preClose");
  const limitUpPrice = numberValue(values, "limitUpPrice");
  const limitDownPrice = numberValue(values, "limitDownPrice");
  const barPresent = booleanValue(values, "barPresent") ?? row !== undefined;
  const suspended = stringValue(values, "suspensionStatus") === "SUSPENDED";
  const canBuyAtOpen = booleanValue(values, "canBuyAtOpen");
  const canSellAtClose = booleanValue(values, "canSellAtClose");
  const structurallyValid =
    open !== null &&
    high !== null &&
    low !== null &&
    close !== null &&
    preClose !== null &&
    limitUpPrice !== null &&
    limitDownPrice !== null &&
    open > 0 &&
    high > 0 &&
    low > 0 &&
    close > 0 &&
    preClose > 0 &&
    limitUpPrice > 0 &&
    limitDownPrice > 0 &&
    high >= Math.max(open, close) &&
    low <= Math.min(open, close);
  return {
    relativeDay,
    open,
    high,
    low,
    close,
    preClose,
    limitUpPrice,
    limitDownPrice,
    barPresent,
    suspended,
    canBuyAtOpen,
    canSellAtClose,
    structurallyValid,
  };
}

export interface FoundationDatasetLoadResult {
  events: readonly NormalizedFoundationEvent[];
  duplicateEventIdCount: number;
  accounting: {
    candidateCount: number;
    firstLimitCount: number;
    mainBoardCount: number;
    exactLimitUpCount: number;
    validEventDayCount: number;
    nonOneWordCount: number;
    oneWordLimitUpCount: number;
    excludedByReason: Record<string, number>;
  };
}

function exclusionCodeForEvent(row: ExperimentEventRow, bar: ExperimentBarRow | undefined): string | null {
  if (row.values.isFirstLimit !== true) return "NOT_FIRST_LIMIT";
  const market = stringValue(row.values, "market");
  const boardType = stringValue(row.values, "boardType");
  if (boardType !== "main" || (market !== "SH" && market !== "SZ")) {
    return "NOT_MAIN_BOARD";
  }
  if (!bar) return "MISSING_EVENT_DAY_BAR";
  const open = numberValue(bar.values, "open");
  const high = numberValue(bar.values, "high");
  const low = numberValue(bar.values, "low");
  const close = numberValue(bar.values, "close");
  const previousClose = numberValue(row.values, "previousClose");
  const limitUpPrice = numberValue(row.values, "limitUpPrice");
  if (
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    previousClose === null ||
    limitUpPrice === null ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    previousClose <= 0 ||
    limitUpPrice <= 0 ||
    high < Math.max(open, close) ||
    low > Math.min(open, close)
  ) {
    return "INVALID_EVENT_DAY_OHLC";
  }
  if (!approximatelyEqual(close, limitUpPrice)) {
    return "EVENT_NOT_EXACT_LIMIT_UP";
  }
  return null;
}

export async function loadNormalizedFoundationEvents(
  context: ExperimentRunContext,
  eventIds?: readonly string[]
): Promise<FoundationDatasetLoadResult> {
  const rows = await context.dataset.events();
  const wanted = eventIds === undefined ? null : new Set(eventIds);
  const deduped = new Map<string, ExperimentEventRow>();
  let duplicateEventIdCount = 0;
  for (const row of rows) {
    if (wanted !== null && !wanted.has(row.eventId)) continue;
    if (deduped.has(row.eventId)) {
      duplicateEventIdCount += 1;
      continue;
    }
    deduped.set(row.eventId, row);
  }
  const sortedRows = [...deduped.values()].sort((left, right) =>
    left.tradeDate === right.tradeDate
      ? left.eventId.localeCompare(right.eventId)
      : left.tradeDate.localeCompare(right.tradeDate)
  );

  const eventDayRows = await context.dataset.feature(0);
  const eventDayByEvent = new Map(eventDayRows.map(row => [row.eventId, row]));
  const postByDay = new Map<number, Map<string, ExperimentBarRow>>();
  for (
    let day = 1;
    day <= FIRST_BOARD_PULLBACK_MAX_RELATIVE_DAY;
    day += 1
  ) {
    const bars = await context.dataset.observation(day);
    postByDay.set(day, new Map(bars.map(row => [row.eventId, row])));
  }

  const excludedByReason: Record<string, number> = {};
  const addExclusion = (code: string): void => {
    excludedByReason[code] = (excludedByReason[code] ?? 0) + 1;
  };

  const events: NormalizedFoundationEvent[] = [];
  let firstLimitCount = 0;
  let mainBoardCount = 0;
  let exactLimitUpCount = 0;
  let validEventDayCount = 0;
  let nonOneWordCount = 0;
  let oneWordLimitUpCount = 0;

  for (const row of sortedRows) {
    const eventBarRow = eventDayByEvent.get(row.eventId);
    const exclusion = exclusionCodeForEvent(row, eventBarRow);
    if (exclusion !== null) {
      addExclusion(exclusion);
      continue;
    }
    if (row.values.isFirstLimit === true) firstLimitCount += 1;
    const market = stringValue(row.values, "market");
    const boardType = stringValue(row.values, "boardType");
    if (boardType === "main" && (market === "SH" || market === "SZ")) {
      mainBoardCount += 1;
    }
    const limitUpPrice = numberValue(row.values, "limitUpPrice")!;
    const previousClose = numberValue(row.values, "previousClose")!;
    const open = numberValue(eventBarRow!.values, "open")!;
    const high = numberValue(eventBarRow!.values, "high")!;
    const low = numberValue(eventBarRow!.values, "low")!;
    const close = numberValue(eventBarRow!.values, "close")!;
    if (approximatelyEqual(close, limitUpPrice)) exactLimitUpCount += 1;
    validEventDayCount += 1;
    const oneWordLimitUp =
      approximatelyEqual(open, limitUpPrice) &&
      approximatelyEqual(high, limitUpPrice) &&
      approximatelyEqual(low, limitUpPrice) &&
      approximatelyEqual(close, limitUpPrice);
    if (oneWordLimitUp) oneWordLimitUpCount += 1;
    else nonOneWordCount += 1;

    const barsByRelativeDay = new Map<number, NormalizedFoundationBar>();
    for (
      let day = 1;
      day <= FIRST_BOARD_PULLBACK_MAX_RELATIVE_DAY;
      day += 1
    ) {
      barsByRelativeDay.set(day, normalizeBar(postByDay.get(day)?.get(row.eventId), day));
    }

    events.push({
      eventId: row.eventId,
      symbol: row.symbol,
      eventDate: row.tradeDate,
      year: Number(row.tradeDate.slice(0, 4)),
      market: market!,
      boardType: boardType!,
      turnover: numberValue(row.values, "turnover"),
      floatMarketCap: numberValue(row.values, "floatMarketCap"),
      previousLimitDate:
        typeof row.values.previousLimitDate === "string"
          ? row.values.previousLimitDate
          : null,
      daysSincePreviousLimit: numberValue(
        row.values,
        "daysSincePreviousLimit"
      ),
      historicalLimitCount: numberValue(row.values, "historicalLimitCount"),
      previousClose,
      limitUpPrice,
      open,
      high,
      low,
      close,
      bodyHeightClose: (close - open) / close,
      bodyHeightPreviousClose: (close - open) / previousClose,
      oneWordLimitUp,
      barsByRelativeDay,
    });
  }

  return {
    events,
    duplicateEventIdCount,
    accounting: {
      candidateCount: sortedRows.length,
      firstLimitCount,
      mainBoardCount,
      exactLimitUpCount,
      validEventDayCount,
      nonOneWordCount,
      oneWordLimitUpCount,
      excludedByReason,
    },
  };
}
