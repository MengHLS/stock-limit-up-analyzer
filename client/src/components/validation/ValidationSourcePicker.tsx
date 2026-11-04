/**
 * 验证来源选择器（PD-04 / `docs/product/FE-PLAN-001-PD04-validation-input-source.md` D1/D3）。
 *
 * 解决：稳健性 / OOS 的 `sourceSearchRunId` 过去靠**手填字符串** ⇒ 用户必须去别处抄 ID，
 * 且无法确认该 Run 的 `datasetVersionId` / 参数集 / 冻结时间，与「可复现」冲突。
 *
 * 数据源：`paramSearch.listSearches`（**已存在**，零后端契约变更）。
 * 🔴 只把 **COMPLETED** 的搜索 Run 放进选项（契约要求源须已完成；提前置灰优于提交后报错）。
 * 🔴 本组件只做只读展示与选择，不重算任何指标。
 */

import { Link } from "wouter";
import { CheckCircle2, Loader2, SlidersHorizontal } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ErrorState, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ValidationSourcePickerProps {
  /** 选中的 `searchRunId`；空串 = 未选择。 */
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** 该验证域的一句话说明（显示在选择器上方）。 */
  readonly hint?: string;
  readonly id?: string;
  readonly className?: string;
}

const SELECT_CLASS = "h-8 w-full rounded-md border bg-background px-2 text-xs";

export function ValidationSourcePicker({
  value,
  onChange,
  hint,
  id = "validation-source-search-run",
  className,
}: ValidationSourcePickerProps) {
  const query = trpc.paramSearch.listSearches.useQuery({ limit: 50 });
  const allRuns = query.data ?? [];
  const completed = allRuns.filter((run) => run.status === "COMPLETED");
  const selected = completed.find((run) => run.searchRunId === value) ?? null;

  if (query.isLoading) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        正在读取参数搜索 Run 列表…
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        className={className}
        error={{
          code: "PARAM_SEARCH_RUN_LIST_FAILED",
          title: "参数搜索 Run 列表加载失败",
          explanation: query.error.message,
          suggestions: ["确认后端可用后重试", "若持续失败，先到「参数搜索」页确认该端点是否正常"],
        }}
      />
    );
  }

  if (completed.length === 0) {
    return (
      <div
        data-validation-source-empty="true"
        className={cn("rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs", className)}
      >
        <p className="font-medium text-foreground">暂无已完成的参数搜索 Run</p>
        <p className="mt-1 text-muted-foreground">
          请先到「参数搜索」跑一次搜索（状态需为 <span className="font-mono">COMPLETED</span>），再回来创建本验证。
        </p>
        <Button asChild size="sm" variant="outline" className="mt-2 gap-1.5">
          <Link href="/parameter-search">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            前往参数搜索
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">源 Parameter Search Run（仅列出已完成）</span>
        <select
          id={id}
          className={SELECT_CLASS}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">— 请选择 —</option>
          {completed.map((run) => (
            <option key={run.searchRunId} value={run.searchRunId}>
              {run.searchRunId} · {run.strategyId}@{run.strategyVersion} · {run.completedCount}/{run.combinationCount} 组合
            </option>
          ))}
        </select>
      </label>

      {selected !== null && (
        <div
          data-validation-source-card="true"
          className="rounded-md border border-border bg-muted/20 p-2.5 text-[11px] leading-5 text-muted-foreground"
        >
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            来源已选定
            <StatusBadge status={selected.status} />
          </p>
          <p>
            数据集版本：
            <span className="font-mono">id={selected.datasetVersionId ?? "—"}</span>
            {selected.datasetVersionLabel !== null && <span>（{selected.datasetVersionLabel}）</span>}
            <span className="ml-2">
              窗口 {selected.startDate} → {selected.endDate}
            </span>
          </p>
          <p>
            组合 {selected.completedCount}/{selected.combinationCount}
            <span className="ml-2">冻结于 {selected.completedAt ?? selected.createdAt}</span>
          </p>
        </div>
      )}
    </div>
  );
}