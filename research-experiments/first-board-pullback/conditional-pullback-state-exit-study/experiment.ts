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
  assembleConditionalPullbackStateExitResult,
  conditionalPullbackStateExitCustomPayloadSchema,
  type BaselineSample,
  type DynamicTradeSample,
  type ExitReason,
  type FixedTradeSample,
} from "./result";

const POST_DAYS = Array.from({ length: EXIT_DAY }, (_, index) => index + 1);

interface Bar {
  open: number;
  close: number;
  preClose: number;
  limitUpPrice: number;
  limitDownPrice: number;
  barPresent: boolean;
  suspended: boolean;
  canBuyAtOpen: boolean;
  canSellAtClose: boolean;
}

interface EventDayBar {
  open: number;
  close: number;
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
  const close = numberValue(row.values, "close");
  const preClose = numberValue(row.values, "preClose");
  const limitUpPrice = numberValue(row.values, "limitUpPrice");
  const limitDownPrice = numberValue(row.values, "limitDownPrice");
  if (
    open === null ||
    close === null ||
    preClose === null ||
    limitUpPrice === null ||
    limitDownPrice === null ||
    open <= 0 ||
    close <= 0 ||
    preClose <= 0 ||
    limitUpPrice <= 0 ||
    limitDownPrice <= 0
  ) {
    return null;
  }
  return {
    open,
    close,
    preClose,
    limitUpPrice,
    limitDownPrice,
    barPresent: booleanValue(row.values, "barPresent", true),
    suspended: row.values.suspensionStatus === "SUSPENDED",
    canBuyAtOpen: booleanValue(row.values, "canBuyAtOpen", false),
    canSellAtClose: booleanValue(row.values, "canSellAtClose", false),
  };
}

function parseEventDayBar(
  row: ExperimentEventRow | undefined
): EventDayBar | null {
  if (!row) return null;
  const open = numberValue(row.values, "open");
  const close = numberValue(row.values, "close");
  if (open === null || close === null || open <= 0 || close <= 0) return null;
  return { open, close };
}

function sortEvents(
  left: ExperimentEventRow,
  right: ExperimentEventRow
): number {
  return left.tradeDate === right.tradeDate
    ? left.eventId.localeCompare(right.eventId)
    : left.tradeDate.localeCompare(right.tradeDate);
}

