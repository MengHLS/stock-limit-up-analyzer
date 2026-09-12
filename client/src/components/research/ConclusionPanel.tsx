/**
 * ConclusionPanel — 研究结论展示（规则式结论的完整可复核视图）。
 *
 * 展示纪律（对应后端 `conclusion.ts` 的立场）：
 *   - **免责声明必须显著**：自动结论只是研究辅助，不等同于统计显著性或交易有效性；
 *   - **阈值口径必须可见**：alpha / 最小实际效应 / 样本门槛原样展示，用户才能复核判定；
 *   - **判定轨迹必须完整**：R1~R5 逐步显示「通过 / 未通过 + 明细」，而不是只给一个结论词；
 *   - **confidence 必须标注「不是 p-value」**：它由「统计达标 + 方向一致性 + 样本充裕 + 各分析同向」
 *     加权得出，是主观打分；
 *   - **分析级 notes 必须转述**：分组退化（如「实际只有 1 组，无法评估跨期稳定性」）就在这里，
 *     结论页是用户唯一能看到它们的地方。
 */

import { Fragment } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, Info, ShieldAlert, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, StatusBadge } from "@/components/common";
import {
  conclusionToVm,
  formatCount,
  formatMetricValue,
  rpcErrorToDiagnostic,
  type ConclusionVm,
} from "@/adapters/researchEngineAdapter";

/** 极简 markdown：仅处理引擎文本里出现的 `**加粗**`，其余原样。不做富文本渲染。 */
function EngineText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p.length > 0);
  return (
    <div className={className} style={{ whiteSpace: "pre-wrap" }}>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i} className="font-medium">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </div>
  );
}

