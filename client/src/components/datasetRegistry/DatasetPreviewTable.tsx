/**
 * DatasetPreviewTable — Dataset Registry 明细预览（Event / Prefix / Post / Path / Outcome）。
 *
 * 纪律：
 * - **keyset 分页**：cursor 不透明、原样回传；默认 limit=50，可选 20/50/100，最大 100；
 * - **禁止 OFFSET / 一次加载全部**：明细行绝不进浏览器全量；
 * - **版本切换清残留**：table / versionId / limit 任一变化即 RESET 游标栈 → 回到第 1 页；
 * - 五路 tRPC 查询共享同一输入、按 `enabled` 只触发当前 table（保持 hooks 无条件调用）。
 *
 * 表分层（事件窗口五表）：event（身份）/ prefix（原始 rd ≤ 0）/ post（原始 rd ≥ 1）/
 * path（衍生 rd ≥ 1）/ outcome（按 horizon 聚合）。
 */

import { trpc } from "@/lib/trpc";
import { useEffect, useMemo, useReducer, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, EmptyState, ErrorState } from "@/components/common";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  TableProperties,
} from "lucide-react";
import { rpcErrorToDiagnostic } from "@/adapters/datasetRegistryAdapter";
import {
  initialPreviewStack,
  reducePreviewStack,
  selectPreviewState,
  type PreviewTable,
} from "@/lib/datasetPreviewState";
import {
  DATASET_PAGE_LIMIT_DEFAULT,
  type DatasetEventItem,
  type DatasetOutcomeItem,
  type DatasetPathItem,
  type DatasetRawBarItem,
} from "@shared/datasetRegistryContracts";

/** 预览页大小可选集（UI 选择，后端硬上限 DATASET_PAGE_LIMIT_MAX=200，此处最大 100）。 */
const PREVIEW_LIMIT_OPTIONS = [20, 50, 100] as const;

const TABLE_LABELS: Record<PreviewTable, string> = {
  event: "Event",
  prefix: "Prefix",
  post: "Post",
  path: "Path",
  outcome: "Outcome",
};

function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function bool(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v ? "Y" : "N";
}

/** 相对日展示：prefix 含 0 与负值（D0 / D-1…），post/path 为 D+n。 */
function relDay(relativeDay: number): string {
  if (relativeDay === 0) return "D0";
  return relativeDay > 0 ? `D+${relativeDay}` : `D${relativeDay}`;
}

