/**
 * StatisticsGrid — Dataset Registry 版本统计（STEP DATASET-002.3）。
 *
 * 展示 eventCount / pathCount / outcomeCount / rowCount / firstDate / lastDate / horizons。
 * 全部来自后端 `getStatistics`（真实 COUNT/MIN/MAX/DISTINCT 聚合），前端不扫明细、不重算。
 */

import { SectionCard, StatusBadge } from "@/components/common";
import { MetricCard } from "@/components/common";
import { BarChart3 } from "lucide-react";
import {
  formatCount,
  type StatisticsVm,
} from "@/adapters/datasetRegistryAdapter";

export function StatisticsGrid({ stats }: { stats: StatisticsVm }) {
  return (
    <SectionCard
      title="Statistics"
      icon={BarChart3}
      description="物理表实测统计（真实 COUNT / MIN / MAX / DISTINCT，非全量加载）"
      right={<StatusBadge status={stats.status} />}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Event Count（事件）" value={formatCount(stats.eventCount)} />
        <MetricCard label="Path Count（路径）" value={formatCount(stats.pathCount)} />
        <MetricCard label="Outcome Count（结果）" value={formatCount(stats.outcomeCount)} />
        <MetricCard label="Row Count（三表合计）" value={formatCount(stats.rowCount)} />
        <MetricCard label="First Date" value={stats.firstDate ?? "—"} />
        <MetricCard label="Last Date" value={stats.lastDate ?? "—"} />
      </div>

      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <p>
          Outcome horizons：{stats.horizons.length > 0 ? stats.horizons.join(", ") : "—"}
        </p>
        <p>
          版本声明（markReady 写入）：events ={" "}
          <span className="font-mono">{formatCount(stats.declaredEvents)}</span> · rows ={" "}
          <span className="font-mono">{formatCount(stats.declaredRows)}</span>
        </p>
        <p className="text-[11px]">
          声明值来自构建时写入，实测值来自物理表 COUNT，两者口径不同；以实测为准。
        </p>
      </div>
    </SectionCard>
  );
}
