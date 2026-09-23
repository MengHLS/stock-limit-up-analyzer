import { AlertTriangle, FlaskConical, WalletCards } from "lucide-react";
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
import type { LeaderCandidateBaselinePayload } from "./result";

export default function LeaderCandidateBaselinePage({
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
                ? "选择数据集版本 combo-v1 后点击运行。"
                : `执行状态：${outcome.error?.code ?? "UNKNOWN"}。`
            }
          />
        </CardContent>
      </Card>
    );
  }
  const custom = (result.customPayload ??
    {}) as Partial<LeaderCandidateBaselinePayload>;
  const portfolio = custom.portfolio;
  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <WalletCards className="h-4 w-4" /> 原组合回测主模式
          </CardTitle>
          <CardDescription className="text-xs">
            T+1 开盘买入，最多 5 仓等权；从 T+2 起执行动态止盈、止损和强势续持。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
          <p>累计收益 {portfolio ? `${portfolio.totalReturn}%` : "—"}</p>
          <p>最大回撤 {portfolio ? `${portfolio.maxDrawdown}%` : "—"}</p>
          <p>实际成交 {portfolio?.filledCount ?? "—"}</p>
          <p>期末持仓 {portfolio?.openPositionCount ?? "—"}</p>
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
