import {
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  ENTRY_WINDOW_DAYS,
  EXIT_DAY,
  PATH_THRESHOLDS,
  PULLBACK_TRIGGER_BPS,
  ROUND_TRIP_COST_BPS,
  assembleDynamicEntryPathDistribution,
  dynamicEntryPathDistributionSchema,
  type PathTradeSample,
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

export const dynamicEntryPathDistributionStudyExperiment: ExperimentDefinition =
  {
    descriptor: {
      id: "first-board-pullback/dynamic-entry-path-distribution-study",
      name: "动态入场后每日路径分布研究",
      version: COMPUTATION_VERSION,
      description:
        "固定动态状态机入场和价格退出后，展开 T+1..T+10 每日路径、分位数、" +
        "MFE/MAE、首次触及 ±2%/±5% 的时间，以及退出原因差异。",
      source: "stock-limit-up-analyzer/first-board-pullback",
      tags: [
        "first-board-pullback",
        "path-distribution",
        "mfe",
        "mae",
        "dynamic-entry",
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
          "在固定状态机入场和退出后，研究每日路径分布、MFE/MAE 和阈值到达时间。",
        eventScanPolicy: "FULL_DATASET",
      },
      pageKey: "first-board-pullback/dynamic-entry-path-distribution-study",
      pageTitle: "动态入场后每日路径分布研究",
    },
    resultSchema: dynamicEntryPathDistributionSchema,
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

      interface EligibleEvent {
        event: ExperimentEventRow;
        eventOpen: number;
        eventClose: number;
        bars: Bar[];
      }
      const allEligible: EligibleEvent[] = [];
      let exactLimitUpCloseCount = 0;
      for (const event of uniqueEvents) {
        const eventRow = eventDayByEvent.get(event.eventId);
        const eventOpen = numberValue(eventRow?.values ?? {}, "open");
        const eventClose = numberValue(eventRow?.values ?? {}, "close");
        const limitUpPrice = numberValue(event.values, "limitUpPrice");
        if (
          !eventRow ||
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
        allEligible.push({ event, eventOpen, eventClose, bars });
      }

      const samples: PathTradeSample[] = [];
      let triggeredCount = 0;
      let entryUnfillableCount = 0;
      for (const item of allEligible) {
        let triggerDay: number | null = null;
        for (let day = 1; day <= ENTRY_WINDOW_DAYS; day += 1) {
          const bar = item.bars[day - 1]!;
          if (bar.close < item.eventOpen - 1e-9) break;
          if (
            bar.close <=
            item.eventClose * (1 - PULLBACK_TRIGGER_BPS / 10_000) + 1e-9
          ) {
            triggerDay = day;
            break;
          }
        }
        if (triggerDay === null) continue;
        triggeredCount += 1;
        const entryDay = triggerDay + 1;
        const entryBar = item.bars[entryDay - 1]!;
        if (!entryBar.canBuyAtOpen) {
          entryUnfillableCount += 1;
          continue;
        }

        let exitDay: number | null = null;
        let exitPrice: number | null = null;
        let exitReason: PathTradeSample["exitReason"] | null = null;
        for (let day = entryDay; day <= EXIT_DAY; day += 1) {
          const bar = item.bars[day - 1]!;
          if (bar.close < item.eventOpen - 1e-9) {
            for (let nextDay = day + 1; nextDay <= EXIT_DAY; nextDay += 1) {
              const nextBar = item.bars[nextDay - 1]!;
              if (nextBar.open > nextBar.limitDownPrice + 1e-9) {
                exitDay = nextDay;
                exitPrice = nextBar.open;
                exitReason = "PRICE_BREAK";
                break;
              }
            }
            if (exitDay === null) {
              exitDay = EXIT_DAY;
              exitPrice = item.bars[EXIT_DAY - 1]!.close;
              exitReason = "PRICE_BREAK";
            }
            break;
          }
          if (day === EXIT_DAY) {
            exitDay = day;
            exitPrice = bar.close;
            exitReason = "TIME_T10";
          }
        }
        if (exitDay === null || exitPrice === null || exitReason === null)
          continue;

        const marksByDay: Record<string, number> = {};
        for (let day = entryDay; day <= exitDay; day += 1) {
          marksByDay[String(day)] =
            day === exitDay
              ? exitPrice / entryBar.open - 1
              : item.bars[day - 1]!.close / entryBar.open - 1;
        }

        const cumulativeMfeByDay: Record<string, number> = {};
        const cumulativeMaeByDay: Record<string, number> = {};
        let maxFavorable = -Infinity;
        let maxAdverse = Infinity;
        let maxFavorableDay = entryDay;
        let maxAdverseDay = entryDay;
        for (let day = entryDay; day <= exitDay; day += 1) {
          const bar = item.bars[day - 1]!;
          const favorable =
            day === exitDay && exitReason === "PRICE_BREAK"
              ? exitPrice / entryBar.open - 1
              : bar.high / entryBar.open - 1;
          const adverse =
            day === exitDay && exitReason === "PRICE_BREAK"
              ? exitPrice / entryBar.open - 1
              : bar.low / entryBar.open - 1;
          if (favorable > maxFavorable) {
            maxFavorable = favorable;
            maxFavorableDay = day;
          }
          if (adverse < maxAdverse) {
            maxAdverse = adverse;
            maxAdverseDay = day;
          }
          cumulativeMfeByDay[String(day)] = maxFavorable;
          cumulativeMaeByDay[String(day)] = maxAdverse;
        }

        const firstReachByThreshold: Record<string, number | null> = {};
        for (const threshold of PATH_THRESHOLDS) {
          let reachDay: number | null = null;
          for (let day = entryDay; day <= exitDay; day += 1) {
            const mark = marksByDay[String(day)]!;
            if (
              (threshold > 0 && mark >= threshold) ||
              (threshold < 0 && mark <= threshold)
            ) {
              reachDay = day;
              break;
            }
          }
          firstReachByThreshold[String(threshold)] = reachDay;
        }

        samples.push({
          eventId: item.event.eventId,
          eventDate: item.event.tradeDate,
          year: Number(item.event.tradeDate.slice(0, 4)),
          entryDay,
          exitDay,
          exitReason,
          actualNetReturn:
            exitPrice / entryBar.open - 1 - ROUND_TRIP_COST_BPS / 10_000,
          maxFavorableExcursion: maxFavorable,
          maxAdverseExcursion: maxAdverse,
          maxFavorableDay,
          maxAdverseDay,
          marksByDay,
          cumulativeMfeByDay,
          cumulativeMaeByDay,
          firstReachByThreshold,
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

      return assembleDynamicEntryPathDistribution({
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

export default dynamicEntryPathDistributionStudyExperiment;
