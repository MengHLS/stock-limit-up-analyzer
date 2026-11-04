/**
 * STOCK-SELECTION-001/002/003 —— 「选股」页面（只读）。
 *
 * 产品定位（用户任务）：**某个决策日该买哪几只** —— 首选问题，不是数据库 CRUD。
 *
 * 设计要点（方案 A）：
 *   - **主表单 = 策略 + 数据来源 + 决策日 + TopN**；「数据集版本」只在选择 `dataset`
 *     载体（研究口径）时出现 ⇒ 日常选股不再被数据集捆住；
 *   - 数据来源（载体）清单来自 `stockSelection.listDataSources`，**默认 live**（当日行情）；
 *   - **一个页面兼容多策略**：策略清单来自 `stockSelection.listStrategies`；数据集版本清单
 *     来自 `datasetRegistry.listVersions({datasetId})`（datasetId 由策略元数据给出，页面不硬编码）；
 *   - **坐标诚实**：结果只展示后端返回的事实（数据来源 / datasetVersionId / 决策日 / 数据窗口 /
 *     候选数），页面**不重算任何选股语义**；
 *   - **空态与失败分开**：「当日无候选事件」是如实空态；缺 rd0 / 日历缺洞 / 非交易日 / 载体未注册
 *     是**错误**，显示错误码与原因，绝不伪装成「今天没有机会」。
 */

import { useEffect, useMemo, useState } from "react";
import {
  CalendarSearch,
  CandlestickChart,
  ChevronDown,
  ChevronRight,
  History,
  Info,
  ListChecks,
  Save,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  StockKlineDialog,
  type StockKlineTradeTarget,
} from "@/components/strategy/StockKlineDialog";
import { EmptyState, PageHeader, SectionCard, StatusBadge } from "@/components/common";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import {
  buildKlineTargetForExcludedStock,
  buildKlineTargetForPick,
  pickCodeForDisplay,
  pickNameForDisplay,
} from "@/lib/stockSelectionPicks";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type SelectionOutput = inferRouterOutputs<AppRouter>["stockSelection"]["select"];
type SourceKind = "live" | "dataset";

/** 剔除原因码 → 中文（与后端 `strategies/**` 登记的计数键一一对应）。 */
const EXCLUSION_LABELS: Record<string, string> = {
  EVENT_DATE_NOT_IN_CALENDAR: "事件日不在日历",
  EVENT_DAY_BAR_INVALID: "首板日行情无效",
  ONE_WORD_OR_T_BOARD: "一字板 / T 字板",
  OBSERVATION_WINDOW_INCOMPLETE: "观察窗不完整（缺 T+1..T+5 行情）",
  NO_PULLBACK_IN_OBSERVATION_WINDOW: "观察窗内无回踩",
  MAX_AMPLITUDE_ABOVE_LIMIT: "最大振幅超上限",
  FACTORS_UNAVAILABLE: "三因子不可计算（如 T+1 量比无基准）",
};

const SOURCE_HINTS: Record<SourceKind, string> = {
  live: "当日原始行情（不依赖数据集版本）",
  dataset: "数据集快照（研究 / 回放口径，需选版本）",
};

function formatScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(4);
}

