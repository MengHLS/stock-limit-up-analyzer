import type { ResearchDatasetCursor } from "../framework/datasetCursor";
import type { ResearchDataset, ResearchDatasetRow, UniverseDayResult } from "../../researchDataset/types";
import {
  RESEARCH_DATASET_BUILDER_VERSION,
  RESEARCH_DATASET_ROW_SCHEMA_VERSION,
} from "../../researchDataset/types";
import type { CandidateEvaluationRun } from "../signalEngine/types";
import type { SecurityBoard, SimulationConfig, TradeSimulationRun } from "./types";
import { runTradeSimulation } from "./engine";
import { BAR_RANGE_READ_CHUNK_SIZE, DbBarStore } from "../../backtest/dbBarStore";
import type { CanonicalMarketBar } from "../../data/types";

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
  overlayStats: ExecutionOverlayStats = EMPTY_EXECUTION_OVERLAY_STATS,
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
      `Execution Overlay：identity=${overlayStats.identityCount} code=${overlayStats.codeCount} window=[${String(overlayStats.windowStart)}..${String(overlayStats.windowEnd)}] loaded=${overlayStats.rowsLoaded} merged=${overlayStats.rowsMerged} chunks=${overlayStats.queryChunks}` + (overlayStats.skippedReason === null ? '' : ` skipped=${overlayStats.skippedReason}`),
    ],
  };
}


// ---------------------------------------------------------------------------
// Execution Overlay（FIX-003 方案 A）
//
// Signal Membership != Execution Holding Data。
// 本层为**实际产生 positionIntent 的面板身份**按 (code, tradeDate) 补一份日线 overlay，
// 与事件窗行按 (panelIdentity, tradeDate) 合并（事件窗优先）。
// ---------------------------------------------------------------------------

/** Overlay 数据安全边界：首次 intent 日起 +30 个交易日（交易日语义，不是自然日）。 */
export const EXECUTION_OVERLAY_HORIZON_TRADING_DAYS = 30;
/** 时间切片跨度（交易日）：把查询摊成「有界代码数 × 有界日期范围」。 */
const EXECUTION_OVERLAY_SLICE_TRADING_DAYS = 40;

export interface ExecutionOverlayStats {
  readonly identityCount: number;
  readonly codeCount: number;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly rowsLoaded: number;
  readonly rowsMerged: number;
  readonly queryChunks: number;
  readonly skippedReason: string | null;
}

export const EMPTY_EXECUTION_OVERLAY_STATS: ExecutionOverlayStats = {
  identityCount: 0, codeCount: 0, windowStart: null, windowEnd: null,
  rowsLoaded: 0, rowsMerged: 0, queryChunks: 0, skippedReason: null,
};

export interface ExecutionOverlayBarReader {
  barsForSecuritiesDateRange(
    securityIds: readonly string[],
    startDate: string,
    endDate: string,
  ): Promise<readonly CanonicalMarketBar[]>;
}

function overlayKey(securityId: string, tradeDate: string): string {
  return tradeDate + '|' + securityId;
}

