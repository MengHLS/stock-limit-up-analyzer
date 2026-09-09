/**
 * STEP DS-V2 — Research Dataset Preview（C-12.6.5）。
 *
 * 目标（任务 §4/§17）：配置后「先预览再构建」。预览不构建全量 dataset（不回传 rows、
 * 不做逐日 OHLCV 明细加载），而是：
 *   1. 元数据探测（aggregate，不扫 8M+ OHLCV 明细）；
 *   2. 静态加载（securities/identifiers/status/calendar，一次复用）；
 *   3. 对窗口内交易日做**内存内** universe 决议（复用 resolveUniverseDefinition，无 DB 往返）；
 *   4. 汇总 universe / 覆盖率 / PIT / survivorship / industry / liquidity / CA / quality 摘要。
 *
 * 铁律：预览是「元数据 + 内存决议」的诚实摘要，不是完整构建；window 超限时显式 truncated，
 *   不把「部分预览」冒充「全窗口事实」。
 */

import { loadResearchDatasetStatic } from "./db";
import { resolveUniverseDefinition } from "./universe";
import {
  normalizeResearchDatasetRequest,
  validateNormalizedResearchDatasetRequest,
} from "./validate";
import { probeDatasetMetadata, deriveCapabilityFacts } from "./capability";
import type { DatasetDomainMetadata } from "./capability";
import type { DatasetCapabilityStatus } from "./certify";
import type { NormalizedResearchDatasetRequest, ResearchDatasetRequest } from "./types";

/** 预览摘要。 */
export interface DatasetPreviewResult {
  /** 规范化后的请求（含 asOf 口径）。 */
  request: NormalizedResearchDatasetRequest;
  /** 预览窗口（请求窗口 ∩ 日历）。 */
  dateRange: { startDate: string; endDate: string };
  /** 实际解析的交易日数（可能因 cap 截断）。 */
  tradingDays: number;
  /** 窗口内首个/末个交易日（未截断时）。 */
  firstTradingDay: string | null;
  lastTradingDay: string | null;
  /** 是否因 maxTradingDays 截断（诚实标记）。 */
  truncated: boolean;
  /** 请求窗口内实际交易日总数（截断前）。 */
  totalTradingDays: number;
  universe: {
    /** 全市场证券总数。 */
    totalSecurities: number;
    /** 已退市证券数（survivorship 证据）。 */
    delistedSecurities: number;
    /** 决议出的日均成员数（截断窗口内）。 */
    avgMembersPerDay: number;
    /** 成员-日合计（截断窗口内）。 */
    memberDays: number;
    /** 预估标准行数（= 截断窗口 memberDays；完整构建 = totalTradingDays × 日均）。 */
    estimatedBarCount: number;
  };
  pit: { mode: "asOfPerTradeDate" | "fixed"; safe: boolean; note: string };
  survivorship: { safe: boolean; note: string };
  historicalState: { available: boolean; note: string };
  industry: { status: DatasetCapabilityStatus; note: string };
  liquidity: { status: DatasetCapabilityStatus; note: string };
  corporateAction: { status: DatasetCapabilityStatus; note: string };
  coverage: {
    /** OHLCV 日期覆盖跨度（自然日，粗粒度；精确交易日覆盖见完整构建 dataSnapshot）。 */
    priceDates: number;
    /** 流动性日期覆盖跨度（自然日，粗粒度）。 */
    liquidityDates: number;
    priceWindowCoverage: number | null;
    liquidityWindowCoverage: number | null;
  };
  /** universe 过滤层摘要（板块/ST 已计入预览；T 日条件仅完整构建时生效）。 */
  universeFilter: {
    boards: string[];
    excludeSt: boolean;
    tDayCondition: string;
    note: string;
  };
  /** 预览 verdict（与 gate 三态一致：FAIL / PASS / INCONCLUSIVE）。 */
  verdict: "FAIL" | "PASS" | "INCONCLUSIVE";
  verdictNotes: string[];
}

const DEFAULT_PREVIEW_MAX_TRADING_DAYS = 250;

/** universe 过滤层摘要（诚实：板块/ST 已计入，T 日条件仅完整构建生效）。 */
function summarizeUniverseFilter(request: NormalizedResearchDatasetRequest): {
  boards: string[];
  excludeSt: boolean;
  tDayCondition: string;
  note: string;
} {
  const filter = request.universeFilter;
  const note =
    filter.tDayCondition !== "none"
      ? "板块/ST 过滤已计入预览；T日条件需逐日价格明细，仅完整构建时生效"
      : filter.boards.length > 0 || filter.excludeSt
        ? "板块/ST 过滤已计入预览"
        : "无过滤（全量可交易池）";
  return {
    boards: [...filter.boards],
    excludeSt: filter.excludeSt,
    tDayCondition: filter.tDayCondition,
    note,
  };
}

/**
 * 预览 Research Dataset（元数据 + 内存决议，不构建全量）。
 * DB 不可用 / 日历为空 → 返回诚实空预览（verdict=INCONCLUSIVE，不伪造）。
 */
