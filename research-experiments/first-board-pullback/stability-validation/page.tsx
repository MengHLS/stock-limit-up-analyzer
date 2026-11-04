/**
 * 实验页面 · 首板后回踩条件稳定性验证（EXP-002）。
 *
 * ## 这一页的职责
 *
 * 把**服务端已经算完**的稳定性结果讲清楚：基准是什么、铺了哪些维度与变体、
 * 每个变体相对**同一个基准**的指标变化有没有超过声明容差、样本账是多少、产物在哪。
 *
 * 🔴 本文件**不得** import `experiment.ts` 或任何 `server/**` 的运行时 —— 它跑在浏览器里。
 *    连本目录的 `result.ts` 也只 **type-only** 引入（`import type`），
 *    所以 `result.ts` 的 zod / 组装逻辑**不会进客户端 bundle**。
 *    一切口径（标签 / 容差 / 样本条件名 / 不可用原因）都从下发的 `customPayload` 里读，
 *    页面**不重算、不硬编码**。
 *
 * 🔴 页面**不产出**任何「最优观察日 / 最佳视界 / 最优样本条件」的措辞或排序 ——
 *    本实验只回答「结论对条件敏不敏感」，不选条件。
 *
 * ## 三态（规格 §I）
 *
 * `outcome === null` ⇒ 本次会话还没运行过（空态，**不是**失败）；
 * `outcome.result === null` ⇒ 本次执行失败（指向平台上方「执行状态」区块，页不自己造错误 UI）。
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, BarChart3, Layers, Microscope, Package, ShieldCheck, Table2, Target } from "lucide-react";
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
import { EmptyState } from "@/components/common";
import type { ExperimentPageProps } from "@/researchExperiments/contract";
import type { ObservationKind, StabilityValidationCustomPayload } from "./result";

/** A 股习惯：涨 = 红、跌 = 绿。 */
const UP_COLOR = "#e11d48";
/** 多序列标识色（用于「哪条是哪条」，不承载涨跌语义）。 */
const SERIES_COLORS = ["#2563eb", "#d97706", "#7c3aed"] as const;
const TOLERANCE_COLOR = "#dc2626";

const RATIO_DIGITS = 6;

function formatRatio(value: unknown, digits = RATIO_DIGITS): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function formatPercent(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(RATIO_DIGITS);
  return String(value);
}

const VERDICT_META: Record<string, { label: string; className: string }> = {
  baseline: { label: "基准", className: "border-slate-400 text-slate-600" },
  stable: { label: "稳定", className: "border-emerald-400 text-emerald-600" },
  sensitive: { label: "敏感", className: "border-rose-400 text-rose-600" },
  insufficient: { label: "指标不足", className: "border-amber-400 text-amber-700" },
  failed: { label: "执行失败", className: "border-red-500 text-red-700" },
};

const OBSERVATION_META: Record<ObservationKind, { label: string; className: string }> = {
  DESCRIPTIVE: { label: "描述性事实", className: "border-slate-300 text-slate-600" },
  COMPARATIVE: { label: "维度比较", className: "border-blue-300 text-blue-600" },
  POTENTIAL_SIGNAL: { label: "值得注意", className: "border-amber-300 text-amber-700" },
  LIMITATION: { label: "局限", className: "border-rose-300 text-rose-600" },
};

function verdictBadge(verdict: string | null | undefined) {
  const meta = VERDICT_META[verdict ?? ""] ?? { label: verdict ?? "—", className: "border-slate-300" };
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  );
}

/** 表 → 行数组（`result.tables` 是权威数据源；页面不重算任何值）。 */
function rowsOf(
  tables:
    | ReadonlyArray<{
        key: string;
        columns: ReadonlyArray<{ key: string; label: string }>;
        rows: ReadonlyArray<Record<string, unknown>>;
      }>
    | undefined,
  key: string
): { columns: Array<{ key: string; label: string }>; rows: Array<Record<string, unknown>> } {
  const table = (tables ?? []).find((item) => item.key === key);
  if (table === undefined) return { columns: [], rows: [] };
  return { columns: [...table.columns], rows: [...table.rows] };
}

