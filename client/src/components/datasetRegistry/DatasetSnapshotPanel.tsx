/**
 * DatasetSnapshotPanel — Version 详情页的**本地开发态快照**面板（LOCAL-DATASET-SNAPSHOT）。
 *
 * 只在该版本 `getSnapshotStatus().supported` 时展示：生成 / 重新生成恒等版本的一份
 * SQLite 快照，供本地跑研究 / 参数搜索 / Registry 预览时避开 TiDB 内容表瓶颈。
 *
 * 纪律：
 *   - 不臆造状态：任务状态 / 进度 / manifest 一律以 `getSnapshotStatus` 的后端事实为准；
 *   - 运行中轻量轮询（1.5s），完成后自动停止（下一次轮询即是终态）；
 *   - 快照存在但校验失败时后端 `getSnapshotStatus` 会抛错 ⇒ 本面板显示错误，不静默当作「无快照」。
 */

import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  HardDriveDownload,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ErrorState, SectionCard, type DiagnosticError } from "@/components/common";
import { formatCount, formatDateTime } from "@/adapters/datasetRegistryAdapter";
import {
  DATASET_SNAPSHOT_PHASES,
  type DatasetSnapshotPhase,
  type DatasetSnapshotTaskView,
} from "@shared/datasetRegistryContracts";

