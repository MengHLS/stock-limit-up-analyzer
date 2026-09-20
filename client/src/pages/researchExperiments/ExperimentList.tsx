/**
 * 独立研究实验列表（`/research-experiments`，RESEARCH-EXPERIMENT-001）。
 *
 * 一屏回答：平台上有哪些独立研究实验、每个实验要什么数据、参数有多少。
 * **不在本页做任何统计**：所有内容都是服务端注册表的事实（描述符）。
 *
 * 🔴 与 `/research`（旧 Research 实验工作台）的区别必须一眼可见：
 * 旧页是「一个实验绑定一份 Dataset 版本、再挂 Run / 分析 / 结果 / 结论」；
 * 本页是「**独立实验**：自带参数与结果结构，可直接读 Dataset，**不需要**经过
 * Analysis / Finding / Conclusion 这条旧链路」。两个入口并存是刻意的（规格 §14）。
 */

import { Link } from "wouter";
import { FlaskConical, Layers, LineChart, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { EmptyState, ErrorState } from "@/components/common";
import { rpcErrorToDiagnostic } from "@/lib/rpcDiagnostic";

/** 把 `group/key` 拆成两段（详情路由是 `/research-experiments/:group/:key`）。 */
function splitExperimentId(id: string): { group: string; key: string } {
  const index = id.indexOf("/");
  if (index < 0) return { group: id, key: "" };
  return { group: id.slice(0, index), key: id.slice(index + 1) };
}

export default function ResearchExperimentList() {
  const experiments = trpc.researchExperiments.list.useQuery({}, { staleTime: 60_000 });

  const rows = experiments.data ?? [];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" /> 独立研究实验
          </CardTitle>
          <CardDescription>
            「独立实验」自带<strong>参数</strong>与<strong>结果结构</strong>，可直接读取 Dataset，
            <strong>不经过</strong>旧研究链路的分析 / 发现 / 结论。
            新增实验不需要改核心代码 —— 契约与生成规范见
            <span className="mx-1 font-mono text-xs">docs/research/EXPERIMENT-CODE-SPEC.md</span>。
          </CardDescription>
          <p className="text-xs text-muted-foreground">
            本页是项目的**唯一**正式研究入口（旧 Research 工作台
            `Experiment → Run → 分析 → 结果 → 结论` 已随 RESEARCH-EXPERIMENT-003 整体删除）。
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

      {experiments.data && rows.length === 0 && (
        <EmptyState
          icon={FlaskConical}
          title="还没有注册任何独立实验"
          description="在 research-experiments/ 下新增一个实验目录，并在 manifest 里加一行即可（详见 EXPERIMENT-CODE-SPEC.md）。"
        />
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>实验</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>数据集</TableHead>
                  <TableHead className="text-right">参数</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((descriptor) => {
                  const { group, key } = splitExperimentId(descriptor.id);
                  const requirement = descriptor.datasetRequirement;
                  return (
                    <TableRow key={descriptor.id}>
                      <TableCell className="max-w-md">
                        <p className="text-sm font-medium">{descriptor.name}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {descriptor.id}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {descriptor.description}
                        </p>
                        {(descriptor.tags ?? []).length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {(descriptor.tags ?? []).map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-[10px]">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">v{descriptor.version}</TableCell>
                      <TableCell className="text-xs">
                        <span className="font-mono">{requirement.datasetCode}</span>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {requirement.usesForwardData ? "使用事件日之后数据" : "只用事件日及之前数据"}
                        </p>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {descriptor.parameters.length}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/research-experiments/${encodeURIComponent(group)}/${encodeURIComponent(key)}`}
                          >
                            <LineChart className="mr-1.5 h-4 w-4" /> 打开
                          </Link>
                        </Button>
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
          <p>· 错误状态与加载状态（领域码可读化）</p>
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