/** 为已进入 execution lifecycle 的面板身份加载 entryDate -> exitDate 的日线 overlay。 */
export async function loadPositionExecutionOverlay(
  cursor: ResearchDatasetCursor,
  sourceRun: CandidateEvaluationRun,
  retainedRows: readonly ResearchDatasetRow[],
  reader: ExecutionOverlayBarReader = new DbBarStore(),
): Promise<{ readonly rows: readonly ResearchDatasetRow[]; readonly stats: ExecutionOverlayStats }> {
  const identities = new Set<string>();
  const firstIntentDate = new Map<string, string>();
  for (const day of sourceRun.days) {
    for (const intent of day.positionIntents) {
      identities.add(intent.securityId);
      const previous = firstIntentDate.get(intent.securityId);
      if (previous === undefined || day.date < previous) firstIntentDate.set(intent.securityId, day.date);
    }
  }
  if (identities.size === 0) {
    return { rows: [], stats: { ...EMPTY_EXECUTION_OVERLAY_STATS, skippedReason: 'NO_POSITION_INTENT' } };
  }
  const templateById = new Map<string, ResearchDatasetRow>();
  for (const row of retainedRows) {
    if (!identities.has(row.securityId)) continue;
    if (templateById.has(row.securityId)) continue;
    if (typeof row.code !== 'string' || row.code === '') continue;
    templateById.set(row.securityId, row);
  }
  const dates = cursor.tradingDates;
  const indexByDate = new Map(dates.map((date, i) => [date, i] as const));
  const windows: { panelId: string; code: string; fromIdx: number; toIdx: number }[] = [];
  for (const [panelId, template] of templateById) {
    const from = firstIntentDate.get(panelId);
    if (from === undefined) continue;
    const fromIdx = indexByDate.get(from);
    if (fromIdx === undefined) continue;
    windows.push({
      panelId,
      code: template.code as string,
      fromIdx,
      toIdx: Math.min(dates.length - 1, fromIdx + EXECUTION_OVERLAY_HORIZON_TRADING_DAYS),
    });
  }
  if (windows.length === 0) {
    return { rows: [], stats: { ...EMPTY_EXECUTION_OVERLAY_STATS, identityCount: identities.size, skippedReason: 'NO_TEMPLATE_ROW' } };
  }
  const minFrom = Math.min(...windows.map((w) => w.fromIdx));
  const maxTo = Math.max(...windows.map((w) => w.toIdx));
  const byCode = new Map<string, typeof windows>();
  for (const w of windows) {
    const list = byCode.get(w.code) ?? [];
    list.push(w);
    byCode.set(w.code, list);
  }

  const rows: ResearchDatasetRow[] = [];
  let rowsLoaded = 0;
  let queryChunks = 0;
  for (let sliceStart = minFrom; sliceStart <= maxTo; sliceStart += EXECUTION_OVERLAY_SLICE_TRADING_DAYS) {
    const sliceEnd = Math.min(maxTo, sliceStart + EXECUTION_OVERLAY_SLICE_TRADING_DAYS - 1);
    const codes = [...byCode.keys()].filter((code) =>
      byCode.get(code)!.some((w) => w.fromIdx <= sliceEnd && w.toIdx >= sliceStart),
    );
    if (codes.length === 0) continue;
    const bars = await reader.barsForSecuritiesDateRange(codes, dates[sliceStart]!, dates[sliceEnd]!);
    rowsLoaded += bars.length;
    queryChunks += Math.max(1, Math.ceil(new Set(codes).size / BAR_RANGE_READ_CHUNK_SIZE));
    for (const bar of bars) {
      const candidates = byCode.get(bar.symbol);
      if (candidates === undefined) continue;
      const barIdx = indexByDate.get(bar.timestamp);
      if (barIdx === undefined) continue;
      for (const w of candidates) {
        if (barIdx < w.fromIdx || barIdx > w.toIdx) continue;
        const template = templateById.get(w.panelId)!;
        rows.push({
          ...template,
          tradeDate: bar.timestamp,
          asOf: bar.timestamp,
          open: bar.open ?? null,
          high: bar.high ?? null,
          low: bar.low ?? null,
          close: bar.close ?? null,
          preClose: bar.preClose ?? null,
          volume: bar.volume ?? null,
          amount: bar.amount ?? null,
          liquidityAmount: bar.amount ?? null,
          liquidityVolume: bar.volume ?? null,
          turnoverRate: null,
          circulationMarketCap: null,
          totalMarketCap: null,
          knowledge: {
            ...template.knowledge,
            price: (bar.close === null || bar.close === undefined) ? 'UNKNOWN' : 'KNOWN',
            liquidity: 'UNKNOWN',
          },
        });
      }
    }
  }
  return {
    rows,
    stats: {
      identityCount: identities.size,
      codeCount: byCode.size,
      windowStart: dates[minFrom] ?? null,
      windowEnd: dates[maxTo] ?? null,
      rowsLoaded,
      rowsMerged: rows.length,
      queryChunks,
      skippedReason: null,
    },
  };
}

/** 合并：事件窗行优先，overlay 只补事件窗缺失的 (panelIdentity, tradeDate)。 */
export function mergeExecutionOverlayRows(
  retainedRows: readonly ResearchDatasetRow[],
  overlayRows: readonly ResearchDatasetRow[],
): ResearchDatasetRow[] {
  const seen = new Set(retainedRows.map((row) => overlayKey(row.securityId, row.tradeDate)));
  const merged = [...retainedRows];
  for (const row of overlayRows) {
    const key = overlayKey(row.securityId, row.tradeDate);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  merged.sort((left, right) =>
    left.tradeDate === right.tradeDate
      ? left.securityId.localeCompare(right.securityId)
      : left.tradeDate.localeCompare(right.tradeDate),
  );
  return merged;
}
/** 先构造紧凑数据集，再复用现有同步交易模拟器，保证撮合语义只有一份。 */
export async function runTradeSimulationFromCursor(input: {
  readonly cursor: ResearchDatasetCursor;
  readonly sourceRun: CandidateEvaluationRun;
  readonly simConfig: SimulationConfig;
  /** 测试注入用；缺省 = DbBarStore（stock_daily_prices）。 */
  readonly overlayBarReader?: ExecutionOverlayBarReader;
}): Promise<TradeSimulationRun> {
  const retainedRows = input.cursor.takeRetainedRows?.();
  const overlay =
    retainedRows !== undefined && retainedRows.length > 0
      ? await loadPositionExecutionOverlay(input.cursor, input.sourceRun, retainedRows, input.overlayBarReader)
      : { rows: [] as readonly ResearchDatasetRow[], stats: { ...EMPTY_EXECUTION_OVERLAY_STATS, skippedReason: 'NO_RETAINED_ROWS' } };
  const dataset =
    retainedRows !== undefined && retainedRows.length > 0
      ? buildCompactResearchDatasetFromRetainedRows(
          input.cursor,
          input.sourceRun,
          mergeExecutionOverlayRows(retainedRows, overlay.rows),
          overlay.stats,
        )
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
