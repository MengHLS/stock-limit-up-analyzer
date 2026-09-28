import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/common";
import {
  formatCount,
  formatMoney,
  buildStrategyCards,
  summarizeStrategyCards,
  type StrategyCardViewModel,
} from "@/adapters/strategyListAdapter";
import {
  STRATEGY_TYPE_VALUES,
  strategyTypeBadgeClass,
  strategyTypeDescription,
  strategyTypeLabel,
} from "@/components/strategy/strategyTypeVocabulary";
import { trpc } from "@/lib/trpc";
import {
  ChevronRight,
  Database,
  FileClock,
  GitCompareArrows,
  Layers,
  Play,
  Plus,
} from "lucide-react";
import { useLocation } from "wouter";

type StrategyListOutput = inferRouterOutputs<AppRouter>["strategyDomain"]["strategy"]["list"];
type BacktestArchiveOutput = inferRouterOutputs<AppRouter>["researchRun"]["listBacktests"];

/** 列表页卡片（独立组件，避免 map 回调里堆 JSX）。 */
function StrategyCard({
  card,
  onOpen,
  onOpenBacktests,
  onCompare,
}: {
  card: StrategyCardViewModel;
  onOpen: () => void;
  onOpenBacktests: () => void;
  onCompare: () => void;
}) {
  const latest = card.latestBacktest;
  return (
    <div className="group flex flex-col gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-orange-300">
      <button type="button" onClick={onOpen} className="flex flex-col gap-2 text-left">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-semibold">{card.name}</span>
          <StatusBadge status={card.status} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] leading-none ${strategyTypeBadgeClass(card.strategyType)}`}
            title={strategyTypeDescription(card.strategyType) || undefined}
          >
            {strategyTypeLabel(card.strategyType)}
          </span>
          <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
            v{card.latestVersion}
          </span>
          <span className="truncate font-mono text-[10px] leading-none text-muted-foreground">
            {card.strategyId}
          </span>
        </div>
      </button>

      <div className="rounded-md border border-dashed px-2.5 py-2">
        {latest === null ? (
          <p className="text-[11px] text-muted-foreground">
            还没有回测留档
            <span className="ml-1 text-muted-foreground/70">· 可进入策略运行一次</span>
          </p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Play className="h-3 w-3" />
                最近回测
                <span className="font-mono">{latest.strategyVersion}</span>
              </span>
              <span className="truncate text-muted-foreground">{latest.createdAtDisplay}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="min-w-0">
                <p className="text-muted-foreground">初始资金</p>
                <p className="truncate font-mono" title={formatMoney(latest.initialCapital)}>
                  {formatMoney(latest.initialCapital)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground">期末权益</p>
                <p className="truncate font-mono" title={formatMoney(latest.finalEquity)}>
                  {formatMoney(latest.finalEquity)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground">成交笔数</p>
                <p className="truncate font-mono">{formatCount(latest.tradeCount)}</p>
              </div>
            </div>
            <p className="truncate text-[10px] text-muted-foreground">
              {latest.windowLabel} · {latest.statusLabel} · 共 {card.backtestCount} 次留档
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">更新 {card.updatedAtDisplay}</span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={onOpenBacktests}
          >
            <FileClock className="mr-1 h-3 w-3" />
            回测历史
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={onCompare}
          >
            <GitCompareArrows className="mr-1 h-3 w-3" />
            回测对比
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onOpen}>
            打开
            <ChevronRight className="ml-0.5 h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function StrategyList() {
  const [, setLocation] = useLocation();
  const [typeFilter, setTypeFilter] = useState<string>("ALL");

  const list = trpc.strategyDomain.strategy.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  // 回测留档只读列表（不含完整结果）；取足够多以便覆盖全部策略的最近一次。
  const archives = trpc.researchRun.listBacktests.useQuery(
    { limit: 200 },
    { refetchOnWindowFocus: false },
  );

  const cards = useMemo<StrategyCardViewModel[] | null>(() => {
    if (list.data === undefined) return null;
    return buildStrategyCards(
      list.data as StrategyListOutput,
      (archives.data ?? []) as BacktestArchiveOutput,
    );
  }, [list.data, archives.data]);

  const visibleCards = useMemo(() => {
    if (cards === null) return null;
    if (typeFilter === "ALL") return cards;
    return cards.filter(card => card.strategyType === typeFilter);
  }, [cards, typeFilter]);

  const summary = useMemo(
    () => (cards === null ? null : summarizeStrategyCards(cards)),
    [cards],
  );

  const openNew = () => setLocation("/strategies/new");
  const openDetail = (strategyId: string) =>
    setLocation(`/strategies/${encodeURIComponent(strategyId)}`);
  const openBacktestHistory = (strategyId: string) =>
    setLocation(`/backtest-runs?strategyId=${encodeURIComponent(strategyId)}`);
  const openCompare = (strategyId: string) =>
    setLocation(`/strategies/${encodeURIComponent(strategyId)}/compare`);

  // 只列出现存策略里实际出现过的类型，避免下拉里挂一堆空类别。
  const usedTypes = useMemo(() => {
    if (cards === null) return [];
    const present = new Set(cards.map(card => card.strategyType).filter((v): v is string => v !== null));
    return STRATEGY_TYPE_VALUES.filter(value => present.has(value));
  }, [cards]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">策略</h1>
          {summary !== null && (
            <span className="text-xs text-muted-foreground">{summary.totalStrategies}</span>
          )}
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          新建策略
        </Button>
      </div>

      {summary !== null && summary.totalStrategies > 0 && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border bg-card px-3 py-2">
            <p className="text-[11px] text-muted-foreground">策略总数</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-base font-semibold">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              {summary.totalStrategies}
            </p>
          </div>
          <div className="rounded-lg border bg-card px-3 py-2">
            <p className="text-[11px] text-muted-foreground">有回测留档</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-base font-semibold">
              <Play className="h-3.5 w-3.5 text-muted-foreground" />
              {summary.withBacktest}
              <span className="text-xs font-normal text-muted-foreground">
                / {summary.totalStrategies}
              </span>
            </p>
          </div>
          <div className="rounded-lg border bg-card px-3 py-2">
            <p className="text-[11px] text-muted-foreground">已分类策略</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-base font-semibold">
              <Database className="h-3.5 w-3.5 text-muted-foreground" />
              {summary.typedStrategies}
              <span className="text-xs font-normal text-muted-foreground">
                / {summary.totalStrategies}
              </span>
            </p>
          </div>
        </div>
      )}

      {cards !== null && cards.length > 0 && usedTypes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTypeFilter("ALL")}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              typeFilter === "ALL"
                ? "border-orange-400 bg-orange-50 text-orange-700"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            全部 {cards.length}
          </button>
          {usedTypes.map(value => {
            const count = cards.filter(card => card.strategyType === value).length;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTypeFilter(value)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  typeFilter === value
                    ? "border-orange-400 bg-orange-50 text-orange-700"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {strategyTypeLabel(value)} {count}
              </button>
            );
          })}
        </div>
      )}

      {list.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 w-full" />
          ))}
        </div>
      )}

      {list.error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 font-mono text-[11px] text-red-700">
          策略列表加载失败：{list.error.message}
        </p>
      )}

      {archives.error && list.error === null && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          回测留档加载失败，卡片暂不显示回测摘要：{archives.error.message}
        </p>
      )}

      {visibleCards !== null && visibleCards.length === 0 && cards !== null && cards.length > 0 && (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">该类别下还没有策略。</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setTypeFilter("ALL")}>
            查看全部
          </Button>
        </div>
      )}

      {visibleCards !== null && visibleCards.length === 0 && cards !== null && cards.length === 0 && (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">还没有任何策略。</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={openNew}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            新建策略
          </Button>
        </div>
      )}

      {visibleCards !== null && visibleCards.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleCards.map(card => (
            <StrategyCard
              key={card.strategyId}
              card={card}
              onOpen={() => openDetail(card.strategyId)}
              onOpenBacktests={() => openBacktestHistory(card.strategyId)}
              onCompare={() => openCompare(card.strategyId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
