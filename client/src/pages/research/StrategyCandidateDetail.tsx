/**
 * StrategyCandidateDetail — 策略候选详情（`/research/candidates/:candidateId`）。
 *
 * RESEARCH-006.4.1（Phase A 展示 + Phase B 转正）：把「研究结论 → 候选」的产物**完整可见**，
 * 并提供限于后端口径的编辑、状态流转与转正入口。
 *
 * 这个页面只做三件事：
 *   1. 把后端事实摊开（基础信息 / 研究来源 / 研究草图），缺失就写「已不存在」，不补不猜；
 *   2. 提供三个**已有**的写入口：编辑草图（`update`）、状态流转（`transition`）、转正（`promote`）；
 *   3. 明确标注边界：「草图 ≠ StrategyDefinition」；转正只提交候选 ID / 执行 Dataset / 分歧原因，
 *      真正的 StrategyDefinition 由后端唯一转换器构建，前端不构造、不提交。
 *
 * ⚠️ 命名注意：本页面是 **Strategy** Candidate（研究 → 策略桥），
 * 与涨停链路的「龙头候选 / CandidateHistoryTable」没有任何关系。
 */

import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { AlertTriangle, ArrowLeft, FlaskConical, Lightbulb, Radio, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, SectionCard, StatusBadge } from "@/components/common";
import { formatDateTime } from "@/adapters/researchEngineAdapter";
import { candidateToDetailVm, type CandidateDetailVm, type CandidateRawLike } from "@/adapters/strategyCandidateAdapter";
import { CandidateLifecycleActions } from "@/components/research/CandidateLifecycleActions";
import { CandidateSketchCard } from "@/components/research/CandidateSketchCard";
import { EditCandidateDialog } from "@/components/research/EditCandidateDialog";
import { PromoteCandidateDialog } from "@/components/research/PromoteCandidateDialog";

function SourceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b py-1.5 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs">{children}</span>
    </div>
  );
}

