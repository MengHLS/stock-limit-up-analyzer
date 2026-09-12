/**
 * AnalysisConditionEditor — 编辑既有分析的条件（RESEARCH-002 前端工作台）。
 *
 * 为什么值得单独一个入口，而不是「删掉重建分析」：
 *   1. 分析一旦重建，`research_analysis.id` 变了 → 历史结论的证据引用全部作废；
 *   2. 用户改的往往只是**筛选口径**（换一个板块、换一个换手率区间），语义上仍是
 *      同一个分析。
 *
 * 关键的诚实点：`setAnalysisConditions` 的语义**不是**「改一行条件」，而是让旧产物
 * **失效** —— 服务端会删旧结果、删证据指向该分析的结论、把 Analysis 与 Run 回退为
 * `PENDING`。所以本对话框：
 *   - 保存前把后果写在按钮上方（用户知道自己要丢掉什么）；
 *   - 保存后如实回显「删了多少结果行 / 多少条结论」，而不是只弹一句「保存成功」。
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TriangleAlert } from "lucide-react";
import { ConditionGroupsEditor } from "./ConditionGroupsEditor";
import {
  conditionGroupsToPayload,
  conditionPayloadToDraftGroups,
  validateConditionGroups,
  type ConditionGroupDraft,
} from "./createAnalysisForm";

export function AnalysisConditionEditor({
  analysisId,
  datasetVersionId,
  analysisName,
}: {
  analysisId: number;
  datasetVersionId: number;
  analysisName: string;
}) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<ConditionGroupDraft[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const bundle = trpc.researchEngine.getAnalysis.useQuery(
    { analysisId },
    { enabled: open, refetchOnWindowFocus: false },
  );
  const variables = trpc.researchEngine.listVariables.useQuery(
    { datasetVersionId },
    { enabled: open, refetchOnWindowFocus: false },
  );

  // 打开时用**已落库的真实条件**回填（不做任何推断或补默认值）
  useEffect(() => {
    if (!open) return;
    if (!bundle.data) return;
    setGroups(conditionPayloadToDraftGroups(bundle.data.conditions));
    setErrors([]);
    setSubmitError(null);
  }, [open, bundle.data]);

  // `listVariables` 的 features / outcomes 已经是 `string[]`（变量名），不要再取 .name
  const catalog = {
    features: variables.data?.features ?? [],
    outcomes: variables.data?.outcomes ?? [],
    dimensions: variables.data?.dimensions ?? [],
  };

  const save = trpc.researchEngine.setAnalysisConditions.useMutation();
  const utils = trpc.useUtils();

  async function handleSave() {
    setSubmitError(null);
    const found = validateConditionGroups(groups, catalog);
    setErrors(found);
    if (found.length > 0) return;
    try {
      const result = await save.mutateAsync({
        analysisId,
        // 与「新建分析」共用同一个载荷构造器 —— 两条路径写入的口径必须完全一致
        conditions: conditionGroupsToPayload(groups),
      });
      // 如实回显失效后果（不美化）
      const bits: string[] = [];
      if (result.invalidation.deletedResults > 0) {
        bits.push(`已清除 ${result.invalidation.deletedResults} 行按旧口径算出的结果`);
      }
      if (result.invalidation.deletedConclusions > 0) {
        bits.push(`已删除 ${result.invalidation.deletedConclusions} 条失效结论`);
      }
      if (result.invalidation.runId !== null) {
        bits.push(`Run #${result.invalidation.runId} 已回退为 PENDING（可直接重跑）`);
      }
      toast.success("条件已替换", {
        description: bits.length > 0 ? bits.join("；") : "条件已替换（此前没有可失效的产物）",
      });
      await Promise.all([
        utils.researchEngine.getAnalysis.invalidate(),
        utils.researchEngine.getAnalysisResults.invalidate(),
        utils.researchEngine.getRun.invalidate(),
        utils.researchEngine.getExperiment.invalidate(),
        utils.researchEngine.listConclusions.invalidate(),
      ]);
      setOpen(false);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> 编辑条件
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑条件 · {analysisName}</DialogTitle>
          <DialogDescription>
            条件口径可以被修改，但修改会让旧产物失效：服务端会删除该分析按旧口径算出的全部结果行，
            并删除证据指向它的结论，然后把分析与其 Run 回退为 PENDING，便于直接重跑。
          </DialogDescription>
        </DialogHeader>

        {bundle.isLoading || variables.isLoading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在读取已落库条件与变量目录…
          </p>
        ) : bundle.error ? (
          <p className="text-xs text-red-600">{bundle.error.message}</p>
        ) : (
          <div className="space-y-3">
            <ConditionGroupsEditor
              groups={groups}
              onChange={setGroups}
              catalog={catalog}
              title="条件（整批替换）"
              hint="保存时会整体替换该分析的现有条件，并让旧结果与失效结论一并清除。"
            />

            {errors.length > 0 && (
              <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {errors.map((e) => (
                  <li key={e} className="flex items-start gap-1.5">
                    <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            )}

            {submitError && (
              <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {submitError}
              </p>
            )}

            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              保存后旧结果与失效结论不可恢复（不做软删除）。若只是想保留旧口径作对照，请改为「新建分析」。
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={save.isPending || bundle.isLoading || variables.isLoading}>
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            替换条件并让旧产物失效
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
