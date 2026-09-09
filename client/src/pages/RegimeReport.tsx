/**
 * FE-8 — Regime + 报告生成 UI：市场 Regime 标签可视化 + 研究结论报告导出。
 *
 * 展示规格（ROADMAP §48.4 FE-8）：Regime 标签图例 / 时间轴·区间可视化 /
 * Regime × 策略表现归因 / 研究结论报告导出（含 datasetVersion / strategyVersion /
 * codeVersion 溯源 + 「研究结论 vs 技术预览」标记）。
 *
 * 纪律（§0.2 / §31 / 前端不是 Quant Engine）：
 * - **只读渲染**：regime 标签 / 归因 / 报告产物一律来自后端
 *   `marketRegime.describe` + `marketRegime.run`，本页不计算 regime、不本地合成曲线；
 * - **技术预览口径（R7）**：C-22.1 引擎 CODE_READY 但 C-22/23 未 VALIDATED +
 *   报告导出无后端服务 → 顶部醒目提示条标注「技术预览·非 RESEARCH_READY 口径」；
 * - **诚实空态**：未运行 / 数据未就绪时标签、曲线、归因、报告全部 Empty State /
 *   「—」，零伪造（无假 regime 标签、假曲线、假报告内容）；
 * - 图例 = 后端 `describe`（引擎常量 1:1），本页不维护第二份口径。
 *
 * 路由 `/regime-report`、导航「Regime/报告」由主 agent 统一注册（本文件不改 App/AppShell）。
 */

import { useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  CalendarRange,
  Database,
  FileDown,
  FileText,
  GitCommit,
  Layers,
  Loader2,
  Play,
  TriangleAlert,
} from "lucide-react";
import {
  SectionCard,
  StatusBadge,
  MetricCard,
  EmptyState,
  TechnicalDetails,
  DataTable,
} from "@/components/common";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { MarketRegimeRouter } from "../../../server/marketRegimeRouter";

type DescribeOutput = inferRouterOutputs<MarketRegimeRouter>["describe"];
type RunOutput = inferRouterOutputs<MarketRegimeRouter>["run"];
type RunInput = inferRouterInputs<MarketRegimeRouter>["run"];

// ---------------------------------------------------------------------------
// 展示工具（纯显示；不参与任何量化判定）
// ---------------------------------------------------------------------------

/** 各维标签色（确定性展示色；A 股惯例涨红跌绿；unassessed 统一浅灰）。 */
const DIM_LABEL_COLORS: Record<string, Record<string, string>> = {
  trend: { up: "#f43f5e", down: "#10b981", sideways: "#94a3b8" },
  volatility: { low: "#38bdf8", mid: "#94a3b8", high: "#f59e0b" },
  liquidity: { high: "#f43f5e", mid: "#94a3b8", low: "#3b82f6" },
  breadth: { broad: "#f43f5e", mixed: "#94a3b8", narrow: "#10b981" },
  sentiment: { risk_on: "#f43f5e", neutral: "#94a3b8", risk_off: "#10b981" },
  indexState: { above_ma: "#f43f5e", near_ma: "#94a3b8", below_ma: "#10b981" },
  limitUpEnv: { hot: "#f43f5e", normal: "#94a3b8", cold: "#3b82f6" },
};
const UNASSESSED_COLOR = "#e2e8f0";

const fmtPct = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "—" : `${v.toFixed(digits)}%`;
const fmtNum = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "—" : v.toFixed(digits);
const pnlTone = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : v >= 0 ? "text-rose-600" : "text-emerald-700";

/** 复合键 → 可读短标签（只保留已评估维的 label，缺维不显示，便于图表 X 轴）。 */
function shortCompositeKey(key: string): string {
  const parts = key
    .split("|")
    .filter((part) => !part.includes("=NA:"))
    .map((part) => part.split("=")[1]);
  return parts.length > 0 ? parts.join("·") : key;
}

