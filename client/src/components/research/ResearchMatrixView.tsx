/**
 * ResearchMatrixView — 把「同一批格子」的分析结果拼回**一张二维矩阵表**（结果页的主视图）。
 *
 * 起因（真实痛点）：用批量建分析跑出来的 Run 动辄上百个 CONDITIONAL 分析，
 * 每个分析在「结果」页签里只是一个 `#id CONDITIONAL` 按钮 —— 点开只能看到一个格子。
 * 于是「T+2 的 4~6% 桶 vs T+4 的 4~6% 桶」这种**横向比较**在页面上根本做不了，
 * 用户被迫把 135 个数字抄出来自己拼表。而这个信息本身就是一张表。
 *
 * 本组件的做法：**零后端改动**。`getRun` 已经返回了该 Run 全部分析的 name / target / status，
 * 矩阵的坐标（决策日 × 桶 × 指标族）完全可以从这两者解析出来（见 `researchMatrix.ts`）；
 * 结果值则按**当前选中的族惰性拉取**（一次 25 个以内的分析，由 tRPC 批链接合并成一个请求），
 * 所以首屏不需要知道另外 100 个分析的任何东西。
 *
 * ## 与「逐分析」视图的分工
 *
 * - 本视图回答「**哪一格**值得看」——横比、显著性、缺格一眼可见；
 * - 逐分析视图（`AnalysisResultsView`）回答「**这一格**里到底筛了什么、逐指标是多少」。
 *   点矩阵里的任一格会切过去并选中该分析，两者互补而不是替代。
 *
 * ## 判断「有效」的口径（必须原样理解，不能过度解读）
 *
 * - 格子里的数字 = **该格子的条件组**指标，取自已落库的 `research_result`（前端不重算）；
 * - 显著性 = 引擎落库的 `P_VALUE_DIFFERENCE`（Welch 两样本），**比较基准是「全样本」**
 *   （全部首板事件，含未回撤的），**不是相邻桶**。所以「显著为负」的含义是
 *   「比全部首板事件的表现差」，不是「比隔壁桶差」；
 * - 引擎原文已注明：**未校正多重比较、窗口互相重叠**。25 个格子逐个检验时，
 *   纯靠运气的「显著」也会出现若干次 —— 所以本视图给的是**线索**，不是结论；
 * - 真正成立还需要 Parameter Search → Backtest → Evaluation → Robustness → OOS → Walk-forward。
 */

import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { AlertTriangle, Grid3x3, Info, MousePointerClick } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common";
import { formatCount, type ResultRowLike } from "@/adapters/researchEngineAdapter";
import {
  ALL_PULLBACK_COLUMN,
  buildMatrix,
  buildMatrixIndex,
  pickDefaultSelection,
  summarizeRows,
  type MatrixCellVm,
  type MatrixSelection,
  type MatrixVm,
} from "./researchMatrix";
import type { MatrixAnalysisLike } from "./researchMatrix";

/** 正 = 涨（红），负 = 跌（绿）——与 `GroupMetricChart` 同一套语义色。 */
const UP_TEXT = "text-rose-600 dark:text-rose-400";
const DOWN_TEXT = "text-emerald-700 dark:text-emerald-400";

/** 显著格子的底色（极淡，只为「一眼扫出哪几格站得住」）。 */
const UP_BG = "bg-rose-500/10 dark:bg-rose-500/15";
const DOWN_BG = "bg-emerald-500/10 dark:bg-emerald-500/15";

export interface ResearchMatrixViewProps {
  /**
   * 该 Run 的全部分析（`researchEngine.getRun` 的 `analyses`）。
   * 只需要 name / target / status —— 本视图**不会**为它们逐个发请求。
   */
  analyses: readonly MatrixAnalysisLike[];
  /** 点格子时切到「逐分析」视图并选中该分析。 */
  onSelectAnalysis: (analysisId: number) => void;
}

function significanceMark(cell: MatrixCellVm): { text: string; className: string; title: string } {
  const s = cell.stats;
  if (s === null) return { text: "", className: "", title: "" };
  if (s.lowSample) {
    return {
      text: "小样本",
      className: "text-amber-700 dark:text-amber-400",
      title: "引擎标记为小样本：不判显著性（小样本下的 p 值不可靠）",
    };
  }
  if (s.pValue === null) {
    return { text: "", className: "", title: "该分析没有落库 p 值（样本不足或检验不可算）" };
  }
  const p = s.pValue < 0.0001 && s.pValue > 0 ? "< 0.0001" : s.pValue.toFixed(4);
  if (s.stronglySignificant) {
    return {
      text: "**",
      className: "font-semibold text-foreground",
      title: `p = ${p}（< 0.01）：与「全样本」的差值在 1% 水平显著`,
    };
  }
  if (s.significant) {
    return {
      text: "*",
      className: "font-semibold text-foreground",
      title: `p = ${p}（< 0.05）：与「全样本」的差值在 5% 水平显著`,
    };
  }
  return { text: "n.s.", className: "text-muted-foreground", title: `p = ${p}：与「全样本」的差值不显著` };
}

