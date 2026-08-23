import { useEffect, useRef, useState } from "react";
import {
  continuousIndexFromClientX,
  moveContinuousRange,
  resizeContinuousRange,
  snapContinuousRange,
  type ContinuousRange,
} from "@/lib/continuousRange";
import type { VisibleRange } from "@/lib/visibleRange";

type PreviewPoint = {
  value: number;
};

type DragMode = "move" | "start" | "end";

type DragState = {
  mode: DragMode;
  startPointerIndex: number;
  startRange: ContinuousRange;
};

type ContinuousRangeSliderProps = {
  data: PreviewPoint[];
  range: VisibleRange;
  onRangeChange: (range: VisibleRange) => void;
};

function toPercent(index: number, total: number) {
  if (total <= 1) return 0;
  return (index / (total - 1)) * 100;
}

function createSparklinePath(data: PreviewPoint[], width = 100, height = 32) {
  if (data.length === 0) return "";
  const maxValue = Math.max(...data.map((point) => point.value), 1);
  const step = data.length === 1 ? 0 : width / (data.length - 1);

  return data.map((point, index) => {
    const x = index * step;
    const y = height - (point.value / maxValue) * (height - 4) - 2;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

export function ContinuousRangeSlider({ data, range, onRangeChange }: ContinuousRangeSliderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const displayRangeRef = useRef<ContinuousRange>(range);
  const [displayRange, setDisplayRange] = useState<ContinuousRange>(range);
  const [isDragging, setIsDragging] = useState(false);
  const total = data.length;
  const fallbackRange = range;
  const lastIndex = Math.max(total - 1, 0);

  useEffect(() => {
    if (isDragging) return;
    displayRangeRef.current = range;
    setDisplayRange(range);
  }, [isDragging, range.endIndex, range.startIndex]);

  const updateDisplayRange = (nextRange: ContinuousRange) => {
    displayRangeRef.current = nextRange;
    setDisplayRange(nextRange);
  };

  const getPointerIndex = (clientX: number) => {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return 0;
    return continuousIndexFromClientX(clientX, bounds.left, bounds.width, total);
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>, mode: DragMode) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode,
      startPointerIndex: getPointerIndex(event.clientX),
      startRange: displayRangeRef.current,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    const pointerIndex = getPointerIndex(event.clientX);
    const nextRange = drag.mode === "move"
      ? moveContinuousRange(drag.startRange, pointerIndex - drag.startPointerIndex, total)
      : resizeContinuousRange(drag.startRange, pointerIndex, drag.mode, total);
    updateDisplayRange(nextRange);
  };

  const finishDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsDragging(false);
    const snappedRange = snapContinuousRange(displayRangeRef.current, total, fallbackRange);
    displayRangeRef.current = snappedRange;
    setDisplayRange(snappedRange);
    onRangeChange(snappedRange);
  };

  const startPercent = toPercent(displayRange.startIndex, total);
  const endPercent = toPercent(displayRange.endIndex, total);
  const selectionWidth = Math.max(endPercent - startPercent, total > 1 ? 1.4 : 100);
  const sparklinePath = createSparklinePath(data);
  const selectedCount = Math.round(displayRange.endIndex) - Math.round(displayRange.startIndex) + 1;

  return (
    <div
      ref={rootRef}
      className="relative h-[68px] touch-none select-none overflow-hidden rounded-lg border border-orange-100 bg-orange-50/50"
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      aria-label="历史交易日范围选择器"
    >
      <svg className="pointer-events-none absolute inset-x-0 top-1 h-8 w-full" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
        <path d={sparklinePath} fill="none" stroke="#fdba74" strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute inset-x-3 bottom-2 top-9 rounded-md border border-orange-200/70 bg-white/60" />
      <div
        className={`absolute bottom-2 top-9 rounded-md border-2 border-orange-400 bg-orange-200/55 shadow-sm ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ left: `${startPercent}%`, width: `${selectionWidth}%` }}
        onPointerDown={(event) => startDrag(event, "move")}
      >
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-orange-800">
          {Math.max(selectedCount, 1)} 个交易日
        </span>
        <div
          className="absolute -left-2 top-1/2 h-7 w-4 -translate-y-1/2 cursor-ew-resize rounded border border-orange-500 bg-white shadow-sm"
          onPointerDown={(event) => startDrag(event, "start")}
          aria-label="调整起始日期"
        />
        <div
          className="absolute -right-2 top-1/2 h-7 w-4 -translate-y-1/2 cursor-ew-resize rounded border border-orange-500 bg-white shadow-sm"
          onPointerDown={(event) => startDrag(event, "end")}
          aria-label="调整结束日期"
        />
      </div>
      <div className="pointer-events-none absolute inset-x-3 bottom-0 flex justify-between text-[10px] text-orange-700/70">
        <span>历史</span>
        <span>最新</span>
      </div>
      <span className="sr-only">连续拖动选区，松手后会对齐至最近交易日。</span>
    </div>
  );
}
