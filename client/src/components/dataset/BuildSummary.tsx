/**
 * BuildSummary — 构建结果总览（任务 §9 / §10）。
 *
 * 严格区分「数据源（Source Rows）」与「最终结果（Final Dataset Rows）」，避免
 * 用户误读「已加载 55,XXX rows 即构建成功」。PIT / DATA_READY 状态来自后端事实派生。
 */

import { Badge } from "@/components/ui/badge";
import { SectionCard, StatusBadge } from "@/components/common";
import { cn } from "@/lib/utils";
import { Layers } from "lucide-react";
import type { BuildResultViewModel } from "@/adapters/buildResultAdapter";

function fmt(n: number | null): string {
  return n === null ? "—" : n.toLocaleString();
}

function Kv({
  k,
  v,
  mono = false,
  tone,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
  tone?: "ok" | "warn" | "bad" | "muted";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "bad"
          ? "text-red-700"
          : tone === "muted"
            ? "text-muted-foreground"
            : "text-foreground";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-muted-foreground">{k}</span>
      <span
        className={cn(
          "text-right text-sm font-medium",
          mono && "font-mono tabular-nums",
          toneClass
        )}
      >
        {v}
      </span>
    </div>
  );
}

const PIT_LABEL: Record<
  BuildResultViewModel["pitStatus"],
  { label: string; status: string }
> = {
  PASS: { label: "逐日 PIT", status: "PASS" },
  FULL_KNOWLEDGE: { label: "固定 asOf（全知视角）", status: "WARNING" },
  UNKNOWN: { label: "未知", status: "UNKNOWN" },
};

export function BuildSummary({
  vm,
  durationMs,
}: {
  vm: BuildResultViewModel;
  durationMs: number | null;
}) {
  const pit = PIT_LABEL[vm.pitStatus];

  return (
    <SectionCard
      title="Build Summary"
      icon={Layers}
      right={<StatusBadge status={vm.gate} />}
      description={`${vm.startDate ?? "—"} → ${vm.endDate ?? "—"}`}
    >
      {/* 最终结果（一级业务信息） */}
      <p className="mb-1 text-xs font-semibold text-muted-foreground">
        最终结果（Final Dataset）
      </p>
      <div className="rounded-md border bg-muted/20 px-3 py-2">
        <Kv k="Trading Days" v={fmt(vm.tradingDays)} mono />
        <Kv k="Universe Size" v={fmt(vm.universeSize)} mono />
        <Kv
          k="Final Dataset Rows"
          v={vm.hasNoRows ? "0（NO_ROWS_BUILT）" : fmt(vm.rowCount)}
          mono
          tone={vm.hasNoRows ? "bad" : "ok"}
        />
      </div>

      {/* 数据源（原始加载，明确标注 ≠ 最终 rows） */}
      <p className="mb-1 mt-4 text-xs font-semibold text-muted-foreground">
        数据源（Source Rows，仅原始加载量，不等于最终 rows）
      </p>
      <div className="rounded-md border px-3 py-2">
        <Kv k="Source Rows（合计）" v={fmt(vm.sourceRows)} mono tone="muted" />
        <Kv
          k="覆盖缺口"
          v={
            vm.coverageGaps.length === 0 ? "无" : `${vm.coverageGaps.length} 项`
          }
          mono
          tone={vm.coverageGaps.length > 0 ? "warn" : "muted"}
        />
      </div>

      {/* 状态元信息 */}
      <p className="mb-1 mt-4 text-xs font-semibold text-muted-foreground">
        判定元信息
      </p>
      <div className="rounded-md border px-3 py-2">
        <Kv
          k="PIT"
          v={pit.label}
          tone={vm.pitStatus === "PASS" ? "ok" : "warn"}
        />
        <Kv
          k="DATA_READY"
          v={vm.dataReadyStatus}
          tone={
            vm.dataReadyStatus === "PASS"
              ? "ok"
              : vm.dataReadyStatus === "FAIL"
                ? "warn"
                : "muted"
          }
        />
        <Kv
          k="Dataset Version"
          v={vm.datasetVersion || "—"}
          mono
          tone="muted"
        />
        {durationMs !== null && (
          <Kv
            k="构建耗时"
            v={`${durationMs} ms（前端计时）`}
            mono
            tone="muted"
          />
        )}
      </div>

      {vm.reason && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">原因：</span>
          <Badge variant="outline" className="font-mono text-[11px]">
            {vm.reason}
          </Badge>
        </div>
      )}
    </SectionCard>
  );
}
