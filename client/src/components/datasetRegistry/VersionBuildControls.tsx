/**
 * VersionBuildControls — 版本级构建控制条（STEP DATASET-002.4B）。
 *
 * 把 DATASET-002.4A 的生命周期 API 暴露为可操作 UI：
 *   - DRAFT / FAILED / READY →「开始构建 / 重新构建」＝ createBuildJob(PENDING) + startBuildJob(RUNNING)；
 *   - BUILDING（存在 RUNNING 作业）→「取消构建」＝ cancelBuildJob；
 *   - 所有非法操作由后端状态机拒绝（本组件只按后端 status 决定按钮可见性，不自行判定合法性）。
 *
 * 纪律：本组件不改动任何状态字段，只调用 admin mutation；状态以刷新后的后端事实为准。
 */

import { toast } from "sonner";
import { Hammer, Loader2, RotateCcw, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import type { DatasetBuildJobListItem } from "@shared/datasetRegistryContracts";

export function VersionBuildControls({
  datasetVersionId,
  versionLabel,
  versionStatus,
  jobs,
}: {
  datasetVersionId: number;
  versionLabel: string;
  versionStatus: string;
  jobs: DatasetBuildJobListItem[];
}) {
  const utils = trpc.useUtils();
  const createJob = trpc.datasetRegistry.createBuildJob.useMutation();
  const startJob = trpc.datasetRegistry.startBuildJob.useMutation();
  const cancelJob = trpc.datasetRegistry.cancelBuildJob.useMutation();

  const runningJob = jobs.find((j) => j.status === "RUNNING") ?? null;
  const busy = createJob.isPending || startJob.isPending || cancelJob.isPending;

  async function refresh() {
    await utils.datasetRegistry.getVersion.invalidate({ datasetVersionId });
    await utils.datasetRegistry.listJobs.invalidate({ datasetVersionId });
    await utils.datasetRegistry.getStatistics.invalidate({ datasetVersionId });
  }

  async function onStart() {
    try {
      const job = await createJob.mutateAsync({ datasetVersionId });
      await startJob.mutateAsync({ jobId: job.jobId });
      toast.success(`已开始构建：作业 ${job.jobId}（后台执行中）`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function onCancel() {
    if (!runningJob) return;
    try {
      // 取消 = 回滚：后端先停执行体，再落终态 + 清空该版本已落库数据，并回报真实清理行数。
      const res = await cancelJob.mutateAsync({ jobId: runningJob.jobId });
      if (res.rollback) {
        toast.success(
          `已取消并回滚：作业 ${runningJob.jobId}（清空 ${res.rollback.purgedRows} 行）`,
        );
      } else {
        toast.warning(
          res.rollbackSkippedReason ?? `已请求取消：作业 ${runningJob.jobId}（未回滚数据）`,
        );
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  const canStart = versionStatus === "DRAFT" || versionStatus === "FAILED" || versionStatus === "READY";
  const canCancel = versionStatus === "BUILDING" && runningJob !== null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canStart && (
        <Button size="sm" className="gap-1.5" onClick={onStart} disabled={busy}>
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : versionStatus === "READY" ? (
            <RotateCcw className="h-3.5 w-3.5" />
          ) : (
            <Hammer className="h-3.5 w-3.5" />
          )}
          {versionStatus === "READY" ? `重新构建 ${versionLabel}` : `开始构建 ${versionLabel}`}
        </Button>
      )}
      {canCancel && (
        <Button
          size="sm"
          variant="destructive"
          className="gap-1.5"
          onClick={onCancel}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          取消构建
        </Button>
      )}
      {versionStatus === "BUILDING" && !runningJob && (
        <span className="text-xs text-muted-foreground">
          版本处于 BUILDING，但未检测到 RUNNING 作业（可能为历史卡态，可重新构建恢复）。
        </span>
      )}
    </div>
  );
}
