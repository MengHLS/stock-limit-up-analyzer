/**
 * BacktestCompare — 回测对比页（只读留档）。
 *
 * 定位：从**已经跑过并留档**的回测里挑 2–10 条，把每条留档的权益曲线画成
 * 与「组合回测」同形的累计收益率折线图，并在同页给出每条留档的交易明细。
 *
 * 数据纪律（改动前必读）：
 *   - **不重新运行任何回测**。唯一数据源是留档只读接口：
 *     `researchRun.listBacktests`（摘要列表）+ `researchRun.getBacktests`（按 id 批量取完整结果）。
 *     页面里没有任何会触发新执行的 mutation —— 只有查询。
 *   - 曲线渲染只做「权益 ÷ 该留档初始资金 − 1」的恒等换算（见 `backtestCompareCurve.ts`），
 *     不在前端另造业务指标；收益 / 回撤 / 年化等标量一律**直搬**服务端留档摘要。
 *   - 交易明细复用 `ClosedLoopRunResultPanel#BacktestTradeDetailsTable`，与运行面板 /
 *     回测历史页共用同一列口径，不重复实现表格。
 *
 * URL 坐标：`?strategyId=<id>` 是唯一选中源（刷新 / 分享可复原）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
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
import {
  GitCompareArrows,
  LineChart as LineChartIcon,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { SectionCard, StatusBadge } from "@/components/common";
import { BacktestTradeDetailsTable } from "@/components/strategy/ClosedLoopRunResultPanel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  buildClosedLoopRunViewModel,
  type ClosedLoopBacktestArtifactsView,
  type ClosedLoopRunViewModel,
} from "@/adapters/closedLoopRunAdapter";
import {
  formatCount,
  formatMoney,
  toClosedLoopBacktestRunList,
  type ClosedLoopBacktestRunListItemViewModel,
} from "@/adapters/closedLoopBacktestRunAdapter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { ClosedLoopBacktestRunDetailDto } from "@shared/researchContracts";
import {
  buildVersionCompareCurve,
  VERSION_COMPARE_COLORS,
  type VersionCompareCurveSeries,
} from "./backtestCompareCurve";

const MAX_COMPARE_RECORDS = 10;
const MIN_COMPARE_RECORDS = 2;

function formatPct(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}%`;
}

function returnTone(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "text-muted-foreground";
  return value >= 0 ? "text-rose-600" : "text-emerald-700";
}

/** 累计收益率折线图（与组合回测页同形：百分比纵轴 + 留档图例）。 */
function VersionReturnLineChart({
  data,
  series,
}: {
  data: Array<Record<string, number | string>>;
  series: readonly VersionCompareCurveSeries[];
}) {
  const drawable = series.filter(item => item.pointCount > 0);
  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 20, bottom: 8, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="date" minTickGap={28} tick={{ fontSize: 11, fill: "#64748b" }} />
          <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={value => `${value}%`} />
          <Tooltip formatter={value => [`${value}%`, "累计收益率"]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {drawable.map(item => (
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
    </div>
  );
}

interface CompareRow {
  readonly id: number;
  /** 摘要（列表接口）；用于头部标签与窗口，可能因列表刷新缺失。 */
  readonly summary: ClosedLoopBacktestRunListItemViewModel | null;
  /** 完整留档（批量详情接口）；`null` = 该 id 不存在 / 已被清理。 */
  readonly detail: ClosedLoopBacktestRunDetailDto | null;
  readonly viewModel: ClosedLoopRunViewModel | null;
  readonly backtest: ClosedLoopBacktestArtifactsView | null;
  readonly label: string;
  readonly color: string;
}

/** 已载入留档的指标摘要表（颜色与折线图例一致）。 */
function CompareSummaryTable({ rows }: { rows: readonly CompareRow[] }) {
  return (
    <div className="overflow-auto rounded-lg border">
      <table className="w-full min-w-[940px] text-xs">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2">留档</th>
            <th className="px-3 py-2">版本</th>
            <th className="px-3 py-2">回测窗口</th>
            <th className="px-3 py-2">状态</th>
            <th className="px-3 py-2 text-right">累计收益率</th>
            <th className="px-3 py-2 text-right">最大回撤</th>
            <th className="px-3 py-2 text-right">年化</th>
            <th className="px-3 py-2 text-right">成交笔数</th>
            <th className="px-3 py-2 text-right">初始资金 / 期末权益</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            if (row.detail === null) {
              return (
                <tr key={row.id} className="border-t bg-rose-50/50 align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">
                    #{row.id}
                  </td>
                  <td className="px-3 py-2 text-rose-700" colSpan={8}>
                    该留档不存在（可能已被清理）。
                  </td>
                </tr>
              );
            }
            const evaluation = row.viewModel?.evaluation ?? null;
            return (
              <tr key={row.id} className="border-t align-top">
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    <Link to={`/backtest-runs?id=${row.id}`}>
                      <span className="font-mono text-sky-700 hover:underline">#{row.id}</span>
                    </Link>
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">
                  {row.detail.strategyVersion === "" ? "—" : `v${row.detail.strategyVersion}`}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {row.detail.startDate === "" && row.detail.endDate === ""
                    ? "—"
                    : `${row.detail.startDate || "?"} → ${row.detail.endDate || "?"}`}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.detail.status} />
                </td>
                <td
                  className={cn(
                    "whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums",
                    returnTone(evaluation?.totalReturnPct ?? row.detail.totalReturnPct)
                  )}
                >
                  {formatPct(evaluation?.totalReturnPct ?? row.detail.totalReturnPct)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-emerald-700">
                  {formatPct(evaluation?.maxDrawdownPct ?? row.detail.maxDrawdownPct)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {formatPct(evaluation?.cagrPct ?? row.detail.cagrPct)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {formatCount(row.detail.tradeCount)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  ¥{formatMoney(row.detail.initialCapital)} / ¥{formatMoney(row.detail.finalEquity)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function BacktestCompare() {
  const search = useSearch();
  const [, setLocation] = useLocation();

  const strategyId = useMemo(
    () => new URLSearchParams(search).get("strategyId") ?? "",
    [search]
  );

  const strategyList = trpc.strategyDomain.strategy.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  // 只读摘要列表：该策略已跑过的回测留档（按留档时间倒序）。
  const listQuery = trpc.researchRun.listBacktests.useQuery(
    {
      limit: 200,
      ...(strategyId === "" ? {} : { strategyId }),
    },
    { refetchOnWindowFocus: false }
  );

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set());
  const [loadedIds, setLoadedIds] = useState<readonly number[]>([]);

  // 换策略 = 换坐标系：清空选择与已载入结果，避免把上一个策略的留档带过来。
  useEffect(() => {
    setSelectedIds(new Set());
    setLoadedIds([]);
  }, [strategyId]);

  // 只读批量详情：仅在用户显式「加载对比」后按 id 拉取（不重新运行任何回测）。
  const detailsQuery = trpc.researchRun.getBacktests.useQuery(
    { ids: [...loadedIds] },
    { enabled: loadedIds.length >= MIN_COMPARE_RECORDS, refetchOnWindowFocus: false }
  );

  const listItems = useMemo(
    () => toClosedLoopBacktestRunList(listQuery.data),
    [listQuery.data]
  );

  const orderedSelected = useMemo(
    () => listItems.filter(item => selectedIds.has(item.id)).map(item => item.id),
    [listItems, selectedIds]
  );

  const toggleRecord = useCallback((id: number) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= MAX_COMPARE_RECORDS) return current;
      next.add(id);
      return next;
    });
  }, []);

  const selectedCount = selectedIds.size;
  const canLoad =
    strategyId !== "" &&
    orderedSelected.length >= MIN_COMPARE_RECORDS &&
    orderedSelected.length <= MAX_COMPARE_RECORDS &&
    !detailsQuery.isFetching;

  const loadComparison = () => {
    if (!canLoad) return;
    setLoadedIds([...orderedSelected]);
  };

  // 按「已载入 id 顺序」拼装行；缺失的 id 保留为一行（如实标注「不存在」）。
  const compareRows = useMemo<CompareRow[]>(() => {
    const listById = new Map(listItems.map(item => [item.id, item]));
    const detailById = new Map<number, ClosedLoopBacktestRunDetailDto>(
      (detailsQuery.data ?? []).map(detail => [detail.id, detail])
    );
    return loadedIds.map((id, index) => {
      const detail = detailById.get(id) ?? null;
      const result = detail?.result ?? null;
      const viewModel = result === null ? null : buildClosedLoopRunViewModel(result);
      const version = detail?.strategyVersion ?? "";
      return {
        id,
        summary: listById.get(id) ?? null,
        detail,
        viewModel,
        backtest: viewModel?.backtest ?? null,
        label: version === "" ? `#${id}` : `#${id} · v${version}`,
        color: VERSION_COMPARE_COLORS[index % VERSION_COMPARE_COLORS.length],
      };
    });
  }, [loadedIds, listItems, detailsQuery.data]);

  const curve = useMemo(
    () =>
      buildVersionCompareCurve(
        compareRows.map(row => ({ label: row.label, result: row.detail?.result ?? null }))
      ),
    [compareRows]
  );

  const tradeRows = compareRows.filter(row => row.backtest !== null);
  const hasLoaded = loadedIds.length >= MIN_COMPARE_RECORDS;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <GitCompareArrows className="h-5 w-5 text-teal-700" />
          回测对比
        </h1>
        <p className="text-xs text-muted-foreground">
          从已经跑过并留档的回测里挑几条，按累计收益率放在一张折线图上对比，并附每条留档的交易明细。
        </p>
      </div>

      <SectionCard
        title="选择回测留档"
        icon={LineChartIcon}
        description="读取既存留档的完整结果（权益曲线 / 指标 / 交易明细），不会重新运行回测。"
        right={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void listQuery.refetch()}
              disabled={listQuery.isFetching}
            >
              {listQuery.isFetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span className="ml-1">刷新</span>
            </Button>
            <Button size="sm" onClick={loadComparison} disabled={!canLoad}>
              {detailsQuery.isFetching ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <LineChartIcon className="mr-1.5 h-3.5 w-3.5" />
              )}
              {detailsQuery.isFetching ? "载入中…" : "加载对比"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              策略
              <select
                value={strategyId}
                onChange={event =>
                  setLocation(
                    event.target.value === ""
                      ? "/backtest-compare"
                      : `/backtest-compare?strategyId=${encodeURIComponent(event.target.value)}`
                  )
                }
                className="h-9 min-w-[16rem] rounded-md border bg-background px-2 text-xs text-foreground"
              >
                <option value="">选择策略…</option>
                {(strategyList.data ?? []).map(summary => (
                  <option key={summary.strategyId} value={summary.strategyId}>
                    {summary.name}（v{summary.latestVersion}）
                  </option>
                ))}
              </select>
            </label>
            <p className="pb-1 text-[11px] text-muted-foreground">
              已选 {selectedCount} 条留档（需 {MIN_COMPARE_RECORDS}–{MAX_COMPARE_RECORDS} 条）
            </p>
          </div>

          {strategyId === "" ? (
            <p className="text-xs text-muted-foreground">
              先选择一个策略，再从它的回测留档里挑至少 {MIN_COMPARE_RECORDS} 条。
            </p>
          ) : listQuery.isLoading ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              读取回测留档…
            </p>
          ) : listQuery.error ? (
            <p className="font-mono text-xs text-rose-600">{listQuery.error.message}</p>
          ) : listItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              该策略还没有回测留档。到「策略」页点「运行策略」跑一次，结束后会自动留档。
            </p>
          ) : (
            <div className="max-h-[22rem] overflow-auto rounded-lg border">
              <table className="w-full min-w-[940px] text-xs">
                <thead className="sticky top-0 bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2" />
                    <th className="px-3 py-2">留档时间</th>
                    <th className="px-3 py-2">版本</th>
                    <th className="px-3 py-2">回测窗口</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2 text-right">累计收益率</th>
                    <th className="px-3 py-2 text-right">最大回撤</th>
                    <th className="px-3 py-2 text-right">成交笔数</th>
                    <th className="px-3 py-2 text-right">期末权益</th>
                    <th className="px-3 py-2">数据集</th>
                  </tr>
                </thead>
                <tbody>
                  {listItems.map(item => {
                    const checked = selectedIds.has(item.id);
                    return (
                      <tr
                        key={item.id}
                        className={cn(
                          "border-t transition-colors",
                          checked ? "bg-teal-50/50" : "hover:bg-muted/40"
                        )}
                      >
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleRecord(item.id)}
                            aria-label={`选择留档 #${item.id}`}
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {item.createdAtDisplay}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono">
                          {item.strategyVersion === "" ? "—" : `v${item.strategyVersion}`}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {item.windowLabel}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={item.status} />
                        </td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums",
                            returnTone(item.totalReturnPct)
                          )}
                        >
                          {formatPct(item.totalReturnPct)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-emerald-700">
                          {formatPct(item.maxDrawdownPct)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {formatCount(item.tradeCount)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          ¥{formatMoney(item.finalEquity)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          <span title={item.datasetSourceNote ?? undefined}>
                            {item.datasetVersion ?? "—"}
                          </span>
                          {item.datasetVersionId !== null && (
                            <span className="ml-1 text-muted-foreground/60">
                              #{item.datasetVersionId}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SectionCard>

      {hasLoaded && detailsQuery.error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          载入留档失败：{detailsQuery.error.message}
        </div>
      )}

      {hasLoaded && detailsQuery.isLoading && (
        <div className="flex items-center gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取已选留档的完整结果（只读，不重新运行）…
        </div>
      )}

      {hasLoaded && detailsQuery.data !== undefined && !detailsQuery.isLoading && (
        <>
          <SectionCard
            title="累计收益率对比"
            icon={LineChartIcon}
            description={`对比 ${compareRows.length} 条留档 · 数据来自已留档结果（不重新运行）`}
          >
            {curve.data.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                已选留档里没有可展示的权益曲线（可能未产出 backtest，或初始资金缺失）。
              </p>
            ) : (
              <VersionReturnLineChart data={curve.data} series={curve.series} />
            )}
            <div className="mt-4">
              <CompareSummaryTable rows={compareRows} />
            </div>
          </SectionCard>

          <SectionCard
            title="各留档交易明细"
            description="与「运行策略 / 回测历史」共用同一张成交明细表（同一列口径）。"
          >
            {tradeRows.length === 0 ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <TriangleAlert className="h-3.5 w-3.5" />
                没有产出交易明细的留档。
              </p>
            ) : (
              <div className="space-y-4">
                {tradeRows.map(row => (
                  <div key={row.id} className="rounded-lg border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      <span className="font-mono text-sm font-semibold">{row.label}</span>
                      {row.detail !== null && <StatusBadge status={row.detail.status} />}
                      <span className="text-[11px] text-muted-foreground">
                        累计{" "}
                        {formatPct(
                          row.viewModel?.evaluation?.totalReturnPct ??
                            row.detail?.totalReturnPct ??
                            null
                        )}{" "}
                        · 最大回撤{" "}
                        {formatPct(
                          row.viewModel?.evaluation?.maxDrawdownPct ??
                            row.detail?.maxDrawdownPct ??
                            null
                        )}{" "}
                        · 期末权益 ¥{formatMoney(row.backtest?.finalEquity ?? null)}
                      </span>
                    </div>
                    <BacktestTradeDetailsTable backtest={row.backtest!} />
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
