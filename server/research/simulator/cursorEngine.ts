import type { ResearchDatasetCursor } from "../framework/datasetCursor";
import type { ResearchDataset, ResearchDatasetRow, UniverseDayResult } from "../../researchDataset/types";
import {
  RESEARCH_DATASET_BUILDER_VERSION,
  RESEARCH_DATASET_ROW_SCHEMA_VERSION,
} from "../../researchDataset/types";
import type { CandidateEvaluationRun } from "../signalEngine/types";
import type { SecurityBoard, SimulationConfig, TradeSimulationRun } from "./types";
import { runTradeSimulation } from "./engine";

/**
 * 按候选 run 只保留可能被模拟器触碰的证券行。
 *
 * 核心性质：模拟器消费的证券集合只可能来自 `sourceRun.days[].positionIntents`；池化面板里
 * 未入选成员完全不需要进入回测。因此该函数在流式读取时构造一个“紧凑数据集”，既保留原
 * datasetVersion/交易日序列，又把 rows 从全池成员压缩到选中成员及其退出尾窗 bars。
 */
export async function buildCompactResearchDatasetFromCursor(
  cursor: ResearchDatasetCursor,
  sourceRun: CandidateEvaluationRun,
): Promise<ResearchDataset> {
  if (cursor.metadata.datasetVersion !== sourceRun.datasetVersion) {
    throw new Error(
      `紧凑数据集：cursor.datasetVersion=${cursor.metadata.datasetVersion} 与 candidateRun.datasetVersion=${sourceRun.datasetVersion} 不一致`,
    );
  }
  const selectedIds = new Set(
    sourceRun.days.flatMap(day => day.positionIntents.map(intent => intent.securityId)),
  );
  const intentsByDate = new Map(
    sourceRun.days.map(day => [day.date, day.positionIntents.map(intent => intent.securityId)] as const),
  );
  const rows: ResearchDatasetRow[] = [];
  const days: UniverseDayResult[] = [];
  const rangeStart = sourceRun.dateRange.startDate;
  const rangeEnd = cursor.metadata.endDate;
  for (const tradeDate of cursor.tradingDates) {
    const slice = await cursor.getDaySlice(tradeDate);
    if (tradeDate < rangeStart || tradeDate > rangeEnd) continue;
    days.push({
      tradeDate,
      isTradingDay: slice.isTradingDay,
      members: intentsByDate.get(tradeDate) ?? [],
      excludedByReason: {},
    });
    for (const row of slice.rows) {
      if (selectedIds.has(row.securityId)) rows.push(row);
    }
  }
  rows.sort((left, right) =>
    left.tradeDate === right.tradeDate
      ? left.securityId.localeCompare(right.securityId)
      : left.tradeDate.localeCompare(right.tradeDate),
  );
  const dates = days.filter(day => day.isTradingDay).map(day => day.tradeDate);
  return {
    datasetVersion: cursor.metadata.datasetVersion,
    universeDefinition: {
      rule: "流式池化紧凑数据集：仅保留 candidateRun 选中证券及其执行/退出 bars；交易日序列来自原 cursor。",
      asOfDescription: "逐日 PIT（asOf = tradeDate）",
      days,
    },
    policySet: [],
    dataSnapshot: {
      capturedAt: "1970-01-01T00:00:00.000Z",
      request: {
        name: "pooled-streaming-compact-dataset",
        startDate: sourceRun.dateRange.startDate,
        endDate: cursor.metadata.endDate,
        asOfPerTradeDate: true,
        asOf: null,
        coreIndexCodes: [],
        universeFilter: {
          boards: [],
          excludeSt: false,
          tDayCondition: "none",
          pullback: null,
        },
      },
      calendarName: `pooled-cursor:${cursor.metadata.datasetVersion}`,
      calendarFirstDate: dates[0] ?? cursor.metadata.startDate,
      calendarLastDate: dates[dates.length - 1] ?? cursor.metadata.endDate,
      tradingDays: dates.length,
      domains: [
        {
          domain: "A OHLCV",
          rowsLoaded: rows.length,
          securitiesCovered: selectedIds.size,
          datesCovered: new Set(rows.map(row => row.tradeDate)).size,
          datesExpected: dates.length,
          note: "由 PooledDatasetCursor 按候选成员及退出尾窗流式抽取。",
        },
      ],
      coverageGaps: [],
    },
    rows,
    gate: cursor.metadata.gate,
    gateNotes: [
      `流式紧凑数据集：builder=${RESEARCH_DATASET_BUILDER_VERSION} / rowSchema=${RESEARCH_DATASET_ROW_SCHEMA_VERSION}`,
    ],
  };
}

