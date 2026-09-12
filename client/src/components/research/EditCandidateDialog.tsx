/**
 * EditCandidateDialog — 编辑候选**研究草图**（`research.strategyCandidate.update`，admin）。
 *
 * 🔴 边界（RESEARCH-006.4.1 §5）：
 *   - 只可能提交 7 个白名单字段（name / description / entryRule / filterRule / exitRule /
 *     riskRule / parameterSpace），由 `buildUpdateCandidatePatch` 保证（有单测）；
 *   - 页面上**不存在**`status` / `strategyDefinitionId` / `conclusionId` / `experimentId` /
 *     `sourceDatasetVersionId` / `sourceResearchRunId` / `sourceTraceJson` 的输入项
 *     —— 这些字段只能由 `transition` / `promote` 等语义化入口写入；
 *   - 草图用**结构化表单**（`CandidateSketchFields`）：五块草稿全是强类型、词表有界的结构，
 *     枚举项一律来自本地词表（与后端逐字对表），转正不支持的取值根本不出现在选项里；
 *     表单按**交易决策顺序**分段（买什么 → 什么价买 → 怎么卖 → 买多少 → 成本与资金 → 参数空间），
 *     默认折叠、折叠态给一行中文摘要，只有第一段有缺口的自动展开 ——
 *     完整的「还差什么」清单在表单顶部，点击可跳到对应段；
 *   - **不可表达 ⇒ 只读**：既有值含未知键 / 非法类型时，该块显示原始 JSON 且不参与提交
 *     （绝不静默丢键），用户只能显式「丢弃并重填」；
 *   - 不重算、不补默认：初值就是后端返回的原值。唯一例外是成本段那个**用户自己按下去的**
 *     「套用 A 股标准」按钮。
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Pencil } from "lucide-react";
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
import { candidateErrorDiagnostic, type CandidateRawLike } from "@/adapters/strategyCandidateAdapter";
import { CandidateSketchFields } from "./CandidateSketchFields";
import { validateSketchDrafts, type CandidateSketchDrafts } from "./candidateSketchForm";
import {
  buildUpdateCandidatePatch,
  candidateEditOriginalOf,
  createDefaultEditForm,
} from "./candidateForm";

export function EditCandidateDialog({
  candidate,
  onSaved,
}: {
  candidate: CandidateRawLike;
  onSaved?: () => void;
}) {
  const candidateId = candidate.id ?? 0;
  const original = useMemo(() => candidateEditOriginalOf(candidate), [candidate]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => createDefaultEditForm(candidate));
  const utils = trpc.useUtils();
  const update = trpc.research.strategyCandidate.update.useMutation();

  // 弹窗打开时同步一次后端最新值（避免用旧快照覆盖别人刚写的改动）。
  useEffect(() => {
    if (open) setForm(createDefaultEditForm(candidate));
  }, [open, candidate]);

  const result = buildUpdateCandidatePatch(original, form);
  const errors = result.ok ? [] : result.errors;
  const sketchValidation = validateSketchDrafts(form.sketch);
  /** 阻断保存的问题：补丁问题（含「没有任何改动」）与草图本身的非法值。放在表单**上方**，免得滚到下面就看不见。 */
  const blockingErrors = Array.from(new Set([...errors, ...sketchValidation.errors]));

  async function handleSubmit() {
    if (!result.ok || update.isPending) return;
    try {
      await update.mutateAsync({ candidateId, patch: result.patch });
      toast.success("候选草图已保存", {
        description: "只写入了改动过的字段；状态与来源快照不受影响。",
      });
      setOpen(false);
      await utils.research.strategyCandidate.get.invalidate({ candidateId });
      onSaved?.();
    } catch (e) {
      const diagnostic = candidateErrorDiagnostic(e, "UPDATE_SKETCH");
      toast.error(diagnostic.title, { description: diagnostic.explanation });
    }
  }

  const setSketch = (sketch: CandidateSketchDrafts) => setForm((prev) => ({ ...prev, sketch }));

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={candidateId <= 0}>
        <Pencil className="mr-1.5 h-3.5 w-3.5" /> 编辑草图
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>编辑候选草图</DialogTitle>
            <DialogDescription>
              只允许修改研究草图字段。状态、来源实验 / 结论、来源 Dataset 与证据快照不可经此修改
              —— 它们分别由状态流转与转正入口写入。草图是**结构化**的：枚举项即后端词表，
              转正不认识的取值不会出现在选项里。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-candidate-name">候选名</Label>
              <Input
                id="edit-candidate-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-candidate-description">描述</Label>
              <Textarea
                id="edit-candidate-description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">清空 = 提交 null（显式清空，不是「未填写」）。</p>
            </div>

            {blockingErrors.length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 pl-7 text-xs text-red-700">
                {blockingErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}

            <CandidateSketchFields drafts={form.sketch} onChange={setSketch} />

            {sketchValidation.gaps.length === 0 && sketchValidation.errors.length === 0 && (
              <p className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900">
                <CheckCircle2 className="h-3 w-3" />
                转正所需的必填项看起来都齐了（最终仍由后端逐字段校验；这里只做提示）。
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setForm(createDefaultEditForm(candidate));
                setOpen(false);
              }}
              disabled={update.isPending}
            >
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!result.ok || update.isPending}>
              {update.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
