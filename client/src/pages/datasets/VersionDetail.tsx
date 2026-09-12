/**
 * Dataset Registry — Version 详情页（/datasets/:datasetId/versions/:versionId，STEP DATASET-002.3）。
 *
 * 展示：Version / Status（StatusBadge 统一色系）、Dataset Version ID、Created At、
 * Build Time、Row/Event 计数、日期区间、Source/Definition 摘要、Build Job 状态，
 * 以及 Event / Path / Outcome 明细预览（keyset 分页，禁止 OFFSET / 全量）。
 */

import { trpc } from "@/lib/trpc";
import { useParams, useLocation, Link } from "wouter";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, SectionCard, StatusBadge } from "@/components/common";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarRange,
  FileText,
  Filter,
  GitBranch,
  Layers,
  RefreshCw,
  TableProperties,
} from "lucide-react";
import {
  BuildJobTable,
  DeleteDatasetVersionDialog,
  StatisticsGrid,
  VersionBuildControls,
} from "@/components/datasetRegistry";
import { DatasetPreviewTable } from "@/components/datasetRegistry";
import {
  formatCount,
  formatDateTime,
  jobToVm,
  rpcErrorToDiagnostic,
  statisticsToVm,
  type BuildJobVm,
} from "@/adapters/datasetRegistryAdapter";
import {
  DATASET_BOARD_LABELS,
  DATASET_EVENT_KIND_LABELS,
  describeDatasetFilter,
} from "@shared/datasetRegistryContracts";

function buildDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return "—";
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

function Row({
  k,
  v,
  mono = false,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{k}</span>
      <span className={`text-right text-sm ${mono ? "font-mono tabular-nums" : ""}`}>
        {v}
      </span>
    </div>
  );
}

