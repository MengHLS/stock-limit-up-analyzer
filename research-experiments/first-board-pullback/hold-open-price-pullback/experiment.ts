import {
  EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  DEFAULT_EXIT_DAYS,
  MAX_ENTRY_WINDOW_DAYS,
  MAX_EXIT_DAY,
  assembleHoldOpenPricePullbackResult,
  holdOpenPricePullbackCustomPayloadSchema,
  type BaselineSample,
  type PullbackTradeSample,
} from "./result";

const POST_RELATIVE_DAYS = Array.from({ length: MAX_EXIT_DAY }, (_, index) => index + 1);

interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
  canBuyAtOpen: boolean;
  canSellAtClose: boolean;
  barPresent: boolean;
  suspended: boolean;
}

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

function parseBar(row: ExperimentEventRow | undefined): Bar | null {
  if (!row) return null;
  const open = numberValue(row.values, "open");
  const high = numberValue(row.values, "high");
  const low = numberValue(row.values, "low");
  const close = numberValue(row.values, "close");
  if (open === null || high === null || low === null || close === null) return null;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return null;
  if (high < low || high < open || high < close || low > open || low > close) return null;
  const barPresent = booleanValue(row.values, "barPresent", true);
  const suspensionStatus = row.values.suspensionStatus;
  return {
    open,
    high,
    low,
    close,
    canBuyAtOpen: booleanValue(row.values, "canBuyAtOpen", barPresent),
    canSellAtClose: booleanValue(row.values, "canSellAtClose", barPresent),
    barPresent,
    suspended: suspensionStatus === "SUSPENDED",
  };
}

function uniqueSortedIntegers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function returnOf(entryPrice: number, exitPrice: number): number {
  return exitPrice / entryPrice - 1;
}

function sortEventRows(left: ExperimentEventRow, right: ExperimentEventRow): number {
  return left.tradeDate === right.tradeDate
    ? left.eventId.localeCompare(right.eventId)
    : left.tradeDate.localeCompare(right.tradeDate);
}