/** 连续同状态区间（纯展示分组；引擎已给出逐日标签，本函数只做相邻分组）。 */
function contiguousSegments(tags: RunOutput["tags"]): Array<{
  key: string;
  startDate: string;
  endDate: string;
  count: number;
}> {
  const segments: Array<{ key: string; startDate: string; endDate: string; count: number }> = [];
  let current: { key: string; startDate: string; endDate: string; count: number } | null = null;
  for (const day of tags) {
    const key = day.composite?.compositeKey ?? null;
    if (key === null) {
      current = null;
      continue;
    }
    if (current !== null && current.key === key) {
      current.endDate = day.tradeDate;
      current.count += 1;
      continue;
    }
    if (current !== null) segments.push(current);
    current = { key, startDate: day.tradeDate, endDate: day.tradeDate, count: 1 };
  }
  if (current !== null) segments.push(current);
  return segments;
}

/** 导出完整 MarketRegimeRun（canonical JSON，含 fingerprint）——技术预览口径快照。 */
function downloadRun(run: RunOutput): void {
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${run.regimeRunId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

export default function RegimeReport() {
  // 注：appRouter 尚未合并 marketRegime 子路由（server/routers.ts），`trpc.marketRegime`
  // 存在类型缺口 —— 预期内，协调者合并后统一恢复为原生调用；此处仅桥接以保留输出类型。
  const describeQuery = trpc.marketRegime.describe.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const runMutation = trpc.marketRegime.run.useMutation();

  const describe: DescribeOutput | undefined = describeQuery.data;
  const run: RunOutput | undefined = runMutation.data;

  const [benchmark, setBenchmark] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const runAnalysis = () => {
    const input: RunInput = {
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(benchmark.trim() ? { benchmarkIndexCode: benchmark.trim() } : {}),
    };
    runMutation.mutate(input);
  };

  const tags = run?.tags ?? [];
  const segments = useMemo(() => contiguousSegments(tags), [tags]);

  // 归因分组 → 柱状图数据（按累计收益降序，短键做 X 轴）
  const attributionBars = useMemo(() => {
    if (!run?.attribution) return [];
    return [...run.attribution.groups]
      .sort((a, b) => b.cumulativeReturnPct - a.cumulativeReturnPct)
      .map((group) => ({
        name: shortCompositeKey(group.regimeKey),
        key: group.regimeKey,
        cumulative: Number(group.cumulativeReturnPct.toFixed(2)),
        samples: group.sampleCount,
      }));
  }, [run]);

  const dates = tags.map((day) => day.tradeDate);
  const dimensionIds = describe?.dimensions.map((dim) => dim.id) ?? [];
  const coverage = run?.coverage ?? null;

  const running = runMutation.isPending;
  const runError = runMutation.error;
  const describeError = describeQuery.error;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <BarChart3 className="h-5 w-5" />
          市场 Regime + 研究结论报告
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          FE-8 · Regime 标签可视化 + 研究结论报告导出。标签 / 归因 / 报告产物全部来自后端
          marketRegime 端点，本页只读渲染、不计算、不伪造。
        </p>
      </div>

      {/* R7 醒目提示条：技术预览·非 RESEARCH_READY 口径 */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-800">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="text-xs leading-relaxed">
          <span className="font-semibold">技术预览 · 非 RESEARCH_READY 口径。</span>
          C-22.1 引擎为 CODE_READY，C-22/23 尚未 VALIDATED，报告导出无后端服务；
          本页展示的 regime 标签 / 归因 / 报告快照仅供口径观察，不得据此下正式策略结论。
        </div>
      </div>

      {/* 运行控制 */}
      <SectionCard
        title="运行 Market Regime 分析"
        icon={Activity}
        description="接收基准指数 + 日期范围（可空 = 最近 120 个交易日）→ 后端加载真实事实 → 纯函数引擎产出标签序列。"
        right={
          <Button
            variant="default"
            size="sm"
            onClick={runAnalysis}
            disabled={running}
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {running ? "运行中…" : "运行分析"}
          </Button>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">基准指数代码</p>
            <Input
              value={benchmark}
              onChange={(event) => setBenchmark(event.target.value)}
              placeholder={describe?.benchmarkIndexCode ?? "000300.SH"}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">起始日期（含）</p>
            <Input
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              placeholder="YYYY-MM-DD（空 = 最近窗口）"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">结束日期（含）</p>
            <Input
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              placeholder="YYYY-MM-DD（空 = 最新）"
            />
          </div>
        </div>

        {runError && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {(runError as unknown as Error)?.message ?? String(runError)}
          </div>
        )}
        {!run && !running && !runError && (
          <p className="mt-3 text-xs text-muted-foreground">
            尚未运行。点击右上角「运行分析」以真实数据计算 regime 标签序列与归因。
          </p>
        )}
      </SectionCard>

      {/* 图例（后端 describe，引擎常量 1:1） */}
      <SectionCard
        title="Regime 标签图例"
        description="七维名称 / 标签值域 / compositeKey 编码 / unassessed reasonCode——取自后端 marketRegime.describe（engine 常量 1:1，非本页硬编码）。"
        icon={Layers}
        right={
          <StatusBadge
            status={describe ? "SUCCESS" : describeError ? "ERROR" : "INFO"}
            label={describe ? "LOADED" : describeError ? "FAILED" : "LOADING"}
          />
        }
      >
        {describeError ? (
          <EmptyState title="图例加载失败" description={String((describeError as unknown as Error)?.message ?? describeError)} />
        ) : !describe ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在加载图例…
          </p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {describe.dimensions.map((dim) => (
                <div key={dim.id} className="rounded-lg border bg-muted/20 px-3 py-2.5">
                  <p className="flex items-baseline gap-2 text-xs font-medium">
                    <span>{dim.cn}</span>
                    <code className="font-mono text-[11px] text-muted-foreground">{dim.id}</code>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {dim.labels.map((label) => (
                      <span
                        key={label.code}
                        className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-card px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: DIM_LABEL_COLORS[dim.id]?.[label.code] ?? "#94a3b8" }}
                        />
                        {label.code}
                        <span className="font-sans text-slate-500">{label.cn}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-dashed px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <p className="font-medium text-foreground">
                compositeKey 编码（缺维显式可见，不折叠成具体状态）
              </p>
              <p>
                顺序固定：<code className="font-mono">{describe.compositeKeyEncoding.dimensionOrder.join(" → ")}</code>；
                assessed 维贡献{" "}
                <code className="font-mono">{describe.compositeKeyEncoding.assessedPart}</code>，
                unassessed 维贡献{" "}
                <code className="font-mono">{describe.compositeKeyEncoding.unassessedPart}</code>，
                以 <code className="font-mono">{describe.compositeKeyEncoding.separator}</code> 连接。
              </p>
              <p className="mt-1.5">unassessed reasonCode（数据不足 ≠ 中性，绝不伪造）：</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {describe.unassessedReasonCodes.map((reason) => (
                  <li
                    key={reason.code}
                    className="inline-flex items-baseline gap-1 rounded border border-slate-200 bg-card px-1.5 py-0.5 font-mono text-[11px] text-slate-500"
                    title={reason.cn}
                  >
                    {reason.code}
                    <span className="font-sans">{reason.cn}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </SectionCard>

      {/* 时间轴 / 区间可视化 */}
      <SectionCard
        title="Regime 时间轴 / 区间"
        description="逐交易日七维标签色带（每维一行）；unassessed 日灰格不填伪色。区间 = 连续同复合状态段。"
        icon={CalendarRange}
        right={
          <StatusBadge
            status={run ? (run.coverage.tradingDayCount > 0 ? "SUCCESS" : "INCONCLUSIVE") : "NOT_RUN"}
            label={run ? `COVERED ${run.coverage.tradingDayCount}D` : "NO_DATA"}
          />
        }
      >
        {tags.length === 0 ? (
          <div className="flex h-56 items-center justify-center rounded-md border border-dashed bg-muted/20">
            <EmptyState
              title="暂无时间轴"
              description="运行「运行分析」后在此渲染：每维一行色带，X 轴 = 交易日（coverage 区间）。"
              className="border-0 py-8"
            />
          </div>
        ) : (
          <>
            <div className="max-h-[360px] overflow-auto rounded-md border">
              <table className="border-separate border-spacing-[1px] text-[10px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-muted px-2 py-1 text-left font-medium text-muted-foreground">
                      维度
                    </th>
                    {dates.map((date) => (
                      <th key={date} className="whitespace-nowrap px-1 py-1 font-normal text-muted-foreground">
                        {date.slice(5)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dimensionIds.map((dimId) => (
                    <tr key={dimId}>
                      <td className="sticky left-0 z-10 bg-muted px-2 py-0.5 font-mono text-muted-foreground">
                        {dimId}
                      </td>
                      {tags.map((day) => {
                        const tag = day[dimId];
                        if (tag.kind === "unassessed") {
                          return (
                            <td
                              key={day.tradeDate}
                              title={`${day.tradeDate} · ${dimId} · ${tag.reasonCode}`}
                              className="h-4 w-4"
                              style={{ backgroundColor: UNASSESSED_COLOR }}
                            />
                          );
                        }
                        return (
                          <td
                            key={day.tradeDate}
                            title={`${day.tradeDate} · ${dimId} = ${tag.label}`}
                            className="h-4 w-4"
                            style={{ backgroundColor: DIM_LABEL_COLORS[dimId]?.[tag.label] ?? "#94a3b8" }}
                          />
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mb-1.5 mt-3 text-xs text-muted-foreground">
              覆盖区间：{coverage?.startDate ?? "—"} ~ {coverage?.endDate ?? "—"}（
              {coverage?.tradingDayCount ?? 0} 个交易日）；连续同复合状态区间：
            </p>
            {segments.length === 0 ? (
              <EmptyState title="暂无区间" description="运行后按复合状态切分连续区间。" className="py-6" />
            ) : (
              <div className="max-h-40 overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5">起</th>
                      <th className="px-2 py-1.5">止</th>
                      <th className="px-2 py-1.5 text-right">交易日数</th>
                      <th className="px-2 py-1.5">复合状态键</th>
                    </tr>
                  </thead>
                  <tbody>
                    {segments.map((segment, index) => (
                      <tr key={index} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-mono">{segment.startDate}</td>
                        <td className="px-2 py-1.5 font-mono">{segment.endDate}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{segment.count}</td>
                        <td className="max-w-md truncate px-2 py-1.5 font-mono text-[11px]" title={segment.key}>
                          {segment.key}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* Regime × 策略表现归因 */}
      <SectionCard
        title="Regime × 策略表现归因"
        description={
          "同一 regime 下的策略表现（逐日 returnPct 来自生产回测 realisticSimulation.equityCurve，注入后分组聚合）。" +
          "分组字段与口径见后端 attribution 层；结论判定留给研究层，本页只呈现可复核统计。"
        }
        right={
          <StatusBadge
            status={run?.attribution ? "SUCCESS" : run ? "INCONCLUSIVE" : "NOT_RUN"}
            label={run?.attribution ? "ATTRIBUTED" : run ? "NO_ATTRIBUTION" : "NO_DATA"}
          />
        }
      >
        {!run?.attribution ? (
          <EmptyState
            title="暂无归因"
            description="运行后注入生产回测权益曲线逐日收益并按 regime 分组聚合；无表现样本时归因为 null（不伪造）。"
            className="py-10"
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard label="总样本(日)" value={run.attribution.totalSampleCount} hint="注入的逐日策略表现样本数" />
              <MetricCard label="已匹配(日)" value={run.attribution.matchedSampleCount} hint="对得上 regime 标签的样本数" />
              <MetricCard label="未匹配(日)" value={run.attribution.unmatchedSampleCount} hint="无标签/unassessed 日，显式计数" />
              <MetricCard label="组间分化(pp)" value={fmtNum(run.attribution.spreadPct)} hint="最好组 − 最差组累计收益（组数 <2 为 null）" />
            </div>

            <div className="mt-4">
              <p className="mb-1.5 text-xs text-muted-foreground">
                分组累计收益（%）：柱色按正负着色（涨红跌绿）；分组键为短标签（只含已评估维）。
              </p>
              <div className="h-56 w-full rounded-md border p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={attributionBars} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748b" }} interval={0} angle={-20} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
                    <Tooltip
                      cursor={{ fill: "rgba(148,163,184,0.1)" }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const item = payload[0]!.payload as (typeof attributionBars)[number];
                        return (
                          <div className="rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                            <p className="font-medium">{item.key}</p>
                            <p className="font-mono tabular-nums">
                              累计 {fmtPct(item.cumulative)} · {item.samples} 日
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="cumulative" radius={[3, 3, 0, 0]}>
                      {attributionBars.map((bar) => (
                        <Cell key={bar.key} fill={bar.cumulative >= 0 ? "#f43f5e" : "#10b981"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="mt-4">
              <p className="mb-1.5 text-xs text-muted-foreground">
                分组明细（未匹配原因直方图 + 按 Regime 键分组的列）：
              </p>
              <DataTable maxHeight={380}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Regime 键</TableHead>
                    <TableHead className="text-right text-xs">样本日</TableHead>
                    <TableHead className="text-right text-xs">累计收益 %</TableHead>
                    <TableHead className="text-right text-xs">日均 %</TableHead>
                    <TableHead className="text-right text-xs">中位 %</TableHead>
                    <TableHead className="text-right text-xs">胜率 %</TableHead>
                    <TableHead className="text-right text-xs">最佳 %</TableHead>
                    <TableHead className="text-right text-xs">最差 %</TableHead>
                    <TableHead className="text-right text-xs">占比 %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.attribution.groups.map((group) => (
                    <TableRow key={group.regimeKey}>
                      <TableCell className="max-w-sm truncate font-mono text-[11px]" title={group.regimeKey}>
                        {group.regimeKey}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{group.sampleCount}</TableCell>
                      <TableCell className={`text-right text-xs tabular-nums ${pnlTone(group.cumulativeReturnPct)}`}>
                        {group.cumulativeReturnPct.toFixed(2)}%
                      </TableCell>
                      <TableCell className={`text-right text-xs tabular-nums ${pnlTone(group.meanReturnPct)}`}>
                        {group.meanReturnPct.toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{fmtPct(group.medianReturnPct)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{fmtPct(group.winRatePct, 1)}</TableCell>
                      <TableCell className={`text-right text-xs tabular-nums ${pnlTone(group.bestReturnPct)}`}>
                        {group.bestReturnPct.toFixed(2)}%
                      </TableCell>
                      <TableCell className={`text-right text-xs tabular-nums ${pnlTone(group.worstReturnPct)}`}>
                        {group.worstReturnPct.toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{group.shareOfSamplesPct.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
              {Object.keys(run.attribution.unmatchedByReasonCode).length > 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  未匹配原因直方图：
                  {Object.entries(run.attribution.unmatchedByReasonCode)
                    .map(([reason, count]) => `${reason}=${count}`)
                    .join("；")}
                </p>
              )}
            </div>
          </>
        )}
      </SectionCard>

      {/* 报告导出：溯源 + 结论标记 + 导出按钮 */}
      <SectionCard
        title="研究结论报告导出"
        icon={FileText}
        right={<StatusBadge status="INFO" label="技术预览快照" />}
        description="报告导出无后端服务，本页导出 MarketRegimeRun 的 canonical JSON 快照（含 fingerprint），并标注溯源与「研究结论 vs 技术预览」。"
      >
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="text-xs font-medium">
            溯源与结论标记{" "}
            <span className="font-normal text-muted-foreground">
              （报告必含 datasetVersion / strategyVersion / codeVersion）
            </span>
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <div className="rounded-md border bg-card px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Database className="h-3 w-3" /> datasetVersion
              </p>
              <p className="mt-1 font-mono text-sm tabular-nums">
                {run?.datasetVersion ?? "未绑定（null）"}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                MarketRegimeRun.datasetVersion（本端点从原始表构建 facts，未绑定版本化数据集）
              </p>
            </div>
            <div className="rounded-md border bg-card px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <FileText className="h-3 w-3" /> strategyVersion
              </p>
              <p className="mt-1 font-mono text-sm tabular-nums">—</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                策略 semver（FE-4 strategy.validate/bump）；本端点未绑定策略版本
              </p>
            </div>
            <div className="rounded-md border bg-card px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <GitCommit className="h-3 w-3" /> codeVersion
              </p>
              <p className="mt-1 font-mono text-sm tabular-nums">—</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                C-13.3 experimentLineage codeVersion（{`<pkg>+g<commit>[.dirty]`}）；本端点未绑定
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            结论标记（两态）：技术预览 = 引擎 CODE_READY 但 C-22/23
            未认证时的演示输出，不得标注为研究结论；研究结论 = 认证完成且携带完整溯源后由报告服务标注。当前锁定为技术预览。
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge status="INFO" label="技术预览（当前态）" />
            <StatusBadge status="NOT_RUN" label="研究结论（待认证 + 溯源）" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => run && downloadRun(run)}
            disabled={!run}
          >
            <FileDown className="h-4 w-4" />
            导出 JSON 快照
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {run
              ? `将导出 ${run.regimeRunId}.json（canonical MarketRegimeRun，含 fingerprint / tagSequenceFingerprint）。`
              : "运行分析后即可导出（未运行时禁用）。"}
          </span>
        </div>
      </SectionCard>

      {/* 工程信息：溯源 / unassessed 统计 / 指纹（折叠） */}
      <TechnicalDetails title="技术详情：FE-8 字段字典与运行记录（只读契约说明，非数据）">
        <ul className="space-y-1 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <li>
            状态：marketRegime 引擎 CODE_READY（server/research/marketRegime）；
            C-22/23 未 VALIDATED；报告导出无后端服务（技术预览快照）。
          </li>
          <li>
            facts 来源（PIT：facts.asOf === tradeDate，只用 T 及之前）：
            index_daily（基准指数收盘 → trend/volatility/indexState）；
            limit_up_records（涨停家数 → limitUpCount 事实）；
            getLeaderCandidateBacktest（realisticSimulation.equityCurve → 归因逐日 returnPct）。
          </li>
          <li>
            缺维语义（诚实）：无全市场横截面 / 涨跌停分母 / 全市场成交额 / 情绪源 →
            breadth/limitUpEnv/liquidity/sentiment 由引擎显式 unassessed（
            REGIME_NO_CROSS_SECTION / REGIME_DATA_MISSING /
            REGIME_SENTIMENT_SOURCE_MISSING），绝不填零或冒充。
          </li>
          {run && (
            <>
              <li>
                运行身份：regimeRunId={run.regimeRunId}；recordVersion={run.recordVersion}；
                benchmarkIndexCode={run.benchmarkIndexCode}；createdAt={run.createdAt}。
              </li>
              <li>
                coverage：{run.coverage.startDate ?? "null"} ~ {run.coverage.endDate ?? "null"}（
                {run.coverage.tradingDayCount} 交易日）。
              </li>
              <li>
                unassessedStats：totalTagCount={run.unassessedStats.totalTagCount}；
                totalUnassessedCount={run.unassessedStats.totalUnassessedCount}；
                byDimension={JSON.stringify(run.unassessedStats.byDimension)}。
              </li>
              <li>
                byReasonCode={JSON.stringify(run.unassessedStats.byReasonCode)}。
              </li>
              <li>
                tagSequenceFingerprint={run.tagSequenceFingerprint}；fingerprint={run.fingerprint}。
              </li>
            </>
          )}
          <li>
            纪律：本页不计算 regime 标签 / 指标 / 曲线，全部来自后端端点；技术预览口径已顶部醒目标注（R7）。
          </li>
        </ul>
      </TechnicalDetails>
    </div>
  );
}
