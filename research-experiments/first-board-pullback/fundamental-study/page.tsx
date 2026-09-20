/**
 * 实验页面 · 首板后回踩第一性研究（EXP-001）。
 *
 * ## 这一页的职责
 *
 * 把**服务端已经算完**的研究结果讲清楚：样本怎么来的、路径长什么样、回踩与破位的分布、
 * 回撤深度分桶、后续视界的分布，以及本实验**观察到什么、局限在哪、哪些只值得继续研究**。
 *
 * 🔴 本文件**不得** import `experiment.ts` 或任何 `server/**` 的运行时 —— 它跑在浏览器里。
 * 计算全部在服务端（`research-experiments/.../result.ts` + 平台的 Runner），
 * 本页只做呈现；连「回撤桶」这样的口径也直接读结果里下发的标签，不在前端重算。
 *
 * 🔴 页面**不产出**任何「最优观察日 / 最优入场日 / 最佳回撤区间」的措辞或排序 ——
 * 那是 Parameter Search 的职责，本实验刻意只做描述性研究。
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, BarChart3, FlaskConical, Info, Microscope, Table2 } from "lucide-react";
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
import type { FundamentalStudyCustomPayload, ObservationKind } from "./result";

/** A 股习惯：涨 = 红、跌 = 绿。 */
const UP_COLOR = "#e11d48";
const DOWN_COLOR = "#059669";
const NEUTRAL_COLOR = "#6b7280";
/** 多序列标识色（用于「哪个序列是哪条」而不是涨跌语义）。 */
const SERIES_COLORS = ["#e11d48", "#2563eb", "#059669", "#d97706"] as const;

const RATIO_DIGITS = 6;

function formatRatio(value: number | null | undefined, digits = RATIO_DIGITS): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function formatCell(value: unknown, digits?: number | null): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return Number.isInteger(value) ? String(value) : value.toFixed(digits ?? RATIO_DIGITS);
  }
  return String(value);
}

/** 剔除原因的中文说明（本实验下发；取不到就显示裸码）。 */
function exclusionLabels(customPayload: unknown): Record<string, string> {
  if (customPayload && typeof customPayload === "object" && "exclusionReasonLabels" in customPayload) {
    const raw = (customPayload as { exclusionReasonLabels?: unknown }).exclusionReasonLabels;
    if (raw && typeof raw === "object") return raw as Record<string, string>;
  }
  return {};
}

const OBSERVATION_META: Record<ObservationKind, { label: string; className: string }> = {
  DESCRIPTIVE: { label: "描述性事实", className: "border-slate-300 text-slate-600" },
  COMPARATIVE: { label: "分组比较", className: "border-blue-300 text-blue-600" },
  POTENTIAL_SIGNAL: { label: "值得进一步验证", className: "border-amber-300 text-amber-700" },
  LIMITATION: { label: "局限", className: "border-rose-300 text-rose-600" },
};

/** 把信封里的 `charts[]`（x/y 序列）转成 recharts 的行数组。 */
function chartData(chart: {
  series: Array<{ key: string; label: string; points: Array<{ x: string; y: number | null }> }>;
}): Array<Record<string, string | number | null>> {
  const rows = new Map<string, Record<string, string | number | null>>();
  for (const series of chart.series) {
    for (const point of series.points) {
      const row = rows.get(point.x) ?? { name: point.x };
      row[series.key] = point.y;
      rows.set(point.x, row);
    }
  }
  return [...rows.values()];
}

