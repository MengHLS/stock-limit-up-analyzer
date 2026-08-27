import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type StrategyKey = "baseline" | "riskPenalty" | "hardFilter" | "qualityBlend" | "qualityGate";
type Evaluation = {
  core: { cagr: number | null; totalReturn: number; maxDrawdown: number; sharpeRatio: number | null; sortinoRatio: number | null; calmarRatio: number | null; ulcerIndex: number | null };
  tradeQuality: { winRate: number | null; profitFactor: number | null; expectancy: number | null; averageWin: number | null; averageLoss: number | null; payoffRatio: number | null; maxConsecutiveLosses: number; tradeCount: number };
  tailRisk: { valueAtRisk95: number | null; conditionalValueAtRisk95: number | null; valueAtRisk99: number | null; conditionalValueAtRisk99: number | null; skewness: number | null; excessKurtosis: number | null; worstDay: number | null; worstTrade: number | null };
  stability: { profitableMonthRate: number | null; profitableYearRate: number | null; latestRollingSharpe: number | null; latestRollingCalmar: number | null; latestRollingCagr: number | null; rollingWindowTradingDays: number; maxDrawdownDurationTradingDays: number | null; longestRecoveryTradingDays: number | null; topFivePositiveDayReturnContribution: number | null };
  tradingRealism: { totalFees: number; modeledOneWaySlippageBps: number; periodTurnoverToInitialCapital: number | null; averageHoldingTradingDays: number | null; averageCapitalUtilization: number | null; averageOpenPositions: number | null; maxOpenPositions: number; averageEntryParticipationBps: number | null; entryParticipationCoverageCount: number };
};
type Experiment = { key: StrategyKey; label: string; strategyEvaluation: Evaluation };
type Robustness = { key: StrategyKey; walkForwardOosSharpe: number | null; walkForwardOosCagr: number | null; sharpeDecayRate: number | null; cagrDecayRate: number | null; parameterStability: { kind: "fixed" | "rollingPenaltyWeight"; distinctValueCount: number; standardDeviation: number | null }; parameterSensitivity: { range: number | null }; marketEnvironments: Array<{ phase: string; completedTradeCount: number; averageTradeReturn: number | null }> };

const strategyColors: Record<StrategyKey, string> = { baseline: "#64748b", riskPenalty: "#d946ef", hardFilter: "#f59e0b", qualityBlend: "#0284c7", qualityGate: "#059669" };
const display = (value: number | null | undefined, suffix = "", digits = 2) => value === null || value === undefined ? "样本不足" : `${Number(value.toFixed(digits))}${suffix}`;
const money = (value: number) => `¥${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)}`;

type MetricRow = { label: string; definition: string; value: (evaluation: Evaluation, key: StrategyKey) => string };

function MetricLabel({ label, definition }: Pick<MetricRow, "label" | "definition">) {
  return <Tooltip><TooltipTrigger asChild><button type="button" className="inline-flex max-w-full items-center gap-1 text-left underline decoration-dotted underline-offset-4 outline-none transition-colors hover:text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2" aria-label={`${label}：查看指标说明`}><span>{label}</span><CircleHelp aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-indigo-500" /></button></TooltipTrigger><TooltipContent side="top" sideOffset={6} className="max-w-72 bg-slate-900 text-slate-50"><p className="leading-5">{definition}</p></TooltipContent></Tooltip>;
}

function MetricLayer({ title, caption, experiments, rows }: { title: string; caption: string; experiments: Experiment[]; rows: MetricRow[] }) {
  return <div className="overflow-auto rounded-xl border border-slate-200"><div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><h3 className="text-sm font-semibold text-slate-900">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{caption}</p></div><table className="w-full min-w-[1080px] text-xs"><thead className="bg-white text-left text-slate-500"><tr><th className="w-52 px-3 py-2">指标</th><th className="min-w-72 px-3 py-2">口径</th>{experiments.map((item) => <th key={item.key} className="min-w-32 px-3 py-2" style={{ color: strategyColors[item.key] }}>{item.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.label} className="border-t border-slate-100 align-top"><td className="px-3 py-2.5 font-semibold text-slate-800"><MetricLabel label={row.label} definition={row.definition} /></td><td className="px-3 py-2.5 leading-5 text-slate-500">{row.definition}</td>{experiments.map((item) => <td key={item.key} className="px-3 py-2.5 font-medium text-slate-700">{row.value(item.strategyEvaluation, item.key)}</td>)}</tr>)}</tbody></table></div>;
}

