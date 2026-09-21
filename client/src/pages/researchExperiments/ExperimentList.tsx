/**
 * 独立研究实验列表（`/research-experiments`，RESEARCH-EXPERIMENT-001 / 004）。
 *
 * 一屏回答：平台上有哪些独立研究实验、每个实验要什么数据、**最近跑成什么样**。
 *
 * ## 004 带来的变化
 *
 * 本页原来只显示「代码里声明了什么」（描述符来自注册表，不依赖数据库）。
 * 004 之后每次运行都会落库一条 Run，于是本页多了一维**事实**：
 * 每个实验跑了多少次、最近一次什么状态、什么时候跑的、产出了什么。
 *
 * 🔴 关键纪律：**描述符是代码事实、Run 是数据库事实，两者取数路径不同**。
 *    数据库不可用时描述符仍然拿得到 ⇒ 不能整页报错；但也**不能显示「0 个 Run」**，
 *    那等于把故障伪装成事实。所以 `runsAvailable=false` 时本页显示琥珀色说明，
 *    并明确写出「这不代表没有历史 Run」。
 *
 * 🔴 与 `/research`（旧 Research 工作台）的区别必须一眼可见：旧页是「一个实验绑定一份
 *    Dataset 版本、再挂 Run / 分析 / 结果 / 结论」；本页是「**独立实验**：自带参数与结果
 *    结构，可直接读 Dataset，**不需要**经过 Analysis / Finding / Conclusion 这条旧链路」。
 *    本页是**唯一**正式研究入口。
 */

import { Link } from "wouter";
import { AlertTriangle, FlaskConical, History, Layers, LineChart, Loader2 } from "lucide-react";
import type { ExperimentSummary } from "@shared/researchExperimentsContracts";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/common";
import { rpcErrorToDiagnostic } from "@/lib/rpcDiagnostic";
import { NoArtifactBadge, RunStatusBadge, formatDateTime, formatDuration } from "./runShared";

/** 把 `group/key` 拆成两段（详情路由是 `/research-experiments/:group/:key`）。 */
function splitExperimentId(id: string): { group: string; key: string } {
  const index = id.indexOf("/");
  if (index < 0) return { group: id, key: "" };
  return { group: id.slice(0, index), key: id.slice(index + 1) };
}

/** 一行 Run 的「Latest Run」单元格：坐标 + 耗时 + 参数摘要（**不拉 Result 内容**）。 */
function LatestRunCell({ summary }: { summary: ExperimentSummary }) {
  const run = summary.latestRun;
  if (!summary.runsAvailable) {
    return <NoArtifactBadge text="取不到" />;
  }
  if (run === null) {
    return <span className="text-xs text-muted-foreground">尚无 Run</span>;
  }
  return (
    <div className="space-y-0.5">
      <p className="font-mono text-[11px]">{run.runId}</p>
      <p className="text-[11px] text-muted-foreground">
        耗时 {formatDuration(run.durationMs)} · Dataset {run.datasetVersionLabel}
        <span className="ml-1">(id={run.datasetVersionId})</span>
      </p>
    </div>
  );
}

/** 一行 Run 的「状态」单元格。`runsAvailable=false` 时**不猜**，如实说取不到。 */
function StatusCell({ summary }: { summary: ExperimentSummary }) {
  const run = summary.latestRun;
  if (!summary.runsAvailable) {
    return (
      <Badge variant="outline" className="font-mono text-[10px] text-amber-700">
        <AlertTriangle className="mr-1 h-3 w-3" />
        未知
      </Badge>
    );
  }
  if (run === null) {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        未运行
      </Badge>
    );
  }
  return <RunStatusBadge run={run} />;
}

