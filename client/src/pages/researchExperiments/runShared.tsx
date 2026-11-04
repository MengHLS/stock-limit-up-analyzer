
import { AlertTriangle, Ban, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type {
  ExperimentRunLifecycleStatus,
  ExperimentRunRecord,
} from "@shared/researchExperimentsContracts";
import { Badge } from "@/components/ui/badge";

/** 毫秒 → 人读（<1s 用 ms；<1min 用 s；否则 分+秒）。 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`;
}

/** ISO → 本地 `YYYY-MM-DD HH:mm:ss`（非法值原样返回，不编造）。 */
export function formatDateTime(iso: string | null): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 字节 → 人读。 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

/** 状态徽章（含「卡住」标注 —— 与后端 `stale` 同源，不自行推断）。 */
export function RunStatusBadge({ run }: { run: ExperimentRunRecord }) {
  const { status, stale } = run;
  const map: Record<
    ExperimentRunLifecycleStatus,
    { label: string; className: string; icon: React.ReactNode }
  > = {
    PENDING: {
      label: "PENDING",
      className: "border-slate-300 text-slate-700",
      icon: <Clock className="mr-1 h-3 w-3" />,
    },
    RUNNING: {
      label: "RUNNING",
      className: "border-blue-300 text-blue-700",
      icon: <Loader2 className="mr-1 h-3 w-3 animate-spin" />,
    },
    COMPLETED: {
      label: "COMPLETED",
      className: "border-emerald-300 text-emerald-700",
      icon: <CheckCircle2 className="mr-1 h-3 w-3" />,
    },
    FAILED: {
      label: "FAILED",
      className: "border-red-300 text-red-700",
      icon: <XCircle className="mr-1 h-3 w-3" />,
    },
  };
  const entry = map[status];
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="outline" className={`gap-0 font-mono text-[10px] ${entry.className}`}>
        {entry.icon}
        {entry.label}
      </Badge>
      {stale && (
        <Badge variant="outline" className="gap-0 border-amber-300 font-mono text-[10px] text-amber-700">
          <AlertTriangle className="mr-1 h-3 w-3" />
          可能已卡住
        </Badge>
      )}
    </span>
  );
}

/** 「未产出」标注：Run 没有产物（失败 / 未完成）。 */
export function NoArtifactBadge({ text }: { text: string }) {
  return (
    <Badge variant="outline" className="gap-0 text-[10px] text-muted-foreground">
      <Ban className="mr-1 h-3 w-3" />
      {text}
    </Badge>
  );
}

/** 一行「标签 : 等宽值」。 */
export function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all font-mono">{value}</span>
    </div>
  );
}
