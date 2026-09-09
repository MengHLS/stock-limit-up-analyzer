/**
 * StatusBadge — 统一状态徽标（任务 §12 / §16 公共组件）。
 *
 * 全站状态颜色只经 `@/lib/status` 映射，页面不再自行拼接颜色 class。
 * 支持可选图标与自定义 label（默认显示状态原文）。
 */

import { Badge } from "@/components/ui/badge";
import { styleForStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function StatusBadge({
  status,
  label,
  icon: Icon,
  className,
}: {
  status: string | null | undefined;
  /** 覆盖显示文本；缺省显示 status 原文。 */
  label?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  const style = styleForStatus(status);
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-mono", style.badge, className)}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {label ?? status ?? "—"}
    </Badge>
  );
}

/** 小圆点指示器（配合文本使用）。 */
export function StatusDot({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const style = styleForStatus(status);
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full", style.dot, className)}
    />
  );
}