function RobustnessLayer({ experiments, robustness, windowCount }: { experiments: Experiment[]; robustness: Robustness[]; windowCount: number }) {
  const map = new Map(robustness.map((item) => [item.key, item]));
  const rows: Array<{ label: string; definition: string; value: (item: Robustness | undefined) => string }> = [
    { label: "Walk Forward OOS Sharpe", definition: `严格滚动样本外${windowCount}个连续窗口的夏普比率。`, value: (item) => display(item?.walkForwardOosSharpe, "", 3) },
    { label: "Walk Forward OOS CAGR", definition: "严格样本外连续资金曲线按252交易日年化。", value: (item) => display(item?.walkForwardOosCagr, "%") },
    { label: "IS/OOS 夏普衰减率", definition: "(全周期夏普－OOS夏普)÷|全周期夏普|；负值表示OOS改善。", value: (item) => display(item?.sharpeDecayRate, "%", 1) },
    { label: "IS/OOS CAGR 衰减率", definition: "(全周期CAGR－OOS CAGR)÷|全周期CAGR|；负值表示OOS改善。", value: (item) => display(item?.cagrDecayRate, "%", 1) },
    { label: "参数稳定性", definition: "风险扣分为各滚动训练窗选中权重的取值数与标准差；其余策略为固定预设规则。", value: (item) => !item ? "样本不足" : item.parameterStability.kind === "fixed" ? "固定规则" : `${item.parameterStability.distinctValueCount}种 / σ ${display(item.parameterStability.standardDeviation, "", 3)}` },
    { label: "参数敏感度", definition: "仅风险扣分可计算：全部训练权重网格目标值的极差；固定规则不在样本外寻优。", value: (item) => display(item?.parameterSensitivity.range, "", 4) },
    { label: "不同市场环境表现", definition: "按信号日情绪周期分组，单元格为平均已出清订单收益 / 笔数。", value: (item) => item?.marketEnvironments.length ? item.marketEnvironments.map((env) => `${env.phase} ${display(env.averageTradeReturn, "%")} / ${env.completedTradeCount}`).join("；") : "样本不足" },
  ];
  return <div className="overflow-auto rounded-xl border border-slate-200"><div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><h3 className="text-sm font-semibold text-slate-900">第五层：鲁棒性</h3><p className="mt-1 text-xs leading-5 text-slate-500">将全周期与严格样本外分开比较；固定质量规则不进行同一验证期参数调优。</p></div><table className="w-full min-w-[1080px] text-xs"><thead className="bg-white text-left text-slate-500"><tr><th className="w-52 px-3 py-2">指标</th><th className="min-w-72 px-3 py-2">口径</th>{experiments.map((item) => <th key={item.key} className="min-w-40 px-3 py-2" style={{ color: strategyColors[item.key] }}>{item.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.label} className="border-t border-slate-100 align-top"><td className="px-3 py-2.5 font-semibold text-slate-800"><MetricLabel label={row.label} definition={row.definition} /></td><td className="px-3 py-2.5 leading-5 text-slate-500">{row.definition}</td>{experiments.map((experiment) => <td key={experiment.key} className="px-3 py-2.5 leading-5 text-slate-700">{row.value(map.get(experiment.key))}</td>)}</tr>)}</tbody></table></div>;
}

