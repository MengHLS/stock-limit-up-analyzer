/**
 * 模板实验页面 —— 复制后改成你自己的展示。
 *
 * ## 页面契约（只有两个 props）
 *
 * ```ts
 * interface ExperimentPageProps {
 *   descriptor: ExperimentDescriptor;   // 元数据（含参数定义 / Dataset 声明）
 *   outcome: ExperimentRunOutcome | null; // null = 本次会话还没运行过
 * }
 * ```
 *
 * 🔴 页面**不要自己发请求**：执行入口在服务端只有一套（Registry + Runner，负责参数校验、
 * Dataset 校验、结果校验）。页面自己 fetch 会立刻产生第二套执行入口。
 *
 * 🔴 页面**不得** import `experiment.ts` 或任何 `server/**` —— 它跑在浏览器里。
 *
 * 页面可以做的（规格 §7）：自定义表格 / 自定义图表 / 多维度比较 / 统计解释 /
 * 样本详情 / 自定义研究说明。用项目既有 UI 组件与 `recharts`，**不要引入新的 UI 框架**。
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Beaker } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/common";
import type { ExperimentPageProps } from "@/researchExperiments/contract";
// 🔴 **只引类型**（编译期擦除）：页面在浏览器里跑，不要把 result.ts 的组装逻辑带进前端 bundle。
import type { TemplateCustomPayload } from "./result";

export default function TemplateExperimentPage({ descriptor, outcome }: ExperimentPageProps) {
  const result = outcome?.result ?? null;

  // `outcome === null` = 还没运行过（**不是**「运行了没结果」）。
  if (result === null) {
    return (
      <Card data-experiment-page={descriptor.pageKey}>
        <CardContent className="p-6">
          <EmptyState
            icon={Beaker}
            title="尚未运行"
            description="选择 Dataset 版本后点击右上角「运行」。"
          />
        </CardContent>
      </Card>
    );
  }

  const table = result.tables?.[0] ?? null;
  const chart = result.charts?.[0] ?? null;
  const summary = result.sampleSummary;
  // 实验自有结构（只引类型，运行时直接读）。
  const custom = (result.customPayload ?? {}) as Partial<TemplateCustomPayload>;

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{table?.title ?? "结果"}</CardTitle>
          <CardDescription className="text-xs">
            候选 {summary.candidateCount} · 入池 {summary.eligibleCount} · 剔除{" "}
            {summary.excludedCount}
            {custom.groupBy ? ` · 分组维度 ${custom.groupBy}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {table ? (
            <Table>
              <TableHeader>
                <TableRow>
                  {table.columns.map((column) => (
                    <TableHead
                      key={column.key}
                      className={column.align === "RIGHT" ? "text-right" : undefined}
                    >
                      {column.label}
                      {column.unit ? `（${column.unit}）` : ""}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.map((row, index) => (
                  <TableRow key={String(row[table.columns[0]!.key] ?? index)}>
                    {table.columns.map((column) => {
                      const value = row[column.key];
                      return (
                        <TableCell
                          key={column.key}
                          className={
                            column.align === "RIGHT"
                              ? "text-right font-mono text-xs tabular-nums"
                              : "text-xs"
                          }
                        >
                          {typeof value === "number"
                            ? value.toFixed(column.digits ?? 2)
                            : String(value ?? "—")}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-xs text-muted-foreground">本实验没有产出表格。</p>
          )}
        </CardContent>
      </Card>

      {chart && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{chart.title}</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={(chart.series[0]?.points ?? []).map((point) => ({
                  name: point.x,
                  value: point.y,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="currentColor" />
                <YAxis tick={{ fontSize: 11 }} stroke="currentColor" />
                <Tooltip />
                <Bar dataKey="value" fill="#e11d48" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
