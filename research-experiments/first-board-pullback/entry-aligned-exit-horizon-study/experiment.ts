import {
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  CONTEXT_DAYS,
  ENTRY_DAY,
  MAX_EXIT_DAY,
  MAX_HOLDING_DAY,
  REACH_THRESHOLDS,
  assembleEntryAlignedExitHorizon,
  entryAlignedExitHorizonSchema,
  type ExitPathPoint,
  type ExitPathSample,
} from "./result";

const POST_DAYS = Array.from(
  { length: MAX_EXIT_DAY },
  (_, index) => index + 1
);
const PRICE_EPSILON = 1e-8;

interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
  limitUpPrice: number;
  limitDownPrice: number;
  canBuyAtOpen: boolean;
  canSellAtClose: boolean;
}

function numberValue(
  values: Readonly<Record<string, number | boolean | string | null>>,
  key: string
): number | null {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(
  values: Readonly<Record<string, number | boolean | string | null>>,
  key: string
): string | null {
  const value = values[key];
  return typeof value === "string" ? value : null;
}

function booleanValue(
  values: Readonly<Record<string, number | boolean | string | null>>,
  key: string,
  fallback: boolean
): boolean {
  const value = values[key];
  return typeof value === "boolean" ? value : fallback;
}

function parseBar(row: ExperimentEventRow | undefined): Bar | null {
  if (!row) return null;
  if (!booleanValue(row.values, "barPresent", true)) return null;
  if (row.values.suspensionStatus === "SUSPENDED") return null;
  const open = numberValue(row.values, "open");
  const high = numberValue(row.values, "high");
  const low = numberValue(row.values, "low");
  const close = numberValue(row.values, "close");
  const limitUpPrice = numberValue(row.values, "limitUpPrice");
  const limitDownPrice = numberValue(row.values, "limitDownPrice");
  if (
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    limitUpPrice === null ||
    limitDownPrice === null ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    limitUpPrice <= 0 ||
    limitDownPrice <= 0 ||
    high < Math.max(open, close) ||
    low > Math.min(open, close)
  ) {
    return null;
  }
  return {
    open,
    high,
    low,
    close,
    limitUpPrice,
    limitDownPrice,
    canBuyAtOpen: booleanValue(row.values, "canBuyAtOpen", false),
    canSellAtClose: booleanValue(row.values, "canSellAtClose", false),
  };
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= PRICE_EPSILON;
}

function sortEventRows(
  left: ExperimentEventRow,
  right: ExperimentEventRow
): number {
  return left.tradeDate === right.tradeDate
    ? left.eventId.localeCompare(right.eventId)
    : left.tradeDate.localeCompare(right.tradeDate);
}

function findFirstReach(
  entryOpen: number,
  bars: readonly Bar[],
  threshold: number
): number | null {
  for (let index = 0; index < bars.length; index += 1) {
    const mark = bars[index]!.close / entryOpen - 1;
    if (
      (threshold < 0 && mark <= threshold + PRICE_EPSILON) ||
      (threshold > 0 && mark >= threshold - PRICE_EPSILON)
    ) {
      return index + 1;
    }
  }
  return null;
}

export const entryAlignedExitHorizonStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/entry-aligned-exit-horizon-study",
    name: "入场对齐的退出视界曲线研究",
    version: COMPUTATION_VERSION,
    description:
      "严格首板、排除 T 日一字板、排除 T+1..T+5 任一日触及涨停或跌停。" +
      "T+6 开盘入场后按实际持有日展开到 T+20，输出共同样本收益曲线、分位数、MFE/MAE、" +
      "最大收盘回撤、阈值首次到达和真实可卖退出延迟。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "exit-horizon",
      "holding-day",
      "common-sample",
      "limit-touch-filter",
    ],
    parameters: [],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: {
        events: ["isFirstLimit", "boardType", "market", "limitUpPrice"],
        feature: ["open", "high", "low", "close"],
        observation: [
          "open",
          "high",
          "low",
          "close",
          "preClose",
          "limitUpPrice",
          "limitDownPrice",
          "barPresent",
          "suspensionStatus",
          "canBuyAtOpen",
          "canSellAtClose",
        ],
      },
      prefixRelativeDays: [0],
      postRelativeDays: POST_DAYS,
      decisionOffsetDays: CONTEXT_DAYS,
      usesForwardData: true,
      forwardDataPurpose:
        "T+1..T+5 仅用于执行涨跌停触达排除；T+6 开盘入场后逐持有日计算退出曲线。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/entry-aligned-exit-horizon-study",
    pageTitle: "入场对齐退出曲线",
  },
  resultSchema: entryAlignedExitHorizonSchema,
  run: async (context: ExperimentRunContext) => {
    const events = await context.dataset.events();
    const deduped = new Map<string, ExperimentEventRow>();
    let duplicateEventIdCount = 0;
    for (const event of events) {
      if (deduped.has(event.eventId)) {
        duplicateEventIdCount += 1;
        continue;
      }
      deduped.set(event.eventId, event);
    }
    const uniqueEvents = [...deduped.values()].sort(sortEventRows);
    context.freezeSelection(uniqueEvents.map(event => event.eventId));

    const eventDayBars = await context.dataset.feature(0);
    const eventDayByEvent = new Map(
      eventDayBars.map(bar => [bar.eventId, bar])
    );
    const postByDay = new Map<number, Map<string, ExperimentEventRow>>();
    for (const day of POST_DAYS) {
      const rows = await context.dataset.observation(day);
      postByDay.set(day, new Map(rows.map(row => [row.eventId, row])));
    }

    const excludedByReason: Record<string, number> = {};
    const addExclusion = (code: string): void => {
      excludedByReason[code] = (excludedByReason[code] ?? 0) + 1;
    };

    const samples: ExitPathSample[] = [];
    let exactLimitUpCloseCount = 0;
    let nonOneWordCount = 0;
    let cleanContextCount = 0;
    let pathCompleteCount = 0;
    let entryUnfillableCount = 0;

    for (const event of uniqueEvents) {
      const boardType = stringValue(event.values, "boardType");
      const market = stringValue(event.values, "market");
      if (boardType !== "main" || (market !== "SH" && market !== "SZ")) {
        addExclusion("EVENT_NOT_MAIN_BOARD");
        continue;
      }

      const eventBar = eventDayByEvent.get(event.eventId);
      const limitUpPrice = numberValue(event.values, "limitUpPrice");
      if (!eventBar || limitUpPrice === null || limitUpPrice <= 0) {
        addExclusion("MISSING_EVENT_DAY_BAR");
        continue;
      }
      const eventOpen = numberValue(eventBar.values, "open");
      const eventHigh = numberValue(eventBar.values, "high");
      const eventLow = numberValue(eventBar.values, "low");
      const eventClose = numberValue(eventBar.values, "close");
      if (
        eventOpen === null ||
        eventHigh === null ||
        eventLow === null ||
        eventClose === null ||
        eventOpen <= 0 ||
        eventHigh <= 0 ||
        eventLow <= 0 ||
        eventClose <= 0 ||
        eventHigh < Math.max(eventOpen, eventClose) ||
        eventLow > Math.min(eventOpen, eventClose)
      ) {
        addExclusion("INVALID_EVENT_DAY_BAR");
        continue;
      }
      if (!approximatelyEqual(eventClose, limitUpPrice)) {
        addExclusion("EVENT_NOT_EXACT_LIMIT_UP");
        continue;
      }
      exactLimitUpCloseCount += 1;
      if (
        approximatelyEqual(eventOpen, limitUpPrice) &&
        approximatelyEqual(eventHigh, limitUpPrice) &&
        approximatelyEqual(eventLow, limitUpPrice) &&
        approximatelyEqual(eventClose, limitUpPrice)
      ) {
        addExclusion("ONE_WORD_LIMIT_UP");
        continue;
      }
      nonOneWordCount += 1;

      const contextBars: Bar[] = [];
      let contextInvalid = false;
      let contextMissing = false;
      for (let day = 1; day <= CONTEXT_DAYS; day += 1) {
        const row = postByDay.get(day)?.get(event.eventId);
        if (!row) {
          contextMissing = true;
          break;
        }
        const bar = parseBar(row);
        if (bar === null) {
          contextInvalid = true;
          break;
        }
        contextBars.push(bar);
      }
      if (contextMissing) {
        addExclusion("MISSING_CONTEXT_BAR");
        continue;
      }
      if (contextInvalid) {
        addExclusion("INVALID_CONTEXT_BAR");
        continue;
      }
      const hadLimitTouch = contextBars.some(
        bar =>
          bar.high >= bar.limitUpPrice - PRICE_EPSILON ||
          bar.low <= bar.limitDownPrice + PRICE_EPSILON
      );
      if (hadLimitTouch) {
        addExclusion("HAD_LIMIT_TOUCH_IN_CONTEXT");
        continue;
      }
      cleanContextCount += 1;

      const forwardBars: Bar[] = [];
      let forwardMissing = false;
      for (
        let day = ENTRY_DAY;
        day <= MAX_EXIT_DAY;
        day += 1
      ) {
        const row = postByDay.get(day)?.get(event.eventId);
        if (!row) {
          forwardMissing = true;
          break;
        }
        const bar = parseBar(row);
        if (bar === null) {
          forwardMissing = true;
          break;
        }
        forwardBars.push(bar);
      }
      if (forwardMissing || forwardBars.length !== MAX_HOLDING_DAY) {
        addExclusion("MISSING_FORWARD_PATH");
        continue;
      }
      pathCompleteCount += 1;

      const entryBar = forwardBars[0]!;
      if (!entryBar.canBuyAtOpen || entryBar.open <= 0) {
        entryUnfillableCount += 1;
        addExclusion("ENTRY_UNFILLABLE");
        continue;
      }
      const entryOpen = entryBar.open;
      const points: ExitPathPoint[] = [];
      let noExecutableExit = false;
      for (let targetIndex = 0; targetIndex < forwardBars.length; targetIndex += 1) {
        let exitIndex: number | null = null;
        for (
          let candidateIndex = targetIndex;
          candidateIndex < forwardBars.length;
          candidateIndex += 1
        ) {
          if (forwardBars[candidateIndex]!.canSellAtClose) {
            exitIndex = candidateIndex;
            break;
          }
        }
        if (exitIndex === null) {
          noExecutableExit = true;
          break;
        }
        const exitBar = forwardBars[exitIndex]!;
        const heldBars = forwardBars.slice(0, targetIndex + 1);
        const maxFavorableExcursion = Math.max(
          ...heldBars.map(bar => bar.high / entryOpen - 1)
        );
        const maxAdverseExcursion = Math.min(
          ...heldBars.map(bar => bar.low / entryOpen - 1)
        );
        let peakPrice = entryOpen;
        let maxCloseDrawdown = 0;
        for (const bar of heldBars) {
          maxCloseDrawdown = Math.min(
            maxCloseDrawdown,
            bar.close / peakPrice - 1
          );
          peakPrice = Math.max(peakPrice, bar.close);
        }
        points.push({
          targetHoldingDay: targetIndex + 1,
          targetRelativeDay: ENTRY_DAY + targetIndex,
          exitRelativeDay: ENTRY_DAY + exitIndex,
          grossReturn: exitBar.close / entryOpen - 1,
          maxFavorableExcursion,
          maxAdverseExcursion,
          maxCloseDrawdown,
        });
      }
      if (noExecutableExit) {
        addExclusion("NO_EXECUTABLE_EXIT_BY_MAX_HORIZON");
        continue;
      }

      const firstReachByThreshold: Record<string, number | null> = {};
      for (const threshold of REACH_THRESHOLDS) {
        firstReachByThreshold[String(threshold)] = findFirstReach(
          entryOpen,
          forwardBars,
          threshold
        );
      }
      samples.push({
        eventId: event.eventId,
        eventDate: event.tradeDate,
        year: Number(event.tradeDate.slice(0, 4)),
        points,
        firstReachByThreshold,
      });
    }

    const datasetEventCount = context.dataset.facts.totalEvents;
    const unscannedEventCount =
      datasetEventCount === null
        ? null
        : Math.max(0, datasetEventCount - uniqueEvents.length);
    context.log(
      `候选 ${uniqueEvents.length}；严格涨停 ${exactLimitUpCloseCount}；` +
        `非一字板 ${nonOneWordCount}；T+1..T+5 无涨跌停 ${cleanContextCount}；` +
        `共同路径 ${pathCompleteCount}；T+6 不可买 ${entryUnfillableCount}；` +
        `样本 ${samples.length}`
    );

    return assembleEntryAlignedExitHorizon({
      samples,
      candidateCount: uniqueEvents.length,
      exactLimitUpCloseCount,
      nonOneWordCount,
      cleanContextCount,
      pathCompleteCount,
      entryUnfillableCount,
      excludedByReason,
      datasetEventCount,
      unscannedEventCount,
      duplicateEventIdCount,
    });
  },
};

export default entryAlignedExitHorizonStudyExperiment;
