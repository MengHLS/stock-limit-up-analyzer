import {
  EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  DEFAULT_FORWARD_HORIZONS,
  MAX_FORWARD_HORIZON,
  assembleTurnoverResult,
  turnoverCustomPayloadSchema,
  type ForwardSample,
} from "./result";

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

function sortEvents(left: ExperimentEventRow, right: ExperimentEventRow): number {
  return left.tradeDate === right.tradeDate
    ? left.eventId.localeCompare(right.eventId)
    : left.tradeDate.localeCompare(right.tradeDate);
}

export const turnoverStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/turnover-study",
    name: "首板日换手率与未来收益研究",
    version: COMPUTATION_VERSION,
    description:
      "研究首板日 turnover 与 T+1 开盘入场后 T+5/T+10/T+20 收益的关系；" +
      "同时检查流通市值可用性。使用按交易日聚类的 Moving Block Bootstrap。" +
      "当前流通市值字段缺失时明确返回 INSUFFICIENT_DATA，不伪造分组。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "turnover", "float-market-cap", "bootstrap"],
    parameters: [
      {
        code: "forwardHorizons",
        label: "后续收益视界",
        description: `T+1 开盘入场后的 T+h 收盘视界，允许 2..${MAX_FORWARD_HORIZON}。`,
        kind: "INT_LIST",
        required: false,
        defaultValue: [...DEFAULT_FORWARD_HORIZONS],
        bounds: { min: 2, max: MAX_FORWARD_HORIZON },
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
        description: "从毛收益中统一扣除的敏感性成本。",
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
        events: ["isFirstLimit", "boardType", "market", "turnover", "floatMarketCap"],
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
      decisionOffsetDays: 1,
      usesForwardData: true,
      forwardDataPurpose: "计算 T+1 开盘到 T+h 收盘的收益。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/turnover-study",
    pageTitle: "换手率与未来收益研究",
  },
  resultSchema: turnoverCustomPayloadSchema,
  run: async (context: ExperimentRunContext) => {
    const forwardHorizons = [...new Set(context.parameters.forwardHorizons as number[])].sort(
      (a, b) => a - b,
    );
    const maxEvents = context.parameters.maxEvents as number;
    const costBps = context.parameters.roundTripCostBps as number;
    const bootstrapIterations = context.parameters.bootstrapIterations as number;
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
    let turnoverAvailableCount = 0;
    let floatMarketCapAvailableCount = 0;
    let eligibleEventCount = 0;

    for (const event of usedEvents) {
      const eventDay = eventDayByEvent.get(event.eventId);
      if (!eventDay) {
        addExclusion("MISSING_EVENT_DAY_BAR");
        continue;
      }
      const turnover = numberValue(event.values, "turnover");
      if (turnover === null) {
        addExclusion("MISSING_TURNOVER");
        continue;
      }
      turnoverAvailableCount += 1;
      const floatMarketCap = numberValue(event.values, "floatMarketCap");
      if (floatMarketCap !== null) floatMarketCapAvailableCount += 1;

      const entry = postByDay.get(1)?.get(event.eventId);
      const entryOpen = entry ? numberValue(entry.values, "open") : null;
      if (
        !entry ||
        entryOpen === null ||
        entryOpen <= 0 ||
        !booleanValue(entry.values, "barPresent", true) ||
        !booleanValue(entry.values, "canBuyAtOpen", true) ||
        entry.values.suspensionStatus === "SUSPENDED"
      ) {
        addExclusion("ENTRY_NOT_EXECUTABLE");
        continue;
      }
      eligibleEventCount += 1;
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
          eventDate: event.tradeDate,
          year: Number(event.tradeDate.slice(0, 4)),
          turnover,
          floatMarketCap,
          horizon,
          grossReturn: exitClose / entryOpen - 1,
        });
      }
    }

    const datasetEventCount = context.dataset.facts.totalEvents;
    const unscannedEventCount =
      datasetEventCount === null ? null : Math.max(0, datasetEventCount - uniqueEvents.length);
    context.log(
      `候选 ${uniqueEvents.length}；eligible events ${eligibleEventCount}；` +
        `turnover ${turnoverAvailableCount}；floatCap ${floatMarketCapAvailableCount}；samples ${samples.length}`,
    );
    return assembleTurnoverResult({
      forwardHorizons,
      costBps,
      bootstrapIterations,
      bootstrapBlockDays,
      bootstrapSeed,
      samples,
      candidateCount: uniqueEvents.length,
      eligibleCount: eligibleEventCount,
      excludedByReason,
      datasetEventCount,
      scannedRowCount: events.length,
      droppedByMaxEvents,
      droppedByScanLimit: events.length >= EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
      unscannedEventCount,
      duplicateEventIdCount,
      turnoverAvailableCount,
      floatMarketCapAvailableCount,
    });
  },
};

export default turnoverStudyExperiment;
