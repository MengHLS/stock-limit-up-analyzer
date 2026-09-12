/**
 * ExperimentActions — 实验级维护入口（重命名 / 删除）。
 *
 * 诚实点：
 *   - 名称与描述可改，但 `datasetVersionId` **创建即冻结**（后端 schema 里根本没有这个
 *     键），所以本组件不提供「换数据集」入口 —— 换数据集等于换研究，应当新建实验；
 *   - 删除是**全量级联**且不可恢复，因此删除确认里逐项列出会被连带删除的实体，
 *     删完回显服务端返回的真实计数。
 */

import { useState } from "react";
import { useLocation } from "wouter";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";

export function ExperimentActions({
  experimentId,
  name,
  description,
  datasetLabel,
}: {
  experimentId: number;
  name: string;
  description: string | null;
  /** 已冻结的 Dataset 版本标签（只读展示，防止用户以为可以换）。 */
  datasetLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name, description: description ?? "" });
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();

  const update = trpc.researchEngine.updateExperiment.useMutation();
  const remove = trpc.researchEngine.deleteExperiment.useMutation();

  async function handleSave() {
    setError(null);
    if (form.name.trim() === "") {
      setError("实验名称不能为空");
      return;
    }
    try {
      await update.mutateAsync({
        experimentId,
        name: form.name.trim(),
        // 空描述写 null（而不是空字符串）——与「未填」语义一致
        description: form.description.trim() === "" ? null : form.description.trim(),
      });
      toast.success("实验已更新");
      await Promise.all([
        utils.researchEngine.getExperiment.invalidate(),
        utils.researchEngine.listExperiments.invalidate(),
      ]);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> 重命名
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑实验信息</DialogTitle>
            <DialogDescription>
              Dataset 版本在创建时已冻结（{datasetLabel}）。换数据集等于换研究，请新建实验。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="exp-name">名称</Label>
              <Input
                id="exp-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="例如：首板换手率与未来5日收益研究"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-desc">描述（可选）</Label>
              <Textarea
                id="exp-desc"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="记录研究动机与口径假设；留空将以 NULL 存储。"
              />
            </div>
            {error && (
              <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={update.isPending}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={update.isPending}>
              {update.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteButton
        label="删除实验"
        variant="destructive"
        title="删除整个实验及其全部研究产物？"
        confirmLabel="确认删除实验"
        successTitle="实验已删除"
        consequence={
          <div className="space-y-1.5 text-xs">
            <p>本项目没有数据库外键，所以级联删除由服务端逐层执行。以下实体会被永久删除且不可恢复：</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>全部 Run 与其「运行中」之外的执行记录</li>
              <li>每个 Run 下的全部分析（含条件、指标定义、结果行）</li>
              <li>全部假设、结论、策略候选、产物</li>
            </ul>
            <p className="text-amber-800">执行中（RUNNING）的实验会被拒绝删除 —— 请等本次执行结束。</p>
          </div>
        }
        onConfirm={async () => {
          const result = await remove.mutateAsync({ experimentId });
          await Promise.all([
            utils.researchEngine.listExperiments.invalidate(),
            utils.researchEngine.getExperiment.invalidate(),
          ]);
          navigate("/research");
          return { summary: result.summary };
        }}
      />
    </div>
  );
}
