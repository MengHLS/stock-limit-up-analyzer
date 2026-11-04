/**
 * ErrorState — 结构化错误展示（任务 §11 / §16 公共组件）。
 *
 * 把所有后端错误（NO_ROWS_BUILT / RPC_ERROR / DATA_NOT_READY / PIT_FAILED …）
 * 转成「状态码 + 用户解释 + 建议 + 技术详情」四段可读结构，不裸抛错误码。
 */

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { styleForStatus } from "@/lib/status";
import type { LucideIcon } from "lucide-react";
import { ShieldAlert, TriangleAlert } from "lucide-react";

export interface DiagnosticError {
  /** 机器可读状态码，如 NO_ROWS_BUILT / RPC_ERROR / DATA_NOT_READY。 */
  code: string;
  /** 用户可读标题。 */
  title: string;
  /** 用户可读解释。 */
  explanation: string;
  /** 可执行的建议步骤（有序）。 */
  suggestions?: string[];
  /** 技术详情（原始错误码 / 堆栈 / 原始 message）。 */
  technical?: string;
}

export function ErrorState({
  error,
  icon: Icon,
  className,
}: {
  error: DiagnosticError;
  icon?: LucideIcon;
  className?: string;
}) {
  const isDanger = /FAILED|ERROR|FAIL|RPC_ERROR/i.test(error.code);
  const style = styleForStatus(isDanger ? "FAILED" : "INCONCLUSIVE");
  const IconCmp = Icon ?? (isDanger ? ShieldAlert : TriangleAlert);

  return (
    <Alert
      className={cn(
        isDanger ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50",
        className
      )}
    >
      <IconCmp className={cn("h-4 w-4 shrink-0", style.text)} />
      <div className="flex-1 space-y-1.5">
        <AlertTitle className="flex items-center gap-2">
          {error.title}
          <Badge
            variant="outline"
            className={cn("font-mono text-[10px]", style.badge)}
          >
            {error.code}
          </Badge>
        </AlertTitle>
        <AlertDescription className="space-y-2">
          <p className="text-xs leading-relaxed">{error.explanation}</p>
          {error.suggestions && error.suggestions.length > 0 && (
            <ol className="list-inside list-decimal space-y-0.5 text-xs">
              {error.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          {error.technical && (
            <p className="rounded bg-muted/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {error.technical}
            </p>
          )}
        </AlertDescription>
      </div>
    </Alert>
  );
}
