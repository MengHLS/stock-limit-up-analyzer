/**
 * CLOSED-LOOP-BACKTEST-PERSIST-001 — 「回测历史」页。
 *
 * 回答一个问题：**「我跑过的每次回测，都去哪了、结果是什么」**。
 *
 * 数据来源：闭环 `researchRun.loopRun` 每次执行都会**自动留档**一行
 * （`closed_loop_backtest_run` 表），本页读它。
 *
 * 两条边界（改动前必读）：
 *   1. 与 `/backtest` 页的「历史记录」标签**不是一回事** —— 那条读龙头候选回测
 *      （`backtest_runs` 表）；本页读闭环 14 阶段运行留档。两套不可混用。
 *   2. 详情**复用运行工作台的结果面板**（`ClosedLoopRunResultPanel`）⇒ 同一套渲染、
 *      同一套码表，不另写一份「长得像」的展示逻辑（必然漂移）。
 *
 * URL 坐标：选中项用 `?id=<留档行 id>`（刷新/分享可复原），与项目「URL 唯一坐标源」
 * 一致；不选任何项时展示列表全貌。
 */

import { useMemo } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { History, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ClosedLoopRunResultPanel } from "@/components/strategy/ClosedLoopRunResultPanel";
import { buildClosedLoopRunViewModel } from "@/adapters/closedLoopRunAdapter";
import {
  formatCount,
  formatMoney,
  toClosedLoopBacktestRunList,
  type ClosedLoopBacktestRunListItemViewModel,
} from "@/adapters/closedLoopBacktestRunAdapter";

/** 状态徽章配色（与 `closedLoopRunAdapter` 的状态码表对应；非涨跌，故不用红绿行情约定）。 */
function statusTone(status: string): string {
  if (status === "ALL_EXECUTED") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "PARTIAL_BLOCKED") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusTone(status)}`}>
      {label}
    </span>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
      <History className="mx-auto h-8 w-8 text-slate-400" />
      <p className="mt-3 text-sm font-medium text-slate-700">
        {hasFilter ? "这条策略还没有回测留档" : "还没有任何回测留档"}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        到「策略」页选一个策略点「运行策略」——跑完之后，这次回测会自动出现在这里（无需手动保存）。
      </p>
      <Link to="/strategies">
        <Button variant="outline" size="sm" className="mt-4">
          去策略列表
        </Button>
      </Link>
    </div>
  );
}

function RunRow({
  item,
  selected,
  onSelect,
}: {
  item: ClosedLoopBacktestRunListItemViewModel;
  selected: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <tr className={selected ? "bg-sky-50/70" : "hover:bg-slate-50"}>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{item.createdAtDisplay}</td>
      <td className="px-3 py-2 text-xs">
        <Link to={`/strategies/${encodeURIComponent(item.strategyId)}`}>
          <span className="font-medium text-sky-700 hover:underline">{item.strategyLabel}</span>
        </Link>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{item.windowLabel}</td>
      <td className="px-3 py-2">
        <StatusBadge status={item.status} label={item.statusLabel} />
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{item.stageSummary}</td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
        <span title={item.datasetSourceNote ?? undefined}>{item.datasetSourceLabel}</span>
        {item.datasetVersionId !== null && (
          <span className="ml-1 text-slate-400">#{item.datasetVersionId}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-slate-700">
        {formatCount(item.tradeCount)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-slate-800">
        {formatMoney(item.finalEquity)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <Button variant={selected ? "default" : "outline"} size="sm" onClick={() => onSelect(item.id)}>
          {selected ? "已选中" : "查看"}
        </Button>
      </td>
    </tr>
  );
}

export default function BacktestRuns() {
  const search = useSearch();
  const [location, setLocation] = useLocation();

  const selectedId = useMemo(() => {
    const raw = new URLSearchParams(search).get("id");
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  }, [search]);

  const listQuery = trpc.researchRun.listBacktests.useQuery({ limit: 100 });
  const detailQuery = trpc.researchRun.getBacktest.useQuery(
    { id: selectedId ?? 0 },
    { enabled: selectedId !== null },
  );

  const items = useMemo(() => toClosedLoopBacktestRunList(listQuery.data), [listQuery.data]);
  const selectedItem = useMemo(
    () => items.find(item => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  // 详情：复用运行工作台的同一套 ViewModel 构造 + 面板（零展示口径漂移）。
  const detailViewModel = useMemo(() => {
    const detail = detailQuery.data;
    if (detail === null || detail === undefined) return null;
    if (detail.result === null) return null;
    return buildClosedLoopRunViewModel(detail.result);
  }, [detailQuery.data]);

  const hasFilter = false;

  const handleSelect = (id: number) => {
    const next = selectedId === id ? "/backtest-runs" : `/backtest-runs?id=${id}`;
    setLocation(next);
  };

  return (
    <div className="space-y-5" key={location}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-sky-700" />
          <div>
            <h1 className="text-lg font-semibold text-slate-800">回测历史</h1>
            <p className="text-xs text-slate-500">
              每次在「策略」页运行回测都会自动留档一行；点「查看」载入那次运行的完整产出
              （权益曲线 / 成交明细 / 拒单原因 / 阶段执行表）。
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void listQuery.refetch()}
          disabled={listQuery.isFetching}
        >
          {listQuery.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-1">刷新</span>
        </Button>
      </div>

      {listQuery.isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 正在读取回测留档…
        </div>
      ) : listQuery.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          读取失败：{listQuery.error.message}
        </div>
      ) : items.length === 0 ? (
        <EmptyState hasFilter={hasFilter} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">留档时间</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">策略</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">回测窗口</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">状态</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">阶段</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">数据来源</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">成交笔数</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">期末权益</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map(item => (
                <RunRow
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={handleSelect}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              本次运行详情
              {selectedItem !== null && (
                <span className="ml-2 font-normal text-slate-500">
                  {selectedItem.createdAtDisplay} · {selectedItem.strategyLabel} · {selectedItem.windowLabel}
                </span>
              )}
            </h2>
            <Link to="/backtest-runs">
              <Button variant="ghost" size="sm">
                收起
              </Button>
            </Link>
          </div>

          {detailQuery.isLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在载入完整结果…
            </div>
          ) : detailQuery.error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              载入失败：{detailQuery.error.message}
            </div>
          ) : detailQuery.data === null || detailQuery.data === undefined ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
              这条留档不存在（可能已被清理）。
            </div>
          ) : detailViewModel === null ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              这条留档没有完整结果（`resultJson` 为空）—— 只保留了摘要。可对照上表的关键指标查看。
            </div>
          ) : (
            <ClosedLoopRunResultPanel result={detailViewModel} />
          )}
        </div>
      )}
    </div>
  );
}
