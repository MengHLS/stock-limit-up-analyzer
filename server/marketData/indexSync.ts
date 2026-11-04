/**
 * 指数行情同步 —— 把 `scripts/backfillIndex.ts` 的回填语义搬进 server 服务层，
 * 供「行情同步检查」页面（`/stock-sync`）直接调用。
 *
 * 背景（为什么需要它）：
 *   `index_daily` 是本仓「前向纸面交易推进」的**交易日历唯一来源**，而它此前只有手动
 *   CLI 脚本写入、全仓无任何自动同步 ⇒ 一旦停更，`datesToAdvance` 恒空，推进**静默
 *   no-op 却报成功**。本模块把「把指数补齐到与已同步股票行情齐平」变成一个可点击、
 *   可诊断的动作，并把落后量（自然日 / 交易日）显式暴露给页面。
 *
 * 🔴 复用（禁止第二套实现）：
 *   - provider 取 `marketData/providers#indexProviders`（provider-neutral 注册表）；
 *   - 落库取 `marketData/indexStorage#upsertIndexDaily / upsertIndexMaster`（幂等 upsert）；
 *   - 身份校验取 `marketData/indexes#verifyIndexIdentity`（参考表锚点，不硬编码 provider 数据）。
 *   CLI `scripts/backfillIndex.ts` 保持独立可用，两者共享同一底层，不互相替代。
 *
 * 🔴 智能增量（省配额的核心）：
 *   tushare 的 `index_daily` 配额极紧（5 次/天 + 1 次/分钟，部分时段仅 1 次/小时），
 *   因此本模块**先读本地覆盖再决定请求**：末端只落后时只拉 `[本地末日+1, endDate]`，
 *   绝不整段重拉；已与请求区间齐平的指数直接跳过（0 次请求 = 0 配额消耗）。
 *
 * 🔴 时间预算（避免 HTTP 超时后前端误判失败）：
 *   tushare 逐指数需间隔 65s，4 只 ≈ 3.3 分钟。Node 默认 `requestTimeout` 为 300s，
 *   故循环内置 `MAX_RUN_DURATION_MS` 预算；预算不足时**主动收尾并如实标记** `truncated`
 *   + `pendingIndexCodes`，让用户「再点一次继续」，而不是把长跑留到连接被切断。
 */

import { max, sql } from "drizzle-orm";
import { indexDaily, stockDailyPrices } from "../../drizzle/schema";
import { getDb } from "../db";
import { CORE_INDEX_IDENTITY, normalizeIndexCode, verifyIndexIdentity } from "./indexes";
import {
  buildIndexMasterEntry,
  getIndexDailyCoverage,
  upsertIndexDaily,
  upsertIndexMaster,
} from "./indexStorage";
import { indexProviders } from "./providers";
import { toBaostockCode } from "./providers/baostock";
import { isTusharePermissionLimited } from "./providers/tushare";
import { toSinaSymbol } from "./providers/sina";
import type { IndexDailyBar, IndexMasterEntry } from "./types";

/** 默认同步的指数集合（与 index_daily 现状一致，不引入新序列）。 */
export const INDEX_SYNC_DEFAULT_CODES = ["000001.SH", "399001.SZ", "000300.SH", "000905.SH"] as const;

/** 默认回填起点（与 CLI 及数据集回填窗口一致）。 */
export const INDEX_SYNC_DEFAULT_START = "2019-01-01";

/** 覆盖判定容差（自然日）：容忍区间端点落在周末/长假。 */
const FRESH_TOLERANCE_DAYS = 30;

/** tushare 指数接口请求间隔（ms）：规避 1 次/分钟限频。 */
const TUSHARE_INTERVAL_MS = 65_000;

/** 单次同步的时间预算（ms）：Node 默认 requestTimeout 300s，留 60s 余量。 */
export const MAX_RUN_DURATION_MS = 240_000;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// 纯函数层（不依赖 DB，可独立单测）
// ---------------------------------------------------------------------------

