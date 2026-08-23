import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Activity, AlertTriangle, ArrowLeft, Crown, Loader2, RefreshCw, ShieldAlert, Sparkles, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
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
  const [observationDays, setObservationDays] = useState<1 | 2>(1);
  const [scoreDraft, setScoreDraft] = useState("");
  const [manualMinScore, setManualMinScore] = useState<number | undefined>();
  const [scoreInputError, setScoreInputError] = useState<string | null>(null);
  const { data, isLoading, isError, refetch, isFetching } = trpc.sentiment.getLeaderCandidates.useQuery(undefined, {
    staleTime: 60_000,
  });
  const backtestInput = useMemo(() => ({
    observationDays,
    ...(manualMinScore === undefined ? {} : { minScore: manualMinScore }),
  }), [manualMinScore, observationDays]);
  const { data: backtest, isLoading: backtestLoading, refetch: refetchBacktest } = trpc.sentiment.getLeaderCandidateBacktest.useQuery(backtestInput, {
    staleTime: 5 * 60_000,
  });

  const candidates = data?.candidates ?? [];
  const strongSectors = data?.strongSectors ?? [];
  const threshold = backtest?.appliedMinScore ?? null;
  const displayedCandidates = threshold === null ? candidates : candidates.filter((candidate) => candidate.score >= threshold);
  const isThresholdFilterApplied = threshold !== null;

  const refreshAll = () => {
    void refetch();
    void refetchBacktest();
  };

  const applyManualScore = () => {
    if (!scoreDraft.trim()) {
      setManualMinScore(undefined);
      setScoreInputError(null);
      return;
    }
    const nextScore = Number(scoreDraft);
    if (!Number.isInteger(nextScore) || nextScore < 0 || nextScore > 100) {
      setScoreInputError("请输入0至100之间的整数评分");
      return;
    }
    setManualMinScore(nextScore);
    setScoreInputError(null);
  };

  const restoreCalibratedScore = () => {
    setManualMinScore(undefined);
    setScoreDraft("");
    setScoreInputError(null);
  };

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
          <Button variant="outline" size="sm" className="ml-auto gap-2" onClick={refreshAll} disabled={isFetching || backtestLoading}>
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
              <Card className="border-red-100 bg-white/85 shadow-sm"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-600">重点观察候选</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-red-600">{displayedCandidates.length}<span className="ml-1 text-base">只</span></div><p className="mt-1 text-xs text-slate-500">{isThresholdFilterApplied ? `当前最低评分阈值 ${threshold} 分` : "满足高度、题材或综合评分条件"}</p></CardContent></Card>
            </div>

            <Card className="border-sky-100 bg-white/85 shadow-sm">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-sky-600" />历史候选池回测</CardTitle><CardDescription>严格在T日收盘后生成候选；可配置第1个或第2个后续已记录交易日是否仍涨停为成功口径。</CardDescription></CardHeader>
              <CardContent>
                <div className="mb-5 rounded-xl border border-sky-100 bg-sky-50/60 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">回测配置</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">切换观察窗口或应用手动评分阈值后，当前候选、回测样本和样本外结果会同步重算。</p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div><p className="mb-1.5 text-xs font-medium text-slate-600">成功观察窗口</p><div className="flex rounded-lg border border-sky-200 bg-white p-1"><Button size="sm" variant={observationDays === 1 ? "default" : "ghost"} className={observationDays === 1 ? "bg-sky-600 hover:bg-sky-700" : ""} onClick={() => setObservationDays(1)}>T+1 延续</Button><Button size="sm" variant={observationDays === 2 ? "default" : "ghost"} className={observationDays === 2 ? "bg-sky-600 hover:bg-sky-700" : ""} onClick={() => setObservationDays(2)}>T+2 延续</Button></div></div>
                      <div className="min-w-[230px]"><p className="mb-1.5 text-xs font-medium text-slate-600">手动最低评分阈值</p><div className="flex gap-2"><Input type="number" min="0" max="100" inputMode="numeric" value={scoreDraft} onChange={(event) => setScoreDraft(event.target.value)} placeholder={backtest?.recommendedMinScore ? `历史校准 ${backtest.recommendedMinScore} 分` : "留空使用历史校准"} className="h-9 bg-white" /><Button size="sm" variant="outline" onClick={applyManualScore}>应用</Button></div>{scoreInputError && <p className="mt-1 text-xs text-rose-600">{scoreInputError}</p>}</div>
                      <Button size="sm" variant="ghost" className="text-sky-700 hover:bg-sky-100" onClick={restoreCalibratedScore} disabled={manualMinScore === undefined}>恢复历史校准</Button>
                    </div>
                  </div>
                </div>
                {backtestLoading ? <div className="flex items-center gap-2 py-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />正在计算历史样本…</div> : !backtest || backtest.totalSamples === 0 ? <p className="py-3 text-sm text-slate-500">历史候选样本不足，暂无法计算回测结果。</p> : (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="rounded-lg border border-sky-100 bg-sky-50/70 p-3"><p className="text-xs text-slate-500">T+{backtest.observationDays}延续成功率</p><p className="mt-1 text-2xl font-bold text-sky-700">{backtest.successRate ?? "-"}<span className="ml-1 text-sm">{backtest.successRate === null ? "" : "%"}</span></p><p className="mt-1 text-xs text-slate-500">{backtest.successCount}/{backtest.totalSamples} 个候选样本</p></div>
                      <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 p-3"><p className="text-xs text-slate-500">历史校准阈值</p><p className="mt-1 text-2xl font-bold text-indigo-700">{backtest.recommendedMinScore ?? "-"}<span className="ml-1 text-sm">{backtest.recommendedMinScore === null ? "" : "分"}</span></p><p className="mt-1 text-xs text-slate-500">需至少20个历史样本才会启用</p></div>
                      <div className="rounded-lg border border-violet-100 bg-violet-50/70 p-3"><p className="text-xs text-slate-500">校准样本数</p><p className="mt-1 text-2xl font-bold text-violet-700">{backtest.calibrationSampleSize}</p><p className="mt-1 text-xs text-slate-500">评分阈值对应的历史样本</p></div>
                      <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-3"><p className="text-xs text-slate-500">样本外T+{backtest.observationDays}成功率</p><p className="mt-1 text-2xl font-bold text-emerald-700">{backtest.outOfSample.successRate ?? "-"}<span className="ml-1 text-sm">{backtest.outOfSample.successRate === null ? "" : "%"}</span></p><p className="mt-1 text-xs text-slate-500">{backtest.outOfSample.successCount}/{backtest.outOfSample.sampleSize} 个较晚期样本</p></div>
                    </div>
                    <p className="text-xs leading-5 text-slate-500">阈值由较早70%交易日校准（{formatDate(backtest.calibrationPeriod.startDate)}至{formatDate(backtest.calibrationPeriod.endDate)}），再在较晚30%交易日做样本外验证；若阈值样本不足20个，则不启用校准筛选。</p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{backtest.scoreBands.map((band) => <div key={band.label} className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs font-medium text-slate-600">{band.label}</p><p className="mt-1 text-lg font-bold text-slate-800">{band.successRate ?? "-"}{band.successRate === null ? "" : "%"}</p><p className="text-xs text-slate-500">{band.successCount}/{band.sampleSize} 成功</p></div>)}</div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[780px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2 font-medium">候选日期</th><th className="px-3 py-2 font-medium">股票</th><th className="px-3 py-2 font-medium">题材</th><th className="px-3 py-2 font-medium">评分</th><th className="px-3 py-2 font-medium">流通市值/评分</th><th className="px-3 py-2 font-medium">连板</th><th className="px-3 py-2 font-medium">T+{backtest.observationDays}结果</th></tr></thead><tbody>{backtest.latestRows.slice(0, 12).map((row) => <tr key={`${row.date}-${row.stockCode}`} className="border-t border-slate-100"><td className="px-3 py-2 text-slate-600">{formatDate(row.date)}</td><td className="px-3 py-2"><p className="font-medium text-slate-800">{row.stockName}</p><p className="font-mono text-xs text-slate-500">{row.stockCode}</p></td><td className="px-3 py-2 text-slate-600">{row.sector}</td><td className="px-3 py-2 font-medium text-slate-700">{row.score}</td><td className="px-3 py-2 text-slate-600">{row.circulationValue ? `${row.circulationValue}亿 / ${row.marketCapScore}分` : "- / 0分"}</td><td className="px-3 py-2 text-orange-600">{row.boards}板</td><td className="px-3 py-2"><Badge variant="outline" className={row.success ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}>{row.success ? `T+${backtest.observationDays} ${formatDate(row.nextDate)} 延续` : `T+${backtest.observationDays} ${formatDate(row.nextDate)} 未延续`}</Badge></td></tr>)}</tbody></table></div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-amber-100 bg-white/80 shadow-sm">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-amber-600" />当前强势题材</CardTitle><CardDescription>按最新交易日主板涨停家数统计，用于判断候选股是否具备题材支撑。</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap gap-2">{strongSectors.map((item) => <Badge key={item.sector} variant="outline" className="border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">{item.sector} <span className="ml-1 font-bold">{item.count}</span> 只</Badge>)}</CardContent>
            </Card>

            <Card className="border-slate-200 bg-white/90 shadow-xl shadow-slate-200/50">
              <CardHeader><CardTitle>候选列表</CardTitle><CardDescription>评分由“连板高度、题材广度、封板时间、成交额、流通市值”构成；风险标签用于提示需要进一步核验的条件。</CardDescription></CardHeader>
              <CardContent>
                {displayedCandidates.length === 0 ? <div className="py-14 text-center text-sm text-slate-500">当前没有满足候选规则的主板股票；可在首页查看全部涨停与题材分布。</div> : (
                  <div className="space-y-3">
                    {displayedCandidates.map((candidate) => (
                      <article key={candidate.stockCode} className="rounded-xl border border-slate-200 bg-gradient-to-r from-white to-amber-50/30 p-4 transition-shadow hover:shadow-md">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                          <div className="flex min-w-0 items-center gap-3 lg:w-[255px]">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-sm font-bold text-white shadow-sm">{candidate.rank}</span>
                            <div className="min-w-0"><h3 className="truncate font-bold text-slate-900">{candidate.stockName}</h3><p className="mt-0.5 font-mono text-xs text-slate-500">{candidate.stockCode}</p></div>
                          </div>
                          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-5">
                            <div><p className="text-xs text-slate-500">综合评分</p><Badge variant="outline" className={`mt-1 ${scoreTone(candidate.score)}`}>{candidate.score} 分</Badge></div>
                            <div><p className="text-xs text-slate-500">连板高度</p><p className="mt-1 font-semibold text-orange-600">{candidate.boards} 板</p></div>
                            <div><p className="text-xs text-slate-500">题材广度</p><p className="mt-1 text-sm font-medium text-slate-700">{candidate.sector} · {candidate.sectorCount}只</p></div>
                            <div><p className="text-xs text-slate-500">封板 / 成交额</p><p className="mt-1 text-sm font-medium text-slate-700">{candidate.limitUpTime?.slice(0, 5) ?? "-"} / {candidate.turnover ? `${candidate.turnover}亿` : "-"}</p></div>
                            <div><p className="text-xs text-slate-500">流通市值 / 评分</p><p className="mt-1 text-sm font-medium text-slate-700">{candidate.circulationValue ? `${candidate.circulationValue}亿` : "-"} / <span className="text-amber-700">{candidate.marketCapScore}分</span></p><p className="mt-0.5 text-[11px] text-slate-500">{candidate.marketCapLabel}</p></div>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                          <span className="text-xs font-medium text-slate-500">入选原因</span>
                          {candidate.reasons.map((reason) => <Badge key={reason} variant="secondary" className="bg-emerald-50 text-emerald-700">{reason}</Badge>)}
                          {candidate.riskTags.length > 0 && <><span className="ml-1 flex items-center gap-1 text-xs font-medium text-slate-500"><ShieldAlert className="h-3.5 w-3.5" />风险提示</span>{candidate.riskTags.map((tag) => <Badge key={tag} variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">{tag}</Badge>)}</>}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <span className="mr-1 text-xs font-medium text-slate-500">近期连板轨迹</span>
                          {candidate.trajectory.map((point) => <span key={point.date} className={`rounded-md border px-1.5 py-1 text-[11px] ${point.boards > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-400"}`}><span className="mr-1 text-slate-400">{point.date.slice(5)}</span>{point.boards > 0 ? `${point.boards}板` : "-"}</span>)}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <p className="text-center text-xs text-slate-500">研究口径：默认仅统计主板股票，排除创业板、科创板和北交所；回测检验可选T+1或T+2涨停延续，不代表收益、价格表现或预测，候选评分是复盘辅助。</p>
          </div>
        )}
      </main>
    </div>
  );
}
