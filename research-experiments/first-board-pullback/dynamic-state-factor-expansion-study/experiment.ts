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
  assembleDynamicStateFactorExpansion,
  dynamicStateFactorExpansionSchema,
  percentileRank,
  type FactorTradeSample,
} from "./result";

const POST_DAYS = Array.from({ length: EXIT_DAY }, (_, index) => index + 1);

interface Bar {
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  limitDownPrice: number;
  barPresent: boolean;
  suspended: boolean;
  canBuyAtOpen: boolean;
  canSellAtClose: boolean;
}

interface EventDayBar {
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
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
  const high = numberValue(row.values, "high");
  const low = numberValue(row.values, "low");
  const volume = numberValue(row.values, "volume");
  const amount = numberValue(row.values, "amount");
  const limitDownPrice = numberValue(row.values, "limitDownPrice");
  if (
    open === null ||
    close === null ||
    high === null ||
    low === null ||
    volume === null ||
    amount === null ||
    limitDownPrice === null ||
    open <= 0 ||
    close <= 0 ||
    high <= 0 ||
    low <= 0 ||
    volume <= 0 ||
    amount < 0 ||
    limitDownPrice <= 0
  ) {
    return null;
  }
  return {
    open,
    close,
    high,
    low,
    volume,
    amount,
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
  const high = numberValue(row.values, "high");
  const low = numberValue(row.values, "low");
  const volume = numberValue(row.values, "volume");
  const amount = numberValue(row.values, "amount");
  if (
    open === null ||
    close === null ||
    high === null ||
    low === null ||
    volume === null ||
    amount === null ||
    open <= 0 ||
    close <= 0 ||
    high <= 0 ||
    low <= 0 ||
    volume <= 0 ||
    amount < 0
  ) {
    return null;
  }
  return { open, close, high, low, volume, amount };
}

function sortEvents(
  left: ExperimentEventRow,
  right: ExperimentEventRow
): number {
  return left.tradeDate === right.tradeDate
    ? left.eventId.localeCompare(right.eventId)
    : left.tradeDate.localeCompare(right.tradeDate);
}

export const dynamicStateFactorExpansionStudyExperiment: ExperimentDefinition =
  {
    descriptor: {
      id: "first-board-pullback/dynamic-state-factor-expansion-study",
      name: "动态状态机扩展因子研究",
      version: COMPUTATION_VERSION,
      description:
        "固定动态状态机研究同日横截面分位、历史涨停次数、T+1 开盘缺口和 T+1 相对成交量。" +
        "因子不参与改变入场或退出规则，只用于解释动态交易收益。",
      source: "stock-limit-up-analyzer/first-board-pullback",
      tags: [
        "first-board-pullback",
        "cross-section",
        "historical-limit-count",
        "execution",
        "bootstrap",
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
            "turnover",
            "historicalLimitCount",
          ],
          feature: ["open", "high", "low", "close", "volume", "amount"],
          observation: [
            "open",
            "high",
            "low",
            "close",
            "volume",
            "amount",
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
          "在固定动态入场和价格退出后，研究同日横截面、历史涨停次数和 T+1 执行特征与收益的关系。",
        eventScanPolicy: "FULL_DATASET",
      },
      pageKey: "first-board-pullback/dynamic-state-factor-expansion-study",
      pageTitle: "动态状态机扩展因子研究",
    },
    resultSchema: dynamicStateFactorExpansionSchema,
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
        bars: Bar[];
        turnoverPercentile: number | null;
        amplitudePercentile: number | null;
        bodyPercentile: number | null;
        amountPercentile: number | null;
        historicalLimitCount: number;
      }
      const allEligible: EligibleEvent[] = [];
      let exactLimitUpCloseCount = 0;

