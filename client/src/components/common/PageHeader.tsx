
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  readonly label: string;
  /** 有 `href` 才渲染成链接；**当前页**应省略（或传空）以保持不可点击。 */
  readonly href?: string;
}

export interface PageHeaderProps {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  /** 面包屑（从左到右；通常形如 `[{label:"验证", href:"/validation/oos"}, {label:"OOS"}]`）。 */
  readonly breadcrumb?: readonly BreadcrumbItem[];
  readonly icon?: LucideIcon;
  readonly right?: React.ReactNode;
  readonly className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  icon: Icon,
  right,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {breadcrumb !== undefined && breadcrumb.length > 0 && (
        <nav aria-label="面包屑" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {breadcrumb.map((item, index) => {
            const isLast = index === breadcrumb.length - 1;
            return (
              <span key={`${item.label}-${String(index)}`} className="flex items-center gap-1">
                {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />}
                {item.href === undefined || item.href === "" || isLast ? (
                  <span className={isLast ? "font-medium text-foreground" : undefined}>{item.label}</span>
                ) : (
                  <Link href={item.href} className="underline-offset-2 hover:text-foreground hover:underline">
                    {item.label}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            {Icon !== undefined && <Icon className="h-5 w-5" />}
            {title}
          </h1>
          {description !== undefined && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {right !== undefined && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </div>
    </div>
  );
}
