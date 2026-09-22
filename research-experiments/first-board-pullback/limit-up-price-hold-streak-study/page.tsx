import { AlertTriangle, FlaskConical, ShieldCheck } from "lucide-react";
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
import type { LimitUpPriceHoldStreakPayload } from "./result";

export default function LimitUpPriceHoldStreakStudyPage({
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
                ? "选择 Dataset 后点击右上角「运行」。"
                : `执行状态：${outcome.error?.code ?? "UNKNOWN"}。`
            }
          />
        </CardContent>
      </Card>
    );
  }
  const custom = (result.customPayload ??
    {}) as Partial<LimitUpPriceHoldStreakPayload>;
  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> 首板涨停价连续守线
          </CardTitle>
          <CardDescription className="text-xs">
            T+1..T+5 从收盘价和盘中最低价两个口径连续未跌破首板涨停价；T+6
            开盘入场。
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          严格涨停 {custom.candidates?.exactLimitUpCloseCount ?? "—"}；路径完整{" "}
          {custom.candidates?.contextCompleteCount ?? "—"}；T+6不可买{" "}
          {custom.candidates?.entryUnfillableCount ?? "—"}。
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