      const peersByDate = new Map<
        string,
        Array<{
          eventId: string;
          turnover: number | null;
          amplitude: number;
          body: number;
          amount: number;
        }>
      >();
      for (const event of uniqueEvents) {
        const eventBar = parseEventDayBar(eventBarByEvent.get(event.eventId));
        const limitUpPrice = numberValue(event.values, "limitUpPrice");
        const turnover = numberValue(event.values, "turnover");
        const historicalLimitCount = numberValue(
          event.values,
          "historicalLimitCount"
        );
        if (
          !eventBar ||
          limitUpPrice === null ||
          turnover === null ||
          historicalLimitCount === null ||
          limitUpPrice <= 0
        ) {
          addExclusion("MISSING_PATH");
          continue;
        }
        if (Math.abs(eventBar.close - limitUpPrice) > 1e-9) {
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
        const amplitude = (eventBar.high - eventBar.low) / eventBar.close;
        const body = (eventBar.close - eventBar.open) / eventBar.close;
        const datePeers = peersByDate.get(event.tradeDate) ?? [];
        datePeers.push({
          eventId: event.eventId,
          turnover,
          amplitude,
          body,
          amount: eventBar.amount,
        });
        peersByDate.set(event.tradeDate, datePeers);
        allEligible.push({
          event,
          eventOpen: eventBar.open,
          eventClose: eventBar.close,
          eventVolume: eventBar.volume,
          bars,
          turnoverPercentile: null,
          amplitudePercentile: null,
          bodyPercentile: null,
          amountPercentile: null,
          historicalLimitCount,
        });
      }

      const eligibleByEvent = new Map(
        allEligible.map(item => [item.event.eventId, item] as const)
      );
      for (const peers of peersByDate.values()) {
        const turnoverPeers = peers
          .map(peer => peer.turnover)
          .filter((value): value is number => value !== null);
        const amplitudePeers = peers.map(peer => peer.amplitude);
        const bodyPeers = peers.map(peer => peer.body);
        const amountPeers = peers.map(peer => peer.amount);
        for (const peer of peers) {
          const target = eligibleByEvent.get(peer.eventId)!;
          target.turnoverPercentile =
            peer.turnover === null
              ? null
              : percentileRank(peer.turnover, turnoverPeers);
          target.amplitudePercentile = percentileRank(
            peer.amplitude,
            amplitudePeers
          );
          target.bodyPercentile = percentileRank(peer.body, bodyPeers);
          target.amountPercentile = percentileRank(peer.amount, amountPeers);
        }
      }

      const samples: FactorTradeSample[] = [];
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
        let exitPrice: number | null = null;
        for (let day = entryDay; day <= EXIT_DAY; day += 1) {
          const bar = item.bars[day - 1]!;
          if (bar.close < item.eventOpen - 1e-9) {
            for (let nextDay = day + 1; nextDay <= EXIT_DAY; nextDay += 1) {
              const nextBar = item.bars[nextDay - 1]!;
              if (nextBar.open > nextBar.limitDownPrice + 1e-9) {
                exitPrice = nextBar.open;
                break;
              }
            }
            if (exitPrice === null) exitPrice = item.bars[EXIT_DAY - 1]!.close;
            break;
          }
          if (day === EXIT_DAY) exitPrice = bar.close;
        }
        if (exitPrice === null) continue;
        const t1Bar = item.bars[0]!;
        samples.push({
          eventId: item.event.eventId,
          eventDate: item.event.tradeDate,
          year: Number(item.event.tradeDate.slice(0, 4)),
          entryDay,
          grossReturn: exitPrice / entryBar.open - 1,
          crossSection: {
            turnover_percentile: item.turnoverPercentile,
            amplitude_percentile: item.amplitudePercentile,
            body_percentile: item.bodyPercentile,
            amount_percentile: item.amountPercentile,
          },
          historicalLimitCount: item.historicalLimitCount,
          t1OpenGap: t1Bar.open / item.eventClose - 1,
          t1VolumeRatio: t1Bar.volume / item.eventVolume,
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

      return assembleDynamicStateFactorExpansion({
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

export default dynamicStateFactorExpansionStudyExperiment;