export default function StabilityValidationExperimentPage({ descriptor, outcome }: ExperimentPageProps) {
  if (outcome === null) {
    return (
      <Card data-experiment-page={descriptor.pageKey}>
        <CardContent className="p-6">
          <EmptyState
            icon={BarChart3}
            title="尚未运行"
            description={
              <>
                选择 Dataset 版本后点击右上角「运行」，本页会展示
                <strong> 3 个维度 × 16 个变体相对同一个基准的稳定性矩阵</strong>
                、逐变体样本账与产物清单。
              </>
            }
          />
        </CardContent>
      </Card>
    );
  }

  const result = outcome.result;
  if (result === null) {
    return (
      <Card data-experiment-page={descriptor.pageKey}>
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

  const custom = (result.customPayload ?? {}) as Partial<StabilityValidationCustomPayload>;
  const summary = result.sampleSummary;
  const baseline = custom.baseline ?? null;
  const counts = custom.counts ?? { variantCount: 0, stableCount: 0, sensitiveCount: 0, insufficientCount: 0, failedCount: 0 };
  const dimensions = custom.dimensions ?? [];
  const comparisonSpecs = custom.comparisonSpecs ?? [];
  const comparisonSpecNotes = custom.comparisonSpecNotes ?? [];
  const variants = custom.variants ?? [];
  const dimensionConclusions = custom.dimensionConclusions ?? [];
  const observations = custom.observations ?? [];
  const notes = custom.notes ?? [];
  const declaredArtifacts = custom.artifacts ?? [];
  const sampleConditionLabels = custom.sampleConditionLabels ?? {};
  const unavailableReasonLabels = custom.unavailableReasonLabels ?? {};
  const exclusionReasonLabels = custom.exclusionReasonLabels ?? {};
  const candidates = custom.candidates ?? null;
  const dataQuality = custom.dataQuality ?? null;
  const matrix = rowsOf(result.tables, "stability_matrix");
  const comparisonTable = rowsOf(result.tables, "stability_comparison");
  const accountingTable = rowsOf(result.tables, "sample_accounting");

  /**
   * 矩阵图的数据源 = **同一个 `stability_matrix` 表**（不另算一套口径）：
   * y = |Δ| / 容差，1.0 即容差线。
   */
  const ratioByVariant = new Map<string, Record<string, number | null | string>>();
  const metricLabels = new Map<string, string>(
    comparisonSpecs.map((spec) => [spec.metric, spec.label ?? spec.metric])
  );
  for (const row of matrix.rows) {
    const code = String(row["variantCode"] ?? "");
    const metric = String(row["metric"] ?? "");
    const delta = row["delta"];
    const tolerance = row["tolerance"];
    const entry: Record<string, number | null | string> = ratioByVariant.get(code) ?? { name: code };
    if (typeof delta === "number" && typeof tolerance === "number" && tolerance > 0) {
      entry[metric] = Math.abs(delta) / tolerance;
    } else {
      entry[metric] = null;
    }
    ratioByVariant.set(code, entry);
  }
  const ratioChartData = [...ratioByVariant.values()];

  /**
   * 容差线（y = 1.0）必须落在 Y 值域内，否则**整条线会被 recharts 静默丢弃**。
   *
   * ## 为什么不能只写 `<ReferenceLine y={1} />`（EXP-002 真机踩过，两条独立机制同时咬人）
   *
   * 1. **默认丢弃**：recharts `ReferenceLine.defaultProps.ifOverflow = 'discard'`
   *    （`node_modules/recharts/es6/cartesian/ReferenceLine.js:187`），而 `getEndPoints`
   *    在「参考值超出该轴值域」时**直接 `return null`**（同文件 `:71-72`）
   *    ⇒ 线条整块不挂载、**不报任何错**。
   * 2. **`ifOverflow="extendDomain"` 在本仓是空操作**：值域扩展发生在
   *    `util/DetectReferenceElementsDomain.js:23`，它读的是 **React 元素上的显式 props**
   *    `el.props['yAxisId']` —— 而 React 元素**不含 `defaultProps`**。本图的
   *    `<YAxis />` 用的是默认 `yAxisId = 0`，`<ReferenceLine />` 的默认 `yAxisId` 也是 0
   *    但**不在 `el.props` 里** ⇒ `undefined === 0` 为假 ⇒ 扩展被跳过。
   *    更糟：同时 `discard` 检查也被跳过 ⇒ 线**被渲染在绘图区之外**
   *    （实测 `y1 = -32.75`，而绘图区顶边 ≈ 8）—— 有 DOM、看不见，比「没有这条线」更难发现。
   *
   * ⇒ 本实验不依赖上述任何内部机制，而是**自己把值域下界钉死到包含 1**
   *   （`Math.max(1, 实际最大比值)`）。这样：值域恒含 1 ⇒ `discard` 分支天然不触发
   *   ⇒ 线既存在、也在可见区内。
   *
   * 回归闸门 = `docs/evidence/_probe_9cl_exp002_frontend.mjs` 的 D15 / D15b / D15c
   * （同时断言「线存在」「线落在此值域内」「文案与 DOM 一致」）。
   */
  const ratioAxisMax = Math.max(
    1,
    ...ratioChartData.flatMap((entry) =>
      comparisonSpecs
        .map((spec) => entry[spec.metric])
        .filter((value): value is number => typeof value === "number")
    )
  );

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      {/* ① 总览：基准 / 变体数 / 稳定 / 敏感 / 失败 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> 稳定性总览
          </CardTitle>
          <CardDescription>
            一个 Run、一个基准、{dimensions.length} 个维度共享它 ⇒ 矩阵共{" "}
            {counts.variantCount + 1} 行（含基准）。总体判定：
            {verdictBadge(custom.overallVerdict)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <StatCell label="非基准变体" value={counts.variantCount} />
            <StatCell label="稳定" value={counts.stableCount} tone="emerald" />
            <StatCell label="敏感" value={counts.sensitiveCount} tone="rose" />
            <StatCell label="指标不足" value={counts.insufficientCount} tone="amber" />
            <StatCell label="执行失败" value={counts.failedCount} tone="red" />
          </div>
          {baseline !== null && (
            <div className="rounded-md border p-3 text-xs">
              <p className="font-medium">
                基准 · <span className="font-mono">{baseline.code}</span>
              </p>
              <p className="text-muted-foreground">{baseline.label}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <div>
                  <span className="text-muted-foreground">有效样本 </span>
                  <span className="font-mono">{baseline.accounting?.validCount ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">平均收盘收益 </span>
                  <span className="font-mono">{formatPercent(baseline.metrics?.metrics.meanCloseReturn)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">中位收盘收益 </span>
                  <span className="font-mono">{formatPercent(baseline.metrics?.metrics.medianCloseReturn)}</span>
                </div>
              </div>
              {custom.baselineRationale && (
                <p className="mt-2 text-muted-foreground">{custom.baselineRationale}</p>
              )}
            </div>
          )}
          <div className="rounded-md border p-3 text-xs text-muted-foreground">
            <p>
              样本账（平台信封口径 = 基准变体）：候选 {summary.candidateCount} · 参与统计{" "}
              {summary.eligibleCount} · 未参与 {summary.excludedCount}。
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {(summary.notes ?? []).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
          {candidates && (
            <div className="rounded-md border p-3 text-xs">
              <p className="font-medium">扫描与账目缺口</p>
              <p className="text-muted-foreground">
                数据集声明事件 {candidates.datasetEventCount ?? "—"} · 本轮扫描 {candidates.scannedRowCount} 行 ·
                去重后候选 {candidates.candidateCount} · 分页 {candidates.eventPageCount} 轮 · 账目缺口{" "}
                <span className="font-mono">{candidates.unscannedEventCount ?? "null（不可知）"}</span>
                {candidates.unscannedEventCount === null
                  ? "（数据集未声明事件总数 ⇒ null ≠ 0）"
                  : candidates.droppedByScanLimit
                    ? " ⚠️ 存在缺口：声明的事件没有全部进入候选"
                    : "（无缺口）"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ② 研究范围：维度声明 + 比较声明（容差从哪来必须是可读的） */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Microscope className="h-4 w-4" /> 维度与判定口径
          </CardTitle>
          <CardDescription>
            维度由实验**声明**（核心对维度语义完全不可见）；容差是**研究口径**，不是统计显著性。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="grid gap-2 sm:grid-cols-3">
            {dimensions.map((dimension) => (
              <div key={dimension.id} className="rounded-md border p-2">
                <p className="font-medium">{dimension.label}</p>
                <p className="font-mono text-[10px] text-muted-foreground">{dimension.id}</p>
                {dimension.description && <p className="mt-1 text-muted-foreground">{dimension.description}</p>}
                <p className="mt-1 text-muted-foreground">
                  单位：{dimension.valueUnit ?? "（类别码）"}
                </p>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>指标</TableHead>
                  <TableHead>容差</TableHead>
                  <TableHead>方向</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisonSpecs.map((spec) => (
                  <TableRow key={spec.metric}>
                    <TableCell className="font-mono text-[11px]">
                      {spec.metric}
                      <span className="ml-1 text-muted-foreground">{spec.label ?? ""}</span>
                    </TableCell>
                    <TableCell className="font-mono">{spec.tolerance}</TableCell>
                    <TableCell>{spec.direction}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
            {comparisonSpecNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* ③ 稳定性矩阵：|Δ| / 容差（图形与表格同源） */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4" /> 稳定性矩阵 · |Δ| / 容差
          </CardTitle>
          <CardDescription>
            y = |变体 − 基准| / 该指标的声明容差。越过红色虚线（1.0）即该指标**相对基准的变化超过容差**。
            缺柱 = 该指标不可用（**不是 0**）。横轴按变体声明顺序，**不按数值排序**。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ratioChartData.length === 0 ? (
            <p className="text-xs text-muted-foreground">矩阵为空（没有可比较的变体）。</p>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ratioChartData} margin={{ top: 8, right: 12, bottom: 40, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
                  <XAxis
                    dataKey="name"
                    angle={-35}
                    textAnchor="end"
                    height={60}
                    tick={{ fontSize: 10, fill: "currentColor" }}
                  />
                  {/*
                    🔴 值域**必须**由 `ratioAxisMax`（≥ 1）显式给出，不能留给 recharts 的
                    `[0, 'auto']` 默认域 —— 否则下面的容差线 y=1 会落在值域之外而被丢弃
                    （完整根因见 `ratioAxisMax` 上方注释）。
                  */}
                  <YAxis
                    tick={{ fontSize: 10, fill: "currentColor" }}
                    domain={[0, ratioAxisMax]}
                  />
                  <Tooltip
                    formatter={(value: unknown) =>
                      typeof value === "number" ? value.toFixed(4) : "—"
                    }
                    contentStyle={{ fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {/* 容差线 = y 值 1.0（|Δ|/容差 = 1）。值域已保证含 1，见上方 `ratioAxisMax`。 */}
                  <ReferenceLine y={1} stroke={TOLERANCE_COLOR} strokeDasharray="4 3" />
                  {comparisonSpecs.map((spec, index) => (
                    <Bar key={spec.metric} dataKey={spec.metric} name={metricLabels.get(spec.metric) ?? spec.metric} fill={SERIES_COLORS[index % SERIES_COLORS.length]}>
                      {ratioChartData.map((entry) => (
                        <Cell
                          key={`${String(entry["name"])}-${spec.metric}`}
                          fill={
                            typeof entry[spec.metric] === "number" && (entry[spec.metric] as number) > 1
                              ? UP_COLOR
                              : SERIES_COLORS[index % SERIES_COLORS.length]
                          }
                        />
                      ))}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            柱色说明：越过容差（比值 &gt; 1）的柱用 A 股红（{UP_COLOR}）标出（「变化显著」不是「涨」）；
            其余按指标分色。缺柱为该指标不可用。
          </p>
        </CardContent>
      </Card>

      {/* ④ 稳定性矩阵明细表（Dimension / Variant / Sample Count / Metric / … / Verdict） */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Table2 className="h-4 w-4" /> 稳定性矩阵明细
          </CardTitle>
          <CardDescription>
            每行 = 一个变体的一个指标相对**同一基准**的变化与判定；判定只可能是
            stable / sensitive / insufficient。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={matrix.columns} rows={matrix.rows} verdictKeys={["verdict"]} />
        </CardContent>
      </Card>

      {/* ⑤ 逐变体判定汇总 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" /> 逐变体判定汇总
          </CardTitle>
          <CardDescription>
            每行 = 一个变体的汇总判定（sensitive 优先于 insufficient 优先于 stable —— 敏感性是正面发现，必须先被看见）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable columns={comparisonTable.columns} rows={comparisonTable.rows} verdictKeys={["verdict"]} />
          <div className="grid gap-2 sm:grid-cols-3">
            {dimensionConclusions.map((conclusion) => (
              <div key={conclusion.dimensionId} className="rounded-md border p-2 text-xs">
                <p className="flex items-center justify-between gap-2">
                  <span className="font-medium">{conclusion.label}</span>
                  {verdictBadge(conclusion.verdict)}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {conclusion.variantCount} 个变体 · 敏感 {conclusion.sensitiveCount} / 稳定{" "}
                  {conclusion.stableCount} / 不足 {conclusion.insufficientCount} / 失败 {conclusion.failedCount}
                </p>
                {conclusion.sensitiveEntries.length > 0 && (
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    敏感：{conclusion.sensitiveEntries.map((entry) => entry.code).join(" / ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ⑥ 样本账（逐变体四桶） */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">逐变体样本账</CardTitle>
          <CardDescription>
            互斥划分：candidate = valid + excluded + missing + invalid；eligible = valid + excluded。
            「结论用了多少样本」必须逐变体可复核。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable columns={accountingTable.columns} rows={accountingTable.rows} verdictKeys={[]} />
          {Object.keys(exclusionReasonLabels).length > 0 && (
            <details className="rounded-md border p-3 text-xs">
              <summary className="cursor-pointer font-medium">原因码对照表</summary>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {Object.entries(exclusionReasonLabels).map(([code, label]) => (
                  <li key={code}>
                    <span className="font-mono text-[10px]">{code}</span> — {label}
                  </li>
                ))}
              </ul>
              <ul className="mt-2 space-y-0.5 text-muted-foreground">
                {Object.entries(unavailableReasonLabels).map(([code, label]) => (
                  <li key={code}>
                    <span className="font-mono text-[10px]">{code}</span> — {label}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {dataQuality && (
            <p className="text-[11px] text-muted-foreground">
              数据质量：坏 OHLC bar {dataQuality.invalidOhlcBarCount} 根（涉及事件{" "}
              {dataQuality.invalidOhlcAffectedEventCount} 个）· 缺窗口行情行 {dataQuality.missingWindowBarCount} 对 ·
              **坏 bar 混入可用窗口次数 {dataQuality.invalidOhlcUsedInWindowCount}（必须为 0）**。
            </p>
          )}
        </CardContent>
      </Card>

      {/* ⑦ 变体明细（含不可用原因，不伪造数值） */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">变体明细</CardTitle>
          <CardDescription>
            逐个变体的口径、指标与不可用原因。指标不可用时给**原因**，不给 0。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {variants.map((variant) => {
            const unavailable = Object.entries(variant.metrics?.unavailable ?? {});
            const values = variant.metrics?.metrics ?? {};
            return (
              <div key={variant.code} className="rounded-md border p-3 text-xs">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{variant.code}</span>
                  {verdictBadge(variant.verdict)}
                  <span className="text-muted-foreground">{variant.label}</span>
                </p>
                <p className="mt-1 text-muted-foreground">
                  样本条件 {sampleConditionLabels[variant.sampleCondition] ?? variant.sampleCondition} · 有效样本{" "}
                  {variant.accounting?.validCount ?? "—"} · 候选 {variant.accounting?.candidateCount ?? "—"}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    平均 <span className="font-mono">{formatPercent(values["meanCloseReturn"])}</span>
                  </span>
                  <span>
                    中位 <span className="font-mono">{formatPercent(values["medianCloseReturn"])}</span>
                  </span>
                  <span>
                    突破率 <span className="font-mono">{formatPercent(values["breakoutVsCloseRate"])}</span>
                  </span>
                </div>
                {unavailable.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-700">
                    {unavailable.map(([metric, reason]) => (
                      <li key={metric}>
                        <span className="font-mono text-[10px]">{metric}</span> 不可用：{reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ⑧ 观察项 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">观察项</CardTitle>
          <CardDescription>只放能由本轮实测数字支撑的陈述；`sensitive` 是发现，不是缺陷。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {observations.map((observation) => {
            const meta = OBSERVATION_META[observation.kind];
            return (
              <div key={observation.text} className="rounded-md border p-2 text-xs">
                <Badge variant="outline" className={meta.className}>
                  {meta.label}
                </Badge>
                <p className="mt-1">{observation.text}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ⑨ 产物 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" /> 产物（Artifact）
          </CardTitle>
          <CardDescription>
            本实验经 `context.artifact()` 声明写出的文件；字节在对象存储，
            **权威索引（含体积与存在性实测）是本次 Run 的 `manifest.json`**。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {declaredArtifacts.length === 0 ? (
            <p className="text-xs text-muted-foreground">本次未声明任何文件产物。</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名字</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>MIME</TableHead>
                    <TableHead>说明</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {declaredArtifacts.map((artifact) => (
                    <TableRow key={artifact.name}>
                      <TableCell className="font-mono text-[11px]">{artifact.name}</TableCell>
                      <TableCell>{artifact.role}</TableCell>
                      <TableCell className="font-mono text-[10px]">{artifact.contentType ?? "—"}</TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        {artifact.label ?? ""} {artifact.description ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Object Key = <span className="font-mono">…/runs/&lt;runId&gt;/&lt;role&gt;/&lt;name&gt;</span>；
            本表只声明「写什么」，**不声称字节已在存储里**。
          </p>
        </CardContent>
      </Card>

      {/* ⑩ 口径与运行信息 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">口径与运行信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs text-muted-foreground">
          <p>
            实验 <span className="font-mono">{custom.experimentCode}</span> v
            <span className="font-mono">{custom.experimentVersion}</span> · 计算口径{" "}
            <span className="font-mono">{custom.computationVersion}</span>
          </p>
          <p>
            跨阶段 Robustness 核心运行 <span className="font-mono">{custom.robustnessRunId}</span> · 指纹{" "}
            <span className="font-mono">{String(custom.robustnessFingerprint ?? "").slice(0, 16)}…</span>
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCell({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "rose" | "amber" | "red" }) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "rose"
        ? "text-rose-600"
        : tone === "amber"
          ? "text-amber-700"
          : tone === "red"
            ? "text-red-700"
            : "";
  return (
    <div className="rounded-md border p-2 text-center">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`font-mono text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

/** 通用表格（列定义来自信封里的表；页面不自己写列）。 */
function DataTable({
  columns,
  rows,
  verdictKeys,
}: {
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
  verdictKeys: string[];
}) {
  if (columns.length === 0) {
    return <p className="text-xs text-muted-foreground">该表未在结果信封里出现。</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className="whitespace-nowrap text-xs">
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {columns.map((column) => {
                const value = row[column.key];
                if (verdictKeys.includes(column.key)) {
                  return (
                    <TableCell key={column.key} className="whitespace-nowrap">
                      {verdictBadge(typeof value === "string" ? value : null)}
                    </TableCell>
                  );
                }
                const isNegativeNumber =
                  typeof value === "number" && Number.isFinite(value) && value < 0 && column.key === "delta";
                return (
                  <TableCell
                    key={column.key}
                    className={`whitespace-nowrap font-mono text-[11px] ${isNegativeNumber ? "text-emerald-600" : ""}`}
                  >
                    {formatCell(value)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 && <p className="p-3 text-xs text-muted-foreground">没有数据行。</p>}
      <p className="p-2 text-[10px] text-muted-foreground">共 {rows.length} 行；表格与同名 CSV 产物**同源**。</p>
    </div>
  );
}
