import { gzipSync } from "node:zlib";
import type {
  ExperimentDefinition,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import { FoundationCurveAccumulator } from "../../shared/firstBoardPullback/curves";
import { loadNormalizedFoundationEvents } from "../../shared/firstBoardPullback/dataset";
import { buildPanelRowsForEvent } from "../../shared/firstBoardPullback/panel";
import {
  DEFAULT_FOUNDATION_COST,
  FIRST_BOARD_PULLBACK_EPSILON,
  FIRST_BOARD_PULLBACK_MAX_RELATIVE_DAY,
  type FoundationGroup,
  type NormalizedFoundationBar,
} from "../../shared/firstBoardPullback/types";
import {
  COMPUTATION_VERSION,
  DEFAULT_MAX_GAP_PCT,
  DEFAULT_MAX_EVENTS,
  DEFAULT_NO_LIMIT_DAYS,
  DEFAULT_NO_PREVIOUS_LIMIT_DAYS,
  ENTRY_DAY,
  EXCLUSION_REASON_LABELS,
  MAX_EXIT_DAY,
  SUPPORT_GROUP_CODES,
  SUPPORT_GROUP_LABELS,
  assembleBodyMaSupportScreenResult,
  supportScreenPayloadSchema,
  type SupportGroupCode,
  type SupportGroupCountRow,
} from "./result";

const PREFIX_DAYS = Array.from({ length: 19 }, (_, index) => -(index + 1));

function usable(
  bar: NormalizedFoundationBar | undefined
): bar is NormalizedFoundationBar {
  return (
    bar !== undefined &&
    bar.barPresent &&
    !bar.suspended &&
    bar.structurallyValid
  );
}

function movingAverage(
  closes: ReadonlyMap<number, number>,
  relativeDay: number,
  days: number
): number | null {
  let sum = 0;
  for (
    let day = relativeDay - days + 1;
    day <= relativeDay;
    day += 1
  ) {
    const close = closes.get(day);
    if (close === undefined) return null;
    sum += close;
  }
  return sum / days;
}

export const bodyMaSupportScreenStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/body-ma-support-screen-study",
    name: "首板实体与均线支撑筛选研究",
    version: COMPUTATION_VERSION,
    description:
      "筛选首板高开不超过阈值、T+1..T+5 不触涨跌停、T-10 内无涨停的事件。" +
      "分别观察 T+1..T+5 收盘不破首板实体顶、实体 1/2、实体底，以及 MA5/MA10/MA20。" +
      "T+6 开盘入场，退出按实际持有日对齐，不输出固定 T+10/T+20 单点结论。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "body-support",
      "moving-average",
      "screen",
      "entry-aligned",
    ],
    parameters: [
      {
        code: "maxGapPct",
        label: "首板最大高开",
        description: "首板日 open / previousClose - 1 的最大值，单位 %。",
        kind: "NUMBER",
        required: false,
        defaultValue: DEFAULT_MAX_GAP_PCT,
        bounds: { min: -10, max: 10 },
        unit: "%",
      },
      {
        code: "excludeOneWordLimitUp",
        label: "排除一字板",
        description: "首板日 O=H=L=C=limitUpPrice 时排除。",
        kind: "BOOLEAN",
        required: false,
        defaultValue: true,
      },
      {
        code: "maxEvents",
        label: "最大事件数",
        description: "按事件日 / eventId 确定性排序后扫描的事件上限。",
        kind: "INT",
        required: false,
        defaultValue: DEFAULT_MAX_EVENTS,
        bounds: { min: 100, max: DEFAULT_MAX_EVENTS },
        unit: "个事件",
      },
      {
        code: "bootstrapIterations",
        label: "Bootstrap 次数",
        description: "锚点持有日的日期聚类 Bootstrap 次数。",
        kind: "INT",
        required: false,
        defaultValue: 1000,
        bounds: { min: 100, max: 5000 },
        unit: "次",
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
          "previousLimitDate",
          "daysSincePreviousLimit",
        ],
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
      prefixRelativeDays: [0, ...PREFIX_DAYS],
      postRelativeDays: Array.from(
        { length: MAX_EXIT_DAY },
        (_, index) => index + 1
      ),
      decisionOffsetDays: DEFAULT_NO_LIMIT_DAYS,
      usesForwardData: true,
      forwardDataPurpose:
        "T+1..T+5 判断实体和均线支撑，T+6 开盘入场并观察实际持有日退出。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/body-ma-support-screen-study",
    pageTitle: "实体 / 均线支撑筛选",
  },
  resultSchema: supportScreenPayloadSchema,
  run: async (context: ExperimentRunContext) => {
    const maxGap = (context.parameters.maxGapPct as number) / 100;
    const excludeOneWord = context.parameters.excludeOneWordLimitUp as boolean;
    const maxEvents = context.parameters.maxEvents as number;
    const bootstrapIterations = context.parameters
      .bootstrapIterations as number;
    const eventRows = await context.dataset.events();
    const selectedEventIds = eventRows
      .slice()
      .sort((left, right) =>
        left.tradeDate === right.tradeDate
          ? left.eventId.localeCompare(right.eventId)
          : left.tradeDate.localeCompare(right.tradeDate)
      )
      .slice(0, maxEvents)
      .map(event => event.eventId);
    context.freezeSelection(selectedEventIds);
    const loaded = await loadNormalizedFoundationEvents(
      context,
      selectedEventIds
    );
    const prefixClosesByEvent = new Map<string, Map<number, number>>();
    for (const day of PREFIX_DAYS) {
      const bars = await context.dataset.feature(day);
      for (const bar of bars) {
        const close = bar.values.close;
        if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) {
          continue;
        }
        const map =
          prefixClosesByEvent.get(bar.eventId) ?? new Map<number, number>();
        map.set(day, close);
        prefixClosesByEvent.set(bar.eventId, map);
      }
    }

    const excludedByReason: Record<string, number> = {};
    const addExclusion = (code: string): void => {
      excludedByReason[code] = (excludedByReason[code] ?? 0) + 1;
    };

    let afterGapCount = 0;
    let afterNoLimitCount = 0;
    let afterNoPreviousLimitCount = 0;
    let eligibleCount = 0;
    let commonSampleCount = 0;
    const groupEventCounts = new Map<SupportGroupCode, number>(
      SUPPORT_GROUP_CODES.map(code => [code, 0])
    );
    const groupCommonCounts = new Map<SupportGroupCode, number>(
      SUPPORT_GROUP_CODES.map(code => [code, 0])
    );
    const accumulator = new FoundationCurveAccumulator(bootstrapIterations);
    const membershipLines = [
      [
        "event_id",
        "event_date",
        "body_top",
        "body_half",
        "body_bottom",
        "ma5",
        "ma10",
        "ma20",
      ].join(",") + "\n",
    ];
    let missingMaHistoryCount = 0;

    for (const event of loaded.events) {
      if (excludeOneWord && event.oneWordLimitUp) {
        addExclusion("ONE_WORD_LIMIT_UP");
        continue;
      }
      const gap = event.open / event.previousClose - 1;
      if (gap > maxGap + FIRST_BOARD_PULLBACK_EPSILON) {
        addExclusion("GAP_OVER_LIMIT");
        continue;
      }
      afterGapCount += 1;

      let contextUsable = true;
      let limitTouched = false;
      for (let day = 1; day <= DEFAULT_NO_LIMIT_DAYS; day += 1) {
        const bar = event.barsByRelativeDay.get(day);
        if (!usable(bar)) {
          contextUsable = false;
          break;
        }
        if (
          bar.high! >= bar.limitUpPrice! - FIRST_BOARD_PULLBACK_EPSILON ||
          bar.low! <= bar.limitDownPrice! + FIRST_BOARD_PULLBACK_EPSILON
        ) {
          limitTouched = true;
          break;
        }
      }
      if (!contextUsable) {
        addExclusion("MISSING_CONTEXT_BAR");
        continue;
      }
      if (limitTouched) {
        addExclusion("LIMIT_TOUCH_IN_CONTEXT");
        continue;
      }
      afterNoLimitCount += 1;

      if (event.daysSincePreviousLimit === null) {
        addExclusion("MISSING_PREVIOUS_LIMIT_HISTORY");
        continue;
      }
      if (
        event.daysSincePreviousLimit <= DEFAULT_NO_PREVIOUS_LIMIT_DAYS
      ) {
        addExclusion("PREVIOUS_LIMIT_TOO_CLOSE");
        continue;
      }
      afterNoPreviousLimitCount += 1;

      const contextCloses = new Map<number, number>();
      for (const [day, value] of prefixClosesByEvent.get(event.eventId) ?? []) {
        contextCloses.set(day, value);
      }
      contextCloses.set(0, event.close);
      for (let day = 1; day <= DEFAULT_NO_LIMIT_DAYS; day += 1) {
        const close = event.barsByRelativeDay.get(day)?.close;
        if (typeof close === "number" && Number.isFinite(close) && close > 0) {
          contextCloses.set(day, close);
        }
      }

      const bodyTop = Math.max(event.open, event.close);
      const bodyBottom = Math.min(event.open, event.close);
      const bodyHalf = (bodyTop + bodyBottom) / 2;
      const bodyConditions: Record<
        "BODY_TOP" | "BODY_HALF" | "BODY_BOTTOM",
        boolean
      > = {
        BODY_TOP: true,
        BODY_HALF: true,
        BODY_BOTTOM: true,
      };
      for (let day = 1; day <= DEFAULT_NO_LIMIT_DAYS; day += 1) {
        const close = contextCloses.get(day);
        if (close === undefined) continue;
        if (close < bodyTop - FIRST_BOARD_PULLBACK_EPSILON) {
          bodyConditions.BODY_TOP = false;
        }
        if (close < bodyHalf - FIRST_BOARD_PULLBACK_EPSILON) {
          bodyConditions.BODY_HALF = false;
        }
        if (close < bodyBottom - FIRST_BOARD_PULLBACK_EPSILON) {
          bodyConditions.BODY_BOTTOM = false;
        }
      }

      const maConditions: Record<"MA5" | "MA10" | "MA20", boolean> = {
        MA5: true,
        MA10: true,
        MA20: true,
      };
      for (let day = 1; day <= DEFAULT_NO_LIMIT_DAYS; day += 1) {
        const close = contextCloses.get(day);
        if (close === undefined) continue;
        for (const [code, length] of [
          ["MA5", 5],
          ["MA10", 10],
          ["MA20", 20],
        ] as const) {
          const ma = movingAverage(contextCloses, day, length);
          if (ma === null || close < ma - FIRST_BOARD_PULLBACK_EPSILON) {
            maConditions[code] = false;
          }
        }
      }
      if (Object.values(maConditions).some(value => value === true)) {
        for (const code of ["MA5", "MA10", "MA20"] as const) {
          const complete = movingAverage(
            contextCloses,
            DEFAULT_NO_LIMIT_DAYS,
            code === "MA5" ? 5 : code === "MA10" ? 10 : 20
          );
          if (complete === null) {
            maConditions[code] = false;
            missingMaHistoryCount += 1;
          }
        }
      }

      const groups: FoundationGroup[] = [];
      for (const code of SUPPORT_GROUP_CODES) {
        const passed =
          code in bodyConditions
            ? bodyConditions[code as keyof typeof bodyConditions]
            : maConditions[code as keyof typeof maConditions];
        if (passed) groups.push({ code, label: SUPPORT_GROUP_LABELS[code] });
      }

      const panel = buildPanelRowsForEvent(
        event,
        "FIXED_T6_OPEN",
        DEFAULT_FOUNDATION_COST
      );
      if (panel.entryUnavailable) {
        addExclusion("ENTRY_UNFILLABLE");
        continue;
      }
      eligibleCount += 1;
      if (panel.commonSample) commonSampleCount += 1;
      const groupCodes = new Set(groups.map(group => group.code));
      for (const code of SUPPORT_GROUP_CODES) {
        if (groupCodes.has(code)) {
          groupEventCounts.set(code, (groupEventCounts.get(code) ?? 0) + 1);
          if (panel.commonSample) {
            groupCommonCounts.set(
              code,
              (groupCommonCounts.get(code) ?? 0) + 1
            );
          }
        }
      }
      membershipLines.push(
        [
          event.eventId,
          event.eventDate,
          groupCodes.has("BODY_TOP") ? 1 : 0,
          groupCodes.has("BODY_HALF") ? 1 : 0,
          groupCodes.has("BODY_BOTTOM") ? 1 : 0,
          groupCodes.has("MA5") ? 1 : 0,
          groupCodes.has("MA10") ? 1 : 0,
          groupCodes.has("MA20") ? 1 : 0,
        ].join(",") + "\n"
      );
      accumulator.addRows(panel.rows, groups);
    }

    const { curveRows, bootstrapRows } = accumulator.finalize();
    const groupCounts: SupportGroupCountRow[] = SUPPORT_GROUP_CODES.map(
      code => ({
        group_code: code,
        group_label: SUPPORT_GROUP_LABELS[code],
        event_count: groupEventCounts.get(code) ?? 0,
        common_sample_event_count: groupCommonCounts.get(code) ?? 0,
      })
    );
    context.artifact({
      name: "body-ma-support/membership.csv.gz",
      role: "table",
      body: new Uint8Array(gzipSync(Buffer.from(membershipLines.join("")), { level: 6 })),
      contentType: "application/gzip",
      label: "实体与均线支撑分组 membership",
    });
    context.log(
      `高开后 ${afterGapCount}；无涨跌停 ${afterNoLimitCount}；` +
        `T-10无涨停 ${afterNoPreviousLimitCount}；可入场 ${eligibleCount}；` +
        `commonSample ${commonSampleCount}；MA历史缺失 ${missingMaHistoryCount}`
    );

    return assembleBodyMaSupportScreenResult({
      maxGapPct: maxGap * 100,
      excludeOneWordLimitUp: excludeOneWord,
      maxEvents,
      candidateCount: loaded.events.length,
      datasetEventCount: context.dataset.facts.totalEvents,
      unscannedEventCount:
        context.dataset.facts.totalEvents === null
          ? null
          : Math.max(
              0,
              context.dataset.facts.totalEvents - loaded.events.length
            ),
      afterGapCount,
      afterNoLimitCount,
      afterNoPreviousLimitCount,
      eligibleCount,
      commonSampleCount,
      groupCounts,
      excludedByReason,
      curveRows,
      bootstrapRows,
    });
  },
};

export default bodyMaSupportScreenStudyExperiment;
