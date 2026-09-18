/**
 * 连板梯队「情绪评分」公式 —— 单一真源。
 *
 * 该公式原先内联在 `server/db.ts#getConnectionBoardStats`；
 * 「连板梯队名录」(`server/boardRoster.ts`) 也要输出同一分数，
 * 若各自内联就会出现两份口径（历史缺陷正是口径散落导致）。
 * 故抽到 `shared/`（无依赖、纯函数），由两侧共同引用。
 *
 * 公式（与 2026-09 之前的实现逐字一致）：
 *   连接率（2 板及以上家数 / 当日涨停家数）× 40
 * + 最高板归一（min(最高板 / 10, 1)）× 30
 * + 高度集中度（3 板及以上 / 连板家数）× 30
 */
export function computeBoardEmotionScore(input: {
  /** 当日涨停家数。 */
  totalLimitUp: number;
  /** 当日 2 板及以上家数。 */
  connectionBoards: number;
  /** 当日最高板。 */
  maxBoards: number;
  /** 当日 3 板及以上家数。 */
  board3Plus: number;
}): number {
  if (input.totalLimitUp <= 0) return 0;
  const connectionRatio = input.connectionBoards / input.totalLimitUp;
  const maxBoardScore = Math.min(input.maxBoards / 10, 1);
  const board3PlusRatio = input.connectionBoards > 0 ? input.board3Plus / input.connectionBoards : 0;
  return Math.round(connectionRatio * 40 + maxBoardScore * 30 + board3PlusRatio * 30);
}