/** 加/减自然日（ISO 往返，UTC 基准，不受本机时区影响）。 */
export function addDays(isoDate: string, days: number): string {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed)) throw new Error(`无效日期：${isoDate}`);
  return new Date(parsed + days * DAY_MS).toISOString().slice(0, 10);
}

/** 两个 ISO 日期之间的自然日差（to - from）。 */
export function diffDays(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) throw new Error(`无效日期区间：${fromIso} ~ ${toIso}`);
  return (to - from) / DAY_MS;
}

/** 今天（本机时区的自然日）。 */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** 本地覆盖快照（与 `getIndexDailyCoverage` 的返回结构对齐，便于纯函数单测注入）。 */
export interface IndexCoverageLike {
  rowCount: number;
  firstDate: string | null;
  lastDate: string | null;
}

/** 单只指数的同步计划。 */
export interface IndexSyncPlan {
  /** 需要请求的区间；`null` = 本次无需请求（0 配额消耗）。 */
  range: { startDate: string; endDate: string } | null;
  /** 动作分类：`skip` 已齐平 / `incremental` 仅末端落后 / `full` 全区间。 */
  action: "skip" | "incremental" | "full";
  /** 人类可读的决策理由（直接展示给用户）。 */
  reason: string;
}

/** `planIndexSync` 的参照选项。 */
export interface IndexSyncPlanOptions {
  /**
   * 「应有数据的最新交易日」参照（页面上传行情末端，即 `stock_daily_prices` 的最大 `tradeDate`）。
   *
   * 🔴 给了它就**严格**比较末日（`lastDate >= 参照` 才算齐平）：行情末端必然是真实交易日，
   * 所以「落后 1 个交易日」就是真落后 —— 用 30 天容差会把这种落后掩盖成「已齐平」，
   * 而那一格正是纸面交易推进卡住的现场（日历落后 ⇒ datesToAdvance 恒空 ⇒ 空转却报成功）。
   * 没给则退回 30 天自然日容差（`endDate` 可能落在周末/长假，严格比较会要求补不存在的日期）。
   */
  referenceDate?: string | null;
}

/**
 * 纯函数：依据本地覆盖与请求区间，决定是否需要请求、请求哪一段。
 *
 * 分支（按优先级）：
 *   1. 本地无数据                → 全区间；
 *   2. `force`                   → 全区间（忽略覆盖，用于换源重拉/修数）；
 *   3. 首尾都已覆盖              → 跳过（0 请求）；
 *   4. 仅末端落后（首部已覆盖）  → 只补 `[末日+1, endDate]`（省配额的常见路径）；
 *   5. 首部也缺失                → 全区间。
 *
 * 首部用 30 天容差（起点 2019-01-01 非交易日，首个交易日为 2019-01-02）；
 * 末端是否容差取决于 `options.referenceDate`（见其注释）。
 */
export function planIndexSync(
  coverage: IndexCoverageLike,
  startDate: string,
  endDate: string,
  force = false,
  options: IndexSyncPlanOptions = {},
): IndexSyncPlan {
  if (startDate > endDate) throw new Error(`起始日期不能晚于结束日期：${startDate} > ${endDate}`);

  if (coverage.rowCount === 0 || !coverage.firstDate || !coverage.lastDate) {
    return {
      range: { startDate, endDate },
      action: "full",
      reason: "本地无数据，按请求区间全量拉取",
    };
  }

  if (force) {
    return {
      range: { startDate, endDate },
      action: "full",
      reason: `强制重拉（忽略已有 ${coverage.rowCount} 行覆盖）`,
    };
  }

  // 参照日（行情末端，必为真实交易日）优先，且不晚于请求终点；无参照时才退回自然日容差。
  const reference = options.referenceDate ?? null;
  const effectiveEnd = reference && reference <= endDate ? reference : endDate;
  const headCovered = diffDays(startDate, coverage.firstDate) <= FRESH_TOLERANCE_DAYS;
  const tailCovered = reference
    ? coverage.lastDate >= effectiveEnd
    : diffDays(coverage.lastDate, endDate) <= FRESH_TOLERANCE_DAYS;

  if (headCovered && tailCovered) {
    return {
      range: null,
      action: "skip",
      reason: `已覆盖 ${coverage.firstDate} ~ ${coverage.lastDate}（${coverage.rowCount} 行），已对齐 ${effectiveEnd}`,
    };
  }

  if (headCovered) {
    const next = addDays(coverage.lastDate, 1);
    return {
      range: { startDate: next, endDate },
      action: "incremental",
      reason: `仅末端落后，增量补 ${next} ~ ${endDate}（本地末日 ${coverage.lastDate} 早于应有末日 ${effectiveEnd}）`,
    };
  }

  return {
    range: { startDate, endDate },
    action: "full",
    reason: `首部缺失（本地自 ${coverage.firstDate} 起），按请求区间全量拉取`,
  };
}

