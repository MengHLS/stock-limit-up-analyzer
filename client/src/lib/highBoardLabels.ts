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
 * 对连续交易日中持续达到阈值的同一股票去重，并将名称定位到该阶段的最高连板节点。
 * 若中间某日低于阈值，后续再次达到阈值时会作为新的连续阶段重新标注。
 */
export function buildDistinctHighBoardLabels(
  points: HighBoardTrendPoint[],
  threshold: number = 6,
): HighBoardLabelPoint[] {
  type ActiveRun = { stockName: string; peakIndex: number; peakBoards: number };
  const activeRuns = new Map<string, ActiveRun>();
  const labelsByIndex = new Map<number, Map<string, string>>();

  const flushRun = (stockCode: string, run: ActiveRun) => {
    const labels = labelsByIndex.get(run.peakIndex) ?? new Map<string, string>();
    labels.set(stockCode, run.stockName);
    labelsByIndex.set(run.peakIndex, labels);
  };

  points.forEach((point, index) => {
    const currentCodes = point.maxBoards >= threshold
      ? new Set(point.stockCodes)
      : new Set<string>();

    for (const [stockCode, run] of Array.from(activeRuns.entries())) {
      if (!currentCodes.has(stockCode)) {
        flushRun(stockCode, run);
        activeRuns.delete(stockCode);
      }
    }

    if (point.maxBoards < threshold) return;

    point.stockCodes.forEach((stockCode, stockIndex) => {
      const stockName = point.stockNames[stockIndex] ?? stockCode;
      const activeRun = activeRuns.get(stockCode);
      if (!activeRun) {
        activeRuns.set(stockCode, {
          stockName,
          peakIndex: index,
          peakBoards: point.maxBoards,
        });
        return;
      }

      // 同一阶段内板数相同的情况下，采用较晚日期，使标签贴近连板阶段终点。
      if (point.maxBoards >= activeRun.peakBoards) {
        activeRun.peakIndex = index;
        activeRun.peakBoards = point.maxBoards;
        activeRun.stockName = stockName;
      }
    });
  });

  for (const [stockCode, run] of Array.from(activeRuns.entries())) {
    flushRun(stockCode, run);
  }

  return Array.from(labelsByIndex.entries())
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([index, labels]) => ({
      ...points[index],
      labelCodes: Array.from(labels.keys()),
      labelNames: Array.from(labels.values()),
    }));
}
