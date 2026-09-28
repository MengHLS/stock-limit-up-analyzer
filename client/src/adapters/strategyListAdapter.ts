/**
 * 策略列表页 — `strategyDomain.strategy.list` + 回测留档 → 卡片 ViewModel。
 *
 * 分层纪律（`API(DTO) → Adapter → ViewModel → UI`）：
 *   - 只做**恒等搬运 + 展示格式化 + 分组聚合**，不估计、不重算任何指标；
 *   - 收益率 / 最大回撤**不在这里算**：留档摘要只有 initialCapital / finalEquity /
 *     tradeCount（没有收益率列），前端自算必然与引擎口径漂移 ⇒ 卡片只并列展示
 *     两个原始金额 + 成交笔数，让人自己看；
 *   - 未知字段一律如实留空，绝不用默认值伪造「有回测」「没回测」的判断。
 *
 * 与 `strategyAdapter` 的边界：那个负责 **StrategyDocument ↔ 编辑 ViewModel**；
 * 本模块负责**列表聚合展示**，不解析文档本体。
 */

/** `strategyDomain.strategy.list` 单行的结构性子集（后端返回 `StrategySummary`）。 */
export interface StrategySummaryRow {
  readonly strategyId: string;
  readonly name: string;
  readonly latestVersion: string;
  readonly status: string;
  readonly description: string | null;
  readonly strategyType: string | null;
  readonly currentVersionId: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 回测留档列表项的展示侧最小字段集（结构性兼容 `ClosedLoopBacktestRunRecordDto`）。 */
export interface BacktestArchiveRow {
  readonly id: number;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: string;
  readonly initialCapital: number | null;
  readonly finalEquity: number | null;
  readonly tradeCount: number | null;
}

/** 某策略「最近一次回测」的展示摘要。 */
export interface LatestBacktestSummary {
  readonly archiveId: number;
  readonly runId: string;
  readonly strategyVersion: string;
  readonly createdAt: string;
  readonly createdAtDisplay: string;
  readonly windowLabel: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly initialCapital: number | null;
  readonly finalEquity: number | null;
  readonly tradeCount: number | null;
}

/** 列表卡片 ViewModel。 */
export interface StrategyCardViewModel {
  readonly strategyId: string;
  readonly name: string;
  readonly latestVersion: string;
  readonly status: string;
  readonly description: string | null;
  readonly strategyType: string | null;
  readonly updatedAt: string;
  readonly updatedAtDisplay: string;
  /** 该策略在留档中的回测次数（当前筛选窗口内）。 */
  readonly backtestCount: number;
  /** 最近一次回测（按 createdAt 倒序取第一条）；`null` = 没有留档。 */
  readonly latestBacktest: LatestBacktestSummary | null;
}

/** 列表页顶部汇总（全部为可核对的原始计数）。 */
export interface StrategyListSummary {
  readonly totalStrategies: number;
  readonly withBacktest: number;
  readonly typedStrategies: number;
  readonly latestBacktestAt: string | null;
}

const ARCHIVE_STATUS_LABEL: Record<string, string> = {
  ALL_EXECUTED: "全部执行完成",
  PARTIAL_BLOCKED: "部分阶段阻塞",
  NO_STAGE_EXECUTED: "未执行任何阶段",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNullableStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNullableNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * ISO（UTC）→ 本地时间展示。解析失败原样返回，不编造时间。
 * （与 `closedLoopBacktestRunAdapter#formatLocalDateTime` 同口径；此处不 import 以免耦合。）
 */
function formatLocalDateTime(iso: string): string {
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

/** 金额展示：千分位 + 0 位小数；缺失显示「—」。 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

/** 计数展示：整数；缺失显示「—」。 */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN").format(Math.trunc(value));
}

/** 单行策略摘要 → 结构性收窄；缺 strategyId 视为无效（返回 null）。 */
function toStrategySummary(raw: unknown): StrategySummaryRow | null {
  if (!isRecord(raw)) return null;
  const strategyId = asStr(raw.strategyId);
  if (strategyId === "") return null;
  return {
    strategyId,
    name: asStr(raw.name),
    latestVersion: asStr(raw.latestVersion),
    status: asStr(raw.status, "Draft"),
    description: asNullableStr(raw.description),
    strategyType: asNullableStr(raw.strategyType),
    currentVersionId: asNullableNum(raw.currentVersionId),
    createdAt: asStr(raw.createdAt),
    updatedAt: asStr(raw.updatedAt),
  };
}

/** 回测留档行 → 结构性收窄；无效（缺 strategyId / createdAt）返回 null。 */
function toBacktestArchive(raw: unknown): BacktestArchiveRow | null {
  if (!isRecord(raw)) return null;
  const strategyId = asStr(raw.strategyId);
  const createdAt = asStr(raw.createdAt);
  if (strategyId === "" || createdAt === "") return null;
  const id = asNullableNum(raw.id);
  if (id === null) return null;
  return {
    id: Math.trunc(id),
    strategyId,
    strategyVersion: asStr(raw.strategyVersion),
    runId: asStr(raw.runId),
    createdAt,
    startDate: asStr(raw.startDate),
    endDate: asStr(raw.endDate),
    status: asStr(raw.status, "UNKNOWN"),
    initialCapital: asNullableNum(raw.initialCapital),
    finalEquity: asNullableNum(raw.finalEquity),
    tradeCount: asNullableNum(raw.tradeCount),
  };
}

function toLatestBacktest(archive: BacktestArchiveRow): LatestBacktestSummary {
  const windowLabel =
    archive.startDate === "" && archive.endDate === ""
      ? "—"
      : `${archive.startDate || "?"} → ${archive.endDate || "?"}`;
  return {
    archiveId: archive.id,
    runId: archive.runId,
    strategyVersion: archive.strategyVersion,
    createdAt: archive.createdAt,
    createdAtDisplay: formatLocalDateTime(archive.createdAt),
    windowLabel,
    status: archive.status,
    statusLabel: ARCHIVE_STATUS_LABEL[archive.status] ?? archive.status,
    initialCapital: archive.initialCapital,
    finalEquity: archive.finalEquity,
    tradeCount: archive.tradeCount,
  };
}

/**
 * 聚合策略摘要 + 回测留档 → 列表卡片 ViewModel。
 *
 * 排序：有回测留档的按 `latestBacktest.createdAt` 倒序在前；
 * 无回测留档的按 `updatedAt` 倒序排在后面（同组内也以 `updatedAt` 倒序兜底）。
 * 回测留档按 `createdAt` 倒序取每个策略的第一条作为「最近一次」。
 * 留档中出现了但 `strategy.list` 没有的 strategyId（已删除策略的历史）**不生成卡片**，
 * 但会计入不做展示 —— 列表以当前策略资产为准。
 */
export function buildStrategyCards(
  rawStrategies: unknown,
  rawArchives: unknown,
): StrategyCardViewModel[] {
  const strategies: StrategySummaryRow[] = [];
  if (Array.isArray(rawStrategies)) {
    for (const item of rawStrategies) {
      const summary = toStrategySummary(item);
      if (summary !== null) strategies.push(summary);
    }
  }

  const archivesByStrategy = new Map<string, BacktestArchiveRow[]>();
  if (Array.isArray(rawArchives)) {
    for (const item of rawArchives) {
      const archive = toBacktestArchive(item);
      if (archive === null) continue;
      const bucket = archivesByStrategy.get(archive.strategyId);
      if (bucket === undefined) archivesByStrategy.set(archive.strategyId, [archive]);
      else bucket.push(archive);
    }
  }
  for (const bucket of archivesByStrategy.values()) {
    bucket.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  const cards = strategies.map((s): StrategyCardViewModel => {
    const bucket = archivesByStrategy.get(s.strategyId) ?? [];
    const latest = bucket[0];
    return {
      strategyId: s.strategyId,
      name: s.name || s.strategyId,
      latestVersion: s.latestVersion,
      status: s.status,
      description: s.description,
      strategyType: s.strategyType,
      updatedAt: s.updatedAt,
      updatedAtDisplay: formatLocalDateTime(s.updatedAt),
      backtestCount: bucket.length,
      latestBacktest: latest === undefined ? null : toLatestBacktest(latest),
    };
  });

  cards.sort((a, b) => {
    const aBacktestAt = a.latestBacktest?.createdAt ?? null;
    const bBacktestAt = b.latestBacktest?.createdAt ?? null;
    if (aBacktestAt !== null && bBacktestAt !== null && aBacktestAt !== bBacktestAt) {
      return aBacktestAt < bBacktestAt ? 1 : -1;
    }
    if (aBacktestAt !== null && bBacktestAt === null) return -1;
    if (aBacktestAt === null && bBacktestAt !== null) return 1;
    return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
  });
  return cards;
}

/** 由卡片列表派生顶部汇总（全部为可核对的原始计数）。 */
export function summarizeStrategyCards(cards: readonly StrategyCardViewModel[]): StrategyListSummary {
  let withBacktest = 0;
  let typedStrategies = 0;
  let latestBacktestAt: string | null = null;
  for (const card of cards) {
    if (card.latestBacktest !== null) {
      withBacktest += 1;
      if (latestBacktestAt === null || card.latestBacktest.createdAt > latestBacktestAt) {
        latestBacktestAt = card.latestBacktest.createdAt;
      }
    }
    if (card.strategyType !== null) typedStrategies += 1;
  }
  return {
    totalStrategies: cards.length,
    withBacktest,
    typedStrategies,
    latestBacktestAt,
  };
}
