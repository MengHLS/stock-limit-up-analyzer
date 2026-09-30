/**
 * 版本回测对比页的列表模式纯逻辑。
 *
 * 抽取原因：本仓前端测试跑在 node 环境，不加载 jsdom / @testing-library。
 * 「加星置顶」「展开全部不分页」这类规则放在这里，测试可以直接调用，
 * 不必把整页组件（recharts / trpc）拖进测试进程。
 */

export interface StrategyVersionCompareRow {
  readonly key: string;
  readonly version: string;
  readonly isStarred: boolean;
  readonly [field: string]: unknown;
}

/** 版本号降序（数字段比较；1.10 > 1.9）。 */
export function compareStrategyVersionDesc(
  left: string,
  right: string,
): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i += 1) {
    const delta = (rightParts[i] ?? 0) - (leftParts[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/**
 * 展示排序：星标版本置顶，组内按版本号降序。
 * 使用 copy 排序，不修改调用方传入的数组。
 */
export function sortStrategyVersionRowsForDisplay<
  Row extends StrategyVersionCompareRow,
>(rows: readonly Row[]): Row[] {
  return [...rows].sort((left, right) => {
    if (left.isStarred !== right.isStarred) {
      return left.isStarred ? -1 : 1;
    }
    return compareStrategyVersionDesc(left.version, right.version);
  });
}

export const VERSION_COMPARE_PAGE_SIZE = 12;

/**
 * 分页模式（showAll = false）：按当前页裁剪；展开模式（showAll = true）：返回全部。
 */
export function selectVisibleVersionRows<Row>(
  rows: readonly Row[],
  options: {
    readonly showAll: boolean;
    readonly page: number;
    readonly pageSize: number;
  },
): Row[] {
  if (options.showAll) return [...rows];
  const safePage = Math.max(1, options.page);
  const safePageSize = Math.max(1, options.pageSize);
  const start = (safePage - 1) * safePageSize;
  return rows.slice(start, start + safePageSize);
}
