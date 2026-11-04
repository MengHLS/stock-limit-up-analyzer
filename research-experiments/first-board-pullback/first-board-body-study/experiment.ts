import {
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  DEFAULT_FORWARD_HORIZONS,
  ENTRY_DAY,
  MAX_FORWARD_HORIZON,
  assembleFirstBoardBodyResult,
  firstBoardBodyCustomPayloadSchema,
  type BodySample,
} from "./result";

const POST_DAYS = Array.from(
  { length: MAX_FORWARD_HORIZON },
  (_, index) => index + 1
);

interface EventBar {
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  limitUpPrice: number;
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

function parseEventBar(
  bar: ExperimentEventRow | undefined,
  event: ExperimentEventRow
): EventBar | null {
  if (!bar) return null;
  const open = numberValue(bar.values, "open");
  const high = numberValue(bar.values, "high");
  const low = numberValue(bar.values, "low");
  const close = numberValue(bar.values, "close");
  const previousClose = numberValue(event.values, "previousClose");
  const limitUpPrice = numberValue(event.values, "limitUpPrice");
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
    high < low ||
    high < open ||
    high < close ||
    low > open ||
    low > close
  ) {
    return null;
  }
  return { open, high, low, close, previousClose, limitUpPrice };
}

function sortEvents(
  left: ExperimentEventRow,
  right: ExperimentEventRow
): number {
  return left.tradeDate === right.tradeDate
    ? left.eventId.localeCompare(right.eventId)
    : left.tradeDate.localeCompare(right.tradeDate);
}

