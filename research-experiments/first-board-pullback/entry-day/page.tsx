/**
 * 实验页面 · 首板后入场日基础统计。
 *
 * 这是**实验作者要写的第二种文件**（第一种是 `experiment.ts`）：把结果讲清楚。
 *
 * 演示的页面能力（规格 §7「允许 Experiment 页面拥有」的每一条）：
 *   ① 自定义表格（逐入场日基础统计）
 *   ② 自定义图表（recharts 柱状图，**涨红跌绿**）
 *   ③ 多维度比较（相对基准入场日的差值）
 *   ④ 样本口径与统计解释（含剔除原因的中文翻译）
 *   ⑤ 自定义研究说明（本页刻意不做排序 / 择优，并解释为什么）
 *
 * 🔴 本文件**不得** import `experiment.ts` 或任何 `server/**` —— 它跑在浏览器里。
 * 页面只消费 props 里的 `descriptor` 与 `outcome`（都由平台通过 tRPC 取回）。
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, BarChart3, Info, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
// 🔴 **只引类型**（`import type` 编译期擦除）：页面在浏览器里跑，
// 绝不能把 result.ts 的组装逻辑（以及它的服务端依赖）带进前端 bundle。
import type { EntryDayCustomPayload } from "./result";

/** A 股习惯：涨 = 红、跌 = 绿。 */
const UP_COLOR = "#e11d48";
const DOWN_COLOR = "#059669";

function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

