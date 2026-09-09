/**
 * DataTable — 长表格容器（任务 §15 / §16 公共组件）。
 *
 * 统一提供：横向滚动 + sticky header +（可选）最大高度纵向滚动。
 * 内部使用 shadcn `Table`，用法不变，仅补可滚动/sticky 能力。
 */

import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function DataTable({
  children,
  maxHeight,
  className,
}: {
  children: React.ReactNode;
  /** 设置后启用纵向滚动 + sticky header（长表用）。 */
  maxHeight?: number | string;
  className?: string;
}) {
  return (
    <div
      className={cn("overflow-auto rounded-md border", className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <Table className="[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-muted [&_thead_th]:shadow-[inset_0_-1px_0_0]">
        {children}
      </Table>
    </div>
  );
}
