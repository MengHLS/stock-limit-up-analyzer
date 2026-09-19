/**
 * PARAMETER-001 §16 — Parameter Search 前端 MVP（**持久化搜索**面板）。
 *
 * ## 为什么是独立组件而不是改页面主体
 *
 * `client/src/pages/ParameterSearch.tsx` 是 FE-6 的**技术预览**页（内存态 search / rolling /
 * robustness / stochastic，结果跑完即弃）。PARAMETER-001 的持久化搜索是**同一域**的第二段能力，
 * 但交互形态完全不同（创建 → 执行 → 回看 → 重试）。⇒ 收进独立组件挂在同页顶部，
 * 避免把两套交互揉成一段难维护的 JSX。
 *
 * ## 前端纪律（本仓既有）
 *
 * - **只读渲染 + 只提交入参**：页面不计算任何指标、不拼曲线；数值一律来自 `paramSearch.*` 端点；
 * - 🔴 **默认值归后端**：能不提交的字段一律不提交（`datasetVersionId` 留空 ⇒ 由策略文档绑定派生）；
 * - 🔴 **长请求按钮必须换文案**：`startSearch` 每组合一次完整闭环回测（实测每个组合秒级~分钟级），
 *   pending 时按钮文案必须变化并给出量级，否则用户会以为「点了没反应」；
 * - 🔴 **诚实空态**：无数据 / 指标不可用 / 失败原因全部原样展示，不编造样例；
 * - 🔴 **不产出「最佳参数」结论**：默认排序 = 组合序号（不是收益降序），排序能力交给用户显式选择。
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowUpDown,
  ExternalLink,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  DataTable,
  EmptyState,
  MetricCard,
  SectionCard,
  StatusBadge,
} from "@/components/common";
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
import { trpc } from "@/lib/trpc";

// ---------------------------------------------------------------------------
// 类型（契约唯一来源 = shared/parameterSearchContracts.ts）
// ---------------------------------------------------------------------------

type SortField =
  | "combinationIndex"
  | "totalReturnPct"
  | "annualizedReturnPct"
  | "maxDrawdownPct"
  | "tradeCount"
  | "winRatePct"
  | "profitFactor";

type DomainMode = "ENUM" | "INTEGER_RANGE" | "DECIMAL_RANGE" | "FIXED";

interface OverrideRow {
  readonly id: string;
  readonly name: string;
  readonly mode: DomainMode;
  readonly valuesText: string;
  readonly min: string;
  readonly max: string;
  readonly step: string;
  readonly fixedValue: string;
}

let overrideSeq = 0;
function newOverrideRow(): OverrideRow {
  overrideSeq += 1;
  return {
    id: `ov-${String(overrideSeq)}`,
    name: "",
    mode: "INTEGER_RANGE",
    valuesText: "",
    min: "",
    max: "",
    step: "",
    fixedValue: "",
  };
}

/** 文本 → 参数值（数字优先；空串 / 非数字按字符串处理）。 */
function parseValue(raw: string): number | string | boolean | null {
  const text = raw.trim();
  if (text === "") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  const num = Number(text);
  return Number.isFinite(num) && text !== "" ? num : text;
}

function buildDomain(row: OverrideRow): unknown {
  switch (row.mode) {
    case "ENUM":
      return { mode: "ENUM", values: row.valuesText.split(",").map(parseValue) };
    case "INTEGER_RANGE":
      return {
        mode: "INTEGER_RANGE",
        min: Number(row.min),
        max: Number(row.max),
        step: Number(row.step),
      };
    case "DECIMAL_RANGE":
      return {
        mode: "DECIMAL_RANGE",
        min: Number(row.min),
        max: Number(row.max),
        step: Number(row.step),
      };
    case "FIXED":
      return { mode: "FIXED", value: parseValue(row.fixedValue) };
  }
}

// ---------------------------------------------------------------------------
// 格式化
// ---------------------------------------------------------------------------

