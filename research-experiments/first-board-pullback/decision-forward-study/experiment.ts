/**
 * 首板后回踩决策时点后续收益研究。
 *
 * 与 EXP-001 的关键区别：收益严格从决策日 T+k 收盘起算，窗口是 rd ∈ [k+1, h]；
 * 不再把 T+1…T+k 的路径涨幅混入未来收益。这个实验用于判断路径分组在
 * 「决策时点之后」是否仍有可观察差异。
 */

import {
  EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
  type ExperimentDefinition,
  type ExperimentEventRow,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  MAX_DECISION_DAY,
  MAX_FORWARD_HORIZON,
  assembleDecisionForwardResult,
  decisionForwardCustomPayloadSchema,
  type ForwardGroupCode,
  type ForwardSample,
} from "./result";

const DECISION_DAYS = [1, 2, 3, 4, 5] as const;
const FORWARD_HORIZONS = [10, 20] as const;
const POST_RELATIVE_DAYS = Array.from({ length: MAX_FORWARD_HORIZON }, (_, index) => index + 1);

interface ValidBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function parseOhlc(values: Readonly<Record<string, number | boolean | string | null>>): ValidBar | null {
  const open = finitePositive(values.open);
  const high = finitePositive(values.high);
  const low = finitePositive(values.low);
  const close = finitePositive(values.close);
  if (open === null || high === null || low === null || close === null) return null;
  if (high < low || high < open || high < close || low > open || low > close) return null;
  return { open, high, low, close };
}

function uniqueSortedIntegers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function drawdownGroup(depth: number): ForwardGroupCode {
  if (depth >= 0) return "NO_PULLBACK";
  if (depth >= -0.02) return "DD_200BP";
  if (depth >= -0.05) return "DD_500BP";
  if (depth >= -0.08) return "DD_800BP";
  if (depth >= -0.10) return "DD_1000BP";
  return "DD_BELOW_1000BP";
}

function sortEventRows(left: ExperimentEventRow, right: ExperimentEventRow): number {
  return left.tradeDate === right.tradeDate
    ? left.eventId.localeCompare(right.eventId)
    : left.tradeDate.localeCompare(right.tradeDate);
}