function CandidateDetailBody({
  vm,
  raw,
  onSaved,
}: {
  vm: CandidateDetailVm;
  /** 后端原始候选行 —— 编辑表单需要「改动前的原值」，不能从展示 VM 反推。 */
  raw: CandidateRawLike;
  onSaved: () => void;
}) {
  const source = vm.source;
  const backHref =
    source.experiment?.id !== undefined && source.experiment !== null
      ? `/research/${source.experiment.id}`
      : "/research";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <Link
                href={backHref}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
              >
                <ArrowLeft className="h-3 w-3" /> 返回研究实验
              </Link>
              <CardTitle className="flex items-center gap-2 text-base">
                <Trophy className="h-4 w-4 shrink-0" /> {vm.name}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{vm.description ?? "（未填描述）"}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <StatusBadge status={vm.status} label={vm.statusLabel} />
              <EditCandidateDialog candidate={raw} onSaved={onSaved} />
              <CandidateLifecycleActions candidateId={raw.id ?? 0} status={vm.status} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Candidate ID <span className="font-mono">#{vm.id ?? "—"}</span>
            </span>
            <span>创建于 {formatDateTime(vm.createdAt)}</span>
            <span>更新于 {formatDateTime(vm.updatedAt)}</span>
            <span>
              转正产物{" "}
              {vm.strategyDefinitionId ? (
                <span className="font-mono">{vm.strategyDefinitionId}</span>
              ) : (
                <span className="text-muted-foreground">未转正（合法状态）</span>
              )}
            </span>
          </div>
        </CardHeader>
      </Card>

      <SectionCard
        title="研究来源"
        icon={FlaskConical}
        description="来源是登记当时的快照（不是外键）：上游被删除后仍能回答「这个候选从哪来」，缺失项由后端如实标注。"
      >
        <div className="space-y-0">
          <SourceRow label="来源结论">
            {source.conclusion ? (
              <span>
                <span className="font-mono">#{source.conclusion.id}</span> {source.conclusion.title}
                <span className="ml-2">
                  <StatusBadge status={source.conclusion.status} />
                </span>
                {source.conclusion.confidence !== null && (
                  <span className="ml-2 text-muted-foreground">
                    主观置信度 <span className="font-mono">{source.conclusion.confidence.toFixed(4)}</span>
                  </span>
                )}
              </span>
            ) : (
              <span className="text-amber-700">已不存在</span>
            )}
          </SourceRow>
          <SourceRow label="来源实验">
            {source.experiment ? (
              <Link href={`/research/${source.experiment.id}`} className="hover:underline">
                <span className="font-mono">#{source.experiment.id}</span> {source.experiment.name}
              </Link>
            ) : (
              <span className="text-amber-700">已不存在</span>
            )}
          </SourceRow>

          <SourceRow label="Research Run">
            {source.runId === null ? (
              <span className="text-muted-foreground">
                提不出（结论证据里没有唯一 Run —— 来源快照如实为空，不伪造）
              </span>
            ) : (
              <span className="font-mono">#{source.runId}</span>
            )}
          </SourceRow>

          <SourceRow label="研究来源 Dataset">
            {source.dataset ? (
              <span>
                <span className="font-mono">#{source.dataset.datasetVersionId}</span> · label{" "}
                <span className="font-mono">{source.dataset.label}</span>
                {source.dataset.datasetCode && (
                  <span className="ml-1 text-muted-foreground">（{source.dataset.datasetCode}）</span>
                )}
                <span className="ml-2">
                  <StatusBadge status={source.dataset.status} />
                </span>
              </span>
            ) : (
              <span className="text-amber-700">Registry 中查不到</span>
            )}
          </SourceRow>

          <SourceRow label="数据集用途">
            <span className="text-muted-foreground">
              这是「研究来源」坐标；正式策略执行绑定哪份 Dataset，在转正时确定（两者允许不同，不同必须有分歧原因）。
            </span>
          </SourceRow>

          {vm.sourceDatasetDivergenceReason && (
            <SourceRow label="来源 / 执行分歧原因">
              <span>{vm.sourceDatasetDivergenceReason}</span>
            </SourceRow>
          )}
        </div>

        {source.missingNote && (
          <p className="mt-3 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{source.missingNote}</span>
          </p>
        )}
      </SectionCard>

      <CandidateSketchCard raw={raw} />

      {vm.status === "ACCEPTED" && (
        <SectionCard
          title="转正为 Strategy"
          icon={Radio}
          description="候选已采纳，可以转正。转正由后端执行：构建 StrategyDefinition → 校验 → 绑定执行 Dataset → 写入 Strategy Version 与来源溯源。前端只提交候选 ID、执行 Dataset 坐标与（必要时）分歧原因。"
        >
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <PromoteCandidateDialog
                candidate={{
                  id: vm.id ?? 0,
                  name: vm.name,
                  status: vm.status,
                  sourceDatasetVersionId:
                    source.dataset?.datasetVersionId ?? raw.sourceDatasetVersionId ?? null,
                  sourceDatasetLabel: source.dataset?.label ?? null,
                }}
                onPromoted={onSaved}
              />
              <span className="text-[11px] text-muted-foreground">
                转正后本页状态由后端改写为「已转正」，页面随即变为只读。
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              「研究来源 Dataset」用于形成研究结论；Strategy 的「执行」Dataset 在转正时确定，两者允许不同。
            </p>
          </div>
        </SectionCard>
      )}

      {vm.status === "CONVERTED" && (
        <p className="flex items-start gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900">
          <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            该候选已转正，产出的 Strategy 版本独立于 Research 存在 ——
            策略侧的执行不依赖研究模块是否可用。
          </span>
        </p>
      )}
    </div>
  );
}

export default function StrategyCandidateDetail() {
  const params = useParams();
  const candidateId = Number(params.candidateId);
  const validId = Number.isFinite(candidateId) && candidateId > 0;

  const detail = trpc.research.strategyCandidate.get.useQuery(
    { candidateId },
    { enabled: validId },
  );

  const vm = useMemo(
    () => (detail.data === undefined ? null : candidateToDetailVm(detail.data)),
    [detail.data],
  );

  if (!validId) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState
          error={{
            code: "BAD_REQUEST",
            title: "无效的候选 ID",
            explanation: "URL 中的 candidateId 不是合法正整数。",
            suggestions: ["回到研究实验页，从「策略候选」标签重新打开候选"],
          }}
        />
      </div>
    );
  }

  if (detail.isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Card>
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (detail.error) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState
          error={{
            code: "RPC_ERROR",
            title: "候选加载失败",
            explanation: detail.error.message,
            suggestions: ["确认候选未被删除", "返回研究实验页重新打开"],
            technical: detail.error.message,
          }}
        />
      </div>
    );
  }

  if (vm === null || detail.data === undefined) {
    return (
      <div className="p-4 md:p-6">
        <EmptyState
          icon={Trophy}
          title="候选不存在"
          description="后端没有返回该候选。它可能已被删除，或 ID 不属于本工作区。"
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href="/research">返回研究实验列表</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <CandidateDetailBody vm={vm} raw={detail.data.candidate} onSaved={() => void detail.refetch()} />
      <p className="mt-4 text-[11px] text-muted-foreground">
        本页面只读展示后端事实：候选状态、来源快照与草图均由后端写入。
        <Badge variant="outline" className="ml-2 text-[10px]">
          草图 ≠ StrategyDefinition
        </Badge>
      </p>
    </div>
  );
}