export const conditionalPullbackStateExitStudyExperiment: ExperimentDefinition =
  {
    descriptor: {
      id: "first-board-pullback/conditional-pullback-state-exit-study",
      name: "首板后条件入场与动态退出状态机研究",
      version: COMPUTATION_VERSION,
      description:
        "冻结规则：T+1..T+5 收盘首次回撤达到首板收盘下方 100bps，且未跌破首板开盘价，" +
        "次日开盘入场；买入后收盘跌破首板开盘价，则下一可卖开盘退出，否则 T+10 收盘退出。" +
        "同时与条件买入固定 T+10 退出和 T+1 固定基准比较。",
      source: "stock-limit-up-analyzer/first-board-pullback",
      tags: [
        "first-board-pullback",
        "conditional-entry",
        "state-exit",
        "bootstrap",
      ],
      parameters: [],
      datasetRequirement: {
        datasetCode: "first_limit_pullback",
        requiredColumns: {
          events: ["isFirstLimit", "boardType", "market", "limitUpPrice"],
          feature: ["open", "close"],
          observation: [
            "open",
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
        decisionOffsetDays: ENTRY_WINDOW_DAYS,
        usesForwardData: true,
        forwardDataPurpose:
          "在 T+1..T+5 条件入场后，使用 T+6..T+10 已发生收盘判断是否动态退出。",
        eventScanPolicy: "FULL_DATASET",
      },
      pageKey: "first-board-pullback/conditional-pullback-state-exit-study",
      pageTitle: "条件入场与动态退出状态机研究",
    },
    resultSchema: conditionalPullbackStateExitCustomPayloadSchema,
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
      const eligible: EligibleEvent[] = [];
      let exactLimitUpCloseCount = 0;
      let breakBeforeEntryCount = 0;
      let noTriggerCount = 0;
      let triggeredCount = 0;
      let entryUnfillableCount = 0;

      const dynamicTrades: DynamicTradeSample[] = [];
      const fixedTrades: FixedTradeSample[] = [];
      const baselineSamples: BaselineSample[] = [];
      const triggerAccounting = new Map<
        number,
        {
          triggerDay: number;
          triggeredCount: number;
          entryUnfillableCount: number;
          enteredCount: number;
          stopExitCount: number;
          timeExitCount: number;
        }
      >();
      for (let day = 1; day <= ENTRY_WINDOW_DAYS; day += 1) {
        triggerAccounting.set(day, {
          triggerDay: day,
          triggeredCount: 0,
          entryUnfillableCount: 0,
          enteredCount: 0,
          stopExitCount: 0,
          timeExitCount: 0,
        });
      }

      for (const event of uniqueEvents) {
        if (event.values.isFirstLimit !== true) {
          addExclusion("NOT_FIRST_LIMIT");
          continue;
        }
        const eventDay = parseEventDayBar(eventDayByEvent.get(event.eventId));
        const limitUpPrice = numberValue(event.values, "limitUpPrice");
        if (!eventDay || limitUpPrice === null || limitUpPrice <= 0) {
          addExclusion(
            eventDayByEvent.has(event.eventId)
              ? "INVALID_EVENT_DAY_OHLC"
              : "MISSING_EVENT_DAY_BAR"
          );
          continue;
        }
        const eventClose = eventDay.close;
        if (Math.abs(eventClose - limitUpPrice) > 1e-9) {
          addExclusion("EVENT_NOT_EXACT_LIMIT_UP");
          continue;
        }
        exactLimitUpCloseCount += 1;
        const bars: Bar[] = [];
        let pathComplete = true;
        for (let day = 1; day <= ENTRY_WINDOW_DAYS; day += 1) {
          const parsed = parseBar(postByDay.get(day)?.get(event.eventId));
          if (!parsed || !parsed.barPresent || parsed.suspended) {
            pathComplete = false;
            break;
          }
          bars.push(parsed);
        }
        if (!pathComplete) {
          addExclusion("MISSING_ENTRY_WINDOW_PATH");
          continue;
        }
        eligible.push({
          event,
          eventOpen: eventDay.open,
          eventClose,
          bars,
        });

        const firstBar = bars[0]!;
        const baselineExit = parseBar(
          postByDay.get(EXIT_DAY)?.get(event.eventId)
        );
        if (
          firstBar.canBuyAtOpen &&
          baselineExit &&
          baselineExit.barPresent &&
          !baselineExit.suspended &&
          baselineExit.canSellAtClose
        ) {
          baselineSamples.push({
            eventId: event.eventId,
            eventDate: event.tradeDate,
            year: Number(event.tradeDate.slice(0, 4)),
            grossReturn: baselineExit.close / firstBar.open - 1,
          });
        }
      }

      for (const item of eligible) {
        let triggerDay: number | null = null;
        let breakBeforeEntry = false;
        for (let day = 1; day <= ENTRY_WINDOW_DAYS; day += 1) {
          const bar = item.bars[day - 1]!;
          if (bar.close < item.eventOpen - 1e-9) {
            breakBeforeEntry = true;
            break;
          }
          if (
            bar.close <=
            item.eventClose * (1 - PULLBACK_TRIGGER_BPS / 10_000) + 1e-9
          ) {
            triggerDay = day;
            break;
          }
        }
        if (breakBeforeEntry) {
          breakBeforeEntryCount += 1;
          continue;
        }
        if (triggerDay === null) {
          noTriggerCount += 1;
          continue;
        }
        triggeredCount += 1;
        triggerAccounting.get(triggerDay)!.triggeredCount += 1;
        const entryDay = triggerDay + 1;
        const entryBar = parseBar(
          postByDay.get(entryDay)?.get(item.event.eventId)
        );
        if (
          !entryBar ||
          !entryBar.barPresent ||
          entryBar.suspended ||
          !entryBar.canBuyAtOpen
        ) {
          entryUnfillableCount += 1;
          triggerAccounting.get(triggerDay)!.entryUnfillableCount += 1;
          continue;
        }
        triggerAccounting.get(triggerDay)!.enteredCount += 1;
        const fixedExit = parseBar(
          postByDay.get(EXIT_DAY)?.get(item.event.eventId)
        );
        if (
          fixedExit &&
          fixedExit.barPresent &&
          !fixedExit.suspended &&
          fixedExit.canSellAtClose
        ) {
          fixedTrades.push({
            eventId: item.event.eventId,
            eventDate: item.event.tradeDate,
            year: Number(item.event.tradeDate.slice(0, 4)),
            triggerDay,
            entryDay,
            exitDay: EXIT_DAY,
            grossReturn: fixedExit.close / entryBar.open - 1,
          });
        }

        let exitDay: number | null = null;
        let exitPrice: number | null = null;
        let exitReason: ExitReason | null = null;
        for (let day = entryDay; day <= EXIT_DAY; day += 1) {
          const bar = parseBar(postByDay.get(day)?.get(item.event.eventId));
          if (!bar || !bar.barPresent || bar.suspended) continue;
          if (bar.close < item.eventOpen - 1e-9) {
            let foundNextOpen = false;
            for (let nextDay = day + 1; nextDay <= EXIT_DAY; nextDay += 1) {
              const nextBar = parseBar(
                postByDay.get(nextDay)?.get(item.event.eventId)
              );
              if (
                nextBar &&
                nextBar.barPresent &&
                !nextBar.suspended &&
                nextBar.open > nextBar.limitDownPrice + 1e-9
              ) {
                exitDay = nextDay;
                exitPrice = nextBar.open;
                exitReason = "STOP_NEXT_OPEN";
                foundNextOpen = true;
                break;
              }
            }
            if (!foundNextOpen) {
              const fallback = parseBar(
                postByDay.get(EXIT_DAY)?.get(item.event.eventId)
              );
              if (
                fallback &&
                fallback.barPresent &&
                !fallback.suspended &&
                fallback.canSellAtClose
              ) {
                exitDay = EXIT_DAY;
                exitPrice = fallback.close;
                exitReason = "STOP_FALLBACK_CLOSE";
              }
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
        dynamicTrades.push({
          eventId: item.event.eventId,
          eventDate: item.event.tradeDate,
          year: Number(item.event.tradeDate.slice(0, 4)),
          triggerDay,
          entryDay,
          exitDay,
          exitReason,
          holdingDays: exitDay - entryDay + 1,
          grossReturn: exitPrice / entryBar.open - 1,
        });
        const accounting = triggerAccounting.get(triggerDay)!;
        if (exitReason === "TIME_T10") accounting.timeExitCount += 1;
        else accounting.stopExitCount += 1;
      }

      const datasetEventCount = context.dataset.facts.totalEvents;
      const unscannedEventCount =
        datasetEventCount === null
          ? null
          : Math.max(0, datasetEventCount - uniqueEvents.length);
      context.log(
        `候选 ${uniqueEvents.length}；严格涨停 ${exactLimitUpCloseCount}；触发 ${triggeredCount}；` +
          `动态交易 ${dynamicTrades.length}；固定交易 ${fixedTrades.length}`
      );

      return assembleConditionalPullbackStateExitResult({
        dynamicTrades,
        fixedTrades,
        baselineSamples,
        candidateCount: uniqueEvents.length,
        eligibleCount: eligible.length,
        exactLimitUpCloseCount,
        breakBeforeEntryCount,
        noTriggerCount,
        triggeredCount,
        entryUnfillableCount,
        excludedByReason,
        datasetEventCount,
        unscannedEventCount,
        duplicateEventIdCount,
        triggerAccounting: [...triggerAccounting.values()],
      });
    },
  };

export default conditionalPullbackStateExitStudyExperiment;
