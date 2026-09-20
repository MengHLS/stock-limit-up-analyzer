/**
 * ConfirmDialog — 通用「危险操作确认」对话框（FRONTEND-FINAL-001 · P2-2 / §九-10）。
 *
 * ## 为什么要它
 *
 * 审计确认：`common/` 层**没有**统一确认对话框，全仓唯一的封装是
 * `components/research/ConfirmDeleteButton.tsx`（1 个使用点，且它自己是「触发器 + 对话框」耦合体）。
 * 其它地方要做确认只能各自手写 `AlertDialog` —— 这正是本次要收敛的重复。
 *
 * 与 `ConfirmDeleteButton` 的分工：
 * - 本组件是**受控**的纯对话框（`open` / `onOpenChange` 由调用方持有），
 *   因为它需要服务于「按钮触发」之外的情形（例如选中记录后确认）；
 * - `ConfirmDeleteButton` 继续负责「一个删除按钮 + 内置对话框」的自包含形态，不受本组件影响。
 *
 * `pending` 为真时禁用两个按钮 —— 避免用户在写请求在途时重复确认。
 */

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
  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
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
