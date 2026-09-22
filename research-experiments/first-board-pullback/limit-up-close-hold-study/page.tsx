import { Activity, AlertTriangle, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import type { LimitUpCloseHoldCustomPayload, ObservationKind } from "./result";

const OBSERVATION_META: Record<
  ObservationKind,
  { label: string; className: string }
> = {
  DESCRIPTIVE: {
    label: "描述性事实",
    className: "border-slate-300 text-slate-600",
  },
  COMPARATIVE: {
    label: "分组比较",
    className: "border-blue-300 text-blue-600",
  },
  POTENTIAL_SIGNAL: {
    label: "待验证信号",
    className: "border-amber-300 text-amber-700",
  },
  LIMITATION: { label: "局限", className: "border-rose-300 text-rose-600" },
};

export default function LimitUpCloseHoldStudyPage({
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
                ? "选择 v3-confirmatory Dataset 后点击右上角「运行」。"
                : `执行状态：${outcome.error?.code ?? "UNKNOWN"}。详见上方「执行状态」区块。`
            }
          />
        </CardContent>
      </Card>
    );
  }

  const custom = (result.customPayload ??
    {}) as Partial<LimitUpCloseHoldCustomPayload>;
  const observations = custom.observations ?? [];
  const hypotheses = custom.hypotheses ?? [];
  const counts = custom.contextCounts;
  const parameters = custom.parameters;

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> 首板后收盘守涨停价
          </CardTitle>
          <CardDescription className="text-xs">
            以 T+1..T+5 每日收盘价相对 T 日涨停价的最差位置分组；T+5
            收盘决策后， 从 T+6 开盘入场。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <p>
            未跌破 {counts?.atOrAboveCount ?? "—"}；略微跌破{" "}
            {counts?.slightBreachCount ?? "—"}；深度跌破{" "}
            {counts?.deepBreachCount ?? "—"}； T+6 不可买{" "}
            {counts?.entryUnfillableCount ?? "—"}。
          </p>
          <p>
            略微跌破阈值 {parameters?.slightBreachBps ?? "—"} bps；后续视界 T+
            {parameters?.forwardHorizons?.join(" / T+") ?? "—"}。
          </p>
          <p className="md:col-span-2">
            日期聚类 Moving Block Bootstrap{" "}
            {parameters?.bootstrapIterations ?? "—"} 次， block=
            {parameters?.bootstrapBlockDays ?? "—"} 日。分组阈值预先固定，
            不代表最优参数，也不能替代独立 Holdout。
          </p>
        </CardContent>
      </Card>

      <GenericExperimentResult
        result={result}
        pageKey={descriptor.pageKey}
        reason="使用实验专用页面渲染。"
        registrationNotice={null}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">研究观察</CardTitle>
          <CardDescription className="text-xs">
            下列内容均为本次运行的事实描述，不是策略结论。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {observations.map((item, index) => (
            <div key={`${item.kind}-${index}`} className="flex gap-2">
              <Badge
                variant="outline"
                className={`mt-0.5 h-fit shrink-0 text-[10px] ${OBSERVATION_META[item.kind].className}`}
              >
                {OBSERVATION_META[item.kind].label}
              </Badge>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {item.text}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {hypotheses.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">待验证假设</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {hypotheses.map(hypothesis => (
              <div key={hypothesis.code} className="rounded-md border p-3">
                <p className="text-xs font-medium">
                  <span className="font-mono">{hypothesis.code}</span>：
                  {hypothesis.statement}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {hypothesis.rationale}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
