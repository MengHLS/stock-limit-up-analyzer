import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ContinuousRangeSlider } from "@/components/ContinuousRangeSlider";
import { useTheme } from "@/contexts/ThemeContext";
import { formatChineseDate } from "@/lib/displayFormat";
import { buildDistinctHighBoardLabels, type HighBoardTrendPoint } from "@/lib/highBoardLabels";
import { cn } from "@/lib/utils";
import { DEFAULT_VISIBLE_TRADING_DAYS, getDefaultVisibleRange, normalizeVisibleRange } from "@/lib/visibleRange";
import { type ComponentProps, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * 「每日最高连板折线图 + 日期范围滑块」区块 —— `/sentiment-analysis` 与首页（`/`）**共用同一份实现**。
 *
 * 为什么抽成组件（2026-09-20，用户口述：「我是要把最高连板折线图展示在首页，包含折线图下面的
 * 日期选择滑块」）：这段图表原本只长在 `SentimentAnalysis.tsx` 里，若在首页**复制一份**，
 * 「高连板标签去重规则（`buildDistinctHighBoardLabels`）」「窗口对齐（`normalizeVisibleRange`）」
 * 「标签随轴宽的定位公式」会立刻出现两套，日后必然漂移。因此本组件是这段图表**唯一实现**，
 * 两个页面只传数据与少量展示参数。
 *
 * 与页面解耦的三处：
 *   · 数据来源不在这里（两个页面各自持有 tRPC query，各自渲染骨架屏/空态）；
 *   · 卡片底色/边框可被 `className` 覆盖（首页用主题令牌 `bg-card border-border`，
 *     情绪分析页保持原 `bg-white/90 border-slate-200 shadow-xl`）；
 *   · `headerExtra` 承载各页面自己的附加入口（首页是「查看完整周期分析」文本链接）。
 *
 * 🔴 夜间可读性：recharts 的 `stroke` / `fill` 是 **SVG 属性**，`darkCompatibility.css`
 * （只映射 Tailwind 类名）**够不到**它们 ⇒ 网格、刻度文字、折线必须按**实际生效主题**
 * （`useTheme()`）取色。日间档位与旧实现逐值相同，夜间档位只压暗网格、提亮折线/刻度，
 * 使折线对暗色卡面对比度 ≥ 3（图形对象阈值）。
 */
const CHART_PALETTE = {
  light: { grid: "#e2e8f0", axis: "#64748b", line: "#ea580c", dotRing: "#ffffff", activeDot: "#dc2626" },
  dark: { grid: "#3f3f46", axis: "#a1a1aa", line: "#fb923c", dotRing: "#1c1c21", activeDot: "#f87171" },
} as const;

/** 服务端趋势点，可选叠加周期分析字段（首页不拉周期分析，故三个字段均可缺）。 */
export type MaxConnectionBoardTrendChartPoint = HighBoardTrendPoint & {
  marketCycle?: string | null;
  phase?: string | null;
  phaseReason?: string | null;
};

const DEFAULT_SLIDER_HINT = "连续拖动选区或两端手柄，松手后会对齐交易日并更新主图；悬浮数据点可查看对应情绪阶段。";

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: MaxConnectionBoardTrendChartPoint }> }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg">
      <p className="text-sm font-semibold">{formatChineseDate(point.date)}</p>
      <p className="mt-1 text-sm text-orange-700">最高连板：{point.maxBoards}板</p>
      <p className="mt-1 max-w-[240px] text-xs text-muted-foreground">
        {point.stockNames.length > 0 ? `股票：${point.stockNames.join("、")}` : "当日暂无涨停记录"}
      </p>
      {point.phase && (
        <p className="mt-1 text-xs font-medium text-sky-700">
          {point.marketCycle} · {point.phase} · {point.phaseReason}
        </p>
      )}
    </div>
  );
}

type Props = {
  /** 每日最高连板趋势点（按日期升序）。 */
  points: MaxConnectionBoardTrendChartPoint[];
  /** 默认可见窗口（交易日）。 */
  visibleDays?: number;
  /** 主图高度（px）。 */
  chartHeight?: number;
  /**
   * Y 轴是否画旋转标题（单位）。
   * 首页传 `null`：首页既有硬口径是「不画旋转轴标题，单位由小标题/图例承载」
   * （旧版 `angle: ±90` 的轴标题在轴宽不足时会与刻度数字重叠，用户反馈「根本看不见」）。
   */
  yAxisLabel?: string | null;
  /** 滑块下方提示文案。 */
  sliderHint?: string;
  /** 卡片头右侧的额外交互。 */
  headerExtra?: ReactNode;
  /** 追加到卡片容器的类名（`cn` 走 tailwind-merge，可覆盖默认底色/边框）。 */
  className?: string;
  /**
   * 透传给 `Card` 的属性 —— 主要用途是**探针挂钩**（`data-*`）。
   * 这里显式补一条 `data-*` 索引签名：`React.ComponentProps<"div">` 本身**不含**它
   * （JSX 里写 `data-x` 由 JSX 检查器放行，但对象字面量会触发多余属性报错）。
   */
  cardProps?: ComponentProps<typeof Card> & { [key: `data-${string}`]: string | number | boolean | undefined };
};

