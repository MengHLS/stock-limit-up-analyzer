import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Activity, ArrowLeft, CalendarDays, Loader2, TrendingUp } from "lucide-react";
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
    </div>
  );
}

export default function SentimentAnalysisPage() {
  const { data: trend = [], isLoading, isError, refetch } =
    trpc.sentiment.getMaxConnectionBoardTrend.useQuery(undefined, {
      staleTime: 60_000,
    });

  const rawChartData = trend.map((point) => ({
    ...point,
    shortDate: point.date.slice(5),
  }));
  const peakBoards = rawChartData.reduce((max, point) => Math.max(max, point.maxBoards), 0);
  const chartData = rawChartData;
  const peakDates = chartData.filter((point) => point.maxBoards === peakBoards);
  const latest = chartData[chartData.length - 1];

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
            onClick={() => refetch()}
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
            根据数据库中的涨停记录，按已记录交易日计算每日最高连板数，并在对应数据点展示最高连板股票名称。
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
              <Button variant="outline" className="mt-5" onClick={() => refetch()}>
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
            <div className="grid gap-4 md:grid-cols-3">
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
                  <p className="mt-1 text-xs text-slate-500">数据来自涨停记录表</p>
                </CardContent>
              </Card>
            </div>

            <Card className="border-slate-200 bg-white/90 shadow-xl shadow-slate-200/50">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>每日最高连板折线图</CardTitle>
                    <CardDescription>横轴为日期，纵轴为最高连板数；数据点上方标注当日最高连板股票。</CardDescription>
                  </div>
                  <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
                    {formatDate(chartData[0].date)} 至 {formatDate(chartData[chartData.length - 1].date)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="relative h-[460px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 50, right: 24, left: 0, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="shortDate" tick={{ fontSize: 12, fill: "#64748b" }} minTickGap={18} />
                      <YAxis allowDecimals={false} domain={[0, "dataMax + 1"]} tick={{ fontSize: 12, fill: "#64748b" }} label={{ value: "最高连板数", angle: -90, position: "insideLeft", fill: "#64748b" }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="maxBoards"
                        name="最高连板"
                        stroke="#ea580c"
                        strokeWidth={3}
                        dot={{ r: 5, fill: "#ea580c", stroke: "#fff", strokeWidth: 2 }}
                        activeDot={{ r: 7, fill: "#dc2626" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {peakDates.map((point) => {
                      const pointIndex = chartData.findIndex((item) => item.date === point.date);
                      const xPercent = chartData.length === 1
                        ? 50
                        : 5 + (pointIndex / (chartData.length - 1)) * 90;
                      const yPercent = 4 + (1 - point.maxBoards / (peakBoards + 1)) * 76;
                      return (
                        <div
                          key={`peak-label-${point.date}`}
                          className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700 shadow-sm"
                          style={{ left: `${xPercent}%`, top: `${yPercent}%` }}
                        >
                          {point.stockNames.join("、") || "最高连板"}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

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
