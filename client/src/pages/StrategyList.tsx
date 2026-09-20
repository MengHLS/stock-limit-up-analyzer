/**
 * StrategyList — 「策略」列表页（`/strategies`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么把它从详情页里拆出来（2026-09-13 · 纯 `client/**`）
 * ═══════════════════════════════════════════════════════════════════════════
 * 上一版把「策略列表」做成了详情页顶部的一个下拉选择器，于是两个不同性质的动作
 * 被压在同一个页面里：
 *   - **浏览 / 挑一个**（低频、面向全库、点进去就走）；
 *   - **编辑 / 跑回测**（高频、只针对一个策略）。
 * 结果：一进页面就被自动塞进某个「最近更新」的策略，用户既看不出库里有哪些策略，
 * 也不知道自己为什么会停在这一条上。
 *
 * 拆开之后各页只回答一个问题：
 *   - **本页**：有哪些策略、各自什么状态 → 点一张卡进详情；
 *   - **详情页**（`/strategies/:strategyId`）：这一个策略长什么样、跑不跑得动。
 *
 * 纪律：只用真实的 `research.strategy.list`（只读端点）。本页**不**发起任何写操作，
 * 也**不**重算任何判定 —— 状态徽标直接用后端返回的 `status`。
 */

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/common";
import { trpc } from "@/lib/trpc";
import { ChevronRight, Plus } from "lucide-react";
import { useLocation } from "wouter";

/**
 * 只截取日期部分。
 *
 * 🔴 库内时间戳是 **UTC 墙钟**（不是带时区的瞬间）⇒ 不做 `new Date()` 的本地时区换算，
 * 否则会凭空平移 8 小时、显示成错误的日期。这里按字面截断，宁少不多。
 */
function fmtDate(ts: string): string {
  return ts.length >= 10 ? ts.slice(0, 10) : ts;
}

export default function StrategyList() {
  const [, setLocation] = useLocation();
  const list = trpc.strategyDomain.strategy.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const rows = list.data ?? null;
  const sorted =
    rows === null
      ? null
      : [...rows].sort((a, b) =>
          a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
        );

  const openNew = () => setLocation("/strategies/new");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">策略</h1>
          {sorted !== null && (
            <span className="text-xs text-muted-foreground">{sorted.length}</span>
          )}
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          新建策略
        </Button>
      </div>

      {list.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {list.error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 font-mono text-[11px] text-red-700">
          策略列表加载失败：{list.error.message}
        </p>
      )}

      {sorted !== null && sorted.length === 0 && (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">还没有任何策略。</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={openNew}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            新建策略
          </Button>
        </div>
      )}

      {sorted !== null && sorted.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map(s => (
            <button
              key={s.strategyId}
              type="button"
              onClick={() =>
                setLocation(`/strategies/${encodeURIComponent(s.strategyId)}`)
              }
              className="group flex flex-col gap-1.5 rounded-lg border bg-card p-4 text-left transition-colors hover:border-orange-300 hover:bg-accent/40"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {s.name || s.strategyId}
                </span>
                <StatusBadge status={s.status} />
              </div>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {s.strategyId}
              </span>
              <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-mono">v{s.latestVersion}</span>
                <span className="flex items-center gap-1">
                  {fmtDate(s.updatedAt)}
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
