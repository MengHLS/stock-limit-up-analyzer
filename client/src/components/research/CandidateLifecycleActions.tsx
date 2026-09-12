/**
 * CandidateLifecycleActions — 候选状态流转（`research.strategyCandidate.transition`，admin）。
 *
 * 🔴 边界（RESEARCH-006.4.1 §6）：
 *   - 可选项 = `transitionTargetsFor(status)`，即「后端 API 开放目标 ∩ 状态机允许迁移」，
 *     由 `candidateForm.test.ts` 与后端常量**逐状态严格相等**断言（防漂移）；
 *   - `CONVERTED` 因此**结构上不可能出现**：前端不提供、后端也会以专属码
 *     `STRATEGY_CANDIDATE_CONVERSION_REQUIRES_PROMOTE` 拒绝 ——
 *     UI 遇到该码只**如实转述**，绝不自己模拟一次转换（§6 最后一句）；
 *   - 转正按钮属于 Phase B（`ACCEPTED` 时的转正入口），本组件不实现转正。
 */

import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/common";
import { candidateErrorDiagnostic, candidateStatusLabelOf } from "@/adapters/strategyCandidateAdapter";
import {
  isPromotableStatus,
  transitionTargetLabelOf,
  transitionTargetNoteOf,
  transitionTargetsFor,
  type CandidateTransitionTarget,
} from "./candidateForm";

export function CandidateLifecycleActions({
  candidateId,
  status,
}: {
  candidateId: number;
  status: string;
}) {
  const targets = transitionTargetsFor(status);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<CandidateTransitionTarget | null>(null);
  const utils = trpc.useUtils();
  const transition = trpc.research.strategyCandidate.transition.useMutation();

  async function handleSubmit() {
    if (target === null || transition.isPending) return;
    try {
      await transition.mutateAsync({ candidateId, to: target });
      toast.success(`候选已流转到 ${candidateStatusLabelOf(target)}`, {
        description: transitionTargetNoteOf(target),
      });
      setOpen(false);
      setTarget(null);
      await Promise.all([
        utils.research.strategyCandidate.get.invalidate({ candidateId }),
        utils.researchEngine.listCandidates.invalidate(),
        utils.researchEngine.getExperiment.invalidate(),
      ]);
    } catch (e) {
      const diagnostic = candidateErrorDiagnostic(e, "TRANSITION");
      toast.error(diagnostic.title, { description: diagnostic.explanation });
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={targets.length === 0}
        title={
          targets.length === 0
            ? "当前状态没有开放的流转目标（该状态的迁移路径已走完）。"
            : "按后端状态机执行一次状态迁移。"
        }
        onClick={() => {
          setTarget(targets[0] ?? null);
          setOpen(true);
        }}
      >
        <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> 状态流转
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>候选状态流转</DialogTitle>
            <DialogDescription>
              当前状态 <StatusBadge status={status} label={candidateStatusLabelOf(status)} />。
              可选目标来自后端开放集合（DRAFT → REVIEW → ACCEPTED 为主线）。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {targets.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTarget(t)}
                className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  target === t ? "border-primary bg-muted/60" : "hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <StatusBadge status={t} label={transitionTargetLabelOf(t)} />
                  <span className="font-mono text-[11px] text-muted-foreground">{t}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{transitionTargetNoteOf(t)}</p>
              </button>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground">
            「已转正（CONVERTED）」不由状态流转产生：它只能由转正入口在写完 Strategy 版本与来源溯源后写入。
          </p>

          {isPromotableStatus(status) && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              该候选已采纳。转正为 Strategy（含执行 Dataset 绑定与来源溯源）在 Phase B 的转正入口中执行，
              本页面不做转正。
            </p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={transition.isPending}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={target === null || transition.isPending}>
              {transition.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              确认流转到 {target ? candidateStatusLabelOf(target) : "—"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
