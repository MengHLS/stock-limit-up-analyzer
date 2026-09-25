import { AlertTriangle, FlaskConical, Layers } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/common";
import type { ExperimentPageProps } from "@/researchExperiments/contract";
import { GenericExperimentResult } from "@/pages/researchExperiments/GenericResultView";
import type { CompositeFactorPayload } from "./result";

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(3)}%`;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(4);
}

/**
 * 组合因子参照实例的页面。
 *
 * 结构：
 * 1. 顶部一张「组合定义卡」——成员数 / 标准化方法 / 权重 / 决策日与坐标；
 * 2. 每个档位一行「组合日均 / 基准日均 / 超额 + 判定」——这是这个实验要回答的问题；
 * 3. 其余全部表（TopN / Excess / Benchmark / TimeSlice / 逐笔预览）交给通用渲染器，
 *    避免在本页维护第二份结果结构。
 */
export default function CompositeFactorEqualWeightStudyPage({
  descriptor,
  outcome,
}: ExperimentPageProps) {
  const result = outcome?.result ?? null;
  if (outcome === null || result === null) {
    return (
      <Card data-experiment-page={descriptor.pageKey}>
        <CardContent className="p-6">
          <EmptyState
            icon={outcome === null ? FlaskConical : AlertTriangle}
            title={outcome === null ? "尚未运行" : "本次执行没有产出结果"}
            description={
              outcome === null
                ? "选择 Dataset v5 后点击右上角「运行」。"
                : `执行状态：${outcome.error?.code ?? "UNKNOWN"}。`
            }
          />
        </CardContent>
      </Card>
    );
  }
  const custom = (result.customPayload ?? {}) as Partial<CompositeFactorPayload>;
  const composition = custom.composition;
  const ranking = custom.ranking;
  const excess = custom.excess ?? [];
  const own = excess.filter(row => row.scope === "OWN");
  const fixed = excess.filter(row => row.scope === "FIXED");

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" /> 组合因子（{composition?.memberCount ?? "—"}{" "}
            个成员，{composition?.equalWeight ? "等权" : "自定义权重"}）
          </CardTitle>
          <CardDescription className="text-xs">
            模板 {custom.templateId ?? "—"}；标准化 {custom.normalization?.label ?? "—"}
            ；桶词表指纹 {custom.normalization?.bucketFingerprint ?? "—"}。方向与边界全部
            来自冻结契约，实验内无任何边界搜索与权重优化。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            入场 T+{custom.coordinate?.entryDay ?? "—"} 开盘 → 退出 T+
            {custom.coordinate?.exitRelativeDay ?? "—"} 收盘；成本往返{" "}
            {custom.coordinate?.roundTripCostBps ?? "—"} bps。
          </div>
          <div>
            候选 {custom.sampleAccounting?.candidateCount ?? "—"}；合成分可评估{" "}
            {custom.sampleAccounting?.eligibleCount ?? "—"}；决策日{" "}
            {custom.dayDiagnostics?.daysTotal ?? "—"}。
          </div>
          <div>
            排序键 = Composite Score（HIGH）；TopN{" "}
            {(ranking?.topNSizes ?? []).join(" / ")}；日集{" "}
            {(ranking?.dayScopes ?? []).join(" / ")}。
          </div>
          <div>
            合成分中位 {formatNumber(custom.compositeScore?.p50)}（范围 [
            {formatNumber(custom.compositeScore?.min)},{" "}
            {formatNumber(custom.compositeScore?.max)}]）。
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">各档超额（主判据）</CardTitle>
          <CardDescription className="text-xs">
            超额 = 当日 TopN 等权净收益 − 当日全部候选等权净收益（配对）。随机抽 N 只的期望
            恒等于当日池 ⇒ 正超额 = 平均意义上优于随机抽签。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {[...own, ...fixed].map(row => (
            <div
              key={`${row.comboId}-${row.scope}`}
              className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2"
            >
              <span className="font-medium">
                {row.sizeLabel} · {row.scope}
              </span>
              <span className="text-muted-foreground">
                日数 {row.daysIncluded}
              </span>
              <span>超额 {formatPercent(row.excessMean)}</span>
              <span className="text-muted-foreground">
                CI95 [{formatPercent(row.excessCi95Low)},{" "}
                {formatPercent(row.excessCi95High)}]
              </span>
              <span className="font-mono">{row.verdict}</span>
            </div>
          ))}
          {excess.length === 0 ? <div>本次 Run 没有超额行。</div> : null}
        </CardContent>
      </Card>

      <GenericExperimentResult
        result={result}
        pageKey={descriptor.pageKey}
        reason="使用实验专用页面渲染（顶部为组合定义与主判据摘要）。"
        registrationNotice={null}
      />
    </div>
  );
}
