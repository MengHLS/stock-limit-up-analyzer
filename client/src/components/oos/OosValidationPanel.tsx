/**
 * OOS-001 §15 — 样本外验证（Out-of-Sample Validation）前端面板。
 *
 * ## 这个面板回答什么问题
 *
 * > 「在某次参数搜索里选出的那组参数，拿到**它没见过的数据**上，还成立吗？」
 *
 * 它**必须真正重跑回测**（与 `SearchRobustnessPanel` 的「零重跑」正好相反）：
 * 创建时只冻结配置（源 Run + 候选身份 + OOS 窗口），点击「执行」才会在 OOS 窗口上
 * 真实执行 Backtest 并重算 canonical metrics。
 *
 * ## 前端纪律（本仓既有，逐条对齐 §15）
 *
 * - 🔴 **不产出「最佳 / 最优 / 推荐」**：本文件不得出现这些结论性词汇
 *   （由 `tests/server/research/oosValidation/oosValidationBoundary.test.ts` 源码扫描钉住）；
 * - 🔴 **不可调参**：表单里**没有**参数值输入位 —— 唯一指定候选的方式是
 *   `源 Search Run + parameterHash`。参数值一律由服务端从源组合行读出并重算 hash 复核
 *   （规格 §5 在 UI 层的落地：让「顺手传一组更好的参数」**在界面上无处可写**）；
 * - 🔴 **长请求按钮必须换文案**：`执行` 会真实重跑回测（实测 30–40 s 量级），
 *   pending 时文案必须变化；
 * - 🔴 **诚实空态**：「加载中」不等于「数据到位」；指标不可用显示「—」而不是 0；
 *   `null`（算不出来）与 `0`（算出来是 0，例如零成交）必须区分显示；
 * - 🔴 **深链可达**：选中 Run 写进 URL（`?oosRunId=`），刷新 / 分享后仍能回到同一份详情。
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  AlertTriangle,
  Ban,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  Target,
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
import { trpc } from "@/lib/trpc";

// ---------------------------------------------------------------------------
// 展示层小工具（不参与任何量化判定）
// ---------------------------------------------------------------------------

/** 数值 → 定长字符串；`null`（算不出来）一律「—」，**不用 0 顶替**。 */
function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

/** 带符号数值（用于 delta / change：正负号是语义的一部分，不能省）。 */
function signed(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

/** 比值 → `×N` 形式；`null`（IS=0 无法做比）显示「—」。 */
function ratio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `×${value.toFixed(2)}`;
}

function valueText(value: number | string | boolean | null | undefined): string {
  if (value === null || value === undefined) return "null";
  return String(value);
}

/** 冻结参数集 → 紧凑文本（键排序，稳定展示）。 */
function parametersText(parameters: Readonly<Record<string, number | string | boolean | null>>): string {
  const keys = Object.keys(parameters).sort();
  if (keys.length === 0) return "（无）";
  return keys.map((key) => `${key}=${valueText(parameters[key] ?? null)}`).join(" · ");
}

/** Run 状态中文标签（**文本优先**，颜色只是辅助）。 */
const STATUS_LABEL: Readonly<Record<string, string>> = {
  CREATED: "已创建（未执行）",
  RUNNING: "执行中",
  COMPLETED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};

/** 结果状态中文标签。 */
const RESULT_LABEL: Readonly<Record<string, string>> = {
  SUCCEEDED: "产出可用读数",
  FAILED: "未产出可用读数",
};

/** Result 的六项指标定义（IS / OOS 两侧共用同一张表头 ⇒ 口径对齐看得见）。 */
const METRIC_ROWS = [
  { key: "totalReturnPct", label: "总收益率 %", digits: 2, unit: "%" },
  { key: "annualizedReturnPct", label: "年化收益率 %", digits: 2, unit: "%" },
  { key: "maxDrawdownPct", label: "最大回撤幅度 %", digits: 2, unit: "%" },
  { key: "tradeCount", label: "完成交易数", digits: 0, unit: "笔" },
  { key: "winRatePct", label: "胜率 %", digits: 2, unit: "%" },
  { key: "profitFactor", label: "盈亏比", digits: 3, unit: "" },
] as const;

