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
  assembleVolumeRelationshipResult,
  volumeRelationshipCustomPayloadSchema,
  type VolumeTradeSample,
} from "./result";

const PRE_DAYS = [-10, -5, -2, -1, 0] as const;
const POST_DAYS = Array.from({ length: EXIT_DAY }, (_, index) => index + 1);

interface Bar {
  open: number;
  close: number;
  volume: number;
  limitUpPrice: number;
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

function parsePostBar(row: ExperimentEventRow | undefined): Bar | null {
  if (!row) return null;
  const open = numberValue(row.values, "open");
  const close = numberValue(row.values, "close");
  const volume = numberValue(row.values, "volume");
  const limitUpPrice = numberValue(row.values, "limitUpPrice");
  const limitDownPrice = numberValue(row.values, "limitDownPrice");
  if (
    open === null ||
    close === null ||
    volume === null ||
    limitUpPrice === null ||
    limitDownPrice === null ||
    open <= 0 ||
    close <= 0 ||
    volume <= 0 ||
    limitUpPrice <= 0 ||
    limitDownPrice <= 0
  ) {
    return null;
  }
  return {
    open,
    close,
    volume,
    limitUpPrice,
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

export const volumeRelationshipDynamicEntryStudyExperiment: ExperimentDefinition =
  {
    descriptor: {
      id: "first-board-pullback/volume-relationship-dynamic-entry-study",
      name: "首板前后成交量关系与动态入场研究",
      version: COMPUTATION_VERSION,
      description:
        "使用固定状态机：T+1..T+5 首次回撤且未破首板开盘价后次日开盘入场，" +
        "跌破首板开盘价则动态退出。研究 T-n/T、触发日/T、T+N/T 成交量关系" +
        "与动态交易净收益的关系，不让成交量反向选择入场日。",
      source: "stock-limit-up-analyzer/first-board-pullback",
      tags: [
        "first-board-pullback",
        "volume-ratio",
        "dynamic-entry",
        "bootstrap",
      ],
      parameters: [],
      datasetRequirement: {
        datasetCode: "first_limit_pullback",
        requiredColumns: {
          events: ["isFirstLimit", "boardType", "market", "limitUpPrice"],
          feature: ["open", "close", "volume"],
          observation: [
            "open",
            "close",
            "volume",
            "limitUpPrice",
            "limitDownPrice",
            "barPresent",
            "suspensionStatus",
            "canBuyAtOpen",
            "canSellAtClose",
          ],
        },
        prefixRelativeDays: [...PRE_DAYS],
        postRelativeDays: POST_DAYS,
        decisionOffsetDays: ENTRY_WINDOW_DAYS,
        usesForwardData: true,
        forwardDataPurpose:
          "在固定状态机入场和动态退出后，研究事件前后成交量相对 T日成交量的关系。",
        eventScanPolicy: "FULL_DATASET",
      },
      pageKey: "first-board-pullback/volume-relationship-dynamic-entry-study",
      pageTitle: "成交量关系与动态入场研究",
    },
    resultSchema: volumeRelationshipCustomPayloadSchema,
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

      const preByDay = new Map<number, Map<string, ExperimentEventRow>>();
      for (const day of PRE_DAYS) {
        const rows = await context.dataset.feature(day);
        preByDay.set(day, new Map(rows.map(row => [row.eventId, row])));
      }
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
        eventVolume: number;
        preVolumeRatios: Record<string, number | null>;
        bars: Bar[];
      }
      const eligible: EligibleEvent[] = [];
      let exactLimitUpCloseCount = 0;
      let triggeredCount = 0;
      let entryUnfillableCount = 0;
      const trades: VolumeTradeSample[] = [];

      for (const event of uniqueEvents) {
        if (event.values.isFirstLimit !== true) {
          addExclusion("NOT_FIRST_LIMIT");
          continue;
        }
        const eventOpen = numberValue(
          preByDay.get(0)?.get(event.eventId)?.values ?? {},
          "open"
        );
        const eventClose = numberValue(
          preByDay.get(0)?.get(event.eventId)?.values ?? {},
          "close"
        );
        const eventVolume = numberValue(
          preByDay.get(0)?.get(event.eventId)?.values ?? {},
          "volume"
        );
        const limitUpPrice = numberValue(event.values, "limitUpPrice");
        if (
          eventOpen === null ||
          eventClose === null ||
          eventVolume === null ||
          limitUpPrice === null ||
          eventOpen <= 0 ||
          eventClose <= 0 ||
          eventVolume <= 0 ||
          limitUpPrice <= 0
        ) {
          addExclusion(
            preByDay.get(0)?.has(event.eventId)
              ? "INVALID_EVENT_DAY_OHLC"
              : "MISSING_EVENT_DAY_BAR"
          );
          continue;
        }
        if (Math.abs(eventClose - limitUpPrice) > 1e-9) {
          addExclusion("EVENT_NOT_EXACT_LIMIT_UP");
          continue;
        }
        exactLimitUpCloseCount += 1;

        const preVolumeRatios: Record<string, number | null> = {};
        for (const day of [-1, -2, -5, -10] as const) {
          const volume = numberValue(
            preByDay.get(day)?.get(event.eventId)?.values ?? {},
            "volume"
          );
          preVolumeRatios[String(day)] =
            volume === null ? null : volume / eventVolume;
        }

        const bars: Bar[] = [];
        let pathComplete = true;
        for (let day = 1; day <= ENTRY_WINDOW_DAYS; day += 1) {
          const parsed = parsePostBar(postByDay.get(day)?.get(event.eventId));
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
          eventOpen,
          eventClose,
          eventVolume,
          preVolumeRatios,
          bars,
        });

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
        const entryBar = parsePostBar(
          postByDay.get(entryDay)?.get(event.eventId)
        );
        if (
          !entryBar ||
          !entryBar.barPresent ||
          entryBar.suspended ||
          !entryBar.canBuyAtOpen
        ) {
          entryUnfillableCount += 1;
          continue;
        }

        let exitDay: number | null = null;
        let exitPrice: number | null = null;
        for (let day = entryDay; day <= EXIT_DAY; day += 1) {
          const bar = parsePostBar(postByDay.get(day)?.get(event.eventId));
          if (!bar || !bar.barPresent || bar.suspended) continue;
          if (bar.close < eventOpen - 1e-9) {
            for (let nextDay = day + 1; nextDay <= EXIT_DAY; nextDay += 1) {
              const nextBar = parsePostBar(
                postByDay.get(nextDay)?.get(event.eventId)
              );
              if (
                nextBar &&
                nextBar.barPresent &&
                !nextBar.suspended &&
                nextBar.open > nextBar.limitDownPrice + 1e-9
              ) {
                exitDay = nextDay;
                exitPrice = nextBar.open;
                break;
              }
            }
            if (exitDay === null) {
              const fallback = parsePostBar(
                postByDay.get(EXIT_DAY)?.get(event.eventId)
              );
              if (
                fallback &&
                fallback.barPresent &&
                !fallback.suspended &&
                fallback.canSellAtClose
              ) {
                exitDay = EXIT_DAY;
                exitPrice = fallback.close;
              }
            }
            break;
          }
          if (day === EXIT_DAY) {
            exitDay = day;
            exitPrice = bar.close;
          }
        }
        if (exitDay === null || exitPrice === null) continue;

        const triggerVolume = bars[triggerDay - 1]!.volume;
        const triggerVolumeRatio = triggerVolume / eventVolume;
        const entryWindowVolumes = bars
          .slice(0, triggerDay)
          .map(bar => bar.volume)
          .filter(volume => volume > 0);
        const entryWindowVolumeRatio =
          entryWindowVolumes.length === 0
            ? null
            : mean(entryWindowVolumes) / eventVolume;
        const postVolumeRatios: Record<string, number | null> = {};
        for (let day = 1; day <= 5; day += 1) {
          const bar = parsePostBar(postByDay.get(day)?.get(event.eventId));
          postVolumeRatios[String(day)] =
            bar && bar.volume > 0 ? bar.volume / eventVolume : null;
        }

        trades.push({
          eventId: event.eventId,
          eventDate: event.tradeDate,
          year: Number(event.tradeDate.slice(0, 4)),
          triggerDay,
          entryDay,
          exitDay,
          holdingDays: exitDay - entryDay + 1,
          netReturn: exitPrice / entryBar.open - 1,
          eventVolume,
          preVolumeRatios,
          triggerVolumeRatio,
          entryWindowVolumeRatio,
          postVolumeRatios,
        });
      }

      const datasetEventCount = context.dataset.facts.totalEvents;
      const unscannedEventCount =
        datasetEventCount === null
          ? null
          : Math.max(0, datasetEventCount - uniqueEvents.length);
      context.log(
        `候选 ${uniqueEvents.length}；eligible ${eligible.length}；触发 ${triggeredCount}；` +
          `动态交易 ${trades.length}；T+1 不可买 ${entryUnfillableCount}`
      );

      return assembleVolumeRelationshipResult({
        samples: trades,
        candidateCount: uniqueEvents.length,
        eligibleCount: eligible.length,
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

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export default volumeRelationshipDynamicEntryStudyExperiment;
