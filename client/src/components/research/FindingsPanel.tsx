/**
 * FindingsPanel — 发现层展示（RESEARCH-FINDING-001）。
 *
 * 展示纪律（对应后端 `findings.ts` / `findingEngine.ts` 的立场）：
 *   - **研究强度 ≠ 策略评分**：`researchStrength` 是研究优先级，显式标注「不是策略评分」；
 *   - **免责声明必须显著**：自动发现只是研究辅助；
 *   - **状态只能用户 review 流转**：引擎只产出 `DISCOVERED`，`SUPPORTED`/`WEAK`/`CONTRADICTED`/
 *     `REJECTED` 只能在此逐级操作（后端 `assertFindingTransition` 兜底）；
 *   - **数值原样展示**：缺失即 `—`，不在前端重算 p 值 / 胜率 / 分组。
 */

import { useState } from "react";
import { FlaskConical, ShieldAlert, ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, StatusBadge } from "@/components/common";
import {
  findingToVm,
  formatCount,
  formatMetricValue,
  rpcErrorToDiagnostic,
  type FindingVm,
} from "@/adapters/researchEngineAdapter";
import { CreateHypothesisDialog } from "./CreateHypothesisDialog";

/** Finding 状态闭集（与后端 `RESEARCH_FINDING_STATUSES` 一致）。 */
type FindingStatus = "DISCOVERED" | "REVIEWED" | "SUPPORTED" | "WEAK" | "CONTRADICTED" | "REJECTED";

/** Finding 状态 → 用户可流转到的下一状态（与后端 FINDING_STATUS_TRANSITIONS 一致）。 */
const REVIEW_NEXT: Record<string, Array<{ status: FindingStatus; label: string; tone: "default" | "destructive" | "outline" | "secondary" }>> = {
  DISCOVERED: [
    { status: "REVIEWED", label: "已复核", tone: "default" },
    { status: "REJECTED", label: "否定", tone: "destructive" },
  ],
  REVIEWED: [
    { status: "SUPPORTED", label: "支持", tone: "default" },
    { status: "WEAK", label: "判弱", tone: "secondary" },
    { status: "CONTRADICTED", label: "判冲突", tone: "outline" },
    { status: "REJECTED", label: "否定", tone: "destructive" },
  ],
  SUPPORTED: [
    { status: "WEAK", label: "降弱", tone: "secondary" },
    { status: "CONTRADICTED", label: "判冲突", tone: "outline" },
    { status: "REJECTED", label: "否定", tone: "destructive" },
  ],
  WEAK: [
    { status: "SUPPORTED", label: "升支持", tone: "default" },
    { status: "CONTRADICTED", label: "判冲突", tone: "outline" },
    { status: "REJECTED", label: "否定", tone: "destructive" },
  ],
  CONTRADICTED: [
    { status: "REVIEWED", label: "回复核", tone: "default" },
    { status: "WEAK", label: "判弱", tone: "secondary" },
    { status: "REJECTED", label: "否定", tone: "destructive" },
  ],
};

function StrengthBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${((value ?? 0) * 100).toFixed(0)}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right font-mono tabular-nums">
        {value === null ? "—" : value.toFixed(2)}
      </span>
    </div>
  );
}

