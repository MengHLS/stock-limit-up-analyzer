import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  GitCompareArrows,
  History,
  Loader2,
  RefreshCw,
  Tag,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationBar } from "@/components/PaginationBar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionCard, StatusBadge } from "@/components/common";
import { buildClosedLoopRunViewModel } from "@/adapters/closedLoopRunAdapter";
import { STRATEGY_VERSION_STATUS_OPTIONS } from "@/lib/status";
import { formatDateTime } from "@/lib/displayFormat";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import type { StrategyLifecycleStatusValue } from "@shared/researchContracts";

// 类型取自真实 tRPC 路由，不手写 DTO、不复制口径。
type RouterOutputs = inferRouterOutputs<AppRouter>;
type VersionRows = RouterOutputs["strategyDomain"]["strategy"]["listVersions"];
type LabeledDiff = RouterOutputs["strategyDomain"]["strategy"]["compare"];
type BacktestRows = RouterOutputs["researchRun"]["listBacktests"];

interface VersionBacktestMetric {
  archiveId: number;
  createdAt: string;
  totalReturnPct: number | null;
  maxDrawdownPct: number | null;
  loading: boolean;
  missingDetail: boolean;
  error: string | null;
}

function shortHash(h: string): string {
  return h.length <= 16 ? h : `${h.slice(0, 12)}…${h.slice(-4)}`;
}

/** 版本状态的人话说明（逐条对齐 §23 语义，不按字面翻译）。 */
const STATUS_HINT: Record<string, string> = {
  Draft: "草稿：尚未进入研究流程。",
  Research: "研究中：正在做假设与验证。",
  Candidate: "候选：有研究证据，等待取舍。",
  Validated: "已验证：通过了数据集门槛。",
  Paper: "纸面交易：前向跟踪，未投真金。",
  Approved: "已批准：评审通过，可上线。",
  Production: "生产中：实盘运行。",
  Retired: "已退役：终态。",
};

function MetricValue({
  value,
  tone,
}: {
  value: number | null;
  tone: "return" | "drawdown";
}) {
  const className =
    value === null || !Number.isFinite(value)
      ? "text-muted-foreground"
      : tone === "return"
        ? value >= 0
          ? "text-rose-600"
          : "text-emerald-700"
        : "text-emerald-700";
  return (
    <span className={`font-semibold tabular-nums ${className}`}>
      {value === null || !Number.isFinite(value)
        ? "—"
        : `${value.toFixed(2)}%`}
    </span>
  );
}

function BacktestMetricCard({
  metric,
}: {
  metric: VersionBacktestMetric | null;
}) {
  if (metric === null) {
    return (
      <div className="mt-3 rounded-md border border-dashed bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        暂无该版本的回测留档。到「运行回测」跑一次后，这里会显示结果指标。
      </div>
    );
  }

  if (metric.loading) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-md border border-dashed bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        正在读取这次留档的收益与回撤…
      </div>
    );
  }

  if (metric.error !== null) {
    return (
      <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
        指标读取失败：{metric.error}
      </div>
    );
  }

  if (metric.missingDetail) {
    return (
      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
        最新留档没有完整结果明细，无法读取收益与回撤。
      </div>
    );
  }

  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md border bg-muted/20 px-2.5 py-2">
          <p className="text-[10px] text-muted-foreground">最大收益率</p>
          <MetricValue value={metric.totalReturnPct} tone="return" />
        </div>
        <div className="rounded-md border bg-muted/20 px-2.5 py-2">
          <p className="text-[10px] text-muted-foreground">最大回撤</p>
          <MetricValue value={metric.maxDrawdownPct} tone="drawdown" />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          留档 {formatDateTime(metric.createdAt)}
        </span>
        <Link
          to={`/backtest-runs?id=${metric.archiveId}`}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 underline-offset-2 hover:underline"
        >
          <BarChart3 className="h-3 w-3" />
          查看完整结果
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </>
  );
}

