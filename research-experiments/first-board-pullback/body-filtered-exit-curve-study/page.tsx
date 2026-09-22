import { AlertTriangle, CandlestickChart, FlaskConical } from "lucide-react";
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
import type { BodyFilteredExitCurvePayload } from "./result";

export default function BodyFilteredExitCurveStudyPage({
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
    {}) as Partial<BodyFilteredExitCurvePayload>;
  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CandlestickChart className="h-4 w-4" /> 实体过滤与持有曲线
          </CardTitle>
          <CardDescription className="text-xs">
            一字板默认排除，实体高度下限默认 0.1%；从实际入场日展开持有曲线。
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          过滤后样本 {custom.candidates?.sampleCount ?? "—"}；排除一字板{" "}
          {custom.candidates?.excludedOneWordLimitUpCount ?? "—"}；实体不足{" "}
          {custom.candidates?.belowMinBodyHeightCount ?? "—"}。
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
