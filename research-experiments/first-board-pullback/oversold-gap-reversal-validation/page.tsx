import { AlertTriangle, FlaskConical, ShieldCheck } from "lucide-react";
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
import type { OversoldGapReversalCustomPayload } from "./result";

const STATUS_LABEL = {
  PASS: "通过",
  FAIL: "失败",
  INSUFFICIENT: "样本不足",
  OBSERVATION_READY: "可进入 Holdout",
} as const;

export default function OversoldGapReversalValidationPage({
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
                ? "选择 v4-validation Dataset 后，按协议运行 Observation。"
                : `执行状态：${outcome.error?.code ?? "UNKNOWN"}。详见上方「执行状态」区块。`
            }
          />
        </CardContent>
      </Card>
    );
  }

  const custom = (result.customPayload ??
    {}) as Partial<OversoldGapReversalCustomPayload>;
  const gate = result.confirmatoryGate;
  const availability = custom.availability;

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> 冻结假设验证
          </CardTitle>
          <CardDescription className="text-xs">
            距前次涨停 &gt;20 个交易日，且 close(T-1)/close(T-11)-1 &lt; -10%；
            T+1 开盘入场，T+10 收盘主退出。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <p>
            Gate：{gate ? STATUS_LABEL[gate.status] : "非确认性 Run"}；
            有效信号样本 {availability?.signalPrimarySampleCount ?? "—"}；
            可比超额样本 {availability?.excessSampleCount ?? "—"}。
          </p>
          <p>
            同日基准 sample {availability?.baselinePrimarySampleCount ?? "—"}；
            信号事件交易日 {availability?.signalPrimaryEventDateCount ?? "—"}。
          </p>
          <p className="md:col-span-2">
            条件、成本、视界和通过阈值均冻结。Observation
            不通过只能补数据；Holdout 每个协议指纹只能运行一次。
          </p>
        </CardContent>
      </Card>

      <GenericExperimentResult
        result={result}
        pageKey={descriptor.pageKey}
        reason="使用实验专用页面渲染。"
        registrationNotice={null}
      />

      {gate && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">确认性 Gate</CardTitle>
            <CardDescription className="text-xs">
              {gate.summary}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {gate.checks.map(check => (
              <div
                key={check.code}
                className="flex items-start gap-2 rounded-md border p-3"
              >
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[10px] ${
                    check.status === "PASS"
                      ? "border-emerald-300 text-emerald-700"
                      : check.status === "FAIL"
                        ? "border-rose-300 text-rose-600"
                        : "border-amber-300 text-amber-700"
                  }`}
                >
                  {STATUS_LABEL[check.status]}
                </Badge>
                <div>
                  <p className="text-xs font-medium">{check.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {check.note}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
