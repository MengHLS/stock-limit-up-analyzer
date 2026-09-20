import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MaxConnectionBoardTrendChart } from "@/components/MaxConnectionBoardTrendChart";
import { formatChineseDate as formatDate } from "@/lib/displayFormat";
import { trpc } from "@/lib/trpc";
import { Activity, CalendarDays, ChevronDown, ChevronUp, Crown, Flame, GitBranch, Loader2, TrendingUp } from "lucide-react";
import { useState } from "react";

/** 龙头列表默认折叠，仅展示最近确认的 N 只，其余展开后可见。 */
const LEADER_LIST_PREVIEW_COUNT = 6;

export default function SentimentAnalysisPage() {
  const [leaderListExpanded, setLeaderListExpanded] = useState(false);
  /**
   * 服务端结果缓存的键（见 `server/db.ts` 的 `sentimentTrendCache` / `sentimentCycleCache`）。
   *
   * 这两个端点要做「全表取数 + 全量重算」（实测取数 2.4~2.8s、计算 16.5s），因此服务端加了
   * 10 分钟 TTL 结果缓存 + 单飞：**普通挂载固定用 0** ⇒ 复用缓存（秒开）；
   * 「刷新数据」按钮把 nonce 自增 ⇒ 换键 ⇒ 强制真重算（而不是清空别人的缓存，也不是假刷新）。
   */
  const [cacheNonce, setCacheNonce] = useState(0);
  const { data: trend = [], isLoading, isError, isFetching } =
    trpc.sentiment.getMaxConnectionBoardTrend.useQuery({ nonce: cacheNonce }, {
      staleTime: 60_000,
    });
  const { data: cycleAnalysis, isFetching: isCycleFetching } = trpc.sentiment.getSentimentCycleAnalysis.useQuery({ nonce: cacheNonce }, {
    staleTime: 60_000,
  });
  const isRefreshing = isFetching || isCycleFetching;

  /**
   * 趋势点叠加周期分析字段（`phase` / `marketCycle` / `phaseReason`）供图表 tooltip 使用。
   *
   * ⚠️ 展开顺序**不可调换**：周期分析在后（与抽取组件前逐字段一致）。两份数据同源，
   * 但保持原顺序是「重构不改行为」这条判据的一部分。
   */
  const cycleByDate = new Map((cycleAnalysis?.days ?? []).map((day) => [day.date, day]));
  const chartData = trend.map((point) => ({
    ...point,
    ...(cycleByDate.get(point.date) ?? {}),
  }));
  const peakBoards = chartData.reduce((max, point) => Math.max(max, point.maxBoards), 0);
  const peakDates = chartData.filter((point) => point.maxBoards === peakBoards);
  const latest = chartData[chartData.length - 1];
  const latestCycleDay = cycleAnalysis?.days.at(-1);
  const leaderList = cycleAnalysis?.leaderList ?? [];
  const visibleLeaderList = leaderListExpanded ? leaderList : leaderList.slice(0, LEADER_LIST_PREVIEW_COUNT);

  return (
    <div className="container max-w-7xl py-6">
      <div className="mb-6 flex items-center gap-2">
        <Activity className="h-5 w-5 text-orange-600" />
        <h1 className="text-lg font-semibold text-slate-800">情绪分析</h1>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto gap-2"
          onClick={() => setCacheNonce((previous) => previous + 1)}
          disabled={isRefreshing}
        >
          {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
          {isRefreshing ? "刷新中…" : "刷新数据"}
        </Button>
      </div>
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
              <Button variant="outline" className="mt-5" onClick={() => setCacheNonce((previous) => previous + 1)}>
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

            {/*
              折线图 + 日期范围滑块已抽到 `@/components/MaxConnectionBoardTrendChart`：
              首页（`/`）复用**同一份实现**（用户 2026-09-20 要求把这张图放到首页最下面），
              去重标注规则 `buildDistinctHighBoardLabels` 与窗口对齐 `normalizeVisibleRange`
              因此仍然只有一处实现。`data-sentiment-chart` 保留（既有探针依赖该选择器）。
            */}
            <MaxConnectionBoardTrendChart points={chartData} cardProps={{ "data-sentiment-chart": true }} />

            {cycleAnalysis && (
              <div data-sentiment-cycle className="grid gap-6 lg:grid-cols-[1fr_1.35fr]">
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
                    <div className="mt-4 border-t border-sky-100 pt-4">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Crown className="h-4 w-4 text-amber-600" />已确认原生龙</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">以同一连续连板段的首日判断：起涨日最高连板不超过2板、无既有周期龙头，且该段后续达到6板后才完成历史确认。</p>
                      {cycleAnalysis.nativeLeaders.length === 0 ? <p className="py-4 text-center text-xs text-slate-500">当前样本未出现已确认的原生龙。</p> : <div className="mt-3 space-y-2">{cycleAnalysis.nativeLeaders.slice(0, 6).map((leader) => <div key={leader.stockCode} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-800">{leader.stockName}</p><Badge variant="outline" className="border-amber-200 bg-white text-amber-700">原生龙</Badge></div><p className="mt-1 text-xs text-slate-600">{leader.sector} · {formatDate(leader.startDate)} 从低位混沌期首板起涨（当日最高{leader.startDayMaxBoards}板）</p><p className="mt-1 text-xs font-medium text-amber-800">{formatDate(leader.confirmationDate)} 确认达到6板</p></div>)}</div>}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-rose-100 bg-white/85 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-rose-600" />龙头列表</CardTitle>
                    <CardDescription>覆盖数据库内全部已记录交易日，汇总全部已确认主板龙头，同一股票只展示一行；默认仅显示最近确认的 6 只，可展开查看全部。原生龙仅指未被穿越周期龙或补涨龙身份覆盖的独立来源类型。</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {leaderList.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">当前样本尚未出现已确认的主板龙头。</p> : <div className="space-y-2">{visibleLeaderList.map((leader) => (
                      <article key={leader.stockCode} className="rounded-xl border border-rose-100 bg-rose-50/25 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-slate-800">{leader.stockName}</p><p className="mt-1 text-xs text-slate-500">{leader.sector} · 首次确认 {formatDate(leader.firstLeaderDate)}</p></div><span className="rounded-md bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700">最高 {leader.highestBoards}板</span></div>
                        <div className="mt-2 flex flex-wrap gap-1.5">{leader.leaderTypes.map((type) => <Badge key={type} variant="outline" className={type === "原生龙" ? "border-amber-200 bg-amber-50 text-amber-800" : type === "穿越周期龙" ? "border-violet-200 bg-violet-50 text-violet-800" : type === "补涨龙" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-white text-rose-700"}>{type}</Badge>)}</div>
                        <p className="mt-2 text-xs leading-5 text-slate-600">{leader.sourceNotes.join("；")}</p>
                      </article>
                    ))}</div>}
                    {leaderList.length > LEADER_LIST_PREVIEW_COUNT && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full gap-2 border-rose-200 text-rose-700 hover:bg-rose-50"
                        onClick={() => setLeaderListExpanded((previous) => !previous)}
                      >
                        {leaderListExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        {leaderListExpanded
                          ? `收起（共 ${leaderList.length} 只）`
                          : `展开其余 ${leaderList.length - LEADER_LIST_PREVIEW_COUNT} 只（共 ${leaderList.length} 只）`}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