function fmtPct(value: number | null, digits = 2): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(digits)}%`;
}

function fmtNum(value: number | null, digits = 2): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(digits);
}

function fmtInt(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 收益 / 回撤的中式配色：涨红跌绿（A 股惯例）。 */
function pnlClass(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  return value >= 0 ? "text-red-600" : "text-emerald-700";
}

const SORT_FIELDS: Array<{ key: SortField; label: string }> = [
  { key: "combinationIndex", label: "组合序号" },
  { key: "totalReturnPct", label: "总收益" },
  { key: "annualizedReturnPct", label: "年化" },
  { key: "maxDrawdownPct", label: "最大回撤" },
  { key: "tradeCount", label: "成交笔数" },
  { key: "winRatePct", label: "胜率" },
  { key: "profitFactor", label: "盈亏比" },
];

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------

export default function PersistedParameterSearchPanel() {
  const [strategyId, setStrategyId] = useState("");
  const [strategyVersion, setStrategyVersion] = useState("");
  const [datasetVersionId, setDatasetVersionId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortField>("combinationIndex");
  const [sortDirection, setSortDirection] = useState<"ASC" | "DESC">("ASC");
  const [statusFilter, setStatusFilter] = useState<"" | "SUCCEEDED" | "FAILED">("");
  const [minTradeCount, setMinTradeCount] = useState("");
  const [maxDrawdownPct, setMaxDrawdownPct] = useState("");
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [noticeText, setNoticeText] = useState<string | null>(null);

  const listQuery = trpc.paramSearch.listSearches.useQuery(
    { limit: 20 },
    { retry: false, refetchOnWindowFocus: false },
  );
  const detailQuery = trpc.paramSearch.getSearch.useQuery(
    { searchRunId: selectedRunId ?? "" },
    { enabled: selectedRunId !== null, retry: false, refetchOnWindowFocus: false },
  );
  const resultsQuery = trpc.paramSearch.getSearchResults.useQuery(
    {
      searchRunId: selectedRunId ?? "",
      sortBy,
      sortDirection,
      ...(statusFilter === "" ? {} : { status: statusFilter }),
      ...(minTradeCount.trim() === "" ? {} : { minTradeCount: Number(minTradeCount) }),
      ...(maxDrawdownPct.trim() === "" ? {} : { maxDrawdownPct: Number(maxDrawdownPct) }),
    },
    { enabled: selectedRunId !== null, retry: false, refetchOnWindowFocus: false },
  );
  const createMutation = trpc.paramSearch.createSearch.useMutation();
  const startMutation = trpc.paramSearch.startSearch.useMutation();
  const cancelMutation = trpc.paramSearch.cancelSearch.useMutation();
  const retryMutation = trpc.paramSearch.retrySearchCombination.useMutation();

  const runs = listQuery.data ?? [];
  const detail = detailQuery.data ?? null;
  const page = resultsQuery.data ?? null;

  const validOverrides = useMemo(
    () =>
      overrides
        .filter((row) => row.name.trim() !== "")
        .map((row) => ({ name: row.name.trim(), domain: buildDomain(row) })),
    [overrides],
  );

  const refreshAll = async (): Promise<void> => {
    await listQuery.refetch();
    if (selectedRunId !== null) {
      await detailQuery.refetch();
      await resultsQuery.refetch();
    }
  };

  const onCreate = async (): Promise<void> => {
    setErrorText(null);
    setNoticeText(null);
    if (strategyId.trim() === "" || strategyVersion.trim() === "") {
      setErrorText("请先填写策略 ID 与版本（如 cand-360001 / 1.0.0）。");
      return;
    }
    if (startDate === "" || endDate === "") {
      setErrorText("请填写回测窗口（起止日期），窗口必须落在策略绑定数据集窗口内。");
      return;
    }
    try {
      const created = await createMutation.mutateAsync({
        strategyId: strategyId.trim(),
        strategyVersion: strategyVersion.trim(),
        ...(datasetVersionId.trim() === ""
          ? {}
          : { datasetVersionId: Number(datasetVersionId.trim()) }),
        startDate,
        endDate,
        searchMethod: "GRID_SEARCH",
        ...(validOverrides.length === 0
          ? {}
          : { parameterSearchSpace: validOverrides as never }),
      });
      setSelectedRunId(created.run.searchRunId);
      setNoticeText(
        `已创建 ${created.run.searchRunId}：计划 ${String(created.run.combinationCount)} 个组合；`
          + `可搜索参数 ${created.summary.searchable.join(" / ") || "（无）"}。`
          + `点击「开始执行」才会真正跑回测。`,
      );
      await listQuery.refetch();
    } catch (error) {
      setErrorText(messageOf(error));
    }
  };

  const onStart = async (): Promise<void> => {
    if (selectedRunId === null) return;
    setErrorText(null);
    setNoticeText(null);
    try {
      const outcome = await startMutation.mutateAsync({ searchRunId: selectedRunId });
      setNoticeText(
        `执行完成：状态 ${outcome.run.status}；本次评估 ${String(outcome.evaluatedCount)} 个组合`
          + `（跳过 ${String(outcome.skippedCount)} / cache 复用 ${String(outcome.reusedFromCacheCount)}）；`
          + `成功 ${String(outcome.run.completedCount)} / 失败 ${String(outcome.run.failedCount)}。`
          + (outcome.notes.length > 0 ? ` 说明：${outcome.notes.slice(-3).join("；")}` : ""),
      );
      await refreshAll();
    } catch (error) {
      setErrorText(messageOf(error));
    }
  };

  const onCancel = async (): Promise<void> => {
    if (selectedRunId === null) return;
    setErrorText(null);
    try {
      await cancelMutation.mutateAsync({ searchRunId: selectedRunId });
      setNoticeText("已取消；剩余组合保留为 PENDING，再次「开始执行」即从断点续跑。");
      await refreshAll();
    } catch (error) {
      setErrorText(messageOf(error));
    }
  };

  const onRetry = async (parameterHash: string, status: string): Promise<void> => {
    if (selectedRunId === null) return;
    setErrorText(null);
    try {
      const outcome = await retryMutation.mutateAsync({
        searchRunId: selectedRunId,
        parameterHash,
        ...(status === "SUCCEEDED" ? { force: true } : {}),
      });
      setNoticeText(
        `重试完成：评估 ${String(outcome.evaluatedCount)} 个组合；状态 ${outcome.run.status}。`,
      );
      await refreshAll();
    } catch (error) {
      setErrorText(messageOf(error));
    }
  };

  const toggleSort = (field: SortField): void => {
    if (sortBy === field) {
      setSortDirection(sortDirection === "ASC" ? "DESC" : "ASC");
      return;
    }
    setSortBy(field);
    // 数值型指标默认降序（更常用）——但这**不是**「择优」结论，只是排序默认值
    setSortDirection(field === "combinationIndex" || field === "maxDrawdownPct" ? "ASC" : "DESC");
  };

  const startPending = startMutation.isPending;

  return (
    <SectionCard
      title="参数搜索（持久化）· PARAMETER-001"
      description="创建 → 组合计划 → 真实回测 → 评估 → 结果留档；支持续跑 / 重试 / 缓存复用。本面板只做数据与排序，不产出「最佳参数」结论。"
      icon={Search}
      right={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void listQuery.refetch();
          }}
          disabled={listQuery.isFetching}
        >
          {listQuery.isFetching ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />}
          刷新列表
        </Button>
      }
    >
      <div className="space-y-4">
        {errorText !== null && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {errorText}
          </div>
        )}
        {noticeText !== null && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            {noticeText}
          </div>
        )}

        {/* ---------------- 创建 Search ---------------- */}
        <div className="rounded-md border border-border p-3">
          <p className="mb-2 text-sm font-medium">创建 Search</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">策略 ID</span>
              <Input
                id="ps-strategy-id"
                value={strategyId}
                onChange={(event) => setStrategyId(event.target.value)}
                placeholder="如 cand-360001"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">策略版本</span>
              <Input
                id="ps-strategy-version"
                value={strategyVersion}
                onChange={(event) => setStrategyVersion(event.target.value)}
                placeholder="如 1.0.0"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">数据集版本 ID（留空 = 用策略绑定）</span>
              <Input
                id="ps-dataset-version-id"
                value={datasetVersionId}
                onChange={(event) => setDatasetVersionId(event.target.value)}
                placeholder="如 390002"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">回测窗口起（含）</span>
              <Input
                id="ps-start-date"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">回测窗口止（含）</span>
              <Input
                id="ps-end-date"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">搜索方法</span>
              <select
                id="ps-search-method"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value="GRID_SEARCH"
                onChange={() => undefined}
              >
                <option value="GRID_SEARCH">GRID_SEARCH（全组合枚举）</option>
                <option value="RANDOM_SEARCH" disabled>
                  RANDOM_SEARCH（已登记，未实现）
                </option>
                <option value="BAYESIAN" disabled>
                  BAYESIAN（已登记，未实现）
                </option>
                <option value="TPE" disabled>
                  TPE（已登记，未实现）
                </option>
              </select>
            </label>
          </div>

          {/* Parameter Space 编辑 */}
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium">
                参数空间覆盖（留空则由策略文档派生，只取 <code>parameterRole = TUNABLE</code>）
              </p>
              <Button
                variant="outline"
                size="sm"
                id="ps-add-override"
                onClick={() => setOverrides([...overrides, newOverrideRow()])}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                添加参数
              </Button>
            </div>
            {overrides.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                未覆盖任何参数：系统按策略文档派生（FIXED 不进搜索空间、DERIVED 不得直接搜索）。
              </p>
            ) : (
              <div className="space-y-2">
                {overrides.map((row) => (
                  <div key={row.id} className="grid grid-cols-1 gap-2 rounded border border-border p-2 md:grid-cols-6">
                    <Input
                      className="md:col-span-1"
                      value={row.name}
                      placeholder="参数名（须存在于策略 Schema）"
                      onChange={(event) =>
                        setOverrides(
                          overrides.map((item) =>
                            item.id === row.id ? { ...item, name: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <select
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={row.mode}
                      onChange={(event) =>
                        setOverrides(
                          overrides.map((item) =>
                            item.id === row.id
                              ? { ...item, mode: event.target.value as DomainMode }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="INTEGER_RANGE">整数区间 min/max/step</option>
                      <option value="DECIMAL_RANGE">小数区间 min/max/step</option>
                      <option value="ENUM">枚举 values（逗号分隔）</option>
                      <option value="FIXED">固定值</option>
                    </select>
                    {row.mode === "ENUM" ? (
                      <Input
                        className="md:col-span-3"
                        value={row.valuesText}
                        placeholder="如 1,2,3 或 a,b"
                        onChange={(event) =>
                          setOverrides(
                            overrides.map((item) =>
                              item.id === row.id ? { ...item, valuesText: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    ) : row.mode === "FIXED" ? (
                      <Input
                        className="md:col-span-3"
                        value={row.fixedValue}
                        placeholder="固定取值"
                        onChange={(event) =>
                          setOverrides(
                            overrides.map((item) =>
                              item.id === row.id ? { ...item, fixedValue: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    ) : (
                      <div className="md:col-span-3 grid grid-cols-3 gap-2">
                        {(["min", "max", "step"] as const).map((key) => (
                          <Input
                            key={key}
                            value={row[key]}
                            placeholder={key}
                            onChange={(event) =>
                              setOverrides(
                                overrides.map((item) =>
                                  item.id === row.id ? { ...item, [key]: event.target.value } : item,
                                ),
                              )
                            }
                          />
                        ))}
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOverrides(overrides.filter((item) => item.id !== row.id))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button id="ps-create-search" onClick={() => void onCreate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  正在创建搜索（需读策略版本 + 生成组合，约 1~3 秒）…
                </>
              ) : (
                <>
                  <Plus className="mr-1.5 h-4 w-4" />
                  创建 Search
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              创建只落「运行 + 组合计划」，不跑回测；执行需显式点「开始执行」。
            </span>
          </div>
        </div>

        {/* ---------------- 搜索列表 ---------------- */}
        <div className="rounded-md border border-border p-3">
          <p className="mb-2 text-sm font-medium">搜索列表（最近 20 条）</p>
          {listQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : runs.length === 0 ? (
            <EmptyState
              icon={Search}
              title="还没有搜索记录"
              description="填写上方表单创建第一条；创建后这里会立刻出现。"
              className="py-6"
            />
          ) : (
            <DataTable maxHeight={220}>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">searchRunId</TableHead>
                  <TableHead className="text-xs">策略版本</TableHead>
                  <TableHead className="text-xs">数据集</TableHead>
                  <TableHead className="text-xs">窗口</TableHead>
                  <TableHead className="text-xs">状态</TableHead>
                  <TableHead className="text-xs">组合（成功/失败）</TableHead>
                  <TableHead className="text-xs">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.searchRunId}>
                    <TableCell className="font-mono text-xs">{run.searchRunId}</TableCell>
                    <TableCell className="text-xs">
                      {run.strategyId}@{run.strategyVersion}
                    </TableCell>
                    <TableCell className="text-xs">
                      {run.datasetVersionId === null ? "（无绑定）" : `#${String(run.datasetVersionId)} ${run.datasetVersionLabel ?? ""}`}
                    </TableCell>
                    <TableCell className="text-xs">
                      {run.startDate} ~ {run.endDate}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} label={run.status} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {run.combinationCount}（{run.completedCount}/{run.failedCount}）
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedRunId(run.searchRunId);
                          setExpandedHash(null);
                        }}
                      >
                        查看详情
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DataTable>
          )}
        </div>

        {/* ---------------- Search Detail ---------------- */}
        {selectedRunId !== null && (
          <div className="rounded-md border border-border p-3" id="ps-search-detail">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                搜索详情 <span className="font-mono text-xs text-muted-foreground">{selectedRunId}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  id="ps-start-search"
                  size="sm"
                  onClick={() => void onStart()}
                  disabled={startPending}
                >
                  {startPending ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      正在执行真实回测…（每个组合一次完整闭环回测，通常秒级、长窗口可达分钟级）
                    </>
                  ) : (
                    <>
                      <Play className="mr-1.5 h-4 w-4" />
                      开始执行 / 续跑
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  id="ps-cancel-search"
                  onClick={() => void onCancel()}
                  disabled={cancelMutation.isPending}
                >
                  <XCircle className="mr-1.5 h-4 w-4" />
                  取消
                </Button>
                <Link
                  className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                  href={`/strategies/${encodeURIComponent(detail?.run.strategyId ?? "")}/${encodeURIComponent(detail?.run.strategyVersion ?? "")}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  查看策略版本
                </Link>
              </div>
            </div>

            {detailQuery.isLoading || detail === null ? (
              <p className="text-xs text-muted-foreground">加载中…</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <MetricCard label="状态" value={<StatusBadge status={detail.run.status} label={detail.run.status} />} mono={false} />
                  <MetricCard label="计划组合" value={String(detail.progress.combinationCount)} />
                  <MetricCard label="已完成（成功）" value={String(detail.progress.completedCount)} />
                  <MetricCard
                    label="失败"
                    value={String(detail.progress.failedCount)}
                    hint={`未终结 ${String(detail.progress.pendingCount)}`}
                  />
                </div>

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>进度</span>
                    <span>{detail.progress.progressPct}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${Math.min(100, Math.max(0, detail.progress.progressPct))}%` }}
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                  <div className="rounded border border-border p-2">
                    <p className="mb-1 font-medium">FIXED 坐标（搜索过程中不变）</p>
                    <ul className="space-y-0.5 text-muted-foreground">
                      <li>策略版本：{detail.run.strategyId}@{detail.run.strategyVersion}</li>
                      <li>
                        数据集坐标：{detail.run.datasetVersionId === null ? "（无绑定）" : `#${String(detail.run.datasetVersionId)}`}
                        {detail.run.datasetVersionLabel === null ? "" : `（${detail.run.datasetVersionLabel}）`}
                      </li>
                      <li>回测窗口：{detail.run.startDate} ~ {detail.run.endDate}</li>
                      <li>执行政策版本：v{String(detail.run.executionPolicyVersion)}</li>
                      <li className="break-all">评估配置指纹：{detail.run.evaluationConfigFingerprint.slice(0, 16)}…</li>
                      <li className="break-all">参数空间指纹：{detail.run.parameterSpaceFingerprint.slice(0, 16)}…</li>
                    </ul>
                  </div>
                  <div className="rounded border border-border p-2">
                    <p className="mb-1 font-medium">参数空间快照（写入即冻结）</p>
                    <ul className="space-y-0.5 text-muted-foreground">
                      {detail.run.parameterSpace.parameters.map((item) => (
                        <li key={item.name}>
                          <span className="font-mono">{item.name}</span> · {item.kind} ·{" "}
                          {item.search === undefined
                            ? `不进搜索空间（${item.exclusionReason ?? "—"}）`
                            : JSON.stringify(item.search)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {(detail.run.notes ?? []).length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      运行说明（{String((detail.run.notes ?? []).length)} 条）
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {(detail.run.notes ?? []).slice(-20).map((note, index) => (
                        <li key={`${String(index)}-${note.slice(0, 12)}`}>· {note}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {detail.run.errorMessage !== null && (
                  <p className="mt-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                    {detail.run.errorCode ?? "ERROR"}：{detail.run.errorMessage}
                  </p>
                )}

                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium">组合计划（{detail.combinations.length} 个）</p>
                  <DataTable maxHeight={240}>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">#</TableHead>
                        <TableHead className="text-xs">参数</TableHead>
                        <TableHead className="text-xs">parameterHash</TableHead>
                        <TableHead className="text-xs">状态</TableHead>
                        <TableHead className="text-xs">尝试</TableHead>
                        <TableHead className="text-xs">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.combinations.map((combination) => (
                        <TableRow key={combination.parameterHash}>
                          <TableCell className="text-xs">{combination.combinationIndex}</TableCell>
                          <TableCell className="font-mono text-xs">{JSON.stringify(combination.parameters)}</TableCell>
                          <TableCell className="font-mono text-xs">{combination.parameterHash.slice(0, 12)}…</TableCell>
                          <TableCell>
                            <StatusBadge status={combination.status} label={combination.status} />
                          </TableCell>
                          <TableCell className="text-xs">{combination.attemptCount}</TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void onRetry(combination.parameterHash, combination.status)
                              }
                              disabled={retryMutation.isPending}
                            >
                              {retryMutation.isPending ? "重试中…" : "重试该组合"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                </div>
              </>
            )}
          </div>
        )}

        {/* ---------------- Results ---------------- */}
        {selectedRunId !== null && (
          <div className="rounded-md border border-border p-3" id="ps-search-results">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">搜索结果（{page?.total ?? 0} 行）</p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1">
                  <span className="text-muted-foreground">状态</span>
                  <select
                    id="ps-filter-status"
                    className="h-8 rounded-md border border-input bg-background px-2"
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as "" | "SUCCEEDED" | "FAILED")
                    }
                  >
                    <option value="">全部</option>
                    <option value="SUCCEEDED">SUCCEEDED</option>
                    <option value="FAILED">FAILED</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-muted-foreground">成交笔数 ≥</span>
                  <Input
                    id="ps-filter-trade-count"
                    className="h-8 w-20"
                    value={minTradeCount}
                    onChange={(event) => setMinTradeCount(event.target.value)}
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-muted-foreground">最大回撤 ≤</span>
                  <Input
                    id="ps-filter-max-dd"
                    className="h-8 w-20"
                    value={maxDrawdownPct}
                    onChange={(event) => setMaxDrawdownPct(event.target.value)}
                  />
                </label>
              </div>
            </div>

            {page === null || page.total === 0 ? (
              <EmptyState
                icon={ArrowUpDown}
                title="还没有结果"
                description="先点「开始执行 / 续跑」跑完组合；结果行才会出现在这里。"
                className="py-6"
              />
            ) : (
              <>
                {page.truncated && (
                  <p className="mb-1 text-xs text-amber-700">
                    结果被截断：共 {page.total} 行，本次只返回 {page.returned} 行。
                  </p>
                )}
                <DataTable maxHeight={360}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">参数</TableHead>
                      <TableHead className="text-xs">状态</TableHead>
                      {SORT_FIELDS.filter((field) => field.key !== "combinationIndex").map((field) => (
                        <TableHead key={field.key} className="text-xs">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={() => toggleSort(field.key)}
                          >
                            {field.label}
                            <ArrowUpDown className="h-3 w-3 opacity-60" />
                            {sortBy === field.key ? (sortDirection === "ASC" ? "↑" : "↓") : ""}
                          </button>
                        </TableHead>
                      ))}
                      <TableHead className="text-xs">追溯</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {page.results.map((result) => (
                      <>
                        <TableRow key={result.parameterHash}>
                          <TableCell className="font-mono text-xs">
                            {JSON.stringify(result.parameters)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={result.status} label={result.status} />
                          </TableCell>
                          <TableCell className={`font-mono text-xs tabular-nums ${pnlClass(result.metrics.totalReturnPct)}`}>
                            {fmtPct(result.metrics.totalReturnPct)}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {fmtPct(result.metrics.annualizedReturnPct)}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums text-emerald-700">
                            {fmtPct(result.metrics.maxDrawdownPct)}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {fmtInt(result.metrics.tradeCount)}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {fmtPct(result.metrics.winRatePct)}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {fmtNum(result.metrics.profitFactor)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setExpandedHash(
                                  expandedHash === result.parameterHash ? null : result.parameterHash,
                                )
                              }
                            >
                              {expandedHash === result.parameterHash ? "收起" : "查看组合"}
                            </Button>
                          </TableCell>
                        </TableRow>
                        {expandedHash === result.parameterHash && (
                          <TableRow key={`${result.parameterHash}-detail`}>
                            <TableCell colSpan={9} className="bg-muted/30">
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                <div className="rounded border border-border bg-background p-2 text-xs">
                                  <p className="mb-1 font-medium">组合</p>
                                  <ul className="space-y-0.5 text-muted-foreground">
                                    <li className="break-all">parameterHash：{result.parameterHash}</li>
                                    <li>组合序号：{result.combinationIndex}</li>
                                    <li>指标来源：{result.metricsSource}</li>
                                    <li>
                                      年化基数：
                                      {result.annualizationBasis === null
                                        ? "（未提供）"
                                        : `${result.annualizationBasis.type} / ${String(result.annualizationBasis.daysPerYear)} 交易日`}
                                    </li>
                                    {result.error !== null && (
                                      <li className="text-destructive">失败原因：{result.error}</li>
                                    )}
                                  </ul>
                                </div>
                                <div className="rounded border border-border bg-background p-2 text-xs">
                                  <p className="mb-1 font-medium">Backtest 追溯</p>
                                  <ul className="space-y-0.5 text-muted-foreground">
                                    <li className="break-all">
                                      撮合指纹：{result.backtestFingerprint ?? "—"}
                                    </li>
                                    <li>
                                      落库回测 run id：
                                      {result.backtestRunId ?? "—（本阶段评估端口不落 closed_loop_backtest_run 行，如实为空）"}
                                    </li>
                                  </ul>
                                </div>
                                <div className="rounded border border-border bg-background p-2 text-xs">
                                  <p className="mb-1 font-medium">Evaluation 追溯</p>
                                  <ul className="space-y-0.5 text-muted-foreground">
                                    <li className="break-all">evaluationId：{result.evaluationId ?? "—"}</li>
                                    <li className="break-all">闭环 runId：{result.evaluationRunId ?? "—"}</li>
                                    <li>落档时间：{result.createdAt}</li>
                                  </ul>
                                </div>
                              </div>
                              <details className="mt-2">
                                <summary className="cursor-pointer text-xs text-muted-foreground">
                                  查看评估产物（canonical metrics 原始面 + 指纹）
                                </summary>
                                <pre className="mt-1 max-h-64 overflow-auto rounded bg-background p-2 text-[11px] leading-tight">
                                  {JSON.stringify(result.evaluation, null, 2)}
                                </pre>
                              </details>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    ))}
                  </TableBody>
                </DataTable>
              </>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
