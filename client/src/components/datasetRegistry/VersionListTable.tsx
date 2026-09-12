/**
 * VersionListTable — Dataset Registry 版本列表表格（STEP DATASET-002.3 / 003A）。
 *
 * 复用 DataTable / StatusBadge；版本状态 DRAFT/BUILDING/READY/FAILED 走统一 status 颜色体系。
 * 导航用 wouter Link。DATASET-003A 增加行级「删除版本」（删数据 + 作业，保留表结构）。
 */

import { DataTable, StatusBadge } from "@/components/common";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowRight, Trash2 } from "lucide-react";
import { DeleteDatasetVersionDialog } from "./DeleteDatasetVersionDialog";
import {
  formatCount,
  formatDateTime,
  type VersionListItemVm,
} from "@/adapters/datasetRegistryAdapter";

export function VersionListTable({
  datasetId,
  versions,
}: {
  datasetId: number;
  versions: VersionListItemVm[];
}) {
  return (
    <DataTable>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs">Version</TableHead>
          <TableHead className="w-24 text-xs">状态</TableHead>
          <TableHead className="text-xs">日期区间</TableHead>
          <TableHead className="text-right text-xs">事件数</TableHead>
          <TableHead className="text-right text-xs">行数</TableHead>
          <TableHead className="text-xs">feature / source</TableHead>
          <TableHead className="w-40 text-xs">创建时间</TableHead>
          <TableHead className="w-32 text-xs">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {versions.map((v) => (
          <TableRow key={v.id}>
            <TableCell className="font-mono text-xs">{v.version}</TableCell>
            <TableCell>
              <StatusBadge status={v.status} />
            </TableCell>
            <TableCell className="font-mono text-xs">{v.dateRange}</TableCell>
            <TableCell className="text-right font-mono text-xs tabular-nums">
              {formatCount(v.totalEvents)}
            </TableCell>
            <TableCell className="text-right font-mono text-xs tabular-nums">
              {formatCount(v.totalRows)}
            </TableCell>
            <TableCell className="font-mono text-[11px] text-muted-foreground">
              {v.featureVersion ?? "—"} / {v.sourceVersion ?? "—"}
            </TableCell>
            <TableCell className="font-mono text-[11px] text-muted-foreground">
              {formatDateTime(v.createdAt)}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Link
                  href={`/datasets/${datasetId}/versions/${v.id}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  查看 <ArrowRight className="h-3 w-3" />
                </Link>
                <DeleteDatasetVersionDialog
                  datasetVersionId={v.id}
                  datasetId={datasetId}
                  versionLabel={v.version}
                  trigger={
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      title={`删除版本 ${v.version}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  }
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </DataTable>
  );
}
