/**
 * 候选列表（PD-03 / `docs/product/SPEC-003-PD03-candidate-list.md`）。
 *
 * 定位：③研究 → ④策略 的**交接台** —— 回答「我产出了哪些候选、哪些值得转正」。
 *
 * 纪律（改动前必读）：
 *   - **只读**：本页**不含任何写操作**；编辑 / 状态流转 / 转正一律在详情页
 *     （`/candidates/:candidateId`，写口仍是 `update` / `transition` / `promote`）。
 *   - 筛选只用**非遗留**维度：`status` / `sourceDatasetVersionId`。
 *     `experimentId` / `conclusionId` 是旧 Research 链遗留列（该链已随
 *     `RESEARCH-EXPERIMENT-003` 退役），不得出现在本页筛选里。
 *   - 「研究**来源** Dataset」≠「Strategy **执行绑定** Dataset」：两者不同的候选
 *     必须显示分歧标记（具体原因在详情页的 `sourceDatasetDivergenceReason`）。
 */

import { useState } from "react";
import { Link } from "wouter";
import { Crown, Loader2, SlidersHorizontal } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { candidateStatusLabelOf } from "@/adapters/strategyCandidateAdapter";
import { EmptyState, ErrorState, PageHeader, SectionCard, StatusBadge } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/displayFormat";
// 状态筛选闭集 = 受「对表测试」守护的镜像表（不再在页内重复定义，避免静默漂移）
import { CANDIDATE_STATUS_OPTIONS, type CandidateStatusOption } from "@/lib/status";

export default function CandidateList() {
  const [status, setStatus] = useState("");
  const [datasetVersionId, setDatasetVersionId] = useState("");

  const parsedDatasetVersionId = datasetVersionId.trim() === "" ? undefined : Number(datasetVersionId.trim());
  const validDatasetVersionId =
    parsedDatasetVersionId !== undefined && Number.isInteger(parsedDatasetVersionId) && parsedDatasetVersionId > 0;

  const query = trpc.strategyDomain.strategyCandidate.list.useQuery({
    ...(status === "" ? {} : { status: status as CandidateStatusOption }),
    ...(validDatasetVersionId ? { sourceDatasetVersionId: parsedDatasetVersionId } : {}),
    limit: 200,
  });

  const rows = query.data ?? [];

  return (
    <div className="container max-w-7xl space-y-4 py-6">
      <PageHeader
        title="候选"
        description="研究阶段产出的候选策略草图 —— 从这里判断哪些值得转正为策略。本页只读，写操作在详情页。"
        icon={Crown}
        breadcrumb={[{ label: "研究", href: "/research-experiments" }, { label: "候选" }]}
      />

      <SectionCard title="筛选">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">状态</span>
            <select
              id="candidate-filter-status"
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">全部</option>
              {CANDIDATE_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {candidateStatusLabelOf(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">研究来源 Dataset 版本 ID（可选）</span>
            <Input
              id="candidate-filter-dataset-version"
              className="h-8 text-xs"
              inputMode="numeric"
              placeholder="如 540002"
              value={datasetVersionId}
              onChange={(event) => setDatasetVersionId(event.target.value)}
            />
          </label>
          <div className="flex items-end">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              {query.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SlidersHorizontal className="h-3.5 w-3.5" />}
              刷新
            </Button>
          </div>
        </div>
      </SectionCard>

      {query.isError ? (
        <ErrorState
          error={{
            code: "CANDIDATE_LIST_FAILED",
            title: "候选列表加载失败",
            explanation: query.error.message,
            suggestions: ["确认后端可用后重试", "若持续失败，请检查 strategyCandidate.list 端点是否已装配"],
          }}
        />
      ) : query.isLoading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取候选…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="还没有候选"
          description="候选来自研究实验的产出（Experiment → Run → Candidate）。先去独立实验跑一个实验，再回来看这里。"
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/research-experiments">前往独立实验</Link>
            </Button>
          }
        />
      ) : (
        <SectionCard title={`候选（${rows.length}）`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>研究来源数据集版本</TableHead>
                <TableHead>转正产物</TableHead>
                <TableHead>更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/candidates/${row.id}`} className="underline-offset-2 hover:underline">
                      #{row.id}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">
                    <Link href={`/candidates/${row.id}`} className="underline-offset-2 hover:underline">
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} label={candidateStatusLabelOf(row.status)} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.sourceDatasetVersionId ?? "—"}
                    {row.hasSourceDatasetDivergence && (
                      <span
                        data-source-dataset-divergence="true"
                        title="研究来源数据集 ≠ 策略执行绑定数据集；具体原因见详情页"
                        className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                      >
                        来源≠执行
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.strategyDefinitionId ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(row.updatedAt ?? row.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      )}
    </div>
  );
}