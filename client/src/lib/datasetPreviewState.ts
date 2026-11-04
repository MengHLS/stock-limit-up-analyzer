/**
 * datasetPreviewState — Dataset Registry 预览 keyset 分页状态机（纯函数，STEP DATASET-002.3）。
 *
 * 设计：
 *   - **keyset 分页**（后端 cursor 为不透明字符串，前端原样回传，禁止 OFFSET / 全量）；
 *   - 游标栈 `(string | null)[]`：`[null]` = 第 1 页；NEXT 压入 nextCursor，PREV 弹出；
 *   - RESET 清空栈 → 第 1 页（用于 Version 切换 / table 切换 / limit 变更，杜绝旧版本数据残留）。
 *
 * 纯函数与 React 解耦，便于单测（任务 §15：分页 + 版本切换必须可测）。
 */

export type PreviewCursorStack = (string | null)[];

export type PreviewNavAction =
  | { type: "RESET" }
  | { type: "NEXT"; nextCursor: string }
  | { type: "PREV" };

export function initialPreviewStack(): PreviewCursorStack {
  return [null];
}

/** 当前页输入游标（栈顶）；首页为 null。 */
export function currentCursor(stack: PreviewCursorStack): string | null {
  if (stack.length === 0) return null;
  return stack[stack.length - 1] ?? null;
}

export function reducePreviewStack(
  state: PreviewCursorStack,
  action: PreviewNavAction,
): PreviewCursorStack {
  switch (action.type) {
    case "RESET":
      return [null];
    case "NEXT":
      // 防御：空栈视同首页；重复 nextCursor 不重复压栈。
      if (state.length === 0) return [action.nextCursor];
      if (state[state.length - 1] === action.nextCursor) return state;
      return [...state, action.nextCursor];
    case "PREV":
      return state.length > 1 ? state.slice(0, -1) : state;
  }
}

export interface PreviewSelectors {
  /** 当前页输入游标（栈顶）。 */
  cursor: string | null;
  /** 1-based 页码。 */
  pageIndex: number;
  canGoPrev: boolean;
  canGoNext: boolean;
}

/** 由栈 + 上页返回的 nextCursor 派生 UI 选择器。 */
export function selectPreviewState(
  stack: PreviewCursorStack,
  nextCursor: string | null,
): PreviewSelectors {
  return {
    cursor: currentCursor(stack),
    pageIndex: stack.length,
    canGoPrev: stack.length > 1,
    canGoNext: nextCursor !== null,
  };
}

/** 预览页 table 标识（事件窗口五表）。 */
export type PreviewTable = "event" | "prefix" | "post" | "path" | "outcome";

/**
 * React Query queryKey（与 tRPC 输入强绑定，避免版本切换时旧版本缓存残留）。
 * tRPC v11 默认按 [procedure, input] 建 key；此处显式提供稳定 key 语义供文档/测试/调试。
 */
export function previewQueryKey(
  table: PreviewTable,
  versionId: number,
  limit: number,
  cursor: string | null,
): readonly [string, PreviewTable, number, number, string | null] {
  return ["datasetRegistry.preview", table, versionId, limit, cursor];
}