export const firstBoardBodyStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/first-board-body-study",
    name: "首板实体柱高度与未来收益研究",
    version: COMPUTATION_VERSION,
    description:
      "研究首板日实体高度 (close-open)/previousClose 与 T+1 开盘入场后 " +
      "T+5/T+10/T+20 收益的关系。只保留收盘价严格等于交易所口径涨停价的事件，" +
      "使用日期聚类 Bootstrap；不选择最优实体区间。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "body-height", "candlestick", "bootstrap"],
    parameters: [
      {
        code: "forwardHorizons",
        label: "后续收益视界",
        description: `T+${ENTRY_DAY} 开盘入场后的 T+h 收盘视界，允许 2..${MAX_FORWARD_HORIZON}。`,
        kind: "INT_LIST",
        required: false,
        defaultValue: [...DEFAULT_FORWARD_HORIZONS],
        bounds: { min: ENTRY_DAY + 1, max: MAX_FORWARD_HORIZON },
        unit: "相对日",
      },
      {
        code: "roundTripCostBps",
        label: "往返成本",
        description: "从 T+1 开盘到退出收盘的收益中统一扣除。",
        kind: "NUMBER",
        required: false,
        defaultValue: 20,
        bounds: { min: 0, max: 200 },
        unit: "bps",
      },
      {
        code: "bootstrapIterations",
        label: "Bootstrap 次数",
        description: "日期聚类 Moving Block Bootstrap 重采样次数。",
        kind: "INT",
        required: false,
        defaultValue: 1000,
        bounds: { min: 100, max: 5000 },
        unit: "次",
      },
      {
        code: "bootstrapBlockDays",
        label: "Bootstrap block 长度",
        description: "连续重采样日期数；应至少覆盖最大收益窗口。",
        kind: "INT",
        required: false,
        defaultValue: 20,
        bounds: { min: 5, max: 60 },
        unit: "交易日",
      },
    ],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: {
        events: [
          "isFirstLimit",
          "boardType",
          "market",
          "previousClose",
          "limitUpPrice",
        ],
        feature: ["open", "high", "low", "close"],
        observation: [
          "open",
          "close",
          "barPresent",
          "suspensionStatus",
          "canBuyAtOpen",
          "canSellAtClose",
        ],
      },
      prefixRelativeDays: [0],
      postRelativeDays: POST_DAYS,
      decisionOffsetDays: null,
      usesForwardData: true,
      forwardDataPurpose:
        "首板日实体高度只使用 rd=0 数据；T+1 开盘后计算固定视界收益。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/first-board-body-study",
    pageTitle: "首板实体柱高度研究",
  },
  resultSchema: firstBoardBodyCustomPayloadSchema,
  run: async (context: ExperimentRunContext) => {
    const forwardHorizons = [
      ...new Set(context.parameters.forwardHorizons as number[]),
    ].sort((a, b) => a - b);
    const costBps = context.parameters.roundTripCostBps as number;
    const bootstrapIterations = context.parameters
      .bootstrapIterations as number;
    const bootstrapBlockDays = context.parameters.bootstrapBlockDays as number;
    const bootstrapSeed = 20_260_922;

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
      bar: EventBar;
      bodyHeight: number;
      bodyRangeRatio: number | null;
      gap: number;
      oneWordLimitUp: boolean;
    }
    const eligible: EligibleEvent[] = [];
    let exactLimitUpCloseCount = 0;
    let oneWordLimitUpCount = 0;

    for (const event of uniqueEvents) {
      if (event.values.isFirstLimit !== true) {
        addExclusion("NOT_FIRST_LIMIT");
        continue;
      }
      const bar = parseEventBar(eventDayByEvent.get(event.eventId), event);
      if (!bar) {
        addExclusion(
          eventDayByEvent.has(event.eventId)
            ? "INVALID_EVENT_DAY_OHLC"
            : "MISSING_EVENT_DAY_BAR"
        );
        continue;
      }
      if (Math.abs(bar.close - bar.limitUpPrice) > 1e-9) {
        addExclusion("EVENT_NOT_EXACT_LIMIT_UP");
        continue;
      }
      exactLimitUpCloseCount += 1;
      const bodyHeight = (bar.close - bar.open) / bar.previousClose;
      const bodyRangeRatio =
        bar.high > bar.low
          ? (bar.close - bar.open) / (bar.high - bar.low)
          : null;
      const gap = bar.open / bar.previousClose - 1;
      const oneWordLimitUp =
        bar.close === bar.open &&
        bar.close === bar.high &&
        bar.close === bar.low;
      if (oneWordLimitUp) oneWordLimitUpCount += 1;
      eligible.push({
        event,
        bar,
        bodyHeight,
        bodyRangeRatio,
        gap,
        oneWordLimitUp,
      });
    }

    const samples: BodySample[] = [];
    let entryUnfillableCount = 0;
    for (const item of eligible) {
      const entryRow = postByDay.get(ENTRY_DAY)?.get(item.event.eventId);
      const entryOpen = entryRow ? numberValue(entryRow.values, "open") : null;
      if (
        !entryRow ||
        entryOpen === null ||
        entryOpen <= 0 ||
        !booleanValue(entryRow.values, "barPresent", true) ||
        !booleanValue(entryRow.values, "canBuyAtOpen", false) ||
        entryRow.values.suspensionStatus === "SUSPENDED"
      ) {
        entryUnfillableCount += 1;
        continue;
      }
      for (const horizon of forwardHorizons) {
        const exitRow = postByDay.get(horizon)?.get(item.event.eventId);
        const exitClose = exitRow ? numberValue(exitRow.values, "close") : null;
        if (
          !exitRow ||
          exitClose === null ||
          exitClose <= 0 ||
          !booleanValue(exitRow.values, "barPresent", true) ||
          !booleanValue(exitRow.values, "canSellAtClose", false) ||
          exitRow.values.suspensionStatus === "SUSPENDED"
        ) {
          continue;
        }
        samples.push({
          eventId: item.event.eventId,
          eventDate: item.event.tradeDate,
          year: Number(item.event.tradeDate.slice(0, 4)),
          bodyHeight: item.bodyHeight,
          bodyRangeRatio: item.bodyRangeRatio,
          gap: item.gap,
          oneWordLimitUp: item.oneWordLimitUp,
          horizon,
          netReturn: exitClose / entryOpen - 1,
        });
      }
    }

    const datasetEventCount = context.dataset.facts.totalEvents;
    const unscannedEventCount =
      datasetEventCount === null
        ? null
        : Math.max(0, datasetEventCount - uniqueEvents.length);
    context.log(
      `候选 ${uniqueEvents.length}；严格涨停 ${exactLimitUpCloseCount}；一字 ${oneWordLimitUpCount}；` +
        `T+${ENTRY_DAY} 不可买 ${entryUnfillableCount}；samples ${samples.length}`
    );

    return assembleFirstBoardBodyResult({
      forwardHorizons,
      costBps,
      bootstrapIterations,
      bootstrapBlockDays,
      bootstrapSeed,
      samples,
      candidateCount: uniqueEvents.length,
      eligibleCount: eligible.length,
      exactLimitUpCloseCount,
      oneWordLimitUpCount,
      entryUnfillableCount,
      excludedByReason,
      datasetEventCount,
      unscannedEventCount,
      duplicateEventIdCount,
    });
  },
};

export default firstBoardBodyStudyExperiment;
