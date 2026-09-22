import { AlertTriangle, FlaskConical, ScanSearch } from "lucide-react";
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
import type { HoldStreakAmplitudeT10Payload } from "./result";

export default function HoldStreakAmplitudeT10StudyPage({
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
    {}) as Partial<HoldStreakAmplitudeT10Payload>;
  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanSearch className="h-4 w-4" /> 守线 × 振幅
          </CardTitle>
          <CardDescription className="text-xs">
            T+6 开盘入场、T+10 收盘退出；交叉收盘/盘中守线 streak
            与平均/最大振幅。
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          有效样本 {custom.candidates?.sampleCount ?? "—"}；T+6 不可买{" "}
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