const PHASE_LABELS: Record<DatasetSnapshotPhase, string> = {
  event: "事件",
  prefix: "首板日行情",
  post: "观察日行情",
  path: "路径",
  outcome: "结果",
  identity: "身份",
  index: "索引",
  verify: "校验",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** 任务 → 0..100 的粗粒度进度（phase 序 + 当前表 rowsWritten/totalRows）。 */
function taskProgress(task: DatasetSnapshotTaskView): number {
  if (task.status === "completed") return 100;
  const last = [...task.events].reverse().find((e) => e.event === "progress");
  if (!last) return 0;
  const phaseIndex = Math.max(0, DATASET_SNAPSHOT_PHASES.indexOf(last.phase));
  const fraction =
    last.totalRows && last.totalRows > 0
      ? Math.min(1, (last.rowsWritten ?? 0) / last.totalRows)
      : 0;
  return Math.min(99, ((phaseIndex + fraction) / DATASET_SNAPSHOT_PHASES.length) * 100);
}

function lastTaskMessage(task: DatasetSnapshotTaskView): string {
  const last = task.events[task.events.length - 1];
  if (!last) return `${PHASE_LABELS[task.events[0]?.phase ?? "event"]}…`;
  return last.message;
}

export function DatasetSnapshotPanel({ datasetVersionId }: { datasetVersionId: number }) {
  const utils = trpc.useUtils();
  const enabled = Number.isFinite(datasetVersionId) && datasetVersionId > 0;
  const statusQuery = trpc.datasetRegistry.getSnapshotStatus.useQuery(
    { datasetVersionId },
    {
      enabled,
      // 运行中轻量轮询；完成后自动停止（最后一次轮询即终态，无需额外 invalidate）。
      refetchInterval: (query) =>
        query.state.data?.task?.status === "running" ? 1500 : false,
    },
  );
  const createSnapshot = trpc.datasetRegistry.createSnapshot.useMutation();

  const status = statusQuery.data;
  // 加载中 / 不支持 / 非开发态：不占用页面空间。
  if (!enabled) return null;
  if (statusQuery.error) {
    const diagnostic: DiagnosticError = {
      code: "DATASET_SNAPSHOT_ERROR",
      title: "本地快照状态读取失败",
      explanation:
        "后端在检查本地快照时抛错（常见原因：快照损坏 / 校验不通过）。为避免读到错误数据，读取会停止而不是静默回退数据库。",
      suggestions: [
        "确认后端进程仍在运行",
        "若确认快照已损坏，删除对应 .cache/datasets 目录后刷新重试",
      ],
      technical: statusQuery.error.message,
    };
    return (
      <ErrorState error={diagnostic} />
    );
  }
  if (!status || !status.supported) return null;

  const task = status.task;
  const running = task?.status === "running";
  const failed = task?.status === "failed";
  const available = status.available;
  const manifest = status.manifest;

  async function onGenerate(force: boolean) {
    try {
      const res = await createSnapshot.mutateAsync({ datasetVersionId, force });
      toast.success(`已启动快照导出：任务 ${res.taskId}`);
      await utils.datasetRegistry.getSnapshotStatus.invalidate({ datasetVersionId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  const busy = createSnapshot.isPending;
  const percent = task ? taskProgress(task) : 0;

  return (
    <SectionCard
      title="本地快照（开发态加速）"
      icon={HardDriveDownload}
      description="把该 READY 版本导出为一份本地 SQLite；研究 / 参数搜索 / 预览将优先读本地文件，避开 TiDB 内容表瓶颈。"
      right={
        available ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-500">
            <CheckCircle2 className="h-3.5 w-3.5" /> 已有快照
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">未生成</span>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {available && status.downloadUrl && (
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <a href={status.downloadUrl} download>
                <Download className="h-3.5 w-3.5" />
                下载 dataset.sqlite
              </a>
            </Button>
          )}
          <Button
            size="sm"
            className="gap-1.5"
            disabled={busy || running}
            onClick={() => void onGenerate(available)}
          >
            {busy || running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : available ? (
              <RotateCcw className="h-3.5 w-3.5" />
            ) : (
              <HardDriveDownload className="h-3.5 w-3.5" />
            )}
            {available ? "重新生成快照" : "生成快照"}
          </Button>
          {task && (
            <span className="font-mono text-[11px] text-muted-foreground">
              任务 {task.taskId}
              {task.force ? "（force）" : ""}
            </span>
          )}
        </div>

        {running && task && (
          <div className="space-y-1.5">
            <Progress value={percent} />
            <p className="text-xs text-muted-foreground">{lastTaskMessage(task)}</p>
          </div>
        )}

        {failed && task && (
          <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-500">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>导出失败：{task.error ?? "未知错误"}</span>
          </p>
        )}

        {manifest && (
          <div className="grid gap-x-6 gap-y-1 rounded-md border bg-muted/30 p-3 sm:grid-cols-2">
            <Detail k="数据集" v={`${manifest.definition.name}（${manifest.definition.datasetCode}）`} />
            <Detail k="版本" v={`${manifest.version.label}（#${manifest.version.id}）`} mono />
            <Detail
              k="日期区间"
              v={manifest.firstDate && manifest.lastDate ? `${manifest.firstDate} → ${manifest.lastDate}` : "—"}
              mono
            />
            <Detail k="事件数" v={formatCount(manifest.counts.eventCount)} mono />
            <Detail
              k="五表行数"
              v={`${formatCount(manifest.counts.rowCount)}（P ${formatCount(manifest.counts.prefixCount)} / O ${formatCount(
                manifest.counts.postCount,
              )} / Path ${formatCount(manifest.counts.pathCount)} / Out ${formatCount(
                manifest.counts.outcomeCount,
              )}）`}
              mono
            />
            <Detail k="身份数" v={formatCount(manifest.identityCount)} mono />
            <Detail k="Horizons" v={manifest.horizons.length > 0 ? manifest.horizons.join(", ") : "—"} mono />
            <Detail k="SQLite 大小" v={formatBytes(manifest.sqlite.size)} mono />
            <Detail k="导出时间" v={formatDateTime(manifest.exportedAt)} mono />
            <Detail
              k="SHA-256"
              v={<span title={manifest.sqlite.sha256}>{manifest.sqlite.sha256.slice(0, 12)}…</span>}
              mono
            />
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function Detail({ k, v, mono = false }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{k}</span>
      <span className={`truncate text-right text-xs ${mono ? "font-mono tabular-nums" : ""}`}>{v}</span>
    </div>
  );
}
