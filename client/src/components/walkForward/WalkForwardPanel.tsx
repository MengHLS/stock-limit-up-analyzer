
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  Ban,
  CalendarRange,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, SectionCard, StatusBadge } from "@/components/common";
import { DatasetVersionLink, StrategyVersionIdLink } from "@/components/common/ProvenanceLink";
import { trpc } from "@/lib/trpc";
import {
  buildPanelLocation,
  DEFAULT_PANEL_BASE_PATH,
  parseFoldIndex,
  type PanelLinkOptions,
} from "@/lib/panelLinks";

// ---------------------------------------------------------------------------
// 展示层小工具（不参与任何量化判定）
// ---------------------------------------------------------------------------

/** 数值 → 定长字符串；`null`（算不出来）一律「—」，**不用 0 顶替**。 */
function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

/** 带符号数值（正负号是语义的一部分，不能省）。 */
function signed(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

/** 冻结参数集 → 紧凑文本（键排序，稳定展示）。 */
function parametersText(
  parameters: Readonly<Record<string, number | string | boolean | null>> | null | undefined,
): string {
  if (parameters === null || parameters === undefined) return "（未冻结）";
  const keys = Object.keys(parameters).sort();
  if (keys.length === 0) return "（无）";
  return keys
    .map((key) => `${key}=${String(parameters[key] ?? "null")}`)
    .join(" · ");
}

/** Run 状态中文标签（**文本优先**，颜色只是辅助）。 */
const RUN_STATUS_LABEL: Readonly<Record<string, string>> = {
  CREATED: "已创建（未执行）",
  RUNNING: "执行中",
  COMPLETED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};

/** Fold 生命周期状态中文标签。 */
const FOLD_STATUS_LABEL: Readonly<Record<string, string>> = {
  WINDOW_CREATED: "窗口已建立",
  SEARCH_RUNNING: "样本内搜索中",
  SEARCH_COMPLETED: "搜索完成",
  CANDIDATE_FROZEN: "候选已冻结",
  OOS_RUNNING: "样本外执行中",
  OOS_COMPLETED: "样本外完成",
  FAILED: "失败",
};

/**
 * Fold 结果语义中文标签。
 *
 * 🔴 `INSUFFICIENT_TRADING_ACTIVITY` **不是失败**：它表示「该窗口里没有可评判的成交」，
 *   既不能说稳、也不能说不稳 —— 界面必须如实呈现，不得渲染成红色错误。
 */
const FOLD_OUTCOME_LABEL: Readonly<Record<string, string>> = {
  PENDING: "未产出",
  SUCCEEDED: "产出可用读数",
  INSUFFICIENT_TRADING_ACTIVITY: "成交不足（无可评判读数）",
  FAILED: "执行失败",
};

/** 六项指标定义（IS / OOS 两侧共用同一张表头 ⇒ 口径对齐看得见）。 */
const METRIC_ROWS = [
  { key: "totalReturnPct", label: "总收益率 %", digits: 2 },
  { key: "annualizedReturnPct", label: "年化收益率 %", digits: 2 },
  { key: "maxDrawdownPct", label: "最大回撤幅度 %", digits: 2 },
  { key: "tradeCount", label: "完成交易数", digits: 0 },
  { key: "winRatePct", label: "胜率 %", digits: 2 },
  { key: "profitFactor", label: "盈亏比", digits: 3 },
] as const;

type MetricKey = (typeof METRIC_ROWS)[number]["key"];
type MetricsView = Readonly<Record<MetricKey, number | null>> | null;
type StatView = Readonly<{
  availableCount: number;
  mean: number | null;
  median: number | null;
  observedMin: number | null;
  observedMax: number | null;
}>;

const WINDOW_MODES = ["ROLLING", "EXPANDING"] as const;
const SELECTION_KINDS = ["FIRST_ELIGIBLE_COMBINATION", "EXPLICIT_PARAMETER_HASH"] as const;

// ---------------------------------------------------------------------------
// 主面板
// ---------------------------------------------------------------------------

export interface WalkForwardPanelProps extends Partial<PanelLinkOptions> {
  /** 由独立路由的路径段给出的选中 run（优先级高于 query）。 */
  readonly routeRunId?: string | null;
  /** 由独立路由的路径段给出的选中 fold（优先级高于 query）。 */
  readonly routeFoldIndex?: number | null;
}

export default function WalkForwardPanel({
  basePath = DEFAULT_PANEL_BASE_PATH,
  pathStyle = false,
  routeRunId = null,
  routeFoldIndex = null,
}: WalkForwardPanelProps = {}) {
  const search = useSearch();
  const [, setLocation] = useLocation();

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const linkedRunId = useMemo(() => {
    if (routeRunId !== null && routeRunId !== "") return routeRunId;
    const raw = params.get("walkForwardRunId");
    return raw === null || raw === "" ? null : raw;
  }, [params, routeRunId]);
  const linkedFoldIndex = useMemo(() => {
    // 路由段优先（`/validation/walk-forward/:runId/folds/:foldIndex` 无 query）。
    if (routeFoldIndex !== null) return routeFoldIndex;
    return parseFoldIndex(params.get("foldIndex"));
  }, [params, routeFoldIndex]);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(linkedRunId);
  const [selectedFoldIndex, setSelectedFoldIndex] = useState<number | null>(linkedFoldIndex);
  useEffect(() => {
    if (linkedRunId !== null) setSelectedRunId(linkedRunId);
  }, [linkedRunId]);
  useEffect(() => {
    setSelectedFoldIndex(linkedFoldIndex);
  }, [linkedFoldIndex]);

  const [form, setForm] = useState({
    strategyId: "",
    strategyVersion: "",
    datasetVersionId: "",
    startDate: "",
    endDate: "",
    isWindowDays: "40",
    oosWindowDays: "20",
    stepDays: "20",
    windowMode: "ROLLING" as (typeof WINDOW_MODES)[number],
    maxFolds: "2",
    selectionKind: "FIRST_ELIGIBLE_COMBINATION" as (typeof SELECTION_KINDS)[number],
    parameterHash: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const runs = trpc.paramSearch.listWalkForwardRuns.useQuery({ limit: 50 });
  const detail = trpc.paramSearch.getWalkForwardRun.useQuery(
    { walkForwardRunId: selectedRunId ?? "" },
    { enabled: selectedRunId !== null },
  );

  const createMutation = trpc.paramSearch.createWalkForwardRun.useMutation();
  const startMutation = trpc.paramSearch.startWalkForwardRun.useMutation();
  const cancelMutation = trpc.paramSearch.cancelWalkForwardRun.useMutation();

  /** 选中并写进 URL（深链）。地址形式由 `pathStyle` / `basePath` 决定（见 `panelLinks.ts`）。 */
  function selectRun(runId: string | null, foldIndex: number | null = null): void {
    setSelectedRunId(runId);
    setSelectedFoldIndex(foldIndex);
    setLocation(
      buildPanelLocation({ basePath, pathStyle, queryKey: "walkForwardRunId" }, runId, foldIndex),
    );
  }

  async function handleCreate(): Promise<void> {
    setMessage(null);
    setErrorText(null);
    const datasetVersionId = form.datasetVersionId.trim();
    const maxFolds = form.maxFolds.trim();
    try {
      const created = await createMutation.mutateAsync({
        strategyId: form.strategyId.trim(),
        strategyVersion: form.strategyVersion.trim(),
        ...(datasetVersionId === "" ? {} : { datasetVersionId: Number(datasetVersionId) }),
        windowConfig: {
          startDate: form.startDate.trim(),
          endDate: form.endDate.trim(),
          isWindowDays: Number(form.isWindowDays),
          oosWindowDays: Number(form.oosWindowDays),
          stepDays: Number(form.stepDays),
          windowMode: form.windowMode,
          ...(maxFolds === "" ? {} : { maxFolds: Number(maxFolds) }),
        },
        selectionPolicy:
          form.selectionKind === "EXPLICIT_PARAMETER_HASH"
            ? { kind: "EXPLICIT_PARAMETER_HASH", parameterHash: form.parameterHash.trim() }
            : { kind: "FIRST_ELIGIBLE_COMBINATION" },
      });
      await runs.refetch();
      selectRun(created.run.walkForwardRunId);
      const notes = created.notes.map((note) => `· ${note}`).join("\n");
      setMessage(
        `已创建 Walk-Forward 验证 ${created.run.walkForwardRunId}`
          + `（状态 ${RUN_STATUS_LABEL[created.run.status] ?? created.run.status}，`
          + `${String(created.run.totalFoldCount)} 个 Fold）。`
          + "此时**尚未执行任何搜索与回测**；点击「执行」才会逐 Fold 真实运行。"
          + (notes === "" ? "" : `\n${notes}`),
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleStart(runId: string): Promise<void> {
    setMessage(null);
    setErrorText(null);
    try {
      const outcome = await startMutation.mutateAsync({ walkForwardRunId: runId });
      await Promise.all([runs.refetch(), detail.refetch()]);
      setMessage(
        outcome.executed
          ? `已逐 Fold 真实执行完毕（Run 状态：${RUN_STATUS_LABEL[outcome.run.status] ?? outcome.run.status}）。`
          : "该 Walk-Forward 验证已处于终态 ⇒ 幂等返回既有结果，**未重新执行任何 Fold**。",
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCancel(runId: string): Promise<void> {
    setMessage(null);
    setErrorText(null);
    try {
      await cancelMutation.mutateAsync({ walkForwardRunId: runId });
      await Promise.all([runs.refetch(), detail.refetch()]);
      setMessage(
        "已请求取消。执行是**逐 Fold 串行**的进程内循环 ⇒ 取消在**下一个 Fold 边界**生效，"
          + "当前正在跑的 Fold 会正常走完并如实留档（不制造中间态）。",
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  const runList = runs.data ?? [];
  const selectedRun = detail.data?.run ?? null;
  const folds = useMemo(
    () => [...(detail.data?.folds ?? [])].sort((a, b) => a.foldIndex - b.foldIndex),
    [detail.data],
  );
  const selectedFold =
    selectedFoldIndex === null
      ? null
      : (folds.find((fold) => fold.foldIndex === selectedFoldIndex) ?? null);

  const formReady =
    form.strategyId.trim() !== ""
    && form.strategyVersion.trim() !== ""
    && form.startDate.trim() !== ""
    && form.endDate.trim() !== ""
    && Number(form.isWindowDays) > 0
    && Number(form.oosWindowDays) > 0
    && Number(form.stepDays) > 0
    && (form.selectionKind !== "EXPLICIT_PARAMETER_HASH" || form.parameterHash.trim() !== "");

  return (
    <SectionCard
      title="Walk-Forward 验证（时间滚动编排）· WALK-FORWARD-001"
      description="把时间轴切成若干 Fold：每个 Fold 各自在自己**紧邻**的样本内窗口里真实搜参数、冻结候选，再拿到**它没见过的**样本外窗口上真实重跑，最后给出多 Fold 的描述性汇总。本面板不做排序、不做评级、不挑选 Fold。"
      icon={Layers}
      right={
        <Button
          id="walk-forward-refresh-button"
          variant="outline"
          size="sm"
          onClick={() => {
            void runs.refetch();
            if (selectedRunId !== null) void detail.refetch();
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
      <div className="space-y-5">
        {/* ---- 泄漏守卫口径提示（醒目） ---- */}
        <div className="flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-semibold">逐 Fold 独立搜索 · 窗口严格不重叠。</span>
            {" "}
            每个 Fold 的搜索窗口必须**等于**它自己的样本内窗口，样本外窗口从样本内窗口结束的
            **下一个交易日**开始 —— 服务端在执行前逐条断言，任何越界都会让该 Fold 显式失败，
            不会静默放行。
          </span>
        </div>

        {/* ---- 创建（只冻结，不执行） ---- */}
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
            <CalendarRange className="h-3.5 w-3.5" />
            新建验证（只冻结排程与身份，**不执行**）
          </p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">策略 ID</span>
              <Input
                id="wf-strategy-id"
                className="h-8 text-xs"
                value={form.strategyId}
                onChange={(event) => setForm({ ...form, strategyId: event.target.value })}
                placeholder="limit-up-baseline"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">策略版本</span>
              <Input
                id="wf-strategy-version"
                className="h-8 text-xs"
                value={form.strategyVersion}
                onChange={(event) => setForm({ ...form, strategyVersion: event.target.value })}
                placeholder="1.0.0"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">数据集版本 ID（可空）</span>
              <Input
                id="wf-dataset-version-id"
                className="h-8 text-xs"
                value={form.datasetVersionId}
                onChange={(event) => setForm({ ...form, datasetVersionId: event.target.value })}
                placeholder="留空 = 回落策略文档绑定"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">窗口模式</span>
              <select
                id="wf-window-mode"
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                value={form.windowMode}
                onChange={(event) =>
                  setForm({ ...form, windowMode: event.target.value as (typeof WINDOW_MODES)[number] })
                }
              >
                {WINDOW_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode === "ROLLING" ? "ROLLING（滚动定长）" : "EXPANDING（锚定扩窗）"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">交易日起点</span>
              <Input
                id="wf-start-date"
                className="h-8 text-xs"
                value={form.startDate}
                onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                placeholder="2025-01-02"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">交易日终点</span>
              <Input
                id="wf-end-date"
                className="h-8 text-xs"
                value={form.endDate}
                onChange={(event) => setForm({ ...form, endDate: event.target.value })}
                placeholder="2025-06-30"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">样本内长度（交易日）</span>
              <Input
                id="wf-is-days"
                className="h-8 text-xs"
                value={form.isWindowDays}
                onChange={(event) => setForm({ ...form, isWindowDays: event.target.value })}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">样本外长度（交易日）</span>
              <Input
                id="wf-oos-days"
                className="h-8 text-xs"
                value={form.oosWindowDays}
                onChange={(event) => setForm({ ...form, oosWindowDays: event.target.value })}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">推进步长（交易日）</span>
              <Input
                id="wf-step-days"
                className="h-8 text-xs"
                value={form.stepDays}
                onChange={(event) => setForm({ ...form, stepDays: event.target.value })}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Fold 数上限（可空）</span>
              <Input
                id="wf-max-folds"
                className="h-8 text-xs"
                value={form.maxFolds}
                onChange={(event) => setForm({ ...form, maxFolds: event.target.value })}
                placeholder="留空 = 不设上限"
              />
            </label>
            <label className="text-xs md:col-span-2">
              <span className="mb-1 block text-muted-foreground">候选选择策略</span>
              <select
                id="wf-selection-kind"
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                value={form.selectionKind}
                onChange={(event) =>
                  setForm({
                    ...form,
                    selectionKind: event.target.value as (typeof SELECTION_KINDS)[number],
                  })
                }
              >
                <option value="FIRST_ELIGIBLE_COMBINATION">
                  FIRST_ELIGIBLE_COMBINATION（按组合序号取第一个有成功结果的组合）
                </option>
                <option value="EXPLICIT_PARAMETER_HASH">
                  EXPLICIT_PARAMETER_HASH（由调用方显式给出 parameterHash）
                </option>
              </select>
            </label>
            {form.selectionKind === "EXPLICIT_PARAMETER_HASH" && (
              <label className="text-xs md:col-span-2">
                <span className="mb-1 block text-muted-foreground">parameterHash</span>
                <Input
                  id="wf-parameter-hash"
                  className="h-8 font-mono text-xs"
                  value={form.parameterHash}
                  onChange={(event) => setForm({ ...form, parameterHash: event.target.value })}
                />
              </label>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button
              id="wf-create-button"
              size="sm"
              onClick={() => void handleCreate()}
              disabled={!formReady || createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CalendarRange className="mr-1.5 h-3.5 w-3.5" />
              )}
              {createMutation.isPending ? "创建中…" : "创建（只冻结）"}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              窗口长度与步长的单位是**交易日个数**，不是日历天。
            </span>
          </div>
        </div>

        {message !== null && (
          <p className="whitespace-pre-line rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            {message}
          </p>
        )}
        {errorText !== null && (
          <p className="whitespace-pre-line rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
            {errorText}
          </p>
        )}

        {/* ---- Run 列表 ---- */}
        <div>
          <p className="mb-1.5 text-xs font-semibold">验证列表（按创建时间倒序）</p>
          {runs.isLoading ? (
            <p className="py-3 text-center text-xs text-muted-foreground">加载中…</p>
          ) : runList.length === 0 ? (
            <EmptyState
              title="暂无 Walk-Forward 验证"
              description="用上方表单创建一次：创建只冻结排程与身份，不会跑任何回测。"
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Run</TableHead>
                    <TableHead className="text-xs">策略</TableHead>
                    <TableHead className="text-xs">窗口模式</TableHead>
                    <TableHead className="text-xs">Fold 数</TableHead>
                    <TableHead className="text-xs">进度</TableHead>
                    <TableHead className="text-xs">状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runList.map((item) => (
                    <TableRow
                      key={item.walkForwardRunId}
                      className="cursor-pointer"
                      data-run-id={item.walkForwardRunId}
                      onClick={() => selectRun(item.walkForwardRunId)}
                    >
                      <TableCell className="font-mono text-[11px]">
                        {item.walkForwardRunId}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {item.strategyId}@{item.strategyVersion}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {item.schedule.config.windowMode}
                        <span className="text-muted-foreground">
                          {" "}
                          IS {item.schedule.config.isWindowDays} / OOS{" "}
                          {item.schedule.config.oosWindowDays} / step{" "}
                          {item.schedule.config.stepDays}
                        </span>
                      </TableCell>
                      <TableCell className="text-[11px]">{item.totalFoldCount}</TableCell>
                      <TableCell className="text-[11px]">
                        完成 {item.completedFoldCount} · 失败 {item.failedFoldCount}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={item.status}
                          label={RUN_STATUS_LABEL[item.status] ?? item.status}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* ---- Run 详情 ---- */}
        {selectedRunId !== null && (
          <div className="space-y-4 border-t pt-4">
            {detail.isLoading ? (
              <p className="py-3 text-center text-xs text-muted-foreground">正在读取详情…</p>
            ) : selectedRun === null ? (
              <EmptyState
                title="未找到该 Walk-Forward 验证"
                description={`URL 中的 walkForwardRunId=${selectedRunId} 在库中不存在。`}
              />
            ) : (
              <>
                {/* 头部 + 操作 */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <span className="font-mono text-xs">{selectedRun.walkForwardRunId}</span>
                      <StatusBadge
                        status={selectedRun.status}
                        label={RUN_STATUS_LABEL[selectedRun.status] ?? selectedRun.status}
                      />
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      {/* FRONTEND-FINAL-001（P1-4）：策略版本 / 数据集版本改为可点击溯源。 */}
                      <StrategyVersionIdLink
                        strategyVersionId={`${selectedRun.strategyId}@${selectedRun.strategyVersion}`}
                      />
                      <span>· 数据集</span>
                      <DatasetVersionLink
                        datasetVersionId={selectedRun.datasetVersionId}
                        label={selectedRun.datasetVersionLabel}
                      />
                      <span>· 指标口径 {selectedRun.metricsVersion}</span>
                      <span>· 引擎 {selectedRun.engineVersion}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      id="wf-start-button"
                      size="sm"
                      onClick={() => void handleStart(selectedRun.walkForwardRunId)}
                      disabled={!selectedRun.canExecute || startMutation.isPending}
                    >
                      {startMutation.isPending ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {startMutation.isPending
                        ? "执行中…（逐 Fold 真实回测，分钟级）"
                        : "执行（逐 Fold 真实搜索 + 样本外）"}
                    </Button>
                    <Button
                      id="wf-cancel-button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCancel(selectedRun.walkForwardRunId)}
                      disabled={!selectedRun.canExecute || cancelMutation.isPending}
                    >
                      {cancelMutation.isPending ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Ban className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      取消
                    </Button>
                  </div>
                </div>

                {selectedRun.errorCode !== null && (
                  <p className="whitespace-pre-line rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
                    <span className="font-mono">{selectedRun.errorCode}</span>
                    {" — "}
                    {selectedRun.errorMessage ?? ""}
                  </p>
                )}

                {/* ---- Window Schedule ---- */}
                <div className="rounded-md border">
                  <p className="border-b bg-muted/30 px-3 py-1.5 text-xs font-semibold">
                    窗口排程（创建时冻结 · 与运行进度无关）
                  </p>
                  <div className="space-y-2 p-3">
                    <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                      <div>
                        <span className="text-muted-foreground">窗口模式</span>
                        <p className="font-medium">{selectedRun.schedule.config.windowMode}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">IS / OOS / step（交易日）</span>
                        <p className="font-medium">
                          {selectedRun.schedule.config.isWindowDays} /{" "}
                          {selectedRun.schedule.config.oosWindowDays} /{" "}
                          {selectedRun.schedule.config.stepDays}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">取样区间</span>
                        <p className="font-medium">
                          {selectedRun.schedule.config.startDate} ..{" "}
                          {selectedRun.schedule.config.endDate}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">真实交易日数</span>
                        <p className="font-medium">{selectedRun.schedule.tradeDates.length}</p>
                      </div>
                    </div>
                    <p className="break-all font-mono text-[10px] text-muted-foreground">
                      scheduleFingerprint = {selectedRun.schedule.scheduleFingerprint}
                      <br />
                      tradeDatesFingerprint = {selectedRun.schedule.tradeDatesFingerprint}
                    </p>
                    <p className="text-[11px]">
                      <span className="text-muted-foreground">候选选择策略：</span>
                      {selectedRun.selectionPolicy.kind}
                      {selectedRun.selectionPolicy.kind === "EXPLICIT_PARAMETER_HASH" && (
                        <span className="ml-1 break-all font-mono text-[10px]">
                          {selectedRun.selectionPolicy.parameterHash}
                        </span>
                      )}
                    </p>
                    <ol className="space-y-0.5 text-[11px]">
                      {selectedRun.schedule.windows.map((window_) => (
                        <li key={window_.foldIndex}>
                          <span className="font-mono">Fold #{window_.foldIndex}</span>
                          {"  IS "}
                          <span className="font-mono">
                            {window_.isStart}..{window_.isEnd}
                          </span>
                          {"  →  OOS "}
                          <span className="font-mono">
                            {window_.oosStart}..{window_.oosEnd}
                          </span>
                          <span className="text-muted-foreground">
                            {"  "}（{window_.isTradingDays} / {window_.oosTradingDays} 交易日）
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                {/* ---- Fold Matrix ---- */}
                <div className="rounded-md border">
                  <p className="border-b bg-muted/30 px-3 py-1.5 text-xs font-semibold">
                    Fold 矩阵（按序号升序 · 不排序、不评级）
                  </p>
                  {folds.length === 0 ? (
                    <p className="p-3 text-xs text-muted-foreground">（无 Fold）</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Fold</TableHead>
                            <TableHead className="text-xs">样本内窗口</TableHead>
                            <TableHead className="text-xs">样本外窗口</TableHead>
                            <TableHead className="text-xs">生命周期</TableHead>
                            <TableHead className="text-xs">结果</TableHead>
                            <TableHead className="text-xs text-right">IS 总收益 %</TableHead>
                            <TableHead className="text-xs text-right">OOS 总收益 %</TableHead>
                            <TableHead className="text-xs text-right">IS / OOS 回撤 %</TableHead>
                            <TableHead className="text-xs text-right">IS / OOS 交易数</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {folds.map((fold) => {
                            const isMetrics = fold.isMetrics as MetricsView;
                            const oosMetrics = fold.oosMetrics as MetricsView;
                            const active = selectedFoldIndex === fold.foldIndex;
                            return (
                              <TableRow
                                key={fold.foldIndex}
                                className={active ? "cursor-pointer bg-muted/40" : "cursor-pointer"}
                                data-fold-index={fold.foldIndex}
                                onClick={() =>
                                  selectRun(
                                    selectedRun.walkForwardRunId,
                                    active ? null : fold.foldIndex,
                                  )
                                }
                              >
                                <TableCell className="text-[11px]">#{fold.foldIndex}</TableCell>
                                <TableCell className="font-mono text-[11px]">
                                  {fold.isStart}..{fold.isEnd}
                                </TableCell>
                                <TableCell className="font-mono text-[11px]">
                                  {fold.oosStart}..{fold.oosEnd}
                                </TableCell>
                                <TableCell className="text-[11px]">
                                  {FOLD_STATUS_LABEL[fold.status] ?? fold.status}
                                </TableCell>
                                <TableCell className="text-[11px]">
                                  {FOLD_OUTCOME_LABEL[fold.outcome] ?? fold.outcome}
                                </TableCell>
                                <TableCell className="text-right font-mono text-[11px]">
                                  {num(isMetrics?.totalReturnPct)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-[11px]">
                                  {num(oosMetrics?.totalReturnPct)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-[11px]">
                                  {num(isMetrics?.maxDrawdownPct)} / {num(oosMetrics?.maxDrawdownPct)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-[11px]">
                                  {isMetrics?.tradeCount === null || isMetrics === null
                                    ? "—"
                                    : String(isMetrics.tradeCount)}
                                  {" / "}
                                  {oosMetrics?.tradeCount === null || oosMetrics === null
                                    ? "—"
                                    : String(oosMetrics.tradeCount)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* ---- 单 Fold 详情 ---- */}
                {selectedFold !== null && (
                  <div className="rounded-md border" data-fold-detail={selectedFold.foldIndex}>
                    <p className="border-b bg-muted/30 px-3 py-1.5 text-xs font-semibold">
                      Fold #{selectedFold.foldIndex} 详情 · 逐 Fold 可追溯
                    </p>
                    <div className="space-y-3 p-3">
                      <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-3">
                        <div>
                          <span className="text-muted-foreground">该 Fold 的搜索 Run</span>
                          <p className="break-all font-mono">
                            {selectedFold.sourceSearchRunId ?? "（尚未执行）"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">该 Fold 的样本外 Run</span>
                          <p className="break-all font-mono">{selectedFold.oosRunId ?? "（尚未执行）"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">候选组合序号 / 冻结 hash</span>
                          <p className="break-all font-mono text-[10px]">
                            {selectedFold.sourceCombinationIndex ?? "—"} ·{" "}
                            {selectedFold.parameterHash ?? "—"}
                          </p>
                        </div>
                        <div className="md:col-span-2">
                          <span className="text-muted-foreground">冻结参数集</span>
                          <p className="font-mono">
                            {parametersText(
                              selectedFold.resolvedParameterSet as Readonly<
                                Record<string, number | string | boolean | null>
                              > | null,
                            )}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">读数来源</span>
                          <p className="font-mono">
                            IS {selectedFold.isMetricsSource ?? "—"} / OOS{" "}
                            {selectedFold.oosMetricsSource ?? "—"}
                          </p>
                        </div>
                        <div className="md:col-span-3">
                          <span className="text-muted-foreground">
                            撮合指纹（IS 候选 / 本次样本外）
                          </span>
                          <p className="break-all font-mono text-[10px]">
                            {selectedFold.oosBacktestFingerprint === null
                              ? "—"
                              : `OOS ${selectedFold.oosBacktestFingerprint}`}
                            <br />
                            executionFingerprint = {selectedFold.executionFingerprint}
                          </p>
                        </div>
                      </div>

                      {/* IS / OOS 六项对照 */}
                      <div className="overflow-x-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">指标</TableHead>
                              <TableHead className="text-xs text-right">样本内（IS）</TableHead>
                              <TableHead className="text-xs text-right">样本外（OOS）</TableHead>
                              <TableHead className="text-xs text-right">差值</TableHead>
                              <TableHead className="text-xs text-right">比值</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {METRIC_ROWS.map((metric) => {
                              const isMetrics = selectedFold.isMetrics as MetricsView;
                              const oosMetrics = selectedFold.oosMetrics as MetricsView;
                              const comparison = (selectedFold.comparison ?? {}) as unknown as Readonly<
                                Record<string, number | null | undefined>
                              >;
                              const deltaKey = `${metric.key}Delta`;
                              const ratioKey = `${metric.key}Ratio`;
                              const delta =
                                metric.key === "tradeCount"
                                  ? (comparison["tradeCountChange"] ?? null)
                                  : (comparison[deltaKey] ?? null);
                              return (
                                <TableRow key={metric.key}>
                                  <TableCell className="text-[11px]">{metric.label}</TableCell>
                                  <TableCell className="text-right font-mono text-[11px]">
                                    {num(isMetrics?.[metric.key], metric.digits)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-[11px]">
                                    {num(oosMetrics?.[metric.key], metric.digits)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-[11px]">
                                    {signed(
                                      delta === null || delta === undefined ? null : Number(delta),
                                      metric.digits,
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-[11px]">
                                    {metric.key === "tradeCount"
                                      ? "—"
                                      : (() => {
                                          const ratio =
                                            comparison[ratioKey] === null
                                            || comparison[ratioKey] === undefined
                                              ? null
                                              : Number(comparison[ratioKey]);
                                          return ratio === null ? "—" : `×${ratio.toFixed(2)}`;
                                        })()}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      {selectedFold.errorCode !== null && (
                        <p className="whitespace-pre-line rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
                          <span className="font-mono">{selectedFold.errorCode}</span>
                          {" — "}
                          {selectedFold.errorMessage ?? ""}
                        </p>
                      )}
                      {selectedFold.notes.length > 0 && (
                        <ul className="list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                          {selectedFold.notes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                {/* ---- 多 Fold 描述性汇总 ---- */}
                <div className="rounded-md border">
                  <p className="border-b bg-muted/30 px-3 py-1.5 text-xs font-semibold">
                    多 Fold 汇总（**只做描述性统计** · 不排序、不评级、不判定通过或淘汰）
                  </p>
                  <div className="space-y-2 p-3">
                    {selectedRun.aggregate === null ? (
                      <p className="text-[11px] text-muted-foreground">
                        尚未生成汇总（未执行完成）。
                      </p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-5">
                          <div>
                            <span className="text-muted-foreground">Fold 总数</span>
                            <p className="font-medium">{selectedRun.aggregate.foldCount}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">完成</span>
                            <p className="font-medium">{selectedRun.aggregate.completedFoldCount}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">成交不足</span>
                            <p className="font-medium">
                              {selectedRun.aggregate.insufficientTradingActivityCount}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">失败</span>
                            <p className="font-medium">{selectedRun.aggregate.failedFoldCount}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">计入统计</span>
                            <p className="font-medium">
                              {selectedRun.aggregate.contributingFoldCount}
                            </p>
                          </div>
                        </div>
                        <div className="overflow-x-auto rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">指标</TableHead>
                                <TableHead className="text-xs text-right">IS 均值</TableHead>
                                <TableHead className="text-xs text-right">IS 中位数</TableHead>
                                <TableHead className="text-xs text-right">OOS 均值</TableHead>
                                <TableHead className="text-xs text-right">OOS 中位数</TableHead>
                                <TableHead className="text-xs text-right">可用 Fold</TableHead>
                                <TableHead className="text-xs text-right">观测区间（IS）</TableHead>
                                <TableHead className="text-xs text-right">观测区间（OOS）</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {METRIC_ROWS.map((metric) => {
                                const isStat = (selectedRun.aggregate as unknown as {
                                  isStats: Record<string, StatView>;
                                  oosStats: Record<string, StatView>;
                                }).isStats[metric.key];
                                const oosStat = (selectedRun.aggregate as unknown as {
                                  oosStats: Record<string, StatView>;
                                }).oosStats[metric.key];
                                return (
                                  <TableRow key={metric.key}>
                                    <TableCell className="text-[11px]">{metric.label}</TableCell>
                                    <TableCell className="text-right font-mono text-[11px]">
                                      {num(isStat?.mean ?? null, metric.digits)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-[11px]">
                                      {num(isStat?.median ?? null, metric.digits)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-[11px]">
                                      {num(oosStat?.mean ?? null, metric.digits)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-[11px]">
                                      {num(oosStat?.median ?? null, metric.digits)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-[11px]">
                                      {String(oosStat?.availableCount ?? 0)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-[11px]">
                                      {num(isStat?.observedMin ?? null, metric.digits)} ..{" "}
                                      {num(isStat?.observedMax ?? null, metric.digits)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-[11px]">
                                      {num(oosStat?.observedMin ?? null, metric.digits)} ..{" "}
                                      {num(oosStat?.observedMax ?? null, metric.digits)}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                          <Timer className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>
                            统计只覆盖**产出可用读数**的 Fold；「成交不足」的 Fold 按事实单独计数，
                            既不记为成功也不记为失败，**不计入**均值 / 中位数。可用 Fold 为 0 时
                            所有统计量显示「—」，不会退化成 0。
                          </span>
                        </p>
                        {selectedRun.aggregate.notes.length > 0 && (
                          <ul className="list-inside list-disc space-y-0.5 text-[10px] text-muted-foreground">
                            {selectedRun.aggregate.notes.map((note) => (
                              <li key={note}>{note}</li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {selectedRun.notes.length > 0 && (
                  <ul className="list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                    {selectedRun.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
