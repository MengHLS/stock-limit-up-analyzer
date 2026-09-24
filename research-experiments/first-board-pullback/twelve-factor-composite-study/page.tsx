import { AlertTriangle, FlaskConical, Scale } from "lucide-react";
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
import type { TwelveFactorCompositePayload } from "./result";

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(2)}pp`;
}

function formatNumber(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(digits);
}

export default function TwelveFactorCompositeStudyPage({
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
  const custom = (result.customPayload ?? {}) as Partial<TwelveFactorCompositePayload>;
  const composite = custom.composite;
  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="h-4 w-4" /> 十二因子等权综合评分
          </CardTitle>
          <CardDescription className="text-xs">
            契约 {custom.bucketContractId ?? "—"}；12 因子各占{" "}
            1/12，第一版不做权重优化。桶边界与方向全部冻结，实验内无任何边界搜索。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            入场 T+{custom.coordinate?.entryDay ?? "—"} 开盘 → 退出 T+
            {custom.coordinate?.exitRelativeDay ?? "—"} 收盘；成本往返{" "}
            {custom.coordinate?.roundTripCostBps ?? "—"} bps。
          </div>
          <div>
            候选 {custom.candidates?.candidateCount ?? "—"}；严格涨停{" "}
            {custom.candidates?.exactLimitUpCloseCount ?? "—"}；完备用例{" "}
            {custom.candidates?.eligibleCount ?? "—"}。
          </div>
          <div>
            D10 − D1 = {formatPercent(composite?.decileSpread)}，聚类 CI95 [
            {formatPercent(composite?.decileSpreadCi95Low)},{" "}
            {formatPercent(composite?.decileSpreadCi95High)}] ⇒{" "}
            {composite?.decileSpreadVerdict ?? "—"}
          </div>
          <div>
            Spearman ρ（十分位）= {formatNumber(composite?.decileSpearman, 3)}；
            五分位 = {formatNumber(composite?.quintileSpearman, 3)}；
            {composite?.verifiedOnlyFactorCount ?? 9} 因子子评分 spread ={" "}
            {formatPercent(composite?.verifiedOnlySpread)}
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
