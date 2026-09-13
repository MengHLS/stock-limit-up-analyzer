/**
 * clientPagination — **前端内存分页**的纯函数层。
 *
 * 与 `PaginationBar` 的分工：
 *   - `PaginationBar` 是**展示控件**（页码夹取、首/上/下/末页），它不知道数据从哪来；
 *   - 本模块负责**「第 page 页到底该显示哪几行」+「一共几页」**这两件纯计算。
 *
 * 为什么研究域需要它：`getRun` 会把**该 Run 的全部分析一次性返回**
 * （实测某 Run = 180 条），而「分析」表当前是**整表平铺**（180 个 `<TableRow>`，
 * 每行还带 3 个交互按钮）⇒ 首屏 DOM 极重、滚动卡顿。
 *
 * 这里刻意**不做服务端分页**：`getRun` 已经一次性返回全集，再改后端
 * （加 limit/offset）属于改 `server/**`，会热重启并杀死在途 Run。
 * 前端切片能拿到同样的可用性收益，且零后端改动、零迁移。
 *
 * 约定（与 `PaginationBar` 的 `buildPageList` 同源）：
 *   - `page` 从 **1** 开始；
 *   - 越界页码一律**夹取**到 `[1, totalPages]`，绝不返回空页（否则用户会看到
 *     「有数据却空白」的假空态）；
 *   - 空集合的 `totalPages` = **1**（与 `PaginationBar` 的 `Math.max(1, totalPages)`
 *     保持一致），不要在调用方再各自做一遍 `|| 1`。
 */

/** 每页条数候选。20 为默认 —— 实测 180 条分析分 9 页，首屏只渲染 20 行。 */
export const DEFAULT_PAGE_SIZE = 20;

/** 每页条数选项。与 `PaginationBar` 的默认 `pageSizeOptions` 对齐。 */
export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;

/** 总页数：空集合也算 1 页（与 `PaginationBar` 的 `Math.max(1, …)` 同源）。 */
export function totalPagesOf(totalCount: number, pageSize: number): number {
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1;
  if (!Number.isFinite(totalCount) || totalCount <= 0) return 1;
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

/**
 * 夹取页码到 `[1, totalPages]`。
 *
 * 🔴 **必须夹取**：删掉几行、或把每页条数调大之后，旧的 `page` 可能已经越界；
 * 若直接 `slice((page-1)*size, …)` 会得到空数组 ⇒ 表现为「表突然空了」。
 */
export function clampPage(page: number, totalCount: number, pageSize: number): number {
  const total = totalPagesOf(totalCount, pageSize);
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), total);
}

export type PageSlice<T> = {
  /** 当前页的行（已按 page/pageSize 切好）。 */
  rows: readonly T[];
  /** 夹取后的有效页码。调用方应把它写回 state，避免继续持有越界值。 */
  page: number;
  totalPages: number;
  pageSize: number;
  /** 全集条数（用于「第 x 条 ~ 第 y 条，共 n 条」这类文案）。 */
  totalCount: number;
  /** 当前页第一行在全集里的 1-based 序号；空集合为 0。 */
  startIndex: number;
  /** 当前页最后一行在全集里的 1-based 序号；空集合为 0。 */
  endIndex: number;
};

/**
 * 切出「第 page 页」的行。
 *
 * 纯函数：不改入参、不读时间/随机数，输入相同则输出相同（可直接单测）。
 */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): PageSlice<T> {
  const totalCount = items.length;
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : DEFAULT_PAGE_SIZE;
  const totalPages = totalPagesOf(totalCount, safeSize);
  const safePage = clampPage(page, totalCount, safeSize);
  const start = (safePage - 1) * safeSize;
  const rows = items.slice(start, start + safeSize);
  return {
    rows,
    page: safePage,
    totalPages,
    pageSize: safeSize,
    totalCount,
    startIndex: totalCount === 0 ? 0 : start + 1,
    endIndex: totalCount === 0 ? 0 : start + rows.length,
  };
}

/** 「第 a ~ b 条，共 n 条」；空集合返回「共 0 条」。 */
export function pageRangeLabel(slice: Pick<PageSlice<unknown>, "totalCount" | "startIndex" | "endIndex">): string {
  if (slice.totalCount === 0) return "共 0 条";
  return `第 ${slice.startIndex} ~ ${slice.endIndex} 条 · 共 ${slice.totalCount} 条`;
}
