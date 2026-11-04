/**
 * DeleteDatasetDialog — 「删除数据集」危险操作（STEP DATASET-003A）。
 *
 * 语义（与后端一致）：
 *   - 级联删除该数据集**全部版本**的物理数据行；
 *   - 删除该数据集**全部构建作业**与版本记录；
 *   - **DROP 掉该数据集的全部物理表**（表结构一并删除）；
 *   - 删除数据集定义记录（datasetCode 释放，可用同 code 重建）；
 *   - 若名下任一版本存在 RUNNING 作业 → 后端拒绝（CONFLICT）。
 *
 * 二次确认：必须**手工输入 datasetCode**（与后端 `confirmDatasetCode` 强校验对应），防误删。
 */

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
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

/** 二次确认：手工输入的 datasetCode 必须与落库 code 完全一致（纯函数，便于单测）。 */
export function isDeleteDatasetConfirmed(confirmCode: string, datasetCode: string): boolean {
  return confirmCode === datasetCode;
}

export function DeleteDatasetDialog({
  definitionId,
  datasetCode,
  onDeleted,
  trigger,
}: {
  definitionId: number;
  datasetCode: string;
  onDeleted?: () => void;
  trigger?: React.ReactNode;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [confirmCode, setConfirmCode] = useState("");
  const del = trpc.datasetRegistry.deleteDatasetDefinition.useMutation();

  const matched = isDeleteDatasetConfirmed(confirmCode, datasetCode);

  async function onDelete() {
    if (!matched) return;
    try {
      const result = await del.mutateAsync({ definitionId, confirmDatasetCode: confirmCode });
      await utils.datasetRegistry.listDefinitions.invalidate();
      toast.success(
        `数据集 ${result.datasetCode} 已删除（版本 ${result.versionsDeleted} 个 / 数据 ${result.purgedRows} 行 / 作业 ${result.jobsDeleted} 个；物理表 ${result.droppedTables.length} 张已 DROP）`,
      );
      setOpen(false);
      setConfirmCode("");
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
        if (!next) setConfirmCode("");
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="destructive" className="gap-1.5">
            <Trash2 className="h-3.5 w-3.5" /> 删除数据集
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" /> 删除数据集 {datasetCode}
          </DialogTitle>
          <DialogDescription>
            这是**不可恢复**的操作：将删除该数据集全部版本的物理数据、全部构建作业，
            并 <span className="font-medium">DROP 掉其全部物理表</span>（表结构一并删除）。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1 text-xs text-muted-foreground">
          <p>· 若名下任一季度存在运行中的构建作业，删除会被拒绝，请先取消或等待结束。</p>
          <p>· 删除后 datasetCode 会被释放，可用同名 code 重建（重建时重新建表）。</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dd-confirm" className="text-xs">
            请输入 <span className="font-mono">{datasetCode}</span> 以确认删除
          </Label>
          <Input
            id="dd-confirm"
            value={confirmCode}
            onChange={(e) => setConfirmCode(e.target.value)}
            placeholder={datasetCode}
            className="font-mono"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={del.isPending}>
            取消
          </Button>
          <Button size="sm" variant="destructive" onClick={onDelete} disabled={!matched || del.isPending}>
            {del.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            确认删除数据集
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
