/**
 * DeleteDatasetVersionDialog — 「删除版本」危险操作（STEP DATASET-003A）。
 *
 * 语义（与后端一致）：
 *   - 删除该版本的**物理表数据行**（保留表结构，其它版本不受影响）；
 *   - 删除该版本**全部构建作业**（审计记录随版本移除）；
 *   - 删除版本记录；
 *   - 若存在 RUNNING 作业 → 后端拒绝（CONFLICT），需先取消或等待结束。
 *
 * 前端只做二次确认（勾选），不复述后端校验逻辑。
 */

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export function DeleteDatasetVersionDialog({
  datasetVersionId,
  datasetId,
  versionLabel,
  onDeleted,
  trigger,
}: {
  datasetVersionId: number;
  datasetId: number;
  versionLabel: string;
  onDeleted?: () => void;
  trigger?: React.ReactNode;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const del = trpc.datasetRegistry.deleteDatasetVersion.useMutation();

  async function onDelete() {
    if (!confirmed) return;
    try {
      const result = await del.mutateAsync({ datasetVersionId });
      await utils.datasetRegistry.listVersions.invalidate({ datasetId });
      await utils.datasetRegistry.getDefinition.invalidate({ definitionId: datasetId });
      toast.success(
        `版本 ${result.version} 已删除（清理 ${result.purgedRows} 行数据 / ${result.jobsDeleted} 个作业；表结构保留）`,
      );
      setOpen(false);
      setConfirmed(false);
      onDeleted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmed(false);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="destructive" className="gap-1.5">
            <Trash2 className="h-3.5 w-3.5" /> 删除版本
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" /> 删除版本 {versionLabel}
          </DialogTitle>
          <DialogDescription>
            将删除该版本的**全部物理数据行**（event / path / outcome）与该版本的**全部构建作业**，
            <span className="font-medium">表结构会保留</span>，同一数据集的其它版本不受影响。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1 text-xs text-muted-foreground">
          <p>· 若该版本有运行中的构建作业，删除会被拒绝，请先取消构建或等待结束。</p>
          <p>· 删除后该版本数据不可恢复（如需保留请先导出）。</p>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="ddv-confirm"
            checked={confirmed}
            onCheckedChange={(v) => setConfirmed(v === true)}
          />
          <Label htmlFor="ddv-confirm" className="text-xs">
            我确认删除版本 <span className="font-mono">{versionLabel}</span> 的数据与作业
          </Label>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={del.isPending}>
            取消
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={onDelete}
            disabled={!confirmed || del.isPending}
          >
            {del.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            确认删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
