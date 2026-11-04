import { AlertTriangle, BarChart3, FlaskConical } from "lucide-react";
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
import type { FirstBoardBodyCustomPayload } from "./result";

export default function FirstBoardBodyStudyPage({
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
    {}) as Partial<FirstBoardBodyCustomPayload>;
  const candidates = custom.candidates;
  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" /> 首板实体柱高度
          </CardTitle>
          <CardDescription className="text-xs">
            实体高度 = (首板收盘 - 首板开盘) / 首板前收；T+1 开盘入场。
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          严格收盘涨停 {candidates?.exactLimitUpCloseCount ?? "—"}；一字板{" "}
          {candidates?.oneWordLimitUpCount ?? "—"}；T+1 不可买{" "}
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
