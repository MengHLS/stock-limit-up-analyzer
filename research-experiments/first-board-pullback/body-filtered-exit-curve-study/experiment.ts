import {
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  DEFAULT_ENTRY_DAY,
  DEFAULT_MAX_EXIT_DAY,
  DEFAULT_MIN_BODY_HEIGHT_PCT,
  MAX_ENTRY_DAY,
  MAX_EXIT_DAY,
  MIN_ENTRY_DAY,
  ROUND_TRIP_COST_BPS,
  assembleBodyFilteredExitCurve,
  bodyFilteredExitCurveSchema,
  bodyHeightBucketOf,
  type ExitCurveSample,
} from "./result";

const POST_RELATIVE_DAYS = Array.from(
  { length: MAX_EXIT_DAY },
  (_, index) => index + 1
);

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
  const high = numberValue(row.values, "high");
  const low = numberValue(row.values, "low");
  const close = numberValue(row.values, "close");
  if (
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    high < low ||
    high < open ||
    high < close ||
    low > open ||
    low > close
  ) {
    return null;
  }
  const barPresent = booleanValue(row.values, "barPresent", true);
  return {
    open,
    high,
    low,
    close,
    canBuyAtOpen: booleanValue(row.values, "canBuyAtOpen", barPresent),
    canSellAtClose: booleanValue(row.values, "canSellAtClose", barPresent),
    barPresent,
    suspended: row.values.suspensionStatus === "SUSPENDED",
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

export const bodyFilteredExitCurveStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/body-filtered-exit-curve-study",
    name: "首板实体过滤与实际持有曲线研究",
    version: COMPUTATION_VERSION,
    description:
      "严格涨停首板默认排除一字板，并要求首板实体高度不低于最低阈值。" +
      "入场后从实际入场日起逐日计算净收益、MFE/MAE 和共同样本持有曲线；" +
      "不选择收益最高的退出日。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "body-height",
      "one-word-exclusion",
      "exit-curve",
      "holding-day",
    ],
    parameters: [
      {
        code: "entryDay",
        label: "实际入场日",
        description: `相对首板日的固定开盘入场日，允许 ${MIN_ENTRY_DAY}..${MAX_ENTRY_DAY}。`,
        kind: "INT",
        required: false,
        defaultValue: DEFAULT_ENTRY_DAY,
        bounds: { min: MIN_ENTRY_DAY, max: MAX_ENTRY_DAY },
        unit: "相对日",
      },
      {
        code: "maxExitRelativeDay",
        label: "最大退出相对日",
        description: `持有曲线的最远事件相对日，允许 2..${MAX_EXIT_DAY}。`,
        kind: "INT",
        required: false,
        defaultValue: DEFAULT_MAX_EXIT_DAY,
        bounds: { min: 2, max: MAX_EXIT_DAY },
        unit: "相对日",
      },
      {
        code: "minBodyHeightPct",
        label: "最小首板实体高度",
        description:
          "实体高度 = (首板 close - 首板 open) / 首板 previousClose。低于该值的样本排除。",
        kind: "NUMBER",
        required: false,
        defaultValue: DEFAULT_MIN_BODY_HEIGHT_PCT,
        bounds: { min: 0, max: 10 },
        unit: "%",
      },
      {
        code: "excludeOneWordLimitUp",
        label: "排除一字板",
        description:
          "首板日 O=H=L=C=limitUpPrice 时视为一字涨停；默认排除。",
        kind: "BOOLEAN",
        required: false,
        defaultValue: true,
      },
      {
        code: "roundTripCostBps",
        label: "往返成本",
        description: "每个持有日退出时统一扣除的往返成本敏感性参数。",
        kind: "NUMBER",
        required: false,
        defaultValue: ROUND_TRIP_COST_BPS,
        bounds: { min: 0, max: 200 },
        unit: "bps",
      },
      {
        code: "bootstrapIterations",
        label: "Bootstrap 次数",
        description: "锚点持有日的日期聚类 Moving Block Bootstrap 次数。",
        kind: "INT",
        required: false,
        defaultValue: 1000,
        bounds: { min: 100, max: 5000 },
        unit: "次",
      },
      {
        code: "bootstrapBlockDays",
        label: "Bootstrap block 长度",
        description: "锚点 Bootstrap 连续重采样的交易日数。",
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
      postRelativeDays: POST_RELATIVE_DAYS,
      decisionOffsetDays: null,
      usesForwardData: true,
      forwardDataPurpose:
        "首板日实体只使用 T 日数据；实际入场后的未来行情用于逐日退出曲线。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/body-filtered-exit-curve-study",
    pageTitle: "实体过滤与实际持有曲线",
  },
  resultSchema: bodyFilteredExitCurveSchema,
  run: async (context: ExperimentRunContext) => {
    const entryDay = context.parameters.entryDay as number;
    const maxExitDay = context.parameters.maxExitRelativeDay as number;
    const minBodyHeightPct = context.parameters.minBodyHeightPct as number;
    const excludeOneWordLimitUp = context.parameters
      .excludeOneWordLimitUp as boolean;
    const costBps = context.parameters.roundTripCostBps as number;
    const bootstrapIterations = context.parameters
      .bootstrapIterations as number;
    const bootstrapBlockDays = context.parameters.bootstrapBlockDays as number;
    const bootstrapSeed = 20_260_922;

    if (entryDay < MIN_ENTRY_DAY || entryDay > MAX_ENTRY_DAY) {
      throw new Error(`entryDay 必须落在 ${MIN_ENTRY_DAY}..${MAX_ENTRY_DAY}`);
    }
    if (maxExitDay <= entryDay || maxExitDay > MAX_EXIT_DAY) {
      throw new Error(`maxExitRelativeDay 必须晚于 T+${entryDay} 且不超过 T+${MAX_EXIT_DAY}`);
    }
    if (minBodyHeightPct < 0 || minBodyHeightPct > 10) {
      throw new Error("minBodyHeightPct 必须落在 0..10");
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
    const uniqueEvents = [...deduped.values()].sort(sortEvents);
    context.freezeSelection(uniqueEvents.map(event => event.eventId));

    const eventDayBars = await context.dataset.feature(0);
    const eventDayByEvent = new Map(
      eventDayBars.map(bar => [bar.eventId, bar])
    );
    const postByDay = new Map<number, Map<string, ExperimentEventRow>>();
    for (let day = 1; day <= maxExitDay; day += 1) {
      const rows = await context.dataset.observation(day);
      postByDay.set(day, new Map(rows.map(row => [row.eventId, row])));
    }

    const excludedByReason: Record<string, number> = {};
    const addExclusion = (code: string, count = 1): void => {
      if (count > 0)
        excludedByReason[code] = (excludedByReason[code] ?? 0) + count;
    };

    const samples: ExitCurveSample[] = [];
    let exactLimitUpCloseCount = 0;
    let oneWordLimitUpCount = 0;
    let excludedOneWordLimitUpCount = 0;
    let belowMinBodyHeightCount = 0;
    let entryUnfillableCount = 0;
    let incompleteCommonPathCount = 0;
    const minBodyHeight = minBodyHeightPct / 100;
    const maxHoldingDays = maxExitDay - entryDay + 1;

    for (const event of uniqueEvents) {
      if (event.values.isFirstLimit !== true) {
        addExclusion("NOT_FIRST_LIMIT");
        continue;
      }

      const eventBar = parseBar(eventDayByEvent.get(event.eventId));
      const previousClose = numberValue(event.values, "previousClose");
      const limitUpPrice = numberValue(event.values, "limitUpPrice");
      if (
        eventBar === null ||
        previousClose === null ||
        limitUpPrice === null ||
        previousClose <= 0 ||
        limitUpPrice <= 0
      ) {
        addExclusion(
          eventDayByEvent.has(event.eventId)
            ? "INVALID_EVENT_DAY_OHLC"
            : "MISSING_EVENT_DAY_BAR"
        );
        continue;
      }
      if (Math.abs(eventBar.close - limitUpPrice) > 1e-9) {
        addExclusion("EVENT_NOT_EXACT_LIMIT_UP");
        continue;
      }
      exactLimitUpCloseCount += 1;

      const oneWordLimitUp = [
        eventBar.open,
        eventBar.high,
        eventBar.low,
        eventBar.close,
      ].every(value => Math.abs(value - limitUpPrice) <= 1e-9);
      if (oneWordLimitUp) oneWordLimitUpCount += 1;
      if (excludeOneWordLimitUp && oneWordLimitUp) {
        excludedOneWordLimitUpCount += 1;
        addExclusion("EXCLUDED_ONE_WORD_LIMIT_UP");
        continue;
      }

      const bodyHeight = (eventBar.close - eventBar.open) / previousClose;
      if (bodyHeight < minBodyHeight - 1e-12) {
        belowMinBodyHeightCount += 1;
        addExclusion("BELOW_MIN_BODY_HEIGHT");
        continue;
      }

      const entryBar = parseBar(postByDay.get(entryDay)?.get(event.eventId));
      if (
        entryBar === null ||
        !entryBar.barPresent ||
        entryBar.suspended ||
        !entryBar.canBuyAtOpen
      ) {
        entryUnfillableCount += 1;
        addExclusion("ENTRY_UNFILLABLE");
        continue;
      }

      const path: Bar[] = [];
      let completePath = true;
      for (let day = entryDay; day <= maxExitDay; day += 1) {
        const bar = parseBar(postByDay.get(day)?.get(event.eventId));
        if (
          bar === null ||
          !bar.barPresent ||
          bar.suspended ||
          !bar.canSellAtClose
        ) {
          completePath = false;
          break;
        }
        path.push(bar);
      }
      if (!completePath) {
        incompleteCommonPathCount += 1;
        addExclusion("INCOMPLETE_COMMON_PATH");
        continue;
      }

      const marksByHoldingDay: Record<string, number> = {};
      const mfeByHoldingDay: Record<string, number> = {};
      const maeByHoldingDay: Record<string, number> = {};
      let cumulativeHigh = entryBar.open;
      let cumulativeLow = entryBar.open;
      let positive2HoldingDay: number | null = null;
      let negative2HoldingDay: number | null = null;

      for (let holdingDay = 1; holdingDay <= maxHoldingDays; holdingDay += 1) {
        const bar = path[holdingDay - 1]!;
        cumulativeHigh = Math.max(cumulativeHigh, bar.high);
        cumulativeLow = Math.min(cumulativeLow, bar.low);
        const mark = bar.close / entryBar.open - 1;
        marksByHoldingDay[String(holdingDay)] = mark;
        mfeByHoldingDay[String(holdingDay)] =
          cumulativeHigh / entryBar.open - 1;
        maeByHoldingDay[String(holdingDay)] =
          cumulativeLow / entryBar.open - 1;
        if (positive2HoldingDay === null && mark >= 0.02) {
          positive2HoldingDay = holdingDay;
        }
        if (negative2HoldingDay === null && mark <= -0.02) {
          negative2HoldingDay = holdingDay;
        }
      }

      samples.push({
        eventId: event.eventId,
        eventDate: event.tradeDate,
        year: Number(event.tradeDate.slice(0, 4)),
        bodyHeight,
        bodyBucket: bodyHeightBucketOf(bodyHeight),
        entryDay,
        marksByHoldingDay,
        mfeByHoldingDay,
        maeByHoldingDay,
        positive2HoldingDay,
        negative2HoldingDay,
      });
    }

    const datasetEventCount = context.dataset.facts.totalEvents;
    const unscannedEventCount =
      datasetEventCount === null
        ? null
        : Math.max(0, datasetEventCount - uniqueEvents.length);
    context.log(
      `候选 ${uniqueEvents.length}；严格涨停 ${exactLimitUpCloseCount}；一字 ${oneWordLimitUpCount}；` +
        `实体过滤 ${belowMinBodyHeightCount}；入场不可用 ${entryUnfillableCount}；` +
        `共同路径不完整 ${incompleteCommonPathCount}；样本 ${samples.length}`
    );

    return assembleBodyFilteredExitCurve({
      samples,
      entryDay,
      maxExitDay,
      minBodyHeightPct,
      excludeOneWordLimitUp,
      costBps,
      bootstrapIterations,
      bootstrapBlockDays,
      bootstrapSeed,
      candidateCount: uniqueEvents.length,
      exactLimitUpCloseCount,
      oneWordLimitUpCount,
      excludedOneWordLimitUpCount,
      belowMinBodyHeightCount,
      entryUnfillableCount,
      incompleteCommonPathCount,
      excludedByReason,
      datasetEventCount,
      unscannedEventCount,
      duplicateEventIdCount,
    });
  },
};

export default bodyFilteredExitCurveStudyExperiment;
