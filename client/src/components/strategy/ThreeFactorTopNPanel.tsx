import { trpc } from "@/lib/trpc";
import {
  buildClosedLoopRunViewModel,
  type ClosedLoopRunViewModel,
} from "@/adapters/closedLoopRunAdapter";
import { BarChart3, DatabaseZap, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

const FACTOR_STRATEGIES = [
  { topN: 3, strategyId: "first-limit-pullback-3f-top3", label: "3F Top3", color: "#0f766e" },
  { topN: 5, strategyId: "first-limit-pullback-3f-top5", label: "3F Top5", color: "#ea580c" },
] as const;

/** 只展示带盘中止损和固定仓位口径的留档；旧结果不得套用新口径文案。 */
const THREE_FACTOR_TOPN_VERSION = "1.6.0";

type FactorStrategy = (typeof FACTOR_STRATEGIES)[number];

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

export function ThreeFactorTopNPanel() {
  const [detailTopN, setDetailTopN] = useState<3 | 5>(3);
  const [tradeYear, setTradeYear] = useState<string>("ALL");
  const [tradePage, setTradePage] = useState(1);
  const top3History = trpc.researchRun.listBacktests.useQuery(
    { strategyId: FACTOR_STRATEGIES[0].strategyId, limit: 10 },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const top5History = trpc.researchRun.listBacktests.useQuery(
    { strategyId: FACTOR_STRATEGIES[1].strategyId, limit: 10 },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const top3Run =
    top3History.data?.find(item => item.strategyVersion === THREE_FACTOR_TOPN_VERSION) ?? null;
  const top5Run =
    top5History.data?.find(item => item.strategyVersion === THREE_FACTOR_TOPN_VERSION) ?? null;
  const top3Detail = trpc.researchRun.getBacktest.useQuery(
    { id: top3Run?.id ?? 0 },
    { enabled: top3Run !== null, staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const top5Detail = trpc.researchRun.getBacktest.useQuery(
    { id: top5Run?.id ?? 0 },
    { enabled: top5Run !== null, staleTime: 60_000, refetchOnWindowFocus: false },
  );

  const views = useMemo(() => {
    const rows: Array<{ strategy: FactorStrategy; view: ClosedLoopRunViewModel }> = [];
    for (const [strategy, detail] of [
      [FACTOR_STRATEGIES[0], top3Detail.data],
      [FACTOR_STRATEGIES[1], top5Detail.data],
    ] as const) {
      const view = buildClosedLoopRunViewModel(detail?.result ?? null);
      if (view !== null) rows.push({ strategy, view });
    }
    return rows;
  }, [top3Detail.data, top5Detail.data]);

  const curveData = useMemo(
    () => buildCurveData(views.map(item => ({ key: item.strategy.label, view: item.view }))),
    [views],
  );
  const selected = views.find(item => item.strategy.topN === detailTopN) ?? views[0] ?? null;
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
  }, [detailTopN]);
  const loading =
    top3History.isLoading
    || top5History.isLoading
    || (top3Run !== null && top3Detail.isLoading)
    || (top5Run !== null && top5Detail.isLoading);

  return (
    <section
      data-three-factor-topn-panel
      className="overflow-hidden rounded-2xl border border-teal-200 bg-card"
    >
      <div className="p-5">
        <div className="flex flex-wrap items-start gap-3">
          <BarChart3 className="mt-0.5 h-5 w-5 text-teal-700" />
          <div className="mr-auto">
            <p className="text-xs font-bold tracking-[0.16em] text-teal-700">3F TOPN · STRATEGY CORE</p>
            <h2 className="mt-1 font-semibold">3F 综合评分 TopN 闭环回测</h2>
            <p className="mt-1 max-w-5xl text-xs leading-5 text-slate-600">
              Dataset v5（2019-01-01 至 2026-09-04）；T+5 收盘按 3F 等权合成分排序，
              T+6 开盘买入；两个方案初始资金均为 ¥100,000；佣金 3 bps、印花税 10 bps、
              过户费 0.1 bps、滑点 10 bps。退出为盘中 -5% 止损、持有满 5 个交易日与
              候选退出的先到者。两个方案每仓固定按初始资金的 20% 建仓，最多同时持有
              5 只；单日最多新建仓 Top3 2 只、Top5 3 只。
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-56 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-teal-700" />
          </div>
        ) : views.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-teal-200 bg-teal-50/40 px-5 py-8 text-center">
            <DatabaseZap className="mx-auto h-5 w-5 text-teal-700" />
            <p className="mt-2 text-sm font-medium text-slate-700">尚无 3F TopN 留档结果</p>
            <p className="mt-1 text-xs text-slate-500">
              运行 v{THREE_FACTOR_TOPN_VERSION} 的 3F TopN 闭环回测后，固定仓位结果会自动出现在这里。
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
                  {views.map(({ strategy, view }) => {
                    const evaluation = view.evaluation;
                    const backtest = view.backtest;
                    return (
                      <tr key={strategy.strategyId} className="border-t border-teal-100 align-top">
                        <td className="px-3 py-3">
                          <p className="font-semibold" style={{ color: strategy.color }}>{strategy.label}</p>
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

            <div className="mt-5 h-[340px] w-full">
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
                  {views.map(item => (
                    <Line
                      key={item.strategy.label}
                      type="monotone"
                      dataKey={item.strategy.label}
                      name={item.strategy.label}
                      stroke={item.strategy.color}
                      strokeWidth={2.25}
                      dot={false}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
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
                  {views.map(item => (
                    <button
                      key={item.strategy.topN}
                      type="button"
                      className={`rounded-md px-3 py-1 text-xs font-medium ${
                        selected?.strategy.topN === item.strategy.topN
                          ? "bg-teal-700 text-white"
                          : "text-slate-600 hover:bg-teal-50"
                      }`}
                      onClick={() => setDetailTopN(item.strategy.topN)}
                    >
                      {item.strategy.label}
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
                    <table className="w-full min-w-[900px] text-xs">
                      <thead className="sticky top-0 z-10 bg-white text-left text-slate-500">
                        <tr>
                          <th className="px-3 py-2">证券名称 / 代码</th>
                          <th className="px-3 py-2">买入</th>
                          <th className="px-3 py-2">卖出</th>
                          <th className="px-3 py-2">股数</th>
                          <th className="px-3 py-2">净收益</th>
                          <th className="px-3 py-2">收益率</th>
                          <th className="px-3 py-2">持有</th>
                          <th className="px-3 py-2">退出原因</th>
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
    </section>
  );
}
