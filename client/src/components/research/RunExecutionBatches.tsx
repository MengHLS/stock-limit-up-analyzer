/**
 * RunExecutionBatches — 展示一条 Run 的**执行批次日志**（`run.executionLog`）。
 *
 * 为什么必须有这块 UI：`inputSnapshot` 只能说明「这条 Run 的基准是什么」，
 * **不能**说明「它被跑过几次、每次跑了哪些分析」。允许增量补跑后，一条 Run 的结果可能
 * 来自多个批次；不把批次摆出来，用户会以为「只跑过一批」。
 *
 * 如实声明（不隐藏版本边界）：批次日志是后加的能力，**此前**的 Run 其 batch 1（整轮执行）
 * 只体现在执行快照里，因此日志从 batch 2 起 —— 这不是数据缺失，而是历史事实。
 */

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/common";
import {
  formatCount,
  formatDateTime,
  formatDuration,
  type RunExecutionBatchVm,
} from "@/adapters/researchEngineAdapter";

type ExecutionBatchRow = RunExecutionBatchVm;

function durationOf(batch: ExecutionBatchRow): number | null {
  if (batch.completedAt === null) return null;
  const start = new Date(batch.startedAt).getTime();
  const end = new Date(batch.completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

export function RunExecutionBatches({ log }: { log: readonly ExecutionBatchRow[] | null | undefined }) {
  const batches = log ?? [];

  if (batches.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        该 Run 还没有执行批次记录。批次日志是随「增量补跑」一起加入的能力，
        <span className="text-foreground">此前的整轮执行只体现在执行快照里</span>
        —— 这是历史事实，不是数据缺失。
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">批次</TableHead>
          <TableHead className="w-28">模式</TableHead>
          <TableHead>分析</TableHead>
          <TableHead className="w-24">状态</TableHead>
          <TableHead className="w-24 text-right">样本量</TableHead>
          <TableHead className="w-24 text-right">耗时</TableHead>
          <TableHead className="w-44 text-right">结束时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {batches.map((b) => {
          const ms = durationOf(b);
          return (
            <TableRow key={b.sequence}>
              <TableCell className="font-mono text-xs">#{b.sequence}</TableCell>
              <TableCell className="text-xs">
                {b.mode === "FULL" ? "整轮执行" : "增量补跑"}
                <span className="ml-1 font-mono text-[11px] text-muted-foreground">{b.mode}</span>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {b.analysisIds.length === 0 ? "—" : b.analysisIds.map((id) => `#${id}`).join(", ")}
              </TableCell>
              <TableCell>
                <StatusBadge status={b.status} />
                {b.errorCode && (
                  <span className="ml-1.5 font-mono text-[11px] text-red-700">{b.errorCode}</span>
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {b.sampleCount === null ? "—" : formatCount(b.sampleCount)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {ms === null ? "—" : formatDuration(ms)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {formatDateTime(b.completedAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** 批次日志里「未生成结论」的提示（仅增量批次会出现）。 */
export function skippedConclusionNotes(log: readonly ExecutionBatchRow[] | null | undefined): string[] {
  return (log ?? [])
    .filter((b) => typeof b.conclusionSkippedReason === "string" && b.conclusionSkippedReason.length > 0)
    .map((b) => `批次 #${b.sequence}：${b.conclusionSkippedReason}`);
}
