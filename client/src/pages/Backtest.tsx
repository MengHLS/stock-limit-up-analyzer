import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, BarChart3, GitCompareArrows, Loader2, RefreshCw, ShieldAlert, ShieldCheck, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "wouter";

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function formatDate(date: string | null) {
  if (!date) return "-";
  return date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日");
}

export default function BacktestPage() {
  const [config, setConfig] = useState({
    initialCapital: 100000,
    maxPositions: 5,
    commissionBps: 3,
    stampDutyBps: 5,
    transferFeeBps: 0.1,
    slippageBps: 10,
    blockLimitUpBuys: false,
    blockLimitDownSells: false,
    enableOneWordLimitDownProbability: false,
    oneWordLimitDownSellProbability: 0,
    positionSizingStrategy: "equal" as "equal" | "scoreWeighted" | "fixedPercent",
    fixedPositionPercent: 20,
    minimumExpectedOpenChangePercent: -2,
    exitStrategy: "t2Close" as "t2Close" | "trailingHold" | "riskManagedHold",
    trailingProfitActivationPercent: 6,
    trailingDrawdownPercent: 3,
    stopLossPercent: 5,
    strongHoldMinReturn: 3,
    maxHoldingDays: 5,
    downsideObservationDays: 5,
    mediumDownsidePercent: 4,
    highDownsidePercent: 8,
    riskPenaltyWeight: 0.35,
    hardRiskThreshold: 65,
  });
  const [orderStatus, setOrderStatus] = useState<"all" | "filled" | "skipped">("all");
  const [reason, setReason] = useState("all");
  const [keyword, setKeyword] = useState("");

  const input = useMemo(() => ({
    observationDays: 1 as const,
    realistic: {
      initialCapital: config.initialCapital,
      maxPositions: config.maxPositions,
      commissionRate: config.commissionBps / 10000,
      stampDutyRate: config.stampDutyBps / 10000,
      transferFeeRate: config.transferFeeBps / 10000,
      slippageBps: config.slippageBps,
      blockLimitUpBuys: config.blockLimitUpBuys,
      blockLimitDownSells: config.blockLimitDownSells,
      enableOneWordLimitDownProbability: config.enableOneWordLimitDownProbability,
      oneWordLimitDownSellProbability: config.oneWordLimitDownSellProbability,
      positionSizingStrategy: config.positionSizingStrategy,
      fixedPositionPercent: config.fixedPositionPercent,
      minimumExpectedOpenChangePercent: config.minimumExpectedOpenChangePercent,
      exitStrategy: config.exitStrategy,
      trailingProfitActivationPercent: config.trailingProfitActivationPercent,
      trailingDrawdownPercent: config.trailingDrawdownPercent,
      stopLossPercent: config.stopLossPercent,
      strongHoldMinReturn: config.strongHoldMinReturn,
      maxHoldingDays: config.maxHoldingDays,
    },
    downsideRisk: {
      observationDays: config.downsideObservationDays,
      mediumDownsidePercent: config.mediumDownsidePercent,
      highDownsidePercent: config.highDownsidePercent,
      penaltyWeight: config.riskPenaltyWeight,
      hardRiskThreshold: config.hardRiskThreshold,
    },
  }), [config]);
  const { data, isLoading, isFetching, refetch } = trpc.sentiment.getLeaderCandidateBacktest.useQuery(input, { staleTime: 5 * 60_000 });
  const simulation = data?.realisticSimulation;
  const exitStrategyComparison = data?.exitStrategyComparison ?? [];
  const downsideRiskResearch = data?.downsideRiskResearch;
  const orders = simulation?.trades ?? [];
  const reasons = useMemo(() => Array.from(new Set(orders.map((order) => order.reason).filter((value): value is string => Boolean(value)))).sort(), [orders]);
  const displayedOrders = useMemo(() => {
    const search = keyword.trim().toLowerCase();
    return orders.filter((order) => {
      if (orderStatus !== "all" && order.status !== orderStatus) return false;
      if (reason !== "all" && order.reason !== reason) return false;
      return !search || `${order.stockCode} ${order.stockName}`.toLowerCase().includes(search);
    });
  }, [keyword, orderStatus, orders, reason]);
  const comparisonCurve = useMemo(() => {
    const dates = Array.from(new Set(exitStrategyComparison.flatMap((item) => item.realisticSimulation.equityCurve.map((point) => point.date)))).sort();
    return dates.map((date) => {
      const point: Record<string, string | number> = { date: date.slice(5) };
      for (const item of exitStrategyComparison) {
        const equity = item.realisticSimulation.equityCurve.find((curvePoint) => curvePoint.date === date)?.equity;
        if (equity !== undefined) point[item.exitStrategy] = Number((((equity / item.realisticSimulation.initialCapital) - 1) * 100).toFixed(2));
      }
      return point;
    });
  }, [exitStrategyComparison]);
  const downsideRiskCurve = useMemo(() => {
    const experiments = downsideRiskResearch?.experiments ?? [];
    const dates = Array.from(new Set(experiments.flatMap((item) => item.realisticSimulation.equityCurve.map((point) => point.date)))).sort();
    return dates.map((date) => {
      const point: Record<string, string | number> = { date: date.slice(5) };
      for (const item of experiments) {
        const equity = item.realisticSimulation.equityCurve.find((curvePoint) => curvePoint.date === date)?.equity;
        if (equity !== undefined) point[item.key] = Number((((equity / item.realisticSimulation.initialCapital) - 1) * 100).toFixed(2));
      }
      return point;
    });
  }, [downsideRiskResearch]);

  const update = <K extends keyof typeof config>(key: K, value: (typeof config)[K]) => setConfig((current) => ({ ...current, [key]: value }));
  const disabledRisk = config.exitStrategy === "t2Close";

  return <main className="min-h-screen bg-slate-50 pb-12 text-slate-900">
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/leader-candidates" className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" />返回龙头候选池</Link>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />刷新回测</Button>
      </div>
    </header>
    <div className="mx-auto max-w-7xl space-y-5 px-4 pt-7 sm:px-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><div className="flex items-center gap-2 text-sky-700"><BarChart3 className="h-5 w-5" /><span className="text-xs font-bold tracking-[0.18em]">PORTFOLIO BACKTEST</span></div><h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">组合资金回测</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">以候选信号为基础，模拟 T+1 开盘买入及实际交易日出清。所有买卖判断均仅使用当日及之前可见的日线价格；结果用于历史研究，不构成投资建议。</p></div>
          <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-right"><p className="text-xs text-sky-700">当前候选口径</p><p className="mt-1 font-semibold text-sky-900">1–4板 · T+1开盘入场</p></div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2"><WalletCards className="h-5 w-5 text-violet-700" /><div><h2 className="font-semibold">回测参数</h2><p className="text-xs text-slate-500">修改参数后自动重新计算；成交金额仍受整手、资金和最大持仓限制。</p></div></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <label className="text-xs text-slate-600">初始资金<input type="number" min="1000" step="1000" value={config.initialCapital} onChange={(event) => update("initialCapital", Number(event.target.value) || 0)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2" /></label>
          <label className="text-xs text-slate-600">最大持仓数<input type="number" min="1" max="100" value={config.maxPositions} onChange={(event) => update("maxPositions", Number(event.target.value) || 1)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2" /></label>
          <label className="text-xs text-slate-600">佣金(bps)<input type="number" min="0" step="0.1" value={config.commissionBps} onChange={(event) => update("commissionBps", Number(event.target.value) || 0)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2" /></label>
          <label className="text-xs text-slate-600">印花税(bps)<input type="number" min="0" step="0.1" value={config.stampDutyBps} onChange={(event) => update("stampDutyBps", Number(event.target.value) || 0)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2" /></label>
          <label className="text-xs text-slate-600">过户费(bps)<input type="number" min="0" step="0.1" value={config.transferFeeBps} onChange={(event) => update("transferFeeBps", Number(event.target.value) || 0)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2" /></label>
          <label className="text-xs text-slate-600">双边滑点(bps)<input type="number" min="0" step="1" value={config.slippageBps} onChange={(event) => update("slippageBps", Number(event.target.value) || 0)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2" /></label>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3"><p className="text-xs font-semibold text-sky-900">T+1开盘预期过滤</p><p className="mt-1 text-xs text-sky-700">相对信号日收盘严格低于阈值时不买入。</p><label className="mt-2 block text-xs text-slate-600">最低开盘涨幅(%)<input type="number" min="-50" max="100" step="0.5" value={config.minimumExpectedOpenChangePercent} onChange={(event) => update("minimumExpectedOpenChangePercent", Math.min(100, Math.max(-50, Number(event.target.value) || 0)))} className="mt-1 h-8 w-28 rounded-md border border-slate-200 bg-white px-2" /></label></div>
          <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3"><p className="text-xs font-semibold text-violet-900">分仓策略</p><p className="mt-1 text-xs text-violet-700">等权、评分加权或固定单笔比例。</p><select value={config.positionSizingStrategy} onChange={(event) => update("positionSizingStrategy", event.target.value === "scoreWeighted" ? "scoreWeighted" : event.target.value === "fixedPercent" ? "fixedPercent" : "equal")} className="mt-2 h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"><option value="equal">等权分仓</option><option value="scoreWeighted">评分加权</option><option value="fixedPercent">固定单笔比例</option></select><label className="ml-2 text-xs text-slate-600">比例<input type="number" min="1" max="100" disabled={config.positionSizingStrategy !== "fixedPercent"} value={config.fixedPositionPercent} onChange={(event) => update("fixedPositionPercent", Math.min(100, Math.max(1, Number(event.target.value) || 1)))} className="ml-1 h-8 w-16 rounded-md border border-slate-200 bg-white px-2 disabled:bg-slate-100" />%</label></div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3"><p className="text-xs font-semibold text-amber-900">成交限制</p><label className="mt-2 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={config.blockLimitUpBuys} onChange={(event) => update("blockLimitUpBuys", event.target.checked)} />限制涨停追买</label><label className="mt-2 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={config.blockLimitDownSells} onChange={(event) => update("blockLimitDownSells", event.target.checked)} />限制一字跌停卖出</label><label className="mt-2 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" disabled={!config.blockLimitDownSells} checked={config.enableOneWordLimitDownProbability} onChange={(event) => update("enableOneWordLimitDownProbability", event.target.checked)} />启用概率成交</label></div>
        </div>
        <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3"><div className="flex flex-wrap items-end gap-3"><div className="mr-auto"><p className="text-xs font-semibold text-amber-900">一字跌停保守成交概率</p><p className="mt-1 text-xs text-amber-700">仅在“限制一字跌停卖出”和“启用概率成交”均开启时生效；未成交仓位会在后续实际交易日继续尝试出清。</p></div><label className="text-xs text-slate-600">卖出成交概率(%)<input type="number" min="0" max="100" step="1" disabled={!config.blockLimitDownSells || !config.enableOneWordLimitDownProbability} value={config.oneWordLimitDownSellProbability} onChange={(event) => update("oneWordLimitDownSellProbability", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-28 rounded-md border border-slate-200 bg-white px-2 disabled:bg-slate-100" /></label></div></div>
        <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50/50 p-3"><div className="flex flex-wrap items-end gap-3"><div className="mr-auto"><p className="text-xs font-semibold text-rose-900">第二日卖出策略</p><p className="mt-1 text-xs text-rose-700">固定T+2收盘，或从T+2起以开盘止损、动态回撤止盈和强势续持管理仓位。动态止盈仅在达到启动浮盈后，收盘自持仓高点回撤至阈值才卖出。</p></div><label className="text-xs text-slate-600">策略<select value={config.exitStrategy} onChange={(event) => update("exitStrategy", event.target.value === "riskManagedHold" ? "riskManagedHold" : event.target.value === "trailingHold" ? "trailingHold" : "t2Close")} className="mt-1 block h-8 rounded-md border border-slate-200 bg-white px-2"><option value="t2Close">固定T+2收盘</option><option value="trailingHold">动态回撤止盈</option><option value="riskManagedHold">动态止盈、止损与强势续持</option></select></label><label className="text-xs text-slate-600">启动浮盈<input type="number" disabled={disabledRisk} value={config.trailingProfitActivationPercent} onChange={(event) => update("trailingProfitActivationPercent", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2 disabled:bg-slate-100" /></label><label className="text-xs text-slate-600">回撤阈值<input type="number" disabled={disabledRisk} value={config.trailingDrawdownPercent} onChange={(event) => update("trailingDrawdownPercent", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2 disabled:bg-slate-100" /></label><label className="text-xs text-slate-600">止损<input type="number" disabled={disabledRisk} value={config.stopLossPercent} onChange={(event) => update("stopLossPercent", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2 disabled:bg-slate-100" /></label><label className="text-xs text-slate-600">续持阈值<input type="number" disabled={disabledRisk || config.exitStrategy === "trailingHold"} value={config.strongHoldMinReturn} onChange={(event) => update("strongHoldMinReturn", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2 disabled:bg-slate-100" /></label><label className="text-xs text-slate-600">最多持有日<input type="number" min="2" max="30" disabled={disabledRisk} value={config.maxHoldingDays} onChange={(event) => update("maxHoldingDays", Math.min(30, Math.max(2, Math.floor(Number(event.target.value) || 2))))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2 disabled:bg-slate-100" /></label></div></div>
        <div className="mt-3 rounded-xl border border-fuchsia-100 bg-fuchsia-50/50 p-3"><div className="flex flex-wrap items-end gap-3"><div className="mr-auto"><p className="text-xs font-semibold text-fuchsia-900">下行风险研究参数</p><p className="mt-1 max-w-3xl text-xs text-fuchsia-800">风险分只读取信号日字段；T+1开盘后的实际交易日收盘路径仅用于事后标签和样本外实验。风险扣分不删除候选，高风险硬过滤才会剔除候选。</p></div><label className="text-xs text-slate-600">观察日<input type="number" min="2" max="10" value={config.downsideObservationDays} onChange={(event) => update("downsideObservationDays", Math.min(10, Math.max(2, Math.floor(Number(event.target.value) || 2))))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">中档下行<input type="number" min="1" max="50" value={config.mediumDownsidePercent} onChange={(event) => update("mediumDownsidePercent", Math.min(50, Math.max(1, Number(event.target.value) || 1)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">高档下行<input type="number" min="1" max="50" value={config.highDownsidePercent} onChange={(event) => update("highDownsidePercent", Math.max(config.mediumDownsidePercent, Math.min(50, Number(event.target.value) || config.mediumDownsidePercent)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">扣分权重<input type="number" min="0" max="1" step="0.05" value={config.riskPenaltyWeight} onChange={(event) => update("riskPenaltyWeight", Math.min(1, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">硬过滤分<input type="number" min="0" max="100" value={config.hardRiskThreshold} onChange={(event) => update("hardRiskThreshold", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label></div></div>
      </section>

      {isLoading || !simulation ? <div className="flex min-h-72 items-center justify-center rounded-2xl border border-slate-200 bg-white"><Loader2 className="h-7 w-7 animate-spin text-sky-600" /></div> : <>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="期末资金" value={`¥${formatMoney(simulation.finalCapital)}`} /><Metric label="净收益 / 收益率" value={`¥${formatMoney(simulation.netProfit)} / ${simulation.totalReturn}%`} tone={simulation.netProfit >= 0 ? "text-rose-600" : "text-emerald-700"} /><Metric label="胜率 / 盈亏比" value={`${simulation.winRate ?? "-"}% / ${simulation.profitFactor ?? "-"}`} /><Metric label="最大回撤" value={`${simulation.maxDrawdown}%`} tone="text-emerald-700" /><Metric label="入场 / 已出清" value={`${simulation.filledCount} / ${simulation.completedCount}`} /></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start gap-3"><GitCompareArrows className="mt-0.5 h-5 w-5 text-violet-700" /><div className="mr-auto"><h2 className="font-semibold">退出策略对比实验台</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">三种策略共享相同候选池、T+1入场、费用、滑点、持仓和成交限制；仅替换退出规则。曲线为组合累计收益率，红涨绿跌仅用于单策略订单明细。</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-3">{exitStrategyComparison.map((item) => <div key={item.exitStrategy} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">{item.label}</p><p className="mt-1 min-h-10 text-xs leading-5 text-slate-500">{item.description}</p></div><span className={item.realisticSimulation.totalReturn >= 0 ? "text-sm font-bold text-rose-600" : "text-sm font-bold text-emerald-700"}>{item.realisticSimulation.totalReturn}%</span></div><div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-200 pt-3 text-xs"><div><p className="text-slate-400">最大回撤</p><p className="mt-1 font-semibold text-emerald-700">{item.realisticSimulation.maxDrawdown}%</p></div><div><p className="text-slate-400">已出清</p><p className="mt-1 font-semibold text-slate-700">{item.realisticSimulation.completedCount}</p></div><div><p className="text-slate-400">胜率</p><p className="mt-1 font-semibold text-slate-700">{item.realisticSimulation.winRate ?? "-"}%</p></div></div></div>)}</div><div className="mt-5 h-[330px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={comparisonCurve} margin={{ top: 12, right: 20, bottom: 8, left: -8 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="date" minTickGap={24} tick={{ fontSize: 11, fill: "#64748b" }} /><YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(value) => `${value}%`} /><Tooltip formatter={(value) => [`${value}%`, "累计收益率"]} /><Legend wrapperStyle={{ fontSize: 12 }} />{exitStrategyComparison.map((item) => <Line key={item.exitStrategy} type="monotone" dataKey={item.exitStrategy} name={item.label} stroke={item.exitStrategy === "t2Close" ? "#64748b" : item.exitStrategy === "trailingHold" ? "#0ea5e9" : "#7c3aed"} strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />)}</LineChart></ResponsiveContainer></div></section>
        {downsideRiskResearch && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start gap-3"><ShieldAlert className="mt-0.5 h-5 w-5 text-fuchsia-700" /><div className="mr-auto"><h2 className="font-semibold">下行风险评分实验框架</h2><p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">{downsideRiskResearch.definition} 当前展示 {downsideRiskResearch.labeledSampleSize} 个完整观察期的样本外候选；风险评分用于研究，不代表对单只股票的确定预测。</p>{downsideRiskResearch.labeledSampleSize < 50 && <p className="mt-2 text-xs font-medium text-amber-700">当前完整观察期样本少于50个，仅适合观察特征方向；请在样本扩展后再决定是否采用扣分或过滤规则。</p>}</div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{downsideRiskResearch.featureMatrix.map((feature) => <div key={feature.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">{feature.label}</p><span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{feature.timing}</span></div><p className="mt-1 text-xs leading-5 text-slate-500">{feature.definition}</p></div>)}</div><div className="mt-5 overflow-auto rounded-xl border border-slate-200"><table className="w-full min-w-[720px] text-xs"><thead className="bg-slate-100 text-left text-slate-500"><tr><th className="px-3 py-2">风险分层</th><th className="px-3 py-2">样本数</th><th className="px-3 py-2">平均最大不利收盘波动</th><th className="px-3 py-2">≤ -{downsideRiskResearch.mediumDownsidePercent}%</th><th className="px-3 py-2">≤ -{downsideRiskResearch.highDownsidePercent}%</th></tr></thead><tbody>{downsideRiskResearch.riskTiers.map((tier) => <tr key={tier.tier} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-800">{tier.tier}</td><td className="px-3 py-2">{tier.sampleSize}</td><td className="px-3 py-2 text-emerald-700">{tier.averageMaxAdverseCloseReturn ?? "-"}{tier.averageMaxAdverseCloseReturn === null ? "" : "%"}</td><td className="px-3 py-2">{tier.mediumDownsideCount} / {tier.mediumDownsideRate ?? "-"}%</td><td className="px-3 py-2">{tier.highDownsideCount} / {tier.highDownsideRate ?? "-"}%</td></tr>)}</tbody></table></div><div className="mt-5 grid gap-3 md:grid-cols-3">{downsideRiskResearch.experiments.map((experiment) => <div key={experiment.key} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">{experiment.label}</p><p className="mt-1 min-h-10 text-xs leading-5 text-slate-500">{experiment.description}</p></div><span className={experiment.realisticSimulation.totalReturn >= 0 ? "text-sm font-bold text-rose-600" : "text-sm font-bold text-emerald-700"}>{experiment.realisticSimulation.totalReturn}%</span></div><div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-200 pt-3 text-xs"><div><p className="text-slate-400">最大回撤</p><p className="mt-1 font-semibold text-emerald-700">{experiment.realisticSimulation.maxDrawdown}%</p></div><div><p className="text-slate-400">候选/剔除</p><p className="mt-1 font-semibold text-slate-700">{experiment.inputCandidateCount}/{experiment.excludedCandidateCount}</p></div><div><p className="text-slate-400">胜率</p><p className="mt-1 font-semibold text-slate-700">{experiment.realisticSimulation.winRate ?? "-"}%</p></div></div></div>)}</div><div className="mt-5 h-[330px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={downsideRiskCurve} margin={{ top: 12, right: 20, bottom: 8, left: -8 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="date" minTickGap={24} tick={{ fontSize: 11, fill: "#64748b" }} /><YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(value) => `${value}%`} /><Tooltip formatter={(value) => [`${value}%`, "累计收益率"]} /><Legend wrapperStyle={{ fontSize: 12 }} />{downsideRiskResearch.experiments.map((experiment) => <Line key={experiment.key} type="monotone" dataKey={experiment.key} name={experiment.label} stroke={experiment.key === "baseline" ? "#64748b" : experiment.key === "riskPenalty" ? "#d946ef" : "#f59e0b"} strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />)}</LineChart></ResponsiveContainer></div></section>}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700" /><div><h2 className="font-semibold">资金与仓位审计</h2><p className="mt-1 text-sm text-slate-600">峰值持仓 {simulation.peakOpenPositionCount}/{simulation.assumptions.maxPositions}，最低可用现金 ¥{formatMoney(simulation.minimumCash)}。开盘止损释放的资金仅在同一开盘时点后参与候选排序；收盘出清资金不提前复用。</p></div></div></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex flex-wrap items-end gap-3"><div className="mr-auto"><h2 className="font-semibold">全部模拟订单</h2><p className="mt-1 text-xs text-slate-500">显示 {displayedOrders.length}/{orders.length} 笔；红涨绿跌。</p></div><label className="text-xs text-slate-600">状态<select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value as "all" | "filled" | "skipped")} className="mt-1 block h-8 rounded-md border border-slate-200 px-2"><option value="all">全部</option><option value="filled">已入场</option><option value="skipped">未入场</option></select></label><label className="text-xs text-slate-600">原因<select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 block h-8 max-w-48 rounded-md border border-slate-200 px-2"><option value="all">全部</option>{reasons.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="text-xs text-slate-600">搜索<Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="代码或名称" className="mt-1 h-8 w-36" /></label></div><div className="overflow-auto rounded-lg border border-slate-200"><table className="w-full min-w-[1100px] text-xs"><thead className="bg-slate-100 text-left text-slate-500"><tr><th className="px-3 py-2">信号日</th><th className="px-3 py-2">股票</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">股数</th><th className="px-3 py-2">买入/卖出日</th><th className="px-3 py-2">买入/卖出价</th><th className="px-3 py-2">收益率</th><th className="px-3 py-2">买点涨幅</th><th className="px-3 py-2">原因</th></tr></thead><tbody>{displayedOrders.map((order, index) => { const entryPointPremium = order.entryPointPremium ?? null; return <tr key={`${order.signalDate}-${order.stockCode}-${index}`} className="border-t border-slate-100"><td className="px-3 py-2">{formatDate(order.signalDate)}</td><td className="px-3 py-2"><p className="font-medium">{order.stockName}</p><p className="font-mono text-slate-400">{order.stockCode}</p></td><td className="px-3 py-2">{order.status === "filled" ? "已成交" : "未成交"}</td><td className="px-3 py-2">{order.shares || "-"}</td><td className="px-3 py-2">{formatDate(order.entryDate)} / {formatDate(order.exitDate)}</td><td className="px-3 py-2">{order.entryPrice ?? "-"} / {order.exitPrice ?? "-"}</td><td className={`px-3 py-2 ${order.netReturn !== null && order.netReturn >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{order.netReturn === null ? "-" : `${order.netReturn}%`}</td><td className={`px-3 py-2 ${entryPointPremium !== null && entryPointPremium >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{entryPointPremium === null ? "-" : `${entryPointPremium}%`}</td><td className="max-w-72 px-3 py-2 text-slate-500">{order.reason ?? "-"}</td></tr>; })}</tbody></table></div></section>
      </>}
    </div>
  </main>;
}

function Metric({ label, value, tone = "text-slate-800" }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-lg font-bold ${tone}`}>{value}</p></div>;
}