export const holdOpenPricePullbackExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/hold-open-price-pullback",
    name: "首板后回撤但不破开盘价交易研究",
    version: COMPUTATION_VERSION,
    description:
      "首板后在 T+1..T+5 等待首次温和回撤；只要 low 未跌破首板日开盘价，" +
      "就在次日开盘入场，并按固定视界收盘退出。研究入场前破位、触发、不可买、" +
      "入场后破位、固定视界收益和相对全首板基准的差异；不产出最优阈值或策略对象。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "hold-open-price",
      "pullback-entry",
      "independent-experiment",
    ],
    parameters: [
      {
        code: "entryWindowDays",
        label: "等待入场窗口",
        description: `首板后最多等待多少个交易日出现首次回撤，允许 1..${MAX_ENTRY_WINDOW_DAYS}。`,
        kind: "INT",
        required: false,
        defaultValue: MAX_ENTRY_WINDOW_DAYS,
        bounds: { min: 1, max: MAX_ENTRY_WINDOW_DAYS },
        unit: "交易日",
      },
      {
        code: "pullbackTriggerBps",
        label: "回撤触发",
        description:
          "相对首板日收盘价的最低回撤幅度；low 达到 eventClose × (1 - bps/10000) 即触发。",
        kind: "NUMBER",
        required: false,
        defaultValue: 100,
        bounds: { min: 10, max: 1000 },
        unit: "bps",
      },
      {
        code: "exitDays",
        label: "固定退出视界",
        description: `相对首板日的退出日集合；必须晚于入场日且不超过 T+${MAX_EXIT_DAY}。`,
        kind: "INT_LIST",
        required: false,
        defaultValue: [...DEFAULT_EXIT_DAYS],
        bounds: { min: 2, max: MAX_EXIT_DAY },
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
        description: "从毛收益中统一扣除的成本敏感性参数，不是完整撮合模型。",
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
      postRelativeDays: POST_RELATIVE_DAYS,
      decisionOffsetDays: MAX_ENTRY_WINDOW_DAYS,
      usesForwardData: true,
      forwardDataPurpose:
        "等待首次回撤后用次一交易日开盘入场，并计算固定退出视界的收益；未来数据不用于新增候选事件。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/hold-open-price-pullback",
    pageTitle: "回撤守开盘价交易研究",
  },
  resultSchema: holdOpenPricePullbackCustomPayloadSchema,
  run: async (context: ExperimentRunContext) => {
    const entryWindowDays = context.parameters.entryWindowDays as number;
    const pullbackTriggerBps = context.parameters.pullbackTriggerBps as number;
    const exitDays = uniqueSortedIntegers(context.parameters.exitDays as number[]);
    const maxEvents = context.parameters.maxEvents as number;
    const costBps = context.parameters.roundTripCostBps as number;
    const excludeOneWordLimitUp = context.parameters.excludeOneWordLimitUp as boolean;

    if (entryWindowDays < 1 || entryWindowDays > MAX_ENTRY_WINDOW_DAYS) {
      throw new Error(`entryWindowDays 必须落在 1..${MAX_ENTRY_WINDOW_DAYS}`);
    }
    if (exitDays.length === 0 || exitDays.some((day) => day < 2 || day > MAX_EXIT_DAY)) {
      throw new Error(`exitDays 必须落在 2..${MAX_EXIT_DAY}`);
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
    const observationsByDay = new Map<number, Map<string, ExperimentEventRow>>();
    let observationBarRowsRead = 0;
    for (let day = 1; day <= MAX_EXIT_DAY; day += 1) {
      const rows = await context.dataset.observation(day);
      observationBarRowsRead += rows.length;
      observationsByDay.set(day, new Map(rows.map((row) => [row.eventId, row])));
    }

    const excludedByReason: Record<string, number> = {};
    const addExclusion = (code: string, count = 1): void => {
      if (count > 0) excludedByReason[code] = (excludedByReason[code] ?? 0) + count;
    };
    addExclusion("MAX_EVENTS_LIMIT", droppedByMaxEvents);

    const trades: PullbackTradeSample[] = [];
    const baselineSamples: BaselineSample[] = [];
    let missingEventDayBarCount = 0;
    let invalidEventDayCount = 0;
    let missingSignalPathEventCount = 0;
    let invalidSignalPathEventCount = 0;
    let breakBeforeEntryCount = 0;
    let noTriggerCount = 0;
    let triggeredCount = 0;
    let entryUnfillableCount = 0;
    let eventOneWordLimitUpCount = 0;
    let excludedOneWordLimitUpCount = 0;
    let eligibleCount = 0;
    const triggerCounts = new Map<
      number,
      { triggerDay: number; triggeredCount: number; entryUnfillableCount: number; enteredCount: number }
    >();
    for (let day = 1; day <= entryWindowDays; day += 1) {
      triggerCounts.set(day, {
        triggerDay: day,
        triggeredCount: 0,
        entryUnfillableCount: 0,
        enteredCount: 0,
      });
    }

    for (const event of usedEvents) {
      const eventDayRow = eventDayByEvent.get(event.eventId);
      if (!eventDayRow) {
        missingEventDayBarCount += 1;
        addExclusion("MISSING_EVENT_DAY_BAR");
        continue;
      }
      const eventDay = parseBar(eventDayRow);
      if (eventDay === null) {
        invalidEventDayCount += 1;
        addExclusion("INVALID_EVENT_DAY_OHLC");
        continue;
      }
      const signalBars: Bar[] = [];
      let signalPathComplete = true;
      let signalPathInvalid = false;
      for (let day = 1; day <= entryWindowDays; day += 1) {
        const row = observationsByDay.get(day)?.get(event.eventId);
        const parsed = parseBar(row);
        if (parsed === null) {
          signalPathComplete = false;
          signalPathInvalid ||= row !== undefined;
        }
        signalBars[day] = parsed as Bar;
      }
      if (!signalPathComplete) {
        missingSignalPathEventCount += 1;
        addExclusion(signalPathInvalid ? "INVALID_SIGNAL_PATH_OHLC" : "MISSING_SIGNAL_PATH");
        continue;
      }
      eligibleCount += 1;
      const eventLimitUpPrice = numberValue(event.values, "limitUpPrice");
      const oneWordLimitUp =
        eventLimitUpPrice !== null &&
        [eventDay.open, eventDay.high, eventDay.low, eventDay.close].every(
          (value) => Math.abs(value - eventLimitUpPrice) <= 1e-9,
        );
      if (oneWordLimitUp) eventOneWordLimitUpCount += 1;
      if (excludeOneWordLimitUp && oneWordLimitUp) {
        eligibleCount -= 1;
        excludedOneWordLimitUpCount += 1;
        addExclusion("EXCLUDED_ONE_WORD_LIMIT_UP");
        continue;
      }

      const year = Number(event.tradeDate.slice(0, 4));
      const firstDay = signalBars[1]!;
      if (
        firstDay.barPresent &&
        !firstDay.suspended &&
        firstDay.canBuyAtOpen &&
        exitDays.every((day) => {
          const exitBar = parseBar(observationsByDay.get(day)?.get(event.eventId));
          return exitBar !== null && exitBar.barPresent && !exitBar.suspended && exitBar.canSellAtClose;
        })
      ) {
        for (const exitDay of exitDays) {
          const exitBar = parseBar(observationsByDay.get(exitDay)?.get(event.eventId))!;
          baselineSamples.push({
            eventId: event.eventId,
            year,
            exitDay,
            grossReturn: returnOf(firstDay.open, exitBar.close),
          });
        }
      }

      let triggerDay: number | null = null;
      let breakBeforeEntry = false;
      for (let day = 1; day <= entryWindowDays; day += 1) {
        const bar = signalBars[day]!;
        if (bar.low < eventDay.open - 1e-9) {
          breakBeforeEntry = true;
          break;
        }
        if (bar.low <= eventDay.close * (1 - pullbackTriggerBps / 10_000) + 1e-9) {
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
      triggerCounts.get(triggerDay)!.triggeredCount += 1;
      const entryDay = triggerDay + 1;
      const entryBar = parseBar(observationsByDay.get(entryDay)?.get(event.eventId));
      if (
        entryBar === null ||
        !entryBar.barPresent ||
        entryBar.suspended ||
        !entryBar.canBuyAtOpen
      ) {
        entryUnfillableCount += 1;
        triggerCounts.get(triggerDay)!.entryUnfillableCount += 1;
        continue;
      }
      triggerCounts.get(triggerDay)!.enteredCount += 1;

      for (const exitDay of exitDays) {
        if (exitDay <= entryDay) continue;
        const exitBar = parseBar(observationsByDay.get(exitDay)?.get(event.eventId));
        if (
          exitBar === null ||
          !exitBar.barPresent ||
          exitBar.suspended ||
          !exitBar.canSellAtClose
        ) {
          continue;
        }
        let breakAfterEntry = false;
        for (let day = entryDay; day <= exitDay; day += 1) {
          const bar = parseBar(observationsByDay.get(day)?.get(event.eventId));
          if (bar !== null && bar.low < eventDay.open - 1e-9) {
            breakAfterEntry = true;
            break;
          }
        }
        trades.push({
          eventId: event.eventId,
          year,
          triggerDay,
          entryDay,
          exitDay,
          grossReturn: returnOf(entryBar.open, exitBar.close),
          breakAfterEntry,
        });
      }
    }

    const datasetEventCount = context.dataset.facts.totalEvents;
    const unscannedEventCount =
      datasetEventCount === null ? null : Math.max(0, datasetEventCount - uniqueEvents.length);
    context.log(
      `候选 ${uniqueEvents.length}；eligible ${eligibleCount}；触发 ${triggeredCount}；` +
        `入场前破位 ${breakBeforeEntryCount}；未触发 ${noTriggerCount}；交易样本 ${trades.length}`,
    );

    return assembleHoldOpenPricePullbackResult({
      entryWindowDays,
      pullbackTriggerBps,
      exitDays,
      costBps,
      excludeOneWordLimitUp,
      trades,
      baselineSamples,
      candidateCount: uniqueEvents.length,
      eligibleCount,
      excludedByReason,
      datasetEventCount,
      scannedRowCount: events.length,
      droppedByMaxEvents,
      droppedByScanLimit: events.length >= EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
      unscannedEventCount,
      duplicateEventIdCount,
      eventOneWordLimitUpCount,
      excludedOneWordLimitUpCount,
      eventDayBarRowsRead: eventDayBars.length,
      observationBarRowsRead,
      missingEventDayBarCount,
      invalidEventDayCount,
      missingSignalPathEventCount,
      invalidSignalPathEventCount,
      breakBeforeEntryCount,
      noTriggerCount,
      triggeredCount,
      entryUnfillableCount,
      triggerCounts: [...triggerCounts.values()],
    });
  },
};

export default holdOpenPricePullbackExperiment;
