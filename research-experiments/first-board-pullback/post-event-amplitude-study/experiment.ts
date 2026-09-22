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
  amplitudeBucketOf,
  assemblePostEventAmplitudeResult,
  postEventAmplitudeCustomPayloadSchema,
  type ContextSample,
  type ForwardSample,
} from "./result";

const POST_DAYS = Array.from({ length: MAX_FORWARD_HORIZON }, (_, index) => index + 1);

interface ContextBar {
  high: number;
  low: number;
  preClose: number;
  limitUpPrice: number;
  limitDownPrice: number;
  amplitude: number;
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

function uniqueSortedIntegers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function parseContextBar(row: ExperimentEventRow | undefined): ContextBar | null {
  if (!row) return null;
  const high = numberValue(row.values, "high");
  const low = numberValue(row.values, "low");
  const preClose = numberValue(row.values, "preClose");
  const limitUpPrice = numberValue(row.values, "limitUpPrice");
  const limitDownPrice = numberValue(row.values, "limitDownPrice");
  if (
    high === null ||
    low === null ||
    preClose === null ||
    limitUpPrice === null ||
    limitDownPrice === null ||
    high <= 0 ||
    low <= 0 ||
    preClose <= 0 ||
    high < low
  ) {
    return null;
  }
  return {
    high,
    low,
    preClose,
    limitUpPrice,
    limitDownPrice,
    amplitude: high / preClose - low / preClose,
  };
}

function sortEventRows(left: ExperimentEventRow, right: ExperimentEventRow): number {
  return left.tradeDate === right.tradeDate
    ? left.eventId.localeCompare(right.eventId)
    : left.tradeDate.localeCompare(right.tradeDate);
}

export const postEventAmplitudeStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/post-event-amplitude-study",
    name: "首板后无涨跌停与振幅研究",
    version: COMPUTATION_VERSION,
    description:
      "首板后 T+1..T+5，判断期间是否触及涨停或跌停，并计算每日振幅 (high-low)/preClose。" +
      "T+5 决策后，从 T+6 开盘入场，观察 T+10/T+15/T+20 收盘收益。" +
      "重点研究“无涨跌停”与平均振幅同后续收益的关系；不选择最优振幅区间。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "post-event-context", "amplitude", "limit-touch"],
    parameters: [
      {
        code: "forwardHorizons",
        label: "后续收益视界",
        description: `T+6 开盘入场后观察的 T+h 收盘视界，允许 7..${MAX_FORWARD_HORIZON}。`,
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
        description: "从 T+6 开盘到后续退出收盘的收益中统一扣除。",
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
        events: ["isFirstLimit", "boardType", "market"],
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
      postRelativeDays: POST_DAYS,
      decisionOffsetDays: CONTEXT_DAYS,
      usesForwardData: true,
      forwardDataPurpose:
        "在 T+1..T+5 上判定涨跌停触达与振幅，并在 T+6 开盘后计算固定视界收益。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/post-event-amplitude-study",
    pageTitle: "无涨跌停与振幅研究",
  },
  resultSchema: postEventAmplitudeCustomPayloadSchema,
  run: async (context: ExperimentRunContext) => {
    const forwardHorizons = uniqueSortedIntegers(context.parameters.forwardHorizons as number[]);
    const maxEvents = context.parameters.maxEvents as number;
    const costBps = context.parameters.roundTripCostBps as number;
    if (
      forwardHorizons.length === 0 ||
      forwardHorizons.some((day) => day <= ENTRY_DAY || day > MAX_FORWARD_HORIZON)
    ) {
      throw new Error(`forwardHorizons 必须落在 ${ENTRY_DAY + 1}..${MAX_FORWARD_HORIZON}`);
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
    const postByDay = new Map<number, Map<string, ExperimentEventRow>>();
    let postRowsRead = 0;
    for (const day of POST_DAYS) {
      const rows = await context.dataset.observation(day);
      postRowsRead += rows.length;
      postByDay.set(day, new Map(rows.map((row) => [row.eventId, row])));
    }

    const excludedByReason: Record<string, number> = {};
    const addExclusion = (code: string, count = 1): void => {
      if (count > 0) excludedByReason[code] = (excludedByReason[code] ?? 0) + count;
    };
    addExclusion("MAX_EVENTS_LIMIT", droppedByMaxEvents);

    const samples: ForwardSample[] = [];
    let noLimitCount = 0;
    let hadLimitCount = 0;
    let entryUnfillableCount = 0;
    let missingContextCount = 0;
    let invalidContextCount = 0;

    for (const event of usedEvents) {
      const eventDay = eventDayByEvent.get(event.eventId);
      if (!eventDay || numberValue(eventDay.values, "close") === null) {
        addExclusion("MISSING_EVENT_DAY_BAR");
        continue;
      }
      const contextRows: ExperimentEventRow[] = [];
      let contextComplete = true;
      for (let day = 1; day <= CONTEXT_DAYS; day += 1) {
        const row = postByDay.get(day)?.get(event.eventId);
        if (!row) {
          contextComplete = false;
          break;
        }
        contextRows.push(row);
      }
      if (!contextComplete) {
        missingContextCount += 1;
        addExclusion("MISSING_CONTEXT_BAR");
        continue;
      }

      const parsedBars: ContextBar[] = [];
      let invalid = false;
      for (const row of contextRows) {
        const parsed = parseContextBar(row);
        if (parsed === null) {
          invalid = true;
          break;
        }
        parsedBars.push(parsed);
      }
      if (invalid) {
        invalidContextCount += 1;
        addExclusion("INVALID_CONTEXT_BAR");
        continue;
      }

      const hadLimit = parsedBars.some(
        (bar) =>
          bar.high >= bar.limitUpPrice - 1e-9 ||
          bar.low <= bar.limitDownPrice + 1e-9,
      );
      const amplitudes = parsedBars.map((bar) => bar.amplitude);
      const meanAmplitude =
        amplitudes.reduce((sum, value) => sum + value, 0) / amplitudes.length;
      const maxAmplitude = Math.max(...amplitudes);
      const limitContext = hadLimit ? "HAD_LIMIT" : "NO_LIMIT";
      if (hadLimit) hadLimitCount += 1;
      else noLimitCount += 1;

      const sample: ContextSample = {
        eventId: event.eventId,
        year: Number(event.tradeDate.slice(0, 4)),
        limitContext,
        meanAmplitude,
        maxAmplitude,
        amplitudeBucket: hadLimit ? null : amplitudeBucketOf(meanAmplitude),
      };

      const entry = postByDay.get(ENTRY_DAY)?.get(event.eventId);
      const entryOpen = entry ? numberValue(entry.values, "open") : null;
      if (
        !entry ||
        entryOpen === null ||
        entryOpen <= 0 ||
        !booleanValue(entry.values, "barPresent", true) ||
        !booleanValue(entry.values, "canBuyAtOpen", true) ||
        entry.values.suspensionStatus === "SUSPENDED"
      ) {
        entryUnfillableCount += 1;
        continue;
      }

      for (const horizon of forwardHorizons) {
        const exit = postByDay.get(horizon)?.get(event.eventId);
        const exitClose = exit ? numberValue(exit.values, "close") : null;
        if (
          !exit ||
          exitClose === null ||
          exitClose <= 0 ||
          !booleanValue(exit.values, "barPresent", true) ||
          !booleanValue(exit.values, "canSellAtClose", true) ||
          exit.values.suspensionStatus === "SUSPENDED"
        ) {
          continue;
        }
        samples.push({
          eventId: event.eventId,
          year: sample.year,
          sample,
          horizon,
          grossReturn: exitClose / entryOpen - 1,
        });
      }
    }

    const eligibleCount = noLimitCount + hadLimitCount;
    const datasetEventCount = context.dataset.facts.totalEvents;
    const unscannedEventCount =
      datasetEventCount === null ? null : Math.max(0, datasetEventCount - uniqueEvents.length);
    context.log(
      `候选 ${uniqueEvents.length}；eligible ${eligibleCount}；无涨跌停 ${noLimitCount}；` +
        `有涨跌停 ${hadLimitCount}；forward samples ${samples.length}`,
    );

    return assemblePostEventAmplitudeResult({
      forwardHorizons,
      costBps,
      samples,
      candidateCount: uniqueEvents.length,
      eligibleCount,
      excludedByReason,
      datasetEventCount,
      scannedRowCount: events.length,
      droppedByMaxEvents,
      droppedByScanLimit: events.length >= EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
      unscannedEventCount,
      duplicateEventIdCount,
      noLimitCount,
      hadLimitCount,
      entryUnfillableCount,
    });
  },
};

export default postEventAmplitudeStudyExperiment;