export default function ResearchExperimentList() {
  const experiments = trpc.researchExperiments.list.useQuery({}, { staleTime: 30_000 });

  const rows = experiments.data ?? [];
  // 只要有任何一个实验的 Run 事实取不到，就在页首如实说明（不让用户逐行去猜）。
  const runsUnavailable = rows.filter((row) => !row.runsAvailable);
  const totalRuns = rows.reduce((sum, row) => sum + row.runCount, 0);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" /> 独立研究实验
            {rows.length > 0 && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {rows.length} 个实验 · {totalRuns} 条 Run
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            「独立实验」自带<strong>参数</strong>与<strong>结果结构</strong>，可直接读取 Dataset，
            <strong>不经过</strong>旧研究链路的分析 / 发现 / 结论。
            每次运行都会<strong>落库一条 Run</strong>（TiDB 存元数据），
            结果、Manifest、CSV / Parquet / 图表等产物写到<strong>对象存储</strong> ——
            <strong>刷新或关闭页面后仍可打开历史 Run，不需要重跑</strong>。
            新增实验不需要改核心代码 —— 契约与生成规范见
            <span className="mx-1 font-mono text-xs">docs/research/EXPERIMENT-CODE-SPEC.md</span>。
          </CardDescription>
          <p className="text-xs text-muted-foreground">
            本页是项目的<strong>唯一</strong>正式研究入口。
          </p>
        </CardHeader>
      </Card>

      {experiments.isLoading && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-28 w-full" />
          </CardContent>
        </Card>
      )}

      {experiments.error && !experiments.isLoading && (
        <ErrorState
          error={rpcErrorToDiagnostic(experiments.error.message, { title: "实验列表加载失败" })}
        />
      )}

      {runsUnavailable.length > 0 && (
        <Alert
          className="border-amber-300 bg-amber-50"
          data-experiment-runs-unavailable={String(runsUnavailable.length)}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <AlertTitle className="text-sm">
            有 {runsUnavailable.length} 个实验的「运行历史」暂时取不到
          </AlertTitle>
          <AlertDescription className="space-y-1 text-xs">
            <p>
              <span className="font-mono">{runsUnavailable[0]?.runsError?.code}</span>：
              {runsUnavailable[0]?.runsError?.message}
            </p>
            <p className="text-muted-foreground">
              实验<strong>描述符</strong>来自代码里的注册表，不依赖数据库，所以本页仍可打开；
              但 Run 事实来自 TiDB。因此下面标「取不到」的那些行，
              <strong>不代表它们没有历史 Run</strong> —— 只是本次没能读到。
            </p>
          </AlertDescription>
        </Alert>
      )}

      {experiments.data && rows.length === 0 && (
        <EmptyState
          icon={FlaskConical}
          title="还没有注册任何独立实验"
          description="在 research-experiments/ 下新增一个实验目录，并在 manifest 里加一行即可（详见 EXPERIMENT-CODE-SPEC.md）。"
        />
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>实验</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>数据集</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>Latest Run</TableHead>
                  <TableHead>最近运行时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const descriptor = row.descriptor;
                  const { group, key } = splitExperimentId(descriptor.id);
                  const requirement = descriptor.datasetRequirement;
                  const detailPath = `/research-experiments/${encodeURIComponent(group)}/${encodeURIComponent(key)}`;
                  return (
                    <TableRow key={descriptor.id} data-experiment-row={descriptor.id}>
                      <TableCell className="max-w-md">
                        <p className="text-sm font-medium">{descriptor.name}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {descriptor.id}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {descriptor.description}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <Badge variant="secondary" className="text-[10px]">
                            {descriptor.parameters.length} 个参数
                          </Badge>
                          {row.runsAvailable && row.runCount > 0 && (
                            <Badge variant="outline" className="text-[10px]">
                              <History className="mr-1 h-3 w-3" />
                              {row.runCount} 条 Run
                            </Badge>
                          )}
                          {(descriptor.tags ?? []).map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-[10px]">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">v{descriptor.version}</TableCell>
                      <TableCell className="text-xs">
                        <span className="font-mono">{requirement.datasetCode}</span>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {requirement.usesForwardData ? "使用事件日之后数据" : "只用事件日及之前数据"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusCell summary={row} />
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <LatestRunCell summary={row} />
                      </TableCell>
                      <TableCell className="text-[11px] tabular-nums">
                        {row.runsAvailable ? formatDateTime(row.latestRun?.startedAt ?? null) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {row.latestRun !== null && (
                            <Button asChild size="sm" variant="ghost" className="h-7">
                              <Link
                                href={`${detailPath}/runs/${encodeURIComponent(row.latestRun.runId)}`}
                                data-open-latest-run={row.latestRun.runId}
                              >
                                <History className="mr-1 h-3 w-3" /> 最近一次
                              </Link>
                            </Button>
                          )}
                          <Button asChild size="sm" variant="outline" className="h-7">
                            <Link href={detailPath} data-open-experiment={descriptor.id}>
                              <LineChart className="mr-1.5 h-3.5 w-3.5" /> 打开
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4" /> 平台提供什么
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <p>· 页面挂载机制（`pageKey` → 实验自己的页面）与元数据回显</p>
          <p>· Dataset 版本选择 + 参数表单（由参数定义自动渲染）</p>
          <p>· 执行与执行元数据（耗时 / Dataset 坐标 / 实际参数）</p>
          <p>· **Run 持久化**：TiDB 存元数据，对象存储存结果与产物，可回看历史</p>
          <p>· 错误状态与加载状态（领域码可读化）</p>
          <p>· 产物只给「元数据 + 按需下载」，页面初始化不自动拉大文件</p>
        </CardContent>
      </Card>

      {experiments.isFetching && !experiments.isLoading && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> 刷新中…
        </p>
      )}
    </div>
  );
}
