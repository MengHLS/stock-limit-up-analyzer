import {
  EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  CONTEXT_DAYS,
  DEFAULT_FORWARD_HORIZONS,
  ENTRY_DAY,
  MAX_FORWARD_HORIZON,
  assembleLimitUpCloseHoldResult,
  limitUpCloseContextOf,
  limitUpCloseHoldCustomPayloadSchema,
  type ForwardSample,
} from "./result";

const POST_DAYS = Array.from(
  { length: MAX_FORWARD_HORIZON },
  (_, index) => index + 1
);

interface EventDayBar {
  open: number;
  high: number;
  low: number;
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

function uniqueSortedIntegers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function parseEventDayBar(
  row: ExperimentEventRow | undefined
): EventDayBar | null {
  if (!row) return null;
  const open = numberValue(row.values, "open");
  const high = numberValue(row.values, "high");
  const low = numberValue(row.values, "low");
  const close = numberValue(row.values, "close");
  if (open === null || high === null || low === null || close === null)
    return null;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return null;
  if (high < low || high < open || high < close || low > open || low > close)
    return null;
  return { open, high, low, close };
}

function closeOf(row: ExperimentEventRow | undefined): number | null {
  if (!row) return null;
  const close = numberValue(row.values, "close");
  if (close === null || close <= 0) return null;
  if (!booleanValue(row.values, "barPresent", true)) return null;
  if (row.values.suspensionStatus === "SUSPENDED") return null;
  return close;
}

function openOf(row: ExperimentEventRow | undefined): number | null {
  if (!row) return null;
  const open = numberValue(row.values, "open");
  if (open === null || open <= 0) return null;
  return open;
}

function sortEventRows(
  left: ExperimentEventRow,
  right: ExperimentEventRow
): number {
  return left.tradeDate === right.tradeDate
    ? left.eventId.localeCompare(right.eventId)
    : left.tradeDate.localeCompare(right.tradeDate);
}

export const limitUpCloseHoldStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/limit-up-close-hold-study",
    name: "首板后收盘守涨停价研究",
    version: COMPUTATION_VERSION,
    description:
      "观察首板后 T+1..T+5 每日收盘价相对 T 日涨停价的最差位置；" +
      "T+5 收盘决策后从 T+6 开盘入场，研究 T+10/T+15/T+20 收益。" +
      "分组为收盘始终不低于涨停价、最多略微跌破、深度跌破；略微跌破阈值预先固定。" +
      "使用按交易日聚类的 Moving Block Bootstrap，不选择最优阈值。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "limit-up-price",
      "close-hold",
      "bootstrap",
      "independent-experiment",
    ],
    parameters: [
      {
        code: "slightBreachBps",
        label: "略微跌破阈值",
        description:
          "最低收盘相对 T 日涨停价的允许跌破幅度；等于该幅度归入略微跌破，超过则归入深度跌破。",
        kind: "NUMBER",
        required: false,
        defaultValue: 200,
        bounds: { min: 10, max: 1000 },
        unit: "bps",
      },
      {
        code: "forwardHorizons",
        label: "后续收益视界",
        description: `T+${ENTRY_DAY} 开盘入场后观察的 T+h 收盘视界，允许 ${ENTRY_DAY + 1}..${MAX_FORWARD_HORIZON}。`,
        kind: "INT_LIST",
        required: false,
        defaultValue: [...DEFAULT_FORWARD_HORIZONS],
        bounds: { min: ENTRY_DAY + 1, max: MAX_FORWARD_HORIZON },
        unit: "相对日",
      },
      {
        code: "maxEvents",
        label: "最大事件数",
        description: "按事件日 / eventId 排序后最多纳入多少个首板事件。",
        kind: "INT",
        required: false,
        defaultValue: EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
        bounds: { min: 1, max: EXPERIMENT_EVENT_SCAN_HARD_LIMIT },
        unit: "个事件",
      },
      {
        code: "roundTripCostBps",
        label: "往返成本",
        description: "从 T+6 开盘到退出收盘的收益中统一扣除。",
        kind: "NUMBER",
        required: false,
        defaultValue: 20,
        bounds: { min: 0, max: 200 },
        unit: "bps",
      },
      {
        code: "excludeOneWordLimitUp",
        label: "排除一字板首板",
        description:
          "首板日 O=H=L=C=limitUpPrice 时视为一字涨停；开启后该事件不计入 eligible。",
        kind: "BOOLEAN",
        required: false,
        defaultValue: true,
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
        events: ["isFirstLimit", "boardType", "market", "limitUpPrice"],
        feature: ["open", "high", "low", "close"],
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
        "使用 T+1..T+5 收盘位置定义样本分组，并从 T+6 开盘计算固定视界收益。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/limit-up-close-hold-study",
    pageTitle: "收盘守涨停价研究",
  },
  resultSchema: limitUpCloseHoldCustomPayloadSchema,
  run: async (context: ExperimentRunContext) => {
    const slightBreachBps = context.parameters.slightBreachBps as number;
    const forwardHorizons = uniqueSortedIntegers(
      context.parameters.forwardHorizons as number[]
    );
    const maxEvents = context.parameters.maxEvents as number;
    const costBps = context.parameters.roundTripCostBps as number;
    const excludeOneWordLimitUp = context.parameters
      .excludeOneWordLimitUp as boolean;
    const bootstrapIterations = context.parameters
      .bootstrapIterations as number;
    const bootstrapBlockDays = context.parameters.bootstrapBlockDays as number;
    const bootstrapSeed = 20_260_922;

    if (
      forwardHorizons.length === 0 ||
      forwardHorizons.some(day => day <= ENTRY_DAY || day > MAX_FORWARD_HORIZON)
    ) {
      throw new Error(
        `forwardHorizons 必须落在 ${ENTRY_DAY + 1}..${MAX_FORWARD_HORIZON}`
      );
    }

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
    const usedEvents = uniqueEvents.slice(0, maxEvents);
    const droppedByMaxEvents = uniqueEvents.length - usedEvents.length;
    context.freezeSelection(usedEvents.map(event => event.eventId));

    const eventDayBars = await context.dataset.feature(0);
    const eventDayByEvent = new Map(
      eventDayBars.map(bar => [bar.eventId, bar])
    );
    const postByDay = new Map<number, Map<string, ExperimentEventRow>>();
    let postRowsRead = 0;
    for (const day of POST_DAYS) {
      const rows = await context.dataset.observation(day);
      postRowsRead += rows.length;
      postByDay.set(day, new Map(rows.map(row => [row.eventId, row])));
    }

    const excludedByReason: Record<string, number> = {};
    const addExclusion = (code: string, count = 1): void => {
      if (count > 0)
        excludedByReason[code] = (excludedByReason[code] ?? 0) + count;
    };
    addExclusion("MAX_EVENTS_LIMIT", droppedByMaxEvents);

    const samples: ForwardSample[] = [];
    let eligibleCount = 0;
    let eventOneWordLimitUpCount = 0;
    let excludedOneWordLimitUpCount = 0;
    let atOrAboveCount = 0;
    let slightBreachCount = 0;
    let deepBreachCount = 0;
    let entryUnfillableCount = 0;

    for (const event of usedEvents) {
      const eventDayRow = eventDayByEvent.get(event.eventId);
      const eventDay = parseEventDayBar(eventDayRow);
      const eventLimitUpPrice = numberValue(event.values, "limitUpPrice");
      if (
        !eventDayRow ||
        eventDay === null ||
        eventLimitUpPrice === null ||
        eventLimitUpPrice <= 0
      ) {
        addExclusion(
          eventDayRow ? "INVALID_EVENT_DAY_OHLC" : "MISSING_EVENT_DAY_BAR"
        );
        continue;
      }

      const oneWordLimitUp = [
        eventDay.open,
        eventDay.high,
        eventDay.low,
        eventDay.close,
      ].every(value => Math.abs(value - eventLimitUpPrice) <= 1e-9);
      if (oneWordLimitUp) eventOneWordLimitUpCount += 1;
      if (excludeOneWordLimitUp && oneWordLimitUp) {
        excludedOneWordLimitUpCount += 1;
        addExclusion("EXCLUDED_ONE_WORD_LIMIT_UP");
        continue;
      }

      const closes: number[] = [];
      let contextPathComplete = true;
      let contextPathInvalid = false;
      for (let day = 1; day <= CONTEXT_DAYS; day += 1) {
        const row = postByDay.get(day)?.get(event.eventId);
        if (!row) {
          contextPathComplete = false;
          break;
        }
        const close = closeOf(row);
        if (close === null) {
          contextPathInvalid = true;
          break;
        }
        closes.push(close);
      }
      if (!contextPathComplete) {
        addExclusion("MISSING_CONTEXT_BAR");
        continue;
      }
      if (contextPathInvalid) {
        addExclusion("INVALID_CONTEXT_BAR");
        continue;
      }

      eligibleCount += 1;
      const worstClose = Math.min(...closes);
      const worstCloseVsLimitUp = worstClose / eventLimitUpPrice - 1;
      const closeContext = limitUpCloseContextOf(
        worstCloseVsLimitUp,
        slightBreachBps
      );
      if (closeContext === "AT_OR_ABOVE") atOrAboveCount += 1;
      else if (closeContext === "SLIGHT_BREACH") slightBreachCount += 1;
      else deepBreachCount += 1;

      const entryRow = postByDay.get(ENTRY_DAY)?.get(event.eventId);
      const entryOpen = openOf(entryRow);
      if (
        !entryRow ||
        entryOpen === null ||
        !booleanValue(entryRow.values, "barPresent", true) ||
        !booleanValue(entryRow.values, "canBuyAtOpen", true) ||
        entryRow.values.suspensionStatus === "SUSPENDED"
      ) {
        entryUnfillableCount += 1;
        continue;
      }

      for (const horizon of forwardHorizons) {
        const exitRow = postByDay.get(horizon)?.get(event.eventId);
        const exitClose = closeOf(exitRow);
        if (
          exitClose === null ||
          !exitRow ||
          !booleanValue(exitRow.values, "canSellAtClose", true)
        ) {
          continue;
        }
        samples.push({
          eventId: event.eventId,
          eventDate: event.tradeDate,
          year: Number(event.tradeDate.slice(0, 4)),
          context: closeContext,
          worstCloseVsLimitUp,
          horizon,
          grossReturn: exitClose / entryOpen - 1,
        });
      }
    }

    const datasetEventCount = context.dataset.facts.totalEvents;
    const unscannedEventCount =
      datasetEventCount === null
        ? null
        : Math.max(0, datasetEventCount - uniqueEvents.length);
    context.log(
      `候选 ${uniqueEvents.length}；eligible ${eligibleCount}；` +
        `未跌破 ${atOrAboveCount}；略微跌破 ${slightBreachCount}；深度跌破 ${deepBreachCount}；` +
        `T+${ENTRY_DAY} 不可买 ${entryUnfillableCount}；samples ${samples.length}`
    );

    return assembleLimitUpCloseHoldResult({
      slightBreachBps,
      forwardHorizons,
      costBps,
      bootstrapIterations,
      bootstrapBlockDays,
      bootstrapSeed,
      excludeOneWordLimitUp,
      samples,
      candidateCount: uniqueEvents.length,
      eligibleCount,
      excludedByReason,
      datasetEventCount,
      scannedRowCount: events.length,
      droppedByMaxEvents,
      droppedByScanLimit:
        unscannedEventCount !== null && unscannedEventCount > 0,
      unscannedEventCount,
      duplicateEventIdCount,
      eventOneWordLimitUpCount,
      excludedOneWordLimitUpCount,
      atOrAboveCount,
      slightBreachCount,
      deepBreachCount,
      entryUnfillableCount,
    });
  },
};

export default limitUpCloseHoldStudyExperiment;