function FindingCard({ vm, experimentId }: { vm: FindingVm; experimentId: number }) {
  const [expanded, setExpanded] = useState(false);
  const utils = trpc.useUtils();
  const review = trpc.researchEngine.reviewFinding.useMutation({
    onSuccess: () => {
      toast.success("Finding 状态已更新");
      void utils.researchEngine.listFindings.invalidate();
      void utils.researchEngine.getExperiment.invalidate();
    },
  });

  const headline = vm.headline;
  const maxBucket = Math.max(0, ...vm.buckets.map((b) => Math.abs(b.metricValue ?? 0)));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-sm">{vm.title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{vm.findingTypeLabel}</Badge>
            <StatusBadge status={vm.status} />
            {vm.strength.grade && (
              <span className="flex items-center gap-1">
                研究强度
                <span className="font-mono tabular-nums">
                  {vm.strength.total === null ? "—" : vm.strength.total.toFixed(2)}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {vm.strength.grade}
                </Badge>
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {REVIEW_NEXT[vm.status]?.map((opt) => (
            <Button
              key={opt.status}
              size="sm"
              variant={opt.tone === "destructive" ? "destructive" : opt.tone === "outline" ? "outline" : "secondary"}
              disabled={review.isPending}
              onClick={() => review.mutate({ findingId: vm.id, status: opt.status })}
            >
              {opt.status === "SUPPORTED" || opt.status === "WEAK" ? (
                opt.status === "SUPPORTED" ? <ThumbsUp className="mr-1 h-3.5 w-3.5" /> : <ThumbsDown className="mr-1 h-3.5 w-3.5" />
              ) : null}
              {opt.label}
            </Button>
          ))}
          <CreateHypothesisDialog experimentId={experimentId} sourceFinding={vm} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 关键数值摘要 */}
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          {headline.excessReturn !== null && (
            <span>
              超额收益{" "}
              <span className="font-mono tabular-nums">{formatMetricValue("DIFFERENCE", headline.excessReturn)}</span>
            </span>
          )}
          {headline.excessReturn === null && headline.groupReturn !== null && (
            <span>
              分组收益{" "}
              <span className="font-mono tabular-nums">{formatMetricValue("MEAN_RETURN", headline.groupReturn)}</span>
            </span>
          )}
          {headline.benchmarkUnavailable && (
            <span className="flex items-center gap-1 text-amber-700">
              <TriangleAlert className="h-3.5 w-3.5" /> 基准不可得（未虚构）
            </span>
          )}
          <span>
            样本 <span className="font-mono tabular-nums">{formatCount(headline.sampleCount)}</span>
            {headline.sampleGrade && <span className="ml-1 text-muted-foreground">({headline.sampleGrade})</span>}
          </span>
          {headline.rankCorrelation !== null && (
            <span>
              秩相关 <span className="font-mono tabular-nums">{headline.rankCorrelation.toFixed(3)}</span>
            </span>
          )}
          {headline.peakHorizon !== null && (
            <span>
              峰值视界 <span className="font-mono tabular-nums">T+{headline.peakHorizon}</span>
            </span>
          )}
          {headline.stable !== null && (
            <span>
              时间稳定 <span className="font-mono">{headline.stable ? "是" : "否"}</span>
            </span>
          )}
        </div>

        {/* 五维强度（重归一化：缺失维度不惩罚） */}
        <div className="space-y-1 rounded-md border p-3">
          <p className="mb-1.5 text-[11px] text-muted-foreground">
            五维研究强度（缺失维度按「未测」而非「很差」处理 —— 研究优先级，<strong>不是策略评分</strong>）
          </p>
          <StrengthBar label="效应" value={vm.strength.effect} />
          <StrengthBar label="样本" value={vm.strength.sample} />
          <StrengthBar label="稳定性" value={vm.strength.stability} />
          <StrengthBar label="视界" value={vm.strength.horizon} />
          <StrengthBar label="单调性" value={vm.strength.monotonicity} />
        </div>

        {/* 逐档位柱状图（直出，不重算） */}
        {vm.buckets.length > 0 && (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-xs font-medium">逐档位证据</p>
            <div className="flex items-end gap-1" style={{ height: 96 }}>
              {vm.buckets.map((b, i) => {
                const h = maxBucket > 0 ? Math.max(2, (Math.abs(b.metricValue ?? 0) / maxBucket) * 80) : 2;
                const pos = (b.metricValue ?? 0) >= 0;
                return (
                  <div key={`${b.label}-${i}`} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[10px] font-mono tabular-nums leading-none">
                      {b.metricValue === null ? "—" : b.metricValue.toFixed(3)}
                    </span>
                    <div
                      className={`w-full rounded-sm ${pos ? "bg-emerald-500/70" : "bg-red-500/70"}`}
                      style={{ height: `${h}px` }}
                    />
                    <span className="max-w-full truncate text-[10px] text-muted-foreground">{b.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 局限 + 免责声明 */}
        {vm.limitations.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {vm.limitations.map((l, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            自动发现仅为研究辅助，不等同于统计显著性或交易有效性。任何策略性判断必须经 Backtest / 稳健性 /
            OOS 验证后才可成立。
          </span>
        </div>

        {/* 溯源 */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <button type="button" className="hover:underline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "收起溯源" : "查看溯源"}
          </button>
          <span>
            主分析 #{vm.primaryAnalysisId ?? "—"} · 依据 Result{" "}
            {vm.sourceResultIds.length > 0 ? vm.sourceResultIds.join(", ") : "—"}
          </span>
        </div>
        {expanded && (
          <div className="space-y-1 rounded-md bg-muted/40 p-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">runId</span>
              <span className="font-mono">{vm.runId ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">target</span>
              <span className="font-mono">{vm.target ?? "—"}</span>
            </div>
            {vm.dimension && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">dimension</span>
                <span className="font-mono">{JSON.stringify(vm.dimension)}</span>
              </div>
            )}
            {vm.evidenceText && <p className="pt-1 leading-relaxed">{vm.evidenceText}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function FindingsPanel({ experimentId }: { experimentId: number }) {
  const findings = trpc.researchEngine.listFindings.useQuery({ experimentId });

  if (findings.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 p-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (findings.error) {
    return <ErrorState error={rpcErrorToDiagnostic(findings.error.message, { title: "发现加载失败" })} />;
  }

  const list = (findings.data ?? []).map(findingToVm);

  if (list.length === 0) {
    return (
      <EmptyState
        icon={FlaskConical}
        title="尚无发现"
        description="Run 跑完后引擎自动从 Result 检测「有研究意义的统计发现」。无发现是诚实结果，不是故障。"
      />
    );
  }

  const sorted = [...list].sort((a, b) => (b.strength.total ?? -1) - (a.strength.total ?? -1));

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        共 {list.length} 条发现 · 按研究强度降序 · 引擎只产出「已发现」，支持 / 判弱 / 冲突 / 否定由你复核流转。
      </p>
      {sorted.map((vm) => (
        <FindingCard key={vm.id} vm={vm} experimentId={experimentId} />
      ))}
    </div>
  );
}
