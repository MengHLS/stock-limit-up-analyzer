/**
 * CandidatesPanel — 策略候选列表（`researchEngine.listCandidates`，实验维度）。
 *
 * 定位（RESEARCH-006.4.1 起）：候选不再是「预留写入位」——
 * 登记入口已经存在（结论页的「创建策略候选」→ `research.strategyCandidate.createFromConclusion`），
 * 因此这里的空态必须指向**真实可执行的下一步**，而不是解释「引擎不产出候选」。
 *
 * 纪律：
 *   - 列表用**实验维度**的既有只读端点（`listCandidates`），不新增第二套列表 API；
 *   - 每一行可跳转到候选详情（研究来源 / 草图 / 状态流转）；
 *   - 「策略定义」列改称「转正策略」：候选草图**不是** StrategyDefinition，
 *     只有转正后 `strategyDefinitionId` 才有值，未转正显示「未转正」而不是空占位。
 */

import { Link } from "wouter";
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
import { candidateToRowVm } from "@/adapters/strategyCandidateAdapter";

export function CandidatesPanel({ experimentId }: { experimentId: number }) {
  const candidates = trpc.researchEngine.listCandidates.useQuery(
    { experimentId },
    { refetchOnWindowFocus: false },
  );

  const rows = (candidates.data ?? []).map(candidateToRowVm);

  return (
    <SectionCard
      title="策略候选"
      icon={Trophy}
      description="候选是从研究结论走向正式策略的中间产物：带上研究来源快照、人写的规则草图与状态机。它本身还不是策略。"
      right={
        <Link href={`/research/${experimentId}`} className="text-xs text-muted-foreground hover:underline">
          在「结论」标签页登记候选
        </Link>
      }
    >
      {candidates.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : candidates.error ? (
        <p className="text-xs text-red-600">{candidates.error.message}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="这个实验还没有登记策略候选"
          description="候选不会自动产生：请到「结论」标签页，对目标结论点「创建策略候选」。登记后回到这里即可看到，并进入候选详情补写规则草图、推进状态流转。"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">ID</TableHead>
              <TableHead>名称</TableHead>
              <TableHead className="w-24">状态</TableHead>
              <TableHead className="w-32">转正策略</TableHead>
              <TableHead className="w-24">来源结论</TableHead>
              <TableHead>描述</TableHead>
              <TableHead className="w-36 text-right">创建时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-xs">
                  {c.id === null ? "—" : `#${c.id}`}
                </TableCell>
                <TableCell className="text-xs font-medium">
                  {c.id === null ? (
                    c.name
                  ) : (
                    <Link href={`/research/candidates/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={c.status} label={c.statusLabel} />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {c.strategyDefinitionId ?? <span className="text-muted-foreground">未转正</span>}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {c.conclusionId === null ? "—" : `#${c.conclusionId}`}
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
