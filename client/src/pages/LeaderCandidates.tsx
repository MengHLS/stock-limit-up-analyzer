import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Activity, AlertTriangle, ArrowLeft, Crown, Loader2, RefreshCw, ShieldAlert, Sparkles, TrendingUp } from "lucide-react";
import { Link } from "wouter";

function formatDate(date: string | null) {
  if (!date) return "-";
  return date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日");
}

function scoreTone(score: number) {
  if (score >= 70) return "border-red-200 bg-red-50 text-red-700";
  if (score >= 52) return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function LeaderCandidatesPage() {
  const { data, isLoading, isError, refetch, isFetching } = trpc.sentiment.getLeaderCandidates.useQuery(undefined, {
    staleTime: 60_000,
  });

  const candidates = data?.candidates ?? [];
  const strongSectors = data?.strongSectors ?? [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50/60 to-slate-50">
      <header className="sticky top-0 z-50 border-b bg-white/85 backdrop-blur-xl">
        <div className="container flex h-16 items-center">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </Button>
          </Link>
          <div className="ml-4 flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-600" />
            <h1 className="text-lg font-semibold text-slate-800">龙头候选池</h1>
          </div>
          <Button variant="outline" size="sm" className="ml-auto gap-2" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            刷新数据
          </Button>
        </div>
      </header>

      <main className="container max-w-7xl py-8">
        <section className="mb-6 max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-amber-600">Leader Watchlist</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">主线中的重点观察候选</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            候选评分仅用于收盘后复盘排序，综合当前主板连板高度、题材广度、封板时间与成交额；每一项入选原因和风险标签都可见，不构成买卖建议。
          </p>
        </section>

        {isLoading ? (
          <Card><CardContent className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></CardContent></Card>
        ) : isError ? (
          <Card><CardContent className="flex flex-col items-center justify-center py-20 text-center"><AlertTriangle className="mb-4 h-12 w-12 text-red-300" /><p className="font-medium text-slate-800">龙头候选数据加载失败</p><Button className="mt-5" variant="outline" onClick={() => refetch()}>重新加载</Button></CardContent></Card>
        ) : !data?.date ? (
          <Card><CardContent className="flex flex-col items-center justify-center py-24 text-center"><Activity className="mb-4 h-12 w-12 text-amber-300" /><p className="font-medium text-slate-800">暂无可分析的涨停数据</p><p className="mt-2 text-sm text-slate-500">录入最新交易日涨停记录后，将自动生成候选池。</p></CardContent></Card>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border-amber-100 bg-white/85 shadow-sm"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-600">候选交易日</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-amber-600">{formatDate(data.date)}</div><p className="mt-1 text-xs text-slate-500">按数据库最新涨停日期生成</p></CardContent></Card>
              <Card className="border-orange-100 bg-white/85 shadow-sm"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-600">主板最高连板</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-orange-600">{data.maxBoards}<span className="ml-1 text-base">板</span></div><p className="mt-1 text-xs text-slate-500">主板涨停 {data.totalMainBoardLimitUps} 只</p></CardContent></Card>
              <Card className="border-red-100 bg-white/85 shadow-sm"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-600">重点观察候选</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-red-600">{candidates.length}<span className="ml-1 text-base">只</span></div><p className="mt-1 text-xs text-slate-500">满足高度、题材或综合评分条件</p></CardContent></Card>
            </div>

            <Card className="border-amber-100 bg-white/80 shadow-sm">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-amber-600" />当前强势题材</CardTitle><CardDescription>按最新交易日主板涨停家数统计，用于判断候选股是否具备题材支撑。</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap gap-2">{strongSectors.map((item) => <Badge key={item.sector} variant="outline" className="border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">{item.sector} <span className="ml-1 font-bold">{item.count}</span> 只</Badge>)}</CardContent>
            </Card>

            <Card className="border-slate-200 bg-white/90 shadow-xl shadow-slate-200/50">
              <CardHeader><CardTitle>候选列表</CardTitle><CardDescription>评分由“连板高度、题材广度、封板时间、成交额”构成；风险标签用于提示需要进一步核验的条件。</CardDescription></CardHeader>
              <CardContent>
                {candidates.length === 0 ? <div className="py-14 text-center text-sm text-slate-500">当前没有满足候选规则的主板股票；可在首页查看全部涨停与题材分布。</div> : (
                  <div className="space-y-3">
                    {candidates.map((candidate) => (
                      <article key={candidate.stockCode} className="rounded-xl border border-slate-200 bg-gradient-to-r from-white to-amber-50/30 p-4 transition-shadow hover:shadow-md">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                          <div className="flex min-w-0 items-center gap-3 lg:w-[255px]">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-sm font-bold text-white shadow-sm">{candidate.rank}</span>
                            <div className="min-w-0"><h3 className="truncate font-bold text-slate-900">{candidate.stockName}</h3><p className="mt-0.5 font-mono text-xs text-slate-500">{candidate.stockCode}</p></div>
                          </div>
                          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                            <div><p className="text-xs text-slate-500">综合评分</p><Badge variant="outline" className={`mt-1 ${scoreTone(candidate.score)}`}>{candidate.score} 分</Badge></div>
                            <div><p className="text-xs text-slate-500">连板高度</p><p className="mt-1 font-semibold text-orange-600">{candidate.boards} 板</p></div>
                            <div><p className="text-xs text-slate-500">题材广度</p><p className="mt-1 text-sm font-medium text-slate-700">{candidate.sector} · {candidate.sectorCount}只</p></div>
                            <div><p className="text-xs text-slate-500">封板 / 成交额</p><p className="mt-1 text-sm font-medium text-slate-700">{candidate.limitUpTime?.slice(0, 5) ?? "-"} / {candidate.turnover ? `${candidate.turnover}亿` : "-"}</p></div>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                          <span className="text-xs font-medium text-slate-500">入选原因</span>
                          {candidate.reasons.map((reason) => <Badge key={reason} variant="secondary" className="bg-emerald-50 text-emerald-700">{reason}</Badge>)}
                          {candidate.riskTags.length > 0 && <><span className="ml-1 flex items-center gap-1 text-xs font-medium text-slate-500"><ShieldAlert className="h-3.5 w-3.5" />风险提示</span>{candidate.riskTags.map((tag) => <Badge key={tag} variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">{tag}</Badge>)}</>}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <p className="text-center text-xs text-slate-500">研究口径：默认仅统计主板股票，排除创业板、科创板和北交所；候选评分是复盘辅助，不代表预测或交易建议。</p>
          </div>
        )}
      </main>
    </div>
  );
}
