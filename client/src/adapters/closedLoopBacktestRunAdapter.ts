/**
 * CLOSED-LOOP-BACKTEST-PERSIST-001 — 回测历史留档（列表）→ ViewModel。
 *
 * 分层纪律（`API(DTO) → Adapter → ViewModel → UI`）：
 *   - 本模块只做**恒等搬运 + 展示格式化**（码表、时间、金额千分位），
 *     **不估计、不重算**：列表页**不显示收益率**，因为那需要重算口径
 *     （引擎的收益率口径含成本/口径参数，展示层自算必然漂移）⇒ 只并列展示
 *     「初始资金 / 期末权益」两个**原始值**，让人自己看。
 *   - **详情页不在这里造轮子**：它直接复用 `closedLoopRunAdapter#buildClosedLoopRunViewModel`
 *     + `ClosedLoopRunResultPanel`（与运行工作台完全同一套渲染 ⇒ 零口径漂移）。
 *
 * 与 legacy 回测历史（`/backtest` 页「历史记录」）的边界：那条读龙头候选回测
 * （`sentiment.listBacktestRuns`），本条读闭环运行留档，**两套不可混用**。
 */

/** 整体状态码 → 人话（与 `ClosedLoopRunResult.overall.status` 取值域一致）。 */
const STATUS_LABEL: Record<string, string> = {
  ALL_EXECUTED: "全部执行完成",
  PARTIAL_BLOCKED: "部分阶段阻塞",
  NO_STAGE_EXECUTED: "未执行任何阶段",
};

/** 数据来源码 → 人话。 */
const DATASET_SOURCE_LABEL: Record<string, string> = {
  registry: "直读已落库数据集",
  rebuild: "从零重建（逐日面板）",
};

export interface ClosedLoopBacktestRunListItemViewModel {
  id: number;
  runId: string;
  /** 原始 ISO（UTC），不加工 —— 需要换算时由展示层决定。 */
  createdAt: string;
  /** 本地时间展示串（仅展示用）。 */
  createdAtDisplay: string;
  strategyId: string;
  strategyVersion: string;
  strategyLabel: string;
  startDate: string;
  endDate: string;
  windowLabel: string;
  status: string;
  statusLabel: string;
  /** 「执行 5 / 阻塞 9 / 跳过 0」 */
  stageSummary: string;
  executedStageCount: number;
  blockedStageCount: number;
  skippedStageCount: number;
  firstBlockedReasonCode: string | null;
  datasetVersion: string | null;
  datasetVersionId: number | null;
  datasetSource: string | null;
  datasetSourceLabel: string;
  /** 装配层如实记录的回落原因；未回落为 null（**不编造**）。 */
  datasetSourceNote: string | null;
  recipeId: string | null;
  initialCapital: number | null;
  finalEquity: number | null;
  tradeCount: number | null;
  equityCurvePointCount: number | null;
  /** 是否有成交明细可看（`null` 视为「未知」→ 不当作「有」）。 */
  hasTrades: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asInt(v: unknown): number {
  const n = asNum(v);
  return n === null ? 0 : Math.trunc(n);
}

/** 金额展示：千分位 + 保留 0 位小数；缺失显示「—」（不显示 0，避免与真实的 0 混淆）。 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

/** 数量展示：整数；缺失显示「—」。 */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN").format(Math.trunc(value));
}

/** ISO（UTC）→ 本地时间展示（解析失败则原样返回，不编造时间）。 */
export function formatLocalDateTime(iso: string): string {
  if (iso === "") return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 单条留档 → ViewModel；缺 id / runId 视为无效（返回 null，调用方保持空态）。 */
export function toClosedLoopBacktestRunListItem(
  raw: unknown,
): ClosedLoopBacktestRunListItemViewModel | null {
  if (!isRecord(raw)) return null;
  const id = asNum(raw.id);
  const runId = asStr(raw.runId);
  if (id === null || runId === null) return null;

  const strategyId = asStr(raw.strategyId) ?? "";
  const strategyVersion = asStr(raw.strategyVersion) ?? "";
  const startDate = asStr(raw.startDate) ?? "";
  const endDate = asStr(raw.endDate) ?? "";
  const status = asStr(raw.status) ?? "UNKNOWN";
  const datasetSource = asStr(raw.datasetSource);
  const executedStageCount = asInt(raw.executedStageCount);
  const blockedStageCount = asInt(raw.blockedStageCount);
  const skippedStageCount = asInt(raw.skippedStageCount);
  const tradeCount = asNum(raw.tradeCount);
  const createdAt = asStr(raw.createdAt) ?? "";

  return {
    id: Math.trunc(id),
    runId,
    createdAt,
    createdAtDisplay: formatLocalDateTime(createdAt),
    strategyId,
    strategyVersion,
    strategyLabel:
      strategyVersion === "" ? strategyId : `${strategyId}@${strategyVersion}`,
    startDate,
    endDate,
    windowLabel:
      startDate === "" && endDate === "" ? "—" : `${startDate || "?"} → ${endDate || "?"}`,
    status,
    statusLabel: STATUS_LABEL[status] ?? status,
    stageSummary: `执行 ${executedStageCount} / 阻塞 ${blockedStageCount} / 跳过 ${skippedStageCount}`,
    executedStageCount,
    blockedStageCount,
    skippedStageCount,
    firstBlockedReasonCode: asStr(raw.firstBlockedReasonCode),
    datasetVersion: asStr(raw.datasetVersion),
    datasetVersionId: asNum(raw.datasetVersionId),
    datasetSource,
    datasetSourceLabel:
      datasetSource === null ? "—" : (DATASET_SOURCE_LABEL[datasetSource] ?? datasetSource),
    datasetSourceNote: asStr(raw.datasetSourceNote),
    recipeId: asStr(raw.recipeId),
    initialCapital: asNum(raw.initialCapital),
    finalEquity: asNum(raw.finalEquity),
    tradeCount,
    equityCurvePointCount: asNum(raw.equityCurvePointCount),
    hasTrades: tradeCount !== null && tradeCount > 0,
  };
}

/** 列表整体映射：丢弃无效条目（不占位、不编造）。 */
export function toClosedLoopBacktestRunList(
  raw: unknown,
): ClosedLoopBacktestRunListItemViewModel[] {
  if (!Array.isArray(raw)) return [];
  const out: ClosedLoopBacktestRunListItemViewModel[] = [];
  for (const item of raw) {
    const view = toClosedLoopBacktestRunListItem(item);
    if (view !== null) out.push(view);
  }
  return out;
}
