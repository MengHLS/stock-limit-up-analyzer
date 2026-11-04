import {
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  BODY_HEIGHT_MIN,
  COMPUTATION_VERSION,
  ENTRY_WINDOW_DAYS,
  EXIT_DAY,
  PULLBACK_TRIGGER_BPS,
  TURNOVER_MAX_PCT,
  VOLUME_RECOVERY_RATIO,
  assembleVolumeRecoveryFilteredValidation,
  volumeRecoveryFilteredValidationSchema,
  type TradeSample,
} from "./result";

const POST_DAYS = Array.from({ length: EXIT_DAY }, (_, index) => index + 1);

interface Bar {
  open: number;
  close: number;
  volume: number;
  limitDownPrice: number;
  barPresent: boolean;
  suspended: boolean;
  canBuyAtOpen: boolean;
  canSellAtClose: boolean;
}

interface EventBar {
  open: number;
  close: number;
  volume: number;
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
  const limitDownPrice = numberValue(row.values, "limitDownPrice");
  if (
    open === null ||
    close === null ||
    volume === null ||
    limitDownPrice === null ||
    open <= 0 ||
    close <= 0 ||
    volume <= 0 ||
    limitDownPrice <= 0
  ) {
    return null;
  }
  return {
    open,
    close,
    volume,
    limitDownPrice,
    barPresent: booleanValue(row.values, "barPresent", true),
    suspended: row.values.suspensionStatus === "SUSPENDED",
    canBuyAtOpen: booleanValue(row.values, "canBuyAtOpen", false),
    canSellAtClose: booleanValue(row.values, "canSellAtClose", false),
  };
}

function parseEventBar(row: ExperimentEventRow | undefined): EventBar | null {
  if (!row) return null;
  const open = numberValue(row.values, "open");
  const close = numberValue(row.values, "close");
  const volume = numberValue(row.values, "volume");
  if (
    open === null ||
    close === null ||
    volume === null ||
    open <= 0 ||
    close <= 0 ||
    volume <= 0
  ) {
    return null;
  }
  return { open, close, volume };
}

function sortEvents(
  left: ExperimentEventRow,
  right: ExperimentEventRow
): number {
  return left.tradeDate === right.tradeDate
    ? left.eventId.localeCompare(right.eventId)
    : left.tradeDate.localeCompare(right.tradeDate);
}

