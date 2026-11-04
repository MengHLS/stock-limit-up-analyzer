import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CandlestickChart, Loader2 } from "lucide-react";
import { useMemo } from "react";
import type { ReactElement } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TRADING_DAYS_AROUND_TRADE = 30;

type StockDailySeriesPoint = {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  preClose: number | null;
  changePct: number | null;
  volume: number | null;
  amount: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
};

type KlineChartPoint = StockDailySeriesPoint & {
  range: [number, number];
};

export interface StockKlineTradeTarget {
  securityId?: string | null;
  code?: string | null;
  name?: string | null;
  entryTime: string;
  exitTime: string | null;
}

function dateOnly(value: string | null): string | null {
  const match = value?.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function formatPrice(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function formatCompact(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) >= 100_000_000)
    return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(2)} 万`;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(
    value
  );
}

export function oneWordLimitState(
  point: StockDailySeriesPoint
): "ONE_WORD_UP" | "ONE_WORD_DOWN" | null {
  const isOneWord =
    point.high === point.low &&
    point.low === point.open &&
    point.open === point.close;
  if (!isOneWord || point.preClose === null || point.preClose <= 0) return null;
  if (point.close > point.preClose) return "ONE_WORD_UP";
  if (point.close < point.preClose) return "ONE_WORD_DOWN";
  return null;
}

export function candleColor(point: StockDailySeriesPoint): string {
  const oneWordState = oneWordLimitState(point);
  if (oneWordState === "ONE_WORD_UP") return "#dc2626";
  if (oneWordState === "ONE_WORD_DOWN") return "#059669";
  return point.close >= point.open ? "#dc2626" : "#059669";
}

function renderCandle(rawProps: unknown): ReactElement {
  const props = rawProps as {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    payload?: StockDailySeriesPoint;
  };
  const point = props.payload;
  const x = props.x ?? 0;
  const y = props.y ?? 0;
  const width = props.width ?? 0;
  const height = props.height ?? 0;
  if (!point || width <= 0 || height < 0) return <g />;

  const centerX = x + width / 2;
  const color = candleColor(point);
  const rising = color === "#dc2626";

  if (point.high === point.low) {
    const markerWidth = Math.max(6, Math.min(width * 0.64, 12));
    return (
      <line
        x1={centerX - markerWidth / 2}
        x2={centerX + markerWidth / 2}
        y1={y}
        y2={y}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    );
  }

  const priceToY = (price: number) =>
    y + height * ((point.high - price) / (point.high - point.low));
  const openY = priceToY(point.open);
  const closeY = priceToY(point.close);
  const bodyTop = Math.min(openY, closeY);
  const bodyHeight = Math.max(1, Math.abs(closeY - openY));
  const bodyWidth = Math.max(1, Math.min(width * 0.64, 12));

  return (
    <g>
      <line
        x1={centerX}
        x2={centerX}
        y1={y}
        y2={y + height}
        stroke={color}
        strokeWidth={1}
      />
      <rect
        x={centerX - bodyWidth / 2}
        y={bodyTop}
        width={bodyWidth}
        height={bodyHeight}
        fill={rising ? "#fee2e2" : color}
        stroke={color}
        strokeWidth={1}
      />
    </g>
  );
}

function KlineTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: KlineChartPoint }>;
}): ReactElement | null {
  const point = payload?.find(item => item.payload?.tradeDate)?.payload;
  if (!active || !point) return null;
  const oneWordState = oneWordLimitState(point);

  return (
    <div className="min-w-52 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="font-semibold text-slate-800">{point.tradeDate}</p>
      {oneWordState ? (
        <p
          className={`mt-1 inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
            oneWordState === "ONE_WORD_UP"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {oneWordState === "ONE_WORD_UP" ? "一字涨停" : "一字跌停"}
        </p>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono tabular-nums text-slate-600">
        <span>开 {formatPrice(point.open)}</span>
        <span>高 {formatPrice(point.high)}</span>
        <span>低 {formatPrice(point.low)}</span>
        <span>收 {formatPrice(point.close)}</span>
        <span>MA5 {formatPrice(point.ma5)}</span>
        <span>MA10 {formatPrice(point.ma10)}</span>
        <span>MA20 {formatPrice(point.ma20)}</span>
        <span>
          涨跌{" "}
          {point.changePct === null ? "—" : `${point.changePct.toFixed(2)}%`}
        </span>
        <span>量 {formatCompact(point.volume)}</span>
      </div>
    </div>
  );
}

function EmptyTooltip(): null {
  return null;
}