export async function previewResearchDataset(
  rawRequest: ResearchDatasetRequest,
  options: { maxTradingDays?: number } = {},
): Promise<DatasetPreviewResult> {
  const request = normalizeResearchDatasetRequest(rawRequest);
  const issues = validateNormalizedResearchDatasetRequest(request);
  if (issues.length > 0) {
    throw new Error(`Research Dataset 请求非法：${issues.map((i) => `[${i.code}] ${i.message}`).join("；")}`);
  }

  const maxTradingDays = options.maxTradingDays ?? DEFAULT_PREVIEW_MAX_TRADING_DAYS;
  const metadata = await probeDatasetMetadata();
  const facts = deriveCapabilityFacts(metadata);
  const staticLoad = await loadResearchDatasetStatic();

  const notes: string[] = [];
  if (staticLoad.calendar === null || staticLoad.securities.length === 0) {
    notes.push("DB 不可用或无交易日历（index_daily 为空），无法决议 universe");
    return {
      request,
      dateRange: { startDate: request.startDate, endDate: request.endDate },
      tradingDays: 0,
      firstTradingDay: null,
      lastTradingDay: null,
      truncated: false,
      totalTradingDays: 0,
      universe: {
        totalSecurities: metadata.securitiesTotal,
        delistedSecurities: metadata.securitiesDelisted,
        avgMembersPerDay: 0,
        memberDays: 0,
        estimatedBarCount: 0,
      },
      pit: {
        mode: request.asOfPerTradeDate ? "asOfPerTradeDate" : "fixed",
        safe: request.asOfPerTradeDate,
        note: request.asOfPerTradeDate ? "逐日 PIT（asOf=tradeDate）" : "固定快照含未来知识（NON_RESEARCH_SAFE）",
      },
      survivorship: { safe: true, note: "B Master 全表含退市 + 逐日生命周期（结构性保证）" },
      historicalState: { available: false, note: "DB 不可用" },
      industry: { status: facts.industryHistoricalPit, note: industryNote(facts.industryHistoricalPit, metadata) },
      liquidity: { status: facts.liquidityHistoricalCoverage, note: liquidityNote(facts.liquidityHistoricalCoverage, metadata) },
      corporateAction: { status: facts.corporateActionPit, note: caNote(facts.corporateActionPit, metadata) },
      coverage: { priceDates: 0, liquidityDates: 0, priceWindowCoverage: null, liquidityWindowCoverage: null },
      universeFilter: summarizeUniverseFilter(request),
      verdict: "INCONCLUSIVE",
      verdictNotes: notes,
    };
  }

  const calendar = staticLoad.calendar;
  const allTradingDays = calendar.tradingDaysBetween(request.startDate, request.endDate);
  const capped = allTradingDays.slice(0, maxTradingDays);
  const truncated = capped.length < allTradingDays.length;

  const universeDefinition = resolveUniverseDefinition(
    {
      securities: staticLoad.securities,
      identifiers: staticLoad.identifiers,
      statusIntervals: staticLoad.statusIntervals,
    },
    calendar,
    capped,
    request,
  );

  let memberDays = 0;
  for (const day of universeDefinition.days) memberDays += day.members.length;
  const avgMembersPerDay = universeDefinition.days.length > 0 ? memberDays / universeDefinition.days.length : 0;
  const totalMemberDaysEstimate = Math.round(avgMembersPerDay * allTradingDays.length);

  const pitSafe = request.asOfPerTradeDate;
  const survivorshipSafe = true; // 结构性保证
  const historicalStateAvailable = metadata.statusIntervals > 0;

  // 覆盖率：以元数据窗口为参考，计算预览窗口与价格/流动性日期覆盖的重叠比例（粗粒度）。
  const priceWindowCoverage = computeWindowCoverage(
    request.startDate,
    request.endDate,
    metadata.priceEarliestDate,
    metadata.priceLatestDate,
  );
  const liquidityWindowCoverage = computeWindowCoverage(
    request.startDate,
    request.endDate,
    metadata.liquidityEarliestDate,
    metadata.liquidityLatestDate,
  );

  let verdict: "FAIL" | "PASS" | "INCONCLUSIVE" = "INCONCLUSIVE";
  if (!pitSafe) {
    notes.push("固定快照含未来知识，NON_RESEARCH_SAFE");
  }
  if (priceWindowCoverage !== null && priceWindowCoverage < 1) {
    notes.push(`OHLCV 日期覆盖缺口（窗口覆盖率 ${(priceWindowCoverage * 100).toFixed(1)}%）`);
  }
  if (truncated) {
    notes.push(`预览窗口截断：仅解析 ${capped.length}/${allTradingDays.length} 个交易日`);
  }
  if (allTradingDays.length === 0) {
    notes.push("请求窗口内无交易日");
    verdict = "INCONCLUSIVE";
  } else if (notes.length === 0) {
    verdict = "PASS";
  } else if (!pitSafe || (priceWindowCoverage !== null && priceWindowCoverage < 1)) {
    verdict = "FAIL";
  }

  return {
    request,
    dateRange: { startDate: request.startDate, endDate: request.endDate },
    tradingDays: capped.length,
    firstTradingDay: capped[0] ?? null,
    lastTradingDay: capped[capped.length - 1] ?? null,
    truncated,
    totalTradingDays: allTradingDays.length,
    universe: {
      totalSecurities: metadata.securitiesTotal,
      delistedSecurities: metadata.securitiesDelisted,
      avgMembersPerDay,
      memberDays,
      estimatedBarCount: truncated ? totalMemberDaysEstimate : memberDays,
    },
    pit: {
      mode: request.asOfPerTradeDate ? "asOfPerTradeDate" : "fixed",
      safe: pitSafe,
      note: pitSafe ? "逐日 PIT（asOf=tradeDate）" : "固定快照含未来知识（NON_RESEARCH_SAFE）",
    },
    survivorship: {
      safe: survivorshipSafe,
      note: survivorshipSafe ? "B Master 全表含退市 + 逐日生命周期（结构性保证）" : "survivorship 不成立",
    },
    historicalState: {
      available: historicalStateAvailable,
      note: historicalStateAvailable
        ? `research_security_status_history ${metadata.statusIntervals} 区间（ST/停牌/退市/上市 PIT）`
        : "历史状态数据缺失",
    },
    industry: { status: facts.industryHistoricalPit, note: industryNote(facts.industryHistoricalPit, metadata) },
    liquidity: { status: facts.liquidityHistoricalCoverage, note: liquidityNote(facts.liquidityHistoricalCoverage, metadata) },
    corporateAction: { status: facts.corporateActionPit, note: caNote(facts.corporateActionPit, metadata) },
    coverage: {
      priceDates: dateSpanOrZero(metadata.priceEarliestDate, metadata.priceLatestDate),
      liquidityDates: dateSpanOrZero(metadata.liquidityEarliestDate, metadata.liquidityLatestDate),
      priceWindowCoverage,
      liquidityWindowCoverage,
    },
    universeFilter: summarizeUniverseFilter(request),
    verdict,
    verdictNotes: notes,
  };
}

