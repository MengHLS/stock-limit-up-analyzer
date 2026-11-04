/**
 * Dataset Registry — Dataset 列表页（/datasets，STEP DATASET-002.3）。
 *
 * 只读展示所有 Dataset 定义及其版本元信息（版本数 / 最新版本 / 最新版本状态）。
 * 与旧 /dataset-builder（Research Dataset 构建器）严格分离，不共用状态、不互相影响。
 */

import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/common";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Database, Layers } from "lucide-react";
import {
  CreateDatasetDialog,
  DatasetListTable,
} from "@/components/datasetRegistry";
import { rpcErrorToDiagnostic } from "@/adapters/datasetRegistryAdapter";

export default function DatasetList() {
  const [, navigate] = useLocation();
  const definitions = trpc.datasetRegistry.listDefinitions.useQuery();

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" /> Dataset Registry
            </CardTitle>
          </div>
          <CreateDatasetDialog onCreated={(id) => navigate(`/datasets/${id}`)} />
        </CardHeader>
      </Card>

      {definitions.isLoading && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}

      {definitions.error && !definitions.isLoading && (
        <ErrorState
          error={rpcErrorToDiagnostic(definitions.error.message, {
            title: "Dataset 列表加载失败",
          })}
        />
      )}

      {definitions.data && definitions.data.length === 0 && (
        <Card>
          <CardContent className="p-4">
            <EmptyState
              icon={Database}
              title="暂无 Dataset 定义"
              action={
                <CreateDatasetDialog
                  onCreated={(id) => navigate(`/datasets/${id}`)}
                />
              }
            />
          </CardContent>
        </Card>
      )}

      {definitions.data && definitions.data.length > 0 && (
        <DatasetListTable definitions={definitions.data} />
      )}
    </div>
  );
}
