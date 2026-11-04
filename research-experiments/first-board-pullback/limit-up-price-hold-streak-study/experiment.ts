import {
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  CONTEXT_DAYS,
  COMPUTATION_VERSION,
  DEFAULT_HORIZONS,
  ENTRY_DAY,
  MAX_HORIZON,
  assembleLimitUpPriceHoldStreak,
  limitUpPriceHoldStreakSchema,
  type HoldSample,
  type StreakValue,
} from "./result";

const POST_DAYS = Array.from({ length: MAX_HORIZON }, (_, index) => index + 1);

interface Bar {
  high: number;
  low: number;
  close: number;
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
  const high = numberValue(row.values, "high");
  const low = numberValue(row.values, "low");
  const close = numberValue(row.values, "close");
  if (
    high === null ||
    low === null ||
    close === null ||
    high <= 0 ||
    low <= 0 ||
    close <= 0
  ) {
    return null;
  }
  return {
    high,
    low,
    close,
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

export const limitUpPriceHoldStreakStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/limit-up-price-hold-streak-study",
    name: "首板涨停价连续守线研究",
    version: COMPUTATION_VERSION,
    description:
      "研究 T+1..T+5 从收盘价和盘中最低价两个口径看，连续未跌破首板涨停价的天数" +
      "与 T+6 开盘入场后 T+10/T+20 收益、MFE/MAE 的关系。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "limit-up-price",
      "streak",
      "mfe",
      "hold-support",
    ],
    parameters: [
      {
        code: "horizons",
        label: "退出视界",
        description: `T+${ENTRY_DAY} 开盘入场后的 T+h 收盘视界，允许 ${ENTRY_DAY + 1}..${MAX_HORIZON}。`,
        kind: "INT_LIST",
        required: false,
        defaultValue: [...DEFAULT_HORIZONS],
        bounds: { min: ENTRY_DAY + 1, max: MAX_HORIZON },
        unit: "相对日",
      },
    ],
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
        "用 T+1..T+5 的收盘和最低价判断守线 streak，并从 T+6 开盘计算后续收益。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/limit-up-price-hold-streak-study",
    pageTitle: "首板涨停价连续守线研究",
  },
  resultSchema: limitUpPriceHoldStreakSchema,
  run: async (context: ExperimentRunContext) => {
    const horizons = [...new Set(context.parameters.horizons as number[])].sort(
      (a, b) => a - b
    );
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

    const samples: HoldSample[] = [];
    let exactLimitUpCloseCount = 0;
    let contextCompleteCount = 0;
    let entryUnfillableCount = 0;

    for (const event of uniqueEvents) {
      const eventRow = eventDayByEvent.get(event.eventId);
      const eventClose = numberValue(eventRow?.values ?? {}, "close");
      const limitUpPrice = numberValue(event.values, "limitUpPrice");
      if (
        !eventRow ||
        eventClose === null ||
        limitUpPrice === null ||
        eventClose <= 0 ||
        limitUpPrice <= 0
      ) {
        addExclusion("MISSING_CONTEXT");
        continue;
      }
      if (Math.abs(eventClose - limitUpPrice) > 1e-9) {
        addExclusion("EVENT_NOT_EXACT_LIMIT_UP");
        continue;
      }
      exactLimitUpCloseCount += 1;
      const contextBars: Bar[] = [];
      let contextComplete = true;
      for (let day = 1; day <= CONTEXT_DAYS; day += 1) {
        const bar = parseBar(postByDay.get(day)?.get(event.eventId));
        if (!bar || !bar.barPresent || bar.suspended) {
          contextComplete = false;
          break;
        }
        contextBars.push(bar);
      }
      if (!contextComplete) {
        addExclusion("MISSING_CONTEXT");
        continue;
      }
      contextCompleteCount += 1;
      let closeHoldStreak = 0;
      for (const bar of contextBars) {
        if (bar.close < limitUpPrice - 1e-9) break;
        closeHoldStreak += 1;
      }
      let lowHoldStreak = 0;
      for (const bar of contextBars) {
        if (bar.low < limitUpPrice - 1e-9) break;
        lowHoldStreak += 1;
      }

      const entryBar = parseBar(postByDay.get(ENTRY_DAY)?.get(event.eventId));
      const entryOpen = numberValue(
        postByDay.get(ENTRY_DAY)?.get(event.eventId)?.values ?? {},
        "open"
      );
      if (
        !entryBar ||
        entryOpen === null ||
        entryOpen <= 0 ||
        !entryBar.barPresent ||
        entryBar.suspended ||
        !entryBar.canBuyAtOpen
      ) {
        entryUnfillableCount += 1;
        continue;
      }

      for (const horizon of horizons) {
        const exitBar = parseBar(postByDay.get(horizon)?.get(event.eventId));
        if (
          !exitBar ||
          !exitBar.barPresent ||
          exitBar.suspended ||
          !exitBar.canSellAtClose
        ) {
          continue;
        }
        let maxFavorable = -Infinity;
        let maxAdverse = Infinity;
        for (let day = ENTRY_DAY; day <= horizon; day += 1) {
          const bar = parseBar(postByDay.get(day)?.get(event.eventId));
          if (!bar || !bar.barPresent || bar.suspended) continue;
          maxFavorable = Math.max(maxFavorable, bar.high / entryOpen - 1);
          maxAdverse = Math.min(maxAdverse, bar.low / entryOpen - 1);
        }
        samples.push({
          eventId: event.eventId,
          eventDate: event.tradeDate,
          year: Number(event.tradeDate.slice(0, 4)),
          closeHoldStreak: closeHoldStreak as StreakValue,
          lowHoldStreak: lowHoldStreak as StreakValue,
          horizon,
          grossReturn: exitBar.close / entryOpen - 1,
          maxFavorableExcursion: maxFavorable,
          maxAdverseExcursion: maxAdverse,
        });
      }
    }

    const datasetEventCount = context.dataset.facts.totalEvents;
    const unscannedEventCount =
      datasetEventCount === null
        ? null
        : Math.max(0, datasetEventCount - uniqueEvents.length);
    context.log(
      `候选 ${uniqueEvents.length}；严格涨停 ${exactLimitUpCloseCount}；` +
        `上下文完整 ${contextCompleteCount}；T+6不可买 ${entryUnfillableCount}`
    );

    return assembleLimitUpPriceHoldStreak({
      samples,
      horizons,
      candidateCount: uniqueEvents.length,
      exactLimitUpCloseCount,
      contextCompleteCount,
      entryUnfillableCount,
      excludedByReason,
      datasetEventCount,
      unscannedEventCount,
      duplicateEventIdCount,
    });
  },
};

export default limitUpPriceHoldStreakStudyExperiment;