/** provider 能力/约束描述（直接展示给用户，避免「点了却不知道代价」）。 */
export interface IndexSyncProviderInfo {
  name: string;
  /** 当前环境是否具备调用条件。 */
  available: boolean;
  /** 指数间请求间隔（ms）。 */
  intervalMs: number;
  /** 配额与字段局限说明。 */
  note: string;
}

/** 纯函数：列出可用 provider 及其代价（`env` 可注入以便单测）。 */
export function describeIndexSyncProviders(
  env: Record<string, string | undefined> = process.env,
): IndexSyncProviderInfo[] {
  return [
    {
      name: "tushare",
      available: Boolean(env.TUSHARE_TOKEN),
      intervalMs: TUSHARE_INTERVAL_MS,
      note: "字段最全（含成交额/成交量）。配额极紧：5 次/天 + 1 次/分钟，与股票同步共用配额；多指数需逐只间隔 65 秒。",
    },
    {
      name: "sina",
      available: true,
      intervalMs: 0,
      note: "免配额、可反复调用，适合日常补末端。局限：成交额恒为空，且底层仅返回最近约 1023 个交易日。",
    },
    {
      name: "baostock",
      available: Boolean(env.MARKETDATA_PYTHON),
      intervalMs: 0,
      note: env.MARKETDATA_PYTHON
        ? "免费无配额、可拉全历史。"
        : "未检测到 MARKETDATA_PYTHON，将回退系统 python，可能缺少 baostock 库而失败。",
    },
  ];
}

/** 纯函数：解析同步窗口（默认起点固定，默认终点对齐「行情末端」）。 */
export function resolveIndexSyncWindow(input: {
  startDate?: string;
  endDate?: string;
  marketLastDate?: string | null;
  now?: Date;
}): { startDate: string; endDate: string } {
  const startDate = input.startDate ?? INDEX_SYNC_DEFAULT_START;
  const endDate = input.endDate ?? input.marketLastDate ?? todayIso(input.now);
  if (startDate > endDate) throw new Error(`起始日期不能晚于结束日期：${startDate} > ${endDate}`);
  return { startDate, endDate };
}

/** provider 原生代码（sina/baostock 各有独立映射，tushare 直接用规范化代码）。 */
function providerCodeFor(providerName: string, indexCode: string): string {
  if (providerName === "sina") return toSinaSymbol(indexCode);
  if (providerName === "baostock") return toBaostockCode(indexCode);
  return indexCode;
}

/** provider 数据来源描述（写入 index_master.source）。 */
function providerSource(providerName: string): string {
  if (providerName === "sina") return "sina getKLineData";
  if (providerName === "baostock") return "baostock query_history_k_data_plus (index)";
  return "tushare index_daily";
}

// ---------------------------------------------------------------------------
// 读侧：概览（覆盖 + 落后量 + 待请求量）
// ---------------------------------------------------------------------------

export interface IndexSyncTargetView {
  indexCode: string;
  indexName: string;
  rowCount: number;
  firstDate: string | null;
  lastDate: string | null;
  /** 该指数末日相对「行情末端」落后的自然日数；`null` = 无数据。 */
  lagDays: number | null;
  plan: IndexSyncPlan;
}