function cellTooltip(cell: MatrixCellVm): string {
  const s = cell.stats;
  if (s === null) {
    if (cell.analysisId === null) return "该 Run 没有建这一格的分析";
    return `分析 #${cell.analysisId}（${cell.status ?? "?"}）尚无可用结果`;
  }
  const lines = [
    cell.analysisName ?? "",
    `条件组：${s.valueDisplay}（n=${formatCount(s.conditionSampleCount)}）`,
    `全样本：${s.allValueDisplay}（n=${formatCount(s.allSampleCount)}）`,
    `差值：${s.differenceDisplay}`,
    s.differenceDefinition ?? "",
    s.conditionRule !== null ? `条件：${s.conditionRule}` : "",
    `中位数 ${s.medianDisplay} · 胜率 ${s.winRateDisplay} · 标准差 ${s.stdDisplay}`,
    s.excludedRowCount > 0 ? `（已忽略 ${s.excludedRowCount} 行口径不一致的指标行）` : "",
  ];
  return lines.filter((l) => l.length > 0).join("\n");
}

function cellClass(cell: MatrixCellVm): string {
  if (cell.stats === null) return "text-muted-foreground";
  const s = cell.stats;
  if (!s.significant) return "text-foreground";
  if (s.difference !== null && s.difference > 0) return `${UP_TEXT} ${UP_BG}`;
  if (s.difference !== null && s.difference < 0) return `${DOWN_TEXT} ${DOWN_BG}`;
  return "text-foreground";
}

