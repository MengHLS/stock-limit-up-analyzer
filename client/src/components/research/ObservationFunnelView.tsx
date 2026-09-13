/**
 * ObservationFunnelView — 把「首板回踩」策略的**规则链**渲染成一张逐级漏斗表。
 *
 * ## 为什么需要第三个视图（与矩阵 / 逐分析的分工）
 *
 * - `ResearchMatrixView` 回答「**决策日 × 回撤桶** 哪一格值得看」—— 那是**二维表**；
 * - `AnalysisResultsView` 回答「**某一个分析**里筛了什么、逐指标多少」—— 那是**一格**；
 * - 本视图回答「**一条规则链上，每一级各自贡献了什么**」—— 那是**一维逐级收紧**。
 *
 * 用户给的策略（守线 → 缩量 → 企稳放量）本质是后者。二维矩阵表达不了「守线单独筛掉多少」，
 * 逐分析视图也看不出「加了缩量之后收益变好了还是只是样本变少了」。
 *
 * ## 结果的判读纪律（**必须原样展示，不得弱化**）
 *
 * - 数值直接取自落库的 `research_result`，前端**不重算**；
 * - 显著性基准是「**全部首板事件**」，不是相邻一级 —— 所以「显著为正」的含义是
 *   「比全部首板事件好」，不是「比上一级好」；
 * - 🔴 **各级样本集不是严格包含关系**：主链各级是子集，对照组（已破位 / 未缩量）是**平行**的，
 *   视觉上必须区分，否则会被误读成「漏斗在层层减少」；
 * - 引擎原文已注明 **未做多重比较校正**、窗口重叠 —— 本视图给线索，不给结论；
 * - 真正成立还需要 Parameter Search → Backtest → Evaluation → Robustness → OOS。
 */

import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { AlertTriangle, Filter, Info, MousePointerClick, TrendingDown } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCount, type ResultRowLike } from "@/adapters/researchEngineAdapter";
import {
  buildFunnelIndex,
  formatRatio,
  formatShare,
  summarizeFunnel,
  type FunnelStageVm,
} from "./observationFunnel";
import type { FunnelAnalysisLike } from "./observationFunnel";

/** 正 = 涨（红），负 = 跌（绿）—— 与矩阵视图同一套语义色。 */
const UP_TEXT = "text-rose-600 dark:text-rose-400";
const DOWN_TEXT = "text-emerald-700 dark:text-emerald-400";

function valueClass(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  if (v > 0) return UP_TEXT;
  if (v < 0) return DOWN_TEXT;
  return "text-muted-foreground";
}

/** p 值的显著性标记（与矩阵视图同一口径：不显著就不给星）。 */
function significanceBadge(stage: FunnelStageVm) {
  if (stage.lowSample) {
    return (
      <span className="text-[11px] text-amber-700 dark:text-amber-400" title="引擎标记为小样本，不判显著性">
        小样本
      </span>
    );
  }
  if (stage.pValue === null) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
  const p = stage.pValue;
  const text = p > 0 && p < 0.0001 ? "<0.0001" : p.toFixed(4);
  if (p < 0.01) return <span className="font-semibold">** {text}</span>;
  if (p < 0.05) return <span className="font-semibold">* {text}</span>;
  return <span className="text-muted-foreground">n.s. {text}</span>;
}

