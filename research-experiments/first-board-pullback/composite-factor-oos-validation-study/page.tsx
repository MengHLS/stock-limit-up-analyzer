/**
 * 组合因子 OOS 验证组 —— **共用页面**。
 *
 * 三个方案的结果结构完全同构（同一个模板、只差成员），因此**共用一份页面**：
 * 页面从 `descriptor` 取标题、从 `customPayload` 取成员 / 实际生效权重 / 协议坐标
 * ⇒ 不需要为每个方案复制一份画法，也不会出现「三个页面各写一遍、只有一处忘了改」的漂移。
 *
 * 🔴 本文件只 import `./result`（纯类型与常量层）；**不得** import `../shared/compositeFactor`
 *    或 `./presets` —— 它们会把 `node:zlib`（产物写入）拖进浏览器 bundle。
 *
 * ⚠️ 本页**不显示** `confirmatoryGate`：Gate 在信封顶层（`result.confirmatoryGate`），
 *    由通用渲染器呈现；这里只显示它会用到的协议坐标，避免两处各画一遍。
 */

import { AlertTriangle, FlaskConical, Layers, ShieldCheck } from "lucide-react";
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
import type { CompositeFactorPayload } from "./result";

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(3)}%`;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(4);
}

export default function CompositeFactorOosValidationStudyPage({
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
                ? "选择 Dataset v5 后点击右上角「运行」。OBSERVATION / HOLDOUT 需在运行前提交研究协议。"
                : `执行状态：${outcome.error?.code ?? "UNKNOWN"}。`
            }
          />
        </CardContent>
      </Card>
    );
  }

  const custom = (result.customPayload ?? {}) as Partial<CompositeFactorPayload>;
  const composition = custom.composition;
  const ranking = custom.ranking;
  const excess = custom.excess ?? [];
  const own = excess.filter(row => row.scope === "OWN");
  const fixed = excess.filter(row => row.scope === "FIXED");
  const protocol = custom.protocol ?? null;
  const window = protocol?.evaluationWindow ?? null;

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" /> 组合因子（
            {composition?.memberCount ?? "—"} 个成员，
            {composition?.equalWeight ? "等权" : "自定义权重"}）
          </CardTitle>
          <CardDescription className="text-xs">
            {descriptor.name}；模板 {custom.templateId ?? "—"}；标准化{" "}
            {custom.normalization?.label ?? "—"}；桶词表指纹{" "}
            {custom.normalization?.bucketFingerprint ?? "—"}。本组只把「读取窗口」交给平台协议，
            members / weighting / 坐标 / TopN / 日集与既有实例逐字相同。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="sm:col-span-2">
            成员与实际生效权重：
            {(composition?.members ?? [])
              .map(
                member =>
                  `${member.label}（${member.code}，${member.direction}，权重 ${member.weight.toFixed(4)}）`
              )
              .join(" · ") || "—"}
          </div>
          <div className="sm:col-span-2">
            权重口径：{custom.composition?.weightingDisclosure ?? "—"}
          </div>
          <div>
            入场 T+{custom.coordinate?.entryDay ?? "—"} 开盘 → 退出 T+
            {custom.coordinate?.exitRelativeDay ?? "—"} 收盘；成本往返{" "}
            {custom.coordinate?.roundTripCostBps ?? "—"} bps。
          </div>
          <div>
            候选 {custom.sampleAccounting?.candidateCount ?? "—"}；合成分可评估{" "}
            {custom.sampleAccounting?.eligibleCount ?? "—"}；决策日{" "}
            {custom.dayDiagnostics?.daysTotal ?? "—"}。
          </div>
          <div>
            排序键 = Composite Score（HIGH）；TopN{" "}
            {(ranking?.topNSizes ?? []).join(" / ")}；日集{" "}
            {(ranking?.dayScopes ?? []).join(" / ")}。
          </div>
          <div>
            合成分中位 {formatNumber(custom.compositeScore?.p50)}（范围 [
            {formatNumber(custom.compositeScore?.min)},{" "}
            {formatNumber(custom.compositeScore?.max)}]）。
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            研究协议与评估窗口
          </CardTitle>
          <CardDescription className="text-xs">
            窗口由「平台在取数层」施加（`datasetPort` 的 `fromDate` / `toDate`），
            实验内不做二次过滤 ⇒ 带窗口 Run 的同名统计不得与全窗口 Run 逐格对拍。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            阶段：<span className="font-mono">{protocol?.phase ?? "EXPLORATORY"}</span>
          </div>
          <div>
            评估窗口：
            {window === null || window === undefined
              ? "（无 —— 读全窗）"
              : `${window.startDate} → ${window.endDate}`}
          </div>
          <div>协议：{protocol?.protocolId ?? "—"}</div>
          <div className="sm:col-span-2 break-all">
            协议指纹：<span className="font-mono">{protocol?.protocolFingerprint ?? "—"}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">各档超额（主判据）</CardTitle>
          <CardDescription className="text-xs">
            超额 = 当日 TopN 等权净收益 − 当日全部候选等权净收益（配对）。随机抽 N 只的期望
            恒等于当日池 ⇒ 正超额 = 平均意义上优于随机抽签。跨 N 比较必须读 FIXED。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {[...own, ...fixed].map(row => (
            <div
              key={`${row.comboId}-${row.scope}`}
              className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2"
            >
              <span className="font-medium">
                {row.sizeLabel} · {row.scope}
              </span>
              <span className="text-muted-foreground">日数 {row.daysIncluded}</span>
              <span>超额 {formatPercent(row.excessMean)}</span>
              <span className="text-muted-foreground">
                CI95 [{formatPercent(row.excessCi95Low)},{" "}
                {formatPercent(row.excessCi95High)}]
              </span>
              <span className="font-mono">{row.verdict}</span>
            </div>
          ))}
          {excess.length === 0 ? <div>本次 Run 没有超额行。</div> : null}
        </CardContent>
      </Card>

      <GenericExperimentResult
        result={result}
        pageKey={descriptor.pageKey}
        reason="使用实验专用页面渲染（顶部为成员与生效权重、研究协议与窗口、主判据摘要；确认性 Gate 由通用渲染器呈现）。"
        registrationNotice={null}
      />
    </div>
  );
}
