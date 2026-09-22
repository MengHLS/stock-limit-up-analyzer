import { AlertTriangle, FlaskConical, Workflow } from "lucide-react";
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
import type { ConditionalPullbackStateExitCustomPayload } from "./result";

export default function ConditionalPullbackStateExitStudyPage({
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
    {}) as Partial<ConditionalPullbackStateExitCustomPayload>;
  const candidates = custom.candidates;
  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="h-4 w-4" /> 条件入场与动态退出
          </CardTitle>
          <CardDescription className="text-xs">
            T+1..T+5
            回撤触发后次日开盘买入；买入后收盘跌破首板开盘价则下一可卖开盘退出，
            否则 T+10 收盘退出。
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          触发 {candidates?.triggeredCount ?? "—"}；动态交易{" "}
          {candidates?.dynamicTradeCount ?? "—"}；下一开盘止损{" "}
          {candidates?.stopNextOpenCount ?? "—"}；时间退出{" "}
          {candidates?.fixedTradeCount ?? "—"}。
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
