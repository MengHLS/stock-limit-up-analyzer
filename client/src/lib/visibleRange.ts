export type VisibleRange = {
  startIndex: number;
  endIndex: number;
};

export const DEFAULT_VISIBLE_TRADING_DAYS = 90;

export function getDefaultVisibleRange(
  total: number,
  windowSize: number = DEFAULT_VISIBLE_TRADING_DAYS,
): VisibleRange {
  if (total <= 0) return { startIndex: 0, endIndex: 0 };
  return {
    startIndex: Math.max(0, total - windowSize),
    endIndex: total - 1,
  };
}

export function normalizeVisibleRange(
  range: Partial<VisibleRange>,
  total: number,
  fallback: VisibleRange,
): VisibleRange {
  if (total <= 0) return { startIndex: 0, endIndex: 0 };

  const lastIndex = total - 1;
  const startIndex = Math.min(Math.max(range.startIndex ?? fallback.startIndex, 0), lastIndex);
  const endIndex = Math.min(
    Math.max(range.endIndex ?? fallback.endIndex, startIndex),
    lastIndex,
  );

  return { startIndex, endIndex };
}
