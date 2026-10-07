/**
 * 首板回踩 3F Top-N —— 按决策日选股（STOCK-SELECTION-001/002）。
 *
 * ## 语义（与回测同源，禁自行发明）
 *   事件日 T0（首板）→ 观察 rd 1..5（需回踩，且最大振幅 < 14%）
 *   → rd5 = **决策日**收盘算 3F 综合分 → 当日横截面排序取 Top-N
 *   → rd6 = 次一交易日**开盘**买入（执行语义属策略/执行层，本文只输出计划执行日）。
 *
 * ## 口径 × 载体（🔴 本文件只拥有「口径」，不拥有「数据从哪来」）
 *   - **口径（本文件）**：决策相对日 = 5、需要 rd0..6、通过硬过滤与 3F 排序取前 N；
 *   - **载体（`../dataSource.ts` 端口）**：把「决策日」解析为候选事件窗数据 ——
 *     `dataset`（冻结快照，研究/回放/对拍）或 `live`（当日原始行情，日常选股）。
 *   ⇒ 换载体**不改口径**：两者都走同一份 `deriveTradingDays` 反证、同一 `buildWindowRows`
 *      投影、同一 `buildFirstLimitPullback3FTop3SourceRun` 排序。
 *
 * ## 纪律
 *   - 打分 / 过滤 / 排序**全部**复用 `server/research/compositeRunner`（唯一权威实现）；
 *   - 任何不一致（候选缺 rd0 / 无法复现数据集自己的 relativeDay）**响亮抛错**，
 *     绝不静默当成「今天没有候选」。
 */

import {
  buildCompositeEvents,
  buildFirstLimitPullback3FTop3SourceRun,
  COMPOSITE_RUNNER_MAX_AMPLITUDE,
  COMPOSITE_RUNNER_TOP_N,
} from "../../research/compositeRunner/index";
import { buildWindowRows } from "../../runWorkbenchAssembly/datasetFromRegistry";
import { resolveSecurityIdsByEvent } from "../../runWorkbenchAssembly/datasetIdentityProvider";
import { eventScopedSecurityId, baseSecurityIdOf } from "../../eventIdentity";
import { buildSelectionSliceDataset } from "../sliceDataset";
import {
  StockSelectionError,
  type DailyStockSelection,
  type StockSelectionDetailValue,
  type StockSelectionExcludedStock,
  type StockSelectionPick,
  type StockSelectionRequest,
  type StockSelectionStrategy,
} from "../types";
import type { SelectionDataSource, SelectionDataSourceKind, SelectionUniverseScope } from "../dataSource";
import type { FirstLimitPullbackEvent, FirstLimitPullbackRawBar } from "../../datasetRegistry/types";
import type { SecurityIdentifier } from "../../security/types";

export const FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID = "first-limit-pullback-3f-topn";
export const FIRST_LIMIT_PULLBACK_3F_STRATEGY_LABEL = "首板回踩 · 3F Top-N";
/** 该策略默认依据的数据集定义 id（`first_limit_pullback`）——**仅**默认载体为 `dataset` 时供页面列版本用。 */
export const FIRST_LIMIT_PULLBACK_3F_DATASET_ID = 120001;

/** 决策相对日：T0+5（收盘）。 */
const DECISION_RELATIVE_DAY = 5;
/** 计划执行相对日：T0+6（开盘）。 */
const ENTRY_RELATIVE_DAY = 6;
/**
 * **候选宇宙口径**：主板 + 排除 ST/*ST（PIT）。
 *
 * 依据（实查 780001）：`dataset_build_config.excludeSt = 1`，且 73,003 条事件**全部**
 * `boardType = \'main\'`。该口径属**策略语义**（哪些标的可成为候选），故在此声明，
 * 由各载体以同一口径执行 —— live 侧按板块 + PIT ST 过滤，dataset 侧反证。
 */
const UNIVERSE_SCOPE: SelectionUniverseScope = Object.freeze({
  boards: ["main"] as const,
  excludeSt: true,
});

/** 事件窗投影需要的相对日：rd0（事件日）∪ rd1..6（观察窗 + 执行日）。 */
const PROJECTED_RELATIVE_DAYS = [0, 1, 2, 3, 4, 5, ENTRY_RELATIVE_DAY] as const;

