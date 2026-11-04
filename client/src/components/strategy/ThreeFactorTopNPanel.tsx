import { trpc } from "@/lib/trpc";
import {
  buildClosedLoopRunViewModel,
  type ClosedLoopRunViewModel,
  type ClosedLoopTradeView,
} from "@/adapters/closedLoopRunAdapter";
import { StockKlineDialog } from "@/components/strategy/StockKlineDialog";
import { BarChart3, CandlestickChart, DatabaseZap, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const DEFAULT_COMPARISON_STRATEGY_IDS = [
  "first-limit-pullback-3f-top3",
  "first-limit-pullback-3f-top5",
] as const;

const STRATEGY_LABELS: Record<string, string> = {
  "first-limit-pullback-3f-top3": "3F Top3",
  "first-limit-pullback-3f-top5": "3F Top5",
};

type BacktestRunOption = {
  readonly id: number;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly runId: string;
  readonly createdAt: string;
};

type CurveRunView = {
  readonly slot: 0 | 1;
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly run: BacktestRunOption;
  readonly view: ClosedLoopRunViewModel;
};

function compareStrategyVersionDesc(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

const CURVE_COLORS = ["#0f766e", "#ea580c"] as const;

function latestVersionRun<T extends { strategyVersion: string }>(
  runs: readonly T[],
): T | null {
  return [...runs].sort((left, right) =>
    compareStrategyVersionDesc(left.strategyVersion, right.strategyVersion),
  )[0] ?? null;
}

function strategyLabel(strategyId: string): string {
  return STRATEGY_LABELS[strategyId] ?? strategyId;
}

function latestRunForStrategy(
  runs: readonly BacktestRunOption[],
  strategyId: string,
): BacktestRunOption | null {
  return latestVersionRun(runs.filter(run => run.strategyId === strategyId));
}

function formatMoney(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value: number | null, digits = 2, suffix = ""): string {
  return value === null ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function toneOf(value: number | null): string {
  if (value === null) return "text-slate-500";
  return value >= 0 ? "text-rose-600" : "text-emerald-700";
}

function buildCurveData(
  series: readonly { key: string; view: ClosedLoopRunViewModel }[],
): Array<Record<string, string | number>> {
  const dates = Array.from(
    new Set(series.flatMap(item => item.view.backtest?.equityCurve.map(point => point.date) ?? [])),
  ).sort();
  return dates.map(date => {
    const point: Record<string, string | number> = { date: date.slice(2) };
    for (const item of series) {
      const backtest = item.view.backtest;
      const equity = backtest?.equityCurve.find(curvePoint => curvePoint.date === date)?.equity;
      const initial = backtest?.initialCapital;
      if (equity !== undefined && initial !== null && initial !== undefined && initial > 0) {
        point[item.key] = Number((((equity / initial) - 1) * 100).toFixed(2));
      }
    }
    return point;
  });
}

export function ClosedLoopBacktestComparisonPanel() {
  const [detailSlot, setDetailSlot] = useState<0 | 1>(0);
  const [tradeYear, setTradeYear] = useState<string>("ALL");
  const [tradePage, setTradePage] = useState(1);
  const [selectedTrade, setSelectedTrade] = useState<ClosedLoopTradeView | null>(null);
  const [tradeDetailOpen, setTradeDetailOpen] = useState(false);
  const [curveRunIds, setCurveRunIds] = useState<[number | null, number | null]>([null, null]);
  const curveInitialized = useRef(false);
  const history = trpc.researchRun.listBacktests.useQuery(
    { limit: 200 },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const curveOptions = useMemo(() => {
    return [...(history.data ?? [])].sort((left, right) => {
      const byStrategy = strategyLabel(left.strategyId).localeCompare(
        strategyLabel(right.strategyId),
      );
      if (byStrategy !== 0) return byStrategy;
      const byVersion = compareStrategyVersionDesc(
        left.strategyVersion,
        right.strategyVersion,
      );
      if (byVersion !== 0) return byVersion;
      return right.createdAt.localeCompare(left.createdAt);
    });
  }, [history.data]);
  const curveRunById = useMemo(
    () => new Map(curveOptions.map(run => [run.id, run])),
    [curveOptions],
  );
  const curveADetail = trpc.researchRun.getBacktest.useQuery(
    { id: curveRunIds[0] ?? 0 },
    {
      enabled: curveRunIds[0] !== null,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  );
  const curveBDetail = trpc.researchRun.getBacktest.useQuery(
    { id: curveRunIds[1] ?? 0 },
    {
      enabled: curveRunIds[1] !== null,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  );
  useEffect(() => {
    if (curveInitialized.current) return;
    const first =
      latestRunForStrategy(curveOptions, DEFAULT_COMPARISON_STRATEGY_IDS[0])?.id ??
      curveOptions[0]?.id ??
      null;
    const second =
      latestRunForStrategy(curveOptions, DEFAULT_COMPARISON_STRATEGY_IDS[1])?.id ??
      curveOptions.find(run => run.id !== first)?.id ??
      null;
    if (first !== null || second !== null) {
      setCurveRunIds([first, second]);
      curveInitialized.current = true;
    }
  }, [curveOptions]);

  const curveViews = useMemo(() => {
    const details = [curveADetail.data, curveBDetail.data] as const;
    return curveRunIds.flatMap((runId, index) => {
      if (runId === null) return [];
      const run = curveRunById.get(runId);
      const view = buildClosedLoopRunViewModel(details[index]?.result ?? null);
      if (run === undefined || view === null) return [];
      return [{
        slot: index as 0 | 1,
        key: `curve-${index}-${runId}`,
        label: `${strategyLabel(run.strategyId)} · v${run.strategyVersion} · #${run.id}`,
        color: CURVE_COLORS[index]!,
        run,
        view,
      }];
    });
  }, [curveADetail.data, curveBDetail.data, curveRunById, curveRunIds]);

  const curveData = useMemo(
    () => buildCurveData(curveViews.map(item => ({ key: item.key, view: item.view }))),
    [curveViews],
  );
  const selected = curveViews.find(item => item.slot === detailSlot) ?? curveViews[0] ?? null;
  const selectedBacktest = selected?.view.backtest ?? null;
  const selectedEvaluation = selected?.view.evaluation ?? null;
  const tradeYears = useMemo(() => {
    const counts = new Map<string, number>();
    for (const trade of selectedBacktest?.trades ?? []) {
      const year = trade.entryTime.slice(0, 4);
      counts.set(year, (counts.get(year) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [selectedBacktest]);
  const filteredTrades = useMemo(
    () =>
      tradeYear === "ALL"
        ? selectedBacktest?.trades ?? []
        : (selectedBacktest?.trades ?? []).filter(trade => trade.entryTime.startsWith(`${tradeYear}-`)),
    [selectedBacktest, tradeYear],
  );
  const tradePageSize = 80;
  const totalTradePages = Math.max(1, Math.ceil(filteredTrades.length / tradePageSize));
  const currentTradePage = Math.min(tradePage, totalTradePages);
  const pagedTrades = filteredTrades.slice(
    (currentTradePage - 1) * tradePageSize,
    currentTradePage * tradePageSize,
  );
  useEffect(() => {
    setTradeYear("ALL");
    setTradePage(1);
  }, [detailSlot]);
  const loading = history.isLoading;
  const curveLoading =
    (curveRunIds[0] !== null && curveADetail.isLoading)
    || (curveRunIds[1] !== null && curveBDetail.isLoading);

  return (
    <section
      data-closed-loop-backtest-comparison
      className="overflow-hidden rounded-2xl border border-teal-200 bg-card"
    >
      <div className="p-5">
        <div className="flex flex-wrap items-start gap-3">
          <BarChart3 className="mt-0.5 h-5 w-5 text-teal-700" />
          <div className="mr-auto">
            <p className="text-xs font-bold tracking-[0.16em] text-teal-700">CLOSED LOOP · BACKTEST</p>
            <h2 className="mt-1 font-semibold">闭环回测版本对比</h2>
            <p className="mt-1 max-w-5xl text-xs leading-5 text-slate-600">
              从闭环回测留档中选择最多两个版本进行比较，默认优先展示最新的 3F Top3
              与 3F Top5。曲线、指标表和成交明细均跟随所选版本，具体策略条件以对应
              策略版本的留档声明为准。
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-56 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-teal-700" />
          </div>
        ) : curveOptions.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-teal-200 bg-teal-50/40 px-5 py-8 text-center">
            <DatabaseZap className="mx-auto h-5 w-5 text-teal-700" />
            <p className="mt-2 text-sm font-medium text-slate-700">尚无闭环回测留档结果</p>
            <p className="mt-1 text-xs text-slate-500">
              运行闭环回测后，留档会自动出现在这里。
            </p>
          </div>
        ) : (
          <>
            <div className="mt-5 overflow-auto rounded-xl border border-teal-100">
              <table className="w-full min-w-[1040px] text-xs">
                <thead className="bg-teal-50/70 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2">策略</th>
                    <th className="px-3 py-2">起始资金</th>
                    <th className="px-3 py-2">累计收益</th>
                    <th className="px-3 py-2">年化</th>
                    <th className="px-3 py-2">最大回撤</th>
                    <th className="px-3 py-2">夏普</th>
                    <th className="px-3 py-2">索提诺</th>
                    <th className="px-3 py-2">卡玛</th>
                    <th className="px-3 py-2">胜率</th>
                    <th className="px-3 py-2">盈亏比</th>
                    <th className="px-3 py-2">完成交易</th>
                    <th className="px-3 py-2">期末权益</th>
                  </tr>
                </thead>
                <tbody>
                  {curveViews.map(({ key, run, view, color }) => {
                    const evaluation = view.evaluation;
                    const backtest = view.backtest;
                    return (
                      <tr key={key} className="border-t border-teal-100 align-top">
                        <td className="px-3 py-3">
                          <p className="font-semibold" style={{ color }}>
                            {strategyLabel(run.strategyId)}
                          </p>
                          <p className="mt-1 font-mono text-[10px] text-slate-400">
                            v{run.strategyVersion} · 留档 {run.id}
                          </p>
                          <p className="mt-1 font-mono text-[10px] text-slate-400">{view.runId}</p>
                        </td>
                        <td className="px-3 py-3">
                          {backtest?.initialCapital === null || backtest?.initialCapital === undefined
                            ? "—"
                            : `¥${formatMoney(backtest.initialCapital)}`}
                        </td>
                        <td className={`px-3 py-3 font-bold ${toneOf(evaluation?.totalReturnPct ?? null)}`}>
                          {formatNumber(evaluation?.totalReturnPct ?? null, 2, "%")}
                        </td>
                        <td className={`px-3 py-3 font-semibold ${toneOf(evaluation?.cagrPct ?? null)}`}>
                          {formatNumber(evaluation?.cagrPct ?? null, 2, "%")}
                        </td>
                        <td className="px-3 py-3 font-semibold text-emerald-700">
                          {formatNumber(evaluation?.maxDrawdownPct ?? null, 2, "%")}
                        </td>
                        <td className="px-3 py-3">{formatNumber(evaluation?.sharpeRatio ?? null, 4)}</td>
                        <td className="px-3 py-3">{formatNumber(evaluation?.sortinoRatio ?? null, 4)}</td>
                        <td className="px-3 py-3">{formatNumber(evaluation?.calmarRatio ?? null, 4)}</td>
                        <td className="px-3 py-3">{formatNumber(evaluation?.winRatePct ?? null, 2, "%")}</td>
                        <td className="px-3 py-3">{formatNumber(evaluation?.profitFactor ?? null, 4)}</td>
                        <td className="px-3 py-3">{evaluation?.completedTradeCount ?? "—"}</td>
                        <td className="px-3 py-3">
                          {backtest?.finalEquity === null || backtest?.finalEquity === undefined
                            ? "—"
                            : `¥${formatMoney(backtest.finalEquity)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-5 rounded-xl border border-teal-100 bg-teal-50/30 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="mr-auto">
                  <h3 className="text-sm font-semibold text-slate-800">曲线对比</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    每条曲线可独立选择策略与版本，最多同时显示两条。
                  </p>
                </div>
                {[0, 1].map(index => (
                  <label key={index} className="min-w-[310px] text-xs text-slate-600">
                    <span className="mb-1 block font-medium">
                      曲线 {index === 0 ? "A" : "B"}
                    </span>
                    <select
                      className="h-9 w-full rounded-md border border-teal-200 bg-white px-2 text-xs text-slate-700"
                      value={curveRunIds[index] ?? ""}
                      onChange={event => {
                        const value = event.target.value === "" ? null : Number(event.target.value);
                        setCurveRunIds(current => {
                          const next: [number | null, number | null] = [...current];
                          next[index] = value;
                          return next;
                        });
                      }}
                    >
                      <option value="">{index === 0 ? "请选择留档" : "不显示第二条"}</option>
                      {curveOptions.map(run => (
                        <option
                          key={`${index}-${run.id}`}
                          value={run.id}
                          disabled={run.id === curveRunIds[index === 0 ? 1 : 0]}
                        >
                          {strategyLabel(run.strategyId)} · v{run.strategyVersion} · #{run.id} · {run.runId}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {curveViews.map(item => (
                  <span
                    key={item.key}
                    className="inline-flex items-center gap-2 rounded-md border border-teal-100 bg-white px-2.5 py-1.5"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="font-medium text-slate-700">{item.label}</span>
                  </span>
                ))}
                {!curveLoading && curveViews.length === 0 ? (
                  <span className="rounded-md border border-dashed border-teal-200 px-2.5 py-1.5 text-slate-500">
                    请选择至少一条留档
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-5 h-[340px] w-full">
              {curveLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-teal-700" />
                </div>
              ) : curveViews.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  暂无可绘制曲线
                </div>
              ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={curveData} margin={{ top: 12, right: 20, bottom: 8, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe5e4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    minTickGap={28}
                    tick={{ fontSize: 11, fill: "#64748b" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickFormatter={value => `${value}%`}
                  />
                  <Tooltip formatter={value => [`${value}%`, "累计收益率"]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {curveViews.map(item => (
                    <Line
                      key={item.key}
                      type="monotone"
                      dataKey={item.key}
                      name={item.label}
                      stroke={item.color}
                      strokeWidth={2.25}
                      dot={false}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              )}
            </div>

            <div className="mt-5 rounded-xl border border-teal-100">
              <div className="flex flex-wrap items-center gap-3 border-b border-teal-100 bg-teal-50/50 px-4 py-3">
                <div className="mr-auto">
                  <h3 className="text-sm font-semibold text-slate-800">成交明细</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    留档覆盖全部成交明细；可按年份筛选，每页 80 笔。
                  </p>
                </div>
                <div className="flex rounded-lg border border-teal-200 bg-white p-1">
                  {curveViews.map(item => (
                    <button
                      key={item.key}
                      type="button"
                      className={`rounded-md px-3 py-1 text-xs font-medium ${
                        selected?.slot === item.slot
                          ? "bg-teal-700 text-white"
                          : "text-slate-600 hover:bg-teal-50"
                      }`}
                      onClick={() => setDetailSlot(item.slot)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-b border-teal-100 bg-teal-50/30 px-4 py-3">
                <span className="text-xs font-medium text-slate-600">成交年份</span>
                <button
                  type="button"
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    tradeYear === "ALL"
                      ? "border-teal-700 bg-teal-700 text-white"
                      : "border-teal-200 bg-card text-slate-600 hover:bg-teal-50"
                  }`}
                  onClick={() => {
                    setTradeYear("ALL");
                    setTradePage(1);
                  }}
                >
                  全部 {selectedBacktest?.trades.length ?? 0}
                </button>
                {tradeYears.map(([year, count]) => (
                  <button
                    key={year}
                    type="button"
                    className={`rounded-md border px-2.5 py-1 text-xs ${
                      tradeYear === year
                        ? "border-teal-700 bg-teal-700 text-white"
                        : "border-teal-200 bg-card text-slate-600 hover:bg-teal-50"
                    }`}
                    onClick={() => {
                      setTradeYear(year);
                      setTradePage(1);
                    }}
                  >
                    {year} {count}
                  </button>
                ))}
              </div>
              {selectedBacktest !== null && selectedBacktest.trades.length > 0 ? (
                <>
                  <div className="max-h-[24rem] overflow-auto">
                    <table className="w-full min-w-[960px] text-xs">
                      <thead className="sticky top-0 z-10 bg-white text-left text-slate-500">
                        <tr>
                          <th className="px-3 py-2">证券名称 / 代码</th>
                          <th className="px-3 py-2 text-right">评分</th>
                          <th className="px-3 py-2">买入</th>
                          <th className="px-3 py-2">卖出</th>
                          <th className="px-3 py-2">股数</th>
                          <th className="px-3 py-2">净收益</th>
                          <th className="px-3 py-2">收益率</th>
                          <th className="px-3 py-2">持有</th>
                          <th className="px-3 py-2">退出原因</th>
                          <th className="px-3 py-2 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedTrades.map((trade, index) => (
                            <tr
                              key={`${trade.securityId}-${trade.entryTime}-${index}`}
                              className="border-t border-teal-50"
                            >
                              <td className="px-3 py-2">
                                <p className="font-medium text-slate-800">{trade.name ?? "名称待补"}</p>
                                <p className="mt-1 font-mono text-slate-500">
                                  {trade.code ?? trade.securityId}
                                </p>
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-semibold text-slate-800">
                                {formatNumber(trade.score, 4)}
                              </td>
                              <td className="px-3 py-2">
                                <p>{trade.entryTime}</p>
                                <p className="mt-1 text-slate-400">{formatNumber(trade.entryPrice, 4)}</p>
                              </td>
                              <td className="px-3 py-2">
                                <p>{trade.exitTime ?? "—"}</p>
                                <p className="mt-1 text-slate-400">{formatNumber(trade.exitPrice, 4)}</p>
                              </td>
                              <td className="px-3 py-2">{trade.quantity ?? "—"}</td>
                              <td className={`px-3 py-2 font-semibold ${toneOf(trade.netPnl)}`}>
                                {trade.netPnl === null ? "—" : `¥${formatMoney(trade.netPnl)}`}
                              </td>
                              <td className={`px-3 py-2 font-semibold ${toneOf(trade.returnPct)}`}>
                                {formatNumber(trade.returnPct, 2, "%")}
                              </td>
                              <td className="px-3 py-2">
                                {trade.holdingPeriod === null ? "—" : `${trade.holdingPeriod} 日`}
                              </td>
                              <td className="px-3 py-2 text-slate-600">
                                {trade.exitReason ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1.5 rounded-md border border-teal-200 bg-white px-2.5 py-1 font-medium text-teal-700 transition-colors hover:border-teal-300 hover:bg-teal-50"
                                  onClick={() => {
                                    setSelectedTrade(trade);
                                    setTradeDetailOpen(true);
                                  }}
                                >
                                  <CandlestickChart className="h-3.5 w-3.5" />
                                  成交详情
                                </button>
                              </td>
                            </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-teal-100 px-4 py-2 text-xs text-slate-500">
                    <span>
                      共 {filteredTrades.length} 笔 · 第 {currentTradePage}/{totalTradePages} 页
                    </span>
                    <button
                      type="button"
                      className="rounded-md border border-teal-200 px-2.5 py-1 font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={currentTradePage <= 1}
                      onClick={() => setTradePage(page => Math.max(1, page - 1))}
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-teal-200 px-2.5 py-1 font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={currentTradePage >= totalTradePages}
                      onClick={() => setTradePage(page => Math.min(totalTradePages, page + 1))}
                    >
                      下一页
                    </button>
                  </div>
                </>
              ) : (
                <p className="px-4 py-8 text-center text-sm text-slate-500">该运行没有可展示的成交明细。</p>
              )}
            </div>

            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              口径说明：执行面板按首板事件隔离同一证券的多个事件序列，每个事件独立评估；
              同一证券在后续首板事件中可再次触发交易。完成交易数
              {selectedEvaluation?.completedTradeCount === null || selectedEvaluation === null
                ? "以服务端评估为准"
                : `为 ${selectedEvaluation.completedTradeCount}`}
              。
            </p>
          </>
        )}
      </div>
      <StockKlineDialog
        trade={selectedTrade}
        open={tradeDetailOpen}
        onOpenChange={setTradeDetailOpen}
      />
    </section>
  );
}
