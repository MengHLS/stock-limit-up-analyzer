/**
 * Dataset Registry — Dataset 详情页（/datasets/:datasetId，STEP DATASET-002.3）。
 *
 * Tabs：Overview / Versions / Jobs / Statistics。
 * - Overview：定义级字段 + 物理表 + 时间戳；
 * - Versions：该定义下全部逻辑版本（getDefinition.versions）；
 * - Jobs / Statistics：按版本分组，行级组件按需拉取 listJobs / getStatistics（契约无批量端点）。
 */

import { trpc } from "@/lib/trpc";
import { useParams, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, SectionCard } from "@/components/common";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Boxes,
  Braces,
  Database,
  Hammer,
  Layers,
  BarChart3,
} from "lucide-react";
import {
  BuildJobTable,
  BuildVersionDialog,
  DeleteDatasetDialog,
  StatisticsGrid,
  VersionListTable,
} from "@/components/datasetRegistry";
import {
  formatDateTime,
  jobToVm,
  rpcErrorToDiagnostic,
  statisticsToVm,
  versionToVm,
} from "@/adapters/datasetRegistryAdapter";
import type {
  DatasetDefinitionDetail,
  DatasetVersionListItem,
} from "@shared/datasetRegistryContracts";

function OverviewTab({ definition }: { definition: DatasetDefinitionDetail }) {
  const tables: Array<{ role: string; name: string | null }> = [
    { role: "event", name: definition.eventTableName },
    { role: "prefix", name: definition.prefixTableName },
    { role: "post", name: definition.postTableName },
    { role: "path", name: definition.pathTableName },
    { role: "outcome", name: definition.outcomeTableName },
    { role: "feature", name: definition.featureTableName },
  ];
  return (
    <div className="space-y-4">
      <SectionCard title="基本信息" icon={Database}>
        <div className="space-y-1 text-sm">
          <Row k="Dataset Code" v={definition.datasetCode} mono />
          <Row k="Name" v={definition.name} />
          <Row k="Description" v={definition.description ?? "—"} />
          <Row k="Type" v={definition.datasetType} mono />
          <Row k="Storage" v={definition.storageType} mono />
          <Row k="Status" v={definition.status} mono />
          <Row k="Created At" v={formatDateTime(definition.createdAt)} mono />
          <Row k="Updated At" v={formatDateTime(definition.updatedAt)} mono />
        </div>
      </SectionCard>

      <SectionCard title="Physical Tables" icon={Braces}>
        <div className="space-y-1.5">
          {tables.map((t) => (
            <div
              key={t.role}
              className="flex items-center justify-between rounded border px-3 py-1.5"
            >
              <span className="font-mono text-xs text-muted-foreground">
                {t.role}
              </span>
              <span className="font-mono text-xs">{t.name ?? "—"}</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
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

function VersionJobs({ version }: { version: DatasetVersionListItem }) {
  const jobs = trpc.datasetRegistry.listJobs.useQuery({
    datasetVersionId: version.id,
  });
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        Version <span className="font-mono">{version.version}</span>
      </p>
      {jobs.isLoading && (
        <Skeleton className="h-20 w-full" />
      )}
      {jobs.error && (
        <ErrorState
          error={rpcErrorToDiagnostic(jobs.error.message, {
            title: `版本 ${version.version} 作业加载失败`,
          })}
        />
      )}
      {jobs.data && (
        <BuildJobTable
          jobs={jobs.data.map(jobToVm)}
          totalRows={version.totalRows}
        />
      )}
    </div>
  );
}

function VersionStats({ version }: { version: DatasetVersionListItem }) {
  const stats = trpc.datasetRegistry.getStatistics.useQuery({
    datasetVersionId: version.id,
  });
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        Version <span className="font-mono">{version.version}</span>
      </p>
      {stats.isLoading && <Skeleton className="h-32 w-full" />}
      {stats.error && (
        <ErrorState
          error={rpcErrorToDiagnostic(stats.error.message, {
            title: `版本 ${version.version} 统计加载失败`,
          })}
        />
      )}
      {stats.data && <StatisticsGrid stats={statisticsToVm(stats.data)} />}
    </div>
  );
}

export default function DatasetDetail() {
  const params = useParams();
  const [, navigate] = useLocation();
  const definitionId = Number(params.datasetId);
  const definition = trpc.datasetRegistry.getDefinition.useQuery(
    { definitionId },
    { enabled: Number.isFinite(definitionId) && definitionId > 0 },
  );

  const invalidId = !Number.isFinite(definitionId) || definitionId <= 0;
  const versionLabels = definition.data?.versions.map((v) => v.version) ?? [];
  const buildable = definition.data?.buildable ?? true;
  const canBuild = definition.data?.status !== "ARCHIVED" && buildable;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Boxes className="h-4 w-4" /> Dataset 详情
            </CardTitle>
            <CardDescription>
              {definition.data
                ? `${definition.data.name}（${definition.data.datasetCode}）`
                : "加载定义…"}
            </CardDescription>
          </div>
          {definition.data && (
            <div className="flex shrink-0 items-center gap-2">
              {canBuild && (
                <BuildVersionDialog
                  datasetId={definitionId}
                  datasetCode={definition.data.datasetCode}
                  existingVersions={versionLabels}
                  onCreated={(versionId) =>
                    navigate(`/datasets/${definitionId}/versions/${versionId}`)
                  }
                />
              )}
              <DeleteDatasetDialog
                definitionId={definitionId}
                datasetCode={definition.data.datasetCode}
                onDeleted={() => navigate("/datasets")}
              />
            </div>
          )}
        </CardHeader>
      </Card>

      {invalidId && (
        <ErrorState
          error={{
            code: "BAD_REQUEST",
            title: "无效的 Dataset ID",
            explanation: "URL 中的 datasetId 不是合法整数。",
            suggestions: ["返回 Dataset 列表重新选择"],
          }}
        />
      )}

      {!invalidId && definition.isLoading && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      )}

      {!invalidId && definition.error && !definition.isLoading && (
        <ErrorState
          error={rpcErrorToDiagnostic(definition.error.message, {
            title: "Dataset 定义加载失败",
          })}
        />
      )}

      {!invalidId && definition.data && (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview" className="flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="versions" className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" /> Versions
            </TabsTrigger>
            <TabsTrigger value="jobs" className="flex items-center gap-1.5">
              <Hammer className="h-3.5 w-3.5" /> Jobs
            </TabsTrigger>
            <TabsTrigger value="statistics" className="flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" /> Statistics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="pt-3">
            <OverviewTab definition={definition.data} />
          </TabsContent>

          <TabsContent value="versions" className="space-y-3 pt-3">
            {definition.data.versions.length === 0 ? (
              <EmptyState
                icon={Layers}
                title="暂无版本"
                action={
                  canBuild ? (
                    <BuildVersionDialog
                      datasetId={definitionId}
                      datasetCode={definition.data.datasetCode}
                      existingVersions={versionLabels}
                      onCreated={(versionId) =>
                        navigate(`/datasets/${definitionId}/versions/${versionId}`)
                      }
                    />
                  ) : undefined
                }
              />
            ) : (
              <VersionListTable
                datasetId={definitionId}
                versions={definition.data.versions.map(versionToVm)}
              />
            )}
          </TabsContent>

          <TabsContent value="jobs" className="space-y-4 pt-3">
            {definition.data.versions.map((v) => (
              <VersionJobs key={v.id} version={v} />
            ))}
          </TabsContent>

          <TabsContent value="statistics" className="space-y-4 pt-3">
            {definition.data.versions.map((v) => (
              <VersionStats key={v.id} version={v} />
            ))}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
