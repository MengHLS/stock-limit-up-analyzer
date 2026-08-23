export type HighBoardTrendPoint = {
  date: string;
  maxBoards: number;
  stockNames: string[];
  stockCodes: string[];
};

export type HighBoardLabelPoint = HighBoardTrendPoint & {
  labelNames: string[];
  labelCodes: string[];
};

/**
 * 对连续交易日中持续达到阈值的同一股票去重。
 * 一只股票在连续高连板阶段只在首次达到阈值的日期展示名称；
 * 若中间某日低于阈值，后续再次达到阈值时会重新展示。
 */
export function buildDistinctHighBoardLabels(
  points: HighBoardTrendPoint[],
  threshold: number = 6,
): HighBoardLabelPoint[] {
  let previousHighCodes = new Set<string>();

  return points.flatMap((point) => {
    const currentHighCodes = point.maxBoards >= threshold
      ? new Set(point.stockCodes)
      : new Set<string>();

    const labelCodes = point.stockCodes.filter((stockCode) => (
      currentHighCodes.has(stockCode) && !previousHighCodes.has(stockCode)
    ));
    const labelNames = labelCodes.map((stockCode) => (
      point.stockNames[point.stockCodes.indexOf(stockCode)] ?? stockCode
    ));

    previousHighCodes = currentHighCodes;

    if (labelCodes.length === 0) return [];
    return [{ ...point, labelNames, labelCodes }];
  });
}
