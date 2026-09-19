/**
 * ROBUSTNESS-001 §16/§17/§18 — 稳健性分析前端 MVP。
 *
 * ## 这个面板回答什么问题
 *
 * > 「某个参数组合的**邻近取值**是否还在相近水平？还是只是一个孤立尖峰？」
 *
 * 它**消费已经算完的** Parameter Search 结果（不重跑回测、不重算指标），输出：
 * 稳定性比例 / 稳定邻居数 / 有效邻居数 / 六指标邻域离散度 / 逐参数敏感性 /
 * 二维稳定性矩阵。
 *
 * ## 前端纪律（本仓既有）
 *
 * - 🔴 **不产出「最佳 / 最优 / 推荐」**：默认排序 = 组合序号；排序能力交给用户显式选择；
 *   本文件**不得**出现上述结论性词汇（由 `tests/.../wording.test.ts` 源码扫描钉住）；
 * - 🔴 **默认值归后端**：口径字段留空即不提交（后端按平台缺省补齐并**持久化到 Run**）；
 * - 🔴 **长请求按钮必须换文案**：`创建分析` 会读源网格（可能上百组合）+ `启动分析` 会遍历全部组合，
 *   pending 时文案必须变化；
 * - 🔴 **诚实空态 / 诚实不可用**：`MISSING`（源 Search 缺该组合）与 `AMBIGUOUS`（>2 个可变参数）
 *   原样展示，**绝不补值**；指标不可用显示「—」而不是 0；
 * - 🔴 **矩阵不为「好坏」上色**（规格 §18）：只用**状态文字 + 数值**，缺格用虚线边框；
 * - 🔴 **深链可达**：选中 Run 写进 URL（`?robRunId=`），刷新 / 分享后仍能回到同一份详情。
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  AlertTriangle,
  ExternalLink,
  Grid3x3,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Table2,
} from "lucide-react";
import { DataTable, EmptyState, MetricCard, SectionCard, StatusBadge } from "@/components/common";
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
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// 展示层小工具（不参与任何量化判定）
// ---------------------------------------------------------------------------

/** 数值 → 定长字符串；`null` 一律「—」（**不可用 ≠ 0**）。 */
function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

/** 参数值 → 文本（`null` 显示为 `null` 而不是空串）。 */
function valueText(value: number | string | boolean | null): string {
  if (value === null) return "null";
  return String(value);
}

/** 参数组合 → 紧凑文本。 */
function parametersText(parameters: Readonly<Record<string, number | string | boolean | null>>): string {
  return Object.keys(parameters)
    .sort()
    .map((key) => `${key}=${valueText(parameters[key] ?? null)}`)
    .join(" · ");
}

/** 状态中文标签（**文本优先**；颜色只是辅助）。 */
const STATUS_LABEL: Readonly<Record<string, string>> = {
  STABLE: "稳定",
  UNSTABLE: "不稳定",
  INSUFFICIENT_TRADING_ACTIVITY: "成交活动不足",
  INSUFFICIENT_NEIGHBORHOOD: "邻域证据不足",
  SOURCE_RESULT_UNAVAILABLE: "源结果不可用",
  MISSING: "源 Search 无此组合",
  AMBIGUOUS: "多组合命中",
};

