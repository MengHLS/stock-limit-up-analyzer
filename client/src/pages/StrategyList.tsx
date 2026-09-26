
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/common";
import { ThreeFactorTopNPanel } from "@/components/strategy/ThreeFactorTopNPanel";
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

      <ThreeFactorTopNPanel />

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