export function StrategyVersionPanel({
  strategyId,
  version,
  versions,
  versionsLoading,
  onRefetchVersions,
  savedDocument,
  draftDocument,
}: {
  strategyId: string;
  version: string;
  /** 后端 `listVersions` 结果；`null` = 尚未取到。 */
  versions: VersionRows | null;
  versionsLoading: boolean;
  onRefetchVersions: () => void;
  /** 已落库的文档（上次「加载 / 保存」的产物）；`null` = 当前草稿尚无落库对照物。 */
  savedDocument: Record<string, unknown> | null;
  /** 当前草稿（`viewModelToStrategy(vm)`）—— 比较的右值。 */
  draftDocument: Record<string, unknown>;
}) {
  const compare = trpc.strategyDomain.strategy.compare.useMutation();
  const setStatus = trpc.strategyDomain.strategy.setVersionStatus.useMutation();

  const [nextStatus, setNextStatus] = useState<StrategyLifecycleStatusValue | "">("");
  const [diff, setDiff] = useState<LabeledDiff | null>(null);
  const [cmpError, setCmpError] = useState<string | null>(null);
  const [versionPage, setVersionPage] = useState(1);
  const [versionPageSize, setVersionPageSize] = useState(6);

  const current = versions?.find(v => v.version === version) ?? null;
  const currentStatus = current?.status ?? null;

  const archiveQuery = trpc.researchRun.listBacktests.useQuery(
    { strategyId, limit: 200 },
    { retry: false, refetchOnWindowFocus: false }
  );

  const latestArchiveByVersion = useMemo(() => {
    const rows = (archiveQuery.data ?? []) as BacktestRows;
    const byVersion = new Map<string, BacktestRows[number]>();
    for (const row of rows) {
      if (!byVersion.has(row.strategyVersion)) byVersion.set(row.strategyVersion, row);
    }
    return byVersion;
  }, [archiveQuery.data]);

  const orderedVersions = useMemo(
    () =>
      [...(versions ?? [])].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
      ),
    [versions]
  );
  const versionTotalPages = Math.max(
    1,
    Math.ceil(orderedVersions.length / versionPageSize)
  );
  const safeVersionPage = Math.min(Math.max(1, versionPage), versionTotalPages);
  const pagedVersions = orderedVersions.slice(
    (safeVersionPage - 1) * versionPageSize,
    safeVersionPage * versionPageSize
  );

  useEffect(() => {
    setVersionPage(1);
  }, [strategyId, versionPageSize]);

  const archiveIds = useMemo(
    () =>
      pagedVersions
        .map(v => latestArchiveByVersion.get(v.version)?.id ?? null)
        .filter((id): id is number => id !== null),
    [latestArchiveByVersion, pagedVersions]
  );
  const archiveDetails = trpc.useQueries(t =>
    archiveIds.map(id =>
      t.researchRun.getBacktest(
        { id },
        { retry: false, refetchOnWindowFocus: false }
      )
    )
  );
  const detailById = useMemo(() => {
    const map = new Map<number, (typeof archiveDetails)[number]>();
    archiveIds.forEach((id, index) => {
      const query = archiveDetails[index];
      if (query !== undefined) map.set(id, query);
    });
    return map;
  }, [archiveDetails, archiveIds]);

  function metricForVersion(version: string): VersionBacktestMetric | null {
    const archive = latestArchiveByVersion.get(version);
    if (archive === undefined) return null;
    const query = detailById.get(archive.id);
    if (query === undefined || query.isLoading) {
      return {
        archiveId: archive.id,
        createdAt: archive.createdAt,
        totalReturnPct: null,
        maxDrawdownPct: null,
        loading: true,
        missingDetail: false,
        error: null,
      };
    }
    if (query.error !== null) {
      return {
        archiveId: archive.id,
        createdAt: archive.createdAt,
        totalReturnPct: null,
        maxDrawdownPct: null,
        loading: false,
        missingDetail: false,
        error: query.error.message,
      };
    }
    if (query.data === null || query.data === undefined || query.data.result === null) {
      return {
        archiveId: archive.id,
        createdAt: archive.createdAt,
        totalReturnPct: null,
        maxDrawdownPct: null,
        loading: false,
        missingDetail: true,
        error: null,
      };
    }
    const view = buildClosedLoopRunViewModel(query.data.result);
    return {
      archiveId: archive.id,
      createdAt: archive.createdAt,
      totalReturnPct: view?.evaluation?.totalReturnPct ?? null,
      maxDrawdownPct: view?.evaluation?.maxDrawdownPct ?? null,
      loading: false,
      missingDetail: view === null,
      error: null,
    };
  }

  function runCompare() {
    if (savedDocument === null) return;
    setCmpError(null);
    compare.mutate(
      { left: savedDocument, right: draftDocument },
      { onSuccess: d => setDiff(d) }
    );
  }

  function applyStatus() {
    if (nextStatus === "") return;
    setStatus.mutate(
      { strategyId, version, status: nextStatus },
      {
        onSuccess: () => {
          toast.success("版本状态已更新", {
            description: `${strategyId}@${version} → ${nextStatus}`,
          });
          setNextStatus("");
          onRefetchVersions();
        },
        onError: e => toast.error("状态更新失败", { description: e.message }),
      }
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- 1. 版本历史（后端真实数据 + 最近留档指标） ---- */}
    <SectionCard
      title="版本历史"
      icon={History}
      description="按版本创建时间倒序；每张卡展示该版本最近一次回测留档的收益与回撤，并可直接查看完整结果。"
      right={
        <div className="flex items-center gap-2">
          <Link to={`/strategies/${encodeURIComponent(strategyId)}/compare`}>
            <Button size="sm" variant="outline">
              <GitCompareArrows className="mr-1.5 h-3.5 w-3.5" />
              回测对比
            </Button>
          </Link>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRefetchVersions}
            disabled={versionsLoading}
          >
            {versionsLoading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            刷新
          </Button>
        </div>
      }
    >
        {archiveQuery.error && (
          <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
            回测留档读取失败：{archiveQuery.error.message}
          </p>
        )}
        {versionsLoading && versions === null ? (
          <Skeleton className="h-16 w-full" />
        ) : orderedVersions.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无版本。</p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {pagedVersions.map(v => {
                const isCurrent = v.version === version;
                const metric = metricForVersion(v.version);
                return (
                  <div
                    key={v.version}
                    className={`rounded-lg border bg-card p-3 ${
                      isCurrent ? "border-orange-300 bg-orange-50/40" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold">
                            v{v.version}
                          </span>
                          <StatusBadge status={v.status} />
                          {isCurrent && (
                            <span className="text-[10px] font-medium text-orange-700">
                              当前载入
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {formatDateTime(v.createdAt)} · 父版本{" "}
                          <span className="font-mono">
                            {v.parentVersionId === null
                              ? "—"
                              : `#${v.parentVersionId}`}
                          </span>
                        </p>
                      </div>
                      <Link
                        to={`/strategies/${encodeURIComponent(strategyId)}?version=${encodeURIComponent(v.version)}`}
                      >
                        <Button
                          size="sm"
                          variant={isCurrent ? "secondary" : "outline"}
                        >
                          {isCurrent ? "当前" : "载入"}
                        </Button>
                      </Link>
                    </div>

                    <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                      <p className="truncate">
                        数据集{" "}
                        <span className="font-mono">
                          {v.datasetVersion || "—"}
                        </span>
                        {v.datasetVersionId !== null && (
                          <span> (id={v.datasetVersionId})</span>
                        )}
                      </p>
                      <p className="truncate" title={v.fingerprint}>
                        指纹{" "}
                        <span className="font-mono">
                          {shortHash(v.fingerprint)}
                        </span>
                      </p>
                    </div>

                    <BacktestMetricCard metric={metric} />
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <span className="text-[11px] text-muted-foreground">
                共 {orderedVersions.length} 个版本，本页第{" "}
                {(safeVersionPage - 1) * versionPageSize + 1}–
                {Math.min(
                  safeVersionPage * versionPageSize,
                  orderedVersions.length
                )}{" "}
                个
              </span>
              <PaginationBar
                page={safeVersionPage}
                totalPages={versionTotalPages}
                pageSize={versionPageSize}
                onPageChange={setVersionPage}
                onPageSizeChange={setVersionPageSize}
                pageSizeOptions={[6, 12, 24]}
              />
            </div>
          </div>
        )}
      </SectionCard>

      {/* ---- 2. 草稿 ↔ 已保存版本 差异 ---- */}
      <SectionCard
        title="这次改了什么"
        icon={GitCompareArrows}
        description="拿「当前编辑器里的草稿」与「已落库的这一版」逐字段比对——不需要手写 JSON。"
        right={
          <Button
            size="sm"
            onClick={runCompare}
            disabled={savedDocument === null || compare.isPending}
          >
            {compare.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            比较
          </Button>
        }
      >
        {savedDocument === null ? (
          <p className="text-[11px] text-muted-foreground">
            没有落库对照物 —— 先「保存」，或在版本历史里「载入」一个版本。
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            左：已落库{" "}
            <code className="font-mono">
              {strategyId}@{version}
            </code>
            ；右：当前草稿（忽略 version / fingerprint）。
          </p>
        )}

        {cmpError && (
          <p className="mt-2 font-mono text-xs text-red-600">{cmpError}</p>
        )}
        {compare.error && (
          <p className="mt-2 font-mono text-xs text-red-600">
            {compare.error.message}
          </p>
        )}

        {diff && (
          <div className="mt-3 space-y-2">
            {diff.equal ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                与已落库版本一致（忽略 version / fingerprint），无未保存改动。
              </div>
            ) : (
              <>
                <StatusBadge
                  status="INCONCLUSIVE"
                  label={`${diff.differences.length} 处差异`}
                />
                <div className="overflow-x-auto rounded-md border">
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-56 px-3 py-2">路径</TableHead>
                        <TableHead className="w-24 px-3 py-2">类型</TableHead>
                        <TableHead className="px-3 py-2">
                          已保存 → 草稿
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {diff.differences.map((d, i) => (
                        <TableRow key={`${d.path}-${i}`}>
                          <TableCell className="px-3 py-2 font-mono text-[11px]">
                            {d.path}
                          </TableCell>
                          <TableCell className="px-3 py-2">{d.kind}</TableCell>
                          <TableCell className="px-3 py-2 font-mono text-[11px]">
                            <span className="text-muted-foreground">
                              {d.left === undefined
                                ? "∅"
                                : JSON.stringify(d.left)}
                            </span>
                            <span className="mx-1 text-muted-foreground">→</span>
                            <span className="text-foreground">
                              {d.right === undefined
                                ? "∅"
                                : JSON.stringify(d.right)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}
      </SectionCard>

      {/* ---- 3. 版本状态推进（真实写库） ---- */}
      <SectionCard
        title="版本状态"
        icon={Tag}
        description="只改 status 一列；策略内容不可变。"
        right={
          currentStatus !== null ? (
            <StatusBadge status={currentStatus} />
          ) : undefined
        }
      >
        {currentStatus === null ? (
          <p className="text-xs text-muted-foreground">取不到该版本状态。</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {STATUS_HINT[currentStatus] ?? "（该状态暂无说明）"}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="ver-status">迁移至</Label>
                <Select
                  value={nextStatus === "" ? undefined : nextStatus}
                  onValueChange={v =>
                    setNextStatus(v as StrategyLifecycleStatusValue)
                  }
                >
                  <SelectTrigger id="ver-status" className="w-56 text-sm">
                    <SelectValue placeholder="选择目标状态" />
                  </SelectTrigger>
                  <SelectContent>
                    {STRATEGY_VERSION_STATUS_OPTIONS.map(s => (
                      <SelectItem key={s} value={s}>
                        {s}
                        {s === currentStatus ? "（当前）" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                onClick={applyStatus}
                disabled={nextStatus === "" || setStatus.isPending}
              >
                {setStatus.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                应用
              </Button>
            </div>
            {nextStatus !== "" && (
              <p className="text-[11px] text-muted-foreground">
                目标语义：{STATUS_HINT[nextStatus] ?? "（暂无说明）"}
              </p>
            )}
            {setStatus.error && (
              <p className="font-mono text-xs text-red-600">
                {setStatus.error.message}
              </p>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              ⚠️ 真实写库：即刻改变该版本的生命周期状态，不改策略内容、不新建版本。
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
