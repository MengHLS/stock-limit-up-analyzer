/**
 * CandidatesPanel — 策略候选列表（RESEARCH-002 前端工作台）。
 *
 * 诚实提示（很重要）：RESEARCH-002 的引擎**不产出候选** —— 它的规格明确排除了
 * 「自动策略生成」。`research_strategy_candidate` 表与 `listCandidates` 端点是为后续
 * 阶段预留的写入位，所以在当前引擎下这个列表**通常是空的**。
 *
 * 因此本面板的默认空态不写「加载中」也不写「暂无数据」，而是直接把「为什么空」讲清楚 ——
 * 否则用户会以为是自己操作漏了一步。
 */

import { Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, SectionCard, StatusBadge } from "@/components/common";
import { formatDateTime } from "@/adapters/researchEngineAdapter";

export function CandidatesPanel({ experimentId }: { experimentId: number }) {
  const candidates = trpc.researchEngine.listCandidates.useQuery(
    { experimentId },
    { refetchOnWindowFocus: false },
  );

  return (
    <SectionCard
      title="策略候选"
      icon={Trophy}
      description="候选是从研究结论走向正式策略的中间产物，带上参数空间与来源实验的可追溯指纹。"
    >
      {candidates.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : candidates.error ? (
        <p className="text-xs text-red-600">{candidates.error.message}</p>
      ) : (candidates.data ?? []).length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="这个实验没有登记策略候选"
          description="RESEARCH-002 的引擎不做自动策略生成（规格明确排除），因此不会自动写入候选。这个列表是为后续「研究结论 → 策略候选」阶段预留的写入位：等你手动或由后续模块登记候选后，会在这里出现。"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">ID</TableHead>
              <TableHead>名称</TableHead>
              <TableHead>策略定义</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>描述</TableHead>
              <TableHead className="text-right">创建时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(candidates.data ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-xs">#{c.id}</TableCell>
                <TableCell className="text-xs font-medium">{c.name}</TableCell>
                <TableCell className="font-mono text-xs">
                  {c.strategyDefinitionId ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={c.status} />
                </TableCell>
                <TableCell className="max-w-[24rem] truncate text-xs text-muted-foreground">
                  {c.description ?? "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  {formatDateTime(c.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}
