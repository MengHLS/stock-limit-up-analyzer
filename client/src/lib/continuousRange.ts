import { normalizeVisibleRange, type VisibleRange } from "./visibleRange";

export type ContinuousRange = {
  startIndex: number;
  endIndex: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function moveContinuousRange(
  range: ContinuousRange,
  delta: number,
  total: number,
): ContinuousRange {
  const lastIndex = Math.max(total - 1, 0);
  const span = Math.max(range.endIndex - range.startIndex, 0);
  const startIndex = clamp(range.startIndex + delta, 0, Math.max(lastIndex - span, 0));

  return { startIndex, endIndex: startIndex + span };
}

export function resizeContinuousRange(
  range: ContinuousRange,
  nextIndex: number,
  edge: "start" | "end",
  total: number,
): ContinuousRange {
  const lastIndex = Math.max(total - 1, 0);

  if (edge === "start") {
    return {
      startIndex: clamp(nextIndex, 0, range.endIndex),
      endIndex: range.endIndex,
    };
  }

  return {
    startIndex: range.startIndex,
    endIndex: clamp(nextIndex, range.startIndex, lastIndex),
  };
}

export function snapContinuousRange(
  range: ContinuousRange,
  total: number,
  fallback: VisibleRange,
): VisibleRange {
  return normalizeVisibleRange({
    startIndex: Math.round(range.startIndex),
    endIndex: Math.round(range.endIndex),
  }, total, fallback);
}

export function continuousIndexFromClientX(
  clientX: number,
  left: number,
  width: number,
  total: number,
): number {
  if (total <= 1 || width <= 0) return 0;
  const progress = clamp((clientX - left) / width, 0, 1);
  return progress * (total - 1);
}