// ---------------------------------------------------------------------------
// 摘要辅助
// ---------------------------------------------------------------------------

function computeWindowCoverage(
  windowStart: string,
  windowEnd: string,
  dataStart: string | null,
  dataEnd: string | null,
): number | null {
  if (dataStart === null || dataEnd === null) return null;
  if (dataEnd < windowStart || dataStart > windowEnd) return 0;
  // 粗粒度：以日期跨度估算（交易日级精确覆盖在完整构建的 dataSnapshot 中给出）。
  const overlapStart = dataStart > windowStart ? dataStart : windowStart;
  const overlapEnd = dataEnd < windowEnd ? dataEnd : windowEnd;
  const windowDays = dateSpan(windowStart, windowEnd);
  if (windowDays <= 0) return null;
  const overlapDays = dateSpan(overlapStart, overlapEnd);
  return Math.min(1, overlapDays / windowDays);
}

function dateSpan(start: string, end: string): number {
  const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
  return Math.floor(ms / 86400000) + 1;
}

/** 日期跨度，缺任一端则 0（诚实缺省，不伪造非零覆盖）。 */
function dateSpanOrZero(start: string | null, end: string | null): number {
  if (start === null || end === null) return 0;
  return dateSpan(start, end);
}

/** 日期区间摘要（min ~ max，缺省 → "—"）。 */
function dateRange(earliest: string | null, latest: string | null): string {
  return earliest === null ? "—" : `${earliest} ~ ${latest ?? earliest}`;
}

function industryNote(status: DatasetCapabilityStatus, m: DatasetDomainMetadata): string {
  if (status === "AVAILABLE") return `行业多期历史序列（distinct effectiveFrom=${m.industryDistinctEffectiveFrom}）`;
  if (status === "CONDITIONAL") return `行业 ${m.industryRows} 行但 effectiveFrom 单点，当前快照非历史序列（历史 PIT 不完整）`;
  return "行业数据缺失";
}

function liquidityNote(status: DatasetCapabilityStatus, m: DatasetDomainMetadata): string {
  if (status === "AVAILABLE") return `liquidity_daily 覆盖与 OHLCV 对齐（${dateRange(m.liquidityEarliestDate, m.liquidityLatestDate)}）`;
  if (status === "CONDITIONAL") return `liquidity_daily 覆盖 ${dateRange(m.liquidityEarliestDate, m.liquidityLatestDate)}，历史覆盖不完整（回填中）`;
  return "流动性数据缺失";
}

function caNote(status: DatasetCapabilityStatus, m: DatasetDomainMetadata): string {
  if (status === "AVAILABLE") return `corporate_actions ${m.corporateActionRows} 行，announcementDate 齐备（PIT 完整）`;
  if (status === "CONDITIONAL") return `corporate_actions ${m.corporateActionRows} 行，announcementDate 缺失 ${m.corporateActionMissingAnnouncement}（保守不可知）`;
  return "公司行为数据缺失";
}
