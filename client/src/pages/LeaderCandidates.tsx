import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CandidateInsightCharts, type CandidateChartFilters } from "@/components/CandidateInsightCharts";
import { CandidatePhaseFunnel } from "@/components/CandidatePhaseFunnel";
import { CandidatePremiumChart } from "@/components/CandidatePremiumChart";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Activity, AlertTriangle, ArrowLeft, Crown, Loader2, RefreshCw, ShieldAlert, Sparkles, TrendingUp } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";

function formatDate(date: string | null) {
  if (!date) return "-";
  return date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日");
}

function getTPlus2PriceStatus(row: { secondDayDate: string | null; secondDayOpenPrice: number | null; secondDayClosePrice: number | null }) {
  if (row.secondDayDate === null) return "未到T+2观察日";
  if (row.secondDayOpenPrice === null && row.secondDayClosePrice === null) return "无可用日线行情";
  if (row.secondDayOpenPrice === null) return "开盘价缺失";
  if (row.secondDayClosePrice === null) return "收盘价缺失";
  return null;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
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
  const [priceSyncMessage, setPriceSyncMessage] = useState<string | null>(null);
  const [realisticConfig, setRealisticConfig] = useState({
    initialCapital: 100000,
    maxPositions: 5,
    commissionBps: 3,
    stampDutyBps: 5,
    transferFeeBps: 0.1,
    slippageBps: 10,
    blockLimitUpBuys: true,
    blockLimitDownSells: true,
  });
  const [chartFilters, setChartFilters] = useState<CandidateChartFilters>({ stockCode: null, sector: null, boardBucket: null, scoreBand: null });
  const [phaseFilter, setPhaseFilter] = useState<"冰点试错" | "修复上升" | "上升发酵" | "高位分歧" | "高位亢奋" | "高位退潮" | null>(null);
  const candidateListRef = useRef<HTMLDivElement | null>(null);
  const backtestHistoryRef = useRef<HTMLDivElement | null>(null);
  const { data, isLoading, isError, refetch, isFetching } = trpc.sentiment.getLeaderCandidates.useQuery(undefined, {
    staleTime: 60_000,
  });
  const backtestInput = useMemo(() => ({
    observationDays,
    ...(manualMinScore === undefined ? {} : { minScore: manualMinScore }),
    realistic: {
      initialCapital: realisticConfig.initialCapital,
      maxPositions: realisticConfig.maxPositions,
      commissionRate: realisticConfig.commissionBps / 10000,
      stampDutyRate: realisticConfig.stampDutyBps / 10000,
      transferFeeRate: realisticConfig.transferFeeBps / 10000,
      slippageBps: realisticConfig.slippageBps,
      blockLimitUpBuys: realisticConfig.blockLimitUpBuys,
      blockLimitDownSells: realisticConfig.blockLimitDownSells,
    },
  }), [manualMinScore, observationDays, realisticConfig]);
  const { data: backtest, isLoading: backtestLoading, refetch: refetchBacktest } = trpc.sentiment.getLeaderCandidateBacktest.useQuery(backtestInput, {
    staleTime: 5 * 60_000,
  });
  const priceSyncMutation = trpc.sentiment.syncCandidateDailyPrices.useMutation({
    onSuccess: (result) => {
      setPriceSyncMessage(`已同步 ${result.savedPriceRows} 条日线价格，缺失 ${result.missingPricePairs} 个股票—日期组合。`);
      void refetchBacktest();
    },
    onError: (error) => {
      setPriceSyncMessage(`行情同步失败：${error.message}`);
    },
  });

  const candidates = data?.candidates ?? [];
  const strongSectors = data?.strongSectors ?? [];
  const threshold = backtest?.appliedMinScore ?? null;
  const candidatesAtThreshold = threshold === null ? candidates : candidates.filter((candidate) => candidate.score >= threshold);
  const displayedCandidates = candidatesAtThreshold.filter((candidate) => {
    if (chartFilters.stockCode && candidate.stockCode !== chartFilters.stockCode) return false;
    if (chartFilters.sector && candidate.sector !== chartFilters.sector) return false;
    if (chartFilters.boardBucket) {
      const boardBucket = Math.min(Math.max(candidate.boards, 1), 6);
      if (boardBucket !== chartFilters.boardBucket) return false;
    }
    if (chartFilters.scoreBand) {
      if (candidate.score < chartFilters.scoreBand.minScore) return false;
      if (chartFilters.scoreBand.maxScore !== null && candidate.score > chartFilters.scoreBand.maxScore) return false;
    }
    return true;
  });
  const isThresholdFilterApplied = threshold !== null;
  const historicalRows = backtest?.historicalRows ?? [];
  const filteredHistoricalRows = phaseFilter
    ? historicalRows.filter((row) => row.phase === phaseFilter)
    : historicalRows;
  const focusCandidateList = () => candidateListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const applyPhaseFilter = (phase: typeof phaseFilter) => {
    setPhaseFilter(phase);
    requestAnimationFrame(() => backtestHistoryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

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

  const syncHistoricalPrices = () => {
    setPriceSyncMessage(null);
    priceSyncMutation.mutate({ mode: "full" });
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
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={syncHistoricalPrices} disabled={priceSyncMutation.isPending}>
              {priceSyncMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
              回填历史行情
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={refreshAll} disabled={isFetching || backtestLoading}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            刷新数据
            </Button>
          </div>
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

            <CandidateInsightCharts
              candidates={candidatesAtThreshold}
              scoreBands={backtest?.outOfSampleScoreBands ?? []}
              observationDays={observationDays}
              filters={chartFilters}
              onFiltersChange={setChartFilters}
              onFocusCandidates={focusCandidateList}
            />

            <CandidatePremiumChart scoreBands={backtest?.outOfSampleScoreBands ?? []} />

            {backtest && backtest.totalSamples > 0 && (
              <CandidatePhaseFunnel
                stages={backtest.phaseFunnel}
                observationDays={observationDays}
                activePhase={phaseFilter}
                onPhaseChange={applyPhaseFilter}
              />
            )}

            <Card className="border-sky-100 bg-white/85 shadow-sm">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-sky-600" />历史候选池回测</CardTitle><CardDescription>覆盖数据库内全部满足观察窗口的交易日及当日所有符合规则的主板候选；严格在T日收盘后生成候选。除T+N涨停延续外，同步评价信号日收盘到 T+1、T+2 开盘与收盘的实际溢价，以及 T+1 收盘买入至 T+2 收盘出清收益。</CardDescription></CardHeader>
              <CardContent>
                {priceSyncMessage && <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${priceSyncMessage.startsWith("行情同步失败") ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{priceSyncMessage}</div>}
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
                    <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-slate-800">T+1/T+2 溢价与出清回测</p><p className="mt-1 text-xs text-slate-500">T+1、T+2 开盘/收盘溢价均以信号日收盘为基准；出清指标按 T+1 收盘买入、T+2 收盘卖出，正收益即视为出清成功。</p></div><Badge variant="outline" className="border-amber-200 bg-white text-amber-700">T+1 开/收 {backtest.outOfSamplePremium.openSampleSize}/{backtest.outOfSamplePremium.closeSampleSize} · T+2 开/收 {backtest.outOfSampleTPlus2Premium.openSampleSize}/{backtest.outOfSampleTPlus2Premium.closeSampleSize}</Badge></div>
                      {backtest.outOfSamplePremium.sampleSize === 0 && backtest.outOfSampleTPlus2Premium.sampleSize === 0 ? <p className="mt-3 text-sm text-amber-700">尚无可比价格数据。请点击“回填历史行情”拉取 Tushare 日线后刷新回测。</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div className="rounded-lg border border-amber-100 bg-white p-3"><p className="text-xs font-semibold text-slate-500">样本外 T+1 开/收溢价</p><p className="mt-1 text-xl font-bold text-amber-700">{backtest.outOfSamplePremium.averageOpenPremium ?? "-"}% / {backtest.outOfSamplePremium.averageClosePremium ?? "-"}%</p><p className="mt-1 text-xs text-slate-500">正溢价率 {backtest.outOfSamplePremium.openPremiumPositiveRate ?? "-"}% / {backtest.outOfSamplePremium.closePremiumPositiveRate ?? "-"}%</p></div><div className="rounded-lg border border-violet-100 bg-white p-3"><p className="text-xs font-semibold text-slate-500">样本外 T+2 开/收溢价</p><p className="mt-1 text-xl font-bold text-violet-700">{backtest.outOfSampleTPlus2Premium.averageOpenPremium ?? "-"}% / {backtest.outOfSampleTPlus2Premium.averageClosePremium ?? "-"}%</p><p className="mt-1 text-xs text-slate-500">正溢价率 {backtest.outOfSampleTPlus2Premium.openPremiumPositiveRate ?? "-"}% / {backtest.outOfSampleTPlus2Premium.closePremiumPositiveRate ?? "-"}%</p></div><div className="rounded-lg border border-emerald-100 bg-white p-3"><p className="text-xs font-semibold text-slate-500">T+1 买入 → T+2 出清</p><p className="mt-1 text-xl font-bold text-emerald-700">{backtest.outOfSampleTPlus1CloseToTPlus2Close.successRate ?? "-"}%</p><p className="mt-1 text-xs text-slate-500">成功 {backtest.outOfSampleTPlus1CloseToTPlus2Close.successCount}/{backtest.outOfSampleTPlus1CloseToTPlus2Close.sampleSize} · 平均收益 {backtest.outOfSampleTPlus1CloseToTPlus2Close.averageReturn ?? "-"}%</p></div></div>}
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">真实交易模拟（第一版）</p><p className="mt-1 text-xs leading-5 text-slate-500">按 T+1 开盘买入、T+2 收盘卖出；佣金、印花税、过户费和滑点均可调整。当前日线没有成交量/封单数据，因此涨跌停可成交性采用保守近似。</p></div><div className="text-right text-xs text-slate-500">成交 {backtest.realisticSimulation.filledCount} 笔 · 跳过 {backtest.realisticSimulation.skippedCount} 笔</div></div><div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-7"><label className="text-xs text-slate-600">初始资金<input type="number" min="1000" step="1000" value={realisticConfig.initialCapital} onChange={(event) => setRealisticConfig((current) => ({ ...current, initialCapital: Number(event.target.value) || 0 }))} className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">最大持仓数<input type="number" min="1" max="100" value={realisticConfig.maxPositions} onChange={(event) => setRealisticConfig((current) => ({ ...current, maxPositions: Number(event.target.value) || 1 }))} className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">佣金(bps)<input type="number" min="0" step="0.1" value={realisticConfig.commissionBps} onChange={(event) => setRealisticConfig((current) => ({ ...current, commissionBps: Number(event.target.value) || 0 }))} className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">印花税(bps)<input type="number" min="0" step="0.1" value={realisticConfig.stampDutyBps} onChange={(event) => setRealisticConfig((current) => ({ ...current, stampDutyBps: Number(event.target.value) || 0 }))} className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">过户费(bps)<input type="number" min="0" step="0.1" value={realisticConfig.transferFeeBps} onChange={(event) => setRealisticConfig((current) => ({ ...current, transferFeeBps: Number(event.target.value) || 0 }))} className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">滑点(bps)<input type="number" min="0" step="1" value={realisticConfig.slippageBps} onChange={(event) => setRealisticConfig((current) => ({ ...current, slippageBps: Number(event.target.value) || 0 }))} className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2" /></label><div className="flex flex-col justify-end gap-1 text-xs text-slate-600"><label className="flex items-center gap-1"><input type="checkbox" checked={realisticConfig.blockLimitUpBuys} onChange={(event) => setRealisticConfig((current) => ({ ...current, blockLimitUpBuys: event.target.checked }))} />限制涨停追买</label><label className="flex items-center gap-1"><input type="checkbox" checked={realisticConfig.blockLimitDownSells} onChange={(event) => setRealisticConfig((current) => ({ ...current, blockLimitDownSells: event.target.checked }))} />限制跌停卖出</label></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">期末资金</p><p className="mt-1 text-lg font-bold text-slate-800">¥{formatMoney(backtest.realisticSimulation.finalCapital)}</p></div><div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">净收益 / 收益率</p><p className={`mt-1 text-lg font-bold ${backtest.realisticSimulation.netProfit >= 0 ? "text-emerald-700" : "text-rose-600"}`}>¥{formatMoney(backtest.realisticSimulation.netProfit)} / {backtest.realisticSimulation.totalReturn}%</p></div><div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">胜率 / 盈亏比</p><p className="mt-1 text-lg font-bold text-sky-700">{backtest.realisticSimulation.winRate ?? "-"}% / {backtest.realisticSimulation.profitFactor ?? "-"}</p></div><div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">最大回撤</p><p className="mt-1 text-lg font-bold text-rose-600">{backtest.realisticSimulation.maxDrawdown}%</p></div><div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">不可成交/缺数据</p><p className="mt-1 text-lg font-bold text-amber-700">{backtest.realisticSimulation.blockedBuyCount + backtest.realisticSimulation.blockedSellCount} / {backtest.realisticSimulation.missingDataCount}</p></div></div><div className="mt-4 overflow-auto rounded-lg border border-slate-200 bg-white"><table className="w-full min-w-[760px] text-xs"><thead className="bg-slate-100 text-left text-slate-500"><tr><th className="px-3 py-2">信号日</th><th className="px-3 py-2">股票</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">股数</th><th className="px-3 py-2">买入价</th><th className="px-3 py-2">卖出价</th><th className="px-3 py-2">净收益</th><th className="px-3 py-2">原因</th></tr></thead><tbody>{backtest.realisticSimulation.trades.slice(0, 20).map((trade, index) => <tr key={`${trade.signalDate}-${trade.stockCode}-${index}`} className="border-t border-slate-100"><td className="px-3 py-2">{formatDate(trade.signalDate)}</td><td className="px-3 py-2">{trade.stockName}<span className="ml-1 font-mono text-slate-400">{trade.stockCode}</span></td><td className="px-3 py-2">{trade.status === "filled" ? "已成交" : "未成交"}</td><td className="px-3 py-2">{trade.shares || "-"}</td><td className="px-3 py-2">{trade.entryPrice ?? "-"}</td><td className="px-3 py-2">{trade.exitPrice ?? "-"}</td><td className={trade.netPnl !== null && trade.netPnl >= 0 ? "px-3 py-2 text-emerald-700" : "px-3 py-2 text-rose-600"}>{trade.netPnl ?? "-"}</td><td className="px-3 py-2 text-slate-500">{trade.reason ?? "-"}</td></tr>)}</tbody></table></div><p className="mt-2 text-xs leading-5 text-slate-500">默认参数：初始资金10万元、最多5只持仓、佣金3bps、印花税5bps、过户费0.1bps、买卖滑点10bps、按评分从高到低分配同日资金。表格展示前20笔模拟成交/跳过记录，组合统计使用全部历史样本。</p></div>
                    <p className="text-xs leading-5 text-slate-500">阈值由较早70%交易日校准（{formatDate(backtest.calibrationPeriod.startDate)}至{formatDate(backtest.calibrationPeriod.endDate)}），再在较晚30%交易日做样本外验证；若阈值样本不足20个，则不启用校准筛选。</p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{backtest.outOfSampleScoreBands.map((band) => <div key={band.label} className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs font-medium text-slate-600">{band.label}</p><p className="mt-1 text-lg font-bold text-slate-800">{band.successRate ?? "-"}{band.successRate === null ? "" : "%"}</p><p className="text-xs text-slate-500">{band.successCount}/{band.sampleSize} 延续 · T+1开盘 {band.premium.averageOpenPremium ?? "-"}% · T+2开/收 {band.tPlus2Premium.averageOpenPremium ?? "-"}% / {band.tPlus2Premium.averageClosePremium ?? "-"}%</p></div>)}</div>
                    <div ref={backtestHistoryRef}><div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span>全样本历史明细：显示 {filteredHistoricalRows.length}/{historicalRows.length} 条（按候选日期倒序）</span>{phaseFilter && <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">阶段筛选：{phaseFilter}<button type="button" className="ml-1 font-bold" onClick={() => applyPhaseFilter(null)}>×</button></Badge>}</div><div className="max-h-[620px] overflow-auto rounded-lg border border-slate-200"><table className="w-full min-w-[1160px] text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2 font-medium">候选日期</th><th className="px-3 py-2 font-medium">阶段</th><th className="px-3 py-2 font-medium">股票</th><th className="px-3 py-2 font-medium">题材</th><th className="px-3 py-2 font-medium">评分</th><th className="px-3 py-2 font-medium">流通市值/评分</th><th className="px-3 py-2 font-medium">连板</th><th className="px-3 py-2 font-medium">T+1 开/收溢价</th><th className="px-3 py-2 font-medium">T+2 开/收溢价</th><th className="px-3 py-2 font-medium">T+1买入→T+2出清</th><th className="px-3 py-2 font-medium">T+{backtest.observationDays}结果</th></tr></thead><tbody>{filteredHistoricalRows.map((row) => <tr key={`${row.date}-${row.stockCode}`} className="border-t border-slate-100"><td className="px-3 py-2 text-slate-600">{formatDate(row.date)}</td><td className="px-3 py-2"><Badge variant="outline" className="border-indigo-100 bg-indigo-50 text-indigo-700">{row.phase ?? "阶段缺失"}</Badge></td><td className="px-3 py-2"><p className="font-medium text-slate-800">{row.stockName}</p><p className="font-mono text-xs text-slate-500">{row.stockCode}</p></td><td className="px-3 py-2 text-slate-600">{row.sector}</td><td className="px-3 py-2 font-medium text-slate-700">{row.score}</td><td className="px-3 py-2 text-slate-600">{row.circulationValue ? `${row.circulationValue}亿 / ${row.marketCapScore}分` : "- / 0分"}</td><td className="px-3 py-2 text-orange-600">{row.boards}板</td><td className="px-3 py-2"><p className={row.nextOpenPremium !== null && row.nextOpenPremium > 0 ? "font-medium text-emerald-700" : "text-slate-600"}>开 {row.nextOpenPremium === null ? "-" : `${row.nextOpenPremium}%`}</p><p className={row.nextClosePremium !== null && row.nextClosePremium > 0 ? "font-medium text-emerald-700" : "text-slate-600"}>收 {row.nextClosePremium === null ? "-" : `${row.nextClosePremium}%`}</p></td><td className="px-3 py-2"><p className={row.secondDayOpenPremium !== null && row.secondDayOpenPremium > 0 ? "font-medium text-violet-700" : "text-slate-600"}>开 {row.secondDayOpenPremium === null ? "-" : `${row.secondDayOpenPremium}%`}</p><p className={row.secondDayClosePremium !== null && row.secondDayClosePremium > 0 ? "font-medium text-violet-700" : "text-slate-600"}>收 {row.secondDayClosePremium === null ? "-" : `${row.secondDayClosePremium}%`}</p>{getTPlus2PriceStatus(row) && <p className="mt-0.5 text-[10px] text-slate-400">{getTPlus2PriceStatus(row)}</p>}</td><td className="px-3 py-2">{row.tPlus1CloseToTPlus2CloseReturn === null ? <span className="text-slate-500">-</span> : <><p className={row.tPlus1CloseToTPlus2CloseSuccess ? "font-medium text-emerald-700" : "text-rose-600"}>{row.tPlus1CloseToTPlus2CloseReturn}%</p><p className="text-xs text-slate-500">{row.tPlus1CloseToTPlus2CloseSuccess ? "成功" : "未成功"}</p></>}</td><td className="px-3 py-2"><Badge variant="outline" className={row.success ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}>{row.success ? `T+${backtest.observationDays} ${formatDate(row.nextDate)} 延续` : `T+${backtest.observationDays} ${formatDate(row.nextDate)} 未延续`}</Badge></td></tr>)}</tbody></table></div></div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-amber-100 bg-white/80 shadow-sm">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-amber-600" />当前强势题材</CardTitle><CardDescription>按最新交易日主板涨停家数统计，用于判断候选股是否具备题材支撑。</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap gap-2">{strongSectors.map((item) => <Badge key={item.sector} variant="outline" className="border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">{item.sector} <span className="ml-1 font-bold">{item.count}</span> 只</Badge>)}</CardContent>
            </Card>

            <Card ref={candidateListRef} className="border-slate-200 bg-white/90 shadow-xl shadow-slate-200/50">
              <CardHeader><CardTitle>候选列表</CardTitle><CardDescription>评分由“连板高度、题材广度、封板时间、成交额、流通市值”构成；风险标签用于提示需要进一步核验的条件。</CardDescription></CardHeader>
              <CardContent>
                {displayedCandidates.length === 0 ? <div className="py-14 text-center text-sm text-slate-500">当前没有同时满足候选规则与图表筛选条件的主板股票；可清除图表筛选后重试。</div> : (
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
