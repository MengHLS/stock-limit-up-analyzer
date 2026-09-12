/**
 * BuildJobTable — Dataset Registry 构建作业列表（STEP DATASET-002.3）。
 *
 * 展示 PENDING / RUNNING / COMPLETED / FAILED / CANCELLED 五态 + 进度（chunk 比例）。
 * lastCursor 只显示技术摘要（checkpointSummary），不直接展示原始 JSON（任务 §7）。
 *
 * 说明（任务 §7）：BuildPipeline / BuildSummary 建模的是旧 researchDataset 的
 * Source→Universe→Calendar→… 源校验链；Dataset Registry 的构建作业是 chunk/cursor/进度
 * 模型，无对应「源链节点」，强行复用会臆造不存在的节点，故此处使用聚焦的作业进度表
 * （非复制 BuildPipeline，二者职责不同）。
 */

import { SectionCard, StatusBadge, TechnicalDetails } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  formatCount,
  formatDateTime,
  type BuildJobVm,
} from "@/adapters/datasetRegistryAdapter";
import { Hammer, Loader2, RotateCcw, XCircle } from "lucide-react";

function JobProgress({
  job,
  totalRows,
}: {
  job: BuildJobVm;
  totalRows: number | null;
}) {
  const pct = job.progressPercent;
  return (
    <div className="w-40 space-y-1">
      <Progress value={pct ?? 0} className="h-1.5" />
      <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
        <span>
          {job.processedRows !== null
            ? `${formatCount(job.processedRows)}${totalRows !== null ? ` / ${formatCount(totalRows)}` : ""}`
            : "—"}
        </span>
        <span>{pct !== null ? `${pct}%` : "—"}</span>
      </div>
    </div>
  );
}

/** 作业级操作（按状态渲染；非法操作后端会拒绝，此处只做可见性收敛）。 */
function JobActions({
  job,
  onCancel,
  onRetry,
  busy,
}: {
  job: BuildJobVm;
  onCancel?: (job: BuildJobVm) => void;
  onRetry?: (job: BuildJobVm) => void;
  busy?: boolean;
}) {
  const canCancel = job.status === "RUNNING" || job.status === "PENDING";
  const canRetry = job.status === "FAILED" || job.status === "CANCELLED";
  if (!(canCancel && onCancel) && !(canRetry && onRetry)) return null;
  return (
    <div className="flex items-center gap-2">
      {canCancel && onCancel && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => onCancel(job)}
          disabled={busy}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
          取消
        </Button>
      )}
      {canRetry && onRetry && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => onRetry(job)}
          disabled={busy}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          重试
        </Button>
      )}
    </div>
  );
}

export function BuildJobTable({
  jobs,
  totalRows,
  onCancel,
  onRetry,
  busy = false,
}: {
  jobs: BuildJobVm[];
  totalRows?: number | null;
  /** 取消作业（RUNNING / PENDING）；缺省则隐藏取消按钮。 */
  onCancel?: (job: BuildJobVm) => void;
  /** 重试作业（FAILED / CANCELLED，后端创建新 Job、保留历史）；缺省则隐藏重试按钮。 */
  onRetry?: (job: BuildJobVm) => void;
  busy?: boolean;
}) {
  return (
    <SectionCard
      title="Build Jobs"
      icon={Hammer}
      description="构建作业状态与进度（chunk / 行数）；lastCursor 仅以技术摘要展示"
    >
      {jobs.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          该版本暂无构建作业记录。
        </p>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-md border px-3 py-2">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={job.status} />
                <span className="font-mono text-xs text-muted-foreground">
                  {job.jobId}
                </span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {formatDateTime(job.startedAt)}
                  {job.completedAt ? ` → ${formatDateTime(job.completedAt)}` : ""}
                </span>
                <JobActions job={job} onCancel={onCancel} onRetry={onRetry} busy={busy} />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-4">
                <JobProgress job={job} totalRows={totalRows ?? null} />
                <div className="font-mono text-[11px] text-muted-foreground">
                  <p>chunks: {formatCount(job.completedChunks)} / {formatCount(job.totalChunks)}</p>
                  <p>failed: {formatCount(job.failedRows)}</p>
                </div>
                {job.lastTradeDate && (
                  <div className="font-mono text-[11px] text-muted-foreground">
                    last trade: {job.lastTradeDate}
                  </div>
                )}
              </div>

              {job.errorMessage && (
                <p className="mt-2 text-xs text-red-600">
                  {job.errorMessage}
                </p>
              )}

              <TechnicalDetails
                title="技术详情（checkpoint / 游标摘要）"
                defaultOpen={false}
                className="mt-2"
              >
                <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                  <p>lastSymbol: {job.lastSymbol ?? "—"}</p>
                  <p>lastTradeDate: {job.lastTradeDate ?? "—"}</p>
                  <p>currentChunk: {job.currentChunk ?? "—"}</p>
                  {job.checkpointSummary ? (
                    <>
                      <p>phase: {job.checkpointSummary.phase}</p>
                      <p>
                        checkpoint.processedRows:{" "}
                        {formatCount(job.checkpointSummary.processedRows)}
                      </p>
                      <p>
                        checkpoint.completedChunks:{" "}
                        {formatCount(job.checkpointSummary.completedChunks)}
                      </p>
                      <p>
                        checkpoint.lastEventId:{" "}
                        {job.checkpointSummary.lastEventId ?? "—"}
                      </p>
                    </>
                  ) : (
                    <p>checkpoint: 无（lastCursor 为空或非 JSON）</p>
                  )}
                </div>
              </TechnicalDetails>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
