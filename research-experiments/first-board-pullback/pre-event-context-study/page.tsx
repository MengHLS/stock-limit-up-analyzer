import { AlertTriangle, FlaskConical, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common";
import type { ExperimentPageProps } from "@/researchExperiments/contract";
import { GenericExperimentResult } from "@/pages/researchExperiments/GenericResultView";
import type {
  ObservationKind,
  PreEventContextCustomPayload,
} from "./result";

const OBSERVATION_META: Record<ObservationKind, { label: string; className: string }> = {
  DESCRIPTIVE: { label: "描述性事实", className: "border-slate-300 text-slate-600" },
  COMPARATIVE: { label: "分组比较", className: "border-blue-300 text-blue-600" },
  POTENTIAL_SIGNAL: { label: "待验证信号", className: "border-amber-300 text-amber-700" },
  LIMITATION: { label: "局限", className: "border-rose-300 text-rose-600" },
};

export default function PreEventContextStudyPage({ descriptor, outcome }: ExperimentPageProps) {
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

  const custom = (result.customPayload ?? {}) as Partial<PreEventContextCustomPayload>;
  const observations = custom.observations ?? [];
  const hypotheses = custom.hypotheses ?? [];

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> 首板前上下文
          </CardTitle>
          <CardDescription className="text-xs">
            距上次涨停间隔取 PIT `daysSincePreviousLimit`；前期涨幅 =
            `close(T-1) / close(T-n) - 1`，不包含 T 日涨停本身。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <p>
            eligible {custom.candidates?.eligibleCount ?? "—"}；
            间隔已知 {custom.contextCounts?.gapKnownCount ?? "—"}；
            未知 {custom.contextCounts?.gapUnknownCount ?? "—"}。
          </p>
          <p>
            前期窗口 {custom.parameters?.preReturnWindows?.join(" / ") ?? "—"}；
            后续视界 T+{custom.parameters?.forwardHorizons?.join(" / T+") ?? "—"}。
          </p>
          <p className="md:col-span-2">
            联合分组主窗口：T-{custom.parameters?.primaryInteractionWindow ?? "—"} 至 T-1。
            表格中的格子用于描述，不用于选择最佳间隔或最佳涨幅阈值。
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
              <p className="text-xs leading-relaxed text-muted-foreground">{item.text}</p>
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
            {hypotheses.map((hypothesis) => (
              <div key={hypothesis.code} className="rounded-md border p-3">
                <p className="text-xs font-medium">
                  <span className="font-mono">{hypothesis.code}</span>：{hypothesis.statement}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{hypothesis.rationale}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
