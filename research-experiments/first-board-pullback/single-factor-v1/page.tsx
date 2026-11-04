/**
 * SINGLE_FACTOR_EXPERIMENT_V1 · 模板实例页面。
 *
 * ## 页面只做「把结果讲清楚」
 *
 * 平台负责跑（注册表 + Runner + 参数表单 + Dataset 选择器），本页面负责**解释结果**：
 * 3 条结论行 + 一张 8 组合超额速览表，剩下的细节交给通用结果渲染器
 * （它会渲染 `sf_*` 全部表格与图表）。
 *
 * 🔴 只 `import type` 引入结果类型：`./result` 会链到 `node:zlib`，
 *    运行时引它会把服务端代码拖进浏览器 bundle（`manifest.test.ts` 会抓这条）。
 */

import { FlaskConical, Ruler, Target } from "lucide-react";
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
import type { SingleFactorPayload } from "./result";

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(digits);
}

const VERDICT_STYLE: Readonly<Record<string, string>> = {
  POSITIVE: "text-red-500",
  NEGATIVE: "text-emerald-500",
  INCONCLUSIVE: "text-muted-foreground",
  INSUFFICIENT: "text-amber-500",
};

export default function SingleFactorV1Page({
  descriptor,
  outcome,
}: ExperimentPageProps) {
  const result = outcome?.result ?? null;
  if (outcome === null || result === null) {
    return (
      <Card data-experiment-page={descriptor.pageKey}>
        <CardContent className="p-6">
          <EmptyState
            icon={outcome === null ? FlaskConical : Target}
            title={outcome === null ? "尚未运行" : "本次执行没有产出结果"}
            description={
              outcome === null
                ? "选择 Dataset v5、指定一个因子后点击右上角「运行」。"
                : `执行状态：${outcome.error?.code ?? "UNKNOWN"}。`
            }
          />
        </CardContent>
      </Card>
    );
  }

  const custom = (result.customPayload ?? {}) as Partial<SingleFactorPayload>;
  const combos = (custom.combos ?? []) as readonly SingleFactorPayload["combos"][number][];
  const factorCode = custom.factorCode ?? "—";
  const factorLabel = custom.factorLabel ?? "";
  const coordinate = custom.coordinate;
  const sampleFlow = custom.sampleFlow;
  const diagnostics = custom.dayDiagnostics;

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Ruler className="h-4 w-4" /> 单因子横截面取头部：{factorCode}
            {factorLabel === "" ? "" : `（${factorLabel}）`}
          </CardTitle>
          <CardDescription className="text-xs">
            模板 {custom.templateId ?? "—"}；契约 {custom.contractId ?? "—"}；
            因子口径零改动（{custom.factorContractId ?? "—"}，且不使用桶位分排序）。
            Observation T+{coordinate?.observationStart ?? "—"}~T+
            {coordinate?.observationEnd ?? "—"} 只提供信息，唯一入场点是 T+
            {coordinate?.entryRelativeDay ?? "—"} 开盘 → T+
            {coordinate?.exitRelativeDay ?? "—"} 收盘（不可卖顺延），成本往返{" "}
            {coordinate?.roundTripCostBps ?? "—"} bps。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <div>
            候选 {sampleFlow?.candidateCount ?? "—"}；可排名样本{" "}
            {sampleFlow?.rankableSampleCount ?? "—"}（因子不可评估被剔{" "}
            {sampleFlow?.factorValueMissingCount ?? "—"}）；决策日{" "}
            {diagnostics?.daysTotal ?? "—"} 个，当日样本中位{" "}
            {diagnostics?.daySizeP50 ?? "—"} 只。
          </div>
          <div>
            基准 = {custom.benchmark?.definition ?? "—"}。以下 8 个组合**全部**输出，
            不做择优。
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">组合</th>
                  <th className="py-1 pr-3 font-medium">#交易</th>
                  <th className="py-1 pr-3 font-medium">总收益(净)</th>
                  <th className="py-1 pr-3 font-medium">总收益(毛)</th>
                  <th className="py-1 pr-3 font-medium">最大回撤</th>
                  <th className="py-1 pr-3 font-medium">基准</th>
                  <th className="py-1 pr-3 font-medium">超额(复利差)</th>
                  <th className="py-1 pr-3 font-medium">日均超额</th>
                  <th className="py-1 font-medium">判定</th>
                </tr>
              </thead>
              <tbody>
                {combos.map(combo => (
                  <tr key={combo.comboId} className="border-t border-border/40">
                    <td className="py-1 pr-3">{combo.label}</td>
                    <td className="py-1 pr-3">{combo.metrics.tradeCount}</td>
                    <td className="py-1 pr-3">
                      {formatPercent(combo.metrics.totalReturn)}
                    </td>
                    <td className="py-1 pr-3">
                      {formatPercent(combo.metrics.grossTotalReturn)}
                    </td>
                    <td className="py-1 pr-3">
                      {formatPercent(combo.metrics.maxDrawdown)}
                    </td>
                    <td className="py-1 pr-3">
                      {formatPercent(combo.metrics.benchmarkReturn)}
                    </td>
                    <td className="py-1 pr-3">
                      {formatPercent(combo.metrics.excessReturn)}
                    </td>
                    <td className="py-1 pr-3">
                      {formatPercent(combo.meanDailyExcess)}
                    </td>
                    <td
                      className={`py-1 ${
                        VERDICT_STYLE[combo.excessVerdict] ?? ""
                      }`}
                    >
                      {combo.excessVerdict}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            平均持有 {formatNumber(combos[0]?.metrics.averageHoldingDays)} 个交易日；
            胜率 {formatPercent(combos[0]?.metrics.winRate)}；盈亏比{" "}
            {formatNumber(combos[0]?.metrics.profitFactor)}；成本拖累{" "}
            {formatPercent(combos[0]?.metrics.costDrag)}。
          </div>
        </CardContent>
      </Card>
      <GenericExperimentResult
        result={result}
        pageKey={descriptor.pageKey}
        reason="使用单因子模板页面渲染，明细表与图表由通用渲染器铺开。"
        registrationNotice={null}
      />
    </div>
  );
}
