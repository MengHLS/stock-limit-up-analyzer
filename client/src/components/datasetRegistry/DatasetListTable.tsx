/**
 * DatasetListTable — Dataset Registry 列表表格（STEP DATASET-002.3）。
 *
 * 复用 DataTable / StatusBadge / Skeleton。每个 Dataset 的版本元信息（versionCount /
 * latestVersion / latestVersionStatus）由行级组件按需 `listVersions` 拉取并聚合，
 * 避免在父层循环调用 hooks（契约无「列表 + 版本聚合」批量端点，故用行级查询）。
 * 导航用 wouter Link。
 */

import { trpc } from "@/lib/trpc";
import { DataTable, StatusBadge } from "@/components/common";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import {
  buildDatasetListRow,
  formatDateTime,
  type DatasetListRowVm,
} from "@/adapters/datasetRegistryAdapter";
import type { DatasetDefinitionListItem } from "@shared/datasetRegistryContracts";

function DatasetListRow({ def }: { def: DatasetDefinitionListItem }) {
  const versions = trpc.datasetRegistry.listVersions.useQuery({
    datasetId: def.id,
  });
  const row: DatasetListRowVm | null = versions.data
    ? buildDatasetListRow(def, versions.data)
    : null;
  const metaLoading = versions.isLoading;
  const metaFailed = versions.isError;

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        <div className="flex items-center gap-1.5">
          <span>{def.datasetCode}</span>
          {!def.buildable && (
            <span
              className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-normal text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
              title="该 datasetCode 尚未注册构建插件：可管理定义与版本，但构建会被拒绝"
            >
              待实现
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-xs font-medium">{def.name}</TableCell>
      <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
        {def.description ?? "—"}
      </TableCell>
      <TableCell>
        <StatusBadge status={def.status} />
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {metaLoading ? (
          <Skeleton className="ml-auto h-3 w-6" />
        ) : metaFailed ? (
          "—"
        ) : (
          row?.versionCount ?? "—"
        )}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {metaLoading ? (
          <Skeleton className="h-3 w-12" />
        ) : metaFailed ? (
          "—"
        ) : (
          row?.latestVersion ?? "—"
        )}
      </TableCell>
      <TableCell>
        {metaLoading ? (
          <Skeleton className="h-4 w-14" />
        ) : row?.latestVersionStatus ? (
          <StatusBadge status={row.latestVersionStatus} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="font-mono text-[11px] text-muted-foreground">
        {formatDateTime(def.updatedAt)}
      </TableCell>
      <TableCell>
        <Link
          href={`/datasets/${def.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          查看详情 <ArrowRight className="h-3 w-3" />
        </Link>
      </TableCell>
    </TableRow>
  );
}

export function DatasetListTable({
  definitions,
}: {
  definitions: DatasetDefinitionListItem[];
}) {
  return (
    <DataTable>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs">Code</TableHead>
          <TableHead className="text-xs">名称</TableHead>
          <TableHead className="text-xs">描述</TableHead>
          <TableHead className="w-20 text-xs">状态</TableHead>
          <TableHead className="w-20 text-right text-xs">版本数</TableHead>
          <TableHead className="text-xs">最新版本</TableHead>
          <TableHead className="w-24 text-xs">最新状态</TableHead>
          <TableHead className="w-40 text-xs">更新时间</TableHead>
          <TableHead className="w-24 text-xs">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {definitions.map((def) => (
          <DatasetListRow key={def.id} def={def} />
        ))}
      </TableBody>
    </DataTable>
  );
}
