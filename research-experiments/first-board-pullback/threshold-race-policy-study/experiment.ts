import {
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  ENTRY_WINDOW_DAYS,
  EXIT_DAY,
  PULLBACK_TRIGGER_BPS,
  RACE_POLICIES,
  RACE_THRESHOLDS,
  ROUND_TRIP_COST_BPS,
  assembleThresholdRacePolicyResult,
  thresholdRacePolicySchema,
  type PolicySample,
  type RacePolicy,
} from "./result";

const POST_DAYS = Array.from({ length: EXIT_DAY }, (_, index) => index + 1);

interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
  limitDownPrice: number;
  barPresent: boolean;
  suspended: boolean;
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
  const open = numberValue(row.values, "open");
  const high = numberValue(row.values, "high");
  const low = numberValue(row.values, "low");
  const close = numberValue(row.values, "close");
  const limitDownPrice = numberValue(row.values, "limitDownPrice");
  if (
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    limitDownPrice === null ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    limitDownPrice <= 0
  ) {
    return null;
  }
  return {
    open,
    high,
    low,
    close,
    limitDownPrice,
    barPresent: booleanValue(row.values, "barPresent", true),
    suspended: row.values.suspensionStatus === "SUSPENDED",
    canBuyAtOpen: booleanValue(row.values, "canBuyAtOpen", false),
    canSellAtClose: booleanValue(row.values, "canSellAtClose", false),
  };
}

function sortEvents(
  left: ExperimentEventRow,
  right: ExperimentEventRow
): number {
  return left.tradeDate === right.tradeDate
    ? left.eventId.localeCompare(right.eventId)
    : left.tradeDate.localeCompare(right.tradeDate);
}

function nextSellableOpen(
  bars: readonly Bar[],
  startDay: number
): { day: number; price: number } | null {
  for (let day = startDay; day <= EXIT_DAY; day += 1) {
    const bar = bars[day - 1]!;
    if (bar.open > bar.limitDownPrice + 1e-9) {
      return { day, price: bar.open };
    }
  }
  return null;
}

