import {
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  CONTEXT_DAYS,
  ENTRY_DAY,
  EXIT_DAY,
  ROUND_TRIP_COST_BPS,
  assembleHoldStreakAmplitudeT10,
  holdStreakAmplitudeT10Schema,
  type InteractionSample,
  type StreakValue,
} from "./result";

const POST_DAYS = Array.from({ length: EXIT_DAY }, (_, index) => index + 1);

interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
  preClose: number;
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
  const preClose = numberValue(row.values, "preClose");
  const limitDownPrice = numberValue(row.values, "limitDownPrice");
  if (
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    preClose === null ||
    limitDownPrice === null ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    preClose <= 0 ||
    limitDownPrice <= 0
  ) {
    return null;
  }
  return {
    open,
    high,
    low,
    close,
    preClose,
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

export const holdStreakAmplitudeT10StudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/hold-streak-amplitude-t10-study",
    name: "首板涨停价守线×振幅 T+6→T+10 研究",
    version: COMPUTATION_VERSION,
    description:
      "交叉研究 T+1..T+5 的守线 streak 与平均/最大振幅，固定 T+6 开盘入场、" +
      "T+10 收盘退出，输出收益分位数、MFE/MAE 与 ±2% 竞争规则。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "limit-up-price",
      "amplitude",
      "streak",
      "t10",
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
          "preClose",
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
        "T+1..T+5 计算守线和振幅，T+6 开盘入场并观察 T+10 收盘结果。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/hold-streak-amplitude-t10-study",
    pageTitle: "守线×振幅 T+6→T+10 研究",
  },
  resultSchema: holdStreakAmplitudeT10Schema,
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

    const samples: InteractionSample[] = [];
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
      const amplitudes = contextBars.map(
        bar => (bar.high - bar.low) / bar.preClose
      );
      const meanAmplitude =
        amplitudes.reduce((sum, value) => sum + value, 0) / amplitudes.length;
      const maxAmplitude = Math.max(...amplitudes);

      const forwardBars: Bar[] = [];
      let forwardComplete = true;
      for (let day = ENTRY_DAY; day <= EXIT_DAY; day += 1) {
        const bar = parseBar(postByDay.get(day)?.get(event.eventId));
        if (!bar || !bar.barPresent || bar.suspended) {
          forwardComplete = false;
          break;
        }
        forwardBars.push(bar);
      }
      if (!forwardComplete) continue;
      const entryBar = forwardBars[0]!;
      const entryOpen = entryBar.open;
      if (entryOpen <= 0 || !entryBar.canBuyAtOpen) {
        entryUnfillableCount += 1;
        continue;
      }
      const exitBar = forwardBars[forwardBars.length - 1]!;
      if (!exitBar.canSellAtClose) {
        continue;
      }

      let maxFavorable = -Infinity;
      let maxAdverse = Infinity;
      let positive2Day: number | null = null;
      let negative2Day: number | null = null;
      for (let day = ENTRY_DAY; day <= EXIT_DAY; day += 1) {
        const bar = forwardBars[day - ENTRY_DAY]!;
        maxFavorable = Math.max(maxFavorable, bar.high / entryOpen - 1);
        maxAdverse = Math.min(maxAdverse, bar.low / entryOpen - 1);
        const mark = bar.close / entryOpen - 1;
        if (positive2Day === null && mark >= 0.02) positive2Day = day;
        if (negative2Day === null && mark <= -0.02) negative2Day = day;
      }
      const positive2First =
        positive2Day !== null &&
        (negative2Day === null || positive2Day < negative2Day);
      const negative2First =
        negative2Day !== null &&
        (positive2Day === null || negative2Day < positive2Day);
      const bars = contextBars.concat(forwardBars);
      const exitAtDecision = (decisionDay: number | null): number => {
        if (decisionDay === null || decisionDay === EXIT_DAY) {
          return exitBar.close / entryOpen - 1;
        }
        const exit = nextSellableOpen(bars, decisionDay + 1);
        if (exit === null) return exitBar.close / entryOpen - 1;
        return exit.price / entryOpen - 1;
      };
      const take2GrossReturn = exitAtDecision(
        positive2First ? positive2Day : null
      );
      const stop2GrossReturn = exitAtDecision(
        negative2First ? negative2Day : null
      );
      const symmetricDecision =
        positive2Day === null && negative2Day === null
          ? null
          : positive2Day === null
            ? negative2Day
            : negative2Day === null
              ? positive2Day
              : Math.min(positive2Day, negative2Day);
      const symmetric2GrossReturn = exitAtDecision(symmetricDecision);

      samples.push({
        eventId: event.eventId,
        eventDate: event.tradeDate,
        year: Number(event.tradeDate.slice(0, 4)),
        closeHoldStreak: closeHoldStreak as StreakValue,
        lowHoldStreak: lowHoldStreak as StreakValue,
        meanAmplitude,
        maxAmplitude,
        grossReturn: exitBar.close / entryOpen - 1,
        maxFavorableExcursion: maxFavorable,
        maxAdverseExcursion: maxAdverse,
        positive2First,
        negative2First,
        take2GrossReturn,
        stop2GrossReturn,
        symmetric2GrossReturn,
      });
    }

    const datasetEventCount = context.dataset.facts.totalEvents;
    const unscannedEventCount =
      datasetEventCount === null
        ? null
        : Math.max(0, datasetEventCount - uniqueEvents.length);
    context.log(
      `候选 ${uniqueEvents.length}；严格涨停 ${exactLimitUpCloseCount}；` +
        `上下文完整 ${contextCompleteCount}；T+6不可买 ${entryUnfillableCount}；` +
        `样本 ${samples.length}`
    );

    return assembleHoldStreakAmplitudeT10({
      samples,
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

export default holdStreakAmplitudeT10StudyExperiment;