export default function VersionDetail() {
  const params = useParams();
  const [, navigate] = useLocation();
  const datasetId = Number(params.datasetId);
  const versionId = Number(params.versionId);
  const valid =
    Number.isFinite(datasetId) &&
    datasetId > 0 &&
    Number.isFinite(versionId) &&
    versionId > 0;

  const utils = trpc.useUtils();

  // 构建进行中（版本 BUILDING 或存在 RUNNING/PENDING 作业）→ 轮询刷新进度。
  const versionQuery = trpc.datasetRegistry.getVersion.useQuery(
    { datasetVersionId: versionId },
    {
      enabled: valid,
      refetchInterval: (query) => {
        const d = query.state.data;
        if (!d) return false;
        if (d.status === "BUILDING") return 3000;
        if (d.jobs.some((j) => j.status === "RUNNING" || j.status === "PENDING")) return 3000;
        return false;
      },
    },
  );
  const statistics = trpc.datasetRegistry.getStatistics.useQuery(
    { datasetVersionId: versionId },
    {
      enabled: valid,
      // 构建期间统计为「最近一次落库」；BUILDING 时轻度轮询，完成后即为终值。
      refetchInterval: () => (versionQuery.data?.status === "BUILDING" ? 5000 : false),
    },
  );
  const definition = trpc.datasetRegistry.getDefinition.useQuery(
    { definitionId: datasetId },
    { enabled: valid },
  );

  const cancelJob = trpc.datasetRegistry.cancelBuildJob.useMutation();
  const retryJob = trpc.datasetRegistry.retryBuildJob.useMutation();
  const jobBusy = cancelJob.isPending || retryJob.isPending;

  const version = versionQuery.data;
  const live =
    version?.status === "BUILDING" ||
    (version?.jobs.some((j) => j.status === "RUNNING" || j.status === "PENDING") ?? false);

  async function refreshVersion() {
    await utils.datasetRegistry.getVersion.invalidate({ datasetVersionId: versionId });
    await utils.datasetRegistry.listJobs.invalidate({ datasetVersionId: versionId });
    await utils.datasetRegistry.getStatistics.invalidate({ datasetVersionId: versionId });
  }

  async function handleCancelJob(job: BuildJobVm) {
    try {
      // 取消 = 回滚：后端先停执行体，再落终态 + 清空该版本已落库数据，并回报真实清理行数。
      const res = await cancelJob.mutateAsync({ jobId: job.jobId });
      if (res.rollback) {
        toast.success(`已取消并回滚：作业 ${job.jobId}（清空 ${res.rollback.purgedRows} 行）`);
      } else {
        toast.warning(res.rollbackSkippedReason ?? `已请求取消：作业 ${job.jobId}（未回滚数据）`);
      }
      await refreshVersion();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRetryJob(job: BuildJobVm) {
    try {
      const next = await retryJob.mutateAsync({ jobId: job.jobId });
      toast.success(`已创建重试作业：${next.jobId}（历史作业保留）`);
      await refreshVersion();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4" /> Version 详情
            {version && (
              <>
                <span className="font-mono">{version.version}</span>
                <StatusBadge status={version.status} />
                {live && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                    <RefreshCw className="h-3 w-3 animate-spin" /> 构建中，实时刷新
                  </span>
                )}
              </>
            )}
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            <Link
              href={`/datasets/${datasetId}/versions`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ArrowLeft className="h-3 w-3" /> 返回版本列表
            </Link>
            {definition.data && (
              <span className="text-muted-foreground">
                {definition.data.name}（{definition.data.datasetCode}）
              </span>
            )}
          </CardDescription>
        </CardHeader>
        {valid && version && (
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-0">
            {definition.data?.buildable === false ? (
              <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" />
                该数据集（{definition.data.datasetCode}）暂无构建实现，构建入口已禁用；仍可删除该版本。
              </p>
            ) : (
              <VersionBuildControls
                datasetVersionId={version.id}
                versionLabel={version.version}
                versionStatus={version.status}
                jobs={version.jobs}
              />
            )}
            <DeleteDatasetVersionDialog
              datasetVersionId={version.id}
              datasetId={datasetId}
              versionLabel={version.version}
              onDeleted={() => navigate(`/datasets/${datasetId}/versions`)}
            />
          </CardContent>
        )}
      </Card>

      {!valid && (
        <ErrorState
          error={{
            code: "BAD_REQUEST",
            title: "无效的 ID",
            explanation: "URL 中的 datasetId 或 versionId 不是合法整数。",
            suggestions: ["返回 Dataset 列表重新选择"],
          }}
        />
      )}

      {valid && versionQuery.isLoading && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      )}

      {valid && versionQuery.error && !versionQuery.isLoading && (
        <ErrorState
          error={rpcErrorToDiagnostic(versionQuery.error.message, {
            title: "版本详情加载失败",
          })}
        />
      )}

      {valid && version && (
        <>
          {/* 版本概览 */}
          <SectionCard
            title="Version 概览"
            icon={Layers}
            right={<StatusBadge status={version.status} />}
            description="逻辑版本元信息；状态 DRAFT / BUILDING / READY / FAILED 统一色系"
          >
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <Row k="Version" v={version.version} mono />
              <Row k="Dataset Version ID" v={version.id} mono />
              <Row k="Status" v={version.status} mono />
              <Row
                k="Date Range"
                v={
                  version.startDate && version.endDate
                    ? `${version.startDate} → ${version.endDate}`
                    : version.startDate
                      ? `${version.startDate} → —`
                      : "—"
                }
                mono
              />
              <Row k="Total Events（声明）" v={formatCount(version.totalEvents)} mono />
              <Row k="Total Rows（声明）" v={formatCount(version.totalRows)} mono />
              <Row k="Created At" v={formatDateTime(version.createdAt)} mono />
              <Row k="Completed At" v={formatDateTime(version.completedAt)} mono />
              <Row
                k="Build Time"
                v={buildDuration(version.createdAt, version.completedAt)}
                mono
              />
            </div>

            <p className="mb-1 mt-4 text-xs font-semibold text-muted-foreground">
              Source / Definition 摘要
            </p>
            <div className="space-y-1 rounded-md border px-3 py-2">
              <Row k="featureVersion" v={version.featureVersion ?? "—"} mono />
              <Row k="sourceVersion" v={version.sourceVersion ?? "—"} mono />
            </div>

            <p className="mb-1 mt-4 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Filter className="h-3.5 w-3.5" /> 构建筛选口径
            </p>
            <div className="space-y-1 rounded-md border px-3 py-2">
              {version.buildConfig ? (
                <>
                  <Row
                    k="筛选摘要"
                    v={
                      <span className="font-mono text-xs">
                        {describeDatasetFilter(version.buildConfig)}
                      </span>
                    }
                  />
                  <Row
                    k="板块"
                    v={
                      version.buildConfig.boards.length > 0
                        ? version.buildConfig.boards
                            .map((b) => DATASET_BOARD_LABELS[b])
                            .join(" · ")
                        : "全板块"
                    }
                  />
                  <Row k="排除 ST" v={version.buildConfig.excludeSt ? "是（PIT 状态）" : "否"} />
                  <Row
                    k="事件维度"
                    v={
                      <span className="font-mono text-xs">
                        {version.buildConfig.events
                          .map(
                            (e) =>
                              `${e.relativeDay === 0 ? "T日" : `T${e.relativeDay}日`}·${
                                DATASET_EVENT_KIND_LABELS[e.kind]
                              }`,
                          )
                          .join(" 或 ")}
                      </span>
                    }
                  />
                  <Row
                    k="数据天数范围"
                    v={`t-${version.buildConfig.preWindowDays} .. t+${version.buildConfig.postWindowDays}（交易日）`}
                    mono
                  />
                  <Row
                    k="结果视界"
                    v={`${version.buildConfig.outcomeHorizons.join(" / ")} 日`}
                    mono
                  />
                  <Row k="批大小" v={formatCount(version.buildConfig.batchSize)} mono />
                  <Row
                    k="配置版本 / 更新时间"
                    v={`v${version.buildConfig.configVersion} · ${formatDateTime(version.buildConfig.updatedAt)}`}
                    mono
                  />
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  该版本无筛选配置文件（DATASET-003B 之前创建的旧版本），构建按历史默认口径执行。
                </p>
              )}
            </div>
          </SectionCard>

          {/* 统计 */}
          {statistics.isLoading && (
            <Skeleton className="h-40 w-full" />
          )}
          {statistics.error && (
            <ErrorState
              error={rpcErrorToDiagnostic(statistics.error.message, {
                title: "统计加载失败",
              })}
            />
          )}
          {statistics.data && (
            <StatisticsGrid stats={statisticsToVm(statistics.data)} />
          )}

          {/* 构建作业 */}
          <BuildJobTable
            jobs={version.jobs.map(jobToVm)}
            totalRows={version.totalRows}
            onCancel={handleCancelJob}
            onRetry={handleRetryJob}
            busy={jobBusy}
          />

          {/* 明细预览 */}
          <SectionCard title="Event / Prefix / Post / Path / Outcome 预览" icon={TableProperties}>
            <Tabs defaultValue="event">
              <TabsList>
                <TabsTrigger value="event" className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Event
                </TabsTrigger>
                <TabsTrigger value="prefix" className="flex items-center gap-1.5">
                  <ArrowDown className="h-3.5 w-3.5" /> Prefix
                </TabsTrigger>
                <TabsTrigger value="post" className="flex items-center gap-1.5">
                  <ArrowUp className="h-3.5 w-3.5" /> Post
                </TabsTrigger>
                <TabsTrigger value="path" className="flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5" /> Path
                </TabsTrigger>
                <TabsTrigger value="outcome" className="flex items-center gap-1.5">
                  <CalendarRange className="h-3.5 w-3.5" /> Outcome
                </TabsTrigger>
              </TabsList>
              <TabsContent value="event" className="pt-3">
                <DatasetPreviewTable table="event" versionId={version.id} />
              </TabsContent>
              <TabsContent value="prefix" className="pt-3">
                <DatasetPreviewTable table="prefix" versionId={version.id} />
              </TabsContent>
              <TabsContent value="post" className="pt-3">
                <DatasetPreviewTable table="post" versionId={version.id} />
              </TabsContent>
              <TabsContent value="path" className="pt-3">
                <DatasetPreviewTable table="path" versionId={version.id} />
              </TabsContent>
              <TabsContent value="outcome" className="pt-3">
                <DatasetPreviewTable table="outcome" versionId={version.id} />
              </TabsContent>
            </Tabs>
          </SectionCard>
        </>
      )}
    </div>
  );
}