type MetricsView = Readonly<Record<(typeof METRIC_ROWS)[number]["key"], number | null>>;

// ---------------------------------------------------------------------------
// 主面板
// ---------------------------------------------------------------------------

export default function OosValidationPanel() {
  const search = useSearch();
  const [, setLocation] = useLocation();

  /** URL 深链中的选中 OOS Run（刷新 / 分享后仍能回到同一份详情）。 */
  const linkedRunId = useMemo(() => {
    const raw = new URLSearchParams(search).get("oosRunId");
    return raw === null || raw === "" ? null : raw;
  }, [search]);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(linkedRunId);
  useEffect(() => {
    if (linkedRunId !== null) setSelectedRunId(linkedRunId);
  }, [linkedRunId]);

  const [form, setForm] = useState({
    sourceSearchRunId: "",
    parameterHash: "",
    oosStartDate: "",
    oosEndDate: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const runs = trpc.paramSearch.listOosRuns.useQuery({ limit: 50 });
  const detail = trpc.paramSearch.getOosRun.useQuery(
    { oosRunId: selectedRunId ?? "" },
    { enabled: selectedRunId !== null },
  );

  const createMutation = trpc.paramSearch.createOosRun.useMutation();
  const startMutation = trpc.paramSearch.startOosRun.useMutation();
  const cancelMutation = trpc.paramSearch.cancelOosRun.useMutation();

  /** 选中并写进 URL（深链）。 */
  function selectRun(runId: string | null): void {
    setSelectedRunId(runId);
    if (runId === null) setLocation("/parameter-search");
    else setLocation(`/parameter-search?oosRunId=${encodeURIComponent(runId)}`);
  }

  async function handleCreate(): Promise<void> {
    setMessage(null);
    setErrorText(null);
    try {
      const created = await createMutation.mutateAsync({
        sourceSearchRunId: form.sourceSearchRunId.trim(),
        parameterHash: form.parameterHash.trim(),
        oosWindow: { startDate: form.oosStartDate.trim(), endDate: form.oosEndDate.trim() },
      });
      await runs.refetch();
      selectRun(created.run.oosRunId);
      const notes = created.notes.map((n) => `· ${n}`).join("\n");
      setMessage(
        `已创建 OOS 验证 ${created.run.oosRunId}（状态 ${STATUS_LABEL[created.run.status] ?? created.run.status}）。`
          + "此时**尚未执行任何回测**；点击「执行」才会在 OOS 窗口上真实重跑。"
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
      const outcome = await startMutation.mutateAsync({ oosRunId: runId });
      await Promise.all([runs.refetch(), detail.refetch()]);
      setMessage(
        outcome.executed
          ? `已在样本外窗口真实重跑并通过 canonical 口径重算指标（结果状态：${RESULT_LABEL[outcome.result?.status ?? ""] ?? "—"}）。`
          : "该 OOS 验证已完成 ⇒ 幂等返回既有结果，**未重新执行**（规格 §12：已完成不允许再次执行）。",
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCancel(runId: string): Promise<void> {
    setMessage(null);
    setErrorText(null);
    try {
      await cancelMutation.mutateAsync({ oosRunId: runId });
      await Promise.all([runs.refetch(), detail.refetch()]);
      setMessage("已取消该 OOS 验证。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  const selectedRun = detail.data?.run ?? null;
  const selectedResult = detail.data?.result ?? null;
  /**
   * 对照的逐项 delta / ratio 以字符串键索引（键名 = `${metricKey}Delta` / `Ratio`）。
   * 契约里是**显式命名的字段**（不用索引签名），所以这里显式收窄一次，
   * 由 `METRIC_ROWS` 与契约字段的一一对应来保证正确性 —— 若契约新增指标而这里漏了，
   * 表格会显示「—」而不是编一个数。
   */
  const comparisonByKey = (selectedResult?.comparison ?? {}) as unknown as Readonly<
    Record<string, number | null | undefined>
  >;
  const formReady =
    form.sourceSearchRunId.trim() !== ""
    && form.parameterHash.trim() !== ""
    && form.oosStartDate.trim() !== ""
    && form.oosEndDate.trim() !== "";

  return (
    <SectionCard
      title="样本外验证（Out-of-Sample Validation）· OOS-001"
      description="把某次参数搜索冻结下来的候选参数，放到**它没参与过**的数据窗口上**真实重跑**回测并重算 canonical 指标，给出样本内外对照。不搜索新参数、不调整参数、不做「好 / 坏」结论。"
      icon={FlaskConical}
      right={
        <Button
          id="oos-refresh-button"
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
      <div className="space-y-4">
        {errorText !== null && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs whitespace-pre-wrap text-destructive">
            {errorText}
          </div>
        )}
        {message !== null && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs whitespace-pre-wrap text-emerald-800">
            {message}
          </div>
        )}

        {/* ---------------- 创建（只冻结配置，不执行） ---------------- */}
        <div id="oos-create-section" className="rounded-md border p-3">
          <div className="mb-2 flex items-start gap-2">
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">新建样本外验证（只冻结配置，不执行）</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                候选参数**只能**用「源 Search Run + 该 Run 内的组合身份（parameterHash）」指定 ——
                参数值由服务端从源组合行读出并**重算哈希复核**；界面上没有任何可以填参数值的位置。
                OOS 窗口必须**晚于**源搜索窗口的结束日（默认禁止重叠），且落在绑定数据集的可用区间内。
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              id="oos-source-search-run-id"
              placeholder="源 Parameter Search Run ID"
              value={form.sourceSearchRunId}
              onChange={(e) => setForm({ ...form, sourceSearchRunId: e.target.value })}
            />
            <Input
              id="oos-parameter-hash"
              placeholder="候选组合身份 parameterHash（64 位 hex）"
              value={form.parameterHash}
              onChange={(e) => setForm({ ...form, parameterHash: e.target.value })}
            />
            <Input
              id="oos-window-start"
              placeholder="OOS 起（YYYY-MM-DD）"
              value={form.oosStartDate}
              onChange={(e) => setForm({ ...form, oosStartDate: e.target.value })}
            />
            <Input
              id="oos-window-end"
              placeholder="OOS 止（YYYY-MM-DD）"
              value={form.oosEndDate}
              onChange={(e) => setForm({ ...form, oosEndDate: e.target.value })}
            />
          </div>
          <div className="mt-2">
            <Button
              id="oos-create-button"
              size="sm"
              onClick={() => void handleCreate()}
              disabled={!formReady || createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Target className="mr-1.5 h-4 w-4" />
              )}
              {createMutation.isPending ? "正在冻结配置…" : "冻结配置（不执行）"}
            </Button>
          </div>
        </div>

        {/* ---------------- Run 列表 ---------------- */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>OOS Run</TableHead>
                <TableHead>源 Search Run</TableHead>
                <TableHead>OOS 窗口</TableHead>
                <TableHead>策略身份</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(runs.data ?? []).map((run) => (
                <TableRow
                  key={run.oosRunId}
                  id={`oos-row-${run.oosRunId}`}
                  className="cursor-pointer"
                  onClick={() => selectRun(run.oosRunId)}
                >
                  <TableCell className="font-mono text-xs">{run.oosRunId}</TableCell>
                  <TableCell className="font-mono text-xs">{run.sourceSearchRunId}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {run.oosWindow.startDate}..{run.oosWindow.endDate}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{run.strategyVersionId}</TableCell>
                  <TableCell>
                    <StatusBadge
                      status={run.status}
                      label={STATUS_LABEL[run.status] ?? run.status}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(runs.data ?? []).length === 0 && !runs.isLoading && (
            <div className="p-4">
              <EmptyState
                icon={FlaskConical}
                title="还没有样本外验证记录"
                description="先在上方填「源 Search Run + 组合身份 + OOS 窗口」冻结配置，再点「执行」。"
              />
            </div>
          )}
        </div>

        {/* ---------------- 详情 ---------------- */}
        {selectedRunId !== null && detail.isLoading && (
          <div className="flex items-center gap-2 rounded-md border p-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在加载 OOS 验证 {selectedRunId}…
          </div>
        )}

        {selectedRun !== null && (
          <div id="oos-detail-section" className="space-y-4 rounded-md border p-3">
            {/* ---- OOS Run 六项（§4 的冻结坐标）---- */}
            <div>
              <p className="mb-2 text-sm font-medium">OOS Run 冻结坐标（六项）</p>
              <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <Field label="① 源 Search Run" value={<span className="font-mono">{selectedRun.sourceSearchRunId}</span>} />
                <Field
                  label="② 候选身份 parameterHash"
                  value={<span className="font-mono break-all">{selectedRun.sourceParameterHash}</span>}
                />
                <Field
                  label="③ 策略身份 strategyVersionId"
                  value={<span className="font-mono">{selectedRun.strategyVersionId}</span>}
                  hint={selectedRun.strategyDefinitionFingerprint === null
                    ? "未冻结定义指纹（Core 定义不可构造）"
                    : `定义指纹 ${selectedRun.strategyDefinitionFingerprint.slice(0, 16)}…`}
                />
                <Field
                  label="④ 数据集坐标 datasetVersionId"
                  value={<span className="font-mono">{valueText(selectedRun.datasetVersionId)}</span>}
                  hint={selectedRun.datasetVersionLabel === null
                    ? "无 label 快照"
                    : `label ${selectedRun.datasetVersionLabel}（仅展示）`}
                />
                <Field
                  label="⑤ OOS 窗口"
                  value={
                    <span className="font-mono">
                      {selectedRun.oosWindow.startDate}..{selectedRun.oosWindow.endDate}
                    </span>
                  }
                  hint={`源搜索窗口 ${selectedRun.searchWindow.startDate}..${selectedRun.searchWindow.endDate}`}
                />
                <Field
                  label="⑥ 状态 / 口径"
                  value={<StatusBadge status={selectedRun.status} label={STATUS_LABEL[selectedRun.status] ?? selectedRun.status} />}
                  hint={`指标口径 ${selectedRun.metricsVersion}　引擎 ${selectedRun.engineVersion}　执行政策 v${String(selectedRun.executionPolicyVersion)}`}
                />
              </div>
              <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                <div>
                  <span className="text-foreground">冻结参数集：</span>
                  <span className="font-mono">{parametersText(selectedRun.resolvedParameterSet)}</span>
                  <span className="ml-2">（写入即冻结；执行时只用这一份）</span>
                </div>
                <div>
                  <span className="text-foreground">固定坐标：</span>
                  <span className="font-mono">{parametersText(selectedRun.fixedCoordinates)}</span>
                </div>
                <div className="font-mono">运行内容指纹 {selectedRun.runFingerprint}</div>
                <div className="font-mono">
                  创建 {selectedRun.createdAt}
                  {selectedRun.startedAt === null ? "" : `　首次执行 ${selectedRun.startedAt}`}
                  {selectedRun.completedAt === null ? "" : `　终态 ${selectedRun.completedAt}`}
                </div>
              </div>
              {selectedRun.errorCode !== null && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-medium">{selectedRun.errorCode}</p>
                    <p className="mt-0.5 whitespace-pre-wrap">{selectedRun.errorMessage ?? ""}</p>
                  </div>
                </div>
              )}
              {(selectedRun.notes ?? []).length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {(selectedRun.notes ?? []).map((note, index) => (
                    <li key={`${String(index)}-${note.slice(0, 12)}`}>· {note}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* ---- 操作 ---- */}
            <div className="flex flex-wrap gap-2">
              <Button
                id="oos-start-button"
                size="sm"
                onClick={() => void handleStart(selectedRun.oosRunId)}
                disabled={
                  startMutation.isPending
                  || selectedRun.status === "RUNNING"
                  || selectedRun.status === "COMPLETED"
                }
              >
                {startMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-1.5 h-4 w-4" />
                )}
                {startMutation.isPending ? "正在样本外真实重跑（分钟级）…" : "执行样本外验证"}
              </Button>
              <Button
                id="oos-cancel-button"
                size="sm"
                variant="outline"
                onClick={() => void handleCancel(selectedRun.oosRunId)}
                disabled={
                  cancelMutation.isPending
                  || selectedRun.status === "COMPLETED"
                  || selectedRun.status === "CANCELLED"
                }
              >
                {cancelMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Ban className="mr-1.5 h-4 w-4" />
                )}
                {cancelMutation.isPending ? "正在取消…" : "取消"}
              </Button>
              {selectedRun.status === "COMPLETED" && (
                <span className="self-center text-xs text-muted-foreground">
                  该验证已完成 ⇒ 不允许再次执行（规格 §12）；重复点击只会幂等返回既有结果。
                </span>
              )}
            </div>

            {/* ---- Result 六项（IS × OOS 对照）---- */}
            {selectedResult === null ? (
              <EmptyState
                icon={FlaskConical}
                title="尚无结果行"
                description={
                  selectedRun.status === "COMPLETED"
                    ? "该验证已 COMPLETED 但没有结果行 —— 这属于异常，请检查后端留档。"
                    : "结果会在「执行样本外验证」之后产生。当前状态为「"
                      + (STATUS_LABEL[selectedRun.status] ?? selectedRun.status)
                      + "」。"
                }
              />
            ) : (
              <div id="oos-result-section" className="space-y-3">
                <div>
                  <p className="mb-2 text-sm font-medium">
                    Result 六项：样本内（IS）与样本外（OOS）逐项对照
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>指标</TableHead>
                        <TableHead>样本内 IS</TableHead>
                        <TableHead>样本外 OOS</TableHead>
                        <TableHead>OOS − IS</TableHead>
                        <TableHead>OOS / IS</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {METRIC_ROWS.map((row) => (
                        <TableRow key={row.key} id={`oos-metric-${row.key}`}>
                          <TableCell className="text-xs">{row.label}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {num((selectedResult.isMetrics as MetricsView)[row.key], row.digits)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {num((selectedResult.oosMetrics as MetricsView)[row.key], row.digits)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {signed(comparisonByKey[`${row.key}Delta`], row.digits)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {ratio(comparisonByKey[`${row.key}Ratio`])}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid gap-2 text-xs sm:grid-cols-3">
                  <Field
                    label="收益退化（IS − OOS，正数=样本外下降）"
                    value={<span className="font-mono">{signed(selectedResult.comparison.totalReturnDegradationPct)} %</span>}
                  />
                  <Field
                    label="回撤变化（OOS − IS，正数=样本外加深）"
                    value={<span className="font-mono">{signed(selectedResult.comparison.drawdownChangePct)} %</span>}
                  />
                  <Field
                    label="交易笔数变化（OOS − IS）"
                    value={<span className="font-mono">{signed(selectedResult.comparison.tradeCountChange, 0)} 笔</span>}
                  />
                </div>

                <div className="grid gap-2 text-xs sm:grid-cols-3">
                  <Field
                    label="IS 读数来源"
                    value={<span className="font-mono">{selectedResult.isMetricsSource}</span>}
                    hint="源 Search 结果的冻结副本（建库时已要求 canonical）"
                  />
                  <Field
                    label="OOS 读数来源"
                    value={<span className="font-mono">{selectedResult.oosMetricsSource}</span>}
                    hint={selectedResult.backtestFingerprint === null
                      ? "无撮合指纹"
                      : `撮合指纹 ${selectedResult.backtestFingerprint.slice(0, 16)}…`}
                  />
                  <Field
                    label="对照是否成立"
                    value={<span className="font-mono">{selectedResult.comparison.comparable ? "成立" : "不成立"}</span>}
                    hint={`${String(selectedResult.comparison.comparableCount)} / 6 项指标两侧同时可用`}
                  />
                </div>

                {!selectedResult.comparison.comparable && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div>
                      <p className="font-medium">本次对照不成立</p>
                      <p className="mt-0.5 whitespace-pre-wrap">
                        {selectedResult.comparison.notes.join("\n") || "（无说明）"}
                      </p>
                    </div>
                  </div>
                )}

                {selectedResult.error !== null && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs whitespace-pre-wrap text-destructive">
                    {selectedResult.error}
                  </div>
                )}

                {selectedResult.notes.length > 0 && (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {selectedResult.notes.map((note, index) => (
                      <li key={`${String(index)}-${note.slice(0, 12)}`}>· {note}</li>
                    ))}
                  </ul>
                )}

                <div className="font-mono text-xs text-muted-foreground">
                  结果指纹 {selectedResult.fingerprint}
                  {selectedResult.evaluationId === null ? "" : `　评估产物 ${selectedResult.evaluationId}`}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 小部件
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded border px-2 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-xs">{value}</div>
      {hint !== undefined && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