/** 剔除原因的中文说明（来自本实验 `customPayload.exclusionReasonLabels`；取不到就显示裸码）。 */
function exclusionLabels(customPayload: unknown): Record<string, string> {
  if (customPayload && typeof customPayload === "object" && "exclusionReasonLabels" in customPayload) {
    const raw = (customPayload as { exclusionReasonLabels?: unknown }).exclusionReasonLabels;
    if (raw && typeof raw === "object") return raw as Record<string, string>;
  }
  return {};
}
export default function EntryDayExperimentPage({ descriptor, outcome }: ExperimentPageProps) {
  const result = outcome?.result ?? null;

  if (outcome === null) {
    return (
      <Card data-experiment-page="first-board-pullback/entry-day">
        <CardContent className="p-6">
          <EmptyState
            icon={BarChart3}
            title="尚未运行"
            description={
              <>
                选择 Dataset 版本后点击右上角「运行」，本页会展示
                <strong>逐入场日</strong>的样本数、收益、胜率与最大不利偏移。
              </>
            }
          />
        </CardContent>
      </Card>
    );
  }

  if (result === null) {
    return (
      <Card data-experiment-page="first-board-pullback/entry-day">
        <CardContent className="p-6">
          <EmptyState
            icon={AlertTriangle}
            title="本次执行没有产出结果"
            description={
              <>
                执行状态：{outcome.error?.code ?? "UNKNOWN"}。
                详见上方「执行状态」区块 —— 那里有错误码与说明。
              </>
            }
          />
        </CardContent>
      </Card>
    );
  }

  const labels = exclusionLabels(result.customPayload);
  const summary = result.sampleSummary;
  const mainTable = result.tables?.[0] ?? null;
  const meanChart = result.charts?.find((c) => c.key === "mean-forward-return") ?? null;
  const winRateChart = result.charts?.find((c) => c.key === "win-rate") ?? null;
  const custom = (result.customPayload ?? {}) as Partial<EntryDayCustomPayload>;

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      {/* ① 样本口径：先讲清「这些数字是哪来的」，再看数字。 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Table2 className="h-4 w-4" /> 样本口径
          </CardTitle>
          <CardDescription>
            样本单位 =（事件 × 入场日）一次可评估的入场机会。候选 {summary.candidateCount} ·
            入池 {summary.eligibleCount} · 剔除 {summary.excludedCount}。
            {custom.candidates
              ? ` 数据集声明事件 ${custom.candidates.datasetEventCount ?? "—"} 个，本次扫描 ${custom.candidates.scannedEventCount ?? "—"} 个，纳入统计 ${custom.candidates.usedEventCount ?? "—"} 个。`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.keys(summary.excludedByReason).length === 0 ? (
            <p className="text-sm text-muted-foreground">本次没有被剔除的样本。</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>剔除原因</TableHead>
                    <TableHead>说明</TableHead>
                    <TableHead className="text-right">槽位数</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(summary.excludedByReason)
                    .sort((a, b) => b[1] - a[1])
                    .map(([code, count]) => (
                      <TableRow key={code}>
                        <TableCell className="font-mono text-xs">{code}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {labels[code] ?? "（未登记说明）"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{count}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
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

      {/* ② 统计量（服务端已算好；页面不重算） */}
      {(result.statistics ?? []).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(result.statistics ?? []).map((stat) => (
            <Card key={stat.code}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="mt-1 font-mono text-xl tabular-nums">
                  {stat.value === null ? "—" : formatNumber(stat.value, stat.digits ?? 0)}
                  {stat.unit ? <span className="ml-1 text-xs text-muted-foreground">{stat.unit}</span> : null}
                </p>
                {stat.note && <p className="mt-1 text-xs text-muted-foreground">{stat.note}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ③ 自定义图表 */}
      {(meanChart || winRateChart) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {[meanChart, winRateChart]
            .filter((chart) => chart !== null)
            .map((chart) => {
              const series = chart!.series[0];
              const data = (series?.points ?? []).map((p) => ({ name: p.x, value: p.y }));
              const hasPositive = data.some((d) => (d.value ?? 0) > 0);
              const hasNegative = data.some((d) => (d.value ?? 0) < 0);
              const domain: [number | string, number | string] =
                hasPositive && hasNegative ? ["dataMin", "dataMax"] : [0, "auto"];
              return (
                <Card key={chart!.key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{chart!.title}</CardTitle>
                    <CardDescription className="text-xs">
                      {chart!.description ?? `${chart!.xLabel ?? ""} → ${chart!.yLabel ?? ""}`}
                      {chart!.unit ? `（单位：${chart!.unit}）` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="currentColor" />
                        <YAxis tick={{ fontSize: 11 }} stroke="currentColor" domain={domain} />
                        <Tooltip
                          formatter={(value: number | string) =>
                            typeof value === "number" ? value.toFixed(4) : String(value)
                          }
                        />
                        <ReferenceLine y={0} stroke="currentColor" opacity={0.4} />
                        <Bar dataKey="value" name={series?.label ?? "值"}>
                          {data.map((d) => (
                            <Cell
                              key={d.name}
                              fill={(d.value ?? 0) >= 0 ? UP_COLOR : DOWN_COLOR}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}

      {/* ④ 自定义表格 */}
      {mainTable && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{mainTable.title}</CardTitle>
            {mainTable.description && (
              <CardDescription className="text-xs">{mainTable.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {mainTable.columns.map((col) => (
                    <TableHead
                      key={col.key}
                      className={col.align === "RIGHT" ? "text-right" : undefined}
                    >
                      {col.label}
                      {col.unit ? `（${col.unit}）` : ""}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {mainTable.rows.map((row, index) => (
                  <TableRow key={String(row[mainTable.columns[0]!.key] ?? index)}>
                    {mainTable.columns.map((col) => {
                      const value = row[col.key];
                      const numeric = typeof value === "number" ? value : null;
                      const tinted =
                        col.align === "RIGHT" && numeric !== null && /收益|偏移|位置/.test(col.label);
                      return (
                        <TableCell
                          key={col.key}
                          className={[
                            col.align === "RIGHT" ? "text-right font-mono tabular-nums text-xs" : "text-xs",
                            tinted ? (numeric >= 0 ? "text-rose-600" : "text-emerald-600") : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {numeric === null ? String(value ?? "—") : formatNumber(numeric, col.digits ?? 4)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ⑤ 分布与多组比较 */}
      {(result.distributions ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">收益分布（逐入场日）</CardTitle>
            <CardDescription className="text-xs">
              左开右闭区间；每个入场日一根堆叠列。分布形状比单一均值更能反映「这个入场日的收益是
              靠少数极端样本撑起来的，还是普遍为正」。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(result.distributions ?? []).map((dist) => {
              const total = dist.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
              return (
                <div key={dist.code} className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs font-medium">{dist.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">样本 {total}</p>
                  </div>
                  <div className="flex h-4 overflow-hidden rounded-sm border">
                    {dist.buckets.map((bucket) => {
                      const isLoss = bucket.label.startsWith("≤") || bucket.label.startsWith("(") && bucket.label.includes("-");
                      const width = total === 0 ? 0 : (bucket.count / total) * 100;
                      return (
                        <div
                          key={bucket.label}
                          title={`${bucket.label}：${bucket.count} 条`}
                          style={{
                            width: `${width}%`,
                            backgroundColor: isLoss ? DOWN_COLOR : UP_COLOR,
                            opacity: 0.25 + (bucket.count / Math.max(1, total)) * 0.65,
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {dist.buckets.map((bucket) => (
                      <span key={bucket.label}>
                        {bucket.label}：<span className="font-mono">{bucket.count}</span>
                      </span>
                    ))}
                  </div>
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
                      {formatNumber(row.left, 4)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatNumber(row.right, 4)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-xs tabular-nums ${
                        row.delta === null ? "" : row.delta >= 0 ? "text-rose-600" : "text-emerald-600"
                      }`}
                    >
                      {formatNumber(row.delta, 4)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {/* ⑥ 自定义研究说明（本页刻意不做排序 / 择优） */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" /> 研究说明与已知偏差
            <Badge variant="outline" className="ml-1 text-[10px]">
              描述性统计
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            {(custom.selectionNotes ?? []).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <Separator />
          <p>
            <strong>为什么不给「最佳入场日」：</strong>
            本页展示的全部是在<strong>同一份数据</strong>上算出来的描述性统计。
            在同一份数据里挑「平均收益最高」的入场日，等价于在这份数据上做了一次参数选择 ——
            这个结论换个时间窗口很可能不成立。要谈「哪个入场日更好」，必须先有样本外验证；
            本实验刻意不产出任何排序、评级或择优字段。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
