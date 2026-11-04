/**
 * TechnicalDetails — 三级工程信息折叠区（任务 §13 / §16 公共组件）。
 *
 * recordVersion / fingerprint / datasetVersion / hash 链等工程字段默认折叠，
 * 不占用一级业务信息的视觉权重。
 */

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function TechnicalDetails({
  title = "技术详情",
  children,
  defaultOpen = false,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("rounded-md border", className)}
    >
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/40">
          <span>{title}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t px-3 py-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
