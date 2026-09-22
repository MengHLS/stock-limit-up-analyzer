import { AlertTriangle, FlaskConical, Microscope } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common";
import type { ExperimentPageProps } from "@/researchExperiments/contract";
import { GenericExperimentResult } from "@/pages/researchExperiments/GenericResultView";
import type {
  DecisionForwardCustomPayload,
  ObservationKind,
} from "./result";

const OBSERVATION_META: Record<ObservationKind, { label: string; className: string }> = {
  DESCRIPTIVE: { label: "描述性事实", className: "border-slate-300 text-slate-600" },
  COMPARATIVE: { label: "分组比较", className: "border-blue-300 text-blue-600" },
  POTENTIAL_SIGNAL: { label: "待验证信号", className: "border-amber-300 text-amber-700" },
  LIMITATION: { label: "局限", className: "border-rose-300 text-rose-600" },
};

export default function DecisionForwardStudyPage({ descriptor, outcome }: ExperimentPageProps) {
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
                ? "选择 Dataset 版本后点击右上角「运行」。"
                : `执行状态：${outcome.error?.code ?? "UNKNOWN"}。详见上方「执行状态」区块。`
            }
          />
        </CardContent>
      </Card>
    );
  }

  const custom = (result.customPayload ?? {}) as Partial<DecisionForwardCustomPayload>;
  const observations = custom.observations ?? [];
  const hypotheses = custom.hypotheses ?? [];

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Microscope className="h-4 w-4" /> 决策时点后续收益口径
          </CardTitle>
          <CardDescription className="text-xs">
            收益严格从 T+k 决策日收盘到 T+h 收盘，窗口为 rd ∈ [k+1, h]；
            负值表示下跌，净收益统一扣除 {custom.costBps ?? "—"} bps 往返成本。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <p>
            核心样本 {custom.summary?.coreSampleCount ?? "—"} 个事件；
            {custom.summary?.decisionDayCount ?? "—"} 个决策日 ×{" "}
            {custom.summary?.horizonCount ?? "—"} 个后续视界。
          </p>
          <p>
            中位净收益不破组更高的格子 {custom.summary?.nonBreakMinusBreakPositiveCellCount ?? "—"} 个；
            破位组更高的格子 {custom.summary?.nonBreakMinusBreakNegativeCellCount ?? "—"} 个。
          </p>
          <p className="md:col-span-2">
            以上格子计数只是描述性计数，未控制多重比较，也不能据此判定最优决策日或最优视界。
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
