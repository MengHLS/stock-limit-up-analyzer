import {
  EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  DEFAULT_FORWARD_HORIZONS,
  DEFAULT_PRE_RETURN_WINDOWS,
  MAX_FORWARD_HORIZON,
  MAX_PREFIX_DAYS,
  assemblePreEventContextResult,
  gapGroupOf,
  preEventContextCustomPayloadSchema,
  type ForwardSample,
  type PreEventSample,
} from "./result";

const PREFIX_DAYS = Array.from({ length: MAX_PREFIX_DAYS + 1 }, (_, index) => -index);
const POST_DAYS = Array.from({ length: MAX_FORWARD_HORIZON }, (_, index) => index + 1);

function numberValue(
  values: Readonly<Record<string, number | boolean | string | null>>,
  key: string,
): number | null {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(
  values: Readonly<Record<string, number | boolean | string | null>>,
  key: string,
  fallback: boolean,
): boolean {
  const value = values[key];
  return typeof value === "boolean" ? value : fallback;
}

function uniqueSortedIntegers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function sortEventRows(left: ExperimentEventRow, right: ExperimentEventRow): number {
  return left.tradeDate === right.tradeDate
    ? left.eventId.localeCompare(right.eventId)
    : left.tradeDate.localeCompare(right.tradeDate);
}

export const preEventContextStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/pre-event-context-study",
    name: "首板前空窗期与前期涨幅研究",
    version: COMPUTATION_VERSION,
    description:
      "研究首板 T 日前距上一次涨停的间隔，以及 T-1 收盘相对 T-n 收盘的前期涨幅，" +
      "观察它们与 T+1 开盘到 T+5/T+10/T+20 收盘收益之间的关系。" +
      "不包含 T 日涨停本身，不输出最优间隔、最优涨幅阈值或策略。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "pre-event-context", "gap-days", "pre-return"],
    parameters: [
      {
        code: "preReturnWindows",
        label: "前期涨幅窗口",
        description: `计算 close(T-1) / close(T-n) - 1 的 n 集合，允许 1..${MAX_PREFIX_DAYS}。`,
        kind: "INT_LIST",
        required: false,
        defaultValue: [...DEFAULT_PRE_RETURN_WINDOWS],
        bounds: { min: 1, max: MAX_PREFIX_DAYS },
        unit: "交易日",
      },
      {
        code: "forwardHorizons",
        label: "后续收益视界",
        description: `T+1 开盘入场后观察的 T+h 收盘视界，允许 2..${MAX_FORWARD_HORIZON}。`,
        kind: "INT_LIST",
        required: false,
        defaultValue: [...DEFAULT_FORWARD_HORIZONS],
        bounds: { min: 2, max: MAX_FORWARD_HORIZON },
        unit: "相对日",
      },
      {
        code: "primaryInteractionWindow",
        label: "主交互前期窗口",
        description: "用于“涨停间隔 × 前期涨幅”联合分组的单一窗口。",
        kind: "INT",
        required: false,
        defaultValue: 10,
        bounds: { min: 1, max: MAX_PREFIX_DAYS },
        unit: "交易日",
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
        description: "从 T+1 开盘到后续退出收盘的收益中统一扣除。",
        kind: "NUMBER",
        required: false,
        defaultValue: 20,
        bounds: { min: 0, max: 200 },
        unit: "bps",
      },
    ],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: {
        events: [
          "isFirstLimit",
          "boardType",
          "market",
          "daysSincePreviousLimit",
          "historicalLimitCount",
        ],
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
      prefixRelativeDays: PREFIX_DAYS,
      postRelativeDays: POST_DAYS,
      decisionOffsetDays: 1,
      usesForwardData: true,
      forwardDataPurpose:
        "计算 T+1 开盘入场到 T+h 收盘的收益，以观察首板前上下文是否与后续表现相关。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/pre-event-context-study",
    pageTitle: "首板前空窗期与涨幅研究",
  },
  resultSchema: preEventContextCustomPayloadSchema,
  run: async (context: ExperimentRunContext) => {
    const preReturnWindows = uniqueSortedIntegers(context.parameters.preReturnWindows as number[]);
    const forwardHorizons = uniqueSortedIntegers(context.parameters.forwardHorizons as number[]);
    const primaryInteractionWindow = context.parameters.primaryInteractionWindow as number;
    const maxEvents = context.parameters.maxEvents as number;
    const costBps = context.parameters.roundTripCostBps as number;

    if (preReturnWindows.length === 0 || preReturnWindows.some((day) => day > MAX_PREFIX_DAYS)) {
      throw new Error(`preReturnWindows 必须落在 1..${MAX_PREFIX_DAYS}`);
    }
    if (forwardHorizons.length === 0 || forwardHorizons.some((day) => day > MAX_FORWARD_HORIZON)) {
      throw new Error(`forwardHorizons 必须落在 1..${MAX_FORWARD_HORIZON}`);
    }
    if (!preReturnWindows.includes(primaryInteractionWindow)) {
      throw new Error("primaryInteractionWindow 必须包含在 preReturnWindows 中");
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
    context.freezeSelection(usedEvents.map((event) => event.eventId));

    const eventDayBars = await context.dataset.feature(0);
    const eventDayByEvent = new Map(eventDayBars.map((bar) => [bar.eventId, bar]));
    const prefixByDay = new Map<number, Map<string, ExperimentEventRow>>();
    for (const day of PREFIX_DAYS) {
      if (day === 0) continue;
      const rows = await context.dataset.feature(day);
      prefixByDay.set(day, new Map(rows.map((row) => [row.eventId, row])));
    }
    const postByDay = new Map<number, Map<string, ExperimentEventRow>>();
    let forwardDataRowsRead = 0;
    for (const day of POST_DAYS) {
      const rows = await context.dataset.observation(day);
      forwardDataRowsRead += rows.length;
      postByDay.set(day, new Map(rows.map((row) => [row.eventId, row])));
    }

    const excludedByReason: Record<string, number> = {};
    const addExclusion = (code: string, count = 1): void => {
      if (count > 0) excludedByReason[code] = (excludedByReason[code] ?? 0) + count;
    };
    addExclusion("MAX_EVENTS_LIMIT", droppedByMaxEvents);

    const preEventSamples: PreEventSample[] = [];
    const forwardSamples: ForwardSample[] = [];
    let gapKnownCount = 0;
    let gapUnknownCount = 0;
    let missingPrefixCount = 0;
    let invalidEventDayCount = 0;
    let missingEventDayCount = 0;

    for (const event of usedEvents) {
      const eventDayRow = eventDayByEvent.get(event.eventId);
      if (!eventDayRow) {
        missingEventDayCount += 1;
        addExclusion("MISSING_EVENT_DAY_BAR");
        continue;
      }
      const eventOpen = numberValue(eventDayRow.values, "open");
      const eventHigh = numberValue(eventDayRow.values, "high");
      const eventLow = numberValue(eventDayRow.values, "low");
      const eventClose = numberValue(eventDayRow.values, "close");
      if (
        eventOpen === null ||
        eventHigh === null ||
        eventLow === null ||
        eventClose === null ||
        eventOpen <= 0 ||
        eventHigh < eventLow ||
        eventHigh < eventOpen ||
        eventHigh < eventClose ||
        eventLow > eventOpen ||
        eventLow > eventClose
      ) {
        invalidEventDayCount += 1;
        addExclusion("INVALID_EVENT_DAY_OHLC");
        continue;
      }
      const prevDay = prefixByDay.get(-1)?.get(event.eventId);
      const prevClose = prevDay ? numberValue(prevDay.values, "close") : null;
      const preReturns: Record<number, number | null> = {};
      let complete = prevClose !== null && prevClose > 0;
      for (const window of preReturnWindows) {
        const baseRow = prefixByDay.get(-window)?.get(event.eventId);
        const baseClose = baseRow ? numberValue(baseRow.values, "close") : null;
        preReturns[window] =
          prevClose !== null && prevClose > 0 && baseClose !== null && baseClose > 0
            ? prevClose / baseClose - 1
            : null;
        if (preReturns[window] === null) complete = false;
      }
      if (!complete) {
        missingPrefixCount += 1;
        addExclusion("MISSING_PRE_RETURN_WINDOW");
        continue;
      }

      const gapDays = numberValue(event.values, "daysSincePreviousLimit");
      if (gapDays === null) gapUnknownCount += 1;
      else gapKnownCount += 1;
      const sample: PreEventSample = {
        eventId: event.eventId,
        year: Number(event.tradeDate.slice(0, 4)),
        gapDays,
        gapGroup: gapGroupOf(gapDays),
        preReturns,
      };
      preEventSamples.push(sample);

      for (const horizon of forwardHorizons) {
        const entry = postByDay.get(1)?.get(event.eventId);
        const exit = postByDay.get(horizon)?.get(event.eventId);
        if (!entry || !exit) continue;
        const entryOpen = numberValue(entry.values, "open");
        const exitClose = numberValue(exit.values, "close");
        if (
          entryOpen === null ||
          entryOpen <= 0 ||
          exitClose === null ||
          exitClose <= 0 ||
          !booleanValue(entry.values, "barPresent", true) ||
          !booleanValue(exit.values, "barPresent", true) ||
          !booleanValue(entry.values, "canBuyAtOpen", true) ||
          !booleanValue(exit.values, "canSellAtClose", true) ||
          entry.values.suspensionStatus === "SUSPENDED" ||
          exit.values.suspensionStatus === "SUSPENDED"
        ) {
          continue;
        }
        forwardSamples.push({
          eventId: event.eventId,
          year: sample.year,
          sample,
          horizon,
          grossReturn: exitClose / entryOpen - 1,
        });
      }
    }

    const datasetEventCount = context.dataset.facts.totalEvents;
    const unscannedEventCount =
      datasetEventCount === null ? null : Math.max(0, datasetEventCount - uniqueEvents.length);
    context.log(
      `候选 ${uniqueEvents.length}；eligible ${preEventSamples.length}；` +
        `间隔已知 ${gapKnownCount}；未知 ${gapUnknownCount}；forward samples ${forwardSamples.length}`,
    );

    return assemblePreEventContextResult({
      preReturnWindows,
      forwardHorizons,
      primaryInteractionWindow,
      costBps,
      samples: forwardSamples,
      candidateCount: uniqueEvents.length,
      eligibleCount: preEventSamples.length,
      excludedByReason,
      datasetEventCount,
      scannedRowCount: events.length,
      droppedByMaxEvents,
      droppedByScanLimit: events.length >= EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
      unscannedEventCount,
      duplicateEventIdCount,
      gapKnownCount,
      gapUnknownCount,
      allPreReturnWindowsAvailableCount: preEventSamples.length,
    });
  },
};

export default preEventContextStudyExperiment;
