/**
 * CreateCandidateDialog — 「创建策略候选」入口（RESEARCH-006.4.1 §3）。
 *
 * 编排（唯一一次写操作）：
 *   `research.strategyCandidate.createFromConclusion`（admin）
 *   → 成功：关弹窗 + 跳转到候选详情页 `/research/candidates/:id`
 *
 * 纪律：
 *   - **默认值归后端**：只在用户确实改过 `name` / `description` 时才提交这两个键，
 *     未改动时只发 `{ conclusionId }`（`buildCreateCandidateInput` 负责，有单测）；
 *   - **不拼接 Candidate 结构**：`experimentId` / `sourceDatasetVersionId` / `sourceResearchRunId` /
 *     `sourceTraceJson` / `status` 一律不由前端提供；
 *   - **不在此处编辑草图**：规则草图在候选详情页统一编辑（一处编辑器，避免两套口径）；
 *   - 失败按后端 tRPC code 给出可执行提示（同名冲突 / 数据集未就绪 / 结论不可登记 / 权限）。
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Loader2, Trophy } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/common";
import { candidateErrorDiagnostic } from "@/adapters/strategyCandidateAdapter";
import {
  buildCreateCandidateInput,
  conclusionEligibility,
  createDefaultCandidateForm,
  validateCandidateCreateForm,
} from "./candidateForm";

export interface CreateCandidateDialogConclusion {
  id: number;
  title: string;
  conclusion: string;
  status: string;
}

export function CreateCandidateDialog({
  conclusion,
  size = "sm",
  variant = "outline",
}: {
  conclusion: CreateCandidateDialogConclusion;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => createDefaultCandidateForm(conclusion));
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const create = trpc.research.strategyCandidate.createFromConclusion.useMutation();

  const eligibility = conclusionEligibility(conclusion.status);
  const errors = validateCandidateCreateForm(form);
  const defaults = { title: conclusion.title, conclusion: conclusion.conclusion };

  function reset() {
    setForm(createDefaultCandidateForm(conclusion));
  }

  async function handleSubmit() {
    if (errors.length > 0 || create.isPending) return;
    try {
      const input = buildCreateCandidateInput({ conclusionId: conclusion.id, form, defaults });
      const created = await create.mutateAsync(input);
      const candidateId = created.candidate.id;
      toast.success(
        candidateId === undefined ? "已登记策略候选" : `已登记策略候选 #${candidateId}`,
        {
          description:
            "候选初始状态为 DRAFT。规则草图与状态流转都在候选详情页进行；转正（ACCEPTED → Strategy）由转正入口执行。",
        },
      );
      setOpen(false);
      await Promise.all([
        utils.researchEngine.listCandidates.invalidate(),
        utils.researchEngine.getExperiment.invalidate(),
      ]);
      if (candidateId !== undefined) navigate(`/research/candidates/${candidateId}`);
    } catch (e) {
      const diagnostic = candidateErrorDiagnostic(e, "CREATE_FROM_CONCLUSION");
      toast.error(diagnostic.title, { description: diagnostic.explanation });
    }
  }

  return (
    <>
      <Button
        size={size}
        variant={variant}
        disabled={!eligibility.allowed}
        title={eligibility.reason ?? "基于本结论登记一个策略候选（草稿态）。"}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Trophy className="mr-1.5 h-3.5 w-3.5" /> 创建策略候选
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>创建策略候选</DialogTitle>
            <DialogDescription>
              候选是「研究结论 → 正式策略」的中间产物，初始状态为草稿（DRAFT）。
              实验、来源 Dataset 与证据快照由后端按结论自动登记，不需要（也不允许）在这里填。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">来源结论</span>
                <span className="font-mono">#{conclusion.id}</span>
                <StatusBadge status={conclusion.status} />
              </div>
              <p className="mt-1 font-medium">{conclusion.title}</p>
              {!eligibility.allowed && eligibility.reason && (
                <p className="mt-1 text-amber-700">{eligibility.reason}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="candidate-name">候选名</Label>
              <Input
                id="candidate-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="例如：首板隔日溢价"
              />
              <p className="text-[11px] text-muted-foreground">
                初值即结论标题（后端缺省值）。不改动时不会把它发给后端 —— 缺省由后端负责。
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="candidate-description">描述</Label>
              <Textarea
                id="candidate-description"
                rows={4}
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                初值即结论正文（后端原样引用，不改写）。同上：不改动就不提交。
              </p>
            </div>

            <p className="text-[11px] text-muted-foreground">
              入场 / 过滤 / 退出 / 风控规则与参数空间是 Research 草图，登记后在候选详情页补写
              —— 它们还不是 StrategyDefinition，转正时才由后端转换与校验。
            </p>

            {errors.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-600">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={create.isPending}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={errors.length > 0 || create.isPending}>
              {create.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              登记候选
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
