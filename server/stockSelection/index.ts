/**
 * STOCK-SELECTION-001 —— 选股域对外入口。
 *
 * 依赖方向：`stockSelection → research/compositeRunner（策略语义权威）` 与
 * `stockSelection → runWorkbenchAssembly（事件窗投影权威）`，**单向向下**；
 * 本域不反向被 research / backtest 依赖，也不注册任何执行路径。
 */

export {
  STOCK_SELECTION_ERROR_CODES,
  StockSelectionError,
  isValidDecisionDate,
  type DailyStockSelection,
  type StockSelectionDetailValue,
  type StockSelectionFilterStats,
  type StockSelectionPick,
  type StockSelectionExcludedStock,
  type StockSelectionRequest,
  type StockSelectionSourceRef,
  type StockSelectionStrategy,
} from "./types";
export { buildSelectionSliceDataset, type SelectionSliceDatasetInput } from "./sliceDataset";
export type {
  SelectionDataSource,
  SelectionDataSourceKind,
  SelectionBarRow,
  SelectionDataSourceRequest,
  SelectionDataSourceResult,
  SelectionEventRow,
} from "./dataSource";
export {
  DEFAULT_EVENT_WINDOW_LIMIT,
  createDatasetSelectionDataSource,
  type DatasetSelectionDataSourceOptions,
} from "./sources/datasetSource";
export {
  createLiveSelectionDataSource,
  type LiveSelectionBarReader,
  type LiveSelectionDataSourceOptions,
  type LiveSelectionReferenceData,
} from "./sources/liveSource";
export {
  FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
  FIRST_LIMIT_PULLBACK_3F_STRATEGY_LABEL,
  createFirstLimitPullback3FTopNStrategy,
  selectFirstLimitPullback3FTopN,
  type StockSelectionDeps,
} from "./strategies/firstLimitPullback3FTopN";
export {
  STOCK_SELECTION_RUN_LIST_DEFAULT_LIMIT,
  STOCK_SELECTION_RUN_LIST_MAX_LIMIT,
  buildSelectionRunId,
  createDbStockSelectionRunStore,
  createMemoryStockSelectionRunStore,
  normalizeListLimit,
  parseExcluded,
  parsePicks,
  serializeExcluded,
  serializePicks,
  toInsertValues,
  type PersistedExclusionStats,
  type StockSelectionRunDetail,
  type StockSelectionRunStore,
  type StockSelectionRunSummary,
} from "./persistence";
export {
  STOCK_SELECTION_STRATEGY_IDS,
  createStockSelectionRegistry,
  defaultStockSelectionDeps,
  type StockSelectionRegistry,
} from "./registry";