export function StockKlineDialog({
  trade,
  open,
  onOpenChange,
}: {
  trade: StockKlineTradeTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const entryDate = trade
    ? dateOnly(trade.entryTime) ?? trade.entryTime.slice(0, 10)
    : null;
  const exitDate = trade
    ? dateOnly(trade.exitTime) ?? entryDate
    : null;
  const query = trpc.researchRun.stockDailySeries.useQuery(
    {
      securityId: trade?.securityId ?? trade?.code ?? "",
      ...(trade?.code ? { stockCode: trade.code } : {}),
      entryDate: entryDate ?? "",
      exitDate: exitDate ?? "",
      beforeTradingDays: TRADING_DAYS_AROUND_TRADE,
      afterTradingDays: TRADING_DAYS_AROUND_TRADE,
    },
    {
      enabled: open && trade !== null && entryDate !== null && exitDate !== null,
      staleTime: 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );

  const chartData = useMemo<KlineChartPoint[]>(
    () =>
      (query.data?.bars ?? []).map(bar => ({
        ...bar,
        range: [bar.low, bar.high],
      })),
    [query.data?.bars]
  );
  const priceDomain = useMemo<[number, number]>(() => {
    if (chartData.length === 0) return [0, 1];
    const prices = chartData
      .flatMap(point => [
        point.low,
        point.high,
        point.ma5,
        point.ma10,
        point.ma20,
      ])
      .filter((value): value is number => value !== null);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const padding = Math.max((max - min) * 0.05, max * 0.01, 0.01);
    return [min - padding, max + padding];
  }, [chartData]);

  const code = query.data?.stockCode ?? trade?.code ?? null;
  const name = query.data?.name ?? trade?.name ?? "成交详情";
  const lastPoint = chartData.at(-1) ?? null;
  const hasVolume = chartData.some(point => (point.volume ?? 0) > 0);
  const chartWidth = Math.max(960, chartData.length * 6);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-14">
          <div className="flex items-start gap-3 text-left">
            <span className="mt-0.5 rounded-md bg-teal-50 p-2 text-teal-700">
              <CandlestickChart className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base text-slate-900">
                {name}
                {code ? (
                  <span className="ml-2 font-mono text-xs font-normal text-slate-500">
                    {code}
                  </span>
                ) : null}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                {trade
                  ? `${trade.entryTime} 买入 · ${trade.exitTime ?? "持仓中"} 卖出 · 前后各 ${TRADING_DAYS_AROUND_TRADE} 个交易日`
                  : "成交 K 线"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 overflow-auto px-4 pb-5 pt-3 sm:px-5">
          {query.isLoading ? (
            <div className="flex min-h-[460px] items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-teal-700" />
              正在加载日 K 数据
            </div>
          ) : query.isError ? (
            <div className="flex min-h-[460px] items-center justify-center text-sm text-rose-600">
              日 K 数据加载失败：{query.error.message}
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex min-h-[460px] flex-col items-center justify-center text-sm text-slate-500">
              <CandlestickChart className="mb-2 h-7 w-7 text-slate-300" />
              <p>
                {code === null
                  ? "无法解析该股票的行情代码"
                  : "该区间没有可用的日 K 数据"}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
                <span>
                  收盘{" "}
                  <strong className="font-mono text-slate-800">
                    {formatPrice(lastPoint?.close ?? null)}
                  </strong>
                </span>
                <span>
                  区间{" "}
                  <strong className="font-mono text-slate-800">
                    {chartData[0]?.tradeDate} ~ {lastPoint?.tradeDate}
                  </strong>
                </span>
                <span>
                  成交额{" "}
                  <strong className="font-mono text-slate-800">
                    {formatCompact(lastPoint?.amount ?? null)}
                  </strong>
                </span>
              </div>
              <div className="overflow-x-auto pb-1">
                <div style={{ width: chartWidth }}>
                  <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={chartData}
                        syncId="stock-kline"
                        margin={{ top: 12, right: 18, bottom: 4, left: 2 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#e2e8f0"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="tradeDate"
                          height={8}
                          tick={false}
                          tickLine={false}
                        />
                        <YAxis
                          domain={priceDomain}
                          tick={{ fontSize: 11, fill: "#64748b" }}
                          tickFormatter={(value: number) => value.toFixed(2)}
                          width={58}
                        />
                        <Tooltip content={<KlineTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar
                          dataKey="range"
                          name="日 K"
                          fill="#0f766e"
                          shape={renderCandle}
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="ma5"
                          name="MA5"
                          stroke="#f59e0b"
                          strokeWidth={1.8}
                          dot={false}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="ma10"
                          name="MA10"
                          stroke="#2563eb"
                          strokeWidth={1.8}
                          dot={false}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="ma20"
                          name="MA20"
                          stroke="#7c3aed"
                          strokeWidth={1.8}
                          dot={false}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                        {entryDate ? (
                          <ReferenceLine
                            x={entryDate}
                            stroke="#0f766e"
                            strokeDasharray="4 3"
                            label={{
                              value: "买入",
                              position: "insideTopRight",
                              fill: "#0f766e",
                              fontSize: 11,
                            }}
                          />
                        ) : null}
                        {exitDate ? (
                          <ReferenceLine
                            x={exitDate}
                            stroke="#ea580c"
                            strokeDasharray="4 3"
                            label={{
                              value: "卖出",
                              position: "insideTopLeft",
                              fill: "#ea580c",
                              fontSize: 11,
                            }}
                          />
                        ) : null}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 border-t border-slate-100 pt-2">
                    <div className="mb-1 flex items-center justify-between px-1 text-[11px] text-slate-500">
                      <span>成交量</span>
                      <span>手</span>
                    </div>
                    {hasVolume ? (
                      <div className="h-[130px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={chartData}
                            syncId="stock-kline"
                            margin={{ top: 2, right: 18, bottom: 2, left: 2 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="#e2e8f0"
                              vertical={false}
                            />
                            <XAxis
                              dataKey="tradeDate"
                              minTickGap={28}
                              tick={{ fontSize: 11, fill: "#64748b" }}
                              tickFormatter={(value: string) => value.slice(5)}
                            />
                            <YAxis
                              domain={[0, "dataMax"]}
                              tick={{ fontSize: 10, fill: "#94a3b8" }}
                              tickFormatter={(value: number) =>
                                formatCompact(value)
                              }
                              width={58}
                              allowDecimals={false}
                            />
                            <Tooltip
                              content={<EmptyTooltip />}
                              cursor={{ fill: "#f8fafc" }}
                            />
                            <Bar
                              dataKey="volume"
                              name="成交量"
                              maxBarSize={14}
                              isAnimationActive={false}
                            >
                              {chartData.map(point => (
                                <Cell
                                  key={point.tradeDate}
                                  fill={candleColor(point)}
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="flex h-[130px] items-center justify-center text-xs text-slate-400">
                        该区间没有成交量数据
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
