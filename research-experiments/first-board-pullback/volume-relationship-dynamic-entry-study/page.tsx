import { AlertTriangle, FlaskConical, Volume2 } from "lucide-react";
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
import type { VolumeRelationshipCustomPayload } from "./result";

export default function VolumeRelationshipDynamicEntryStudyPage({
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
                ? "选择 v4 Validation Dataset 后点击右上角「运行」。"
                : `执行状态：${outcome.error?.code ?? "UNKNOWN"}。`
            }
          />
        </CardContent>
      </Card>
    );
  }
  const custom = (result.customPayload ??
    {}) as Partial<VolumeRelationshipCustomPayload>;
  const candidates = custom.candidates;
  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Volume2 className="h-4 w-4" /> 成交量关系与动态入场
          </CardTitle>
          <CardDescription className="text-xs">
            量比均除以 T日成交量；入场和退出使用固定状态机，成交量不参与选日。
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          触发 {candidates?.triggeredCount ?? "—"}；动态交易{" "}
          {candidates?.dynamicTradeCount ?? "—"}；不可买{" "}
          {candidates?.entryUnfillableCount ?? "—"}。
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