function MatrixTable({
  vm,
  onSelectAnalysis,
}: {
  vm: MatrixVm;
  onSelectAnalysis: (analysisId: number) => void;
}) {
  const summaries = useMemo(() => summarizeRows(vm), [vm]);
  const summaryByRow = new Map(summaries.map((s) => [s.rowKey, s]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th className="sticky left-0 z-10 bg-background px-2 py-2 text-left text-xs font-medium text-muted-foreground">
              决策日 \ 回撤桶
            </th>
            {vm.columns.map((col) => (
              <th key={col.key} className="px-2 py-2 text-right text-xs font-medium">
                <span className={col.key === ALL_PULLBACK_COLUMN ? "text-muted-foreground" : ""}>
                  {col.label}
                </span>
              </th>
            ))}
            <th className="px-2 py-2 text-right text-xs font-medium text-muted-foreground">行小结</th>
          </tr>
        </thead>
        <tbody>
          {vm.rows.map((row) => {
            const summary = summaryByRow.get(row.rowKey);
            return (
              <tr key={row.rowKey} className="border-b last:border-b-0">
                <th className="sticky left-0 z-10 bg-background px-2 py-1.5 text-left align-middle text-xs font-medium">
                  {row.rowKey}
                </th>
                {row.cells.map((cell) => {
                  const mark = significanceMark(cell);
                  const clickable = cell.analysisId !== null;
                  return (
                    <td
                      key={cell.columnKey}
                      className={`px-2 py-1.5 text-right align-middle ${cellClass(cell)} ${
                        clickable ? "cursor-pointer hover:outline hover:outline-1 hover:outline-primary/40" : ""
                      }`}
                      title={cellTooltip(cell)}
                      onClick={() => {
                        if (cell.analysisId !== null) onSelectAnalysis(cell.analysisId);
                      }}
                    >
                      {cell.stats === null ? (
                        <span className="font-mono text-xs">
                          {cell.analysisId === null ? "未建" : "无结果"}
                        </span>
                      ) : (
                        <>
                          <div className="font-mono tabular-nums">
                            {cell.stats.valueDisplay}
                            {mark.text !== "" && (
                              <span className={`ml-1 text-[11px] ${mark.className}`} title={mark.title}>
                                {mark.text}
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            n={formatCount(cell.stats.conditionSampleCount)}
                          </div>
                        </>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right align-middle text-[11px] text-muted-foreground">
                  {summary === undefined ? (
                    "—"
                  ) : (
                    <>
                      <div className="font-mono tabular-nums">
                        {summary.cellCount} 格 · n={formatCount(summary.totalSampleCount)}
                      </div>
                      <div className="font-mono tabular-nums">
                        <span className={UP_TEXT}>+{summary.positiveSignificant}</span>
                        {" / "}
                        <span className={DOWN_TEXT}>−{summary.negativeSignificant}</span> 显著
                      </div>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ResearchMatrixView({ analyses, onSelectAnalysis }: ResearchMatrixViewProps) {
  const utils = trpc.useUtils();
  const index = useMemo(() => buildMatrixIndex(analyses), [analyses]);
  const [selection, setSelection] = useState<MatrixSelection | null>(null);

  // 选中的（口径 × 族）必须仍然存在；否则回落到默认选择
  useEffect(() => {
    if (index.entries.length === 0) return;
    const stillExists =
      selection !== null &&
      index.entries.some(
        (e) => e.coordinate.scope.key === selection.scopeKey && e.coordinate.familyKey === selection.familyKey,
      );
    if (stillExists) return;
    setSelection(pickDefaultSelection(index));
  }, [index, selection]);

  const activeCells = useMemo(() => {
    if (selection === null) return [];
    return index.entries.filter(
      (e) => e.coordinate.scope.key === selection.scopeKey && e.coordinate.familyKey === selection.familyKey,
    );
  }, [index, selection]);

  // 只拉「当前选中族」的结果；切族时其余 100 个分析一个请求都不发
  const queries = useQueries({
    queries: activeCells.map((e) =>
      utils.researchEngine.getAnalysisResults.queryOptions({ analysisId: e.analysisId }),
    ),
  });

  const rowsById = useMemo(() => {
    const map = new Map<number, readonly ResultRowLike[]>();
    activeCells.forEach((e, i) => {
      const data = queries[i]?.data;
      if (data !== undefined) map.set(e.analysisId, data as ResultRowLike[]);
    });
    return map;
  }, [activeCells, queries]);

  const vm = useMemo(
    () => (selection === null ? null : buildMatrix(index, selection, rowsById)),
    [index, selection, rowsById],
  );

  const loading = queries.some((q) => q.isLoading);
  const errored = queries.filter((q) => q.isError).length;

  if (index.entries.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">矩阵视图：本 Run 没有可归组的分析</CardTitle>
          <CardDescription className="text-xs">
            矩阵视图要求分析名里带「T+d + 回撤桶」，且 target 是 segment 变量
            （形如 segment_return_2_7d）—— 即用「批量建分析」按「决策日 × 深度桶」建出来的那一批。
            其他分析请看「逐分析」。
          </CardDescription>
        </CardHeader>
        {index.unclassified.length > 0 && (
          <CardContent className="space-y-1 pt-0">
            <p className="text-xs font-medium text-muted-foreground">未归类的分析（{index.unclassified.length}）</p>
            {index.unclassified.slice(0, 10).map((u) => (
              <div key={u.analysisId} className="text-[11px] text-muted-foreground">
                <span className="font-mono">#{u.analysisId}</span> {u.analysisName}
                <span className="text-amber-700 dark:text-amber-400"> · {u.reason}</span>
              </div>
            ))}
            {index.unclassified.length > 10 && (
              <p className="text-[11px] text-muted-foreground">…还有 {index.unclassified.length - 10} 条</p>
            )}
          </CardContent>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-3 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Grid3x3 className="h-4 w-4" /> 矩阵视图
            </CardTitle>
            <CardDescription className="text-xs">
              把这一批「决策日 × 回撤桶」分析的结果拼成一张表。数值、样本数、p 值均取自落库结果，
              前端不重算；点任一格可切到「逐分析」看该格的口径与逐指标明细。
            </CardDescription>
          </div>
          {vm !== null && (
            <div className="text-right text-[11px] text-muted-foreground">
              <div className="font-mono tabular-nums">
                已建 {vm.coverage.built}/{vm.coverage.cells} 格 · 有结果 {vm.coverage.withResult}
                {vm.coverage.missing > 0 ? ` · 未建 ${vm.coverage.missing}` : ""}
              </div>
              {loading && <div>结果加载中…</div>}
              {errored > 0 && (
                <div className="text-amber-700 dark:text-amber-400">{errored} 格结果加载失败</div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {index.scopes.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">口径</span>
              {index.scopes.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  title={s.description}
                  onClick={() => setSelection((prev) => ({ scopeKey: s.key, familyKey: prev?.familyKey ?? "" }))}
                  className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                    selection?.scopeKey === s.key
                      ? "border-primary bg-primary/10 font-medium"
                      : "text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">指标</span>
            {index.families.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setSelection((prev) => ({ scopeKey: prev?.scopeKey ?? "BARE", familyKey: f.key }))}
                className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                  selection?.familyKey === f.key
                    ? "border-primary bg-primary/10 font-medium"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                {f.label}
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">{f.entryCount}</span>
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {vm !== null && vm.columns.length > 0 && (
          <MatrixTable vm={vm} onSelectAnalysis={onSelectAnalysis} />
        )}

        {vm !== null && vm.columns.length === 0 && (
          <EmptyState icon={Grid3x3} title="这一组合没有分析" description="换一个指标或口径试试。" />
        )}

        {vm !== null && vm.metricCode !== null && (
          <p className="text-[11px] text-muted-foreground">
            主指标：<span className="font-medium">{vm.metricLabel}</span>（格子左上）；
            小字为该格的**条件组样本数**。<span className="font-semibold">*</span> / <span className="font-semibold">**</span>
            {" "}= 与「全样本」的差值在 5% / 1% 水平显著，<span className="font-mono">n.s.</span> = 不显著。
            颜色按 A 股习惯：<span className={UP_TEXT}>红 = 高于全样本</span>、
            <span className={DOWN_TEXT}>绿 = 低于全样本</span>。
          </p>
        )}

        {vm !== null && vm.notes.length > 0 && (
          <div className="space-y-1 rounded-md border bg-muted/20 px-3 py-2">
            {vm.notes.map((n, i) => (
              <p key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {n}
              </p>
            ))}
          </div>
        )}

        {vm !== null && (
          <details className="rounded-md border bg-muted/20 px-3 py-2">
            <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3 w-3 shrink-0" />
              这张表怎么读 / 已知边界（点开）
            </summary>
            <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">口径</span>：{vm.scope.label} —— {vm.scope.description}
              </p>
              <p>
                <span className="font-medium text-foreground">显著性基准是「全样本」</span>
                （全部首板事件，含未回撤的），<span className="font-semibold">不是相邻桶</span>。
                因此「显著为负」= 比全部首板事件差，而不是比隔壁那一格差。
              </p>
              <p>
                <span className="font-medium text-foreground">未做多重比较校正</span>
                ，且各格窗口互相重叠 —— 25 个格子逐个检验时，纯靠运气也会出现若干「显著」。
                本视图给的是**线索**，不是结论；要成立仍须 Parameter Search → Backtest → Evaluation →
                Robustness → OOS → Walk-forward。
              </p>
              <p>
                <span className="font-medium text-foreground">归组依据</span>
                ：分析名的「`T+d` + 回撤桶」与 `target` 变量（两者决策日必须一致）。
                <span className="font-semibold">给分析改名会让它脱离矩阵</span>，这时它会出现在下方「未归类」里并写明原因。
              </p>
              <p>
                <span className="font-medium text-foreground">缺格不隐藏</span>
                ：「未建」= 该 Run 没有这一格的分析；「无结果」= 有分析但结果里没有可用的条件组统计（未跑完 / 条件组为空）。
              </p>
              <p>
                <span className="font-medium text-foreground">行小结</span>
                只给「格数 / 样本数合计 / 显著格数」——这三样是加法与计数。**不做按样本数加权平均**：
                各格样本是否互斥、并集是否等于全集取决于建批方式，前端无从校验，宁可不算。
              </p>
              <p className="flex items-center gap-1.5">
                <MousePointerClick className="h-3 w-3" /> 点任一格 → 切到「逐分析」看该格的完整口径与逐指标明细。
              </p>
            </div>
          </details>
        )}

        {index.unclassified.length > 0 && (
          <details className="rounded-md border bg-muted/20 px-3 py-2">
            <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              未归类到矩阵的分析（{index.unclassified.length}）
            </summary>
            <div className="mt-2 space-y-1">
              {index.unclassified.slice(0, 30).map((u) => (
                <div key={u.analysisId} className="text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    className="font-mono underline-offset-2 hover:underline"
                    onClick={() => onSelectAnalysis(u.analysisId)}
                  >
                    #{u.analysisId}
                  </button>{" "}
                  {u.analysisName}
                  <span className="text-amber-700 dark:text-amber-400"> · {u.reason}</span>
                </div>
              ))}
              {index.unclassified.length > 30 && (
                <p className="text-[11px] text-muted-foreground">…还有 {index.unclassified.length - 30} 条</p>
              )}
            </div>
          </details>
        )}

        {index.entries.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="text-[10px] font-normal">
              共 {index.entries.length} 个分析已归组
            </Badge>
            {index.scopes.length > 1 && (
              <span>发现 {index.scopes.length} 种口径：{index.scopes.map((s) => s.label).join(" / ")}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
