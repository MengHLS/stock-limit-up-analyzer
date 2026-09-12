/**
 * ResearchList — 研究实验列表（`/research`，RESEARCH-002 前端工作台入口）。
 *
 * 一屏回答三个问题：有哪些实验、各自跑到哪一步、点进去看什么。
 * 不在此页做任何统计：样本量、状态、时间全部是后端事实的直接展示。
 */

import { useState } from "react";
import { Link } from "wouter";
import { FlaskConical } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, ErrorState, StatusBadge } from "@/components/common";
import {
  experimentToVm,
  formatCount,
  formatDateTime,
  rpcErrorToDiagnostic,
} from "@/adapters/researchEngineAdapter";
import { CreateExperimentDialog, researchTypeLabelOf } from "@/components/research";

const STATUS_OPTIONS = [
  { value: "ALL", label: "全部状态" },
  { value: "DRAFT", label: "草稿" },
  { value: "READY", label: "就绪" },
  { value: "RUNNING", label: "运行中" },
  { value: "COMPLETED", label: "已完成" },
  { value: "FAILED", label: "失败" },
  { value: "ARCHIVED", label: "已归档" },
];

export default function ResearchList() {
  const [status, setStatus] = useState("ALL");

  const experiments = trpc.researchEngine.listExperiments.useQuery(
    status === "ALL" ? {} : { status: status as never },
  );

  const rows = (experiments.data ?? []).map(experimentToVm);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="h-4 w-4" /> 研究实验
            </CardTitle>
            <CardDescription>
              实验绑定一个固定的 Dataset 版本；一次实验可包含多次 Run，每次 Run 下挂多个分析。
              引擎只读 Dataset，绝不修改它。
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <CreateExperimentDialog />
          </div>
        </CardHeader>
      </Card>

      {experiments.isLoading && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      )}

      {experiments.error && !experiments.isLoading && (
        <ErrorState
          error={rpcErrorToDiagnostic(experiments.error.message, { title: "实验列表加载失败" })}
        />
      )}

      {experiments.data && rows.length === 0 && (
        <EmptyState
          icon={FlaskConical}
          title="还没有研究实验"
          description="新建实验需要一个 READY 状态的 Dataset 版本。若「数据集构建」里还没有 READY 版本，请先完成构建。"
          action={<CreateExperimentDialog />}
        />
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>实验名称</TableHead>
                  <TableHead>研究类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">Dataset 版本</TableHead>
                  <TableHead className="text-right">样本量</TableHead>
                  <TableHead className="text-right">创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-md">
                      <Link
                        href={`/research/${row.id}`}
                        className="font-medium text-sm hover:underline"
                      >
                        {row.name}
                      </Link>
                      {row.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {row.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{researchTypeLabelOf(row.researchType)}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {row.datasetVersionId}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatCount(row.sampleCount)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
