/**
 * Dataset Registry — Version 列表页（/datasets/:datasetId/versions，STEP DATASET-002.3）。
 *
 * 与 Dataset 详情页的 Versions 标签内容一致，但作为独立路由（任务 §三 Route Matrix）。
 * 数据复用 getDefinition（含 versions），只读展示。
 */

import { trpc } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/common";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft, Layers } from "lucide-react";
import { VersionListTable } from "@/components/datasetRegistry";
import {
  rpcErrorToDiagnostic,
  versionToVm,
} from "@/adapters/datasetRegistryAdapter";

export default function VersionList() {
  const params = useParams();
  const datasetId = Number(params.datasetId);
  const definition = trpc.datasetRegistry.getDefinition.useQuery(
    { definitionId: datasetId },
    { enabled: Number.isFinite(datasetId) && datasetId > 0 },
  );
  const invalidId = !Number.isFinite(datasetId) || datasetId <= 0;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" /> Version 列表
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            <Link
              href={`/datasets/${datasetId}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ArrowLeft className="h-3 w-3" /> 返回 Dataset 详情
            </Link>
            {definition.data && (
              <span className="text-muted-foreground">
                {definition.data.name}（{definition.data.datasetCode}）
              </span>
            )}
          </CardDescription>
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
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}

      {!invalidId && definition.error && !definition.isLoading && (
        <ErrorState
          error={rpcErrorToDiagnostic(definition.error.message, {
            title: "版本列表加载失败",
          })}
        />
      )}

      {!invalidId &&
        definition.data &&
        definition.data.versions.length === 0 && (
          <Card>
            <CardContent className="p-4">
              <EmptyState
                icon={Layers}
                title="暂无版本"
                description="该 Dataset 还没有任何逻辑版本。"
              />
            </CardContent>
          </Card>
        )}

      {!invalidId && definition.data && definition.data.versions.length > 0 && (
        <VersionListTable
          datasetId={datasetId}
          versions={definition.data.versions.map(versionToVm)}
        />
      )}
    </div>
  );
}
