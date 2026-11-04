/**
 * EmptyState — 诚实空态（任务 §5 / §16 公共组件）。
 *
 * 用于「后端尚无数据」时展示空态，**绝不伪造数据**。
 */

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-12 text-center",
        className
      )}
    >
      {Icon && <Icon className="h-8 w-8 text-slate-300" />}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