export const decisionForwardStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/decision-forward-study",
    name: "首板后回踩决策时点后续收益研究",
    version: COMPUTATION_VERSION,
    description:
      "在 T+k 决策日收盘时，仅使用 T+1…T+k 已可见路径判定是否跌破首板日开盘价及回撤深度，" +
      "再计算 T+k 收盘到 T+h 收盘的毛收益与成本后净收益。收益窗口严格在决策时点之后，" +
      `h > k；不产出最优决策日、最优视界、策略或参数候选。`,
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "decision-time", "forward-return", "independent-experiment"],
    parameters: [
      {
        code: "decisionDays",
        label: "决策日集合",
        description: `在哪些相对日 T+k 以收盘时可见路径做分组，允许值 1..${MAX_DECISION_DAY}。`,
        kind: "INT_LIST",
        required: false,
        defaultValue: [...DECISION_DAYS],
        bounds: { min: 1, max: MAX_DECISION_DAY },
        unit: "相对日",
      },
      {
        code: "forwardHorizons",
        label: "后续收益视界",
        description: `收益终点 T+h，必须大于所有决策日；当前 Dataset 最大支持 ${MAX_FORWARD_HORIZON}。`,
        kind: "INT_LIST",
        required: false,
        defaultValue: [...FORWARD_HORIZONS],
        bounds: { min: MAX_DECISION_DAY + 1, max: MAX_FORWARD_HORIZON },
        unit: "相对日",
      },
      {
        code: "maxEvents",
        label: "最大事件数",
        description: "按事件日 / eventId 排序后最多纳入多少个核心候选事件。",
        kind: "INT",
        required: false,
        defaultValue: EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
        bounds: { min: 1, max: EXPERIMENT_EVENT_SCAN_HARD_LIMIT },
        unit: "个事件",
      },
      {
        code: "roundTripCostBps",
        label: "往返成本",
        description: "从毛收益中统一扣除的敏感性成本；不是完整撮合 / 税费模型。",
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
        observation: ["open", "high", "low", "close"],
      },
      prefixRelativeDays: [0],
      postRelativeDays: POST_RELATIVE_DAYS,
      decisionOffsetDays: MAX_DECISION_DAY,
      usesForwardData: true,
      forwardDataPurpose:
        "计算决策日之后 T+k 收盘到 T+h 收盘的收益，并检查未来窗口是否齐备；未来数据不用于新增核心候选事件。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/decision-forward-study",
    pageTitle: "决策时点后续收益研究",
  },
  resultSchema: decisionForwardCustomPayloadSchema,

  run: async (context: ExperimentRunContext) => {
    const { dataset, parameters, log } = context;
    const decisionDays = uniqueSortedIntegers(parameters.decisionDays as number[]);
    const forwardHorizons = uniqueSortedIntegers(parameters.forwardHorizons as number[]);
    const maxEvents = parameters.maxEvents as number;
    const costBps = parameters.roundTripCostBps as number;

    if (decisionDays.length === 0) throw new Error("decisionDays 不得为空");
    if (forwardHorizons.length === 0) throw new Error("forwardHorizons 不得为空");
    const maxDecisionDay = Math.max(...decisionDays);
    if (decisionDays.some((day) => day < 1 || day > MAX_DECISION_DAY)) {
      throw new Error(`decisionDays 必须落在 1..${MAX_DECISION_DAY}`);
    }
    if (forwardHorizons.some((horizon) => horizon > MAX_FORWARD_HORIZON)) {
      throw new Error(`forwardHorizons 不得超过 ${MAX_FORWARD_HORIZON}`);
    }
    if (forwardHorizons.some((horizon) => horizon <= maxDecisionDay)) {
      throw new Error(
        `所有 forwardHorizons 必须严格大于最大决策日 T+${maxDecisionDay}；` +
          `当前 = [${forwardHorizons.join(", ")}]`,
      );
    }

    const events = await dataset.events();
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

    // 冻结核心候选后，后续读取只服务已冻结事件；未来数据不能反向新增样本。
    context.freezeSelection(usedEvents.map((event) => event.eventId));

    const eventDayBars = await dataset.feature(0);
    const eventDayByEvent = new Map<string, ValidBar>();
    const eventDayBarEventIds = new Set<string>();
    for (const bar of eventDayBars) {
      eventDayBarEventIds.add(bar.eventId);
      const parsed = parseOhlc(bar.values);
      if (parsed !== null) {
        eventDayByEvent.set(bar.eventId, parsed);
      }
    }
    let missingEventDayBarCount = 0;
    let invalidEventDayCount = 0;
    for (const event of usedEvents) {
      if (!eventDayBarEventIds.has(event.eventId)) missingEventDayBarCount += 1;
      else if (!eventDayByEvent.has(event.eventId)) invalidEventDayCount += 1;
    }

    const observationsByDay: Array<Map<string, ValidBar>> = Array.from(
      { length: MAX_FORWARD_HORIZON + 1 },
      () => new Map<string, ValidBar>(),
    );
    const invalidObservationDaysByEvent = new Map<string, Set<number>>();
    let observationBarRowsRead = 0;
    for (let day = 1; day <= MAX_FORWARD_HORIZON; day += 1) {
      const rows = await dataset.observation(day);
      observationBarRowsRead += rows.length;
      for (const row of rows) {
        const parsed = parseOhlc(row.values);
        if (parsed === null) {
          const days = invalidObservationDaysByEvent.get(row.eventId) ?? new Set<number>();
          days.add(day);
          invalidObservationDaysByEvent.set(row.eventId, days);
        } else {
          observationsByDay[day]!.set(row.eventId, parsed);
        }
      }
    }

    const excludedByReason: Record<string, number> = {};
    const addExclusion = (code: string, count: number): void => {
      if (count > 0) excludedByReason[code] = (excludedByReason[code] ?? 0) + count;
    };
    addExclusion("MAX_EVENTS_LIMIT", droppedByMaxEvents);

    let missingDecisionPathEventCount = 0;
    let invalidDecisionPathEventCount = 0;
    let invalidDecisionPathBarCount = 0;
    const samples: ForwardSample[] = [];
    let eligibleCount = 0;

    for (const event of usedEvents) {
      const eventDay = eventDayByEvent.get(event.eventId);
      if (eventDay === undefined) {
        addExclusion(
          eventDayBars.some((bar) => bar.eventId === event.eventId)
            ? "INVALID_EVENT_DAY_OHLC"
            : "MISSING_EVENT_DAY_BAR",
          1,
        );
        continue;
      }

      const path: Array<ValidBar | null> = [];
      let invalidPathBars = 0;
      let missingPathBars = 0;
      for (let day = 1; day <= MAX_FORWARD_HORIZON; day += 1) {
        const bar = observationsByDay[day]!.get(event.eventId) ?? null;
        path[day] = bar;
        if (bar === null) {
          if (invalidObservationDaysByEvent.get(event.eventId)?.has(day) === true) {
            invalidPathBars += 1;
          } else {
            missingPathBars += 1;
          }
        }
      }

      const decisionPathComplete = path
        .slice(1, maxDecisionDay + 1)
        .every((bar) => bar !== null);
      if (!decisionPathComplete) {
        if (missingPathBars > 0) {
          missingDecisionPathEventCount += 1;
          addExclusion("MISSING_DECISION_PATH_BAR", 1);
        } else {
          invalidDecisionPathEventCount += 1;
          addExclusion("INVALID_DECISION_PATH_OHLC", 1);
        }
        continue;
      }

      eligibleCount += 1;
      const validPrefix = [0];
      for (let day = 1; day <= MAX_FORWARD_HORIZON; day += 1) {
        validPrefix[day] = validPrefix[day - 1]! + (path[day] === null ? 0 : 1);
      }
      let minLowThroughDecision = Number.POSITIVE_INFINITY;

      for (const decisionDay of decisionDays) {
        minLowThroughDecision = Math.min(
          minLowThroughDecision,
          path[decisionDay]!.low,
        );
        const decisionBar = path[decisionDay]!;
        const nonBreak = minLowThroughDecision >= eventDay.open;
        const depth = minLowThroughDecision / eventDay.close - 1;
        const groups: ForwardGroupCode[] = [
          "ALL",
          nonBreak ? "NON_BREAK_OPEN" : "BREAK_OPEN",
          drawdownGroup(depth),
        ];
        const year = Number(event.tradeDate.slice(0, 4));

        for (const horizon of forwardHorizons) {
          const windowComplete =
            validPrefix[horizon]! - validPrefix[decisionDay]! === horizon - decisionDay;
          const exitBar = path[horizon];
          const grossReturn =
            windowComplete && exitBar !== null
              ? exitBar.close / decisionBar.close - 1
              : null;
          samples.push({
            eventId: event.eventId,
            year,
            decisionDay,
            horizon,
            groups,
            grossReturn,
          });
        }
      }

      invalidDecisionPathBarCount += invalidPathBars;
    }

    const excludedCount = uniqueEvents.length - eligibleCount;
    const exclusionSum = Object.values(excludedByReason).reduce((sum, count) => sum + count, 0);
    if (excludedCount !== exclusionSum) {
      throw new Error(
        `样本账不平：candidate - eligible = ${excludedCount}，但剔除原因合计 = ${exclusionSum}`,
      );
    }

    const datasetEventCount = dataset.facts.totalEvents;
    const unscannedEventCount =
      datasetEventCount === null ? null : Math.max(0, datasetEventCount - uniqueEvents.length);
    log(
      `扫描 ${events.length} 行，去重后候选 ${uniqueEvents.length}，核心样本 ${eligibleCount}；` +
        `决策日 [${decisionDays.join(", ")}]，视界 [${forwardHorizons.join(", ")}]`,
    );
    log(`事件日行情 ${eventDayBars.length} 行；观察日行情 ${observationBarRowsRead} 行`);

    return assembleDecisionForwardResult({
      decisionDays,
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
      eventScanPolicy: "FULL_DATASET",
      scanLimit: EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
      duplicateEventIdCount,
      eventDayBarRowsRead: eventDayBars.length,
      observationBarRowsRead,
      missingEventDayBarCount,
      invalidEventDayCount,
      missingDecisionPathEventCount,
      invalidDecisionPathEventCount,
      invalidDecisionPathBarCount,
      protocol: context.protocol,
    });
  },
};

export default decisionForwardStudyExperiment;