export interface StockSelectionDeps {
  /** 数据载体集合（按 kind 解析）；至少一个。 */
  readonly sources: readonly SelectionDataSource[];
  /** 请求未显式指定 source 时使用的载体 kind。 */
  readonly defaultSourceKind: SelectionDataSourceKind;
  /** 事件 → canonical `sec_<uuid>` 的身份来源（复用唯一实现，缺省读研究域小表）。 */
  readonly loadIdentifiers: () => Promise<readonly SecurityIdentifier[]>;
  /** 组装时点（注入以便确定性测试）；缺省 = 当前时间。 */
  readonly now?: () => string;
}

function resolveSource(
  deps: StockSelectionDeps,
  requestedKind: SelectionDataSourceKind | undefined,
): SelectionDataSource {
  const kind = requestedKind ?? deps.defaultSourceKind;
  const source = deps.sources.find((item) => item.kind === kind);
  if (source === undefined) {
    throw new StockSelectionError(
      "SELECTION_DATA_SOURCE_UNSUPPORTED",
      `数据载体 ${kind} 未注册（已注册：${deps.sources.map((item) => item.kind).join(", ") || "无"}）。`,
    );
  }
  return source;
}

/**
 * 日历反证：把载体给出的交易日历与行数据交叉核对。
 *
 * 🔴 为什么必须反证：`buildCompositeEvents` 用「交易日索引差」重算相对日，
 * 如果某个交易日缺少任何一行（日历缺洞），索引差就会漂移、悄悄改变候选的 rd 语义。
 * 因此这里做两件事，任一不符即响亮失败：
 *   ① 载体给出的每个交易日**必须至少有一行**（覆盖性）；
 *   ② 每行「索引差 === 声明的 relativeDay」（自洽性）。
 */
function assertCalendarConsistency(
  bars: readonly FirstLimitPullbackRawBar[],
  eventById: ReadonlyMap<string, FirstLimitPullbackEvent>,
  calendarDays: readonly string[],
  decisionDate: string,
): string[] {
  const days = [...calendarDays];
  const indexOfDay = new Map(days.map((day, index) => [day, index]));
  const coveredDays = new Set(bars.map((bar) => bar.tradeDate));
  for (const day of days) {
    // 🔴 只要求「决策日及之前」的交易日被行情覆盖：执行日（决策日的下一交易日）在决策时
    //    尚无 bar，只需要它出现在日历里用于给出计划买入日。
    if (day > decisionDate) continue;
    if (!coveredDays.has(day)) {
      throw new StockSelectionError(
        "SELECTION_CALENDAR_INCONSISTENT",
        `交易日 ${day} 在载体给出的日历内，但候选窗内没有任何一行行情覆盖它（日历/数据不一致）。`,
      );
    }
  }
  for (const bar of bars) {
    const event = eventById.get(bar.eventId);
    const eventDate = event?.tradeDate;
    const barIndex = indexOfDay.get(bar.tradeDate);
    if (eventDate === undefined || barIndex === undefined) {
      throw new StockSelectionError(
        "SELECTION_CALENDAR_INCONSISTENT",
        `事件 ${bar.eventId} 的窗口日 ${bar.tradeDate} 不在本次加载的交易日内。`,
      );
    }
    const eventIndex = indexOfDay.get(eventDate);
    if (eventIndex === undefined) {
      throw new StockSelectionError(
        "SELECTION_CALENDAR_INCONSISTENT",
        `事件 ${bar.eventId} 的事件日 ${eventDate} 不在本次加载的交易日内（缺 rd=0 行？）。`,
      );
    }
    if (barIndex - eventIndex !== bar.relativeDay) {
      throw new StockSelectionError(
        "SELECTION_CALENDAR_INCONSISTENT",
        `事件 ${bar.eventId} 在 ${bar.tradeDate} 的相对日不一致：声明 rd=${bar.relativeDay}，` +
          `按本次加载的交易日索引差算得 rd=${barIndex - eventIndex}（缺交易日行 ⇒ 拒绝在此数据上选股）。`,
      );
    }
  }
  return days;
}

/** 由**逐只明细**归并出「原因码 → 数量」（二者同源 ⇒ 计数与明细恒一致）。 */
function countByReason(stocks: readonly StockSelectionExcludedStock[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const stock of stocks) out[stock.reason] = (out[stock.reason] ?? 0) + 1;
  return out;
}