export function MaxConnectionBoardTrendChart({
  points,
  visibleDays = DEFAULT_VISIBLE_TRADING_DAYS,
  chartHeight = 430,
  yAxisLabel = "最高连板数",
  sliderHint = DEFAULT_SLIDER_HINT,
  headerExtra,
  className,
  cardProps,
}: Props) {
  const { theme } = useTheme();
  const palette = theme === "dark" ? CHART_PALETTE.dark : CHART_PALETTE.light;
  const [visibleRange, setVisibleRange] = useState({ startIndex: 0, endIndex: 0 });

  const chartData = useMemo(
    () => points.map((point) => ({ ...point, shortDate: point.date.slice(5) })),
    [points],
  );
  const defaultRange = useMemo(
    () => getDefaultVisibleRange(chartData.length, visibleDays),
    [chartData.length, visibleDays],
  );

  useEffect(() => {
    if (chartData.length === 0) return;
    setVisibleRange(defaultRange);
  }, [chartData.length, defaultRange.startIndex, defaultRange.endIndex]);

  const { startIndex: visibleStartIndex, endIndex: visibleEndIndex } = normalizeVisibleRange(
    visibleRange,
    chartData.length,
    defaultRange,
  );
  const visibleChartData = chartData.slice(visibleStartIndex, visibleEndIndex + 1);
  const visiblePeakBoards = visibleChartData.reduce((max, point) => Math.max(max, point.maxBoards), 0);
  const visibleHighBoardLabels = buildDistinctHighBoardLabels(visibleChartData);

  if (chartData.length === 0) return null;

  return (
    <Card {...cardProps} className={cn("border-slate-200 bg-white/90 shadow-xl shadow-slate-200/50", className)}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>每日最高连板折线图</CardTitle>
            <CardDescription>
              仅统计主板股票；默认显示最近 {visibleDays} 个交易日，并对每段连续高连板仅标注一次股票名称。
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
              {formatChineseDate(visibleChartData[0]?.date ?? chartData[0].date)} 至{" "}
              {formatChineseDate(visibleChartData.at(-1)?.date ?? chartData.at(-1)?.date ?? "")}
            </Badge>
            {headerExtra}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="relative w-full" style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={visibleChartData} margin={{ top: 50, right: 24, left: 0, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} />
                <XAxis dataKey="shortDate" tick={{ fontSize: 12, fill: palette.axis }} minTickGap={18} />
                <YAxis
                  width={60}
                  allowDecimals={false}
                  domain={[0, "dataMax + 1"]}
                  tick={{ fontSize: 12, fill: palette.axis }}
                  label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: "insideLeft", fill: palette.axis } : undefined}
                />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="maxBoards"
                  name="最高连板"
                  stroke={palette.line}
                  strokeWidth={3}
                  dot={{ r: 5, fill: palette.line, stroke: palette.dotRing, strokeWidth: 2 }}
                  activeDot={{ r: 7, fill: palette.activeDot }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 overflow-visible">
              {visibleHighBoardLabels.map((point, labelIndex) => {
                const pointIndex = visibleChartData.findIndex((item) => item.date === point.date);
                const pointProgress = visibleChartData.length === 1
                  ? 0.5
                  : pointIndex / (visibleChartData.length - 1);
                // 图表左侧为固定60px的Y轴，右侧为24px边距；以真实绘图区而非容器百分比定位。
                const centeredLeft = visibleChartData.length === 1
                  ? "calc(50% + 18px)"
                  : `calc(60px + ${pointProgress * 100}% - ${pointProgress * 84}px)`;
                const yPercent = 4 + (1 - point.maxBoards / (visiblePeakBoards + 1)) * 70;
                return (
                  <div
                    key={`high-board-label-${point.date}`}
                    className="absolute inline-flex min-w-[72px] max-w-[180px] -translate-x-1/2 -translate-y-full items-center justify-center rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-center text-xs font-semibold leading-5 text-orange-700 shadow-sm"
                    style={{
                      left: centeredLeft,
                      top: `${yPercent}%`,
                      marginTop: `${-(labelIndex % 2) * 28}px`,
                    }}
                  >
                    {point.labelNames.join("、") || `${point.maxBoards}板`}
                  </div>
                );
              })}
            </div>
          </div>
          <ContinuousRangeSlider
            data={chartData.map((point) => ({ value: point.maxBoards }))}
            range={{ startIndex: visibleStartIndex, endIndex: visibleEndIndex }}
            onRangeChange={setVisibleRange}
          />
          <p className="text-center text-xs text-slate-500">{sliderHint}</p>
        </div>
      </CardContent>
    </Card>
  );
}