export function DatasetPreviewTable({
  table,
  versionId,
}: {
  table: PreviewTable;
  versionId: number;
}) {
  const [limit, setLimit] = useState<number>(DATASET_PAGE_LIMIT_DEFAULT);
  const [stack, dispatch] = useReducer(
    reducePreviewStack,
    undefined,
    initialPreviewStack,
  );

  // table / version / limit 变化 → 回第 1 页（防旧版本数据残留）。
  useEffect(() => {
    dispatch({ type: "RESET" });
  }, [table, versionId, limit]);

  const cursor = selectPreviewState(stack, null).cursor;
  const input = useMemo(
    () => ({
      datasetVersionId: versionId,
      limit,
      ...(cursor ? { cursor } : {}),
    }),
    [versionId, limit, cursor],
  );

  const events = trpc.datasetRegistry.listEvents.useQuery(input, {
    enabled: table === "event",
  });
  const prefixes = trpc.datasetRegistry.listPrefix.useQuery(input, {
    enabled: table === "prefix",
  });
  const posts = trpc.datasetRegistry.listPost.useQuery(input, {
    enabled: table === "post",
  });
  const paths = trpc.datasetRegistry.listPaths.useQuery(input, {
    enabled: table === "path",
  });
  const outcomes = trpc.datasetRegistry.listOutcomes.useQuery(input, {
    enabled: table === "outcome",
  });

  const active =
    table === "event"
      ? events
      : table === "prefix"
        ? prefixes
        : table === "post"
          ? posts
          : table === "path"
            ? paths
            : outcomes;
  const { data, isLoading, isError, error, refetch, isFetching } = active;

  const sel = selectPreviewState(stack, data?.nextCursor ?? null);

  function handleNext() {
    if (data?.nextCursor) dispatch({ type: "NEXT", nextCursor: data.nextCursor });
  }
  function handlePrev() {
    dispatch({ type: "PREV" });
  }

  const renderRows = () => {
    if (table === "event") {
      const items = data?.items as DatasetEventItem[] | undefined;
      return (
        <>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">eventId</TableHead>
              <TableHead className="text-xs">symbol</TableHead>
              <TableHead className="text-xs">tradeDate</TableHead>
              <TableHead className="text-right text-xs">prevClose</TableHead>
              <TableHead className="text-right text-xs">limitUpPrice</TableHead>
              <TableHead className="text-right text-xs">turnover</TableHead>
              <TableHead className="text-xs">firstLimit</TableHead>
              <TableHead className="text-xs">prevLimitDate</TableHead>
              <TableHead className="text-right text-xs">histCount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(items ?? []).map((e) => (
              <TableRow key={e.eventId}>
                <TableCell className="font-mono text-[11px]">{e.eventId}</TableCell>
                <TableCell className="font-mono text-xs">{e.symbol}</TableCell>
                <TableCell className="font-mono text-xs">{e.tradeDate}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(e.previousClose)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(e.limitUpPrice)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(e.turnover)}</TableCell>
                <TableCell className="text-xs">{bool(e.isFirstLimit)}</TableCell>
                <TableCell className="font-mono text-[11px]">{e.previousLimitDate ?? "—"}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(e.historicalLimitCount, 0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </>
      );
    }

    if (table === "prefix" || table === "post") {
      const items = data?.items as DatasetRawBarItem[] | undefined;
      return (
        <>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">eventId</TableHead>
              <TableHead className="text-xs">symbol</TableHead>
              <TableHead className="text-xs">tradeDate</TableHead>
              <TableHead className="text-right text-xs">day</TableHead>
              <TableHead className="text-right text-xs">open</TableHead>
              <TableHead className="text-right text-xs">high</TableHead>
              <TableHead className="text-right text-xs">low</TableHead>
              <TableHead className="text-right text-xs">close</TableHead>
              <TableHead className="text-right text-xs">volume</TableHead>
              <TableHead className="text-right text-xs">amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(items ?? []).map((b) => (
              <TableRow key={`${b.eventId}-${b.relativeDay}`}>
                <TableCell className="font-mono text-[11px]">{b.eventId}</TableCell>
                <TableCell className="font-mono text-xs">{b.symbol}</TableCell>
                <TableCell className="font-mono text-xs">{b.tradeDate}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{relDay(b.relativeDay)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(b.open)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(b.high)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(b.low)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(b.close)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(b.volume, 0)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(b.amount, 0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </>
      );
    }

    if (table === "path") {
      const items = data?.items as DatasetPathItem[] | undefined;
      return (
        <>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">eventId</TableHead>
              <TableHead className="text-xs">symbol</TableHead>
              <TableHead className="text-xs">tradeDate</TableHead>
              <TableHead className="text-right text-xs">day</TableHead>
              <TableHead className="text-right text-xs">close/close0</TableHead>
              <TableHead className="text-right text-xs">high/close0</TableHead>
              <TableHead className="text-right text-xs">low/close0</TableHead>
              <TableHead className="text-right text-xs">low/high0</TableHead>
              <TableHead className="text-right text-xs">volRatio</TableHead>
              <TableHead className="text-xs">breakout</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(items ?? []).map((p) => (
              <TableRow key={`${p.eventId}-${p.relativeDay}`}>
                <TableCell className="font-mono text-[11px]">{p.eventId}</TableCell>
                <TableCell className="font-mono text-xs">{p.symbol}</TableCell>
                <TableCell className="font-mono text-xs">{p.tradeDate}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{relDay(p.relativeDay)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(p.closeFromEventClose)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(p.highFromEventClose)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(p.lowFromEventClose)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(p.pullbackFromEventHigh)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{num(p.volumeRatio)}</TableCell>
                <TableCell className="text-xs">{bool(p.isBreakout)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </>
      );
    }

    const items = data?.items as DatasetOutcomeItem[] | undefined;
    return (
      <>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">eventId</TableHead>
            <TableHead className="text-right text-xs">horizon</TableHead>
            <TableHead className="text-right text-xs">maxReturn</TableHead>
            <TableHead className="text-right text-xs">minReturn</TableHead>
            <TableHead className="text-right text-xs">maxDrawdown</TableHead>
            <TableHead className="text-xs">breakout</TableHead>
            <TableHead className="text-right text-xs">daysToBreakout</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(items ?? []).map((o) => (
            <TableRow key={`${o.eventId}-${o.horizon}`}>
              <TableCell className="font-mono text-[11px]">{o.eventId}</TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">{o.horizon}</TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">{num(o.maxReturn)}</TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">{num(o.minReturn)}</TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">{num(o.maxDrawdown)}</TableCell>
              <TableCell className="text-xs">{bool(o.isBreakout)}</TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">{num(o.daysToBreakout, 0)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </>
    );
  };

  const tableLabel = TABLE_LABELS[table];

  return (
    <div className="space-y-3">
      {/* 控制条 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">每页</span>
          {PREVIEW_LIMIT_OPTIONS.map((opt) => (
            <Button
              key={opt}
              size="sm"
              variant={limit === opt ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setLimit(opt)}
            >
              {opt}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={!sel.canGoPrev}
            onClick={handlePrev}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> 上一页
          </Button>
          <span className="px-1 font-mono text-xs text-muted-foreground">
            第 {sel.pageIndex} 页
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={!sel.canGoNext}
            onClick={handleNext}
          >
            下一页 <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => void refetch()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* 状态 */}
      {isLoading && (
        <div className="space-y-2 rounded-md border p-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}

      {isError && !isLoading && (
        <ErrorState
          error={rpcErrorToDiagnostic(error?.message ?? "未知错误", {
            title: `${tableLabel} 预览加载失败`,
          })}
        />
      )}

      {!isLoading && !isError && data && data.items.length === 0 && (
        <EmptyState
          icon={TableProperties}
          title={`暂无 ${tableLabel} 数据`}
          description="该版本在此过滤条件下没有可展示的明细行。"
        />
      )}

      {!isLoading && !isError && data && data.items.length > 0 && (
        <DataTable maxHeight={420}>{renderRows()}</DataTable>
      )}
    </div>
  );
}