export function StrategyEvaluationPanel({ fullCycleExperiments, walkForwardExperiments, strategyRobustness, windowCount }: { fullCycleExperiments: Experiment[]; walkForwardExperiments: Experiment[]; strategyRobustness: Robustness[]; windowCount: number }) {
  const [scope, setScope] = useState<"full" | "oos">("full");
  const experiments = scope === "full" ? fullCycleExperiments : walkForwardExperiments;
  const core: MetricRow[] = [
    { label: "CAGR", definition: "连续资金账户按相邻交易日权益、252交易日年化；无风险收益率为0%。", value: (e) => display(e.core.cagr, "%") },
    { label: "Total Return", definition: "回测期末权益相对初始资金的累计收益。", value: (e) => display(e.core.totalReturn, "%") },
    { label: "Max Drawdown", definition: "连续收盘权益从历史峰值到后续谷值的最大跌幅。", value: (e) => display(e.core.maxDrawdown, "%") },
    { label: "Sharpe", definition: "年化收益÷年化总波动；无风险收益率为0%。", value: (e) => display(e.core.sharpeRatio, "", 3) },
    { label: "Sortino", definition: "年化收益÷年化下行波动；仅惩罚负收益日。", value: (e) => display(e.core.sortinoRatio, "", 3) },
    { label: "Calmar", definition: "年化收益÷最大回撤。", value: (e) => display(e.core.calmarRatio, "", 3) },
    { label: "Ulcer Index", definition: "逐日回撤平方均值开方，兼顾回撤深度与持续时间。", value: (e) => display(e.core.ulcerIndex, "%") },
  ];
  const quality: MetricRow[] = [
    { label: "Win Rate", definition: "已出清订单中净收益为正的比例。", value: (e) => display(e.tradeQuality.winRate, "%", 1) },
    { label: "Profit Factor", definition: "全部盈利金额÷全部亏损金额绝对值。", value: (e) => display(e.tradeQuality.profitFactor) },
    { label: "Expectancy", definition: "每笔已出清订单的平均净收益率。", value: (e) => display(e.tradeQuality.expectancy, "%") },
    { label: "Avg Win", definition: "净收益为正的已出清订单平均收益率。", value: (e) => display(e.tradeQuality.averageWin, "%") },
    { label: "Avg Loss", definition: "净收益为负的已出清订单平均收益率。", value: (e) => display(e.tradeQuality.averageLoss, "%") },
    { label: "Payoff Ratio", definition: "平均盈利÷平均亏损绝对值。", value: (e) => display(e.tradeQuality.payoffRatio, "", 3) },
    { label: "Max Consecutive Losses", definition: "按实际出清日排序的最长连续亏损订单数。", value: (e) => `${e.tradeQuality.maxConsecutiveLosses} 笔` },
    { label: "Trade Count", definition: "已出清订单数量；不把未完成估值订单计入交易质量。", value: (e) => `${e.tradeQuality.tradeCount} 笔` },
  ];
  const tail: MetricRow[] = [
    { label: "VaR 95%", definition: "历史相邻交易日权益收益的5%分位数；显示单日收益率。", value: (e) => display(e.tailRisk.valueAtRisk95, "%") },
    { label: "CVaR 95%", definition: "不高于VaR 95%的历史日收益均值。", value: (e) => display(e.tailRisk.conditionalValueAtRisk95, "%") },
    { label: "VaR 99%", definition: "历史相邻交易日权益收益的1%分位数；显示单日收益率。", value: (e) => display(e.tailRisk.valueAtRisk99, "%") },
    { label: "CVaR 99%", definition: "不高于VaR 99%的历史日收益均值。", value: (e) => display(e.tailRisk.conditionalValueAtRisk99, "%") },
    { label: "Skewness", definition: "日收益样本偏度；负值表示左尾更重。", value: (e) => display(e.tailRisk.skewness, "", 3) },
    { label: "Excess Kurtosis", definition: "日收益超额峰度；正值表示尾部比正态分布更厚。", value: (e) => display(e.tailRisk.excessKurtosis, "", 3) },
    { label: "Worst Day", definition: "历史相邻交易日权益收益的最小值。", value: (e) => display(e.tailRisk.worstDay, "%") },
    { label: "Worst Trade", definition: "单笔已出清订单净收益率的最小值。", value: (e) => display(e.tailRisk.worstTrade, "%") },
  ];
  const stability: MetricRow[] = [
    { label: "盈利月份比例", definition: "按每月首末权益计算月收益，收益为正的月份比例。", value: (e) => display(e.stability.profitableMonthRate, "%", 1) },
    { label: "盈利年份比例", definition: "按每年首末权益计算年收益，收益为正的年份比例。", value: (e) => display(e.stability.profitableYearRate, "%", 1) },
    { label: "Rolling Sharpe", definition: `最近${experiments[0]?.strategyEvaluation.stability.rollingWindowTradingDays ?? 63}个交易日权益窗口的夏普。`, value: (e) => display(e.stability.latestRollingSharpe, "", 3) },
    { label: "Rolling Calmar", definition: "最近滚动窗口的年化收益÷窗口内最大回撤。", value: (e) => display(e.stability.latestRollingCalmar, "", 3) },
    { label: "Rolling CAGR", definition: "最近滚动窗口按252交易日年化的收益。", value: (e) => display(e.stability.latestRollingCagr, "%") },
    { label: "最大回撤持续时间", definition: "从进入回撤到创出新高或期末的最长交易日数。", value: (e) => display(e.stability.maxDrawdownDurationTradingDays, " 个交易日", 0) },
    { label: "最长恢复时间", definition: "从回撤开始到恢复前高，或未恢复至期末的最长交易日数。", value: (e) => display(e.stability.longestRecoveryTradingDays, " 个交易日", 0) },
    { label: "收益集中度", definition: "收益为正日中，前5个最大正收益日占全部正收益日收益的比例。", value: (e) => display(e.stability.topFivePositiveDayReturnContribution, "%", 1) },
  ];
  const realism: MetricRow[] = [
    { label: "手续费", definition: "全部已入场订单累计佣金、印花税和过户费；未强制平仓。", value: (e) => money(e.tradingRealism.totalFees) },
    { label: "滑点", definition: "模拟器采用的单边固定滑点假设，不是事后估计冲击成本。", value: (e) => `${e.tradingRealism.modeledOneWaySlippageBps} bps` },
    { label: "换手率", definition: "区间所有成交订单买入与已出清卖出金额÷初始资金。", value: (e) => display(e.tradingRealism.periodTurnoverToInitialCapital, "%", 1) },
    { label: "平均持仓时间", definition: "已出清订单从入场至出清的实际交易日数。", value: (e) => display(e.tradingRealism.averageHoldingTradingDays, " 个交易日") },
    { label: "资金利用率", definition: "每日(权益－现金)÷权益的平均值，以收盘权益计。", value: (e) => display(e.tradingRealism.averageCapitalUtilization, "%", 1) },
    { label: "平均仓位", definition: "每日收盘的平均持仓股票数量。", value: (e) => display(e.tradingRealism.averageOpenPositions, " 只") },
    { label: "最大仓位", definition: "回测期间同时持仓的最高股票数量。", value: (e) => `${e.tradingRealism.maxOpenPositions} 只` },
    { label: "市场冲击", definition: "订单金额÷T+1日线成交额的平均参与率（bps）；仅为流动性代理，不模拟盘口冲击。", value: (e) => `${display(e.tradingRealism.averageEntryParticipationBps, " bps")} / 覆盖${e.tradingRealism.entryParticipationCoverageCount}笔` },
  ];
  return <section data-strategy-evaluation className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 border-b border-indigo-100 pb-4 sm:flex-row sm:items-start"><div className="mr-auto"><p className="text-xs font-bold tracking-[0.16em] text-indigo-700">SIX-LAYER STRATEGY EVALUATION</p><h2 className="mt-1 font-semibold text-slate-950">统一策略评价</h2><p className="mt-1 max-w-5xl text-xs leading-5 text-slate-600">所有策略使用相同资金、成本、整手、最大持仓、T+1入场和唯一风险管理退出规则。指标仅评价既有资金曲线，不进入评分、门控或自动选权。</p></div><div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="tablist" aria-label="策略评价口径"><button type="button" role="tab" aria-selected={scope === "full"} onClick={() => setScope("full")} className={`rounded-md px-3 py-1.5 text-xs font-medium ${scope === "full" ? "bg-slate-800 text-white" : "text-slate-600"}`}>全周期</button><button type="button" role="tab" aria-selected={scope === "oos"} onClick={() => setScope("oos")} className={`rounded-md px-3 py-1.5 text-xs font-medium ${scope === "oos" ? "bg-slate-800 text-white" : "text-slate-600"}`}>严格样本外</button></div></div><div className="mt-5 space-y-5"><MetricLayer title="第一层：核心结果" caption={scope === "full" ? "全周期连续资金账户；用于审计完整路径，不能替代样本外结论。" : `严格滚动样本外${windowCount}个连续窗口；每段风险扣分权重仅来自紧邻前置训练期。`} experiments={experiments} rows={core} /><MetricLayer title="第二层：交易质量" caption="基于已出清订单统计，按同一成本、成交限制和退出规则执行。" experiments={experiments} rows={quality} /><MetricLayer title="第三层：尾部风险" caption="历史分位数与分布形态均基于连续账户的相邻交易日收盘权益。" experiments={experiments} rows={tail} /><MetricLayer title="第四层：稳定性" caption="滚动指标使用最近63个交易日；期间不足时明确显示样本不足。" experiments={experiments} rows={stability} /><RobustnessLayer experiments={experiments} robustness={strategyRobustness} windowCount={windowCount} /><MetricLayer title="第六层：交易现实性" caption="严格反映已设定的费用、滑点、仓位和日线成交额；未具备订单簿数据时只给出参与率代理。" experiments={experiments} rows={realism} /></div><p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">评分与门控不读取T+1及后续价格；VaR/CVaR为历史样本统计，并不代表未来损失上限。回测结果仅供历史研究，不构成投资建议。</p></section>;
}
