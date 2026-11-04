
import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** 危险操作（删除 / 取消在途运行）用 `danger`；确认默认 `default`。 */
  readonly tone?: "default" | "danger";
  /** 写请求在途：禁用两键 + 确认键显示转圈。 */
  readonly pending?: boolean;
  readonly onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  tone = "default",
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  /**
   * 🔴 焦点还原（键盘可达性）：受控且无 `AlertDialogTrigger` 时 Radix 不还原焦点。
   *    共享实现与根因见 `lib/dialogFocusRestore.ts`，由 `components/ui/alert-dialog.tsx` 统一兜底。
   */

  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      {/* 焦点还原由 `components/ui/alert-dialog.tsx` 统一兜底（见 lib/dialogFocusRestore），此处不重复实现 */}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description !== undefined && (
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">{description}</div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className={cn(tone === "danger" && "bg-red-600 text-white hover:bg-red-700")}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
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
