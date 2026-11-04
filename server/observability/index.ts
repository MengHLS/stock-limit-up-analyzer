/**
 * PARAMETER-001-PRE — 可观测性（性能剖析）。
 *
 * 唯一入口：`perfProfile.ts`。默认关闭，见该文件头注释的开关说明。
 */
export {
  DB_COUNTER_READS,
  DB_COUNTER_ROUND_TRIPS,
  DB_COUNTER_WRITES,
  DB_MARK_READ_MS,
  DB_MARK_TOTAL_MS,
  DB_MARK_WRITE_MS,
  installDbPerfHook,
} from "./dbHook";
export {
  PERF_DB_HOOK_ENABLED,
  emitPerfReport,
  formatPerfReport,
  isPerfProfilingEnabled,
  perfBegin,
  perfCount,
  perfEnd,
  perfMark,
  perfReset,
  perfRun,
  perfRunAsync,
  perfSnapshot,
  type PerfFlatEntry,
  type PerfFrame,
  type PerfReport,
  type PerfTreeNode,
} from "./perfProfile";
