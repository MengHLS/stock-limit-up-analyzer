import { AlertTriangle, FlaskConical, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/common";
import type { ExperimentPageProps } from "@/researchExperiments/contract";
import { GenericExperimentResult } from "@/pages/researchExperiments/GenericResultView";
import type { TurnoverCustomPayload } from "./result";

export default function TurnoverStudyPage({ descriptor, outcome }: ExperimentPageProps) {
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

  const custom = (result.customPayload ?? {}) as Partial<TurnoverCustomPayload>;
  const availability = custom.availability;
  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4" /> 换手率与未来收益
          </CardTitle>
          <CardDescription className="text-xs">
            换手率与流通市值取自首板日；收益从 T+1 开盘到 T+5 / T+10 / T+20 收盘。
            Bootstrap 按交易日聚类，并以连续日期块重采样。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <p>换手率非空：{availability?.turnoverAvailableCount ?? "—"}</p>
          <p>流通市值非空：{availability?.floatMarketCapAvailableCount ?? "—"}</p>
          <p>
            Bootstrap：{custom.parameters?.bootstrapIterations ?? "—"} 次，
            block={custom.parameters?.bootstrapBlockDays ?? "—"} 个交易日。
          </p>
        </CardContent>
      </Card>

      {availability?.floatMarketCapStatus === "INSUFFICIENT_DATA" && (
        <Alert variant="destructive" data-turnover-float-market-cap="insufficient">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>流通市值研究暂不可执行</AlertTitle>
          <AlertDescription>
            当前 Dataset 的 floatMarketCap 全部为空，无法生成有效市值分桶。
            换手率结果仍可独立解读；市值关系必须等底层 circ_mv 补齐后重建 Dataset。
          </AlertDescription>
        </Alert>
      )}

      <GenericExperimentResult
        result={result}
        pageKey={descriptor.pageKey}
        reason="使用实验专用页面渲染。"
        registrationNotice={null}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">研究观察</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(custom.observations ?? []).map((item, index) => (
            <p key={`${item.kind}-${index}`} className="text-xs leading-relaxed text-muted-foreground">
              <span className="mr-2 font-mono text-[10px]">{item.kind}</span>
              {item.text}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