export default function FundamentalStudyExperimentPage({ descriptor, outcome }: ExperimentPageProps) {
  const result = outcome?.result ?? null;

  if (outcome === null) {
    return (
      <Card data-experiment-page="first-board-pullback/fundamental-study">
        <CardContent className="p-6">
          <EmptyState
            icon={BarChart3}
            title="尚未运行"
            description={
              <>
                选择 Dataset 版本后点击右上角「运行」，本页会展示首板后
                <strong> T+1～T+maxObservationDay 的路径、逐日回踩率、回撤深度分桶</strong>
                、是否跌破首板日开盘价，以及各后续视界的收益分布。
              </>
            }
          />
        </CardContent>
      </Card>
    );
  }

  if (result === null) {
    return (
      <Card data-experiment-page="first-board-pullback/fundamental-study">
        <CardContent className="p-6">
          <EmptyState
            icon={AlertTriangle}
            title="本次执行没有产出结果"
            description={<>执行状态：{outcome.error?.code ?? "UNKNOWN"}。详见上方「执行状态」区块。</>}
          />
        </CardContent>
      </Card>
    );
  }

  const labels = exclusionLabels(result.customPayload);
  const summary = result.sampleSummary;
  const custom = (result.customPayload ?? {}) as Partial<FundamentalStudyCustomPayload>;
  const quality = custom.dataQuality;
  const windowInfo = custom.studyWindow;
  const boundary = custom.informationBoundary;
  const observations = custom.observations ?? [];
  const hypotheses = custom.potentialStrategyHypotheses ?? [];
  /**
   * 账目缺口（数据集声明事件数 − 本轮候选数）。
   * 🔴 先取回本地变量再渲染：这个数必须**首屏可见**，不能只躺在 notes / observations 里
   *    —— 那两处会被折叠，读者会把「本轮候选数」当成「数据集全量」。
   */
  const unscannedEventCount = custom.candidates?.unscannedEventCount ?? null;

  const chartOf = (key: string) => (result.charts ?? []).find((chart) => chart.key === key) ?? null;
  const pathChart = chartOf("path-mean-median");
  const bucketChart = chartOf("drawdown-bucket-distribution");
  const groupChart = chartOf("non-break-vs-break-by-horizon");

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      {/* ① 研究范围口径：先讲清「这次在什么范围内研究」 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Microscope className="h-4 w-4" /> 研究范围与样本口径
          </CardTitle>
          <CardDescription>
            样本单位 = 1 个首板事件。候选 {summary.candidateCount} · 入池 {summary.eligibleCount} · 剔除{" "}
            {summary.excludedCount}。
            {windowInfo
              ? ` 观察窗口 T+1…T+${windowInfo.maxObservationDay}；后续视界 ${windowInfo.futureHorizons
                  .map((h) => `T+${h}`)
                  .join(" / ")}；分组观察日 T+${windowInfo.classificationDay}。`
              : ""}
            {custom.candidates
              ? ` 数据集声明事件 ${custom.candidates.datasetEventCount ?? "—"} 个，本次扫描 ${custom.candidates.scannedRowCount} 行、去重后 ${custom.candidates.candidateCount} 个，纳入统计 ${custom.candidates.usedEventCount} 个。`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {unscannedEventCount !== null && unscannedEventCount !== 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="space-y-1">
                <p className="font-medium">
                  样本账有缺口：数据集声明 {custom.candidates?.datasetEventCount ?? "—"} 个事件，本轮只扫描到{" "}
                  {custom.candidates?.candidateCount ?? "—"} 个，{unscannedEventCount} 个事件
                  <strong>未被扫描</strong>。
                </p>
                <p className="text-muted-foreground">
                  未被扫描的事件既不在「候选」也不在「剔除」清单里 —— 平台的样本账守恒式只保证
                  「入池 + 剔除 = 候选」，覆盖不到这个缺口。本页全部结论只适用于本轮扫描到的候选事件，
                  不能外推到数据集全量。
                </p>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            全部比率类数值一律为<strong>小数比例</strong>（-0.05 表示 -5%），负数 = 下跌 / 回撤；
            回撤 = (截至某日的最低最低价 − 基准) / 基准。
          </p>
          {Object.keys(summary.excludedByReason).length === 0 ? (
            <p className="text-sm text-muted-foreground">本次没有被剔除的候选事件。</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>剔除原因</TableHead>
                    <TableHead>说明</TableHead>
                    <TableHead className="text-right">事件数</TableHead>
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

      {/* ② 数据质量（规格 §22：异常不静默） */}
      {quality && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">数据质量检查</CardTitle>
            <CardDescription className="text-xs">
              这些计数说明「结果到底基于多少真实样本」；异常一律剔除并登记，不用 0 兜底、不静默丢弃。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-4">
            {[
              ["候选事件（去重后）", quality.scannedRowCount],
              ["入池样本", quality.includedCount],
              ["被剔除", quality.excludedCount],
              ["重复 eventId 行", quality.duplicateEventIdCount],
              ["缺少 rd=0 行情", quality.missingEventDayBarCount],
              ["观察窗口不完整", quality.missingObservationBarCount],
              ["非法 OHLC 根数", quality.invalidOhlcBarCount],
              ["长视界不齐备（已入池）", quality.insufficientForwardBarsEventCount],
              ["首板日收盘 ≠ 涨停价", quality.eventDayCloseDiffersFromLimitUpPriceCount],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border p-3">
                <p className="text-muted-foreground">{label}</p>
                <p className="mt-1 font-mono text-lg tabular-nums">{String(value ?? "—")}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ③ 关键统计量 */}
      {(result.statistics ?? []).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(result.statistics ?? []).map((stat) => (
            <Card key={stat.code}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="mt-1 font-mono text-xl tabular-nums">
                  {stat.value === null ? "—" : formatCell(stat.value, stat.digits)}
                  {stat.unit ? <span className="ml-1 text-xs text-muted-foreground">{stat.unit}</span> : null}
                </p>
                {stat.sampleCount !== null && stat.sampleCount !== undefined && (
                  <p className="mt-1 text-xs text-muted-foreground">样本 {stat.sampleCount}</p>
                )}
                {stat.note && <p className="mt-1 text-xs text-muted-foreground">{stat.note}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ④ 研究图：路径 / 回撤分布 / 不破 vs 破位 */}
      <div className="grid gap-3 lg:grid-cols-2">
        {pathChart && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{pathChart.title}</CardTitle>
              <CardDescription className="text-xs">
                {pathChart.description}（单位：比例；负数 = 下跌）
              </CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData(pathChart)} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="currentColor" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    domain={["auto", "auto"]}
                    tickFormatter={(value: number) => value.toFixed(3)}
                  />
                  <Tooltip formatter={(value: number | string) => (typeof value === "number" ? formatRatio(value) : String(value))} />
                  <ReferenceLine y={0} stroke="currentColor" opacity={0.4} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {pathChart.series.map((series, index) => (
                    <Line
                      key={series.key}
                      type="monotone"
                      dataKey={series.key}
                      name={series.label}
                      stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                      strokeWidth={1.8}
                      dot={{ r: 2.4 }}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {bucketChart && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{bucketChart.title}</CardTitle>
              <CardDescription className="text-xs">
                {bucketChart.description} 桶越靠右表示回撤越深。
              </CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData(bucketChart)} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="currentColor" />
                  <YAxis tick={{ fontSize: 11 }} stroke="currentColor" allowDecimals={false} />
                  <Tooltip formatter={(value: number | string) => String(value)} />
                  <Bar dataKey={bucketChart.series[0]?.key ?? "bucket-count"} name="样本数">
                    {chartData(bucketChart).map((row, index) => (
                      <Cell
                        key={String(row["name"])}
                        fill={index === 0 ? NEUTRAL_COLOR : DOWN_COLOR}
                        opacity={0.85}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {groupChart && (
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{groupChart.title}</CardTitle>
              <CardDescription className="text-xs">
                {groupChart.description}（单位：比例）本图只呈现差异，<strong>不判定优劣</strong>。
              </CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData(groupChart)} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="currentColor" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    tickFormatter={(value: number) => value.toFixed(3)}
                  />
                  <Tooltip formatter={(value: number | string) => (typeof value === "number" ? formatRatio(value) : String(value))} />
                  <ReferenceLine y={0} stroke="currentColor" opacity={0.4} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {groupChart.series.map((series, index) => (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      name={series.label}
                      fill={[NEUTRAL_COLOR, "#2563eb", "#d97706"][index % 3]}
                      opacity={0.85}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ⑤ 研究表（服务端算好；页面不重算） */}
      {(result.tables ?? []).map((table) => (
        <Card key={table.key}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Table2 className="h-4 w-4" /> {table.title}
            </CardTitle>
            {table.description && <CardDescription className="text-xs">{table.description}</CardDescription>}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {table.columns.map((column) => (
                    <TableHead
                      key={column.key}
                      className={column.align === "RIGHT" ? "whitespace-nowrap text-right" : "whitespace-nowrap"}
                    >
                      {column.label}
                      {column.unit ? `（${column.unit}）` : ""}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.map((row, index) => (
                  <TableRow key={`${table.key}-${index}`}>
                    {table.columns.map((column) => {
                      const value = row[column.key];
                      const numeric = typeof value === "number" ? value : null;
                      const tinted = column.align === "RIGHT" && numeric !== null && column.unit === "比例";
                      return (
                        <TableCell
                          key={column.key}
                          className={[
                            column.align === "RIGHT"
                              ? "whitespace-nowrap text-right font-mono text-xs tabular-nums"
                              : "whitespace-nowrap text-xs",
                            tinted ? (numeric >= 0 ? "text-rose-600" : "text-emerald-600") : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {formatCell(value, column.digits)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {/* ⑥ 分布 */}
      {(result.distributions ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">分布</CardTitle>
            <CardDescription className="text-xs">
              分布形状比单一均值更能反映「结论是靠少数极端样本撑起来的，还是普遍成立」。
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
                    {dist.buckets.map((bucket, index) => {
                      const width = total === 0 ? 0 : (bucket.count / total) * 100;
                      return (
                        <div
                          key={`${dist.code}-${bucket.label}`}
                          title={`${bucket.label}：${bucket.count} 条`}
                          style={{
                            width: `${width}%`,
                            backgroundColor: index === 0 ? NEUTRAL_COLOR : DOWN_COLOR,
                            opacity: 0.3 + (bucket.count / Math.max(1, total)) * 0.6,
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {dist.buckets.map((bucket) => (
                      <span key={`${dist.code}-${bucket.label}-n`}>
                        {bucket.label}：<span className="font-mono">{bucket.count}</span>
                      </span>
                    ))}
                  </div>
                  {dist.note && <p className="text-[11px] text-muted-foreground">{dist.note}</p>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ⑦ 比较（仅差值） */}
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
                      {formatCell(row.left)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatCell(row.right)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-xs tabular-nums ${
                        row.delta === null ? "" : row.delta >= 0 ? "text-rose-600" : "text-emerald-600"
                      }`}
                    >
                      {formatCell(row.delta)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {/* ⑧ 研究观察（事实描述；不是策略结论） */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" /> 研究观察
            <Badge variant="outline" className="ml-1 text-[10px]">
              描述性研究
            </Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            下面每一条都是**本次运行算出来的事实描述**，不含「因此应该买入 / 哪个更好」这类判断。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {observations.length === 0 ? (
            <p className="text-sm text-muted-foreground">本次没有生成观察。</p>
          ) : (
            observations.map((item, index) => (
              <div key={`${item.kind}-${index}`} className="flex gap-2">
                <Badge variant="outline" className={`mt-0.5 h-fit shrink-0 text-[10px] ${OBSERVATION_META[item.kind].className}`}>
                  {OBSERVATION_META[item.kind].label}
                </Badge>
                <p className="text-xs leading-relaxed text-muted-foreground">{item.text}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ⑨ 信息边界：决策时信息 vs 事后研究结果（规格 §21） */}
      {boundary && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="h-4 w-4" /> 信息边界（PIT）
            </CardTitle>
            <CardDescription className="text-xs">
              `decisionOffsetDays = {boundary.decisionOffsetDays}`；本实验声明使用事件日之后的数据：
              {boundary.forwardDataPurpose}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-xs md:grid-cols-2">
            <div className="space-y-1.5">
              <p className="font-medium">决策时信息（裁定分组只允许用它）</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {boundary.decisionTimeInformation.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-1.5">
              <p className="font-medium">事后研究结果（**不得**当成当时已知的信息）</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {boundary.postEventResearchOutcome.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="md:col-span-2">
              <Separator className="my-1" />
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {boundary.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ⑩ 待验证假设（不是策略） */}
      {hypotheses.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">待验证的策略假设</CardTitle>
            <CardDescription className="text-xs">
              下列假设**尚未验证**。本实验不自动创建 Strategy，也不做参数搜索 —— 是否进入下一阶段由项目路线决定。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {hypotheses.map((hypothesis) => (
              <div key={hypothesis.code} className="rounded-md border p-3">
                <p className="text-xs font-medium">
                  <span className="font-mono">{hypothesis.code}</span>：{hypothesis.statement}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">依据（本次运行）：{hypothesis.rationale}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ⑪ 口径与偏差 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">口径与已知偏差</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            {(custom.selectionNotes ?? []).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <Separator />
          <p>
            <strong>为什么本页不给「最优观察日 / 最优入场日 / 最佳回撤区间」：</strong>
            本页全部数值都是<strong>同一份数据</strong>上的描述性统计。在同一份数据里挑「最高 / 最低」，
            等价于在这份数据上做了一次参数选择 —— 换个时间窗口很可能不成立。要谈「哪个更好」，
            必须先有参数搜索 + 稳健性 + 样本外验证；本实验刻意不产出任何排序、评级或择优字段。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
