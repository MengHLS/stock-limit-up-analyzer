/**
 * 通用结果渲染器（**平台降级路径**）。
 *
 * 什么时候用：实验声明的 `pageKey` 在客户端页面注册表里**找不到**对应组件时。
 * 它不是「好看的兜底」，而是「丢了注册也不会白屏」的保证 —— 页面必须仍然
 * 显示元数据、表格、统计量、分布、比较与图表，并**明确提示**「该实验未注册自定义页面」。
 *
 * 这份渲染器**只读结果信封的通用字段**（tables / statistics / distributions /
 * comparisons / charts），完全不碰 `customPayload`（那是实验自己的结构，
 * 只有实验自己的页面知道怎么画）。
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, BarChart3, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ExperimentResultEnvelope } from "@shared/researchExperimentsContracts";

/** A 股习惯：涨 = 红、跌 = 绿。 */
const UP_COLOR = "#e11d48";
const DOWN_COLOR = "#059669";

function formatCell(value: unknown, digits: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return value.toFixed(digits ?? 4);
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

export function GenericExperimentResult({
  result,
  pageKey,
  reason,
}: {
  result: ExperimentResultEnvelope;
  pageKey: string;
  reason: string;
}) {
  const summary = result.sampleSummary;
  return (
    <div className="space-y-4" data-generic-result="true">
      <Alert className="border-amber-300 bg-amber-50">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        <div className="space-y-1">
          <AlertTitle className="text-sm">该实验未注册自定义页面，已降级为通用渲染</AlertTitle>
          <AlertDescription className="text-xs">
            pageKey = <span className="font-mono">{pageKey}</span>；{reason}
            结果的通用字段（表格 / 统计量 / 分布 / 比较 / 图表）照常展示；
            <strong>实验自有结构（customPayload）不在此渲染</strong>，请在其页面里查看。
          </AlertDescription>
        </div>
      </Alert>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">样本口径</CardTitle>
          <CardDescription className="text-xs">
            候选 {summary.candidateCount} · 入池 {summary.eligibleCount} · 剔除 {summary.excludedCount}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.keys(summary.excludedByReason).length === 0 ? (
            <p className="text-xs text-muted-foreground">无剔除。</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(summary.excludedByReason)
                .sort((a, b) => b[1] - a[1])
                .map(([code, count]) => (
                  <Badge key={code} variant="outline" className="font-mono text-[10px]">
                    {code}: {count}
                  </Badge>
                ))}
            </div>
          )}
          {(summary.notes ?? []).length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {(summary.notes ?? []).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {(result.statistics ?? []).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(result.statistics ?? []).map((stat) => (
            <Card key={stat.code}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="mt-1 font-mono text-xl tabular-nums">
                  {stat.value === null ? "—" : formatCell(stat.value, stat.digits)}
                  {stat.unit ? (
                    <span className="ml-1 text-xs text-muted-foreground">{stat.unit}</span>
                  ) : null}
                </p>
                {stat.note && <p className="mt-1 text-xs text-muted-foreground">{stat.note}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(result.tables ?? []).map((table) => (
        <Card key={table.key}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{table.title}</CardTitle>
            {table.description && (
              <CardDescription className="text-xs">{table.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="overflow-x-auto">
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
                    {table.columns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={
                          column.align === "RIGHT"
                            ? "text-right font-mono text-xs tabular-nums"
                            : "text-xs"
                        }
                      >
                        {formatCell(row[column.key], column.digits)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {(result.charts ?? []).map((chart) => {
        const series = chart.series[0];
        const data = (series?.points ?? []).map((point) => ({ name: point.x, value: point.y }));
        const hasPositive = data.some((point) => (point.value ?? 0) > 0);
        const hasNegative = data.some((point) => (point.value ?? 0) < 0);
        const domain: [number | string, number | string] =
          hasPositive && hasNegative ? ["dataMin", "dataMax"] : [0, "auto"];
        return (
          <Card key={chart.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{chart.title}</CardTitle>
              <CardDescription className="text-xs">
                {chart.description ?? `${chart.xLabel ?? ""} → ${chart.yLabel ?? ""}`}
                {chart.unit ? `（单位：${chart.unit}）` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                {chart.kind === "LINE" ? (
                  <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="currentColor" />
                    <YAxis tick={{ fontSize: 11 }} stroke="currentColor" />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" name={series?.label ?? "值"} stroke={UP_COLOR} dot />
                  </LineChart>
                ) : (
                  <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="currentColor" />
                    <YAxis tick={{ fontSize: 11 }} stroke="currentColor" domain={domain} />
                    <Tooltip />
                    <ReferenceLine y={0} stroke="currentColor" opacity={0.4} />
                    <Bar dataKey="value" name={series?.label ?? "值"}>
                      {data.map((point) => (
                        <Cell
                          key={point.name}
                          fill={(point.value ?? 0) >= 0 ? UP_COLOR : DOWN_COLOR}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </CardContent>
          </Card>
        );
      })}

      {(result.distributions ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" /> 分布
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(result.distributions ?? []).map((distribution) => {
              const total = distribution.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
              return (
                <div key={distribution.code} className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs font-medium">{distribution.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">合计 {total}</p>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {distribution.buckets.map((bucket) => (
                      <span key={bucket.label}>
                        {bucket.label}：<span className="font-mono">{bucket.count}</span>
                      </span>
                    ))}
                  </div>
                  {distribution.note && (
                    <p className="text-[11px] text-muted-foreground">{distribution.note}</p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {(result.comparisons ?? []).map((comparison) => (
        <Card key={comparison.key}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{comparison.title}</CardTitle>
            {comparison.description && (
              <CardDescription className="text-xs">{comparison.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>项目</TableHead>
                  <TableHead className="text-right">{comparison.leftLabel}</TableHead>
                  <TableHead className="text-right">{comparison.rightLabel}</TableHead>
                  <TableHead className="text-right">差值</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparison.rows.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="text-xs">{row.label}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatCell(row.left, 4)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatCell(row.right, 4)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatCell(row.delta, 4)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      <Alert>
        <Info className="h-4 w-4 shrink-0" />
        <AlertDescription className="text-xs">
          通用渲染器只展示结果信封的通用字段。实验自己的结构（customPayload）请在其自定义页面查看
          —— 若该实验本该有页面，请检查 `client/src/researchExperiments/pages.ts` 是否登记了
          <span className="mx-1 font-mono">pageKey</span>。
        </AlertDescription>
      </Alert>
    </div>
  );
}