/** 单行漏斗级。 */
function StageRow({
  stage,
  isLast,
  onSelect,
}: {
  stage: FunnelStageVm;
  isLast: boolean;
  onSelect: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = stage.value !== null;

  return (
    <div
      className={[
        "relative rounded-md border p-3 transition-colors",
        stage.nested ? "bg-card" : "bg-muted/40 border-dashed",
        hasResult ? "hover:bg-muted/50" : "opacity-70",
      ].join(" ")}
    >
      {/* 级次标记 + 名称 */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{stage.label}</span>
            {!stage.nested && (
              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                平行对照
              </Badge>
            )}
            <button
              type="button"
              onClick={() => onSelect(stage.analysisId)}
              className="font-mono text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              title="切到「逐分析」查看该分析的逐指标明细"
            >
              #{stage.analysisId}
            </button>
            {stage.status !== null && stage.status !== "COMPLETED" && (
              <Badge variant="outline" className="h-4 px-1 text-[10px] text-amber-700 dark:text-amber-400">
                {stage.status}
              </Badge>
            )}
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">{stage.rule}</p>
        </div>

        {/* 核心数字：n / 占比 / 均值 / 差值 */}
        <div className="flex shrink-0 items-center gap-4 text-right">
          <div>
            <div className="font-mono text-sm tabular-nums">{formatCount(stage.conditionSampleCount)}</div>
            <div className="text-[10px] text-muted-foreground">
              占全样本 {formatShare(stage.shareOfAll)}
            </div>
          </div>
          {stage.nested && stage.shrinkFromPrev !== null && (
            <div title={`相对「${stage.shrinkBaselineLabel ?? "?"}」的保留比`}>
              <div className="font-mono text-sm tabular-nums">{formatRatio(stage.shrinkFromPrev)}</div>
              <div className="text-[10px] text-muted-foreground">保留 / 父级</div>
            </div>
          )}
          <div>
            <div className={`font-mono text-sm tabular-nums ${valueClass(stage.value)}`}>
              {stage.valueDisplay}
            </div>
            <div className="text-[10px] text-muted-foreground">条件组均值</div>
          </div>
          <div>
            <div className={`font-mono text-sm tabular-nums ${valueClass(stage.difference)}`}>
              {stage.difference === null
                ? "—"
                : `${stage.difference >= 0 ? "+" : ""}${(stage.difference * 100).toFixed(2)}pp`}
            </div>
            <div className="text-[10px] text-muted-foreground">
              对比全样本 {stage.difference === null ? "" : `（${valueClass(stage.difference)}）`}
            </div>
          </div>
          <div>
            <div className="text-[11px]">{significanceBadge(stage)}</div>
            <div className="text-[10px] text-muted-foreground">p 值</div>
          </div>
        </div>
      </div>

      {/* 展开：中位数 / 胜率 / 标准差 / 规则原文 / 口径说明 */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span>中位数 {stage.medianDisplay}</span>
        <span>胜率 {stage.winRateDisplay}</span>
        <span>标准差 {stage.stdDisplay}</span>
        <span>全样本均值 {stage.allValueDisplay}</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="underline-offset-2 hover:underline"
        >
          {expanded ? "收起规则原文" : "规则原文"}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 space-y-1 rounded bg-muted/50 p-2 text-[11px]">
          <div className="font-mono">{stage.conditionRule ?? "(引擎未落库 conditionRule)"}</div>
          {stage.excludedRowCount > 0 && (
            <div className="text-amber-700 dark:text-amber-400">
              已忽略 {stage.excludedRowCount} 行口径不一致的指标行（target 与结果行自报的口径不符）
            </div>
          )}
          <div className="text-muted-foreground">
            分析名：{stage.analysisName}
          </div>
        </div>
      )}

      {/* 主链的连接线（视觉上表示「下一级是在这一级基础上再加约束」） */}
      {isLast === false && stage.nested && (
        <div className="absolute -bottom-3 left-6 h-3 w-px bg-border" aria-hidden />
      )}
    </div>
  );
}

export interface ObservationFunnelViewProps {
  /** 该 Run 的全部分析（`researchEngine.getRun` 的 `analyses`）。 */
  analyses: readonly FunnelAnalysisLike[];
  /** 点任一分析时切到「逐分析」视图。 */
  onSelectAnalysis: (analysisId: number) => void;
}

export function ObservationFunnelView({ analyses, onSelectAnalysis }: ObservationFunnelViewProps) {
  const utils = trpc.useUtils();
  const index = useMemo(() => buildFunnelIndex(analyses, new Map()), [analyses]);

  // 只对本视图能识别的分析取结果（一次 ≤ 13 个，tRPC 批链接合并）
  const targets = useMemo(
    () => [...index.chain, ...index.controls].map((s) => s.analysisId),
    [index],
  );

  const queries = useQueries({
    queries: targets.map((id) =>
      utils.researchEngine.getAnalysisResults.queryOptions({ analysisId: id }),
    ),
  });

  const rowsById = useMemo(() => {
    const map = new Map<number, readonly ResultRowLike[]>();
    targets.forEach((id, i) => {
      const data = queries[i]?.data;
      if (data !== undefined) map.set(id, data as ResultRowLike[]);
    });
    return map;
  }, [targets, queries]);

  // 带上结果重建（此时才能算出 n / 均值 / 差值）
  const full = useMemo(() => buildFunnelIndex(analyses, rowsById), [analyses, rowsById]);
  const summary = useMemo(() => summarizeFunnel(full), [full]);

  const loading = queries.some((q) => q.isLoading);
  const errored = queries.filter((q) => q.isError).length;

  if (full.chain.length === 0 && full.controls.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">漏斗视图：本 Run 没有可归组的「规则链」分析</CardTitle>
          <CardDescription className="text-xs">
            漏斗视图要求分析名里带「T+k + 未破/已破 + 缩量/放量/翻红」这类规则标记，
            即按「守线 → 缩量 → 量价共振」这条链建出来的一批 CONDITIONAL 分析。
          </CardDescription>
        </CardHeader>
        {full.unclassified.length > 0 && (
          <CardContent className="space-y-1 pt-0">
            <p className="text-xs font-medium text-muted-foreground">
              未归类（{full.unclassified.length}）
            </p>
            {full.unclassified.slice(0, 8).map((u) => (
              <div key={u.analysisId} className="text-[11px] text-muted-foreground">
                <span className="font-mono">#{u.analysisId}</span> {u.analysisName}
                <span className="text-amber-700 dark:text-amber-400"> · {u.reason}</span>
              </div>
            ))}
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
              <Filter className="h-4 w-4" /> 信号漏斗视图
            </CardTitle>
            <CardDescription className="text-xs">
              「守线 → 缩量 → 量价共振」逐级收紧；每级的样本量与统计量取自落库结果，前端不重算。
              {full.targetVariable !== null && (
                <>
                  {" "}
                  统一观测指标：<span className="font-mono">{full.targetVariable}</span>
                </>
              )}
            </CardDescription>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <div className="font-mono tabular-nums">
              全样本 {formatCount(summary.allSampleCount)}
              {summary.finalSampleCount !== null && (
                <>
                  {" "}· 链末端 {formatCount(summary.finalSampleCount)}（
                  {formatShare(summary.finalShareOfAll)}）
                </>
              )}
            </div>
            <div className="font-mono tabular-nums">
              主链有结果 {summary.resolvedChain}/{summary.chainSize} 级
            </div>
            {loading && <div>结果加载中…</div>}
            {errored > 0 && (
              <div className="text-amber-700 dark:text-amber-400">{errored} 级结果加载失败</div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* ---- 主链 ---- */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">主链（逐级收紧，样本为真子集）</span>
          </div>
          <div className="space-y-3">
            {full.chain.map((s, i) => (
              <StageRow
                key={s.kind}
                stage={s}
                isLast={i === full.chain.length - 1}
                onSelect={onSelectAnalysis}
              />
            ))}
          </div>
        </div>

        {/* ---- 对照组 ---- */}
        {full.controls.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-xs font-medium">
                平行对照组（与主链互斥，**不是**漏斗的一层 —— 样本不会在此继续减少）
              </span>
            </div>
            <div className="space-y-3">
              {full.controls.map((s) => (
                <StageRow key={s.kind} stage={s} isLast onSelect={onSelectAnalysis} />
              ))}
            </div>
          </div>
        )}

        {/* ---- 未归类 ---- */}
        {full.unclassified.length > 0 && (
          <div className="space-y-1 rounded border border-dashed p-2">
            <p className="text-xs font-medium text-muted-foreground">
              未归类分析（{full.unclassified.length}）—— 分析名里没有可识别的规则标记
            </p>
            {full.unclassified.slice(0, 6).map((u) => (
              <div key={u.analysisId} className="text-[11px] text-muted-foreground">
                <span className="font-mono">#{u.analysisId}</span> {u.analysisName}
              </div>
            ))}
            {full.unclassified.length > 6 && (
              <p className="text-[11px] text-muted-foreground">…还有 {full.unclassified.length - 6} 条</p>
            )}
          </div>
        )}

        {/* ---- 读法说明（合规内容，不得删）---- */}
        <div className="space-y-1.5 rounded border border-amber-500/40 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-1.5 font-medium">
            <Info className="h-3.5 w-3.5" /> 怎么读这张漏斗
          </div>
          <p>
            ① <span className="font-medium">「对比全样本」列的基准是「全部首板事件」</span>
            ，不是上一级。所以「显著为正」= 比全部首板事件好，**不等于**「比上一级好」。
          </p>
          <p>
            ② <span className="font-medium">主链不是严格包含关系</span>
            ：「T+2 早确认」与「T+5 长窗口」是同一规则的不同观察长度，二者互有交叠但不嵌套；
            对照组（已破位 / 未缩量）与主链**互斥**，画在一起只为并排比较。
          </p>
          <p>
            ③ <span className="font-medium">这不是交易信号</span>
            ：引擎未做多重比较校正，且视界窗口互相重叠（同一标的的 T+3 与 T+5 样本相关），
            纯靠运气也会出现若干「显著」。本视图给的是**线索**，不是结论。
          </p>
          <p>
            ④ 真正成立还需 Parameter Search → Backtest → Evaluation → Robustness → OOS。
          </p>
          <div className="flex items-center gap-1 pt-0.5 text-muted-foreground">
            <MousePointerClick className="h-3 w-3" /> 点任一 <span className="font-mono">#id</span>{" "}
            可切到「逐分析」看该分析的逐指标明细。
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
