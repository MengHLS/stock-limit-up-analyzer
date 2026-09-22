import {
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  ENTRY_DAY,
  GAP_DAYS_THRESHOLD,
  OBSERVATION_HORIZONS,
  PRE_RETURN_THRESHOLD,
  PRE_RETURN_WINDOW_DAYS,
  assembleOversoldGapReversalResult,
  oversoldGapReversalCustomPayloadSchema,
  type FrozenReturnSample,
} from "./result";

const PREFIX_DAYS = [-PRE_RETURN_WINDOW_DAYS - 1, -1] as const;
const POST_DAYS = [ENTRY_DAY, ...OBSERVATION_HORIZONS] as const;

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
  if (!booleanValue(row.values, "barPresent", true)) return null;
  if (row.values.suspensionStatus === "SUSPENDED") return null;
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

export const oversoldGapReversalValidationExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/oversold-gap-reversal-validation",
    name: "超跌长间隔首板冻结验证",
    version: COMPUTATION_VERSION,
    description:
      "冻结假设：距前次涨停超过 20 个交易日，且首板前 T-10 收益小于 -10%；" +
      "T 日收盘决策，T+1 开盘入场，T+10 收盘主退出。" +
      "按同日 eligible 首板构造基准，使用日期聚类 Bootstrap。" +
      "Observation 只检查样本，Holdout 才按全部预设条件判定 PASS / FAIL。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "oversold-reversal",
      "frozen-hypothesis",
      "observation",
      "holdout",
    ],
    parameters: [],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: {
        events: [
          "isFirstLimit",
          "boardType",
          "market",
          "daysSincePreviousLimit",
        ],
        feature: ["close"],
        observation: [
          "open",
          "close",
          "barPresent",
          "suspensionStatus",
          "canBuyAtOpen",
          "canSellAtClose",
        ],
      },
      prefixRelativeDays: [...PREFIX_DAYS],
      postRelativeDays: [...POST_DAYS],
      decisionOffsetDays: null,
      usesForwardData: true,
      forwardDataPurpose:
        "T+1 开盘入场并计算 T+5/T+10/T+20 收益；冻结条件本身只使用事件日前信息。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/oversold-gap-reversal-validation",
    pageTitle: "超跌长间隔首板冻结验证",
  },
  resultSchema: oversoldGapReversalCustomPayloadSchema,
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
    const uniqueEvents = [...deduped.values()].sort(sortEventRows);
    context.freezeSelection(uniqueEvents.map(event => event.eventId));

    const closeMinus11Rows = await context.dataset.feature(
      -PRE_RETURN_WINDOW_DAYS - 1
    );
    const closeMinus1Rows = await context.dataset.feature(-1);
    const closeMinus11ByEvent = new Map(
      closeMinus11Rows.map(row => [row.eventId, row])
    );
    const closeMinus1ByEvent = new Map(
      closeMinus1Rows.map(row => [row.eventId, row])
    );

    const excludedByReason: Record<string, number> = {};
    const addExclusion = (code: string, count = 1): void => {
      if (count > 0)
        excludedByReason[code] = (excludedByReason[code] ?? 0) + count;
    };

    interface EligibleEvent {
      event: ExperimentEventRow;
      isSignal: boolean;
    }

    const eligible: EligibleEvent[] = [];
    let signalCount = 0;
    for (const event of uniqueEvents) {
      if (event.values.isFirstLimit !== true) {
        addExclusion("NOT_FIRST_LIMIT");
        continue;
      }
      const closeMinus11 = closeOf(closeMinus11ByEvent.get(event.eventId));
      const closeMinus1 = closeOf(closeMinus1ByEvent.get(event.eventId));
      if (closeMinus11 === null || closeMinus1 === null) {
        addExclusion("MISSING_OR_INVALID_PRE_WINDOW");
        continue;
      }
      const preReturn10 = closeMinus1 / closeMinus11 - 1;
      const daysSincePreviousLimit = numberValue(
        event.values,
        "daysSincePreviousLimit"
      );
      const isSignal =
        daysSincePreviousLimit !== null &&
        daysSincePreviousLimit > GAP_DAYS_THRESHOLD &&
        preReturn10 < PRE_RETURN_THRESHOLD;
      if (isSignal) signalCount += 1;
      eligible.push({ event, isSignal });
    }

    const postByDay = new Map<number, Map<string, ExperimentEventRow>>();
    for (const day of POST_DAYS) {
      const rows = await context.dataset.observation(day);
      postByDay.set(day, new Map(rows.map(row => [row.eventId, row])));
    }

    const samples: FrozenReturnSample[] = [];
    let entryUnfillableCount = 0;
    for (const item of eligible) {
      const entryRow = postByDay.get(ENTRY_DAY)?.get(item.event.eventId);
      const entryOpen = openOf(entryRow);
      if (
        !entryRow ||
        entryOpen === null ||
        !booleanValue(entryRow.values, "canBuyAtOpen", false)
      ) {
        if (item.isSignal) entryUnfillableCount += 1;
        continue;
      }

      for (const horizon of OBSERVATION_HORIZONS) {
        const exitRow = postByDay.get(horizon)?.get(item.event.eventId);
        const exitClose = closeOf(exitRow);
        if (
          !exitRow ||
          exitClose === null ||
          !booleanValue(exitRow.values, "canSellAtClose", false)
        ) {
          continue;
        }
        samples.push({
          eventId: item.event.eventId,
          eventDate: item.event.tradeDate,
          year: Number(item.event.tradeDate.slice(0, 4)),
          isSignal: item.isSignal,
          horizon,
          netReturn: exitClose / entryOpen - 1,
        });
      }
    }

    const hasEvaluationWindow =
      context.protocol !== null && context.protocol.evaluationWindow !== null;
    const datasetEventCount = hasEvaluationWindow
      ? null
      : context.dataset.facts.totalEvents;
    const unscannedEventCount =
      datasetEventCount === null
        ? null
        : Math.max(0, datasetEventCount - uniqueEvents.length);
    context.log(
      `候选 ${uniqueEvents.length}；eligible ${eligible.length}；信号 ${signalCount}；` +
        `入场不可买 ${entryUnfillableCount}；样本 ${samples.length}`
    );

    return assembleOversoldGapReversalResult({
      phase: context.protocol?.phase ?? "EXPLORATORY",
      protocolFingerprint: context.protocol?.protocolFingerprint ?? null,
      candidateCount: uniqueEvents.length,
      eligibleCount: eligible.length,
      signalCount,
      entryUnfillableCount,
      excludedByReason,
      datasetEventCount,
      unscannedEventCount,
      duplicateEventIdCount,
      samples,
    });
  },
};

export default oversoldGapReversalValidationExperiment;
