/**
 * ConfirmDeleteButton — 破坏性操作确认按钮（RESEARCH-002 前端工作台通用）。
 *
 * 为什么统一成一个组件：本项目**零数据库外键 + 服务端级联删除** → 一次删除会不可逆
 * 地连带删掉多个实体。因此每一处删除都必须先把「将要删掉什么」摆出来再让人确认，
 * 不允许一个裸按钮直接删。本组件只负责交互与 pending 态，**不做任何数据推断** ——
 * 具体会删掉什么由调用方按后端语义如实写进 `consequence`。
 */

import { useState, type ReactNode } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function ConfirmDeleteButton({
  label = "删除",
  title,
  consequence,
  confirmLabel = "确认删除",
  onConfirm,
  disabled = false,
  size = "sm",
  variant = "outline",
  successTitle,
}: {
  /** 触发按钮文案。 */
  label?: string;
  title: string;
  /** 如实说明连带删除的后果（由调用方按后端语义给出，不由本组件推断）。 */
  consequence: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<{ summary: string } | void>;
  disabled?: boolean;
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "destructive";
  successTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      const result = await onConfirm();
      toast.success(successTitle ?? "已删除", {
        description: result?.summary,
      });
      setOpen(false);
    } catch (e) {
      toast.error("删除失败", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <AlertDialogTrigger asChild>
        <Button size={size} variant={variant} disabled={disabled}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">{consequence}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
          >
            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
