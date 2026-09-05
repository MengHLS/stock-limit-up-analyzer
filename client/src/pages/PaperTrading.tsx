import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { BarChart3, Loader2, Play, Pause, Plus, RefreshCw, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type StrategyKey = "baseline" | "riskPenalty" | "hardFilter" | "qualityBlend" | "qualityGate";

const STRATEGY_LABELS: Record<StrategyKey, string> = {
  baseline: "原始策略",
  riskPenalty: "风险扣分策略",
  hardFilter: "高风险硬过滤",
  qualityBlend: "质量复合评分",
  qualityGate: "质量门控策略",
};

function Metric({ label, value, tone = "text-slate-800" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}

const returnTone = (value: number | null | undefined) =>
  value === null || value === undefined || value === 0 ? "text-slate-800" : value > 0 ? "text-rose-600" : "text-emerald-700";

export default function PaperTrading() {
  const { user, isAuthenticated } = useAuth();
  const isAdmin = isAuthenticated && user?.role === "admin";
  const utils = trpc.useUtils();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [strategyKey, setStrategyKey] = useState<StrategyKey>("baseline");
  const [initialCapital, setInitialCapital] = useState("100000");

  const listQuery = trpc.sentiment.listPaperTradingRuns.useQuery({ limit: 50 });
  const detailQuery = trpc.sentiment.getPaperTradingRun.useQuery(
    { id: selectedId ?? 0 },
    { enabled: selectedId !== null },
  );

  const createMutation = trpc.sentiment.createPaperTradingRun.useMutation({
    onSuccess: (data) => {
      toast.success(`已创建运行 #${data.id}`);
      setSelectedId(data.id);
      setLabel("");
      void listQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const advanceMutation = trpc.sentiment.advancePaperTradingRun.useMutation({
    onSuccess: () => {
      toast.success("已推进到最新交易日");
      void detailQuery.refetch();
      void listQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const statusMutation = trpc.sentiment.setPaperTradingRunStatus.useMutation({
    onSuccess: () => {
      void detailQuery.refetch();
      void listQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const runs = listQuery.data ?? [];
  const detail = detailQuery.data;

  const curveData = useMemo(() => (detail?.state.equityCurve ?? []).map((point) => ({
    date: point.date.slice(5),
    equity: point.equity,
    cash: point.cash,
  })), [detail]);

  const orders = useMemo(() => [...(detail?.state.orders ?? [])].reverse(), [detail]);

  const onCreate = () => {
    const capital = Number(initialCapital);
    if (!Number.isFinite(capital) || capital < 10_000) {
      toast.error("初始资金需为不小于 10000 的整数");
      return;
    }
    createMutation.mutate({ label: label.trim() || `${STRATEGY_LABELS[strategyKey]}·前向纸面`, strategyKey, initialCapital: Math.floor(capital) });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-orange-700">
              <BarChart3 className="h-5 w-5" />
              <span className="text-xs font-bold tracking-[0.18em]">FORWARD PAPER TRADING</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">前向纸面交易闭环</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              用真实样本外兜底历史回测：T 日收盘生成次日准备买入清单 → 次日开盘按真实开盘价成交 → 持仓按止盈止损逐日出清 → 累积真实前向曲线，与历史回测对比。
            </p>
          </div>
          <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-right">
            <p className="text-xs text-orange-700">前向口径</p>
            <p className="mt-1 font-semibold text-orange-900">仅使用信号日及以前信息 · 固定权重</p>
          </div>
        </div>
      </section>

      {isAdmin && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-orange-700" />
            <h2 className="font-semibold">新建前向运行</h2>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-600">
              运行名称
              <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="如：前向纸面-原始策略" className="mt-1 h-9 w-56 bg-white" />
            </label>
            <label className="text-xs text-slate-600">
              策略
              <select
                value={strategyKey}
                onChange={(event) => setStrategyKey(event.target.value as StrategyKey)}
                className="mt-1 h-9 w-48 rounded-md border border-input bg-white px-3 text-sm"
              >
                {(Object.keys(STRATEGY_LABELS) as StrategyKey[]).map((key) => (
                  <option key={key} value={key}>{STRATEGY_LABELS[key]}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              初始资金（元）
              <Input value={initialCapital} onChange={(event) => setInitialCapital(event.target.value)} className="mt-1 h-9 w-36 bg-white" />
            </label>
            <Button size="sm" className="gap-2 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700" onClick={onCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              创建
            </Button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <WalletCards className="h-4 w-4 text-orange-700" />
          <h2 className="font-semibold">运行列表</h2>
          <span className="ml-auto text-xs text-slate-400">共 {runs.length} 条</span>
        </div>
        {listQuery.isLoading ? (
          <p className="p-6 text-center text-sm text-slate-500">加载中…</p>
        ) : runs.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">暂无前向运行。管理员可创建一条运行开始真实样本外闭环。</p>
        ) : (
          <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[820px] text-xs">
              <thead className="bg-slate-100 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2">运行</th>
                  <th className="px-3 py-2">策略</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">已推进到</th>
                  <th className="px-3 py-2">前向收益</th>
                  <th className="px-3 py-2">最大回撤</th>
                  <th className="px-3 py-2">胜率</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className={`border-t border-slate-100 ${run.id === selectedId ? "bg-orange-50/60" : ""}`}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{run.label}</p>
                      <p className="mt-0.5 text-slate-400">#{run.id}</p>
                    </td>
                    <td className="px-3 py-2">{STRATEGY_LABELS[run.strategyKey] ?? run.strategyKey}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${run.status === "active" ? "bg-emerald-100 text-emerald-700" : run.status === "paused" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"}`}>
                        {run.status === "active" ? "进行中" : run.status === "paused" ? "已暂停" : "已结束"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600">{run.lastProcessedDate ?? "-"}</td>
                    <td className={`px-3 py-2 font-semibold ${returnTone(run.summary?.totalReturn)}`}>{run.summary?.totalReturn === null || run.summary?.totalReturn === undefined ? "-" : `${run.summary.totalReturn}%`}</td>
                    <td className="px-3 py-2 font-medium text-emerald-700">{run.summary?.maxDrawdown === null || run.summary?.maxDrawdown === undefined ? "-" : `${run.summary.maxDrawdown}%`}</td>
                    <td className="px-3 py-2">{run.summary?.winRate === null || run.summary?.winRate === undefined ? "-" : `${run.summary.winRate}%`}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setSelectedId(run.id)}>查看</Button>
                        {isAdmin && run.status === "active" && (
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => advanceMutation.mutate({ id: run.id })} disabled={advanceMutation.isPending}>
                            <Play className="h-3.5 w-3.5" />推进
                          </Button>
                        )}
                        {isAdmin && (run.status === "active" || run.status === "paused") && (
                          <Button size="sm" variant="ghost" onClick={() => statusMutation.mutate({ id: run.id, status: run.status === "active" ? "paused" : "active" })} disabled={statusMutation.isPending}>
                            {run.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedId !== null && detailQuery.isLoading && (
        <p className="p-6 text-center text-sm text-slate-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />加载运行详情…</p>
      )}

      {detail && (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start gap-3">
              <BarChart3 className="mt-0.5 h-5 w-5 text-orange-700" />
              <div className="mr-auto">
                <h2 className="font-semibold">{detail.label} · {STRATEGY_LABELS[detail.strategyKey]}</h2>
                <p className="mt-1 text-xs text-slate-500">初始资金 ¥{detail.initialCapital.toLocaleString()} · 已推进到 {detail.lastProcessedDate ?? "-"} · 状态 {detail.status === "active" ? "进行中" : detail.status === "paused" ? "已暂停" : "已结束"}</p>
              </div>
              {isAdmin && detail.status === "active" && (
                <Button size="sm" variant="outline" className="gap-2" onClick={() => advanceMutation.mutate({ id: detail.id })} disabled={advanceMutation.isPending}>
                  <RefreshCw className={`h-4 w-4 ${advanceMutation.isPending ? "animate-spin" : ""}`} />推进到最新
                </Button>
              )}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="前向总市值" value={`¥${(detail.summary?.finalEquity ?? 0).toLocaleString()}`} />
              <Metric label="前向累计收益" value={detail.summary?.totalReturn === null || detail.summary?.totalReturn === undefined ? "-" : `${detail.summary.totalReturn}%`} tone={returnTone(detail.summary?.totalReturn)} />
              <Metric label="最大回撤" value={detail.summary?.maxDrawdown === null || detail.summary?.maxDrawdown === undefined ? "-" : `${detail.summary.maxDrawdown}%`} tone="text-emerald-700" />
              <Metric label="已出清 / 胜率" value={`${detail.summary?.exitedCount ?? 0} 笔 · ${detail.summary?.winRate === null || detail.summary?.winRate === undefined ? "-" : `${detail.summary.winRate}%`}`} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric label="已成交订单" value={String(detail.summary?.filledCount ?? 0)} />
              <Metric label="当前持仓" value={String(detail.summary?.openPositionCount ?? 0)} />
              <Metric label="前向交易日数" value={String(detail.summary?.tradingDayCount ?? 0)} />
            </div>
            {curveData.length > 0 && (
              <div className="mt-5 h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={curveData} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="date" minTickGap={24} tick={{ fontSize: 11, fill: "#64748b" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(value) => `¥${(Number(value) / 1000).toFixed(0)}k`} width={64} />
                    <Tooltip formatter={(value: number) => [`¥${value.toLocaleString()}`, "总市值"]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="equity" name="前向总市值" stroke="#f97316" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {detail.state.pendingBuys.length > 0 && (
            <section className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <BarChart3 className="mt-0.5 h-5 w-5 text-orange-700" />
                <div>
                  <p className="text-xs font-bold tracking-[0.16em] text-orange-700">NEXT-DAY BUY LIST</p>
                  <h2 className="mt-1 font-semibold">下一交易日准备买入清单</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">以 {detail.state.pendingBuys[0]?.signalDate ?? "-"} 收盘信息生成，按策略优先级排序，未承诺成交。</p>
                </div>
              </div>
              <div className="mt-4 overflow-auto rounded-xl border border-orange-100">
                <table className="w-full min-w-[760px] text-xs">
                  <thead className="bg-orange-50 text-left text-orange-900">
                    <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">股票</th><th className="px-3 py-2">题材</th><th className="px-3 py-2">板数</th><th className="px-3 py-2">策略分</th><th className="px-3 py-2">风险</th><th className="px-3 py-2">信号日收盘</th></tr>
                  </thead>
                  <tbody>
                    {detail.state.pendingBuys.map((buy) => (
                      <tr key={buy.stockCode} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-400">{buy.rank}</td>
                        <td className="px-3 py-2"><p className="font-medium text-slate-800">{buy.stockName}</p><p className="mt-0.5 font-mono text-slate-500">{buy.stockCode}</p></td>
                        <td className="px-3 py-2">{buy.sector}</td>
                        <td className="px-3 py-2">{buy.boards}板</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{buy.strategyScore}</td>
                        <td className="px-3 py-2"><span className={buy.riskTier === "高风险" ? "text-rose-600" : buy.riskTier === "中风险" ? "text-amber-600" : "text-emerald-700"}>{buy.riskTier}</span></td>
                        <td className="px-3 py-2 font-mono">{buy.signalClosePrice ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {detail.state.positions.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <WalletCards className="h-4 w-4 text-orange-700" />
                <h2 className="font-semibold">当前持仓（{detail.state.positions.length}）</h2>
              </div>
              <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="bg-slate-100 text-left text-slate-500">
                    <tr><th className="px-3 py-2">股票</th><th className="px-3 py-2">信号日</th><th className="px-3 py-2">成交日</th><th className="px-3 py-2">成交价</th><th className="px-3 py-2">股数</th><th className="px-3 py-2">成本</th></tr>
                  </thead>
                  <tbody>
                    {detail.state.positions.map((position) => (
                      <tr key={`${position.stockCode}-${position.entryDate}`} className="border-t border-slate-100">
                        <td className="px-3 py-2"><p className="font-medium text-slate-800">{position.stockName}</p><p className="mt-0.5 font-mono text-slate-500">{position.stockCode}</p></td>
                        <td className="px-3 py-2 font-mono">{position.signalDate}</td>
                        <td className="px-3 py-2 font-mono">{position.entryDate}</td>
                        <td className="px-3 py-2 font-mono">{position.entryPrice.toFixed(3)}</td>
                        <td className="px-3 py-2">{position.shares}</td>
                        <td className="px-3 py-2 font-mono">¥{position.capitalCost.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-orange-700" />
              <h2 className="font-semibold">逐笔订单（{orders.length}）</h2>
            </div>
            <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[980px] text-xs">
                <thead className="bg-slate-100 text-left text-slate-500">
                  <tr><th className="px-3 py-2">信号日 / 股票</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">成交日 / 价</th><th className="px-3 py-2">出清日 / 价</th><th className="px-3 py-2">股数</th><th className="px-3 py-2">净收益</th><th className="px-3 py-2">原因</th></tr>
                </thead>
                <tbody>
                  {orders.map((order, index) => (
                    <tr key={`${order.stockCode}-${order.entryDate}-${index}`} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2"><p className="font-medium text-slate-800">{order.stockName}</p><p className="mt-0.5 font-mono text-slate-500">{order.stockCode}</p><p className="mt-0.5 text-slate-400">{order.signalDate}</p></td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${order.status === "exited" ? "bg-slate-200 text-slate-600" : order.status === "filled" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {order.status === "exited" ? "已出清" : order.status === "filled" ? "持仓中" : "未成交"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono">{order.entryDate ?? "-"}{order.entryPrice === null ? "" : ` @ ${order.entryPrice}`}</td>
                      <td className="px-3 py-2 font-mono">{order.exitDate ?? "-"}{order.exitPrice === null ? "" : ` @ ${order.exitPrice}`}</td>
                      <td className="px-3 py-2">{order.shares}</td>
                      <td className={`px-3 py-2 font-semibold ${order.netReturn === null ? "text-slate-400" : order.netReturn >= 0 ? "text-rose-600" : "text-emerald-700"}`}>
                        {order.netReturn === null ? "-" : `${order.netReturn}%`}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{order.reason ?? "-"}</td>
                    </tr>
                  ))}
                  {orders.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">暂无订单。</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
