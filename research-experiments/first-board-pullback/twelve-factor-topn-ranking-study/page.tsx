import { CalendarRange, FlaskConical, Target } from "lucide-react";
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
import type { TopNRankingPayload, TopNRow } from "./result";

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(3)}pp`;
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

export default function TwelveFactorTopNRankingStudyPage({
  descriptor,
  outcome,
}: ExperimentPageProps) {
  const result = outcome?.result ?? null;
  if (outcome === null || result === null) {
    return (
      <Card data-experiment-page={descriptor.pageKey}>
        <CardContent className="p-6">
          <EmptyState
            icon={outcome === null ? FlaskConical : Target}
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

  const custom = (result.customPayload ?? {}) as Partial<TopNRankingPayload>;
  const rows = (custom.headline ?? []) as readonly TopNRow[];
  const pick = (size: string, scope: "OWN" | "DEEP"): TopNRow | undefined =>
    rows.find(row => row.size === size && row.scope === scope);
  const top5Deep = pick("N5", "DEEP");
  const top1Own = pick("N1", "OWN");
  const diagnostics = custom.dayDiagnostics;

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4" /> 每日取头部 N 名：综合评分有没有用
          </CardTitle>
          <CardDescription className="text-xs">
            契约 {custom.rankingContractId ?? "—"}；评分来自{" "}
            {custom.bucketContractId ?? "—"}（因子 / 桶 / 方向 / 权重零改动）。
            主判据 = 日度超额（Top-N 均值 − 当日全部候选均值），配对后做日期聚类
            Bootstrap。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            入场 T+{custom.coordinate?.entryDay ?? "—"} 开盘 → 退出 T+
            {custom.coordinate?.exitRelativeDay ?? "—"} 收盘；成本往返{" "}
            {custom.coordinate?.roundTripCostBps ?? "—"} bps。
          </div>
          <div className="flex items-center gap-1">
            <CalendarRange className="h-3.5 w-3.5" />
            决策日 {formatCount(diagnostics?.daysTotal)} 个；当日可用样本中位{" "}
            {formatCount(diagnostics?.daySizeP50)} 只。
          </div>
          <div>
            综合评分 Top-5（固定日集）：超额 ={" "}
            {formatPercent(top5Deep?.excessMean)}，CI95 [
            {formatPercent(top5Deep?.excessCi95Low)},{" "}
            {formatPercent(top5Deep?.excessCi95High)}] ⇒{" "}
            <span className="font-medium">
              {top5Deep?.excessVerdict ?? "—"}
            </span>
          </div>
          <div>
            同档组合日均收益 = {formatPercent(top5Deep?.portfolioMean)}（当日池
            同日 {formatPercent(top5Deep?.poolMean)}）；日胜率{" "}
            {formatPercent(top5Deep?.dayWinRate)}。
          </div>
          <div>
            综合评分 Top-1（本职日集）：超额 ={" "}
            {formatPercent(top1Own?.excessMean)}，判定{" "}
            {top1Own?.excessVerdict ?? "—"}。
          </div>
          <div>
            候选 {custom.referenceCheck?.actualCandidateCount ?? "—"}；入池{" "}
            {custom.referenceCheck?.actualEligibleCount ?? "—"}（与 12F 实验一致：
            {custom.referenceCheck?.matchesEligibleCount ? "是" : "否"}）。
          </div>
        </CardContent>
      </Card>
      <GenericExperimentResult
        result={result}
        pageKey={descriptor.pageKey}
        reason="使用实验专用页面渲染。"
        registrationNotice={null}
      />
    </div>
  );
}