export interface IndexSyncOverview {
  provider: string;
  /** 请求窗口（含边界）。 */
  window: { startDate: string; endDate: string };
  /** `stock_daily_prices` 末端 —— 行情真实末端（参照物）。 */
  marketLastDate: string | null;
  /** `index_daily` 末端 —— 纸面交易推进的日历末端。 */
  calendarLastDate: string | null;
  /** 日历末端相对行情末端落后的自然日数（> 0 即落后）。 */
  lagDays: number | null;
  /** 日历末端之后、行情表里仍有行情的交易日个数（真正的「缺几个交易日」）。 */
  lagTradingDays: number | null;
  /** 日历是否已落后于行情（落后即纸面交易推进可能空转）。 */
  calendarStale: boolean;
  targets: IndexSyncTargetView[];
  providers: IndexSyncProviderInfo[];
  /** 本次若执行，需要真正发请求的指数个数（= 预计配额消耗次数）。 */
  pendingIndexCount: number;
}

/** 读 `stock_daily_prices` 末端（行情真实末端）。无库返回 null。 */
export async function getMarketLastDate(): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ lastDate: max(stockDailyPrices.tradeDate) }).from(stockDailyPrices);
  return rows[0]?.lastDate ?? null;
}

/** 读 `index_daily` 末端（纸面交易推进的日历末端）。无库返回 null。 */
export async function getIndexCalendarLastDate(): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ lastDate: max(indexDaily.tradeDate) }).from(indexDaily);
  return rows[0]?.lastDate ?? null;
}

/** 统计「日历末端之后，行情表里仍有行情的交易日个数」。无库或无参返回 0。 */
export async function countTradingDaysAfter(isoDate: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.execute(
    sql`select count(distinct ${stockDailyPrices.tradeDate}) as c from ${stockDailyPrices} where ${stockDailyPrices.tradeDate} > ${isoDate}`,
  );
  const first = (rows as unknown as [Array<{ c: unknown }>])[0]?.[0];
  return Number(first?.c ?? 0);
}

/**
 * 概览：给页面用的只读快照。
 *
 * 落后量给出两种口径 —— 自然日（`lagDays`）与交易日（`lagTradingDays`），
 * 后者是「因此少推了几个交易日」的直接答案。
 */
export async function getIndexSyncOverview(
  input: { provider?: string; indexCodes?: readonly string[]; startDate?: string; endDate?: string } = {},
): Promise<IndexSyncOverview> {
  const provider = input.provider ?? "tushare";
  const indexCodes = (input.indexCodes && input.indexCodes.length > 0
    ? input.indexCodes
    : INDEX_SYNC_DEFAULT_CODES
  ).map((code) => normalizeIndexCode(code));

  const marketLastDate = await getMarketLastDate();
  const calendarLastDate = await getIndexCalendarLastDate();
  const window = resolveIndexSyncWindow({
    startDate: input.startDate,
    endDate: input.endDate,
    marketLastDate,
  });

  const targets: IndexSyncTargetView[] = [];
  for (const indexCode of indexCodes) {
    const coverage = await getIndexDailyCoverage(indexCode);
    const plan = planIndexSync(coverage, window.startDate, window.endDate, false, {
      referenceDate: marketLastDate,
    });
    targets.push({
      indexCode,
      indexName: CORE_INDEX_IDENTITY[indexCode]?.indexName ?? "",
      rowCount: coverage.rowCount,
      firstDate: coverage.firstDate,
      lastDate: coverage.lastDate,
      lagDays: coverage.lastDate && marketLastDate ? diffDays(coverage.lastDate, marketLastDate) : null,
      plan,
    });
  }

  const lagDays =
    calendarLastDate && marketLastDate ? diffDays(calendarLastDate, marketLastDate) : null;
  const lagTradingDays = calendarLastDate ? await countTradingDaysAfter(calendarLastDate) : null;

  return {
    provider,
    window,
    marketLastDate,
    calendarLastDate,
    lagDays,
    lagTradingDays,
    calendarStale: (lagDays ?? 0) > 0,
    targets,
    providers: describeIndexSyncProviders(),
    pendingIndexCount: targets.filter((target) => target.plan.range !== null).length,
  };
}