function formatPercentile(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

type RunSummary = inferRouterOutputs<AppRouter>["stockSelection"]["listRuns"][number];

/**
 * 历史选股记录一行（A 形态：同页列表 + 展开明细）。
 *
 * 剔除统计来自**已保存的快照**（`run.excluded`），不是重算 —— 回看的就是当时的口径；
 * 展开才拉 picks 明细（列表不拉大对象）。
 */
function SelectionRunRow({ run }: { run: RunSummary }) {
  const [expanded, setExpanded] = useState(false);
  const detailQuery = trpc.stockSelection.getRun.useQuery(
    { runId: run.runId },
    { enabled: expanded },
  );
  const detail = detailQuery.data ?? null;
  const exclusions = Object.entries(run.excluded);

  return (
    <div className="rounded-md border p-3">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 size-4 shrink-0" />
        ) : (
          <ChevronRight className="mt-0.5 size-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="font-mono">{run.decisionDate}</span>
            <span>{run.strategyLabel}</span>
            <StatusBadge status="SKIPPED" label={run.sourceKind} />
            <span className="font-mono text-xs text-muted-foreground">{run.runId}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {`载体 ${run.sourceLabel}`}
            {run.datasetVersionId !== null ? ` · datasetVersionId #${run.datasetVersionId}` : ""}
            {` · 候选 ${run.candidateEventCount} · 合格 ${run.rankedCandidateCount} · 入选 ${run.pickCount} · Top ${run.topN}`}
            {run.dataWindow !== null
              ? ` · 事件窗 ${run.dataWindow.startDate} ~ ${run.dataWindow.endDate}`
              : ""}
            {` · 保存于 ${new Date(run.capturedAt).toLocaleString()}`}
          </div>
        </div>
      </button>

      <div className="mt-2 flex flex-wrap gap-2">
        {exclusions.length === 0 ? (
          <span className="text-xs text-muted-foreground">剔除统计：本次无硬过滤剔除。</span>
        ) : (
          exclusions.map(([reason, count]) => (
            <StatusBadge
              key={reason}
              status="SKIPPED"
              label={`${EXCLUSION_LABELS[reason] ?? reason}：${count}`}
            />
          ))
        )}
      </div>

      {expanded && (
        <div className="mt-3 border-t pt-3">
          {detailQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">加载明细…</p>
          ) : detail === null ? (
            <p className="text-xs text-muted-foreground">明细不存在。</p>
          ) : detail.picks.length === 0 ? (
            <p className="text-xs text-muted-foreground">该决策日无入选标的（剔除统计见上）。</p>
          ) : (
            <PicksTable picks={detail.picks} />
          )}
          <div className="mt-3 border-t pt-3">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              剔除统计（为什么没选上 · 含被剔除的票）
            </div>
            <ExcludedStocksTable excluded={run.excluded} excludedStocks={run.excludedStocks} />
          </div>
        </div>
      )}
    </div>
  );
}

type PickRow = inferRouterOutputs<AppRouter>["stockSelection"]["select"]["picks"][number];

/**
 * 选股清单表格（**当前结果**与**历史明细**共用）。
 *
 * 名称：`pick` 只带 canonical 身份 + 代码 ⇒ 名称单独走既有的 `researchRun.securityLabels`
 * （「证券名称 + 代码」字典端点），**取不到就显示「—」，不编造**。
 * K 线：点「K线」开 **交易详情同款弹窗**（复用 `StockKlineDialog`，不新写图表组件）；
 * 窗口以「事件日 T0」为中心（该策略的观察窗就在 T0 ~ T0+6）。
 */