export const volumeRecoveryFilteredValidationExperiment: ExperimentDefinition =
  {
    descriptor: {
      id: "first-board-pullback/volume-recovery-filtered-validation",
      name: "成交量恢复与组合过滤验证",
      version: COMPUTATION_VERSION,
      description:
        "固定状态机入场；首板实体 >0.1%、首板换手率 <10%。买入后价格跌破首板开盘价，" +
        "或 T+1..T+5 最大成交量未恢复到 T日成交量 100%，则下一可卖开盘退出；" +
        "否则 T+10 收盘退出。与过滤后仅价格退出、未过滤成交量退出做配对比较。",
      source: "stock-limit-up-analyzer/first-board-pullback",
      tags: [
        "first-board-pullback",
        "volume-recovery",
        "body-height",
        "turnover",
        "temporal-validation",
      ],
      parameters: [],
      datasetRequirement: {
        datasetCode: "first_limit_pullback",
        requiredColumns: {
          events: [
            "isFirstLimit",
            "boardType",
            "market",
            "limitUpPrice",
            "previousClose",
            "turnover",
          ],
          feature: ["open", "close", "volume"],
          observation: [
            "open",
            "close",
            "volume",
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
          "在条件入场后，使用 T+1..T+5 成交量恢复状态和价格路径决定动态退出，并计算 T+10 前收益。",
        eventScanPolicy: "FULL_DATASET",
      },
      pageKey: "first-board-pullback/volume-recovery-filtered-validation",
      pageTitle: "成交量恢复与组合过滤验证",
    },
    resultSchema: volumeRecoveryFilteredValidationSchema,
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

      const eventBars = await context.dataset.feature(0);
      const eventBarByEvent = new Map(eventBars.map(bar => [bar.eventId, bar]));
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
        bodyHeight: number;
        turnover: number;
        bars: Bar[];
      }
      const allEligible: EligibleEvent[] = [];
      const filteredEligible: EligibleEvent[] = [];
      let exactLimitUpCloseCount = 0;
      let filterEligibleEventCount = 0;
      let triggeredCount = 0;
      let entryUnfillableCount = 0;
      const filteredPriceExitTrades: TradeSample[] = [];
      const allVolumeExitTrades: TradeSample[] = [];
      const filteredVolumeExitTrades: TradeSample[] = [];

      for (const event of uniqueEvents) {
        const eventBar = parseEventBar(eventBarByEvent.get(event.eventId));
        const limitUpPrice = numberValue(event.values, "limitUpPrice");
        const previousClose = numberValue(event.values, "previousClose");
        const turnover = numberValue(event.values, "turnover");
        if (
          !eventBar ||
          limitUpPrice === null ||
          previousClose === null ||
          turnover === null ||
          limitUpPrice <= 0 ||
          previousClose <= 0
        ) {
          addExclusion("MISSING_PATH");
          continue;
        }
        if (Math.abs(eventBar.close - limitUpPrice) > 1e-9) {
          addExclusion("EVENT_NOT_EXACT_LIMIT_UP");
          continue;
        }
        exactLimitUpCloseCount += 1;
        const bodyHeight = (eventBar.close - eventBar.open) / previousClose;
        const bars: Bar[] = [];
        let pathComplete = true;
        for (let day = 1; day <= EXIT_DAY; day += 1) {
          const bar = parsePostBar(postByDay.get(day)?.get(event.eventId));
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
        const eligibleEvent: EligibleEvent = {
          event,
          eventOpen: eventBar.open,
          eventClose: eventBar.close,
          eventVolume: eventBar.volume,
          bodyHeight,
          turnover,
          bars,
        };
        allEligible.push(eligibleEvent);
        if (bodyHeight > BODY_HEIGHT_MIN && turnover < TURNOVER_MAX_PCT) {
          filteredEligible.push(eligibleEvent);
          filterEligibleEventCount += 1;
        } else {
          addExclusion(
            bodyHeight <= BODY_HEIGHT_MIN
              ? "EVENT_FILTERED_BODY"
              : "EVENT_FILTERED_TURNOVER"
          );
        }
      }

      const buildTrade = (
        item: EligibleEvent,
        mode: "FILTERED_PRICE_EXIT" | "ALL_VOLUME_EXIT" | "FILTERED_VOLUME_EXIT"
      ): {
        triggered: boolean;
        entryFillable: boolean;
        trade: TradeSample | null;
      } => {
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
        if (triggerDay === null) {
          return { triggered: false, entryFillable: false, trade: null };
        }
        const entryDay = triggerDay + 1;
        const entryBar = item.bars[entryDay - 1]!;
        if (!entryBar.canBuyAtOpen) {
          return { triggered: true, entryFillable: false, trade: null };
        }

        let exitDay: number | null = null;
        let exitPrice: number | null = null;
        let exitReason: TradeSample["exitReason"] | null = null;
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
          if (mode !== "FILTERED_PRICE_EXIT" && day === 5) {
            const maxVolumeRatio = Math.max(
              ...item.bars.slice(0, 5).map(bar => bar.volume / item.eventVolume)
            );
            if (maxVolumeRatio < VOLUME_RECOVERY_RATIO) {
              for (let nextDay = 6; nextDay <= EXIT_DAY; nextDay += 1) {
                const nextBar = item.bars[nextDay - 1]!;
                if (nextBar.open > nextBar.limitDownPrice + 1e-9) {
                  exitDay = nextDay;
                  exitPrice = nextBar.open;
                  exitReason = "VOLUME_UNRECOVERED";
                  break;
                }
              }
              if (exitDay === null) {
                exitDay = EXIT_DAY;
                exitPrice = item.bars[EXIT_DAY - 1]!.close;
                exitReason = "VOLUME_UNRECOVERED";
              }
              break;
            }
          }
          if (day === EXIT_DAY) {
            exitDay = day;
            exitPrice = bar.close;
            exitReason = "TIME_T10";
          }
        }
        if (exitDay === null || exitPrice === null || exitReason === null) {
          return { triggered: true, entryFillable: true, trade: null };
        }
        return {
          triggered: true,
          entryFillable: true,
          trade: {
            eventId: item.event.eventId,
            eventDate: item.event.tradeDate,
            year: Number(item.event.tradeDate.slice(0, 4)),
            bodyHeight: item.bodyHeight,
            turnover: item.turnover,
            triggerDay,
            entryDay,
            exitDay,
            holdingDays: exitDay - entryDay + 1,
            exitReason,
            grossReturn: exitPrice / entryBar.open - 1,
          },
        };
      };

      for (const item of allEligible) {
        const allVolumeResult = buildTrade(item, "ALL_VOLUME_EXIT");
        if (allVolumeResult.trade)
          allVolumeExitTrades.push(allVolumeResult.trade);
      }
      for (const item of filteredEligible) {
        const filteredPriceResult = buildTrade(item, "FILTERED_PRICE_EXIT");
        if (filteredPriceResult.triggered) {
          triggeredCount += 1;
        }
        if (
          filteredPriceResult.triggered &&
          !filteredPriceResult.entryFillable
        ) {
          entryUnfillableCount += 1;
        }
        if (filteredPriceResult.trade)
          filteredPriceExitTrades.push(filteredPriceResult.trade);
        const filteredVolumeResult = buildTrade(item, "FILTERED_VOLUME_EXIT");
        if (filteredVolumeResult.trade) {
          filteredVolumeExitTrades.push(filteredVolumeResult.trade);
        }
      }

      context.log(
        `候选 ${uniqueEvents.length}；严格涨停 ${exactLimitUpCloseCount}；过滤后 ${filterEligibleEventCount}；` +
          `触发 ${triggeredCount}；过滤后量能退出 ${filteredVolumeExitTrades.length}`
      );

      return assembleVolumeRecoveryFilteredValidation({
        filteredPriceExitTrades,
        allVolumeExitTrades,
        filteredVolumeExitTrades,
        candidateCount: uniqueEvents.length,
        exactLimitUpCloseCount,
        filterEligibleEventCount,
        triggeredCount,
        entryUnfillableCount,
        excludedByReason,
        duplicateEventIdCount,
      });
    },
  };

export default volumeRecoveryFilteredValidationExperiment;
