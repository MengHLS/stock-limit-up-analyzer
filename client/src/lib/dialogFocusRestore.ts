/**
 * 对话框「关闭后焦点还原」兜底（Radix Dialog / AlertDialog 共用）。
 *
 * ## 为什么需要它（本仓实测结论，2026-10-03）
 *
 * Radix 的默认焦点还原依赖 **`DialogTrigger`** 写入的 `triggerRef`：
 *
 * ```text
 * onCloseAutoFocus（Radix 内部）= event.preventDefault() + triggerRef.current?.focus()
 * ```
 *
 * 但本仓大量对话框是**受控**用法（`<Dialog open={state}>`，由页面自己的按钮切换 open），
 * **没有** `DialogTrigger` ⇒ `triggerRef` 为空 ⇒ 还原被跳过 ⇒ 关闭后焦点掉到 `<body>`，
 * 键盘用户丢失位置（只能从头 Tab）。实测对照：使用 `DialogTrigger` 的
 * `CreateDatasetDialog` 焦点正常回到触发按钮；受控且无 Trigger 的至少 9 个对话框会丢。
 *
 * ## 做法
 *
 * - `onOpenAutoFocus`：此刻焦点**尚未**移入内容 ⇒ `document.activeElement` 正是触发元素；
 * - `onCloseAutoFocus`：`preventDefault()` 后显式 `focus()` 回去，并用
 *   `document.contains()` 守卫，避免对已卸载节点调用。
 *
 * ⚠️ 不要在调用方各自实现：本 hook 统一挂在 `components/ui/{dialog,alert-dialog}.tsx`
 *    的 Content 上，**所有**对话框自动受益。
 */

import * as React from "react";

export interface DialogFocusRestoreHandlers {
  readonly onOpenAutoFocus: () => void;
  readonly onCloseAutoFocus: (event: Event) => void;
}

export function useDialogFocusRestore(): DialogFocusRestoreHandlers {
  const lastFocusedRef = React.useRef<HTMLElement | null>(null);

  const onOpenAutoFocus = React.useCallback(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) lastFocusedRef.current = el;
  }, []);

  const onCloseAutoFocus = React.useCallback((event: Event) => {
    event.preventDefault();
    const target = lastFocusedRef.current;
    if (target !== null && document.contains(target)) target.focus();
  }, []);

  return { onOpenAutoFocus, onCloseAutoFocus };
}