/** 从 research 期间保留的真实行构造紧凑数据集（不重放、不二次查询）。 */
function buildCompactResearchDatasetFromRetainedRows(
  cursor: ResearchDatasetCursor,
  sourceRun: CandidateEvaluationRun,
  retainedRows: readonly ResearchDatasetRow[],
): ResearchDataset {
  const intentsByDate = new Map(
    sourceRun.days.map(day => [day.date, day.positionIntents.map(intent => intent.securityId)] as const),
  );
  const rangeStart = sourceRun.dateRange.startDate;
  const rangeEnd = cursor.metadata.endDate;
  const days: UniverseDayResult[] = cursor.tradingDates
    .filter(tradeDate => tradeDate >= rangeStart && tradeDate <= rangeEnd)
    .map(tradeDate => ({
      tradeDate,
      isTradingDay: true,
      members: intentsByDate.get(tradeDate) ?? [],
      excludedByReason: {},
    }));
  const rows = [...retainedRows].sort((left, right) =>
    left.tradeDate === right.tradeDate
      ? left.securityId.localeCompare(right.securityId)
      : left.tradeDate.localeCompare(right.tradeDate),
  );
  const dates = days.map(day => day.tradeDate);
  return {
    datasetVersion: cursor.metadata.datasetVersion,
    universeDefinition: {
      rule: "流式池化紧凑数据集：直接复用 research 期间为买入候选保留的逐日真实行。",
      asOfDescription: "逐日 PIT（asOf = tradeDate）",
      days,
    },
    policySet: [],
    dataSnapshot: {
      capturedAt: "1970-01-01T00:00:00.000Z",
      request: {
        name: "pooled-streaming-retained-dataset",
        startDate: rangeStart,
        endDate: rangeEnd,
        asOfPerTradeDate: true,
        asOf: null,
        coreIndexCodes: [],
        universeFilter: {
          boards: [],
          excludeSt: false,
          tDayCondition: "none",
          pullback: null,
        },
      },
      calendarName: `pooled-cursor-retained:${cursor.metadata.datasetVersion}`,
      calendarFirstDate: dates[0] ?? cursor.metadata.startDate,
      calendarLastDate: dates[dates.length - 1] ?? cursor.metadata.endDate,
      tradingDays: dates.length,
      domains: [
        {
          domain: "A OHLCV",
          rowsLoaded: rows.length,
          securitiesCovered: new Set(rows.map(row => row.securityId)).size,
          datesCovered: new Set(rows.map(row => row.tradeDate)).size,
          datesExpected: dates.length,
          note: "research 期间按 candidate positionIntent 身份保留，无第二遍数据读取。",
        },
      ],
      coverageGaps: [],
    },
    rows,
    gate: cursor.metadata.gate,
    gateNotes: [
      `流式保留数据集：builder=${RESEARCH_DATASET_BUILDER_VERSION} / rowSchema=${RESEARCH_DATASET_ROW_SCHEMA_VERSION}`,
    ],
  };
}

/** 先构造紧凑数据集，再复用现有同步交易模拟器，保证撮合语义只有一份。 */
export async function runTradeSimulationFromCursor(input: {
  readonly cursor: ResearchDatasetCursor;
  readonly sourceRun: CandidateEvaluationRun;
  readonly simConfig: SimulationConfig;
}): Promise<TradeSimulationRun> {
  const retainedRows = input.cursor.takeRetainedRows?.();
  const dataset =
    retainedRows !== undefined && retainedRows.length > 0
      ? buildCompactResearchDatasetFromRetainedRows(input.cursor, input.sourceRun, retainedRows)
      : await (async () => {
          // 兼容 memory cursor / 未实现保留的旧实现：才回退到 restart+replay。
          if (input.cursor.restart !== undefined) await input.cursor.restart();
          return buildCompactResearchDatasetFromCursor(input.cursor, input.sourceRun);
        })();
  const securityBoards: Record<string, SecurityBoard> = {};
  for (const row of dataset.rows) {
    if (securityBoards[row.securityId] !== undefined) continue;
    const code = row.code ?? "";
    securityBoards[row.securityId] = row.exchange === "BJ"
      ? "bse"
      : code.startsWith("688")
        ? "star"
        : code.startsWith("300") || code.startsWith("301")
          ? "gem"
          : "main";
  }
  // cursor end 已按 poolAge + exitTail 扩展；回测必须消费完整尾窗，不能退回决策窗末端。
  const executionRangeEnd = input.cursor.metadata.endDate;
  return runTradeSimulation({
    dataset,
    sourceRun: input.sourceRun,
    simConfig: {
      ...input.simConfig,
      dateRange: {
        startDate: input.simConfig.dateRange?.startDate ?? input.sourceRun.dateRange.startDate,
        endDate: executionRangeEnd,
      },
      securityBoards: { ...securityBoards, ...input.simConfig.securityBoards },
    },
  });
}
