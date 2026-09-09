/**
 * SectionCard — 分段内容卡（任务 §14 / §16 公共组件）。
 *
 * 统一 Header + 分段的视觉节奏：标题 / 描述 / 右侧操作区（如「运行」按钮、状态徽标）。
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function SectionCard({
  title,
  description,
  icon: Icon,
  right,
  children,
  className,
  contentClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  right?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("gap-0", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              <span className="truncate">{title}</span>
            </CardTitle>
            {description && (
              <CardDescription className="mt-0.5">
                {description}
              </CardDescription>
            )}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      </CardHeader>
      {children && (
        <CardContent className={contentClassName}>{children}</CardContent>
      )}
    </Card>
  );
}