// ---------------------------------------------------------------------------
// 写侧：执行同步
// ---------------------------------------------------------------------------

export interface IndexSyncOptions {
  provider?: string;
  indexCodes?: readonly string[];
  startDate?: string;
  endDate?: string;
  /** 忽略已有覆盖，强制全区间重拉（换源修数用）。 */
  force?: boolean;
  /** 注入「当前时间」以便测试；默认取系统时间。 */
  now?: () => number;
}

export interface IndexSyncDetail {
  indexCode: string;
  indexName: string;
  outcome: "persisted" | "skipped" | "rejected" | "failed";
  reason: string;
  requestedRange: { startDate: string; endDate: string } | null;
  barCount: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface IndexSyncResult {
  provider: string;
  startDate: string;
  endDate: string;
  requested: number;
  persisted: number;
  skipped: number;
  rejected: number;
  failed: number;
  savedRows: number;
  /** 是否命中 provider 配额/频次限制（命中即中止后续指数）。 */
  rateLimited: boolean;
  /** 本次实际使用的请求间隔（ms）。 */
  intervalMs: number;
  durationMs: number;
  /** 因时间预算提前收尾（未处理的指数列在 `pendingIndexCodes`）。 */
  truncated: boolean;
  pendingIndexCodes: string[];
  details: IndexSyncDetail[];
}

/**
 * 执行指数同步（串行 + 节流 + 时间预算）。
 *
 * 结果语义：
 *   - `skipped` 是**成功语义**（已齐平、0 请求），不是失败；
 *   - `rateLimited` 命中即中止后续指数并如实透出（禁止伪装成成功）；
 *   - `truncated` 表示「预算用尽，剩下的下次再点」，同样如实透出。
 */
export async function runIndexSync(options: IndexSyncOptions = {}): Promise<IndexSyncResult> {
  const providerName = options.provider ?? "tushare";
  const provider = indexProviders[providerName];
  if (!provider) {
    throw new Error(`未知数据源：${providerName}（可选 ${Object.keys(indexProviders).join(" / ")}）`);
  }

  const providerInfo = describeIndexSyncProviders().find((item) => item.name === providerName);
  if (providerInfo && !providerInfo.available) {
    throw new Error(`${providerName} 当前不可用：${providerInfo.note}`);
  }

  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const marketLastDate = await getMarketLastDate();
  const indexCodes = (options.indexCodes && options.indexCodes.length > 0
    ? options.indexCodes
    : INDEX_SYNC_DEFAULT_CODES
  ).map((code) => normalizeIndexCode(code));
  const { startDate, endDate } = resolveIndexSyncWindow({
    startDate: options.startDate,
    endDate: options.endDate,
    marketLastDate,
  });

  const intervalMs = providerInfo?.intervalMs ?? 0;
  const details: IndexSyncDetail[] = [];
  const toPersistMaster: IndexMasterEntry[] = [];
  const toPersistDaily: IndexDailyBar[] = [];
  let persisted = 0;
  let skipped = 0;
  let rejected = 0;
  let failed = 0;
  let rateLimited = false;
  let truncated = false;
  const pendingIndexCodes: string[] = [];

  for (let i = 0; i < indexCodes.length; i += 1) {
    const indexCode = indexCodes[i]!;
    const indexName = CORE_INDEX_IDENTITY[indexCode]?.indexName ?? "";

    // 时间预算：本只请求 + 其后的节流若已超出预算，则收尾（避免 HTTP 超时误判失败）。
    if (i > 0 && now() - startedAt + intervalMs > MAX_RUN_DURATION_MS) {
      truncated = true;
      pendingIndexCodes.push(...indexCodes.slice(i));
      break;
    }

    const coverage = await getIndexDailyCoverage(indexCode);
    const plan = planIndexSync(coverage, startDate, endDate, options.force ?? false, {
      referenceDate: marketLastDate,
    });

    if (plan.range === null) {
      skipped += 1;
      details.push({
        indexCode,
        indexName,
        outcome: "skipped",
        reason: plan.reason,
        requestedRange: null,
        barCount: 0,
        firstDate: coverage.firstDate,
        lastDate: coverage.lastDate,
      });
      continue;
    }

    // 指数间节流（仅当后面还有指数要处理时才等待）。
    if (i > 0 && intervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    let bars: IndexDailyBar[] = [];
    try {
      bars = await provider.fetchDaily(indexCode, plan.range.startDate, plan.range.endDate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 配额/频次限制是「环境性失败」，命中即中止后续指数（继续跑只会连撞）。
      if (isTusharePermissionLimited(error)) {
        rateLimited = true;
        details.push({
          indexCode,
          indexName,
          outcome: "failed",
          reason: `${message}（命中数据源配额/频次限制，已中止后续指数）`,
          requestedRange: plan.range,
          barCount: 0,
          firstDate: coverage.firstDate,
          lastDate: coverage.lastDate,
        });
        failed += 1;
        pendingIndexCodes.push(...indexCodes.slice(i + 1));
        break;
      }
      failed += 1;
      details.push({
        indexCode,
        indexName,
        outcome: "failed",
        reason: message,
        requestedRange: plan.range,
        barCount: 0,
        firstDate: coverage.firstDate,
        lastDate: coverage.lastDate,
      });
      continue;
    }

    if (bars.length === 0) {
      rejected += 1;
      details.push({
        indexCode,
        indexName,
        outcome: "rejected",
        reason: `数据源返回空数据（区间 ${plan.range.startDate} ~ ${plan.range.endDate}；非交易日或数据源未发布）`,
        requestedRange: plan.range,
        barCount: 0,
        firstDate: coverage.firstDate,
        lastDate: coverage.lastDate,
      });
      continue;
    }

    const entry = buildIndexMasterEntry({
      indexCode,
      indexName,
      provider: providerName,
      providerCode: providerCodeFor(providerName, indexCode),
      bars,
      source: providerSource(providerName),
    });

    const verdict = verifyIndexIdentity(entry);
    if (verdict.verdict === "BLOCKED") {
      rejected += 1;
      details.push({
        indexCode,
        indexName,
        outcome: "rejected",
        reason: verdict.issues.map((issue) => issue.message).join("; "),
        requestedRange: plan.range,
        barCount: 0,
        firstDate: coverage.firstDate,
        lastDate: coverage.lastDate,
      });
      continue;
    }

    const dates = bars.map((bar) => bar.tradeDate).sort();
    const firstDate = dates[0]!;
    const lastDate = dates[dates.length - 1]!;
    // CONCERN（名称不符 / 数据早于发布日）不阻断写入，但必须留痕，禁止静默当作正常数据。
    const concernNote =
      verdict.verdict === "CONCERN" ? `；身份告警：${verdict.issues.map((issue) => issue.code).join(",")}` : "";

    toPersistMaster.push(entry);
    toPersistDaily.push(...bars);
    persisted += 1;
    details.push({
      indexCode,
      indexName,
      outcome: "persisted",
      reason: `${plan.reason} ⇒ 取得 ${bars.length} 行（${firstDate} ~ ${lastDate}）${concernNote}`,
      requestedRange: plan.range,
      barCount: bars.length,
      firstDate,
      lastDate,
    });
  }

  await upsertIndexMaster(toPersistMaster);
  const savedDaily = await upsertIndexDaily(toPersistDaily);

  return {
    provider: providerName,
    startDate,
    endDate,
    requested: indexCodes.length,
    persisted,
    skipped,
    rejected,
    failed,
    savedRows: savedDaily,
    rateLimited,
    intervalMs,
    durationMs: now() - startedAt,
    truncated,
    pendingIndexCodes,
    details,
  };
}
