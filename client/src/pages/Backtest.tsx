import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StrategyEvaluationPanel } from "@/components/StrategyEvaluationPanel";
import { sortOrdersByKey, type OrderReturnSortDirection, type OrderSortKey } from "@/lib/orderReturnSort";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { BarChart3, DatabaseZap, History, Loader2, RefreshCw, Save, ShieldAlert, ShieldCheck, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function formatMoney(value: number) { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value); }
function formatDate(date: string | null) { return date ? date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日") : "-"; }
function Metric({ label, value, tone = "text-slate-800" }: { label: string; value: string; tone?: string }) { return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-lg font-bold ${tone}`}>{value}</p></div>; }
function ReturnLineChart({ data, series }: { data: Array<Record<string, string | number>>; series: Array<{ key: string; label: string; color: string }> }) { return <div className="mt-5 h-[330px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 12, right: 20, bottom: 8, left: -8 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="date" minTickGap={24} tick={{ fontSize: 11, fill: "#64748b" }} /><YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(value) => `${value}%`} /><Tooltip formatter={(value) => [`${value}%`, "累计收益率"]} /><Legend wrapperStyle={{ fontSize: 12 }} />{series.map((item) => <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={item.color} strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />)}</LineChart></ResponsiveContainer></div>; }
type TradeDiffSnapshot = { status: "filled" | "skipped"; score: number; shares: number; entryDate: string | null; exitDate: string | null; entryPrice: number | null; exitPrice: number | null; netReturn: number | null; reason: string | null };
type OrderStrategyKey = "baseline" | "riskPenalty" | "hardFilter" | "qualityBlend" | "qualityGate";
type SimulatedOrder = { signalDate: string; entryDate: string | null; exitDate: string | null; stockCode: string; stockName: string; score: number; shares: number; entryPrice: number | null; exitPrice: number | null; netReturn: number | null; pnlToEquityRatio?: number | null; entryPointPremium?: number | null; openExpectationTier?: "exceeds" | "meets" | "misses" | null; status: "filled" | "skipped"; reason: string | null; highRiskExcluded?: boolean; exclusionLabel?: string };

type OpenExpectationBandInput = { center: number; lower: number; upper: number };
type OpenExpectationTableInput = Record<"early" | "morning" | "afternoon" | "late" | "unknown", OpenExpectationBandInput>;

const OPEN_EXPECTATION_DEFAULT_CONFIG: OpenExpectationTableInput = {
  early: { center: 3.2, lower: 1.2, upper: 5.4 },
  morning: { center: 1.6, lower: -0.8, upper: 4.2 },
  afternoon: { center: 0.4, lower: -2.2, upper: 3.0 },
  late: { center: -0.2, lower: -2.8, upper: 2.4 },
  unknown: { center: 1.2, lower: -2.0, upper: 4.4 },
};

const OPEN_EXPECTATION_BUCKET_ROWS: Array<{ key: keyof OpenExpectationTableInput; label: string; range: string }> = [
  { key: "early", label: "早盘板", range: "09:30–10:00 封板" },
  { key: "morning", label: "上午板", range: "10:00–11:30 封板" },
  { key: "afternoon", label: "午后板", range: "13:00–14:00 封板" },
  { key: "late", label: "尾盘板", range: "14:00–15:00 封板" },
  { key: "unknown", label: "封板时间缺失", range: "使用全样本分布兜底" },
];

const OPEN_EXPECTATION_TIER_STYLE: Record<"exceeds" | "meets" | "misses", { label: string; chip: string }> = {
  exceeds: { label: "超预期", chip: "bg-rose-50 text-rose-700" },
  meets: { label: "符合预期", chip: "bg-slate-100 text-slate-600" },
  misses: { label: "不及预期", chip: "bg-emerald-50 text-emerald-700" },
};
const strategyColors: Record<OrderStrategyKey, string> = { baseline: "#64748b", riskPenalty: "#d946ef", hardFilter: "#f59e0b", qualityBlend: "#0284c7", qualityGate: "#059669" };
const orderStrategyOptions: Array<{ key: OrderStrategyKey; label: string; description: string }> = [
  { key: "baseline", label: "原始评分基准", description: "保留原始候选评分与全部模拟订单。" },
  { key: "riskPenalty", label: "风险扣分策略", description: "按自动/回退风险权重重新排序后的完整模拟订单。" },
  { key: "hardFilter", label: "高风险硬过滤", description: "同时展示实际模拟订单和因高风险被排除的未入场订单。" },
  { key: "qualityBlend", label: "质量复合评分", description: "固定质量复合分重新排序后的完整模拟订单。" },
  { key: "qualityGate", label: "质量门控策略", description: "同时展示实际模拟订单和因质量门控被排除的未入场订单。" },
];
type BacktestPageTab = "overview" | "params" | "compare" | "risk" | "trades" | "history";
const pageTabs: Array<{ key: BacktestPageTab; label: string }> = [
  { key: "overview", label: "回测总览" },
  { key: "params", label: "参数配置" },
  { key: "compare", label: "策略对比" },
  { key: "risk", label: "风险归因" },
  { key: "trades", label: "交易明细" },
  { key: "history", label: "历史记录" },
];
function TradeDiffCell({ trade, filtered = false, filteredLabel = "高风险过滤" }: { trade: TradeDiffSnapshot | null; filtered?: boolean; filteredLabel?: string }) { if (filtered) return <div className="min-w-44 rounded-lg bg-amber-50 p-2 text-amber-800"><p className="font-semibold">{filteredLabel}</p><p className="mt-1 text-slate-500">未通过该策略门槛，未进入模拟</p></div>; if (!trade) return <span className="text-slate-400">无订单</span>; return <div className="min-w-44 rounded-lg bg-slate-50 p-2"><p className={`font-semibold ${trade.status === "filled" ? "text-slate-800" : "text-amber-700"}`}>{trade.status === "filled" ? "已入场" : "未入场"} · 评分 {trade.score}</p><p className="mt-1 text-slate-500">{formatDate(trade.entryDate)} → {formatDate(trade.exitDate)}</p><p className="mt-1 text-slate-500">{trade.entryPrice ?? "-"} / {trade.exitPrice ?? "-"} · {trade.shares || "-"}股</p><p className={`mt-1 font-semibold ${trade.netReturn !== null && trade.netReturn >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{trade.netReturn === null ? "收益待定" : `${trade.netReturn}%`}</p><p className="mt-1 leading-4 text-slate-500">{trade.reason ?? "-"}</p></div>; }

type RiskAdjustedPerformance = { returnSampling: "相邻交易日收盘权益"; riskFreeAnnualRate: number; annualizationTradingDays: number; equityPointCount: number; dailyReturnCount: number; annualizedReturn: number | null; dailyVolatility: number | null; annualizedVolatility: number | null; annualizedDownsideDeviation: number | null; sharpeRatio: number | null; sortinoRatio: number | null; calmarRatio: number | null; ulcerIndex: number | null };
type EvaluationExperiment = { key: OrderStrategyKey; label: string; description: string; inputCandidateCount: number; excludedCandidateCount: number; realisticSimulation: { finalCapital: number; netProfit: number; totalReturn: number; maxDrawdown: number; winRate: number | null; profitFactor: number | null; filledCount: number; completedCount: number; openPositionCount: number; skippedCount: number; minimumCash: number }; riskAdjustedPerformance: RiskAdjustedPerformance };
type WalkForwardExperiment = { key: OrderStrategyKey; label: string; totalReturn: number; maxDrawdown: number; finalCapital: number; filledCount: number; completedCount: number; riskAdjustedPerformance: RiskAdjustedPerformance };

function StrategyEvaluationTable({ title, description, experiments, outOfSample = false }: { title: string; description: string; experiments: EvaluationExperiment[] | WalkForwardExperiment[]; outOfSample?: boolean }) {
  return <div className="overflow-auto rounded-xl border border-slate-200">
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><h3 className="text-sm font-semibold text-slate-800">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>
    <table className="w-full min-w-[1460px] text-xs"><thead className="sticky top-0 z-10 bg-white text-left text-slate-500"><tr><th className="px-3 py-2">策略 / 固定规则</th>{!outOfSample && <><th className="px-3 py-2">候选 / 剔除</th><th className="px-3 py-2">期末资金</th><th className="px-3 py-2">净利润</th></>}<th className="px-3 py-2">累计收益</th><th className="px-3 py-2">最大回撤</th>{!outOfSample && <><th className="px-3 py-2">胜率 / 盈亏比</th><th className="px-3 py-2">入场 / 已出清 / 持仓</th><th className="px-3 py-2">未入场</th><th className="px-3 py-2">最小可用现金</th></>}{outOfSample && <><th className="px-3 py-2">期末资金</th><th className="px-3 py-2">入场 / 已出清</th></>}</tr></thead>
      <tbody>{experiments.map((experiment) => {
        const fullCycle = experiment as EvaluationExperiment;
        const walkForward = experiment as WalkForwardExperiment;
        const simulation = outOfSample ? null : fullCycle.realisticSimulation;
        const totalReturn = outOfSample ? walkForward.totalReturn : simulation!.totalReturn;
        const maxDrawdown = outOfSample ? walkForward.maxDrawdown : simulation!.maxDrawdown;
        const finalCapital = outOfSample ? walkForward.finalCapital : simulation!.finalCapital;
        return <tr key={experiment.key} className="border-t border-slate-100 align-top"><td className="max-w-80 px-3 py-3"><p className="font-semibold" style={{ color: strategyColors[experiment.key] }}>{experiment.label}</p><p className="mt-1 leading-5 text-slate-500">{outOfSample ? "连续拼接的严格滚动样本外验证结果。" : fullCycle.description}</p></td>{!outOfSample && <><td className="px-3 py-3">{fullCycle.inputCandidateCount} / {fullCycle.excludedCandidateCount}</td><td className="whitespace-nowrap px-3 py-3">¥{formatMoney(finalCapital)}</td><td className={`whitespace-nowrap px-3 py-3 font-semibold ${simulation!.netProfit >= 0 ? "text-rose-600" : "text-emerald-700"}`}>¥{formatMoney(simulation!.netProfit)}</td></>}<td className={`whitespace-nowrap px-3 py-3 font-bold ${totalReturn >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{totalReturn}%</td><td className="whitespace-nowrap px-3 py-3 font-semibold text-emerald-700">{maxDrawdown}%</td>{!outOfSample && <><td className="px-3 py-3">{simulation!.winRate ?? "-"}% / {simulation!.profitFactor ?? "-"}</td><td className="px-3 py-3">{simulation!.filledCount} / {simulation!.completedCount} / {simulation!.openPositionCount}</td><td className="px-3 py-3">{simulation!.skippedCount}</td><td className="whitespace-nowrap px-3 py-3">¥{formatMoney(simulation!.minimumCash)}</td></>}{outOfSample && <><td className="whitespace-nowrap px-3 py-3">¥{formatMoney(finalCapital)}</td><td className="px-3 py-3">{walkForward.filledCount} / {walkForward.completedCount}</td></>}</tr>;
      })}</tbody>
    </table>
  </div>;
}

function formatRiskMetric(value: number | null, suffix = "") { return value === null ? "样本不足" : `${value}${suffix}`; }

function RiskAdjustedComparison({ experiments, outOfSample }: { experiments: Array<EvaluationExperiment | WalkForwardExperiment>; outOfSample: boolean }) {
  return <div data-risk-adjusted-evaluation className="overflow-auto rounded-xl border border-sky-200 bg-sky-50/40"><div className="border-b border-sky-100 bg-sky-50 px-4 py-3"><h3 className="text-sm font-semibold text-sky-950">风险调整后评价</h3><p className="mt-1 max-w-5xl text-xs leading-5 text-sky-800">基于各策略同一连续账户的相邻交易日收盘权益计算。无风险年化收益率固定为0%，年化系数为252个交易日；夏普衡量总波动补偿，索提诺仅惩罚下行波动，卡玛比较年化收益与最大回撤，Ulcer指数衡量回撤深度与持续压力。</p></div><table className="w-full min-w-[1240px] text-xs"><thead className="bg-white text-left text-slate-500"><tr><th className="px-3 py-2">策略</th><th className="px-3 py-2">年化收益</th><th className="px-3 py-2">年化波动</th><th className="px-3 py-2">年化下行波动</th><th className="px-3 py-2">夏普比率</th><th className="px-3 py-2">索提诺比率</th><th className="px-3 py-2">卡玛比率</th><th className="px-3 py-2">Ulcer指数</th><th className="px-3 py-2">权益点 / 日收益数</th></tr></thead><tbody>{experiments.map((experiment) => { const metric = experiment.riskAdjustedPerformance; return <tr key={`${outOfSample ? "oos" : "full"}-${experiment.key}`} className="border-t border-sky-100"><td className="px-3 py-3 font-semibold" style={{ color: strategyColors[experiment.key] }}>{experiment.label}</td><td className={`px-3 py-3 font-semibold ${(metric.annualizedReturn ?? 0) >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{formatRiskMetric(metric.annualizedReturn, "%")}</td><td className="px-3 py-3">{formatRiskMetric(metric.annualizedVolatility, "%")}</td><td className="px-3 py-3">{formatRiskMetric(metric.annualizedDownsideDeviation, "%")}</td><td className="px-3 py-3 font-semibold text-sky-800">{formatRiskMetric(metric.sharpeRatio)}</td><td className="px-3 py-3 font-semibold text-sky-800">{formatRiskMetric(metric.sortinoRatio)}</td><td className="px-3 py-3 font-semibold text-sky-800">{formatRiskMetric(metric.calmarRatio)}</td><td className="px-3 py-3">{formatRiskMetric(metric.ulcerIndex, "%")}</td><td className="px-3 py-3 text-slate-600">{metric.equityPointCount} / {metric.dailyReturnCount}</td></tr>; })}</tbody></table></div>;
}

function StrategyEvaluationSection(props: Parameters<typeof StrategyEvaluationPanel>[0]) {
  return <StrategyEvaluationPanel {...props} />;
}

function FullOrdersSection({
  strategy,
  onStrategyChange,
  activeStrategy,
  orders,
  displayedOrders,
  orderStatus,
  onOrderStatusChange,
  reason,
  onReasonChange,
  reasons,
  keyword,
  onKeywordChange,
  sortKey,
  sortDirection,
  onSortChange,
}: {
  strategy: OrderStrategyKey;
  onStrategyChange: (strategy: OrderStrategyKey) => void;
  activeStrategy: (typeof orderStrategyOptions)[number];
  orders: SimulatedOrder[];
  displayedOrders: SimulatedOrder[];
  orderStatus: "all" | "filled" | "skipped";
  onOrderStatusChange: (status: "all" | "filled" | "skipped") => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  reasons: string[];
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  sortKey: OrderSortKey;
  sortDirection: OrderReturnSortDirection;
  onSortChange: (key: OrderSortKey) => void;
}) {
  const filledCount = orders.filter((order) => order.status === "filled").length;
  const skippedCount = orders.length - filledCount;
  const highRiskExcludedCount = orders.filter((order) => order.highRiskExcluded).length;
  const hasExpectationTier = orders.some((order) => order.openExpectationTier != null);
  const expectationTierSummary = (() => {
    const tiers = ["exceeds", "meets", "misses"] as const;
    return tiers.map((tier) => {
      const group = orders.filter((order) => order.openExpectationTier === tier);
      const filled = group.filter((order) => order.status === "filled");
      const closed = filled.filter((order) => order.netReturn !== null && order.netReturn !== undefined);
      const returns = closed.map((order) => order.netReturn as number);
      const averageNetReturn = returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null;
      const winRate = returns.length > 0 ? (returns.filter((value) => value > 0).length / returns.length) * 100 : null;
      return { tier, count: group.length, filledCount: filled.length, averageNetReturn, winRate };
    });
  })();
  const sortIndicator = (key: OrderSortKey) => {
    const active = sortKey === key && sortDirection !== "none";
    const arrow = !active ? "↕" : sortDirection === "asc" ? "↑" : "↓";
    return { active, arrow, ariaSort: active ? (sortDirection === "asc" ? "ascending" : "descending") : "none" } as const;
  };

  return (
    <section data-all-simulated-orders className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-4 border-b border-slate-100 pb-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto">
            <h2 className="font-semibold">全部模拟订单</h2>
            <p className="mt-1 text-xs text-slate-500">切换后展示对应全周期策略的全部订单；红涨绿跌。</p>
          </div>
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="tablist" aria-label="订单策略切换">
            {orderStrategyOptions.map((option) => (
              <Button
                key={option.key}
                type="button"
                size="sm"
                variant={strategy === option.key ? "default" : "ghost"}
                role="tab"
                aria-selected={strategy === option.key}
                onClick={() => onStrategyChange(option.key)}
                className={strategy === option.key ? "bg-slate-800 text-white hover:bg-slate-700" : "text-slate-600"}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <p className="text-sm font-medium text-slate-800">{activeStrategy.label}</p>
            <p className="mt-1 text-xs text-slate-500">{activeStrategy.description}</p>
            <p className="mt-2 text-xs text-slate-600">显示 {displayedOrders.length}/{orders.length} 笔 · 已入场 {filledCount} 笔 · 未入场 {skippedCount} 笔{strategy === "hardFilter" && ` · 高风险剔除 ${highRiskExcludedCount} 笔`}{strategy === "qualityGate" && ` · 质量门控剔除 ${orders.filter((order) => order.exclusionLabel === "质量门控剔除").length} 笔`}</p>
          </div>
          <label className="text-xs text-slate-600">状态<select value={orderStatus} onChange={(event) => onOrderStatusChange(event.target.value as "all" | "filled" | "skipped")} className="mt-1 block h-8 rounded-md border border-slate-200 px-2"><option value="all">全部</option><option value="filled">已入场</option><option value="skipped">未入场</option></select></label>
          <label className="text-xs text-slate-600">原因<select value={reason} onChange={(event) => onReasonChange(event.target.value)} className="mt-1 block h-8 max-w-52 rounded-md border border-slate-200 px-2"><option value="all">全部</option>{reasons.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="text-xs text-slate-600">搜索<Input value={keyword} onChange={(event) => onKeywordChange(event.target.value)} placeholder="代码或名称" className="mt-1 h-8 w-36" /></label>
        </div>
      </div>
      {hasExpectationTier && (
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          {expectationTierSummary.map((item) => {
            const meta = OPEN_EXPECTATION_TIER_STYLE[item.tier];
            return (
              <div key={item.tier} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                <div className="flex items-center justify-between"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${meta.chip}`}>{meta.label}</span><span className="text-xs text-slate-500">候选 {item.count} · 买入 {item.filledCount}</span></div>
                <p className="mt-1 text-xs text-slate-600">已出清平均收益 {item.averageNetReturn === null ? "-" : `${item.averageNetReturn.toFixed(2)}%`} · 胜率 {item.winRate === null ? "-" : `${item.winRate.toFixed(1)}%`}</p>
              </div>
            );
          })}
        </div>
      )}
      <div className="orders-scroll-container overflow-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[1360px] text-xs">
          <thead className="bg-slate-100 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2"><button type="button" className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-semibold text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500" onClick={() => onSortChange("signalDate")} aria-label="按信号日排序" aria-sort={sortIndicator("signalDate").ariaSort}>信号日 <span aria-hidden="true" className={sortIndicator("signalDate").active ? "text-sky-700" : "text-slate-400"}>{sortIndicator("signalDate").arrow}</span></button></th>
              <th className="px-3 py-2">股票</th>
              <th className="px-3 py-2">评分</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">股数</th>
              <th className="px-3 py-2">买入/卖出日</th>
              <th className="px-3 py-2">买入/卖出价</th>
              <th className="px-3 py-2"><button type="button" className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-semibold text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500" onClick={() => onSortChange("netReturn")} aria-label="按收益率排序" aria-sort={sortIndicator("netReturn").ariaSort}>收益率 <span aria-hidden="true" className={sortIndicator("netReturn").active ? "text-sky-700" : "text-slate-400"}>{sortIndicator("netReturn").arrow}</span></button></th>
              <th className="px-3 py-2"><button type="button" className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-semibold text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500" onClick={() => onSortChange("pnlToEquityRatio")} aria-label="按盈亏占资金比排序" aria-sort={sortIndicator("pnlToEquityRatio").ariaSort}>盈亏占资金比 <span aria-hidden="true" className={sortIndicator("pnlToEquityRatio").active ? "text-sky-700" : "text-slate-400"}>{sortIndicator("pnlToEquityRatio").arrow}</span></button></th>
              {hasExpectationTier && <th className="px-3 py-2">预期档位</th>}
              <th className="px-3 py-2">买点涨幅</th>
              <th className="px-3 py-2">原因</th>
            </tr>
          </thead>
          <tbody>
            {displayedOrders.map((order, index) => {
              const entryPointPremium = order.entryPointPremium ?? null;
              const pnlToEquityRatio = order.pnlToEquityRatio ?? null;
              return <tr key={`${strategy}-${order.signalDate}-${order.stockCode}-${index}`} className="border-t border-slate-100 align-top"><td className="whitespace-nowrap px-3 py-2">{formatDate(order.signalDate)}</td><td className="px-3 py-2"><p className="font-medium">{order.stockName}</p><p className="font-mono text-slate-400">{order.stockCode}</p></td><td className="px-3 py-2 font-medium text-slate-700">{order.score}</td><td className="px-3 py-2">{order.highRiskExcluded ? <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">高风险剔除</span> : order.exclusionLabel ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">{order.exclusionLabel}</span> : order.status === "filled" ? "已成交" : "未成交"}</td><td className="px-3 py-2">{order.shares || "-"}</td><td className="whitespace-nowrap px-3 py-2">{formatDate(order.entryDate)} / {formatDate(order.exitDate)}</td><td className="whitespace-nowrap px-3 py-2">{order.entryPrice ?? "-"} / {order.exitPrice ?? "-"}</td><td className={`px-3 py-2 font-medium ${order.netReturn !== null && order.netReturn >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{order.netReturn === null ? "-" : `${order.netReturn}%`}</td><td className={`px-3 py-2 font-medium ${pnlToEquityRatio === null ? "text-slate-400" : pnlToEquityRatio >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{pnlToEquityRatio === null ? "-" : `${pnlToEquityRatio.toFixed(2)}%`}</td>{hasExpectationTier && <td className="px-3 py-2">{order.openExpectationTier ? <span className={`rounded px-1.5 py-0.5 font-medium ${OPEN_EXPECTATION_TIER_STYLE[order.openExpectationTier].chip}`}>{OPEN_EXPECTATION_TIER_STYLE[order.openExpectationTier].label}</span> : "-"}</td>}<td className={`px-3 py-2 font-medium ${entryPointPremium !== null && entryPointPremium >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{entryPointPremium === null ? "-" : `${entryPointPremium}%`}</td><td className="max-w-80 px-3 py-2 leading-5 text-slate-500">{order.reason ?? "-"}</td></tr>;
            })}
          </tbody>
        </table>
        {displayedOrders.length === 0 && <p className="p-6 text-center text-sm text-slate-500">没有符合当前筛选条件的订单。</p>}
      </div>
    </section>
  );
}

function OpenExpectationParamsCard({
  enabled,
  table,
  onEnabledChange,
  onTableChange,
}: {
  enabled: boolean;
  table: OpenExpectationTableInput;
  onEnabledChange: (value: boolean) => void;
  onTableChange: (table: OpenExpectationTableInput) => void;
}) {
  const setBand = (key: keyof OpenExpectationTableInput, field: keyof OpenExpectationBandInput, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    onTableChange({ ...table, [key]: { ...table[key], [field]: value } });
  };
  return (
    <section data-open-expectation-params className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-slate-100 pb-3">
        <div className="mr-auto">
          <h2 className="font-semibold">次日开盘预期三档（按 t 日封板时间）</h2>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">启用后：按封板时间分档，以「期望区间」比较 t+1 实际开盘溢价——<span className="font-medium text-rose-600">超预期（开盘溢价 &gt; 上界）→ 买入</span>；<span className="font-medium text-slate-700">符合预期（在下界与上界之间）→ 按既有规则买入</span>；<span className="font-medium text-emerald-700">不及预期（开盘溢价 &lt; 下界）→ 放弃买入</span>。替代下方「开盘最低溢价」的一刀切阈值。</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-sky-600" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
          启用三档门控
        </label>
      </div>
      <div className="overflow-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="bg-slate-100 text-left text-slate-500"><tr><th className="px-3 py-2">封板档位</th><th className="px-3 py-2">期望中心（%）= 历史中位数</th><th className="px-3 py-2">区间下界 lower（%）</th><th className="px-3 py-2">区间上界 upper（%）</th><th className="px-3 py-2">判定</th></tr></thead>
          <tbody>
            {OPEN_EXPECTATION_BUCKET_ROWS.map((row) => {
              const band = table[row.key];
              return (
                <tr key={row.key} className="border-t border-slate-100">
                  <td className="px-3 py-2"><p className="font-medium text-slate-700">{row.label}</p><p className="text-xs text-slate-400">{row.range}</p></td>
                  <td className="px-3 py-2"><input type="number" step="0.1" value={band.center} onChange={(event) => setBand(row.key, "center", event.target.value)} className="h-8 w-24 rounded-md border border-slate-200 px-2 font-mono" /></td>
                  <td className="px-3 py-2"><input type="number" step="0.1" value={band.lower} onChange={(event) => setBand(row.key, "lower", event.target.value)} className="h-8 w-24 rounded-md border border-slate-200 px-2 font-mono" /></td>
                  <td className="px-3 py-2"><input type="number" step="0.1" value={band.upper} onChange={(event) => setBand(row.key, "upper", event.target.value)} className="h-8 w-24 rounded-md border border-slate-200 px-2 font-mono" /></td>
                  <td className="px-3 py-2 text-slate-500">开盘溢价低于 lower → 放弃；高于 upper → 超预期买入</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">默认值说明：本表预期中心 = 各封板时间档位 T+1 开盘溢价的<b>历史中位数</b>，下界/上界 = <b>25%/75% 分位</b>。当前出厂值为经验初值占位；用真实库执行 <code className="rounded bg-slate-100 px-1 font-mono">npx tsx calibrate_open_expectation.ts</code> 后可一键回填（需同步 server 默认表）。缺失封板时间走 unknown（全样本分布）兜底。手动改动仅影响本次回测与纸面交易，不写入库。</p>
    </section>
  );
}

export default function BacktestPage() {
  const [config, setConfig] = useState({
    initialCapital: 100000, maxPositions: 5, commissionBps: 3, stampDutyBps: 5, transferFeeBps: 0.1, slippageBps: 10,
    blockLimitUpBuys: false, blockLimitDownSells: false, enableOneWordLimitDownProbability: false, oneWordLimitDownSellProbability: 0,
    blockOneWordLimitUpBuys: false, enableIntradayStopLoss: false, detectExRights: false, maxPositionAmountPercent: 0,
    positionSizingStrategy: "equal" as "equal" | "scoreWeighted" | "fixedPercent", fixedPositionPercent: 20, minimumExpectedOpenChangePercent: -2,
    expectationTierEnabled: false, expectationTable: OPEN_EXPECTATION_DEFAULT_CONFIG as OpenExpectationTableInput,
    trailingProfitActivationPercent: 6, trailingDrawdownPercent: 3, stopLossPercent: 5, strongHoldMinReturn: 3, maxHoldingDays: 5,
    downsideObservationDays: 5, mediumDownsidePercent: 4, highDownsidePercent: 8, riskPenaltyWeight: 0.35, autoTunePenaltyWeight: true, hardRiskThreshold: 65, rollingTrainTradingDays: 45, rollingValidationTradingDays: 14,
  });
  const [orderStatus, setOrderStatus] = useState<"all" | "filled" | "skipped">("all");
  const [reason, setReason] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [tradeDiffOnly, setTradeDiffOnly] = useState(true);
  const [tradeDiffKeyword, setTradeDiffKeyword] = useState("");
  const [orderStrategy, setOrderStrategy] = useState<OrderStrategyKey>("baseline");
  const [portfolioStrategy, setPortfolioStrategy] = useState<OrderStrategyKey>("baseline");
  const [orderSortKey, setOrderSortKey] = useState<OrderSortKey>("signalDate");
  const [orderSortDirection, setOrderSortDirection] = useState<OrderReturnSortDirection>("desc");
  const handleOrderSortChange = (key: OrderSortKey) => {
    if (orderSortKey !== key) { setOrderSortKey(key); setOrderSortDirection("desc"); }
    else { setOrderSortDirection((direction) => (direction === "desc" ? "asc" : "desc")); }
  };
  const [activeTab, setActiveTab] = useState<BacktestPageTab>("overview");
  const saveMutation = trpc.sentiment.saveBacktestRun.useMutation({
    onSuccess: (data) => {
      toast.success(`回测已保存（记录 #${data.id}）`);
      void historyQuery.refetch();
    },
    onError: (error) => toast.error(`保存失败：${error.message}`),
  });
  const historyQuery = trpc.sentiment.listBacktestRuns.useQuery({ limit: 50 });
  const update = <K extends keyof typeof config>(key: K, value: (typeof config)[K]) => setConfig((current) => ({ ...current, [key]: value }));
  const [presets, setPresets] = useState<Array<{ name: string; config: Partial<typeof config> }>>(() => {
    try { return JSON.parse(localStorage.getItem("backtest_param_presets") ?? "[]") as Array<{ name: string; config: Partial<typeof config> }>; } catch { return []; }
  });
  const [presetName, setPresetName] = useState("");
  const [activePreset, setActivePreset] = useState("");
  const persistPresets = (next: Array<{ name: string; config: Partial<typeof config> }>) => { setPresets(next); localStorage.setItem("backtest_param_presets", JSON.stringify(next)); };
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    persistPresets([...presets.filter((preset) => preset.name !== name), { name, config }]);
    setPresetName("");
    setActivePreset(name);
    toast.success(`已保存参数预设「${name}」`);
  };
  const loadPreset = (name: string) => {
    setActivePreset(name);
    const preset = presets.find((item) => item.name === name);
    if (preset) { setConfig((current) => ({ ...current, ...preset.config })); toast.success(`已载入参数预设「${name}」`); }
  };
  const deletePreset = () => {
    if (!activePreset) return;
    persistPresets(presets.filter((item) => item.name !== activePreset));
    toast.success(`已删除参数预设「${activePreset}」`);
    setActivePreset("");
  };
  const input = useMemo(() => ({
    observationDays: 1 as const,
    realistic: {
      initialCapital: config.initialCapital, maxPositions: config.maxPositions, commissionRate: config.commissionBps / 10000, stampDutyRate: config.stampDutyBps / 10000, transferFeeRate: config.transferFeeBps / 10000, slippageBps: config.slippageBps,
      blockLimitUpBuys: config.blockLimitUpBuys, blockLimitDownSells: config.blockLimitDownSells, enableOneWordLimitDownProbability: config.enableOneWordLimitDownProbability, oneWordLimitDownSellProbability: config.oneWordLimitDownSellProbability,
      blockOneWordLimitUpBuys: config.blockOneWordLimitUpBuys, enableIntradayStopLoss: config.enableIntradayStopLoss, detectExRights: config.detectExRights, maxPositionAmountRatio: config.maxPositionAmountPercent / 100,
      positionSizingStrategy: config.positionSizingStrategy, fixedPositionPercent: config.fixedPositionPercent, minimumExpectedOpenChangePercent: config.minimumExpectedOpenChangePercent,
      expectationTierEnabled: config.expectationTierEnabled, expectationTable: config.expectationTable,
      trailingProfitActivationPercent: config.trailingProfitActivationPercent, trailingDrawdownPercent: config.trailingDrawdownPercent, stopLossPercent: config.stopLossPercent, strongHoldMinReturn: config.strongHoldMinReturn, maxHoldingDays: config.maxHoldingDays,
    },
    downsideRisk: {
      observationDays: config.downsideObservationDays, mediumDownsidePercent: config.mediumDownsidePercent, highDownsidePercent: config.highDownsidePercent, penaltyWeight: config.riskPenaltyWeight, autoTunePenaltyWeight: config.autoTunePenaltyWeight, hardRiskThreshold: config.hardRiskThreshold,
      rollingTrainTradingDays: config.rollingTrainTradingDays, rollingValidationTradingDays: config.rollingValidationTradingDays,
    },
  }), [config]);
  const { data, isLoading, isFetching, refetch } = trpc.sentiment.getLeaderCandidateBacktest.useQuery(input, { staleTime: 5 * 60_000 });
  const [costSensitivityOn, setCostSensitivityOn] = useState(false);
  const costSensitivityQuery = trpc.sentiment.runCostSensitivity.useQuery({ options: input }, { enabled: costSensitivityOn });
  const costSensitivity = costSensitivityQuery.data;
  const simulation = data?.realisticSimulation;
  const downsideRiskResearch = data?.downsideRiskResearch;
  const dailyPriceCoverage = data?.dailyPriceCoverage;
  const marketFactorCoverage = data?.marketFactorCoverage;
  const strategyPortfolioSnapshot = data?.strategyPortfolioSnapshot;
  const selectedStrategyPortfolio = strategyPortfolioSnapshot?.strategies.find((strategy) => strategy.key === portfolioStrategy) ?? strategyPortfolioSnapshot?.strategies[0];
  const walkForwardRiskPenalty = downsideRiskResearch?.walkForward?.experiments.find((experiment) => experiment.key === "riskPenalty");
  const walkForwardBaseline = downsideRiskResearch?.walkForward?.experiments.find((experiment) => experiment.key === "baseline");
  const fullCycleExperiments = downsideRiskResearch?.fullCycle.experiments ?? [];
  const strategyRobustness = downsideRiskResearch?.strategyRobustness ?? [];
  const riskPenaltyAttribution = downsideRiskResearch?.fullCycle.riskPenaltyAttribution;
  const factorAblations = downsideRiskResearch?.factorAblations ?? [];
  const factorEvaluation = data?.factorEvaluation;
  const factorCombination = data?.factorCombination;
  const overfittingGuard = data?.overfittingGuard;
  const finalVerdict = data?.finalVerdict;
  const factorPhaseOrder = useMemo(() => {
    const preferred = ["冰点试错", "修复上升", "上升发酵", "高位分歧", "高位亢奋", "高位退潮"];
    const present = new Set(factorEvaluation?.phaseStability.flatMap((item) => item.phases.map((phase) => phase.phase)) ?? []);
    return preferred.filter((phase) => present.has(phase));
  }, [factorEvaluation]);
  const yearBuckets = useMemo(() => Array.from(new Set(factorEvaluation?.yearlyIc.flatMap((item) => item.buckets.map((bucket) => bucket.bucket)) ?? [])).sort(), [factorEvaluation]);
  const quarterBuckets = useMemo(() => Array.from(new Set(factorEvaluation?.quarterlyIc.flatMap((item) => item.buckets.map((bucket) => bucket.bucket)) ?? [])).sort(), [factorEvaluation]);
  const fullCycleTradeDifferences = downsideRiskResearch?.fullCycle.tradeDifferences ?? [];
  const fullCycleOrdersByStrategy = useMemo(() => {
    const sortOrders = (items: SimulatedOrder[]) => [...items].sort((left, right) => right.signalDate.localeCompare(left.signalDate) || left.stockCode.localeCompare(right.stockCode));
    const ordersByStrategy = new Map<OrderStrategyKey, SimulatedOrder[]>();
    for (const key of ["baseline", "riskPenalty", "hardFilter", "qualityBlend", "qualityGate"] as const) {
      ordersByStrategy.set(key, fullCycleExperiments.find((experiment) => experiment.key === key)?.realisticSimulation.trades ?? []);
    }
    const hardFilterOrders = ordersByStrategy.get("hardFilter") ?? [];
    const hardFilterOrderKeys = new Set(hardFilterOrders.map((order) => `${order.signalDate}::${order.stockCode}`));
    const excludedOrders: SimulatedOrder[] = fullCycleTradeDifferences
      .filter((row) => row.hardFilterExcluded && !hardFilterOrderKeys.has(`${row.signalDate}::${row.stockCode}`))
      .map((row) => ({
        signalDate: row.signalDate,
        entryDate: null,
        exitDate: null,
        stockCode: row.stockCode,
        stockName: row.stockName,
        score: row.hardFilter?.score ?? row.baseline?.score ?? row.riskPenalty?.score ?? 0,
        shares: 0,
        entryPrice: null,
        exitPrice: null,
        netReturn: null,
        pnlToEquityRatio: null,
        entryPointPremium: null,
        status: "skipped",
        reason: `风险分 ${row.riskScore} 达到硬过滤阈值，未进入模拟`,
        highRiskExcluded: true,
      }));
    ordersByStrategy.set("hardFilter", sortOrders([...hardFilterOrders, ...excludedOrders]));
    const qualityGateOrders = ordersByStrategy.get("qualityGate") ?? [];
    const qualityGateOrderKeys = new Set(qualityGateOrders.map((order) => `${order.signalDate}::${order.stockCode}`));
    const qualityGateExcludedOrders: SimulatedOrder[] = fullCycleTradeDifferences
      .filter((row) => row.qualityGateExcluded && !qualityGateOrderKeys.has(`${row.signalDate}::${row.stockCode}`))
      .map((row) => ({
        signalDate: row.signalDate,
        entryDate: null,
        exitDate: null,
        stockCode: row.stockCode,
        stockName: row.stockName,
        score: row.qualityBlend?.score ?? row.baseline?.score ?? 0,
        shares: 0,
        entryPrice: null,
        exitPrice: null,
        netReturn: null,
        pnlToEquityRatio: null,
        entryPointPremium: null,
        status: "skipped",
        reason: `未通过同日质量中位数或风险阈值门控，未进入模拟`,
        exclusionLabel: "质量门控剔除",
      }));
    ordersByStrategy.set("qualityGate", sortOrders([...qualityGateOrders, ...qualityGateExcludedOrders]));
    ordersByStrategy.set("baseline", sortOrders(ordersByStrategy.get("baseline") ?? []));
    ordersByStrategy.set("riskPenalty", sortOrders(ordersByStrategy.get("riskPenalty") ?? []));
    ordersByStrategy.set("qualityBlend", sortOrders(ordersByStrategy.get("qualityBlend") ?? []));
    return ordersByStrategy;
  }, [fullCycleExperiments, fullCycleTradeDifferences]);
  const orders = fullCycleOrdersByStrategy.get(orderStrategy) ?? (orderStrategy === "baseline" ? simulation?.trades ?? [] : []);
  const activeOrderStrategy = orderStrategyOptions.find((item) => item.key === orderStrategy)!;
  const reasons = useMemo(() => Array.from(new Set(orders.map((order) => order.reason).filter((value): value is string => Boolean(value)))).sort(), [orders]);
  const filteredOrders = useMemo(() => {
    const search = keyword.trim().toLowerCase();
    return orders.filter((order) => (orderStatus === "all" || order.status === orderStatus) && (reason === "all" || order.reason === reason) && (!search || `${order.stockCode} ${order.stockName}`.toLowerCase().includes(search)));
  }, [keyword, orderStatus, orders, reason]);
  const displayedOrders = useMemo(() => sortOrdersByKey(filteredOrders, orderSortKey, orderSortDirection), [filteredOrders, orderSortKey, orderSortDirection]);
  const buildCurve = (items: Array<{ key: string; realisticSimulation: { equityCurve: Array<{ date: string; equity: number }>; initialCapital: number } }>, startDate?: string | null) => {
    const dates = Array.from(new Set(items.flatMap((item) => item.realisticSimulation.equityCurve.map((point) => point.date)))).sort().filter((date) => !startDate || date >= startDate);
    return dates.map((date) => {
      const point: Record<string, string | number> = { date: date.slice(5) };
      for (const item of items) {
        const equity = item.realisticSimulation.equityCurve.find((curvePoint) => curvePoint.date === date)?.equity;
        if (equity !== undefined) point[item.key] = Number((((equity / item.realisticSimulation.initialCapital) - 1) * 100).toFixed(2));
      }
      return point;
    });
  };
  const downsideRiskCurve = useMemo(() => buildCurve((downsideRiskResearch?.experiments ?? []).map((item) => ({ key: item.key, realisticSimulation: item.realisticSimulation }))), [downsideRiskResearch]);
  const fullCycleRiskCurve = useMemo(() => buildCurve(fullCycleExperiments.map((item) => ({ key: item.key, realisticSimulation: item.realisticSimulation })), downsideRiskResearch?.fullCycle.startDate), [downsideRiskResearch?.fullCycle.startDate, fullCycleExperiments]);
  const displayedTradeDifferences = useMemo(() => {
    const search = tradeDiffKeyword.trim().toLowerCase();
    const signature = (trade: TradeDiffSnapshot | null) => trade ? [trade.status, trade.score, trade.shares, trade.entryDate, trade.exitDate, trade.entryPrice, trade.exitPrice, trade.netReturn, trade.reason].join("|") : "";
    return fullCycleTradeDifferences.filter((row) => {
      const hasDifference = row.hardFilterExcluded || row.qualityGateExcluded || new Set([signature(row.baseline), signature(row.riskPenalty), signature(row.hardFilter), signature(row.qualityBlend), signature(row.qualityGate)]).size > 1;
      const matchesSearch = !search || `${row.stockCode} ${row.stockName} ${row.signalDate}`.toLowerCase().includes(search);
      return matchesSearch && (!tradeDiffOnly || hasDifference);
    });
  }, [fullCycleTradeDifferences, tradeDiffKeyword, tradeDiffOnly]);
  const sortedFactorAblations = useMemo(() => [...factorAblations].sort((left, right) => left.walkForward.drawdownDelta - right.walkForward.drawdownDelta || right.walkForward.returnDelta - left.walkForward.returnDelta), [factorAblations]);
  const stableNegativeFactors = useMemo(() => factorAblations.filter((factor) => factor.fullCycle.returnDelta > 0 && factor.fullCycle.drawdownDelta < 0 && factor.walkForward.returnDelta > 0 && factor.walkForward.drawdownDelta < 0), [factorAblations]);
  const fullCycleOnlyNegativeFactors = useMemo(() => factorAblations.filter((factor) => factor.fullCycle.returnDelta > 0 && factor.fullCycle.drawdownDelta < 0 && !(factor.walkForward.returnDelta > 0 && factor.walkForward.drawdownDelta < 0)), [factorAblations]);
  const rollingWindows = downsideRiskResearch?.rollingWindows ?? [];
  const rollingRiskStability = useMemo(() => {
    if (rollingWindows.length === 0) return null;
    const distribution = new Map<number, number>();
    let positiveRiskPenaltyWindows = 0;
    let outperformingWindows = 0;
    for (const window of rollingWindows) {
      distribution.set(window.autoTunedPenaltyWeight, (distribution.get(window.autoTunedPenaltyWeight) ?? 0) + 1);
      const baseline = window.experiments.find((experiment) => experiment.key === "baseline")?.realisticSimulation;
      const riskPenalty = window.experiments.find((experiment) => experiment.key === "riskPenalty")?.realisticSimulation;
      if (riskPenalty && riskPenalty.totalReturn > 0) positiveRiskPenaltyWindows += 1;
      if (baseline && riskPenalty && riskPenalty.totalReturn > baseline.totalReturn && riskPenalty.maxDrawdown <= baseline.maxDrawdown) outperformingWindows += 1;
    }
    return { positiveRiskPenaltyWindows, outperformingWindows, distribution: Array.from(distribution.entries()).sort(([left], [right]) => left - right).map(([weight, count]) => `${weight}×${count}`).join("、") };
  }, [rollingWindows]);

  return <main className="pb-12 text-slate-900">
    <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sky-700">
              <BarChart3 className="h-5 w-5" />
              <span className="text-xs font-bold tracking-[0.18em]">PORTFOLIO BACKTEST</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">组合回测</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">以候选信号为基础，模拟T+1开盘买入及实际交易日出清。唯一退出口径为动态止盈、开盘止损与强势续持；所有判断仅使用当日及之前可见的信息。</p>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-right">
              <p className="text-xs text-sky-700">当前候选口径</p>
              <p className="mt-1 font-semibold text-sky-900">全连板 · T+1开盘入场</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-2" onClick={() => saveMutation.mutate(input)} disabled={saveMutation.isPending || !data}><Save className={`h-4 w-4 ${saveMutation.isPending ? "animate-pulse" : ""}`} />保存回测</Button>
              <Button size="sm" variant="outline" className="gap-2" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />刷新回测</Button>
            </div>
          </div>
        </div>
      </section>
      <nav className="mt-3 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="tablist" aria-label="回测页签导航">
        {pageTabs.map((tab) => (
          <Button key={tab.key} type="button" size="sm" variant={activeTab === tab.key ? "default" : "ghost"} role="tab" aria-selected={activeTab === tab.key} onClick={() => setActiveTab(tab.key)} className={activeTab === tab.key ? "bg-slate-800 text-white hover:bg-slate-700" : "text-slate-600"}>
            {tab.label}
          </Button>
        ))}
      </nav>
    </div>
    {activeTab === "overview" && downsideRiskResearch?.fullCycle && <section data-full-cycle-comparison className="mx-auto max-w-7xl px-4 pt-5 sm:px-6"><div className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start gap-3"><BarChart3 className="mt-0.5 h-5 w-5 text-violet-700" /><div className="mr-auto"><p className="text-xs font-bold tracking-[0.16em] text-violet-700">FULL-CYCLE COMPARISON</p><h2 className="mt-1 font-semibold">全周期五策略收益对比</h2><p className="mt-1 max-w-4xl text-xs leading-5 text-slate-600">{downsideRiskResearch.fullCycle.definition} 覆盖信号日 {downsideRiskResearch.fullCycle.startDate ?? "-"} 至 {downsideRiskResearch.fullCycle.endDate ?? "-"}。</p></div></div><ReturnLineChart data={fullCycleRiskCurve} series={fullCycleExperiments.map((item) => ({ key: item.key, label: item.label, color: strategyColors[item.key as OrderStrategyKey] }))} /><div data-trade-difference-table className="mt-6 rounded-xl border border-violet-100"><div className="flex flex-wrap items-end gap-3 border-b border-violet-100 bg-violet-50/60 px-4 py-3"><div className="mr-auto"><h3 className="text-sm font-semibold text-violet-950">逐笔交易差异对比</h3><p className="mt-1 text-xs text-violet-800">按相同信号日与股票对齐；每格依次展示状态、评分、买卖日期/价格/股数、收益率和原因。硬过滤与质量门控未进入模拟时单独标记。</p></div><label className="flex items-center gap-2 text-xs font-medium text-violet-900"><input type="checkbox" checked={tradeDiffOnly} onChange={(event) => setTradeDiffOnly(event.target.checked)} />仅看有差异订单</label><label className="text-xs text-slate-600">搜索<Input value={tradeDiffKeyword} onChange={(event) => setTradeDiffKeyword(event.target.value)} placeholder="代码、名称或日期" className="mt-1 h-8 w-40 bg-white" /></label></div><div className="overflow-auto"><table className="w-full min-w-[2140px] text-xs"><thead className="bg-white text-left text-slate-500"><tr><th className="px-3 py-2">信号日 / 股票</th><th className="px-3 py-2">风险分 / 扣分权重</th><th className="px-3 py-2">原始评分基准</th><th className="px-3 py-2">风险扣分策略</th><th className="px-3 py-2">高风险硬过滤</th><th className="px-3 py-2">质量复合评分</th><th className="px-3 py-2">质量门控策略</th></tr></thead><tbody>{displayedTradeDifferences.map((row) => <tr key={`${row.signalDate}-${row.stockCode}`} className="border-t border-slate-100 align-top"><td className="px-3 py-3"><p className="font-medium text-slate-800">{row.stockName}</p><p className="mt-1 font-mono text-slate-500">{row.stockCode}</p><p className="mt-1 text-slate-500">{row.signalDate}</p></td><td className="px-3 py-3"><p className="font-semibold text-fuchsia-800">风险 {row.riskScore}</p><p className="mt-1 text-slate-500">权重 {row.appliedPenaltyWeight}</p></td><td className="px-3 py-3"><TradeDiffCell trade={row.baseline} /></td><td className="px-3 py-3"><TradeDiffCell trade={row.riskPenalty} /></td><td className="px-3 py-3"><TradeDiffCell trade={row.hardFilter} filtered={row.hardFilterExcluded} /></td><td className="px-3 py-3"><TradeDiffCell trade={row.qualityBlend} /></td><td className="px-3 py-3"><TradeDiffCell trade={row.qualityGate} filtered={row.qualityGateExcluded} /></td></tr>)}</tbody></table>{displayedTradeDifferences.length === 0 && <p className="p-6 text-center text-sm text-slate-500">没有符合当前筛选条件的订单。</p>}</div></div></div></section>}
    {activeTab === "compare" && downsideRiskResearch?.walkForward && <section data-walk-forward className="mx-auto max-w-7xl px-4 pt-5 sm:px-6"><div className="rounded-2xl border border-fuchsia-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start gap-3"><DatabaseZap className="mt-0.5 h-5 w-5 text-fuchsia-700" /><div className="mr-auto"><h2 className="font-semibold">样本外累计拼接曲线</h2><p className="mt-1 max-w-4xl text-xs leading-5 text-slate-600">{downsideRiskResearch.walkForward.definition} 覆盖 {downsideRiskResearch.walkForward.validationWindowCount} 个连续验证窗口（{downsideRiskResearch.walkForward.startDate ?? "-"} 至 {downsideRiskResearch.walkForward.endDate ?? "-"}）。</p></div></div><ReturnLineChart data={downsideRiskResearch.walkForward.equityCurve.map((point) => ({ date: point.date.slice(5), ...(point.baseline === null ? {} : { baseline: point.baseline }), ...(point.riskPenalty === null ? {} : { riskPenalty: point.riskPenalty }), ...(point.hardFilter === null ? {} : { hardFilter: point.hardFilter }), ...(point.qualityBlend === null ? {} : { qualityBlend: point.qualityBlend }), ...(point.qualityGate === null ? {} : { qualityGate: point.qualityGate }) }))} series={downsideRiskResearch.walkForward.experiments.map((item) => ({ key: item.key, label: item.label, color: strategyColors[item.key as OrderStrategyKey] }))} /></div></section>}
    {activeTab === "compare" && rollingRiskStability && <section data-ten-window-stability className="mx-auto max-w-7xl px-4 pt-5 sm:px-6"><div className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><BarChart3 className="mt-0.5 h-5 w-5 text-indigo-700" /><div><p className="text-xs font-bold tracking-[0.16em] text-indigo-700">GENERALIZATION CHECK</p><h2 className="mt-1 font-semibold">{rollingWindows.length}窗口样本外泛化稳定性</h2><p className="mt-1 text-xs leading-5 text-slate-600">每个窗口均只由其前置训练期选权；“相对优胜”要求风险扣分策略在该窗口同时实现更高收益与不更高的最大回撤。</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="风险扣分正收益窗口" value={`${rollingRiskStability.positiveRiskPenaltyWindows} / ${rollingWindows.length}`} tone="text-rose-600" /><Metric label="相对原始优胜窗口" value={`${rollingRiskStability.outperformingWindows} / ${rollingWindows.length}`} tone="text-indigo-700" /><Metric label="训练期选中权重分布" value={rollingRiskStability.distribution} /></div></div></section>}
    {activeTab === "compare" && riskPenaltyAttribution && <section data-risk-penalty-attribution className="mx-auto max-w-7xl px-4 pt-5 sm:px-6"><div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start gap-3"><ShieldAlert className="mt-0.5 h-5 w-5 text-amber-700" /><div className="mr-auto"><p className="text-xs font-bold tracking-[0.16em] text-amber-700">PERFORMANCE ATTRIBUTION</p><h2 className="mt-1 font-semibold">风险扣分策略表现归因</h2><p className="mt-1 max-w-4xl text-xs leading-5 text-slate-600">风险扣分不直接降低仓位，而会重排同日候选优先级；在最大持仓和现金约束下，资金会由原始策略已成交的股票转向其他候选。因此，全周期收益差异主要来自订单替换，而非共同持仓的买卖规则不同。</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="原始独有成交" value={`${riskPenaltyAttribution.baselineOnlyFilledCount} 笔 / ¥${formatMoney(riskPenaltyAttribution.baselineOnlyNetPnl)}`} tone={riskPenaltyAttribution.baselineOnlyNetPnl >= 0 ? "text-rose-600" : "text-emerald-700"} /><Metric label="扣分独有成交" value={`${riskPenaltyAttribution.riskPenaltyOnlyFilledCount} 笔 / ¥${formatMoney(riskPenaltyAttribution.riskPenaltyOnlyNetPnl)}`} tone={riskPenaltyAttribution.riskPenaltyOnlyNetPnl >= 0 ? "text-rose-600" : "text-emerald-700"} /><Metric label="共同成交 / 收益差异" value={`${riskPenaltyAttribution.commonFilledCount} / ${riskPenaltyAttribution.commonFilledDifferentReturnCount} 笔`} /><Metric label="自动 / 回退权重信号" value={`${riskPenaltyAttribution.autoTunedSignalCount} / ${riskPenaltyAttribution.fallbackWeightSignalCount}`} /></div><p className="mt-4 text-xs leading-5 text-slate-600">本次全周期内，扣分独有订单的净利润若低于原始独有订单，风险扣分版就会同时拖累累计收益和资金高点后的回撤。严格样本外验证则应以滚动拼接结果为准：原始 {walkForwardBaseline?.totalReturn ?? "-"}% / 回撤 {walkForwardBaseline?.maxDrawdown ?? "-"}%，风险扣分 {walkForwardRiskPenalty?.totalReturn ?? "-"}% / 回撤 {walkForwardRiskPenalty?.maxDrawdown ?? "-"}%。</p></div></section>}
    {activeTab === "risk" && factorAblations.length > 0 && <section data-factor-ablation className="mx-auto max-w-7xl px-4 pt-5 sm:px-6"><div className="rounded-2xl border border-cyan-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><DatabaseZap className="mt-0.5 h-5 w-5 text-cyan-700" /><div><p className="text-xs font-bold tracking-[0.16em] text-cyan-700">FACTOR ABLATION</p><h2 className="mt-1 font-semibold">风险评分负向因子消融</h2><p className="mt-1 max-w-5xl text-xs leading-5 text-slate-600">每次仅移除一项信号日风险贡献，固定保留当前自动/回退扣分权重、候选范围、资金、成本和唯一退出策略，不重新用未来结果调权。Δ收益为“移除该因子”相对完整风险扣分策略的变化；Δ回撤为正代表移除后回撤更大，负代表回撤更小。判断核心负向因子须以样本外同时满足收益改善且回撤下降为准。</p></div></div><div className={`mt-4 rounded-xl border p-3 text-xs leading-5 ${stableNegativeFactors.length > 0 ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>{stableNegativeFactors.length > 0 ? <>已在全周期及样本外一致复现的核心负向因子：<b>{stableNegativeFactors.map((factor) => factor.label).join("、")}</b>。这些因子可进入下一轮训练期权重再标定候选。</> : <>当前没有在全周期与严格样本外同时复现的核心负向因子。{fullCycleOnlyNegativeFactors.length > 0 && <>连板高度、日线成交额等仅呈现<strong>全周期表象负向</strong>，但移除后样本外收益下降且回撤上升，因此暂不应降低或删除其权重。</>}</>}</div><div className="mt-4 overflow-auto rounded-xl border border-cyan-100"><table className="w-full min-w-[1180px] text-xs"><thead className="bg-cyan-50 text-left text-cyan-900"><tr><th className="px-3 py-2">风险因子</th><th className="px-3 py-2">受影响信号 / 平均扣分</th><th className="px-3 py-2">全周期 Δ收益</th><th className="px-3 py-2">全周期 Δ回撤</th><th className="px-3 py-2">样本外 Δ收益</th><th className="px-3 py-2">样本外 Δ回撤</th><th className="px-3 py-2">结论</th></tr></thead><tbody>{sortedFactorAblations.map((factor) => { const fullCycleImproves = factor.fullCycle.returnDelta > 0 && factor.fullCycle.drawdownDelta < 0; const outOfSampleImproves = factor.walkForward.returnDelta > 0 && factor.walkForward.drawdownDelta < 0; const verdict = fullCycleImproves && outOfSampleImproves ? "负向因子已在样本外复现" : fullCycleImproves ? "全周期表象负向，样本外未复现" : outOfSampleImproves ? "样本外待复核负向" : factor.affectedSignalCount === 0 ? "当前样本未触发" : "未见稳定负向证据"; return <tr key={factor.key} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-800">{factor.label}</td><td className="px-3 py-2">{factor.affectedSignalCount} / {factor.averageContribution}</td><td className={`px-3 py-2 font-medium ${factor.fullCycle.returnDelta >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{factor.fullCycle.returnDelta >= 0 ? "+" : ""}{factor.fullCycle.returnDelta}%</td><td className={`px-3 py-2 font-medium ${factor.fullCycle.drawdownDelta <= 0 ? "text-rose-600" : "text-emerald-700"}`}>{factor.fullCycle.drawdownDelta >= 0 ? "+" : ""}{factor.fullCycle.drawdownDelta}%</td><td className={`px-3 py-2 font-medium ${factor.walkForward.returnDelta >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{factor.walkForward.returnDelta >= 0 ? "+" : ""}{factor.walkForward.returnDelta}%</td><td className={`px-3 py-2 font-medium ${factor.walkForward.drawdownDelta <= 0 ? "text-rose-600" : "text-emerald-700"}`}>{factor.walkForward.drawdownDelta >= 0 ? "+" : ""}{factor.walkForward.drawdownDelta}%</td><td className="px-3 py-2 text-slate-600">{verdict}</td></tr>; })}</tbody></table></div></div></section>}
    {activeTab === "risk" && factorEvaluation && <section data-factor-effectiveness className="mx-auto max-w-7xl px-4 pt-5 sm:px-6"><div className="rounded-2xl border border-teal-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><BarChart3 className="mt-0.5 h-5 w-5 text-teal-700" /><div><p className="text-xs font-bold tracking-[0.16em] text-teal-700">FACTOR EFFECTIVENESS</p><h2 className="mt-1 font-semibold">技术面因子有效性三件套</h2><p className="mt-1 max-w-5xl text-xs leading-5 text-slate-600">{factorEvaluation.definition}</p></div></div><div className="mt-5"><h3 className="text-sm font-semibold text-slate-800">RankIC + IC_IR（方向与有效性分开判定，|IR|≥0.3 较强 / &lt;0.1 无明显）</h3><div className="mt-2 overflow-auto rounded-xl border border-teal-100"><table className="w-full min-w-[1000px] text-xs"><thead className="bg-teal-50 text-left text-teal-900"><tr><th className="px-3 py-2">因子</th><th className="px-3 py-2">样本数</th><th className="px-3 py-2">日截面数</th><th className="px-3 py-2">均值 IC</th><th className="px-3 py-2">方向</th><th className="px-3 py-2">IC_IR</th><th className="px-3 py-2">IC&gt;0 占比</th><th className="px-3 py-2">HAC t</th><th className="px-3 py-2">p 值</th><th className="px-3 py-2">结论</th></tr></thead><tbody>{factorEvaluation.rankIc.map((item) => <tr key={item.factorKey} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-800">{item.label}</td><td className="px-3 py-2">{item.sampleSize}</td><td className="px-3 py-2">{item.dailyIcCount}</td><td className="px-3 py-2 font-medium">{item.meanIc === null ? "-" : item.meanIc.toFixed(3)}</td><td className="px-3 py-2">{item.direction === null ? "-" : item.direction === "positive" ? <span className="font-medium text-rose-600">正</span> : <span className="font-medium text-emerald-700">负</span>}</td><td className="px-3 py-2 font-medium">{item.icIr === null ? "-" : item.icIr.toFixed(3)}</td><td className="px-3 py-2">{item.positiveIcRatio === null ? "-" : `${(item.positiveIcRatio * 100).toFixed(0)}%`}</td><td className="px-3 py-2">{item.icHacTStat === null ? "-" : item.icHacTStat.toFixed(2)}</td><td className="px-3 py-2">{item.pValue === null ? "-" : item.pValue < 0.05 ? <span className="font-medium text-teal-700">{item.pValue.toFixed(3)}</span> : item.pValue.toFixed(3)}</td><td className="px-3 py-2">{item.strength === null ? "样本不足" : item.strength === "strong" ? <span className="font-medium text-teal-700">较强</span> : item.strength === "moderate" ? <span className="font-medium text-teal-600">一般</span> : item.strength === "weak" ? <span className="font-medium text-amber-700">弱</span> : <span className="font-medium text-slate-500">无明显</span>}</td></tr>)}</tbody></table></div></div><div className="mt-5"><h3 className="text-sm font-semibold text-slate-800">分位数五分组分析（Q1→Q5，含形态识别与多空差）</h3><div className="mt-2 grid gap-3 sm:grid-cols-2">{factorEvaluation.quintiles.map((item) => <div key={item.factorKey} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">{item.label}</p><span className="rounded bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">{({ monotonic_increasing: "单调递增", monotonic_decreasing: "单调递减", inverted_u: "倒U/中间有效", u_shape: "U型/两端有效", threshold: "阈值型", none: "无明显结构" } as Record<string, string>)[item.shape ?? ""] ?? "样本不足"}</span></div><div className="mt-2 flex gap-1">{item.buckets.map((bucket) => <div key={bucket.quintile} className="flex-1 rounded bg-white px-1 py-1.5 text-center"><p className="text-[10px] text-slate-500">Q{bucket.quintile}</p><p className="text-xs font-medium text-slate-800">{bucket.averageForwardReturn === null ? "-" : `${bucket.averageForwardReturn.toFixed(2)}%`}</p><p className="text-[10px] text-slate-500">中位{bucket.medianForwardReturn === null ? "-" : `${bucket.medianForwardReturn.toFixed(2)}%`}</p><p className="text-[10px] text-slate-400">胜率{bucket.positiveReturnRate === null ? "-" : `${(bucket.positiveReturnRate * 100).toFixed(0)}%`}·S{bucket.sharpe === null ? "-" : bucket.sharpe.toFixed(2)}</p></div>)}</div>{item.spread !== null && <p className="mt-2 text-[10px] text-slate-500">Q5−Q1 多空差 <span className={item.spread >= 0 ? "font-medium text-rose-600" : "font-medium text-emerald-700"}>{item.spread.toFixed(2)}%</span></p>}</div>)}</div></div>{factorPhaseOrder.length > 0 && <div className="mt-5"><h3 className="text-sm font-semibold text-slate-800">情绪阶段 IC 方向一致性</h3><div className="mt-2 overflow-auto rounded-xl border border-teal-100"><table className="w-full min-w-[680px] text-xs"><thead className="bg-teal-50 text-left text-teal-900"><tr><th className="px-3 py-2">因子</th>{factorPhaseOrder.map((phase) => <th key={phase} className="px-3 py-2">{phase}</th>)}<th className="px-3 py-2">方向一致</th></tr></thead><tbody>{factorEvaluation.phaseStability.map((item) => <tr key={item.factorKey} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-800">{item.label}</td>{factorPhaseOrder.map((phase) => { const entry = item.phases.find((p) => p.phase === phase); return <td key={phase} className="px-3 py-2">{entry === undefined || entry.meanIc === null ? "-" : <span title={`ICIR=${entry.icIr ?? "-"} · HAC t=${entry.icTStat ?? "-"} · 日截面=${entry.dailyIcCount}`}>{entry.meanIc.toFixed(3)}{entry.icIr !== null ? <span className="ml-1 text-[10px] text-slate-400">({entry.icIr.toFixed(2)})</span> : null}</span>}</td>; })}<td className="px-3 py-2">{item.directionConsistent === null ? "样本不足" : item.directionConsistent ? "一致" : "分化"}</td></tr>)}</tbody></table></div></div>}<div className="mt-5"><h3 className="text-sm font-semibold text-slate-800">预测能力衰减（1~2 日持有期）</h3><p className="mt-1 text-xs text-slate-500">覆盖数据模型已预计算的 T+1/T+2 前向收益；更长持有期（5/10/20/30 日）需补充前向收益计算后再评估。|IC| 快速衰减为短线因子，持续为正且不反转为中线有效。</p><div className="mt-2 overflow-auto rounded-xl border border-teal-100"><table className="w-full min-w-[680px] text-xs"><thead className="bg-teal-50 text-left text-teal-900"><tr><th className="px-3 py-2">因子</th>{factorEvaluation.icDecay[0]?.points.map((point) => <th key={point.horizon} className="px-3 py-2">{point.horizon}</th>)}<th className="px-3 py-2">衰减判定</th></tr></thead><tbody>{factorEvaluation.icDecay.map((item) => { const valid = item.points.map((point) => point.meanIc).filter((value): value is number => value !== null); const first = valid[0]; const last = valid[valid.length - 1]; const reversed = first !== undefined && last !== undefined && first !== 0 && last !== 0 && Math.sign(first) !== Math.sign(last); const fastDecay = !reversed && first !== undefined && last !== undefined && Math.abs(last) < Math.abs(first) * 0.5; return <tr key={item.factorKey} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-800">{item.label}</td>{item.points.map((point) => <td key={point.horizon} className="px-3 py-2">{point.meanIc === null ? "-" : point.meanIc.toFixed(3)}</td>)}<td className="px-3 py-2">{valid.length < 2 ? "样本不足" : reversed ? <span className="font-medium text-amber-700">方向反转</span> : fastDecay ? <span className="font-medium text-orange-600">快速衰减</span> : <span className="font-medium text-teal-700">较稳定</span>}</td></tr>; })}</tbody></table></div></div>{yearBuckets.length > 0 && <div className="mt-5"><h3 className="text-sm font-semibold text-slate-800">年度 / 季度 IC（切片稳定性）</h3><p className="mt-1 text-xs text-slate-500">判断因子是否只在特定时间段有效；样本不足的切片显示为“-”。</p><div className="mt-2 grid gap-3 lg:grid-cols-2"><div className="overflow-auto rounded-xl border border-teal-100"><p className="border-b border-teal-100 bg-teal-50/60 px-3 py-2 text-xs font-semibold text-teal-900">年度 IC</p><table className="w-full text-xs"><thead className="bg-teal-50 text-left text-teal-900"><tr><th className="px-3 py-2">因子</th>{yearBuckets.map((bucket) => <th key={bucket} className="px-3 py-2">{bucket}</th>)}</tr></thead><tbody>{factorEvaluation.yearlyIc.map((item) => <tr key={item.factorKey} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-800">{item.label}</td>{yearBuckets.map((bucket) => { const entry = item.buckets.find((b) => b.bucket === bucket); return <td key={bucket} className="px-3 py-2">{entry === undefined || entry.meanIc === null ? "-" : entry.meanIc.toFixed(3)}</td>; })}</tr>)}</tbody></table></div><div className="overflow-auto rounded-xl border border-teal-100"><p className="border-b border-teal-100 bg-teal-50/60 px-3 py-2 text-xs font-semibold text-teal-900">季度 IC</p><table className="w-full text-xs"><thead className="bg-teal-50 text-left text-teal-900"><tr><th className="px-3 py-2">因子</th>{quarterBuckets.map((bucket) => <th key={bucket} className="px-3 py-2">{bucket}</th>)}</tr></thead><tbody>{factorEvaluation.quarterlyIc.map((item) => <tr key={item.factorKey} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-800">{item.label}</td>{quarterBuckets.map((bucket) => { const entry = item.buckets.find((b) => b.bucket === bucket); return <td key={bucket} className="px-3 py-2">{entry === undefined || entry.meanIc === null ? "-" : entry.meanIc.toFixed(3)}</td>; })}</tr>)}</tbody></table></div></div></div>}</div></section>}
    {activeTab === "risk" && factorCombination && <section data-factor-combination className="mx-auto max-w-7xl px-4 pt-5 sm:px-6"><div className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><DatabaseZap className="mt-0.5 h-5 w-5 text-sky-700" /><div><p className="text-xs font-bold tracking-[0.16em] text-sky-700">FACTOR COMBINATION</p><h2 className="mt-1 font-semibold">因子相关性去重与中性化</h2><p className="mt-1 max-w-5xl text-xs leading-5 text-slate-600">因子间 Pearson 相关（|ρ|≥0.7 视为冗余，应合并或留优）；技术因子已做 z-score 标准化并对流通市值评分线性中性化，供后续组合评分使用。</p></div></div><div className={`mt-4 rounded-xl border p-3 text-xs leading-5 ${factorCombination.highlyCorrelatedPairs.length > 0 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>{factorCombination.highlyCorrelatedPairs.length > 0 ? <>高度相关因子对（冗余）：{factorCombination.highlyCorrelatedPairs.map((pair) => `${factorCombination.labels[pair.left]}-${factorCombination.labels[pair.right]}(ρ=${pair.correlation.toFixed(2)})`).join("、")}。</> : <>未发现 |ρ|≥0.7 的冗余因子对。</>}</div><div className="mt-3 text-xs leading-5 text-slate-600">贪心去重建议：保留 <b className="text-slate-800">{factorCombination.deduplicatedKeys.map((key) => factorCombination.labels[key]).join("、")}</b>{factorCombination.removedKeys.length > 0 && <>；建议合并/移除 <b className="text-amber-700">{factorCombination.removedKeys.map((key) => factorCombination.labels[key]).join("、")}</b></>}。</div><div className="mt-4 overflow-auto rounded-xl border border-sky-100"><table className="w-full min-w-[720px] text-xs"><thead className="bg-sky-50 text-left text-sky-900"><tr><th className="px-3 py-2">因子 \ 因子</th>{factorCombination.correlationMatrix.keys.map((key) => <th key={key} className="px-3 py-2">{factorCombination.labels[key]}</th>)}</tr></thead><tbody>{factorCombination.correlationMatrix.keys.map((rowKey, i) => <tr key={rowKey} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-800">{factorCombination.labels[rowKey]}</td>{factorCombination.correlationMatrix.keys.map((colKey, j) => { const value = factorCombination.correlationMatrix.matrix[i]![j]; const high = value !== null && Math.abs(value) >= 0.7 && i !== j; return <td key={colKey} className={`px-3 py-2 ${high ? "bg-amber-100 font-medium text-amber-900" : "text-slate-600"}`}>{value === null ? "-" : value.toFixed(2)}</td>; })}</tr>)}</tbody></table></div><div className="mt-4 rounded-xl border border-sky-100 p-3"><p className="text-xs font-semibold text-sky-900">因子独立性（VIF · 有效因子数量）</p><div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-600"><span>有效因子数量 <b className="text-slate-800">{factorCombination.effectiveNumber ?? "-"}</b> / {factorCombination.keys.length}</span></div><div className="mt-2 overflow-auto"><table className="w-full text-xs"><thead className="text-left text-slate-500"><tr><th className="px-2 py-1">因子</th>{factorCombination.keys.map((key) => <th key={key} className="px-2 py-1">{factorCombination.labels[key]}</th>)}</tr></thead><tbody><tr className="text-slate-700"><td className="px-2 py-1 font-medium">VIF</td>{factorCombination.keys.map((key) => { const vif = factorCombination.vif[key]; return <td key={key} className={`px-2 py-1 ${vif !== null && vif >= 5 ? "font-medium text-amber-700" : ""}`}>{vif === null ? "-" : vif.toFixed(1)}</td>; })}</tr></tbody></table></div><p className="mt-1 text-[11px] text-slate-400">VIF &gt; 5 提示多重共线性；有效因子数量越接近因子总数，信息越独立。</p></div><div className="mt-4 rounded-xl border border-sky-100 p-3"><p className="text-xs font-semibold text-sky-900">语义簇信息重复</p><div className="mt-2 flex flex-wrap gap-2">{factorCombination.clusters.map((cluster) => <span key={cluster.cluster} className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${cluster.redundant ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{cluster.cluster}：{cluster.keys.map((key) => factorCombination.labels[key]).join("、")}{cluster.maxAbsCorrelation !== null ? `（簇内|ρ|max=${cluster.maxAbsCorrelation}）` : ""}</span>)}</div></div><div className="mt-4 rounded-xl border border-sky-100 p-3"><p className="text-xs font-semibold text-sky-900">市值中性化前后预测 IC（Raw vs Neutralized）</p><p className="mt-1 text-[11px] text-slate-400">判断因子是自身有效还是市值代理：中性化后 |IC| 大幅下降说明预测力主要来自市值。（in-sample 诊断，不用于样本外选股）</p><div className="mt-2 overflow-auto"><table className="w-full text-xs"><thead className="bg-sky-50 text-left text-sky-900"><tr><th className="px-3 py-2">因子</th><th className="px-3 py-2">原始 IC</th><th className="px-3 py-2">中性化 IC</th><th className="px-3 py-2">预测力下降</th></tr></thead><tbody>{factorCombination.neutralizationIc.map((item) => <tr key={item.factorKey} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-800">{item.label}</td><td className="px-3 py-2">{item.rawMeanIc === null ? "-" : item.rawMeanIc.toFixed(3)}</td><td className="px-3 py-2">{item.neutralizedMeanIc === null ? "-" : item.neutralizedMeanIc.toFixed(3)}</td><td className="px-3 py-2">{item.icReduction === null ? "样本不足" : item.icReduction < 0 ? <span className="font-medium text-teal-700">去市值后增强</span> : item.icReduction < 0.2 ? <span className="font-medium text-emerald-700">低（自身有效）</span> : item.icReduction < 0.5 ? <span className="font-medium text-orange-600">中</span> : <span className="font-medium text-amber-700">高（市值代理）</span>}</td></tr>)}</tbody></table></div></div><div className="mt-4 overflow-auto rounded-xl border border-sky-100"><p className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-xs font-semibold text-sky-900">Spearman 秩相关矩阵（对非线性/异常值更稳健）</p><table className="w-full min-w-[720px] text-xs"><thead className="bg-sky-50 text-left text-sky-900"><tr><th className="px-3 py-2">因子 \ 因子</th>{factorCombination.spearmanMatrix.keys.map((key) => <th key={key} className="px-3 py-2">{factorCombination.labels[key]}</th>)}</tr></thead><tbody>{factorCombination.spearmanMatrix.keys.map((rowKey, i) => <tr key={rowKey} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-800">{factorCombination.labels[rowKey]}</td>{factorCombination.spearmanMatrix.keys.map((colKey, j) => { const value = factorCombination.spearmanMatrix.matrix[i]![j]; const high = value !== null && Math.abs(value) >= 0.7 && i !== j; return <td key={colKey} className={`px-3 py-2 ${high ? "bg-amber-100 font-medium text-amber-900" : "text-slate-600"}`}>{value === null ? "-" : value.toFixed(2)}</td>; })}</tr>)}</tbody></table></div></div></section>}
    {activeTab === "risk" && overfittingGuard && <section data-overfitting-guard className="mx-auto max-w-7xl px-4 pt-5 sm:px-6"><div className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 h-5 w-5 text-rose-700" /><div><p className="text-xs font-bold tracking-[0.16em] text-rose-700">OVERFITTING GUARD</p><h2 className="mt-1 font-semibold">过拟合防护 · DSR / PSR / 蒙特卡洛</h2><p className="mt-1 max-w-5xl text-xs leading-5 text-slate-600">{overfittingGuard.definition}</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="真实夏普" value={overfittingGuard.realSharpe === null ? "-" : String(overfittingGuard.realSharpe)} /><Metric label="参数搜索次数" value={`${overfittingGuard.numTrials} 组`} /><Metric label="期望最优夏普 E[SRmax]" value={overfittingGuard.expectedMaximumSharpe === null ? "-" : String(overfittingGuard.expectedMaximumSharpe)} /><Metric label="Deflated Sharpe" value={overfittingGuard.deflatedSharpe === null ? "-" : String(overfittingGuard.deflatedSharpe)} tone={overfittingGuard.deflatedSharpe === null ? "" : overfittingGuard.deflatedSharpe >= 0.95 ? "text-rose-600" : "text-amber-700"} /><Metric label="PSR（夏普显著为正）" value={overfittingGuard.psr === null ? "-" : String(overfittingGuard.psr)} tone={overfittingGuard.psr === null ? "" : overfittingGuard.psr >= 0.95 ? "text-rose-600" : "text-amber-700"} /><Metric label="夏普 95% 置信区间" value={overfittingGuard.bootstrap?.sharpeLower95 === null || overfittingGuard.bootstrap?.sharpeLower95 === undefined ? "-" : `[${overfittingGuard.bootstrap.sharpeLower95}, ${overfittingGuard.bootstrap.sharpeUpper95}]`} /><Metric label="最大回撤 P95（自助）" value={overfittingGuard.bootstrap?.maxDrawdownP95 === null || overfittingGuard.bootstrap?.maxDrawdownP95 === undefined ? "-" : `${overfittingGuard.bootstrap.maxDrawdownP95}%`} /><Metric label="破产概率（回撤≥30%）" value={overfittingGuard.bootstrap?.ruinProbability === null || overfittingGuard.bootstrap?.ruinProbability === undefined ? "-" : `${(overfittingGuard.bootstrap.ruinProbability * 100).toFixed(1)}%`} tone={overfittingGuard.bootstrap?.ruinProbability !== null && overfittingGuard.bootstrap?.ruinProbability !== undefined && overfittingGuard.bootstrap.ruinProbability >= 0.2 ? "text-amber-700" : "text-rose-600"} /></div><div className="mt-4 rounded-xl border border-rose-100 p-3"><div className="flex flex-wrap items-center gap-3"><p className="mr-auto text-xs font-semibold text-rose-900">交易成本敏感性</p><Button size="sm" variant="outline" className="h-7" onClick={() => setCostSensitivityOn(true)} disabled={costSensitivityQuery.isFetching}>{costSensitivityQuery.isFetching ? "回测中…" : "运行成本敏感性"}</Button></div>{costSensitivity && <div className="mt-2 overflow-auto"><table className="w-full text-xs"><thead className="bg-rose-50 text-left text-rose-900"><tr><th className="px-3 py-2">成本倍数</th><th className="px-3 py-2">总收益</th><th className="px-3 py-2">夏普</th><th className="px-3 py-2">成交笔数</th></tr></thead><tbody>{costSensitivity.points.map((point) => <tr key={point.costMultiplier} className="border-t border-slate-100"><td className="px-3 py-2">{point.costMultiplier}×</td><td className={`px-3 py-2 font-medium ${point.totalReturn >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{point.totalReturn.toFixed(2)}%</td><td className="px-3 py-2">{point.sharpe === null ? "-" : point.sharpe}</td><td className="px-3 py-2">{point.tradeCount}</td></tr>)}</tbody></table></div>}{costSensitivity && <p className="mt-1 text-[11px] leading-4 text-slate-400">{costSensitivity.definition}</p>}</div>{overfittingGuard.deflatedSharpe !== null && <p className={`mt-3 rounded-lg px-3 py-2 text-xs leading-5 ${overfittingGuard.deflatedSharpe >= 0.95 ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{overfittingGuard.deflatedSharpe >= 0.95 ? "DSR ≥ 0.95：样本外表现在多次参数搜索校正后仍可信。" : "DSR < 0.95：最优夏普可能来自多次搜索的偶然性，存在过拟合风险，需谨慎外推。"}</p>}</div></section>}
    {activeTab === "risk" && finalVerdict && <section data-final-verdict className="mx-auto max-w-7xl px-4 pt-5 sm:px-6"><div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700" /><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">FINAL VERDICT</p><h2 className="mt-1 font-semibold">因子与策略最终结论</h2><p className="mt-1 max-w-5xl text-xs leading-5 text-slate-600">{finalVerdict.definition}</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="策略质量分" value={`${finalVerdict.strategyQuality.score}/100 · ${finalVerdict.strategyQuality.label}`} /><Metric label="过拟合风险分" value={`${finalVerdict.overfittingRisk.score}/100 · ${finalVerdict.overfittingRisk.label}`} tone={finalVerdict.overfittingRisk.label === "Low" ? "text-emerald-700" : finalVerdict.overfittingRisk.label === "Medium" ? "text-amber-700" : "text-rose-600"} /><Metric label="强 / 中 / 弱 / 无效因子" value={`${finalVerdict.gradeSummary.Strong} / ${finalVerdict.gradeSummary.Medium} / ${finalVerdict.gradeSummary.Weak} / ${finalVerdict.gradeSummary.Invalid}`} /></div><div className="mt-4 overflow-auto rounded-xl border border-emerald-100"><table className="w-full min-w-[860px] text-xs"><thead className="bg-emerald-50 text-left text-emerald-900"><tr><th className="px-3 py-2">因子</th><th className="px-3 py-2">预测力</th><th className="px-3 py-2">显著性</th><th className="px-3 py-2">结构</th><th className="px-3 py-2">稳定性</th><th className="px-3 py-2">独立性</th><th className="px-3 py-2">中性化</th><th className="px-3 py-2">衰减</th><th className="px-3 py-2">综合分</th><th className="px-3 py-2">评级</th><th className="px-3 py-2">过拟合风险</th></tr></thead><tbody>{finalVerdict.factorVerdicts.map((verdict) => <tr key={verdict.factorKey} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-800">{verdict.label}</td><td className="px-3 py-2">{Math.round(verdict.subScores.predictivePower * 100)}</td><td className="px-3 py-2">{Math.round(verdict.subScores.significance * 100)}</td><td className="px-3 py-2">{Math.round(verdict.subScores.structure * 100)}</td><td className="px-3 py-2">{Math.round(verdict.subScores.stability * 100)}</td><td className="px-3 py-2">{Math.round(verdict.subScores.independence * 100)}</td><td className="px-3 py-2">{Math.round(verdict.subScores.neutralization * 100)}</td><td className="px-3 py-2">{Math.round(verdict.subScores.decay * 100)}</td><td className="px-3 py-2 font-medium">{verdict.finalScore}</td><td className="px-3 py-2">{verdict.grade === "Strong" ? <span className="font-medium text-emerald-700">Strong</span> : verdict.grade === "Medium" ? <span className="font-medium text-teal-700">Medium</span> : verdict.grade === "Weak" ? <span className="font-medium text-amber-700">Weak</span> : <span className="font-medium text-slate-400">Invalid</span>}</td><td className="px-3 py-2">{verdict.overfittingRisk === "Low" ? <span className="text-emerald-700">Low</span> : verdict.overfittingRisk === "Medium" ? <span className="text-amber-700">Medium</span> : <span className="text-rose-600">High</span>}</td></tr>)}</tbody></table></div><p className="mt-3 text-[11px] leading-4 text-slate-400">{finalVerdict.strategyQuality.definition} {finalVerdict.overfittingRisk.definition}</p></div></section>}
    <div className="mx-auto max-w-7xl space-y-5 px-4 pt-5 sm:px-6">

      {activeTab === "params" && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex flex-wrap items-center gap-2"><WalletCards className="h-5 w-5 text-violet-700" /><div className="mr-auto"><h2 className="font-semibold">回测参数</h2><p className="text-xs text-slate-500">修改参数后自动重新计算；成交金额仍受整手、资金和最大持仓限制。</p></div><div className="flex flex-wrap items-center gap-2"><Input placeholder="预设名称" value={presetName} onChange={(event) => setPresetName(event.target.value)} className="h-8 w-32" /><Button size="sm" variant="outline" className="h-8" onClick={savePreset} disabled={!presetName.trim()}>保存预设</Button><select value={activePreset} onChange={(event) => loadPreset(event.target.value)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"><option value="">载入预设…</option>{presets.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}</select>{activePreset && <Button size="sm" variant="ghost" className="h-8" onClick={deletePreset}>删除</Button>}</div></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <label className="text-xs text-slate-600">初始资金<input type="number" min="1000" step="1000" value={config.initialCapital} onChange={(event) => update("initialCapital", Number(event.target.value) || 0)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2" /></label><label className="text-xs text-slate-600">最大持仓数<input type="number" min="1" max="100" value={config.maxPositions} onChange={(event) => update("maxPositions", Number(event.target.value) || 1)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2" /></label><label className="text-xs text-slate-600">佣金(bps)<input type="number" min="0" step="0.1" value={config.commissionBps} onChange={(event) => update("commissionBps", Number(event.target.value) || 0)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2" /></label><label className="text-xs text-slate-600">印花税(bps)<input type="number" min="0" step="0.1" value={config.stampDutyBps} onChange={(event) => update("stampDutyBps", Number(event.target.value) || 0)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2" /></label><label className="text-xs text-slate-600">过户费(bps)<input type="number" min="0" step="0.1" value={config.transferFeeBps} onChange={(event) => update("transferFeeBps", Number(event.target.value) || 0)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2" /></label><label className="text-xs text-slate-600">双边滑点(bps)<input type="number" min="0" step="1" value={config.slippageBps} onChange={(event) => update("slippageBps", Number(event.target.value) || 0)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2" /></label>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3"><div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3"><p className="text-xs font-semibold text-sky-900">T+1开盘预期过滤</p><p className="mt-1 text-xs text-sky-700">相对信号日收盘严格低于阈值时不买入。</p><label className="mt-2 block text-xs text-slate-600">最低开盘涨幅(%)<input type="number" min="-50" max="100" step="0.5" value={config.minimumExpectedOpenChangePercent} onChange={(event) => update("minimumExpectedOpenChangePercent", Math.min(100, Math.max(-50, Number(event.target.value) || 0)))} className="mt-1 h-8 w-28 rounded-md border border-slate-200 bg-white px-2" /></label></div><div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3"><p className="text-xs font-semibold text-violet-900">分仓策略</p><p className="mt-1 text-xs text-violet-700">等权、评分加权或固定单笔比例。</p><select value={config.positionSizingStrategy} onChange={(event) => update("positionSizingStrategy", event.target.value === "scoreWeighted" ? "scoreWeighted" : event.target.value === "fixedPercent" ? "fixedPercent" : "equal")} className="mt-2 h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"><option value="equal">等权分仓</option><option value="scoreWeighted">评分加权</option><option value="fixedPercent">固定单笔比例</option></select><label className="ml-2 text-xs text-slate-600">比例<input type="number" min="1" max="100" disabled={config.positionSizingStrategy !== "fixedPercent"} value={config.fixedPositionPercent} onChange={(event) => update("fixedPositionPercent", Math.min(100, Math.max(1, Number(event.target.value) || 1)))} className="ml-1 h-8 w-16 rounded-md border border-slate-200 bg-white px-2 disabled:bg-slate-100" />%</label></div><div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3"><p className="text-xs font-semibold text-amber-900">成交限制</p><label className="mt-2 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={config.blockLimitUpBuys} onChange={(event) => update("blockLimitUpBuys", event.target.checked)} />限制涨停追买</label><label className="mt-2 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={config.blockLimitDownSells} onChange={(event) => update("blockLimitDownSells", event.target.checked)} />限制一字跌停卖出</label><label className="mt-2 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" disabled={!config.blockLimitDownSells} checked={config.enableOneWordLimitDownProbability} onChange={(event) => update("enableOneWordLimitDownProbability", event.target.checked)} />启用概率成交</label><label className="mt-2 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={config.blockOneWordLimitUpBuys} onChange={(event) => update("blockOneWordLimitUpBuys", event.target.checked)} />限制一字涨停追买</label><label className="mt-2 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={config.enableIntradayStopLoss} onChange={(event) => update("enableIntradayStopLoss", event.target.checked)} />盘中止损（用最低价）</label><label className="mt-2 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={config.detectExRights} onChange={(event) => update("detectExRights", event.target.checked)} />标记除权除息跳空</label><label className="mt-2 flex items-center gap-2 text-xs text-slate-600">单笔成交额上限<input type="number" min="0" max="100" step="0.5" value={config.maxPositionAmountPercent} onChange={(event) => update("maxPositionAmountPercent", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} className="ml-1 h-7 w-16 rounded-md border border-slate-200 bg-white px-1" />%（0=不限）</label></div></div>
        <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3"><div className="flex flex-wrap items-end gap-3"><div className="mr-auto"><p className="text-xs font-semibold text-amber-900">一字跌停保守成交概率</p><p className="mt-1 text-xs text-amber-700">仅在“限制一字跌停卖出”和“启用概率成交”均开启时生效；未成交仓位会在后续实际交易日继续尝试出清。</p></div><label className="text-xs text-slate-600">卖出成交概率(%)<input type="number" min="0" max="100" step="1" disabled={!config.blockLimitDownSells || !config.enableOneWordLimitDownProbability} value={config.oneWordLimitDownSellProbability} onChange={(event) => update("oneWordLimitDownSellProbability", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-28 rounded-md border border-slate-200 bg-white px-2 disabled:bg-slate-100" /></label></div></div>
        <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50/50 p-3"><div className="flex flex-wrap items-end gap-3"><div className="mr-auto"><p className="text-xs font-semibold text-rose-900">唯一退出策略：动态止盈、止损与强势续持</p><p className="mt-1 text-xs text-rose-700">从T+2起：开盘触发止损即按开盘出清；收盘达到启动浮盈后从持仓期最高收盘价回撤则止盈；未启动止盈时仅满足强势续持条件才继续持有。</p></div><label className="text-xs text-slate-600">启动浮盈<input type="number" value={config.trailingProfitActivationPercent} onChange={(event) => update("trailingProfitActivationPercent", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">回撤阈值<input type="number" value={config.trailingDrawdownPercent} onChange={(event) => update("trailingDrawdownPercent", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">止损<input type="number" value={config.stopLossPercent} onChange={(event) => update("stopLossPercent", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">续持阈值<input type="number" value={config.strongHoldMinReturn} onChange={(event) => update("strongHoldMinReturn", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">最多持有日<input type="number" min="2" max="30" value={config.maxHoldingDays} onChange={(event) => update("maxHoldingDays", Math.min(30, Math.max(2, Math.floor(Number(event.target.value) || 2))))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label></div></div>
        <div className="mt-3 rounded-xl border border-fuchsia-100 bg-fuchsia-50/50 p-3"><div className="flex flex-wrap items-end gap-3"><div className="mr-auto"><p className="text-xs font-semibold text-fuchsia-900">下行风险研究参数</p><p className="mt-1 max-w-3xl text-xs text-fuchsia-800">原始、风险扣分和高风险过滤三版实验共享上方唯一退出策略；风险分只读取信号日字段，T+1开盘后的低价路径仅用于事后标签。自动寻优仅在训练窗口比较预设权重网格，选中权重只进入紧随其后的验证窗口。默认45日训练、14日验证，按当前行情覆盖形成10个连续无重叠样本外窗口。</p></div><label className="flex items-center gap-2 self-center text-xs font-medium text-fuchsia-900"><input type="checkbox" checked={config.autoTunePenaltyWeight} onChange={(event) => update("autoTunePenaltyWeight", event.target.checked)} />自动寻优</label><label className="text-xs text-slate-600">观察日<input type="number" min="2" max="10" value={config.downsideObservationDays} onChange={(event) => update("downsideObservationDays", Math.min(10, Math.max(2, Math.floor(Number(event.target.value) || 2))))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">中档下行<input type="number" min="1" max="50" value={config.mediumDownsidePercent} onChange={(event) => update("mediumDownsidePercent", Math.min(50, Math.max(1, Number(event.target.value) || 1)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">高档下行<input type="number" min="1" max="50" value={config.highDownsidePercent} onChange={(event) => update("highDownsidePercent", Math.max(config.mediumDownsidePercent, Math.min(50, Number(event.target.value) || config.mediumDownsidePercent)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">手动回退权重<input type="number" min="0" max="1" step="0.05" disabled={config.autoTunePenaltyWeight} value={config.riskPenaltyWeight} onChange={(event) => update("riskPenaltyWeight", Math.min(1, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-24 rounded-md border border-slate-200 bg-white px-2 disabled:bg-slate-100" /></label><label className="text-xs text-slate-600">硬过滤分<input type="number" min="0" max="100" value={config.hardRiskThreshold} onChange={(event) => update("hardRiskThreshold", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">训练窗口<input type="number" min="30" max="150" value={config.rollingTrainTradingDays} onChange={(event) => update("rollingTrainTradingDays", Math.min(150, Math.max(30, Math.floor(Number(event.target.value) || 30))))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label><label className="text-xs text-slate-600">验证窗口<input type="number" min="10" max="60" value={config.rollingValidationTradingDays} onChange={(event) => update("rollingValidationTradingDays", Math.min(60, Math.max(10, Math.floor(Number(event.target.value) || 10))))} className="mt-1 block h-8 w-20 rounded-md border border-slate-200 bg-white px-2" /></label></div></div>
      </section>}
      {activeTab === "params" && <OpenExpectationParamsCard enabled={config.expectationTierEnabled} table={config.expectationTable} onEnabledChange={(value) => update("expectationTierEnabled", value)} onTableChange={(next) => update("expectationTable", next)} />}
      {activeTab === "history" && <HistorySection />}
      {isLoading || !simulation ? <div className="flex min-h-72 items-center justify-center rounded-2xl border border-slate-200 bg-white"><Loader2 className="h-7 w-7 animate-spin text-sky-600" /></div> : <>
        {activeTab === "overview" && downsideRiskResearch && <StrategyEvaluationSection fullCycleExperiments={fullCycleExperiments} walkForwardExperiments={downsideRiskResearch.walkForward?.experiments ?? []} strategyRobustness={strategyRobustness} windowCount={downsideRiskResearch.walkForward?.validationWindowCount ?? 0} />}
        {activeTab === "risk" && downsideRiskResearch && marketFactorCoverage && <section data-market-factor-coverage className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start gap-3"><DatabaseZap className="mt-0.5 h-5 w-5 text-sky-700" /><div className="mr-auto"><p className="text-xs font-bold tracking-[0.16em] text-sky-700">MARKET FACTOR COVERAGE</p><h2 className="mt-1 font-semibold">市场因子数据覆盖</h2><p className="mt-1 max-w-4xl text-xs leading-5 text-slate-600">市场数据采集自候选信号日：项目涨停数来自已录入的全表记录，沪深成交额来自 Tushare daily 聚合，两融余额来自上交所与深交所公开汇总文件。这些市场级字段在信号日内对所有候选一致、不改变个股相对排序，已移出个股风险扣分，仅保留数据覆盖观察。</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric label="回测信号日" value={`${marketFactorCoverage.signalDateCount} 日`} /><Metric label="项目涨停数覆盖" value={`${marketFactorCoverage.limitUpCountDateCount} / ${marketFactorCoverage.signalDateCount}`} /><Metric label="已验证市场数据" value={`${marketFactorCoverage.verifiedMarketDataDateCount} / ${marketFactorCoverage.signalDateCount}`} tone="text-sky-700" /><Metric label="沪深成交额覆盖" value={`${marketFactorCoverage.turnoverDateCount} / ${marketFactorCoverage.signalDateCount}`} /><Metric label="两融余额覆盖" value={`${marketFactorCoverage.marginBalanceDateCount} / ${marketFactorCoverage.signalDateCount}`} /></div><p className="mt-3 text-xs leading-5 text-slate-500">覆盖日期：{marketFactorCoverage.startDate ?? "-"} 至 {marketFactorCoverage.endDate ?? "-"}。</p></section>}
        {activeTab === "risk" && downsideRiskResearch && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start gap-3"><ShieldAlert className="mt-0.5 h-5 w-5 text-fuchsia-700" /><div className="mr-auto"><h2 className="font-semibold">下行风险评分实验框架</h2><p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">{downsideRiskResearch.definition} 当前展示 {downsideRiskResearch.labeledSampleSize} 个完整观察期的样本外候选；原始、风险扣分和高风险过滤三版均使用唯一的动态止盈、开盘止损与强势续持退出策略。</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="日线覆盖" value={`${dailyPriceCoverage?.rowCount ?? 0} 行`} /><Metric label="日期范围" value={`${dailyPriceCoverage?.startDate ?? "-"} 至 ${dailyPriceCoverage?.endDate ?? "-"}`} /><Metric label="低价覆盖" value={`${dailyPriceCoverage?.lowPriceCount ?? 0} / ${dailyPriceCoverage?.rowCount ?? 0}`} /><Metric label="成交额覆盖" value={`${dailyPriceCoverage?.amountCount ?? 0} / ${dailyPriceCoverage?.rowCount ?? 0}`} /></div><p className="mt-3 text-xs leading-5 text-slate-500">低价标签完整样本 {downsideRiskResearch.lowPriceLabelSampleSize} 个；信号日成交额可用样本 {downsideRiskResearch.signalAmountSampleSize} 个。{downsideRiskResearch.autoTunePenaltyWeight && <span className="font-medium text-fuchsia-800"> 自动寻优网格：{downsideRiskResearch.penaltyWeightGrid.join("、")}；训练目标 = 收益率 − 0.5 × 最大回撤，依次以收益、回撤、已出清笔数和更小权重决胜。</span>}{downsideRiskResearch.labeledSampleSize < 50 && <span className="font-medium text-amber-700"> 当前完整观察期样本少于50个，仅适合观察特征方向。</span>}</p><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{downsideRiskResearch.featureMatrix.map((feature) => <div key={feature.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">{feature.label}</p><span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{feature.timing}</span></div><p className="mt-1 text-xs leading-5 text-slate-500">{feature.definition}</p></div>)}</div><div className="mt-5 overflow-auto rounded-xl border border-slate-200"><table className="w-full min-w-[720px] text-xs"><thead className="bg-slate-100 text-left text-slate-500"><tr><th className="px-3 py-2">风险分层</th><th className="px-3 py-2">样本数</th><th className="px-3 py-2">平均最大不利波动</th><th className="px-3 py-2">≤ -{downsideRiskResearch.mediumDownsidePercent}%</th><th className="px-3 py-2">≤ -{downsideRiskResearch.highDownsidePercent}%</th></tr></thead><tbody>{downsideRiskResearch.riskTiers.map((tier) => <tr key={tier.tier} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-800">{tier.tier}</td><td className="px-3 py-2">{tier.sampleSize}</td><td className="px-3 py-2 text-emerald-700">{tier.averageMaxAdverseReturn ?? "-"}{tier.averageMaxAdverseReturn === null ? "" : "%"}</td><td className="px-3 py-2">{tier.mediumDownsideCount} / {tier.mediumDownsideRate ?? "-"}%</td><td className="px-3 py-2">{tier.highDownsideCount} / {tier.highDownsideRate ?? "-"}%</td></tr>)}</tbody></table></div><div className="mt-5 grid gap-3 md:grid-cols-3">{downsideRiskResearch.experiments.map((experiment) => <div key={experiment.key} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">{experiment.label}</p><p className="mt-1 min-h-10 text-xs leading-5 text-slate-500">{experiment.description}</p></div><span className={experiment.realisticSimulation.totalReturn >= 0 ? "text-sm font-bold text-rose-600" : "text-sm font-bold text-emerald-700"}>{experiment.realisticSimulation.totalReturn}%</span></div><div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-200 pt-3 text-xs"><div><p className="text-slate-400">最大回撤</p><p className="mt-1 font-semibold text-emerald-700">{experiment.realisticSimulation.maxDrawdown}%</p></div><div><p className="text-slate-400">候选/剔除</p><p className="mt-1 font-semibold text-slate-700">{experiment.inputCandidateCount}/{experiment.excludedCandidateCount}</p></div><div><p className="text-slate-400">胜率</p><p className="mt-1 font-semibold text-slate-700">{experiment.realisticSimulation.winRate ?? "-"}%</p></div></div></div>)}</div><ReturnLineChart data={downsideRiskCurve} series={downsideRiskResearch.experiments.map((item) => ({ key: item.key, label: item.label, color: item.key === "baseline" ? "#64748b" : item.key === "riskPenalty" ? "#d946ef" : "#f59e0b" }))} /><div className="mt-5 rounded-xl border border-slate-200"><div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2"><DatabaseZap className="h-4 w-4 text-fuchsia-700" /><div><p className="text-sm font-semibold">滚动样本外窗口</p><p className="text-xs text-slate-500">每一行均以前置{downsideRiskResearch.rollingTrainTradingDays}个交易日校准、后续{downsideRiskResearch.rollingValidationTradingDays}个交易日验证；自动寻优只用校准期结果，不将验证期路径反向用于选权。</p></div></div><div className="overflow-auto"><table className="w-full min-w-[1360px] text-xs"><thead className="bg-white text-left text-slate-500"><tr><th className="px-3 py-2">窗口</th><th className="px-3 py-2">训练期</th><th className="px-3 py-2">验证期</th><th className="px-3 py-2">训练样本</th><th className="px-3 py-2">选出权重</th><th className="px-3 py-2">训练目标</th><th className="px-3 py-2">训练收益/回撤</th><th className="px-3 py-2">验证标签</th><th className="px-3 py-2">原始收益</th><th className="px-3 py-2">扣分收益</th><th className="px-3 py-2">过滤收益</th></tr></thead><tbody>{downsideRiskResearch.rollingWindows.map((window) => { const byKey = new Map(window.experiments.map((item) => [item.key, item])); return <tr key={window.index} className="border-t border-slate-100"><td className="px-3 py-2">{window.index}</td><td className="px-3 py-2">{window.calibrationStartDate} 至 {window.calibrationEndDate}</td><td className="px-3 py-2">{window.validationStartDate} 至 {window.validationEndDate}</td><td className="px-3 py-2">{window.trainingSampleSize}</td><td className="px-3 py-2 font-semibold text-fuchsia-800">{window.autoTunedPenaltyWeight}</td><td className="px-3 py-2">{window.trainingObjectiveValue}%</td><td className="px-3 py-2"><span className={window.trainingTotalReturn >= 0 ? "text-rose-600" : "text-emerald-700"}>{window.trainingTotalReturn}%</span> / <span className="text-emerald-700">{window.trainingMaxDrawdown}%</span></td><td className="px-3 py-2 text-emerald-700">{window.labeledSampleSize} / {window.highDownsideRate ?? "-"}%</td>{(["baseline", "riskPenalty", "hardFilter"] as const).map((key) => { const result = byKey.get(key)?.realisticSimulation.totalReturn; return <td key={key} className={`px-3 py-2 font-medium ${result !== undefined && result >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{result ?? "-"}{result === undefined ? "" : "%"}</td>; })}</tr>; })}</tbody></table></div></div></section>}
        {activeTab === "overview" && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700" /><div><h2 className="font-semibold">资金与仓位审计</h2><p className="mt-1 text-sm text-slate-600">峰值持仓 {simulation.peakOpenPositionCount}/{simulation.assumptions.maxPositions}，最低可用现金 ¥{formatMoney(simulation.minimumCash)}。开盘止损释放的资金仅在同一开盘时点后参与候选排序；收盘出清资金不提前复用。</p></div></div></section>}
        {activeTab === "trades" && strategyPortfolioSnapshot && selectedStrategyPortfolio && <section data-strategy-portfolio-snapshot className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 border-b border-sky-100 pb-4"><div className="flex flex-wrap items-start gap-3"><div className="mr-auto"><p className="text-xs font-bold tracking-[0.16em] text-sky-700">SIMULATED PORTFOLIO SNAPSHOT</p><h2 className="mt-1 font-semibold">当前持仓与下一交易日准备买入</h2><p className="mt-1 max-w-4xl text-xs leading-5 text-slate-600">回测截止日 {formatDate(strategyPortfolioSnapshot.asOfDate)}；计划以最新信号日 {formatDate(strategyPortfolioSnapshot.latestSignalDate)} 的已知信息排序，拟于{strategyPortfolioSnapshot.nextEntryTiming}检查条件后执行。</p></div><div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="tablist" aria-label="持仓计划策略切换">{orderStrategyOptions.map((option) => <Button key={option.key} type="button" size="sm" variant={portfolioStrategy === option.key ? "default" : "ghost"} role="tab" aria-selected={portfolioStrategy === option.key} onClick={() => setPortfolioStrategy(option.key)} className={portfolioStrategy === option.key ? "bg-sky-700 text-white hover:bg-sky-800" : "text-slate-600"}>{option.label}</Button>)}</div></div><p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">{strategyPortfolioSnapshot.definition}</p><p className="text-xs font-medium text-amber-900">模拟计划仅用于历史规则验证，不构成交易建议。</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="回测可用现金" value={`¥${formatMoney(selectedStrategyPortfolio.availableCash)}`} tone="text-sky-700" /><Metric label="当前持仓 / 最大持仓" value={`${selectedStrategyPortfolio.openPositionCount} / ${selectedStrategyPortfolio.maxPositions}`} /><Metric label="剩余可开仓位" value={`${selectedStrategyPortfolio.availableSlots} 个`} tone={selectedStrategyPortfolio.availableSlots > 0 ? "text-rose-600" : "text-amber-700"} /><Metric label="准备候选 / 高风险剔除" value={`${selectedStrategyPortfolio.candidateCount} / ${selectedStrategyPortfolio.excludedHighRiskCount}`} /></div><p className="mt-3 text-xs leading-5 text-slate-500">{selectedStrategyPortfolio.note}</p><div className="mt-5 grid gap-5 xl:grid-cols-2"><div className="overflow-hidden rounded-xl border border-slate-200"><div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><h3 className="text-sm font-semibold text-slate-800">当前持仓</h3><p className="mt-1 text-xs text-slate-500">仅展示该策略在回测截止日仍未出清的模拟订单。</p></div><div className="max-h-[26rem] overflow-auto"><table className="w-full min-w-[680px] text-xs"><thead className="sticky top-0 z-10 bg-white text-left text-slate-500"><tr><th className="px-3 py-2">股票 / 题材</th><th className="px-3 py-2">信号 / 买入日</th><th className="px-3 py-2">数量 / 成本</th><th className="px-3 py-2">估值价 / 浮动</th><th className="px-3 py-2">续持说明</th></tr></thead><tbody>{selectedStrategyPortfolio.currentHoldings.map((holding) => <tr key={`${holding.signalDate}-${holding.stockCode}`} className="border-t border-slate-100 align-top"><td className="px-3 py-2"><p className="font-medium text-slate-800">{holding.stockName}</p><p className="mt-1 font-mono text-slate-400">{holding.stockCode}</p><p className="mt-1 text-slate-500">{holding.sector}</p></td><td className="whitespace-nowrap px-3 py-2">{formatDate(holding.signalDate)}<br />{formatDate(holding.entryDate)}</td><td className="whitespace-nowrap px-3 py-2">{holding.shares} 股<br />¥{holding.entryPrice ?? "-"}</td><td className={`whitespace-nowrap px-3 py-2 font-medium ${holding.priceChangePercent !== null && holding.priceChangePercent >= 0 ? "text-rose-600" : "text-emerald-700"}`}>¥{holding.valuationPrice ?? "-"}<br />{holding.priceChangePercent === null ? "估值待补" : `${holding.priceChangePercent}%`}</td><td className="max-w-56 px-3 py-2 leading-5 text-slate-500">{holding.reason ?? "持仓中，等待下一实际交易日按退出规则判断。"}</td></tr>)}</tbody></table>{selectedStrategyPortfolio.currentHoldings.length === 0 && <p className="p-6 text-center text-sm text-slate-500">该策略在回测截止日没有未出清的模拟持仓。</p>}</div></div><div className="overflow-hidden rounded-xl border border-violet-200"><div className="border-b border-violet-100 bg-violet-50/60 px-4 py-3"><h3 className="text-sm font-semibold text-violet-950">下一交易日准备买入</h3><p className="mt-1 text-xs text-violet-800">最多展示剩余可开仓位数量的优先候选；明日开盘价和成交条件未知，不预设成交。</p></div><div className="max-h-[26rem] overflow-auto"><table className="w-full min-w-[680px] text-xs"><thead className="sticky top-0 z-10 bg-white text-left text-slate-500"><tr><th className="px-3 py-2">优先级 / 股票</th><th className="px-3 py-2">题材 / 板数</th><th className="px-3 py-2">原始 / 策略分</th><th className="px-3 py-2">风险</th><th className="px-3 py-2">开盘前置条件</th></tr></thead><tbody>{selectedStrategyPortfolio.preparedBuys.map((plan) => <tr key={`${plan.signalDate}-${plan.stockCode}`} className="border-t border-slate-100 align-top"><td className="px-3 py-2"><p className="font-semibold text-violet-900">#{plan.rank} {plan.stockName}</p><p className="mt-1 font-mono text-slate-400">{plan.stockCode}</p></td><td className="px-3 py-2"><p>{plan.sector}</p><p className="mt-1 text-slate-500">{plan.boards} 板 · {formatDate(plan.signalDate)}</p></td><td className="px-3 py-2"><p>原始 {plan.score}</p><p className="mt-1 font-semibold text-violet-800">策略 {plan.strategyScore}</p></td><td className="px-3 py-2"><p className={plan.riskTier === "高风险" ? "text-rose-600" : plan.riskTier === "中风险" ? "text-amber-700" : "text-emerald-700"}>{plan.riskTier} {plan.riskScore}</p></td><td className="max-w-64 px-3 py-2 leading-5 text-slate-500">{plan.conditions.join("；")}</td></tr>)}</tbody></table>{selectedStrategyPortfolio.preparedBuys.length === 0 && <p className="p-6 text-center text-sm text-slate-500">没有可准备的候选：可能已满仓，或当前策略没有符合条件的候选。</p>}</div></div></div></section>}
        {activeTab === "trades" && <FullOrdersSection
          strategy={orderStrategy}
          onStrategyChange={(strategy) => { setOrderStrategy(strategy); setReason("all"); }}
          activeStrategy={activeOrderStrategy}
          orders={orders}
          displayedOrders={displayedOrders}
          orderStatus={orderStatus}
          onOrderStatusChange={setOrderStatus}
          reason={reason}
          onReasonChange={setReason}
          reasons={reasons}
          keyword={keyword}
          onKeywordChange={setKeyword}
          sortKey={orderSortKey}
          sortDirection={orderSortDirection}
          onSortChange={handleOrderSortChange}
        />}
        {false && <>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex flex-wrap items-end gap-3"><div className="mr-auto"><h2 className="font-semibold">全部模拟订单</h2><p className="mt-1 text-xs text-slate-500">显示 {displayedOrders.length}/{orders.length} 笔；红涨绿跌。</p></div><label className="text-xs text-slate-600">状态<select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value as "all" | "filled" | "skipped")} className="mt-1 block h-8 rounded-md border border-slate-200 px-2"><option value="all">全部</option><option value="filled">已入场</option><option value="skipped">未入场</option></select></label><label className="text-xs text-slate-600">原因<select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 block h-8 max-w-48 rounded-md border border-slate-200 px-2"><option value="all">全部</option>{reasons.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="text-xs text-slate-600">搜索<Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="代码或名称" className="mt-1 h-8 w-36" /></label></div><div className="overflow-auto rounded-lg border border-slate-200"><table className="w-full min-w-[1100px] text-xs"><thead className="bg-slate-100 text-left text-slate-500"><tr><th className="px-3 py-2">信号日</th><th className="px-3 py-2">股票</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">股数</th><th className="px-3 py-2">买入/卖出日</th><th className="px-3 py-2">买入/卖出价</th><th className="px-3 py-2">收益率</th><th className="px-3 py-2">买点涨幅</th><th className="px-3 py-2">原因</th></tr></thead><tbody>{displayedOrders.map((order, index) => { const entryPointPremium = order.entryPointPremium ?? null; return <tr key={`${order.signalDate}-${order.stockCode}-${index}`} className="border-t border-slate-100"><td className="px-3 py-2">{formatDate(order.signalDate)}</td><td className="px-3 py-2"><p className="font-medium">{order.stockName}</p><p className="font-mono text-slate-400">{order.stockCode}</p></td><td className="px-3 py-2">{order.status === "filled" ? "已成交" : "未成交"}</td><td className="px-3 py-2">{order.shares || "-"}</td><td className="px-3 py-2">{formatDate(order.entryDate)} / {formatDate(order.exitDate)}</td><td className="px-3 py-2">{order.entryPrice ?? "-"} / {order.exitPrice ?? "-"}</td><td className={`px-3 py-2 ${order.netReturn !== null && order.netReturn >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{order.netReturn === null ? "-" : `${order.netReturn}%`}</td><td className={`px-3 py-2 ${entryPointPremium !== null && entryPointPremium >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{entryPointPremium === null ? "-" : `${entryPointPremium}%`}</td><td className="max-w-72 px-3 py-2 text-slate-500">{order.reason ?? "-"}</td></tr>; })}</tbody></table></div></section>
        </>}
      </>}
    </div>
  </main>;
}

function HistorySection() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const listQuery = trpc.sentiment.listBacktestRuns.useQuery({ limit: 50 });
  const detailQuery = trpc.sentiment.getBacktestRun.useQuery({ id: selectedId ?? 0 }, { enabled: selectedId !== null });
  const detail = detailQuery.data;
  const runs = listQuery.data ?? [];
  const compareRuns = runs.filter((run) => compareIds.includes(run.id));
  const toggleCompare = (id: number) => setCompareIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const num = (v: unknown, suffix = "") => (v === null || v === undefined ? "-" : `${v}${suffix}`);
  const compareMetrics: Array<{ label: string; value: (s: Record<string, unknown> | null) => string; tone?: (s: Record<string, unknown> | null) => string }> = [
    { label: "观察天数", value: (s) => num(s?.observationDays, " 日") },
    { label: "分数阈值", value: (s) => num(s?.appliedMinScore) },
    { label: "样本 / 成功", value: (s) => `${num(s?.totalSamples)} / ${num(s?.successCount)}` },
    { label: "胜率", value: (s) => num(s?.successRate, "%") },
    { label: "涨停收盘溢价", value: (s) => num(s?.averageClosePremium, "%") },
    { label: "T+1→T+2 收益", value: (s) => num(s?.tPlus1To2AverageReturn, "%") },
    { label: "实盘累计收益", value: (s) => num(s?.realisticTotalReturn, "%"), tone: (s) => { const v = s?.realisticTotalReturn as number | null | undefined; return v === null || v === undefined ? "text-slate-800" : v >= 0 ? "text-rose-600" : "text-emerald-700"; } },
    { label: "实盘最大回撤", value: (s) => num(s?.realisticMaxDrawdown, "%"), tone: () => "text-emerald-700" },
    { label: "实盘胜率", value: (s) => num(s?.realisticWinRate, "%") },
    { label: "实盘交易数", value: (s) => num(s?.realisticTradeCount) },
  ];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto flex items-center gap-2"><History className="h-5 w-5 text-sky-700" /><div><h2 className="font-semibold">历史回测记录</h2><p className="text-xs text-slate-500">勾选多条可并排对比关键指标；点「查看」载入单次完整结果。</p></div></div>
        {compareIds.length > 0 && <Button size="sm" variant="ghost" className="gap-1" onClick={() => setCompareIds([])}>清空选择</Button>}
      </div>
      {listQuery.isLoading ? <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-sky-600" /></div> : runs.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">暂无保存的回测记录。在「回测总览」页运行回测后，点右上角「保存回测」即可留档。</p> : (
        <div className="overflow-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[1020px] text-xs">
            <thead className="bg-slate-100 text-left text-slate-500"><tr><th className="w-8 px-2 py-2"><input type="checkbox" checked={compareIds.length === runs.length && runs.length > 0} onChange={(event) => setCompareIds(event.target.checked ? runs.map((r) => r.id) : [])} aria-label="全选" /></th><th className="px-3 py-2">保存时间</th><th className="px-3 py-2">观察 / 分数阈值</th><th className="px-3 py-2">样本 / 胜率</th><th className="px-3 py-2">涨停溢价</th><th className="px-3 py-2">实盘累计收益</th><th className="px-3 py-2">实盘最大回撤</th><th className="px-3 py-2">操作</th></tr></thead>
            <tbody>
              {runs.map((run) => {
                const s = run.summary as Record<string, unknown> | null;
                const totalReturn = s?.realisticTotalReturn as number | null | undefined;
                const maxDrawdown = s?.realisticMaxDrawdown as number | null | undefined;
                const successRate = s?.successRate as number | null | undefined;
                const checked = compareIds.includes(run.id);
                return (
                  <tr key={run.id} className={`border-t border-slate-100 ${checked ? "bg-sky-50/50" : ""}`}>
                    <td className="px-2 py-2"><input type="checkbox" checked={checked} onChange={() => toggleCompare(run.id)} aria-label={`选择记录 #${run.id}`} /></td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{run.createdAt ? new Date(run.createdAt).toLocaleString("zh-CN", { hour12: false }) : "-"}</td>
                    <td className="px-3 py-2">{String(s?.observationDays ?? "-")}日 / 分{s?.appliedMinScore == null ? "-" : String(s.appliedMinScore)}</td>
                    <td className="px-3 py-2">{String(s?.totalSamples ?? "-")} / {successRate == null ? "-" : `${successRate}%`}</td>
                    <td className="px-3 py-2">{s?.averageClosePremium == null ? "-" : `${s.averageClosePremium}%`}</td>
                    <td className={`px-3 py-2 font-semibold ${totalReturn != null && totalReturn >= 0 ? "text-rose-600" : "text-emerald-700"}`}>{totalReturn == null ? "-" : `${totalReturn}%`}</td>
                    <td className="px-3 py-2 font-semibold text-emerald-700">{maxDrawdown == null ? "-" : `${maxDrawdown}%`}</td>
                    <td className="px-3 py-2"><Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setSelectedId(selectedId === run.id ? null : run.id)}>{selectedId === run.id ? "收起" : "查看"}</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {compareRuns.length >= 2 && (
        <div className="mt-4 overflow-auto rounded-xl border border-violet-200">
          <div className="border-b border-violet-100 bg-violet-50 px-4 py-2"><p className="text-xs font-bold tracking-[0.14em] text-violet-700">MULTI-RUN COMPARISON · 多组并排对比</p></div>
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-white text-left text-slate-500"><tr><th className="px-3 py-2">指标</th>{compareRuns.map((run) => <th key={run.id} className="px-3 py-2 font-semibold text-slate-700">#{run.id}<br /><span className="font-normal text-slate-400">{run.createdAt ? new Date(run.createdAt).toLocaleDateString("zh-CN") : "-"}</span></th>)}</tr></thead>
            <tbody>
              {compareMetrics.map((metric) => (
                <tr key={metric.label} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-600">{metric.label}</td>
                  {compareRuns.map((run) => { const s = run.summary as Record<string, unknown> | null; return <td key={run.id} className={`px-3 py-2 font-medium ${metric.tone?.(s) ?? "text-slate-800"}`}>{metric.value(s)}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectedId !== null && (
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/40 p-4">
          {detailQuery.isLoading ? <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-sky-600" /></div> : !detail ? <p className="text-sm text-slate-500">未找到该记录或结果已损坏。</p> : (
            <div>
              <p className="text-xs font-bold tracking-[0.16em] text-sky-700">RUN #{detail.id} · 保存于 {detail.createdAt ? new Date(detail.createdAt).toLocaleString("zh-CN", { hour12: false }) : "-"}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="样本 / 成功" value={`${detail.result.totalSamples} / ${detail.result.successCount}`} />
                <Metric label="胜率" value={detail.result.successRate == null ? "-" : `${detail.result.successRate}%`} tone={detail.result.successRate != null && detail.result.successRate >= 50 ? "text-rose-600" : "text-emerald-700"} />
                <Metric label="实盘累计收益" value={`${detail.result.realisticSimulation.totalReturn}%`} tone={detail.result.realisticSimulation.totalReturn >= 0 ? "text-rose-600" : "text-emerald-700"} />
                <Metric label="实盘最大回撤" value={`${detail.result.realisticSimulation.maxDrawdown}%`} tone="text-emerald-700" />
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">完整结果已载入内存，可返回「回测总览 / 策略对比 / 风险归因 / 交易明细」页签对照当前参数版本查看差异。</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
