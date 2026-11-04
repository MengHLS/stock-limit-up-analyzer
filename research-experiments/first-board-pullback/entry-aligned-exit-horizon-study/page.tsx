import { AlertTriangle, FlaskConical, Route } from "lucide-react";
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
import type { EntryAlignedExitHorizonPayload } from "./result";

export default function EntryAlignedExitHorizonStudyPage({
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
    {}) as Partial<EntryAlignedExitHorizonPayload>;
  const candidates = custom.candidates;
  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Route className="h-4 w-4" /> 入场对齐的退出曲线
          </CardTitle>
          <CardDescription className="text-xs">
            T 日严格涨停且非一字板；T+1..T+5 有涨跌停触达即剔除；T+6
            开盘入场，按实际持有日共同样本展开。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
          <p>共同样本 {candidates?.sampleCount ?? "—"}</p>
          <p>
            一字板排除{" "}
            {candidates?.exactLimitUpCloseCount !== undefined &&
            candidates?.nonOneWordCount !== undefined
              ? candidates.exactLimitUpCloseCount -
                candidates.nonOneWordCount
              : "—"}
          </p>
          <p>T+6 不可买 {candidates?.entryUnfillableCount ?? "—"}</p>
          <p className="md:col-span-3">
            曲线不选择最佳退出日；T+10 与 T+20 仅作为持有第 5 日和第 15
            日参考点。
          </p>
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