export const thresholdRacePolicyStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/threshold-race-policy-study",
    name: "首板动态入场阈值竞争规则研究",
    version: COMPUTATION_VERSION,
    description:
      "沿用动态入场，比较首次收盘触及 ±2%/±5% 后的止损、止盈、对称退出和持有 T+10。" +
      "阈值以收盘确认，下一可卖开盘执行，所有规则在同一事件集上配对比较。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "competing-risk",
      "take-profit",
      "stop-loss",
    ],
    parameters: [],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: {
        events: ["isFirstLimit", "boardType", "market", "limitUpPrice"],
        feature: ["open", "close"],
        observation: [
          "open",
          "high",
          "low",
          "close",
          "limitDownPrice",
          "barPresent",
          "suspensionStatus",
          "canBuyAtOpen",
          "canSellAtClose",
        ],
      },
      prefixRelativeDays: [0],
      postRelativeDays: POST_DAYS,
      decisionOffsetDays: ENTRY_WINDOW_DAYS,
      usesForwardData: true,
      forwardDataPurpose:
        "在固定动态入场后，比较首次触及 ±2%/±5% 后不同退出规则的实现收益。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/threshold-race-policy-study",
    pageTitle: "阈值竞争规则研究",
  },
  resultSchema: thresholdRacePolicySchema,
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
    const uniqueEvents = [...deduped.values()].sort(sortEvents);
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
    const addExclusion = (code: string, count = 1): void => {
      if (count > 0)
        excludedByReason[code] = (excludedByReason[code] ?? 0) + count;
    };

    const samples: PolicySample[] = [];
    let exactLimitUpCloseCount = 0;
    let triggeredCount = 0;
    let entryUnfillableCount = 0;

    for (const event of uniqueEvents) {
      const eventBar = eventDayByEvent.get(event.eventId);
      const eventOpen = numberValue(eventBar?.values ?? {}, "open");
      const eventClose = numberValue(eventBar?.values ?? {}, "close");
      const limitUpPrice = numberValue(event.values, "limitUpPrice");
      if (
        !eventBar ||
        eventOpen === null ||
        eventClose === null ||
        limitUpPrice === null ||
        eventOpen <= 0 ||
        eventClose <= 0 ||
        limitUpPrice <= 0
      ) {
        addExclusion("MISSING_PATH");
        continue;
      }
      if (Math.abs(eventClose - limitUpPrice) > 1e-9) {
        addExclusion("EVENT_NOT_EXACT_LIMIT_UP");
        continue;
      }
      const bars: Bar[] = [];
      let pathComplete = true;
      for (let day = 1; day <= EXIT_DAY; day += 1) {
        const bar = parseBar(postByDay.get(day)?.get(event.eventId));
        if (!bar || !bar.barPresent || bar.suspended) {
          pathComplete = false;
          break;
        }
        bars.push(bar);
      }
      if (!pathComplete) {
        addExclusion("MISSING_PATH");
        continue;
      }
      exactLimitUpCloseCount += 1;

      let triggerDay: number | null = null;
      for (let day = 1; day <= ENTRY_WINDOW_DAYS; day += 1) {
        const bar = bars[day - 1]!;
        if (bar.close < eventOpen - 1e-9) break;
        if (
          bar.close <=
          eventClose * (1 - PULLBACK_TRIGGER_BPS / 10_000) + 1e-9
        ) {
          triggerDay = day;
          break;
        }
      }
      if (triggerDay === null) continue;
      triggeredCount += 1;
      const entryDay = triggerDay + 1;
      const entryBar = bars[entryDay - 1]!;
      if (!entryBar.canBuyAtOpen) {
        entryUnfillableCount += 1;
        continue;
      }

      const closeMarks: number[] = [];
      for (let day = entryDay; day <= EXIT_DAY; day += 1) {
        closeMarks[day] = bars[day - 1]!.close / entryBar.open - 1;
      }
      const firstDayAtOrAbove = (threshold: number): number | null => {
        for (let day = entryDay; day <= EXIT_DAY; day += 1) {
          if (closeMarks[day]! >= threshold) return day;
        }
        return null;
      };
      const firstDayAtOrBelow = (threshold: number): number | null => {
        for (let day = entryDay; day <= EXIT_DAY; day += 1) {
          if (closeMarks[day]! <= threshold) return day;
        }
        return null;
      };
      const race = (threshold: number): "POS_FIRST" | "NEG_FIRST" | "NONE" => {
        const positive = firstDayAtOrAbove(threshold);
        const negative = firstDayAtOrBelow(-threshold);
        if (positive === null && negative === null) return "NONE";
        if (negative === null) return "POS_FIRST";
        if (positive === null) return "NEG_FIRST";
        return positive < negative ? "POS_FIRST" : "NEG_FIRST";
      };

      const applyStop = (
        negativeThreshold: number,
        positiveThreshold: number | null
      ): { return: number; holdingDays: number } => {
        const negativeDay = firstDayAtOrBelow(-negativeThreshold);
        const positiveDay =
          positiveThreshold === null
            ? null
            : firstDayAtOrAbove(positiveThreshold);
        const stopDay =
          negativeDay !== null &&
          (positiveDay === null || negativeDay < positiveDay)
            ? negativeDay
            : null;
        const takeDay =
          positiveDay !== null &&
          (negativeDay === null || positiveDay < negativeDay)
            ? positiveDay
            : null;
        const decisionDay = stopDay ?? takeDay;
        if (decisionDay === null || decisionDay === EXIT_DAY) {
          const exitPrice = bars[EXIT_DAY - 1]!.close;
          return {
            return: exitPrice / entryBar.open - 1,
            holdingDays: EXIT_DAY - entryDay + 1,
          };
        }
        const exit = nextSellableOpen(bars, decisionDay + 1);
        if (exit === null) {
          const exitPrice = bars[EXIT_DAY - 1]!.close;
          return {
            return: exitPrice / entryBar.open - 1,
            holdingDays: EXIT_DAY - entryDay + 1,
          };
        }
        return {
          return: exit.price / entryBar.open - 1,
          holdingDays: exit.day - entryDay + 1,
        };
      };

      const holdReturn = bars[EXIT_DAY - 1]!.close / entryBar.open - 1;
      const returns: Record<string, number> = {
        HOLD_T10: holdReturn,
        NEG2_STOP: applyStop(0.02, null).return,
        POS2_TAKE: applyStop(1, 0.02).return,
        SYM2: applyStop(0.02, 0.02).return,
        NEG5_STOP: applyStop(0.05, null).return,
        POS5_TAKE: applyStop(1, 0.05).return,
        SYM5: applyStop(0.05, 0.05).return,
      };
      const holdingDays: Record<string, number> = {
        HOLD_T10: EXIT_DAY - entryDay + 1,
        NEG2_STOP: applyStop(0.02, null).holdingDays,
        POS2_TAKE: applyStop(1, 0.02).holdingDays,
        SYM2: applyStop(0.02, 0.02).holdingDays,
        NEG5_STOP: applyStop(0.05, null).holdingDays,
        POS5_TAKE: applyStop(1, 0.05).holdingDays,
        SYM5: applyStop(0.05, 0.05).holdingDays,
      };
      samples.push({
        eventId: event.eventId,
        eventDate: event.tradeDate,
        year: Number(event.tradeDate.slice(0, 4)),
        entryDay,
        grossReturns: returns as PolicySample["grossReturns"],
        holdingDays: holdingDays as PolicySample["holdingDays"],
        race2: race(0.02),
        race5: race(0.05),
      });
    }

    const datasetEventCount = context.dataset.facts.totalEvents;
    const unscannedEventCount =
      datasetEventCount === null
        ? null
        : Math.max(0, datasetEventCount - uniqueEvents.length);
    context.log(
      `候选 ${uniqueEvents.length}；严格涨停 ${exactLimitUpCloseCount}；触发 ${triggeredCount}；` +
        `动态交易 ${samples.length}`
    );

    return assembleThresholdRacePolicyResult({
      samples,
      candidateCount: uniqueEvents.length,
      exactLimitUpCloseCount,
      triggeredCount,
      entryUnfillableCount,
      excludedByReason,
      datasetEventCount,
      unscannedEventCount,
      duplicateEventIdCount,
    });
  },
};

export default thresholdRacePolicyStudyExperiment;