function ConclusionCard({ vm }: { vm: ConclusionVm }) {
  const { evidence } = vm;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-sm">{vm.title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge status={vm.conclusionType} />
            <StatusBadge status={vm.status} />
            {vm.confidence !== null && (
              <span className="flex items-center gap-1">
                主观置信度{" "}
                <span className="font-mono tabular-nums">{vm.confidence.toFixed(4)}</span>
                {evidence.confidenceIsNotPValue && (
                  <Badge variant="outline" className="text-[10px]">
                    非 p-value
                  </Badge>
                )}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {evidence.disclaimer && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <EngineText text={evidence.disclaimer} />
          </div>
        )}

        <EngineText text={vm.conclusion} className="text-sm leading-relaxed" />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <p className="mb-2 text-xs font-medium">判定阈值（可复核）</p>
            <dl className="space-y-1 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">显著性水平 α</dt>
                <dd className="font-mono">{evidence.policy.alpha ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">最小实际效应</dt>
                <dd className="font-mono">{evidence.policy.materialityDisplay}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">单组最小样本</dt>
                <dd className="font-mono">{evidence.policy.minSampleCount ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">方向一致性下限</dt>
                <dd className="font-mono">{evidence.policy.stabilityMinConsistentRatio ?? "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-md border p-3">
            <p className="mb-2 text-xs font-medium">主分析</p>
            {evidence.primaryAnalysis ? (
              <dl className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">分析</dt>
                  <dd>
                    #{evidence.primaryAnalysis.analysisId} {evidence.primaryAnalysis.analysisTypeLabel}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{evidence.primaryAnalysis.effectLabel}</dt>
                  <dd className="font-mono tabular-nums">{evidence.primaryAnalysis.effectDisplay}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">p 值</dt>
                  <dd className="font-mono tabular-nums">{evidence.primaryAnalysis.pValueDisplay}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">t 统计量</dt>
                  <dd className="font-mono tabular-nums">
                    {evidence.primaryAnalysis.tStat === null
                      ? "—"
                      : evidence.primaryAnalysis.tStat.toFixed(3)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">样本 / 分组</dt>
                  <dd className="font-mono tabular-nums">
                    {formatCount(evidence.primaryAnalysis.sampleCount)} /{" "}
                    {evidence.primaryAnalysis.groupCount ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">最小分组样本</dt>
                  <dd className="font-mono tabular-nums">
                    {formatCount(evidence.primaryAnalysis.minGroupSampleCount)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">方向一致性</dt>
                  <dd className="font-mono tabular-nums">
                    {evidence.primaryAnalysis.directionConsistency === null
                      ? "—"
                      : evidence.primaryAnalysis.directionConsistency.toFixed(3)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-xs text-muted-foreground">
                本次没有任何分析产出可比较的主效应（样本缺失或分组退化）。
              </p>
            )}
            {evidence.primarySelectionRule && (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {evidence.primarySelectionRule}
              </p>
            )}
          </div>
        </div>

        {evidence.ruleTrace.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium">判定轨迹（按顺序短路）</p>
            <ol className="space-y-1.5">
              {evidence.ruleTrace.map((r) => (
                <li key={r.rule} className="flex items-start gap-2 text-xs">
                  {r.passed ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                  )}
                  <span>
                    <span className="font-mono">{r.rule}</span>
                    <span className="ml-1 text-muted-foreground">{r.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {evidence.contributingAnalyses.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium">参与分析</p>
            <div className="space-y-2">
              {evidence.contributingAnalyses.map((a) => (
                <div key={a.analysisId} className="rounded-md border px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>
                      #{a.analysisId} {a.analysisTypeLabel}
                    </span>
                    <span className="text-muted-foreground">{a.effectLabel}</span>
                    <span className="font-mono tabular-nums">{a.effectDisplay}</span>
                    <span className="text-muted-foreground">p={a.pValueDisplay}</span>
                    <span className="text-muted-foreground">n={formatCount(a.sampleCount)}</span>
                  </div>
                  {a.notes.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 border-t pt-1.5 text-muted-foreground">
                      {a.notes.map((n, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                          <span>{n}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {evidence.confidenceBasis && (
          <p className="text-[11px] text-muted-foreground">
            置信度构成：{evidence.confidenceBasis}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ConclusionPanel({ experimentId }: { experimentId: number }) {
  const conclusions = trpc.researchEngine.listConclusions.useQuery({ experimentId });
  const policy = trpc.researchEngine.getConclusionPolicy.useQuery();

  if (conclusions.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 p-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (conclusions.error) {
    return (
      <ErrorState
        error={rpcErrorToDiagnostic(conclusions.error.message, { title: "结论加载失败" })}
      />
    );
  }

  const list = (conclusions.data ?? []).map(conclusionToVm);

  if (list.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="尚无结论"
        description="结论由引擎在 Run 完成后自动生成。请先创建 Run、添加分析并点击「运行引擎」。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          共 {list.length} 条结论（按创建时间倒序由后端给出）。
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            // 客户端直出的接口响应快照 —— 不是服务端生成的研究报告，不做任何再加工。
            const payload = {
              exportedAt: new Date().toISOString(),
              experimentId,
              exportKind: "CLIENT_SIDE_API_SNAPSHOT",
              note: "本文件是 researchEngine.listConclusions / getConclusionPolicy 的接口响应快照，字段逐字一致；引擎尚未提供服务端报告导出。",
              conclusionPolicy: policy.data ?? null,
              conclusions: conclusions.data ?? [],
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `research-conclusions-experiment-${experimentId}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" /> 导出结论 JSON
        </Button>
      </div>
      {policy.data && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            当前引擎默认阈值：α=
            <span className="font-mono">{policy.data.alpha}</span>，最小实际效应=
            <span className="font-mono">
              {formatMetricValue("DIFFERENCE", policy.data.materialityAbs)}
            </span>
            ，单组最小样本=
            <span className="font-mono">{policy.data.minSampleCount}</span>，方向一致性下限=
            <span className="font-mono">{policy.data.stabilityMinConsistentRatio}</span>。
            阈值可在运行时覆盖，实际生效值以每份结论 evidence 中的 policy 为准。
          </span>
        </p>
      )}
      {list.map((vm) => (
        <ConclusionCard key={vm.id} vm={vm} />
      ))}
    </div>
  );
}
