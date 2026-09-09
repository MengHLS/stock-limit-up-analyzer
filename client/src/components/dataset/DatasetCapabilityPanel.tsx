/**
 * DatasetCapabilityPanel — Research Dataset 能力矩阵（STEP DS-V2）。
 *
 * 展示 10 维度 × 六维能力矩阵。状态完全来自后端 `researchDataset.capabilities`
 * （真实数据事实），前端不重算、不臆造 AVAILABLE。
 */

import { trpc } from "@/lib/trpc";
import { SectionCard, StatusBadge } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import { ListChecks } from "lucide-react";

function CapabilityRow({
  entry,
}: {
  entry: {
    key: string;
    name: string;
    status: string;
    researchSafe: boolean;
    evidence: string;
  };
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{entry.name}</span>
          {entry.researchSafe && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
              研究可用
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
          {entry.evidence}
        </p>
      </div>
      <StatusBadge status={entry.status} className="shrink-0" />
    </div>
  );
}

export function DatasetCapabilityPanel() {
  const q = trpc.researchDataset.capabilities.useQuery();

  return (
    <SectionCard
      title="能力矩阵（10 维度）"
      icon={ListChecks}
      description="状态来自真实数据事实，非 UI 是否存在；CONDITIONAL 表示历史数据不完整，禁止冒充 READY。"
    >
      {q.isPending && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {q.error && (
        <p className="text-xs text-red-600">能力矩阵加载失败：{q.error.message}</p>
      )}
      {q.data && (
        <div>
          {q.data.entries.map((entry) => (
            <CapabilityRow key={entry.key} entry={entry} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
