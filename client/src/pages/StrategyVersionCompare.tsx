/**
 * StrategyVersionCompare — 单策略多版本回测对比。
 *
 * 当前阶段定位：优先查看已经跑出的版本结果；保留原有「运行对比」能力，但不作为
 * 唯一入口，避免用户误以为必须先重新跑一遍才能看结果。
 *
 * 数据纪律：
 *   - 运行入口 = `researchRun.compareStrategyVersions`（服务端逐版本调同一 executeClosedLoopRun）；
 *   - 指标 / 曲线 / 成交明细全部来自返回的每版本 `result`，再经 `closedLoopRunAdapter` 收敛；
 *   - 单版本失败照常返回 `FAILED + failure`，页面如实展示，不隐藏、不阻断其他版本。
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  GitCompareArrows,
  History,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Settings2,
  Star,
  TriangleAlert,
} from "lucide-react";
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
  buildClosedLoopRunViewModel,
  type ClosedLoopRunViewModel,
} from "@/adapters/closedLoopRunAdapter";
import { strategyToViewModel } from "@/adapters/strategyAdapter";
import {
  createRunConfig,
  RunConfigFields,
  toRuntimeConfig,
  type RunConfigViewModel,
} from "@/components/strategy/RunConfigPanel";
import { BacktestTradeDetailsTable } from "@/components/strategy/ClosedLoopRunResultPanel";
import { SectionCard, StatusBadge } from "@/components/common";
import { PaginationBar } from "@/components/PaginationBar";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/displayFormat";

const CURVE_COLORS = [
  "#0f766e",
  "#ea580c",
  "#2563eb",
  "#b45309",
  "#7e22ce",
  "#059669",
  "#dc2626",
  "#475569",
  "#0891b2",
  "#c026d3",
] as const;

/** 版本号降序（数字段比较；同前缀的 1.10 > 1.9）。 */
function compareVersionDesc(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i += 1) {
    const delta = (rightParts[i] ?? 0) - (leftParts[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function fmtNum(value: number | null, digits = 2, suffix = ""): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(digits)}${suffix}`;
}

function fmtMoney(value: number | null): string {
  return value === null
    ? "—"
    : `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

function tone(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  return value >= 0 ? "text-rose-600" : "text-emerald-700";
}

interface OutcomeView {
  /** 请求内序号：同一版本可就重复请求，因此行标识不能用 version。 */
  index: number;
  strategyVersion: string;
  runId: string;
  archiveId: number | null;
  status: string;
  failure: { code: string; message: string } | null;
  view: ClosedLoopRunViewModel | null;
}

interface CurveView {
  index: number;
  version: string;
  view: ClosedLoopRunViewModel;
}

function shortRunId(runId: string): string {
  return runId.length <= 22 ? runId : `${runId.slice(0, 18)}…`;
}

function buildCurveData(
  views: readonly CurveView[]
): Array<Record<string, string | number>> {
  const dates = Array.from(
    new Set(
      views.flatMap(item =>
        (item.view.backtest?.equityCurve ?? []).map(point => point.date)
      )
    )
  ).sort();
  return dates.map(date => {
    const row: Record<string, string | number> = { date };
    for (const item of views) {
      const backtest = item.view.backtest;
      const point = backtest?.equityCurve.find(p => p.date === date);
      const initial = backtest?.initialCapital;
      if (
        point !== undefined &&
        initial !== null &&
        initial !== undefined &&
        initial > 0
      ) {
        row[`v${item.index}`] = Number(
          (((point.equity / initial) - 1) * 100).toFixed(2)
        );
      }
    }
    return row;
  });
}

export default function StrategyVersionCompare() {
  const params = useParams();
  const strategyId = String(params.strategyId ?? "");
  const utils = trpc.useUtils();

  const versionsQuery = trpc.strategyDomain.strategy.listVersions.useQuery(
    { strategyId },
    { enabled: strategyId !== "", retry: false, refetchOnWindowFocus: false }
  );
  // 运行配置以「最新版本」的策略文档默认值为起点；选中的每个版本仍由服务端按各自文档解析，
  // 前端只发送**真正改动过**的 runtimeConfig。
  const latestVersion = useMemo(
    () =>
      [...(versionsQuery.data ?? [])].sort((a, b) =>
        compareVersionDesc(a.version, b.version)
      )[0]?.version ?? null,
    [versionsQuery.data]
  );
  const loadLatest = trpc.strategyDomain.strategy.loadVersion.useQuery(
    { strategyId, version: latestVersion ?? "" },
    {
      enabled: strategyId !== "" && latestVersion !== null,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );
  const baseViewModel = useMemo(
    () =>
      loadLatest.data === undefined
        ? null
        : strategyToViewModel(
            (loadLatest.data as { strategy?: unknown }).strategy ??
              loadLatest.data
          ),
    [loadLatest.data]
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [config, setConfig] = useState<RunConfigViewModel | null>(null);
  const [selectedOutcomeVersion, setSelectedOutcomeVersion] = useState<
    string | null
  >(null);
  const [archivePage, setArchivePage] = useState(1);
  const [archivePageSize, setArchivePageSize] = useState(12);
  const [archiveSearch, setArchiveSearch] = useState("");
  const [showAllArchives, setShowAllArchives] = useState(false);
  const [metricsRefreshAttempt, setMetricsRefreshAttempt] = useState(0);
  const [isDetailLoadingEnabled, setIsDetailLoadingEnabled] = useState(false);

  // 版本列表到达后默认选最新 2 个（满足对比最小语义），且不覆盖用户后续选择。
  useEffect(() => {
    if (versionsQuery.data === undefined || selected.length > 0) return;
    const ordered = [...versionsQuery.data]
      .sort((a, b) => compareVersionDesc(a.version, b.version))
      .map(v => v.version);
    setSelected(ordered.slice(0, 2));
  }, [versionsQuery.data, selected.length]);

  // 运行配置初始化：文档加载后一次。之后不随选择变化，避免把用户填的值重置掉。
  useEffect(() => {
    if (baseViewModel !== null && config === null) {
      setConfig(createRunConfig(baseViewModel));
    }
  }, [baseViewModel, config]);

  const strategyArchiveQuery = trpc.researchRun.listBacktests.useQuery(
    // 卡片只需要最近一批摘要；曲线与成交明细走 getBacktests 按选中版本单独读取。
    // 避免为几十个旧版本在首屏搬运 / 解析无关摘要。
    { strategyId, limit: 60 },
    {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  );
  const allStrategyArchives = strategyArchiveQuery.data ?? [];

  // 旧留档的指标由服务端后台回填；发现缺失时最多延迟刷新两次，不做轮询。
  useEffect(() => {
    if (metricsRefreshAttempt >= 2) return;
    const hasMissingMetrics = allStrategyArchives.some(
      archive =>
        archive.id !== undefined &&
        archive.totalReturnPct === null &&
        archive.maxDrawdownPct === null &&
        archive.cagrPct === null,
    );
    if (!hasMissingMetrics) return;
    const timer = window.setTimeout(() => {
      setMetricsRefreshAttempt(current => current + 1);
      void strategyArchiveQuery.refetch();
    }, 1_200 * (metricsRefreshAttempt + 1));
    return () => window.clearTimeout(timer);
  }, [
    allStrategyArchives,
    metricsRefreshAttempt,
    strategyArchiveQuery.refetch,
  ]);

  const compare = trpc.researchRun.compareStrategyVersions.useMutation({
    onSuccess: () => {
      void utils.researchRun.listBacktests.invalidate();
    },
  });

  const liveOutcome: OutcomeView[] = useMemo(
    () =>
      (compare.data?.entries ?? []).map((entry, index) => ({
        index,
        strategyVersion: entry.strategyVersion,
        runId: entry.runId,
        archiveId: entry.archiveId,
        status: entry.status,
        failure: entry.failure,
        view: buildClosedLoopRunViewModel(entry.result),
      })),
    [compare.data]
  );

  // 默认对比对象 = 勾选版本的最近一次留档；没有勾选时退到最近两条留档，
  // 让页面打开就有曲线与交易明细，而不是必须重跑。
  const selectedArchiveIds = useMemo(() => {
    const rows =
      selected.length > 0
        ? selected.flatMap(version => {
            const archive = allStrategyArchives.find(
              item => item.strategyVersion === version,
            );
            return archive === undefined ? [] : [archive.id];
          })
        : allStrategyArchives.slice(0, 2).map(archive => archive.id);
    return [...new Set(rows)].slice(0, 10);
  }, [allStrategyArchives, selected]);

  const archivedResultQuery = trpc.researchRun.getBacktests.useQuery(
    { ids: selectedArchiveIds },
    {
      // 完整 resultJson 含曲线与成交明细，单条可达数百 KB。默认只展示卡片，
      // 用户点击「查看已有结果」后才读取，避免首屏被两条大记录拖慢。
      enabled:
        isDetailLoadingEnabled &&
        selectedArchiveIds.length > 0 &&
        compare.data === undefined,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  const archivedOutcome: OutcomeView[] = useMemo(() => {
    return (archivedResultQuery.data ?? []).flatMap((entry, index) => {
      const view = buildClosedLoopRunViewModel(entry.result);
      if (view === null) return [];
      return [
        {
          index,
          strategyVersion: entry.strategyVersion,
          runId: entry.runId,
          archiveId: entry.id,
          status: entry.status,
          failure: null,
          view,
        },
      ];
    });
  }, [archivedResultQuery.data]);

  const outcome = liveOutcome.length > 0 ? liveOutcome : archivedOutcome;
  const usingArchivedResults = liveOutcome.length === 0 && archivedOutcome.length > 0;

  // 版本选择区优先列「已有回测留档」的版本；未跑过的版本回退到版本清单，
  // 否则用户会被几十个 draft 版本淹没，却看不到真正有结果的对比对象。
  const archiveVersionRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: {
      key: string;
      version: string;
      status: string;
      createdAt: string;
      archiveId: number | null;
      datasetVersion: string | null;
      runId: string | null;
      windowLabel: string | null;
      isStarred: boolean;
      totalReturnPct: number | null;
      maxDrawdownPct: number | null;
      cagrPct: number | null;
    }[] = [];
    const versionByNumber = new Map(
      (versionsQuery.data ?? []).map(version => [version.version, version]),
    );
    for (const archive of allStrategyArchives) {
      if (seen.has(archive.strategyVersion)) continue;
      seen.add(archive.strategyVersion);
      const versionRow = versionByNumber.get(archive.strategyVersion);
      rows.push({
        key: `archive-${archive.id}`,
        version: archive.strategyVersion,
        status: archive.status,
        createdAt: archive.createdAt,
        archiveId: archive.id,
        datasetVersion: archive.datasetVersion,
        runId: archive.runId,
        windowLabel: `${archive.startDate} ~ ${archive.endDate}`,
        isStarred: versionRow?.isStarred ?? false,
        totalReturnPct: archive.totalReturnPct ?? null,
        maxDrawdownPct: archive.maxDrawdownPct ?? null,
        cagrPct: archive.cagrPct ?? null,
      });
    }
    for (const version of versionsQuery.data ?? []) {
      if (seen.has(version.version)) continue;
      seen.add(version.version);
      rows.push({
        key: `version-${version.version}`,
        version: version.version,
        status: version.status,
        createdAt: version.createdAt,
        archiveId: null,
        datasetVersion: version.datasetVersion ?? null,
        runId: null,
        windowLabel: null,
        isStarred: version.isStarred,
        totalReturnPct: null,
        maxDrawdownPct: null,
        cagrPct: null,
      });
    }
    return rows;
  }, [allStrategyArchives, versionsQuery.data]);

  const filteredVersionRows = useMemo(() => {
    const keyword = archiveSearch.trim().toLowerCase();
    if (keyword === "") return archiveVersionRows;
    return archiveVersionRows.filter(row =>
      [row.version, row.status, row.datasetVersion ?? "", row.runId ?? "", row.windowLabel ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [archiveSearch, archiveVersionRows]);

  const versionTotalPages = Math.max(
    1,
    Math.ceil(filteredVersionRows.length / archivePageSize),
  );
  const safeArchivePage = Math.min(Math.max(1, archivePage), versionTotalPages);
  const visibleVersionRows = useMemo(() => {
    if (!showAllArchives) return filteredVersionRows.slice(0, 12);
    const start = (safeArchivePage - 1) * archivePageSize;
    return filteredVersionRows.slice(start, start + archivePageSize);
  }, [filteredVersionRows, archivePageSize, safeArchivePage, showAllArchives]);

  const setVersionStarred =
    trpc.strategyDomain.strategy.setVersionStarred.useMutation({
      onSuccess: () =>
        void utils.strategyDomain.strategy.listVersions.invalidate(),
    });

  useEffect(() => {
    setArchivePage(1);
  }, [archiveSearch, archivePageSize, strategyId]);

  const curveViews: CurveView[] = useMemo(
    () =>
      outcome.flatMap(entry =>
        entry.view === null
          ? []
          : [{ index: entry.index, version: entry.strategyVersion, view: entry.view }]
      ),
    [outcome]
  );
  const curveData = useMemo(() => buildCurveData(curveViews), [curveViews]);

  const selectedOutcome =
    outcome.find(entry => String(entry.index) === selectedOutcomeVersion) ??
    outcome[0] ??
    null;

  const canRun =
    baseViewModel !== null &&
    config !== null &&
    selected.length >= 2 &&
    selected.length <= 10 &&
    !compare.isPending;

  const handleRun = () => {
    if (baseViewModel === null || config === null) return;
    if (selected.length < 2) return;
    const runtimeConfig = toRuntimeConfig(config, baseViewModel);
    compare.mutate({
      strategyId,
      strategyVersions: [...selected].sort(compareVersionDesc),
      dateRange: { startDate: config.startDate, endDate: config.endDate },
      ...(Object.keys(runtimeConfig).length > 0 ? { runtimeConfig } : {}),
      ...(config.recipeId ? { recipeId: config.recipeId } : {}),
      datasetGuards: { dataReady: true },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/strategies/${encodeURIComponent(strategyId)}`}>
          <Button size="sm" variant="ghost">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            返回策略
          </Button>
        </Link>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <GitCompareArrows className="h-4.5 w-4.5 text-teal-700" />
          版本回测对比
        </h1>
        <span className="font-mono text-xs text-muted-foreground">
          {strategyId}
        </span>
      </div>

      <SectionCard
        title="选择版本"
        description={
          usingArchivedResults
            ? "下方已直接展示勾选版本最近一次回测留档的曲线与交易明细；如需重新比较，再选择 2-10 个版本运行。"
            : "默认只列最近 12 个版本，避免版本过多；可搜索或展开全部分页选择。点击「查看已有结果」才会读取曲线与交易明细，未跑过回测的版本没有明细可看。"
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/backtest-runs?strategyId=${encodeURIComponent(strategyId)}`}>
              <Button size="sm" variant="outline">
                <History className="mr-1.5 h-3.5 w-3.5" />
                回测历史
              </Button>
            </Link>
            {!isDetailLoadingEnabled && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsDetailLoadingEnabled(true)}
                disabled={selectedArchiveIds.length === 0}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                查看已有结果
              </Button>
            )}
            <Button size="sm" onClick={handleRun} disabled={!canRun}>
              {compare.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {compare.isPending ? "对比运行中…" : `运行对比（${selected.length}）`}
            </Button>
            {isDetailLoadingEnabled && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void archivedResultQuery.refetch()}
                disabled={archivedResultQuery.isFetching}
              >
                {archivedResultQuery.isFetching ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                )}
                刷新结果
              </Button>
            )}
          </div>
        }
      >
        <form
          className="mb-3 flex flex-wrap items-center gap-2"
          onSubmit={e => e.preventDefault()}
        >
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-md border bg-background px-3 py-1.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={archiveSearch}
              onChange={e => setArchiveSearch(e.target.value)}
              placeholder="搜索版本号、状态、数据集或日期"
              className="h-7 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <span className="text-[11px] text-muted-foreground">
            共 {archiveVersionRows.length} 个版本，{filteredVersionRows.length} 个匹配
          </span>
        </form>

        {versionsQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">读取版本列表…</p>
        ) : versionsQuery.error ? (
          <p className="font-mono text-xs text-rose-600">
            {versionsQuery.error.message}
          </p>
        ) : (versionsQuery.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">该策略暂无落库版本。</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {visibleVersionRows.length === 0 ? (
              <p className="col-span-full text-xs text-muted-foreground">
                没有匹配的版本。
              </p>
            ) : visibleVersionRows.map(row => {
                const checked = selected.includes(row.version);
                const disabled =
                  !checked && selected.length >= 10;
                return (
                  <label
                    key={row.key}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                      checked ? "border-teal-400 bg-teal-50/60" : "bg-card"
                    } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      disabled={disabled}
                      onChange={e =>
                        setSelected(current =>
                          e.target.checked
                            ? [...current, row.version]
                            : current.filter(x => x !== row.version)
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold">
                          v{row.version}
                        </span>
                        <StatusBadge status={row.status} />
                        {row.version === latestVersion && (
                          <span className="text-[10px] text-teal-700">
                            最新
                          </span>
                        )}
                        <button
                          type="button"
                          title={row.isStarred ? "取消星标" : "加星标"}
                          aria-label={row.isStarred ? "取消星标" : "加星标"}
                          className={`ml-auto rounded p-0.5 ${
                            row.isStarred
                              ? "text-amber-500 hover:text-amber-600"
                              : "text-muted-foreground hover:text-amber-500"
                          }`}
                          disabled={setVersionStarred.isPending}
                          onClick={event => {
                            event.preventDefault();
                            event.stopPropagation();
                            setVersionStarred.mutate({
                              strategyId,
                              version: row.version,
                              isStarred: !row.isStarred,
                            });
                          }}
                        >
                          <Star
                            className="h-3.5 w-3.5"
                            fill={row.isStarred ? "currentColor" : "none"}
                          />
                        </button>
                        {row.archiveId !== null ? (
                          <span className="text-[10px] text-emerald-700">
                            有留档
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            无留档
                          </span>
                        )}
                      </span>
                      {row.archiveId !== null && (
                        <span className="mt-1 grid grid-cols-3 gap-2 text-[10px]">
                          <span>
                            <span className="block text-muted-foreground">
                              收益率
                            </span>
                            <span
                              className={`font-mono tabular-nums ${tone(
                                row.totalReturnPct,
                              )}`}
                            >
                              {fmtNum(row.totalReturnPct, 2, "%")}
                            </span>
                          </span>
                          <span>
                            <span className="block text-muted-foreground">
                              回撤
                            </span>
                            <span className="font-mono tabular-nums text-emerald-700">
                              {fmtNum(row.maxDrawdownPct, 2, "%")}
                            </span>
                          </span>
                          <span>
                            <span className="block text-muted-foreground">
                              年化
                            </span>
                            <span className="font-mono tabular-nums">
                              {fmtNum(row.cagrPct, 2, "%")}
                            </span>
                          </span>
                        </span>
                      )}
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        数据集 {row.datasetVersion || "—"} ·{" "}
                        {formatDateTime(row.createdAt)}
                      </span>
                      {row.windowLabel !== null && row.runId !== null && (
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {row.windowLabel} · {shortRunId(row.runId)}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
          </div>
        )}
        {filteredVersionRows.length > 12 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAllArchives(value => !value)}
            >
              {showAllArchives
                ? "收起版本选择"
                : `展开全部（${filteredVersionRows.length}）`}
            </Button>
            {showAllArchives && (
              <PaginationBar
                page={safeArchivePage}
                totalPages={versionTotalPages}
                pageSize={archivePageSize}
                onPageChange={setArchivePage}
                onPageSizeChange={setArchivePageSize}
                pageSizeOptions={[12, 24, 48]}
              />
            )}
          </div>
        )}
        {selected.length < 2 && (
          <p className="mt-2 text-[11px] text-amber-700">
            至少选择 2 个版本才能开始对比。
          </p>
        )}
      </SectionCard>

      {baseViewModel !== null && config !== null && !usingArchivedResults && (
        <SectionCard
          title="共享运行配置"
          description="所有版本共用同一日期窗口与口径；未修改的字段按各版本自己的策略文档解析。"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="compare-start">
                回测起始日
              </label>
              <input
                id="compare-start"
                type="date"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={config.startDate}
                onChange={e =>
                  setConfig(current =>
                    current === null
                      ? current
                      : { ...current, startDate: e.target.value }
                  )
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="compare-end">
                回测结束日
              </label>
              <input
                id="compare-end"
                type="date"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={config.endDate}
                onChange={e =>
                  setConfig(current =>
                    current === null
                      ? current
                      : { ...current, endDate: e.target.value }
                  )
                }
              />
            </div>
          </div>

          <details className="mt-3 rounded-md border bg-muted/20">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-xs font-medium">
              <Settings2 className="h-3.5 w-3.5" />
              高级运行口径（可选）
              <span className="font-normal text-muted-foreground">
                初始资金、费率、持仓上限与参数覆写
              </span>
            </summary>
            <div className="border-t px-3 py-3">
              <RunConfigFields
                vm={baseViewModel}
                config={config}
                set={patch =>
                  setConfig(current =>
                    current === null ? current : { ...current, ...patch }
                  )
                }
              />
            </div>
          </details>
        </SectionCard>
      )}

      {compare.isPending && (
        <div className="rounded-md border border-teal-300 bg-teal-50 px-3 py-2 text-xs text-teal-800">
          <span className="flex items-center gap-1.5 font-medium">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在逐版本执行真实闭环回测，共 {selected.length} 个版本。
          </span>
          <p className="mt-1 text-[11px] leading-relaxed">
            每个版本都会独立读取数据、独立记账并写入回测留档；版本较多或窗口较长时会耗时。
          </p>
        </div>
      )}

      {archivedResultQuery.isLoading && outcome.length === 0 && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在读取选中版本最近一次回测留档的完整结果…
          </span>
        </div>
      )}

      {archivedResultQuery.error && liveOutcome.length === 0 && (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <p className="font-medium">已有回测结果读取失败</p>
          <p className="mt-1 font-mono">{archivedResultQuery.error.message}</p>
        </div>
      )}

      {compare.error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <p className="font-medium">对比请求失败，未产生对比批次</p>
          <p className="mt-1 font-mono">{compare.error.message}</p>
        </div>
      )}

      {compare.data !== undefined && outcome.length === 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          对比批次已返回，但没有版本结果。请检查请求参数或服务端日志。
        </div>
      )}

      {outcome.length > 0 && (
        <SectionCard
          title="对比结果"
          description={
            usingArchivedResults
              ? `已加载回测留档结果 · ${outcome.map(entry => `v${entry.strategyVersion}`).join(" / ")} · 曲线与交易明细来自各版本最近一次留档`
              : `对比批次 ${compare.data?.comparisonId ?? "—"} · 统一窗口 ${compare.data?.dateRange.startDate ?? "—"} ~ ${compare.data?.dateRange.endDate ?? "—"} · ${outcome.filter(e => e.status !== "FAILED").length}/${outcome.length} 个版本运行成功`
          }
          right={
            <span className="text-[11px] text-muted-foreground">
              {usingArchivedResults ? (
                <span className="text-emerald-700">回测留档</span>
              ) : (
                formatDateTime(compare.data?.createdAt ?? "")
              )}
            </span>
          }
        >
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[1100px] text-xs">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">版本</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">总收益</th>
                  <th className="px-3 py-2">年化</th>
                  <th className="px-3 py-2">最大回撤</th>
                  <th className="px-3 py-2">Sharpe</th>
                  <th className="px-3 py-2">胜率</th>
                  <th className="px-3 py-2">盈亏比</th>
                  <th className="px-3 py-2">交易数</th>
                  <th className="px-3 py-2">期末权益</th>
                  <th className="px-3 py-2">留档 / Run</th>
                </tr>
              </thead>
              <tbody>
                {outcome.map(entry => {
                  const evaluation = entry.view?.evaluation ?? null;
                  const backtest = entry.view?.backtest ?? null;
                  const active =
                    selectedOutcome?.index === entry.index;
                  return (
                    <tr
                      key={`${entry.index}-${entry.strategyVersion}`}
                      className={`cursor-pointer border-t align-top ${
                        active ? "bg-teal-50/50" : ""
                      }`}
                      onClick={() =>
                        setSelectedOutcomeVersion(String(entry.index))
                      }
                    >
                      <td className="px-3 py-2.5 font-mono font-semibold">
                        v{entry.strategyVersion}
                      </td>
                      <td className="px-3 py-2.5">
                        {entry.status === "FAILED" ? (
                          <StatusBadge status="FAILED" label="FAILED" />
                        ) : (
                          <StatusBadge status={entry.status} />
                        )}
                      </td>
                      <td
                        className={`px-3 py-2.5 tabular-nums font-semibold ${tone(
                          evaluation?.totalReturnPct ?? null
                        )}`}
                      >
                        {fmtNum(evaluation?.totalReturnPct ?? null, 2, "%")}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {fmtNum(evaluation?.cagrPct ?? null, 2, "%")}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-emerald-700">
                        {fmtNum(evaluation?.maxDrawdownPct ?? null, 2, "%")}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {fmtNum(evaluation?.sharpeRatio ?? null, 4)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {fmtNum(evaluation?.winRatePct ?? null, 2, "%")}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {fmtNum(evaluation?.profitFactor ?? null, 4)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {evaluation?.completedTradeCount ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {fmtMoney(backtest?.finalEquity ?? null)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
                          <p>{entry.runId}</p>
                          {entry.archiveId !== null ? (
                            <Link
                              to={`/backtest-runs?id=${entry.archiveId}`}
                              className="underline underline-offset-2 hover:text-foreground"
                              onClick={e => e.stopPropagation()}
                            >
                              留档 #{entry.archiveId}
                            </Link>
                          ) : (
                            <p>无留档</p>
                          )}
                          {entry.view?.persistence?.persisted === false && (
                            <p className="text-rose-600">
                              留档失败：
                              {entry.view.persistence.errorCode ??
                                "CLOSED_LOOP_PERSIST_FAILED"}
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {outcome.some(entry => entry.failure !== null) && (
            <div className="mt-3 space-y-2">
              {outcome
                .filter(entry => entry.failure !== null)
                .map(entry => (
                  <div
                    key={`${entry.index}-${entry.strategyVersion}`}
                    className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800"
                  >
                    <p className="flex items-center gap-1.5 font-medium">
                      <TriangleAlert className="h-3.5 w-3.5" />
                      v{entry.strategyVersion} 运行失败
                    </p>
                    <p className="mt-1 font-mono">
                      {entry.failure?.code}
                    </p>
                    <p className="mt-0.5">{entry.failure?.message}</p>
                  </div>
                ))}
            </div>
          )}

          {curveData.length > 0 && (
            <div className="mt-4 rounded-md border px-3 py-3">
              <p className="text-xs font-medium">
                归一化净值对比（相对初始资金）
              </p>
              <div className="mt-2 w-full" style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={curveData}
                    margin={{ top: 8, right: 24, bottom: 4, left: 4 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="currentColor"
                      strokeOpacity={0.12}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      minTickGap={36}
                    />
                    <YAxis
                      tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip
                      formatter={(value: number) => `${value.toFixed(2)}%`}
                    />
                    <Legend />
                    {curveViews.map((item, index) => (
                      <Line
                        key={item.index}
                        type="monotone"
                        dataKey={`v${item.index}`}
                        name={`v${item.version}`}
                        stroke={
                          CURVE_COLORS[index % CURVE_COLORS.length]
                        }
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {selectedOutcome !== null &&
            selectedOutcome.view?.backtest !== null &&
            selectedOutcome.view?.backtest !== undefined && (
              <div className="mt-4 rounded-md border px-3 py-3">
                <p className="mb-2 text-xs font-medium">
                  v{selectedOutcome.strategyVersion} 交易明细
                </p>
                <BacktestTradeDetailsTable
                  backtest={selectedOutcome.view.backtest}
                />
              </div>
            )}
        </SectionCard>
      )}
    </div>
  );
}