export async function selectFirstLimitPullback3FTopN(
  deps: StockSelectionDeps,
  request: StockSelectionRequest,
): Promise<DailyStockSelection> {
  const decisionDate = request.decisionDate;
  const topN = request.topN ?? COMPOSITE_RUNNER_TOP_N;
  const source = resolveSource(deps, request.source?.kind);
  const datasetVersionId = source.kind === "dataset" ? (request.source?.datasetVersionId ?? null) : null;
  const sourceRef = { kind: source.kind, label: source.label };

  const empty = (): DailyStockSelection => ({
    strategyId: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
    strategyLabel: FIRST_LIMIT_PULLBACK_3F_STRATEGY_LABEL,
    source: sourceRef,
    datasetVersionId,
    decisionDate,
    topN,
    picks: [],
    filterStats: { candidateEventCount: 0, rankedCandidateCount: 0, excluded: {}, excludedStocks: [] },
    dataWindow: null,
  });

  // ① 取候选事件窗（载体负责"数据从哪来"，策略只声明口径）。
  const windowData = await source.load({
    decisionDate,
    universe: UNIVERSE_SCOPE,
    decisionRelativeDay: DECISION_RELATIVE_DAY,
    relativeDays: [...PROJECTED_RELATIVE_DAYS],
    datasetVersionId: request.source?.datasetVersionId,
  });
  const { events, zeroBars, postBars, calendarDays } = windowData;
  if (events.length === 0) return empty();

  // ② 口径不变量：候选必须有 rd=0（首板日特征基准）；缺则响亮失败，不静默跳过。
  const zeroBarEventIds = new Set(zeroBars.map((bar) => bar.eventId));
  for (const event of events) {
    if (!zeroBarEventIds.has(event.eventId)) {
      throw new StockSelectionError(
        "SELECTION_EVENT_DAY_BAR_MISSING",
        `候选事件 ${event.eventId} 缺 rd=0 行（首板日行情）⇒ 无特征基准，拒绝静默跳过。`,
      );
    }
  }

  // ③ 行形状适配：非数据集载体没有版本坐标 ⇒ 仅补行形状（`buildWindowRows` / `projectEventRow`
  //    与身份解析**都不读该字段**：只读 symbol / previousClose / industryCode / turnover / 市值/行情列），
  //    **不写库、绝不当坐标使用**。
  const projectionEvents: FirstLimitPullbackEvent[] = events.map((event) => ({
    ...event,
    datasetVersionId: event.datasetVersionId ?? 0,
  }));
  const projectionBars: FirstLimitPullbackRawBar[] = [...zeroBars, ...postBars].map((bar) => ({
    ...bar,
    datasetVersionId: bar.datasetVersionId ?? 0,
  }));
  const projectionZeroBars = projectionBars.filter((bar) => bar.relativeDay === 0);
  const projectionPostBars = projectionBars.filter((bar) => bar.relativeDay !== 0);
  // ④ 交易日序列 + 反证。
  const eventById = new Map(projectionEvents.map((event) => [event.eventId, event]));
  const tradingDays = assertCalendarConsistency(projectionBars, eventById, calendarDays, decisionDate);


  // ⑤ 身份（复用唯一实现：事件 + tradeDate → canonical sec_<uuid>）。
  const identifiers = await deps.loadIdentifiers();
  const securityIdByEventId = resolveSecurityIdsByEvent(projectionEvents, identifiers);

  // ⑥ 事件窗投影（复用唯一实现；rd=0 ∪ rd∈[1, 决策日+1]）。
  const projection = buildWindowRows(
    projectionEvents,
    projectionZeroBars,
    projectionPostBars,
    { start: 1, end: DECISION_RELATIVE_DAY },
    securityIdByEventId,
  );

  // ⑦ 切片数据集（形状适配，非认证产物）。
  const dataset = buildSelectionSliceDataset({
    parentDatasetVersionId: datasetVersionId,
    decisionDate,
    rows: projection.rows,
    tradingDays,
    capturedAt: (deps.now ?? (() => new Date().toISOString()))(),
  });

  // ⑧ 选股：委托唯一权威实现（不做第二套打分/排序）。
  const dateRange = { startDate: tradingDays[0]!, endDate: tradingDays[tradingDays.length - 1]! };
  const arm = buildFirstLimitPullback3FTop3SourceRun({
    dataset,
    dateRange,
    topN,
    armId: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
    label: FIRST_LIMIT_PULLBACK_3F_STRATEGY_LABEL,
  });
  const day = arm.sourceRun.days.find((record) => record.date === decisionDate);
  if (day === undefined) {
    throw new StockSelectionError(
      "SELECTION_CALENDAR_INCONSISTENT",
      `决策日 ${decisionDate} 不在切片的交易日序列内（${dateRange.startDate} .. ${dateRange.endDate}）。`,
    );
  }

  // ⑨ 面板身份 → 事件坐标（用同一份 eventScopedSecurityId 反查，不解析字符串）。
  const eventIdByPanelId = new Map<string, string>();
  for (const event of events) {
    const canonical = securityIdByEventId.get(event.eventId);
    if (canonical === undefined) continue;
    eventIdByPanelId.set(eventScopedSecurityId(canonical, event.eventId), event.eventId);
  }

  // ⑩ 剔除统计（含**逐只明细**）：同一权威实现的同一次循环产出 ⇒ 计数由明细归并，二者恒一致。
  const exclusionRecords = buildCompositeEvents(dataset, COMPOSITE_RUNNER_MAX_AMPLITUDE).exclusionRecords;
  const excludedStocks: StockSelectionExcludedStock[] = exclusionRecords.map((record) => {
    const eventId = eventIdByPanelId.get(record.securityId) ?? "";
    const event = eventId === "" ? undefined : eventById.get(eventId);
    return {
      canonicalSecurityId: securityIdByEventId.get(eventId) ?? baseSecurityIdOf(record.securityId),
      code: event?.symbol ?? null,
      eventId,
      eventDate: record.eventDate,
      reason: record.reason,
    };
  });
  const excluded = countByReason(excludedStocks);
  // 计划买入日 = 决策日的**下一个交易日**（来自载体日历；载体无关）。
  const decisionDayIndex = tradingDays.indexOf(decisionDate);
  const plannedEntryDate = decisionDayIndex >= 0 ? (tradingDays[decisionDayIndex + 1] ?? null) : null;

  const picks: StockSelectionPick[] = day.selected.map((selected): StockSelectionPick => {
    const panelSecurityId = selected.securityId;
    const eventId = eventIdByPanelId.get(panelSecurityId) ?? "";
    const event = eventById.get(eventId);
    const detail: Record<string, StockSelectionDetailValue> = {
      decisionRelativeDay: DECISION_RELATIVE_DAY,
      maxAmplitudeLimit: COMPOSITE_RUNNER_MAX_AMPLITUDE,
    };
    return {
      rank: selected.rank,
      rankPercentile: selected.percentile,
      score: Number.isFinite(selected.value) ? selected.value : null,
      canonicalSecurityId: baseSecurityIdOf(panelSecurityId),
      panelSecurityId,
      code: event?.symbol ?? null,
      eventId,
      eventDate: event?.tradeDate ?? "",
      signalDate: decisionDate,
      entryDate: plannedEntryDate,
      detail,
    };
  });

  return {
    strategyId: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
    strategyLabel: FIRST_LIMIT_PULLBACK_3F_STRATEGY_LABEL,
    source: sourceRef,
    datasetVersionId,
    decisionDate,
    topN,
    picks,
    filterStats: {
      candidateEventCount: events.length,
      rankedCandidateCount: day.signalCount,
      excluded,
      excludedStocks,
    },
    dataWindow: { startDate: dateRange.startDate, endDate: dateRange.endDate },
  };
}

export function createFirstLimitPullback3FTopNStrategy(deps: StockSelectionDeps): StockSelectionStrategy {
  return {
    id: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
    label: FIRST_LIMIT_PULLBACK_3F_STRATEGY_LABEL,
    datasetId: FIRST_LIMIT_PULLBACK_3F_DATASET_ID,
    description:
      "首板事件 T0 后观察 T0+1..T0+5（需回踩且最大振幅 < 14%），在 T0+5 收盘按 3F 综合分" +
      "（最大振幅↓ / 平均振幅↓ / T+1 量比）横截面排序取前 N，计划 T0+6 开盘买入。",
    select: (request) => selectFirstLimitPullback3FTopN(deps, request),
  };
}
