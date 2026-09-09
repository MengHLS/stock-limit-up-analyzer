/**
 * BuildPipeline — 构建诊断链（任务 §7）。
 *
 * Source → Universe → Trading Calendar → PIT → OHLCV → Corporate Actions →
 * Liquidity → Index → Industry → Final Dataset。
 *
 * 每个节点展示真实状态（SUCCESS/WARNING/FAILED/SKIPPED）+ 后端真实行数/说明。
 * **不臆造**「Filtered rows」等后端未提供的中间数据。
 */

import { SectionCard, StatusBadge } from "@/components/common";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { styleForStatus } from "@/lib/status";
import type { PipelineNodeViewModel } from "@/adapters/buildResultAdapter";

export function BuildPipeline({ nodes }: { nodes: PipelineNodeViewModel[] }) {
  return (
    <SectionCard
      title="Build Pipeline"
      description="Source → Universe → Calendar → PIT → 各域 → Final Dataset（真实加载事实）"
    >
      <div className="space-y-0">
        {nodes.map((node, i) => {
          const style = styleForStatus(node.status);
          return (
            <div key={node.id}>
              <div className="flex items-start gap-3 rounded-md px-2 py-1.5">
                <span
                  className={cn(
                    "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                    style.dot
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{node.label}</span>
                    <StatusBadge status={node.status} className="text-[10px]" />
                  </div>
                  <p className="text-xs text-muted-foreground">{node.detail}</p>
                </div>
                {(node.inputRows !== null || node.outputRows !== null) && (
                  <div className="shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                    {node.inputRows !== null && (
                      <p>Input: {node.inputRows.toLocaleString()}</p>
                    )}
                    {node.outputRows !== null && (
                      <p>Output: {node.outputRows.toLocaleString()}</p>
                    )}
                  </div>
                )}
              </div>
              {i < nodes.length - 1 && (
                <div className="flex justify-start pl-[13px]">
                  <ArrowDown className="h-3 w-3 text-slate-300" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
