import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ContinuousRangeSlider } from "@/components/ContinuousRangeSlider";
import { buildDistinctHighBoardLabels } from "@/lib/highBoardLabels";
import { trpc } from "@/lib/trpc";
import { DEFAULT_VISIBLE_TRADING_DAYS, getDefaultVisibleRange, normalizeVisibleRange } from "@/lib/visibleRange";
import { Activity, ArrowLeft, CalendarDays, Crown, Flame, GitBranch, Loader2, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function formatDate(date: string) {
  return date.replace(/^(\d{4})-/, "$1年").replace(/-(\d{2})$/, "月$1日");
}

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-sm font-semibold text-slate-800">{formatDate(point.date)}</p>
      <p className="mt-1 text-sm text-orange-700">最高连板：{point.maxBoards}板</p>
      <p className="mt-1 max-w-[240px] text-xs text-slate-600">
        {point.stockNames.length > 0 ? `股票：${point.stockNames.join("、")}` : "当日暂无涨停记录"}
      </p>
      {point.phase && <p className="mt-1 text-xs font-medium text-sky-700">{point.marketCycle} · {point.phase} · {point.phaseReason}</p>}
    </div>
  );
}

export default function SentimentAnalysisPage() {
  const [visibleRange, setVisibleRange] = useState({ startIndex: 0, endIndex: 0 });
  const { data: trend = [], isLoading, isError, refetch } =
    trpc.sentiment.getMaxConnectionBoardTrend.useQuery(undefined, {
      staleTime: 60_000,
    });
  const { data: cycleAnalysis, refetch: refetchCycle } = trpc.sentiment.getSentimentCycleAnalysis.useQuery(undefined, {
    staleTime: 60_000,
  });

  const cycleByDate = new Map((cycleAnalysis?.days ?? []).map((day) => [day.date, day]));
  const rawChartData = trend.map((point) => ({
    ...point,
    shortDate: point.date.slice(5),
    ...(cycleByDate.get(point.date) ?? {}),
  }));
  const peakBoards = rawChartData.reduce((max, point) => Math.max(max, point.maxBoards), 0);
  const chartData = rawChartData;
  const peakDates = chartData.filter((point) => point.maxBoards === peakBoards);
  const latest = chartData[chartData.length - 1];
  const defaultRange = getDefaultVisibleRange(chartData.length, DEFAULT_VISIBLE_TRADING_DAYS);

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
  const latestCycleDay = cycleAnalysis?.days.at(-1);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-orange-50/40 to-red-50/50">
      <header className="sticky top-0 z-50 w-full border-b bg-white/85 backdrop-blur-xl">
        <div className="container flex h-16 items-center">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </Button>
          </Link>
          <div className="ml-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-orange-600" />
            <h1 className="text-lg font-semibold text-slate-800">情绪分析</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto gap-2"
            onClick={() => { void refetch(); void refetchCycle(); }}
            disabled={isLoading}
          >
            <TrendingUp className="h-4 w-4" />
            刷新数据
          </Button>
        </div>
      </header>

      <main className="container max-w-7xl py-8">
        <div className="mb-6">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-orange-600">Market Sentiment</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">最高连板趋势</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            主板高于5板才确认为周期龙头；没有6板及以上主板股票时标记为混沌周期。原周期龙断板后，后续严格突破老龙高度的才是穿越周期龙；未突破但达到6板的统一归为补涨龙。
            创业板、科创板和北交所股票不参与本项统计。
          </p>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20 text-center">
              <Activity className="mb-4 h-12 w-12 text-red-300" />
              <p className="font-medium text-slate-800">最高连板数据加载失败</p>
              <p className="mt-2 text-sm text-slate-500">请稍后重试，或检查数据库连接状态。</p>
              <Button variant="outline" className="mt-5" onClick={() => { void refetch(); void refetchCycle(); }}>
                重新加载
              </Button>
            </CardContent>
          </Card>
        ) : chartData.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-24 text-center">
              <CalendarDays className="mb-4 h-12 w-12 text-orange-300" />
              <p className="font-medium text-slate-800">暂无最高连板数据</p>
              <p className="mt-2 text-sm text-slate-500">录入涨停记录后，这里会自动生成每日趋势。</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <Card className="border-orange-100 bg-white/80 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-600">当前最高连板</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-orange-600">{latest?.maxBoards ?? 0}<span className="ml-1 text-base">板</span></div>
                  <p className="mt-1 text-xs text-slate-500">{latest ? formatDate(latest.date) : "-"}</p>
                </CardContent>
              </Card>
              <Card className="border-red-100 bg-white/80 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-600">历史最高连板</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-red-600">{peakBoards}<span className="ml-1 text-base">板</span></div>
                  <p className="mt-1 text-xs text-slate-500">共 {peakDates.length} 个交易日达到</p>
                </CardContent>
              </Card>
              <Card className="border-blue-100 bg-white/80 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-600">统计交易日</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-blue-600">{chartData.length}<span className="ml-1 text-base">天</span></div>
                  <p className="mt-1 text-xs text-slate-500">仅统计主板涨停记录</p>
                </CardContent>
              </Card>
              <Card className="border-sky-100 bg-white/80 shadow-sm">
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-600">当前市场周期</CardTitle></CardHeader>
                <CardContent><div className="text-xl font-bold text-sky-700">{latestCycleDay?.marketCycle ?? "-"}</div><p className="mt-1 text-xs font-medium text-slate-600">{latestCycleDay?.phase ?? "等待阶段数据"}</p><p className="mt-1 line-clamp-2 text-xs text-slate-500">{latestCycleDay?.phaseReason ?? "等待周期分析数据"}</p></CardContent>
              </Card>
            </div>

            <Card className="border-slate-200 bg-white/90 shadow-xl shadow-slate-200/50">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>每日最高连板折线图</CardTitle>
                    <CardDescription>仅统计主板股票；默认显示最近90个交易日，并对每段连续高连板仅标注一次股票名称。</CardDescription>
                  </div>
                  <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
                    {formatDate(visibleChartData[0]?.date ?? chartData[0].date)} 至 {formatDate(visibleChartData.at(-1)?.date ?? chartData.at(-1)?.date ?? "")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="relative h-[430px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={visibleChartData} margin={{ top: 50, right: 24, left: 0, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="shortDate" tick={{ fontSize: 12, fill: "#64748b" }} minTickGap={18} />
                      <YAxis width={60} allowDecimals={false} domain={[0, "dataMax + 1"]} tick={{ fontSize: 12, fill: "#64748b" }} label={{ value: "最高连板数", angle: -90, position: "insideLeft", fill: "#64748b" }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="maxBoards"
                        name="最高连板"
                        stroke="#ea580c"
                        strokeWidth={3}
                        dot={{ r: 5, fill: "#ea580c", stroke: "#fff", strokeWidth: 2 }}
                        activeDot={{ r: 7, fill: "#dc2626" }}
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
                  <p className="text-center text-xs text-slate-500">连续拖动选区或两端手柄，松手后会对齐交易日并更新主图；悬浮数据点可查看对应情绪阶段。</p>
                </div>
              </CardContent>
            </Card>

            {cycleAnalysis && (
              <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr]">
                <Card className="border-sky-100 bg-white/85 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Flame className="h-4 w-4 text-orange-600" />情绪周期与周期龙头</CardTitle>
                    <CardDescription>周期龙头仅指主板6板及以上股票；没有6板以上主板股票的阶段显示为混沌周期。</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {cycleAnalysis.segments.slice(-8).reverse().map((segment) => (
                        <div key={`${segment.marketCycle}-${segment.startDate}`} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                          <div className="flex items-center justify-between gap-2"><div className="flex flex-wrap gap-1"><Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">{segment.marketCycle}</Badge><Badge variant="outline" className="border-slate-200 bg-white text-slate-600">{segment.phases.join(" · ")}</Badge></div><span className="text-xs font-medium text-orange-600">阶段最高 {segment.maxBoards}板</span></div>
                          <p className="mt-2 text-xs text-slate-500">{formatDate(segment.startDate)} 至 {formatDate(segment.endDate)}</p>
                          <p className="mt-1 line-clamp-2 text-sm text-slate-700">周期龙头：{segment.leaderNames.join("、") || "本阶段尚无6板以上主板股票"}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-rose-100 bg-white/85 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-rose-600" />周期龙断板后的穿越龙与补涨龙</CardTitle>
                    <CardDescription>仅以6板及以上原周期龙的断板事件复盘：后续严格突破老龙高度的为穿越周期龙；未突破但达到6板的，统一为补涨龙。</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {cycleAnalysis.breakEvents.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">当前样本尚未识别到6板及以上原周期龙的完整断板事件。</p> : <div className="space-y-3">{cycleAnalysis.breakEvents.slice(0, 5).map((event) => (
                      <article key={event.breakDate} className="rounded-xl border border-rose-100 bg-rose-50/30 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-slate-800">{formatDate(event.breakDate)} 原龙头断板</p><p className="mt-1 text-xs text-slate-500">前日 {formatDate(event.previousDate)} · {event.originalLeaderNames.join("、")} · {event.originalMaxBoards}板</p></div><Badge variant="outline" className="border-rose-200 bg-white text-rose-700">断板日最高 {event.breakDayMaxBoards}板</Badge></div>
                        <div className="mt-3 grid gap-2 border-t border-rose-100 pt-3 sm:grid-cols-2"><div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3"><p className="mb-2 text-xs font-semibold text-violet-800">穿越周期龙</p><p className="mb-2 text-[11px] text-violet-700">后续严格突破老龙 {event.originalMaxBoards}板。</p>{event.throughCycleLeaders.length === 0 ? <p className="text-xs text-slate-500">暂无历史已验证样本。</p> : event.throughCycleLeaders.map((leader) => <p key={leader.stockCode} className="mb-1 text-xs text-slate-700"><strong>{leader.stockName}</strong> · 断板日{leader.breakDayBoards}板，后续{leader.highestBoardsAfterBreak}板 · {leader.breakthroughDate ? `${formatDate(leader.breakthroughDate)}突破` : leader.validationStatus}</p>)}</div><div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3"><p className="mb-2 text-xs font-semibold text-emerald-800">补涨龙</p><p className="mb-2 text-[11px] text-emerald-700">未突破老龙高度，但后续达到6板。</p>{event.reboundLeaders.length === 0 ? <p className="text-xs text-slate-500">暂无历史已验证样本。</p> : event.reboundLeaders.map((leader) => <p key={leader.stockCode} className="mb-1 text-xs text-slate-700"><strong>{leader.stockName}</strong> · 断板日{leader.breakDayBoards}板，后续{leader.highestBoardsAfterBreak}板 · {leader.breakthroughDate ? `${formatDate(leader.breakthroughDate)}达到6板` : leader.validationStatus}</p>)}</div></div>
                        {event.postBreakObservations.length > 0 && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5"><p className="flex items-center gap-1 text-xs font-medium text-amber-800"><Crown className="h-3.5 w-3.5" />断板日观察股（未满足历史确认条件）</p><p className="mt-1 text-xs text-slate-600">{event.postBreakObservations.map((leader) => `${leader.stockName} ${leader.breakDayBoards}板${leader.score === null ? "" : `/${leader.score}分`}·${leader.validationStatus}`).join("；")}</p></div>}
                      </article>
                    ))}</div>}
                  </CardContent>
                </Card>
              </div>
            )}

            <Card className="border-slate-200 bg-white/80 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">每日最高连板明细</CardTitle>
                <CardDescription>用于查看折线图标注之外的完整日期与股票名称。</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {chartData.slice().reverse().map((point) => (
                    <div key={point.date} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-700">{formatDate(point.date)}</span>
                        <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">{point.maxBoards}板</Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500" title={point.stockNames.join("、")}>
                        {point.stockNames.length > 0 ? point.stockNames.join("、") : "暂无股票名称"}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