function PicksTable({ picks }: { picks: readonly PickRow[] }) {
  const [trade, setTrade] = useState<StockKlineTradeTarget | null>(null);
  const [klineOpen, setKlineOpen] = useState(false);

  const securityIds = useMemo(
    () => [...new Set(picks.map((pick) => pick.canonicalSecurityId).filter((id) => id !== ""))],
    [picks],
  );
  const labelsQuery = trpc.researchRun.securityLabels.useQuery(
    { securityIds },
    { enabled: securityIds.length > 0, staleTime: 5 * 60_000, retry: false },
  );
  const labels = labelsQuery.data ?? {};

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">名次</TableHead>
            <TableHead>名称</TableHead>
            <TableHead>代码</TableHead>
            <TableHead>事件日 T0</TableHead>
            <TableHead>信号日（决策日）</TableHead>
            <TableHead>计划买入（次一交易日开盘）</TableHead>
            <TableHead className="text-right">分数</TableHead>
            <TableHead className="text-right">横截面分位</TableHead>
            <TableHead className="w-24 text-right">K 线</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {picks.map((pick) => {
            const label = labels[pick.canonicalSecurityId];
            const klineTarget = buildKlineTargetForPick(pick, label);
            return (
              <TableRow key={pick.panelSecurityId}>
                <TableCell className="font-mono">{pick.rank}</TableCell>
                <TableCell>{pickNameForDisplay(label)}</TableCell>
                <TableCell className="font-mono">{pickCodeForDisplay(pick, label)}</TableCell>
                <TableCell className="font-mono">{pick.eventDate || "—"}</TableCell>
                <TableCell className="font-mono">{pick.signalDate}</TableCell>
                <TableCell className="font-mono">{pick.entryDate ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">{formatScore(pick.score)}</TableCell>
                <TableCell className="text-right font-mono">
                  {formatPercentile(pick.rankPercentile)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={klineTarget === null}
                    onClick={() => {
                      if (klineTarget === null) return;
                      setTrade(klineTarget);
                      setKlineOpen(true);
                    }}
                  >
                    <CandlestickChart />
                    K 线
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <StockKlineDialog trade={trade} open={klineOpen} onOpenChange={setKlineOpen} />
    </>
  );
}

type ExcludedStockRow =
  inferRouterOutputs<AppRouter>["stockSelection"]["select"]["filterStats"]["excludedStocks"][number];

/**
 * 剔除明细（**被剔除的票**，不只是条数）：**与选股清单同款表格**，表内只多一列「剔除原因」。
 *
 * 名称走既有 `researchRun.securityLabels`（与 picks 同源）；取不到 ⇒ `—`。
 * 历史记录若保存于「只存计数」的旧版本，会如实显示「无逐只明细」，不编造。
 */
function ExcludedStocksTable({
  excluded,
  excludedStocks,
}: {
  excluded: Readonly<Record<string, number>>;
  excludedStocks: readonly ExcludedStockRow[];
}) {
  const [trade, setTrade] = useState<StockKlineTradeTarget | null>(null);
  const [klineOpen, setKlineOpen] = useState(false);

  const securityIds = useMemo(
    () => [...new Set(excludedStocks.map((stock) => stock.canonicalSecurityId).filter((id) => id !== ""))],
    [excludedStocks],
  );
  const labelsQuery = trpc.researchRun.securityLabels.useQuery(
    { securityIds },
    { enabled: securityIds.length > 0, staleTime: 5 * 60_000, retry: false },
  );
  const labels = labelsQuery.data ?? {};
  const total = Object.values(excluded).reduce((sum, count) => sum + count, 0);

  if (total === 0 && excludedStocks.length === 0) {
    return <p className="text-sm text-muted-foreground">本次没有发生硬过滤剔除。</p>;
  }

  const rows = excludedStocks
    .slice()
    .sort(
      (left, right) =>
        left.reason.localeCompare(right.reason) || (left.code ?? "").localeCompare(right.code ?? ""),
    );

  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">
        {`共 ${total} 只被剔除`}
        {rows.length === 0 ? "（该记录保存时只含计数，无逐只明细）" : ""}
      </p>
      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>代码</TableHead>
              <TableHead>事件日 T0</TableHead>
              <TableHead>剔除原因</TableHead>
              <TableHead className="w-24 text-right">K 线</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((stock) => {
              const label = labels[stock.canonicalSecurityId];
              const klineTarget = buildKlineTargetForExcludedStock(stock, label);
              return (
                <TableRow key={`${stock.canonicalSecurityId}-${stock.eventId}-${stock.eventDate}`}>
                  <TableCell>{pickNameForDisplay(label)}</TableCell>
                  <TableCell className="font-mono">
                    {stock.code ?? label?.code ?? stock.canonicalSecurityId}
                  </TableCell>
                  <TableCell className="font-mono">{stock.eventDate || "—"}</TableCell>
                  <TableCell>{EXCLUSION_LABELS[stock.reason] ?? stock.reason}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={klineTarget === null}
                      onClick={() => {
                        if (klineTarget === null) return;
                        setTrade(klineTarget);
                        setKlineOpen(true);
                      }}
                    >
                      <CandlestickChart />
                      K 线
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <StockKlineDialog trade={trade} open={klineOpen} onOpenChange={setKlineOpen} />
    </>
  );
}

/** 本地日期（YYYY-MM-DD）。 */
function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE");
}

export default function StockSelection() {
  const strategiesQuery = trpc.stockSelection.listStrategies.useQuery();
  const sourcesQuery = trpc.stockSelection.listDataSources.useQuery();
  const strategies = strategiesQuery.data ?? [];
  const sources = sourcesQuery.data ?? [];

  const utils = trpc.useUtils();
  const runsQuery = trpc.stockSelection.listRuns.useQuery({ limit: 20 });
  const saveRun = trpc.stockSelection.saveRun.useMutation({
    onSuccess: (saved) => {
      toast.success(`已保存选股结果 ${saved.runId}（含剔除统计）`);
      void utils.stockSelection.listRuns.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const [strategyId, setStrategyId] = useState<string>("");
  const [sourceKind, setSourceKind] = useState<SourceKind | "">("");
  const [datasetVersionId, setDatasetVersionId] = useState<number | null>(null);
  const [decisionDate, setDecisionDate] = useState<string>("");
  const [topN, setTopN] = useState<number>(3);
  const [committed, setCommitted] = useState<{
    strategyId: string;
    sourceKind: SourceKind;
    datasetVersionId: number | null;
    decisionDate: string;
    topN: number;
  } | null>(null);

  const selectedStrategy = useMemo(
    () => strategies.find((item) => item.id === strategyId) ?? null,
    [strategies, strategyId],
  );

  // 默认：首个策略 / 首选载体（live 优先）/ 今天。
  useEffect(() => {
    if (strategyId === "" && strategies.length > 0) setStrategyId(strategies[0]!.id);
  }, [strategies, strategyId]);

  useEffect(() => {
    if (sourceKind !== "" || sources.length === 0) return;
    const preferred = sources.find((item) => item.kind === "live") ?? sources[0]!;
    setSourceKind(preferred.kind);
  }, [sources, sourceKind]);

  useEffect(() => {
    if (decisionDate === "") setDecisionDate(todayIso());
  }, [decisionDate]);

  const needsDatasetVersion = sourceKind === "dataset";
  const versionsQuery = trpc.datasetRegistry.listVersions.useQuery(
    { datasetId: selectedStrategy?.datasetId ?? 0 },
    { enabled: selectedStrategy !== null && needsDatasetVersion },
  );
  const versions = useMemo(
    () => (versionsQuery.data ?? []).slice().sort((a, b) => b.id - a.id),
    [versionsQuery.data],
  );

  useEffect(() => {
    if (!needsDatasetVersion || datasetVersionId !== null || versions.length === 0) return;
    const ready = versions.find((item) => item.status === "READY") ?? versions[0]!;
    setDatasetVersionId(ready.id as number);
  }, [needsDatasetVersion, versions, datasetVersionId]);

  const selectedVersion = useMemo(
    () => versions.find((item) => item.id === datasetVersionId) ?? null,
    [versions, datasetVersionId],
  );

  const canQuery =
    strategyId !== "" &&
    sourceKind !== "" &&
    /^\d{4}-\d{2}-\d{2}$/.test(decisionDate) &&
    topN >= 1 &&
    (!needsDatasetVersion || datasetVersionId !== null);

  const selectionQuery = trpc.stockSelection.select.useQuery(
    {
      strategyId: committed?.strategyId ?? "",
      decisionDate: committed?.decisionDate ?? "",
      topN: committed?.topN ?? 3,
      source:
        committed === null
          ? undefined
          : committed.sourceKind === "dataset"
            ? { kind: "dataset" as const, datasetVersionId: committed.datasetVersionId ?? 0 }
            : { kind: "live" as const },
    },
    { enabled: committed !== null },
  );

  const selection: SelectionOutput | undefined = selectionQuery.data;
  const errorMessage =
    selectionQuery.error !== null && selectionQuery.error !== undefined
      ? selectionQuery.error.message
      : null;

  const decisionsAfterCoverage =
    needsDatasetVersion &&
    selectedVersion?.endDate !== null &&
    selectedVersion?.endDate !== undefined &&
    decisionDate !== "" &&
    decisionDate > selectedVersion.endDate;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        icon={ListChecks}
        title="选股"
        description="按策略 + 决策日输出当日候选清单（默认走当日行情；只读，不下单、不改策略）"
      />

      <SectionCard title="查询条件" icon={CalendarSearch}>
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="ss-strategy">策略</Label>
            <select
              id="ss-strategy"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={strategyId}
              onChange={(event) => {
                setStrategyId(event.target.value);
                setDatasetVersionId(null);
                setCommitted(null);
              }}
              disabled={strategiesQuery.isLoading || strategies.length === 0}
            >
              {strategies.length === 0 && <option value="">（无已注册策略）</option>}
              {strategies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            {selectedStrategy !== null && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {selectedStrategy.description}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ss-source">数据来源</Label>
            <select
              id="ss-source"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={sourceKind}
              onChange={(event) => {
                const next = event.target.value as SourceKind | "";
                setSourceKind(next);
                setDatasetVersionId(null);
                setCommitted(null);
              }}
              disabled={sourcesQuery.isLoading || sources.length === 0}
            >
              {sources.length === 0 && <option value="">（无可用来源）</option>}
              {sources.map((item) => (
                <option key={item.kind} value={item.kind}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {sourceKind === "" ? "选择数据来源" : SOURCE_HINTS[sourceKind]}
            </p>
          </div>

          {needsDatasetVersion && (
            <div className="space-y-1.5">
              <Label htmlFor="ss-version">数据集版本（研究口径）</Label>
              <select
                id="ss-version"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={datasetVersionId === null ? "" : String(datasetVersionId)}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setDatasetVersionId(Number.isFinite(next) && next > 0 ? next : null);
                  setCommitted(null);
                }}
                disabled={versions.length === 0}
              >
                {versions.length === 0 && <option value="">（无可用版本）</option>}
                {versions.map((item) => (
                  <option key={String(item.id)} value={String(item.id)}>
                    {`#${item.id} · ${item.version} · ${item.status}${item.startDate ? ` · ${item.startDate}~${item.endDate ?? "?"}` : ""}`}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {datasetVersionId === null ? "选择数据集版本" : `datasetVersionId = ${datasetVersionId}（真实坐标）`}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ss-date">决策日（收盘后）</Label>
            <Input
              id="ss-date"
              type="date"
              value={decisionDate}
              onChange={(event) => {
                setDecisionDate(event.target.value);
                setCommitted(null);
              }}
            />
            {decisionsAfterCoverage && (
              <p className="text-xs text-amber-600">
                该决策日晚于数据集覆盖末端（{selectedVersion?.endDate}）⇒ 不会有数据。
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ss-topn">每日最多选几只</Label>
            <Input
              id="ss-topn"
              type="number"
              min={1}
              max={50}
              value={topN}
              onChange={(event) => {
                const next = Number(event.target.value);
                setTopN(Number.isFinite(next) ? Math.min(50, Math.max(1, Math.trunc(next))) : 3);
                setCommitted(null);
              }}
            />
            <Button
              className="w-full"
              disabled={!canQuery || selectionQuery.isFetching}
              onClick={() => {
                if (!canQuery) return;
                setCommitted({ strategyId, sourceKind, datasetVersionId, decisionDate, topN });
              }}
            >
              {selectionQuery.isFetching ? "选股中…" : "开始选股"}
            </Button>
          </div>
        </div>
      </SectionCard>

      {(strategiesQuery.isError || sourcesQuery.isError) && (
        <SectionCard title="配置读取失败" icon={TriangleAlert}>
          <p className="text-sm text-destructive">
            {strategiesQuery.error?.message ?? sourcesQuery.error?.message}
          </p>
        </SectionCard>
      )}

      {errorMessage !== null && (
        <SectionCard title="选股失败（如实报错，不伪装成空结果）" icon={TriangleAlert}>
          <p className="font-mono text-sm text-destructive">{errorMessage}</p>
        </SectionCard>
      )}

      {selection !== undefined && (
        <>
          <SectionCard title="本次事实" icon={Info}>
            <div className="grid gap-3 text-sm md:grid-cols-3 lg:grid-cols-6">
              <div>
                <div className="text-xs text-muted-foreground">策略</div>
                <div className="mt-0.5">{selection.strategyLabel}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">数据来源（载体）</div>
                <div className="mt-0.5">
                  {selection.source.label}
                  {selection.datasetVersionId !== null && (
                    <span className="ml-1 font-mono text-xs text-muted-foreground">
                      #{selection.datasetVersionId}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">决策日</div>
                <div className="mt-0.5 font-mono">{selection.decisionDate}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">数据窗口（事件窗）</div>
                <div className="mt-0.5 font-mono">
                  {selection.dataWindow === null
                    ? "—"
                    : `${selection.dataWindow.startDate} ~ ${selection.dataWindow.endDate}`}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">候选事件数</div>
                <div className="mt-0.5 font-mono">{selection.filterStats.candidateEventCount}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">合格候选数（进入排序）</div>
                <div className="mt-0.5 font-mono">{selection.filterStats.rankedCandidateCount}</div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title={`选股清单（Top ${selection.topN}）`}
            right={
              <div className="flex items-center gap-2">
                <StatusBadge
                  status={selection.picks.length > 0 ? "PASS" : "EMPTY"}
                  label={`${selection.picks.length} 只`}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saveRun.isPending || committed === null}
                  onClick={() => {
                    if (committed === null) return;
                    saveRun.mutate({
                      strategyId: committed.strategyId,
                      decisionDate: committed.decisionDate,
                      topN: committed.topN,
                      source:
                        committed.sourceKind === "dataset"
                          ? { kind: "dataset", datasetVersionId: committed.datasetVersionId ?? 0 }
                          : { kind: "live" },
                    });
                  }}
                >
                  <Save />
                  {saveRun.isPending ? "保存中…" : "保存选股结果"}
                </Button>
              </div>
            }
          >
            {selection.picks.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title="该决策日无入选标的"
                description={
                  selection.filterStats.candidateEventCount === 0
                    ? "当日没有「观察第 5 个交易日 = 该决策日」的首板事件（即没有事件在这一天做决策）。"
                    : "当日有候选事件，但没有任何一只通过硬过滤（见下方剔除统计）。"
                }
              />
            ) : (
              <PicksTable picks={selection.picks} />
            )}
          </SectionCard>

          <SectionCard title="剔除统计（为什么没选上 · 含被剔除的票）" icon={ListChecks}>
            <ExcludedStocksTable
              excluded={selection.filterStats.excluded}
              excludedStocks={selection.filterStats.excludedStocks}
            />
          </SectionCard>
        </>
      )}

      <SectionCard
        title="历史选股记录（含剔除统计）"
        icon={History}
        right={
          <div className="flex items-center gap-2">
            <StatusBadge status="SKIPPED" label={`${runsQuery.data?.length ?? 0} 条`} />
            <Button
              size="sm"
              variant="ghost"
              disabled={runsQuery.isFetching}
              onClick={() => void runsQuery.refetch()}
            >
              刷新
            </Button>
          </div>
        }
      >
        {runsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">加载历史记录…</p>
        ) : runsQuery.isError ? (
          <p className="text-sm text-destructive">历史记录读取失败：{runsQuery.error.message}</p>
        ) : (runsQuery.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            还没有保存过选股结果。在上方完成选股后点「保存选股结果」，这里会留下当时的清单与剔除统计。
          </p>
        ) : (
          <div className="space-y-2">
            {(runsQuery.data ?? []).map((run) => (
              <SelectionRunRow key={run.runId} run={run} />
            ))}
          </div>
        )}
      </SectionCard>

      {committed === null && errorMessage === null && (
        <EmptyState
          icon={CalendarSearch}
          title="选择策略、数据来源与决策日，然后点「开始选股」"
          description="默认走当日行情（不依赖数据集版本）；如需研究口径可切换为数据集快照。结果只使用该决策日及之前的数据。"
        />
      )}
    </div>
  );
}
