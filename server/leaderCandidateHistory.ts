/**
 * 龙头候选池「全样本历史明细」的服务端分页与载荷裁剪。
 *
 * 背景（2026-09-11）：涨停记录回填到 2019 后，候选历史明细达到数万行。
 * 旧实现把 `historicalRows` 全量塞进 tRPC 响应（数十 MB JSON），浏览器需要
 * 一次性序列化 + 渲染数万个 <tr>（每个 <tr> 内含数十个节点），页面直接卡死。
 *
 * 本模块把「明细」从「聚合结果」中拆出来：
 * - 聚合结果（成功率/分位/阶段漏斗等）仍在 `getLeaderCandidateBacktest` 返回；
 * - 明细改为独立分页端点，服务端只回传当前页，行数上限受 MAX_* 约束。
 *
 * 排序口径：沿用上游 `historicalRows` 的既有排序（候选日期倒序 → 评分降序），
 * 本模块只做「过滤 + 切片」，不重排，保证分页结果与旧的全量列表顺序一致。
 */
import type { LeaderCandidateBacktestResult, LeaderCandidateBacktestRow } from "./leaderCandidates";
import type { SentimentCyclePhase } from "./sentimentCycle";

export const DEFAULT_LEADER_CANDIDATE_HISTORY_PAGE_SIZE = 50;
export const MAX_LEADER_CANDIDATE_HISTORY_PAGE_SIZE = 200;

export type LeaderCandidateHistoryQuery = {
  /** 1 基页码；非法值回落为 1。 */
  page?: number;
  /** 每页条数；非法值回落为默认值，超出上限则截断到上限。 */
  pageSize?: number;
  /** 按情绪周期阶段过滤；null / undefined 表示不过滤。 */
  phase?: SentimentCyclePhase | null;
  /** 仅保留 T+N 延续成功的样本；null / undefined 表示不过滤。 */
  onlySuccess?: boolean | null;
};

export type LeaderCandidateHistoryPage = {
  rows: LeaderCandidateBacktestRow[];
  /** 实际生效的页码（已按总页数夹取）。 */
  page: number;
  /** 实际生效的每页条数。 */
  pageSize: number;
  /** 当前筛选条件下的总行数。 */
  totalRows: number;
  /** 未筛选的全量行数（用于「显示 x/y 条」文案）。 */
  allRows: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  /** 当前筛选条件下仍有未返回的行（totalPages > 1）。 */
  truncated: boolean;
};

function normalizePage(page: number | undefined): number {
  if (page === undefined || !Number.isFinite(page)) return 1;
  const truncated = Math.trunc(page);
  return truncated < 1 ? 1 : truncated;
}

function normalizePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined || !Number.isFinite(pageSize)) {
    return DEFAULT_LEADER_CANDIDATE_HISTORY_PAGE_SIZE;
  }
  const truncated = Math.trunc(pageSize);
  if (truncated < 1) return DEFAULT_LEADER_CANDIDATE_HISTORY_PAGE_SIZE;
  return Math.min(truncated, MAX_LEADER_CANDIDATE_HISTORY_PAGE_SIZE);
}

/** 应用阶段 / 结果过滤；不改变行顺序，不修改入参。 */
export function filterLeaderCandidateHistoryRows(
  rows: LeaderCandidateBacktestRow[],
  query: LeaderCandidateHistoryQuery = {},
): LeaderCandidateBacktestRow[] {
  const { phase, onlySuccess } = query;
  const hasPhase = phase !== undefined && phase !== null;
  const hasSuccess = onlySuccess !== undefined && onlySuccess !== null;
  if (!hasPhase && !hasSuccess) return rows;
  return rows.filter((row) => {
    if (hasPhase && row.phase !== phase) return false;
    if (hasSuccess && row.success !== onlySuccess) return false;
    return true;
  });
}

/**
 * 过滤 + 分页。返回的行数恒 <= pageSize；聚合计数始终反映筛选后的全量。
 * 请求页码超出范围时夹取到最后一页（数据增长/收缩后不会出现空白页）。
 */
export function paginateLeaderCandidateHistory(
  rows: LeaderCandidateBacktestRow[],
  query: LeaderCandidateHistoryQuery = {},
): LeaderCandidateHistoryPage {
  const pageSize = normalizePageSize(query.pageSize);
  const filtered = filterLeaderCandidateHistoryRows(rows, query);
  const totalRows = filtered.length;
  const totalPages = totalRows === 0 ? 1 : Math.ceil(totalRows / pageSize);
  const page = Math.min(normalizePage(query.page), totalPages);
  const start = (page - 1) * pageSize;
  return {
    rows: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    totalRows,
    allRows: rows.length,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
    truncated: totalPages > 1,
  };
}

export type LeaderCandidateBacktestSummary = Omit<LeaderCandidateBacktestResult, "historicalRows"> & {
  /** 明细总行数（明细本身走 getLeaderCandidateHistoryPage 分页端点）。 */
  historicalRowCount: number;
};

/**
 * 从回测结果中剥离明细行，仅保留聚合结果 + 明细行数。
 * 明细必须通过分页端点获取，避免数十 MB 载荷拖死浏览器。
 */
export function stripLeaderCandidateHistory(
  result: LeaderCandidateBacktestResult,
): LeaderCandidateBacktestSummary {
  const { historicalRows, ...rest } = result;
  return { ...rest, historicalRowCount: historicalRows.length };
}