/** 参数引用状态提示（规格 §12：未验证必须显性提示，不得沉默）。 */
function ReferenceWarning({ run }: { run: { summary: { parameterReferenceUnverified: boolean; parameterReferenceNote: string } } }) {
  if (!run.summary.parameterReferenceUnverified) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>
        <p className="font-medium">参数引用未验证（ROBUSTNESS_PARAMETER_REFERENCE_UNVERIFIED）</p>
        <p className="mt-1 whitespace-pre-wrap">{run.summary.parameterReferenceNote}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 主面板
// ---------------------------------------------------------------------------

export default function SearchRobustnessPanel() {
  const search = useSearch();
  const [, setLocation] = useLocation();

  /** URL 深链中的选中 Run（刷新 / 分享后仍能回到同一份详情）。 */
  const linkedRunId = useMemo(() => {
    const raw = new URLSearchParams(search).get("robRunId");
    return raw === null || raw === "" ? null : raw;
  }, [search]);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(linkedRunId);
  useEffect(() => {
    if (linkedRunId !== null) setSelectedRunId(linkedRunId);
  }, [linkedRunId]);

  const [sourceSearchRunId, setSourceSearchRunId] = useState("");
  const [returnTolerancePct, setReturnTolerancePct] = useState("");
  const [drawdownTolerancePct, setDrawdownTolerancePct] = useState("");
  const [neighborDistance, setNeighborDistance] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("combinationIndex");
  const [sortDirection, setSortDirection] = useState<"ASC" | "DESC">("ASC");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandHash, setExpandHash] = useState<string | null>(null);

  const runs = trpc.paramSearch.listRobustnessRuns.useQuery({ limit: 50 });
  const detail = trpc.paramSearch.getRobustnessRun.useQuery(
    { robustnessRunId: selectedRunId ?? "" },
    { enabled: selectedRunId !== null },
  );
  const results = trpc.paramSearch.getRobustnessResults.useQuery(
    {
      robustnessRunId: selectedRunId ?? "",
      sortBy: sortBy as never,
      sortDirection,
      ...(statusFilter === "" ? {} : { status: statusFilter as never }),
    },
    { enabled: selectedRunId !== null },
  );

  const createMutation = trpc.paramSearch.createRobustnessRun.useMutation();
  const startMutation = trpc.paramSearch.startRobustnessRun.useMutation();

  /** 选中并写进 URL（深链；刷新后仍回到同一 run）。 */
  function selectRun(runId: string | null): void {
    setSelectedRunId(runId);
    setExpandHash(null);
    if (runId === null) setLocation("/parameter-search");
    else setLocation(`/parameter-search?robRunId=${encodeURIComponent(runId)}`);
  }

  async function handleCreate(): Promise<void> {
    setMessage(null);
    setErrorText(null);
    try {
      const created = await createMutation.mutateAsync({
        sourceSearchRunId: sourceSearchRunId.trim(),
        // 🔴 默认值归后端：留空的字段**不提交**（由后端按平台缺省补齐并持久化到 Run）。
        ...(returnTolerancePct.trim() === "" && drawdownTolerancePct.trim() === "" && neighborDistance.trim() === ""
          ? {}
          : {
              analysisConfig: {
                ...(returnTolerancePct.trim() === "" ? {} : { returnTolerancePct: Number(returnTolerancePct) }),
                ...(drawdownTolerancePct.trim() === "" ? {} : { drawdownTolerancePct: Number(drawdownTolerancePct) }),
                ...(neighborDistance.trim() === "" ? {} : { neighborDistance: Number(neighborDistance) }),
              },
            }),
      });
      await runs.refetch();
      selectRun(created.run.robustnessRunId);
      setMessage(
        `已创建分析 ${created.run.robustnessRunId}（状态 CREATED）。`
          + `点击「启动分析」才会真正计算；口径已持久化到该 Run。`,
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleStart(runId: string): Promise<void> {
    setMessage(null);
    setErrorText(null);
    try {
      const outcome = await startMutation.mutateAsync({ robustnessRunId: runId });
      await Promise.all([runs.refetch(), detail.refetch(), results.refetch()]);
      setMessage(
        `分析完成：${String(outcome.resultCount)} 条组合结果、${String(outcome.parameterCount)} 条参数分析。`
          + `数值全部来自源 Parameter Search 结果，本次未重跑回测、未重算指标。`,
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  const selectedRun = detail.data?.run ?? null;

  return (
    <SectionCard
      title="稳健性分析（消费已完成的参数搜索结果）· ROBUSTNESS-001"
      description="在**冻结快照**上判断「邻近取值是否还在相近水平」：稳定性比例 / 敏感性 / 邻域离散度 / 二维稳定性矩阵。不重跑回测、不重算指标；本面板只呈现事实与描述性排序。"
      icon={ShieldCheck}
      right={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void runs.refetch();
            if (selectedRunId !== null) {
              void detail.refetch();
              void results.refetch();
            }
          }}
          disabled={runs.isFetching}
        >
          {runs.isFetching ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-4 w-4" />
          )}
          刷新
        </Button>
      }
    >
      <div className="space-y-4">
        {errorText !== null && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {errorText}
          </div>
        )}
        {message !== null && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            {message}
          </div>
        )}

        {/* ---------------- 创建 ---------------- */}
        <div className="rounded-md border border-border p-3">
          <p className="mb-2 text-sm font-medium">① 选一个已完成的 Parameter Search Run</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <label className="text-xs md:col-span-2">
              <span className="mb-1 block text-muted-foreground">源 Search Run ID（须为 COMPLETED 且结果全为 canonical）</span>
              <Input
                id="rob-source-search-run-id"
                value={sourceSearchRunId}
                onChange={(event) => setSourceSearchRunId(event.target.value)}
                placeholder="如 PSRUN-20260919-XXXXXXXX"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">收益容差（百分点，留空 = 平台缺省 5）</span>
              <Input
                id="rob-return-tolerance"
                value={returnTolerancePct}
                onChange={(event) => setReturnTolerancePct(event.target.value)}
                placeholder="留空"
                inputMode="decimal"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">回撤容差（百分点，留空 = 平台缺省 5）</span>
              <Input
                id="rob-drawdown-tolerance"
                value={drawdownTolerancePct}
                onChange={(event) => setDrawdownTolerancePct(event.target.value)}
                placeholder="留空"
                inputMode="decimal"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">邻域半径（步数，留空 = 1）</span>
              <Input
                id="rob-neighbor-distance"
                value={neighborDistance}
                onChange={(event) => setNeighborDistance(event.target.value)}
                placeholder="留空"
                inputMode="numeric"
              />
            </label>
            <div className="flex items-end md:col-span-3">
              <Button
                id="rob-create-button"
                size="sm"
                onClick={() => void handleCreate()}
                disabled={createMutation.isPending || sourceSearchRunId.trim() === ""}
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    正在读取源搜索网格并冻结快照…（组合多时需数秒）
                  </>
                ) : (
                  <>
                    <Layers className="mr-1.5 h-4 w-4" />
                    创建稳健性分析
                  </>
                )}
              </Button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            口径会被**持久化到该 Run**（不写死前端、不随数据变化）；创建只做校验与冻结，不计算。
          </p>
        </div>

        {/* ---------------- 列表 ---------------- */}
        <div>
          <p className="mb-2 text-sm font-medium">② 分析列表</p>
          {runs.isLoading ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : (runs.data ?? []).length === 0 ? (
            <EmptyState icon={ShieldCheck} title="还没有稳健性分析" description="上方填入一个已完成的 Search Run ID 后创建。" />
          ) : (
            <DataTable maxHeight={240}>
              <TableHeader>
                <TableRow>
                  <TableHead>Robustness Run</TableHead>
                  <TableHead>源 Search Run</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">稳定</TableHead>
                  <TableHead className="text-right">不稳定</TableHead>
                  <TableHead className="text-right">结论不可用</TableHead>
                  <TableHead>参数引用</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runs.data ?? []).map((row) => (
                  <TableRow key={row.robustnessRunId} id={`rob-row-${row.robustnessRunId}`}>
                    <TableCell className="font-mono text-xs">{row.robustnessRunId}</TableCell>
                    <TableCell className="font-mono text-xs">{row.sourceSearchRunId}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{row.summary.stableCount}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{row.summary.unstableCount}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {row.summary.insufficientTradingActivityCount
                        + row.summary.insufficientNeighborhoodCount
                        + row.summary.sourceResultUnavailableCount}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.sourceReferenceCheckApplied === true ? "已验证" : "未验证"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => selectRun(row.robustnessRunId)}>
                        查看详情
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DataTable>
          )}
        </div>

        {/* ---------------- 详情 ---------------- */}
        {selectedRunId !== null && (
          <div className="space-y-4 rounded-md border border-border p-3" id="rob-detail-section">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  ③ 分析详情 · <span className="font-mono">{selectedRunId}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  源 Search Run：<span className="font-mono">{selectedRun?.sourceSearchRunId ?? "…"}</span>
                  {selectedRun !== null && (
                    <>
                      {" "}· 策略 <span className="font-mono">{selectedRun.strategyId}@{selectedRun.strategyVersion}</span>
                      {" "}· 窗口 {selectedRun.startDate}..{selectedRun.endDate}
                      {" "}· 数据集版本 {selectedRun.datasetVersionId === null ? "—" : String(selectedRun.datasetVersionId)}
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                  href={`/research?searchRunId=${encodeURIComponent(selectedRun?.sourceSearchRunId ?? "")}`}
                >
                  <ExternalLink className="h-3 w-3" />
                  回到源搜索（参数搜索页）
                </a>
                <Button
                  id="rob-start-button"
                  size="sm"
                  onClick={() => selectedRunId !== null && void handleStart(selectedRunId)}
                  disabled={startMutation.isPending || detail.isLoading}
                >
                  {startMutation.isPending ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      正在读取源结果并计算邻域稳定性…（不重跑回测）
                    </>
                  ) : (
                    <>
                      <Play className="mr-1.5 h-4 w-4" />
                      {selectedRun?.status === "COMPLETED" ? "重新分析（确定性重算）" : "启动分析"}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {detail.isLoading && <p className="text-xs text-muted-foreground">加载中…</p>}
            {detail.error !== null && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                {detail.error.message}
              </div>
            )}

            {selectedRun !== null && (
              <>
                <ReferenceWarning run={selectedRun} />

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <MetricCard label="状态" value={<StatusBadge status={selectedRun.status} />} mono={false} />
                  <MetricCard
                    label="进度"
                    value={`${String(detail.data?.progress.progressPct ?? 0)}%`}
                    hint={`${String(detail.data?.progress.analyzedCombinationCount ?? 0)} / ${String(detail.data?.progress.sourceCombinationCount ?? 0)} 组合`}
                  />
                  <MetricCard label="有效结果（稳定）" value={String(selectedRun.summary.stableCount)} />
                  <MetricCard label="不稳定" value={String(selectedRun.summary.unstableCount)} />
                  <MetricCard
                    label="成交活动不足"
                    value={String(selectedRun.summary.insufficientTradingActivityCount)}
                    hint="tradeCount = 0 ⇒ 不当有效样本，也不判「稳健」"
                  />
                  <MetricCard label="邻域证据不足" value={String(selectedRun.summary.insufficientNeighborhoodCount)} hint="有效邻居数 < 要求" />
                  <MetricCard label="源结果不可用" value={String(selectedRun.summary.sourceResultUnavailableCount)} />
                  <MetricCard
                    label="邻域不完整"
                    value={String(selectedRun.summary.neighborhoodIncompleteCount)}
                    hint="源 Search 中缺邻居组合（NEIGHBORHOOD_INCOMPLETE）"
                  />
                </div>

                <div className="rounded-md border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
                  <p className="font-medium text-foreground">判定口径（已持久化到本 Run）</p>
                  <p className="mt-1">
                    收益容差 ±{String(selectedRun.analysisConfig.returnTolerancePct)} 个百分点 ∧
                    回撤容差 ±{String(selectedRun.analysisConfig.drawdownTolerancePct)} 个百分点；
                    邻域半径 ±{String(selectedRun.analysisConfig.neighborDistance)} 步（单参数轴对齐）；
                    判定所需最少有效邻居 {String(selectedRun.analysisConfig.minValidNeighbors)}。
                  </p>
                  <p className="mt-1 font-mono">
                    冻结快照指纹 {selectedRun.searchSnapshotFingerprint.slice(0, 16)}… ·
                    执行政策版本 {String(selectedRun.executionPolicyVersion)} ·
                    评估配置指纹 {selectedRun.evaluationConfigFingerprint.slice(0, 12)}…
                  </p>
                </div>

                {(selectedRun.notes.length > 0 || (detail.data?.run.notes ?? []).length > 0) && (
                  <details className="rounded-md border border-border p-3 text-[11px]">
                    <summary className="cursor-pointer text-muted-foreground">分析说明（{String(selectedRun.notes.length)} 条）</summary>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                      {selectedRun.notes.map((note, index) => (
                        <li key={`note-${String(index)}`}>{note}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {/* -------- 单参数分析 -------- */}
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    <Layers className="h-4 w-4" /> 单参数分析（一次只动一个参数）
                  </p>
                  {(detail.data?.parameterAnalyses ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">尚无参数分析（先「启动分析」）。</p>
                  ) : (
                    <DataTable maxHeight={220}>
                      <TableHeader>
                        <TableRow>
                          <TableHead>参数</TableHead>
                          <TableHead>域形态</TableHead>
                          <TableHead className="text-right">取值数</TableHead>
                          <TableHead className="text-right">稳定组合</TableHead>
                          <TableHead className="text-right">不稳定组合</TableHead>
                          <TableHead className="text-right">平均绝对变化（百分点）</TableHead>
                          <TableHead className="text-right">最大绝对变化（百分点）</TableHead>
                          <TableHead className="text-right">平均相对变化</TableHead>
                          <TableHead>判定</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(detail.data?.parameterAnalyses ?? []).map((item) => (
                          <TableRow key={item.parameterName}>
                            <TableCell className="font-mono text-xs">{item.parameterName}</TableCell>
                            <TableCell className="text-xs">{item.domainMode}{item.numeric ? "" : "（非数值）"}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{item.domainValueCount}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{item.stableCombinationCount}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{item.unstableCombinationCount}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{num(item.sensitivity.meanAbsoluteChangePct)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{num(item.sensitivity.maxAbsoluteChangePct)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{num(item.sensitivity.meanRelativeChange, 4)}</TableCell>
                            <TableCell className="text-xs">
                              {item.verdict === "sensitive"
                                ? "该轴存在超容差邻居"
                                : item.verdict === "insensitive"
                                  ? "该轴邻居全部在容差内"
                                  : "该轴无有效邻居"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </DataTable>
                  )}
                </div>

                {/* -------- 二维稳定性矩阵 -------- */}
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    <Grid3x3 className="h-4 w-4" /> 二维稳定性矩阵（{detail.data?.matrix.rowAxis.parameter ?? "—"} × {detail.data?.matrix.columnAxis.parameter ?? "—"}）
                  </p>
                  <MatrixGrid matrix={detail.data?.matrix ?? null} />
                </div>

                {/* -------- 结果表 -------- */}
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <Table2 className="h-4 w-4" /> 组合结果（排序 / 过滤）
                    </p>
                    <select
                      id="rob-sort-by"
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      value={sortBy}
                      onChange={(event) => setSortBy(event.target.value)}
                    >
                      <option value="combinationIndex">按组合序号</option>
                      <option value="stabilityRatio">按稳定性比例</option>
                      <option value="totalReturnPct">按总收益率</option>
                      <option value="annualizedReturnPct">按年化收益率</option>
                      <option value="maxDrawdownPct">按最大回撤</option>
                      <option value="tradeCount">按成交笔数</option>
                      <option value="winRatePct">按胜率</option>
                      <option value="profitFactor">按盈亏比</option>
                    </select>
                    <select
                      id="rob-sort-direction"
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      value={sortDirection}
                      onChange={(event) => setSortDirection(event.target.value === "DESC" ? "DESC" : "ASC")}
                    >
                      <option value="ASC">升序</option>
                      <option value="DESC">降序</option>
                    </select>
                    <select
                      id="rob-status-filter"
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                    >
                      <option value="">全部状态</option>
                      <option value="STABLE">稳定</option>
                      <option value="UNSTABLE">不稳定</option>
                      <option value="INSUFFICIENT_TRADING_ACTIVITY">成交活动不足</option>
                      <option value="INSUFFICIENT_NEIGHBORHOOD">邻域证据不足</option>
                      <option value="SOURCE_RESULT_UNAVAILABLE">源结果不可用</option>
                    </select>
                    <span className="text-[11px] text-muted-foreground">
                      共 {String(results.data?.total ?? 0)} 条（返回 {String(results.data?.returned ?? 0)} 条
                      {results.data?.truncated === true ? "，已截断" : ""}）
                    </span>
                  </div>

                  {(results.data?.results ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">尚无结果（先「启动分析」）。</p>
                  ) : (
                    <DataTable maxHeight={380}>
                      <TableHeader>
                        <TableRow>
                          <TableHead>参数</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead className="text-right">总收益 %</TableHead>
                          <TableHead className="text-right">年化 %</TableHead>
                          <TableHead className="text-right">最大回撤 %</TableHead>
                          <TableHead className="text-right">成交</TableHead>
                          <TableHead className="text-right">胜率 %</TableHead>
                          <TableHead className="text-right">盈亏比</TableHead>
                          <TableHead className="text-right">稳定邻居 / 有效</TableHead>
                          <TableHead className="text-right">稳定性比例</TableHead>
                          <TableHead>邻域</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(results.data?.results ?? []).map((row) => (
                          <TableRow key={row.parameterHash} id={`rob-result-${row.parameterHash}`}>
                            <TableCell className="font-mono text-[11px]">{parametersText(row.parameters)}</TableCell>
                            <TableCell>
                              <StatusBadge
                                status={row.status}
                                label={STATUS_LABEL[row.status] ?? row.status}
                              />
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{num(row.metrics.totalReturnPct)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{num(row.metrics.annualizedReturnPct)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{num(row.metrics.maxDrawdownPct)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {row.metrics.tradeCount === null ? "—" : String(row.metrics.tradeCount)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{num(row.metrics.winRatePct)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{num(row.metrics.profitFactor, 3)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {String(row.stableNeighborCount)} / {String(row.validNeighborCount)}
                              <span className="ml-1 text-muted-foreground">（理论 {String(row.expectedNeighborCount)}）</span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{num(row.stabilityRatio, 4)}</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setExpandHash(expandHash === row.parameterHash ? null : row.parameterHash)}
                              >
                                {expandHash === row.parameterHash ? "收起" : "查看邻域"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </DataTable>
                  )}

                  {expandHash !== null && (
                    <NeighborhoodDetail
                      row={(results.data?.results ?? []).find((row) => row.parameterHash === expandHash) ?? null}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 矩阵（规格 §18：不用单一颜色表达「好坏」）
// ---------------------------------------------------------------------------

function MatrixGrid({
  matrix,
}: {
  matrix:
    | {
        rowAxis: { parameter: string; values: readonly (number | string | boolean | null)[] };
        columnAxis: { parameter: string; values: readonly (number | string | boolean | null)[] };
        cells: readonly {
          rowIndex: number;
          columnIndex: number;
          status: string;
          stabilityRatio: number | null;
          matchedCount: number;
        }[];
        parameterCount: number;
        omittedParameters: readonly string[];
      }
    | null;
}) {
  if (matrix === null || matrix.rowAxis.values.length === 0 || matrix.columnAxis.values.length === 0) {
    return <p className="text-xs text-muted-foreground">矩阵不可用（需至少两个参与搜索的参数，且已启动分析）。</p>;
  }
  const columns = matrix.columnAxis.values.length;
  return (
    <div className="space-y-2">
      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border-b bg-muted px-2 py-1 text-left font-mono">
                {matrix.rowAxis.parameter} ╲ {matrix.columnAxis.parameter}
              </th>
              {matrix.columnAxis.values.map((value) => (
                <th key={`c-${valueText(value)}`} className="border-b bg-muted px-2 py-1 text-left font-mono">
                  {valueText(value)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rowAxis.values.map((rowValue, rowIndex) => (
              <tr key={`r-${valueText(rowValue)}`}>
                <th className="border-b bg-muted/50 px-2 py-1 text-left font-mono">{valueText(rowValue)}</th>
                {Array.from({ length: columns }, (_, columnIndex) => {
                  const cell = matrix.cells.find(
                    (item) => item.rowIndex === rowIndex && item.columnIndex === columnIndex,
                  );
                  if (cell === undefined) {
                    return <td key={`cell-${String(rowIndex)}-${String(columnIndex)}`} className="border-b px-2 py-1">—</td>;
                  }
                  const missing = cell.status === "MISSING";
                  const ambiguous = cell.status === "AMBIGUOUS";
                  return (
                    <td
                      key={`cell-${String(rowIndex)}-${String(columnIndex)}`}
                      id={`rob-matrix-${String(rowIndex)}-${String(columnIndex)}`}
                      className={cn(
                        "border-b px-2 py-1 align-top",
                        // 🔴 缺格用**虚线边框**表达「数据不存在」，而不是用颜色表达「不好」。
                        missing && "border-dashed text-muted-foreground",
                      )}
                    >
                      <div className="font-mono">{missing ? "—" : ambiguous ? "多命中" : num(cell.stabilityRatio, 3)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {STATUS_LABEL[cell.status] ?? cell.status}
                        {ambiguous ? `（${String(cell.matchedCount)} 条）` : ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-muted-foreground">
        单元格 = 该组合的稳定性比例（稳定邻居 / 有效邻居）。「—」= 源 Parameter Search 中**不存在**该组合
        （**不补值**）。本表**不为「好坏」上色**：颜色只跟随状态种类，不代表数值高低。
        {matrix.omittedParameters.length > 0 && (
          <>  搜索空间含 {String(matrix.parameterCount)} 个可变参数，矩阵只取前两个；被略过：{matrix.omittedParameters.join(" / ")}（多命中格标「多命中」，不挑代表）。</>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 邻域明细（「查看邻域」）
// ---------------------------------------------------------------------------

function NeighborhoodDetail({
  row,
}: {
  row:
    | {
        parameterHash: string;
        statusReason: string | null;
        neighbors: readonly {
          axis: string;
          stepOffset: number;
          parameterHash: string | null;
          availability: string;
          metrics: {
            totalReturnPct: number | null;
            maxDrawdownPct: number | null;
            tradeCount: number | null;
          } | null;
          deltaTotalReturnPct: number | null;
          deltaMaxDrawdownPct: number | null;
          withinTolerance: boolean | null;
          unavailableReason: string | null;
        }[];
        dispersion: readonly {
          metric: string;
          count: number;
          mean: number | null;
          median: number | null;
          min: number | null;
          max: number | null;
          stdDev: number | null;
          range: number | null;
        }[];
      }
    | null;
}) {
  if (row === null) return null;
  return (
    <div className="mt-2 space-y-3 rounded-md border border-border bg-muted/20 p-3" id="rob-neighborhood-detail">
      <div>
        <p className="text-xs font-medium">邻域明细 · <span className="font-mono">{row.parameterHash}</span></p>
        {row.statusReason !== null && (
          <p className="mt-1 text-[11px] text-muted-foreground">{row.statusReason}</p>
        )}
      </div>
      <DataTable maxHeight={220}>
        <TableHeader>
          <TableRow>
            <TableHead>轴</TableHead>
            <TableHead className="text-right">步偏移</TableHead>
            <TableHead>邻居组合</TableHead>
            <TableHead className="text-right">总收益 %</TableHead>
            <TableHead className="text-right">最大回撤 %</TableHead>
            <TableHead className="text-right">成交</TableHead>
            <TableHead className="text-right">Δ收益</TableHead>
            <TableHead className="text-right">Δ回撤</TableHead>
            <TableHead>容差内</TableHead>
            <TableHead>说明</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {row.neighbors.map((neighbor, index) => (
            <TableRow key={`nb-${String(index)}-${neighbor.axis}`}>
              <TableCell className="font-mono text-xs">{neighbor.axis}</TableCell>
              <TableCell className="text-right font-mono text-xs">
                {neighbor.stepOffset > 0 ? `+${String(neighbor.stepOffset)}` : String(neighbor.stepOffset)}
              </TableCell>
              <TableCell className="font-mono text-[11px]">
                {neighbor.parameterHash ?? "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">{num(neighbor.metrics?.totalReturnPct ?? null)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{num(neighbor.metrics?.maxDrawdownPct ?? null)}</TableCell>
              <TableCell className="text-right font-mono text-xs">
                {neighbor.metrics?.tradeCount === null || neighbor.metrics === null
                  ? "—"
                  : String(neighbor.metrics.tradeCount)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">{num(neighbor.deltaTotalReturnPct)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{num(neighbor.deltaMaxDrawdownPct)}</TableCell>
              <TableCell className="text-xs">
                {neighbor.withinTolerance === null ? "—" : neighbor.withinTolerance ? "是" : "否"}
              </TableCell>
              <TableCell className="text-[11px] text-muted-foreground">
                {neighbor.unavailableReason ?? STATUS_LABEL[neighbor.availability] ?? neighbor.availability}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
      <div>
        <p className="mb-1 text-xs font-medium">邻域离散度（基准 + 有效邻居；样本数 = 0 时统计字段为「—」）</p>
        <DataTable maxHeight={200}>
          <TableHeader>
            <TableRow>
              <TableHead>指标</TableHead>
              <TableHead className="text-right">样本数</TableHead>
              <TableHead className="text-right">均值</TableHead>
              <TableHead className="text-right">中位数</TableHead>
              <TableHead className="text-right">最小</TableHead>
              <TableHead className="text-right">最大</TableHead>
              <TableHead className="text-right">标准差</TableHead>
              <TableHead className="text-right">极差</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {row.dispersion.map((item) => (
              <TableRow key={item.metric}>
                <TableCell className="font-mono text-xs">{item.metric}</TableCell>
                <TableCell className="text-right font-mono text-xs">{item.count}</TableCell>
                <TableCell className="text-right font-mono text-xs">{num(item.mean, 4)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{num(item.median, 4)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{num(item.min, 4)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{num(item.max, 4)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{num(item.stdDev, 4)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{num(item.range, 4)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </DataTable>
      </div>
    </div>
  );
}
