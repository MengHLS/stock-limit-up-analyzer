/**
 * STOCK-SELECTION-002 —— `dataset` 载体：从冻结数据集快照读候选事件窗。
 *
 * 这是**研究 / 回放 / 对拍**口径：坐标是 `datasetVersionId`（真实数据集版本），
 * 与回测读的是同一份数据面 ⇒ 可复现。
 *
 * 取数口径（🔴 改这里前必读）—— 候选事件的权威定义是**数据集自己的相对日**：
 *   ① 先在**事件表**按 `(datasetVersionId, tradeDate)` 取回退窗口内的超集（走既有索引
 *      `idx_event_version_date`；实测 48ms），窗口按自然日 30 天 —— 覆盖任何节假日错位；
 *   ② 批量读这些事件的 `post` 行（走 `idx_post_event_day(eventId, relativeDay)`）；
 *   ③ 只保留「`rd = decisionRelativeDay` 那一行的 `tradeDate` === 决策日」的事件
 *      —— 这就是"今天决策"的定义，**不引入外部日历、也不猜交易日**；
 *   ④ `prefix` 取 rd=0 行。
 * 🔴 反例记录：直接对 `post` 加 `tradeDate = 决策日` 谓词会退化成该相对日的全范围扫描
 *   （实测 91,857ms/次），因此**不要**那样写。
 */

import { addDays } from "../../security/dates";
import { classifyBoard } from "../../data/boardRules";
import { StockSelectionError } from "../types";
import type { SelectionDataSource, SelectionDataSourceRequest, SelectionDataSourceResult } from "../dataSource";
import type { DatasetDataReader } from "../../datasetRegistry/query";

/** 事件回退窗口（**自然日**；足够覆盖节假日错位，且只用于取超集）。 */
const EVENT_LOOKBACK_CALENDAR_DAYS = 30;
/** 事件窗口行数护栏缺省值（超出即响亮失败，防静默截断）。 */
export const DEFAULT_EVENT_WINDOW_LIMIT = 5000;

export interface DatasetSelectionDataSourceOptions {
  readonly reader: DatasetDataReader;
  /** 事件窗口行数护栏（缺省 5000）；超出即响亮失败，不截断。 */
  readonly maxEvents?: number;
  /** 展示用标签（缺省「数据集快照（研究口径）」；页面可传「数据集 #<id>」）。 */
  readonly label?: string;
}

export function createDatasetSelectionDataSource(
  options: DatasetSelectionDataSourceOptions,
): SelectionDataSource {
  const maxEvents = options.maxEvents ?? DEFAULT_EVENT_WINDOW_LIMIT;
  const label = options.label ?? "数据集快照（研究口径）";
  const empty = (): SelectionDataSourceResult => ({ kind: "dataset", label, calendarDays: [], events: [], zeroBars: [], postBars: [] });

  return {
    kind: "dataset",
    label,
    async load(request: SelectionDataSourceRequest): Promise<SelectionDataSourceResult> {
      const datasetVersionId = request.datasetVersionId;
      if (datasetVersionId === undefined || !Number.isInteger(datasetVersionId) || datasetVersionId <= 0) {
        throw new StockSelectionError(
          "SELECTION_DATA_SOURCE_COORDINATE_MISSING",
          `dataset 载体必须提供 datasetVersionId（真实坐标）；收到 ${JSON.stringify(datasetVersionId)}。`,
        );
      }

      // ① 事件表回退窗口（自然日）：只取超集，权威筛选在 ③。
      const windowStartDate = addDays(request.decisionDate, -EVENT_LOOKBACK_CALENDAR_DAYS);
      const windowPage = await options.reader.listEventsPage({
        datasetVersionId,
        fromDate: windowStartDate,
        toDate: request.decisionDate,
        limit: maxEvents,
      });
      if (windowPage.nextCursor !== null) {
        throw new StockSelectionError(
          "SELECTION_PAGE_LIMIT_EXCEEDED",
          `事件窗口 ${windowStartDate}..${request.decisionDate} 超过 ${maxEvents} 行护栏；` +
            "拒绝在可能截断的数据上选股（请提高护栏或缩小窗口）。",
        );
      }
      const windowEvents = windowPage.items;
      if (windowEvents.length === 0) return empty();

      // ② 批量读窗口行。
      const windowEventIds = windowEvents.map((event) => event.eventId);
      const postRelativeDays = request.relativeDays.filter((day) => day > 0);
      const windowPostBars = postRelativeDays.length === 0
        ? []
        : await options.reader.loadRawBarsBatch("post", {
            datasetVersionId,
            eventIds: windowEventIds,
            relativeDays: [...postRelativeDays],
          });

      // ③ 权威定义：rd = decisionRelativeDay 那一行的 tradeDate 即决策日。
      const decisionBarByEventId = new Map(
        windowPostBars
          .filter((bar) => bar.relativeDay === request.decisionRelativeDay)
          .map((bar) => [bar.eventId, bar]),
      );
      const candidateEventIds = windowEventIds
        .filter((eventId) => decisionBarByEventId.get(eventId)?.tradeDate === request.decisionDate)
        .sort();
      if (candidateEventIds.length === 0) return empty();

      // 候选宇宙反证：本载体的数据在构建时已固化口径 ⇒ 只做**反证**（不重复过滤）。
      // 🔴 ST 维度无法在此校验（需 PIT ST 解析，属 live 载体职责）；板块维度可纯函数校验。
      if (request.universe.boards.length > 0) {
        const allowedBoards = new Set(request.universe.boards);
        for (const event of windowEvents) {
          if (!candidateEventIds.includes(event.eventId)) continue;
          const board = classifyBoard(event.symbol);
          if (!allowedBoards.has(board)) {
            throw new StockSelectionError(
              "SELECTION_UNIVERSE_VIOLATION",
              `数据集载体返回的事件 ${event.symbol} 板块 = ${board}，不在策略声明的候选宇宙 [${request.universe.boards.join(", ")}] 内。`,
            );
          }
        }
      }
      const candidateSet = new Set(candidateEventIds);
      const events = windowEvents.filter((event) => candidateSet.has(event.eventId));
      const postBars = windowPostBars.filter((bar) => candidateSet.has(bar.eventId));

      // ④ rd = 0（prefix）。
      const zeroBars = request.relativeDays.includes(0)
        ? await options.reader.loadRawBarsBatch("prefix", {
            datasetVersionId,
            eventIds: candidateEventIds,
            relativeDays: [0],
          })
        : [];

      // 交易日历（数据集载体）：由本次实际加载到的行导出（升序去重）。
      const calendarDays = [...new Set([...zeroBars, ...postBars].map((bar) => bar.tradeDate))].sort();
      return { kind: "dataset", label, calendarDays, events, zeroBars, postBars };
    },
  };
}
