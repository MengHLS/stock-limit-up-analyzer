/**
 * STEP 12.5 — Historical State Reconstruction：纯函数核心（无 IO、确定性）。
 *
 * resolveSecurityHistoricalState(input, tradeDate, options) 是「对任意 (security, date) 的
 * asOf(T) 查询」的唯一纯函数实现：
 *   - 身份 / 代码：      STEP 7.4 identifiers 在 tradeDate 的 primary（否则别名）解析 + canonical code；
 *   - 上市/退市/可交易： 复用 STEP 11 resolveHistoricalUniverse 的默认拒绝语义（含 LISTING/TRADING/
 *                       ST/DELISTING/SUSPENSION 快照 + 稳定剔除原因 + asOf PIT + calendar T+1）；
 *   - 行业：             STEP 7.6 getIndustryAt（retrievedAt PIT，重叠即抛错）；
 *   - 流动性 / 价格：    tradeDate 日级事实（当日收盘后可知；决策点过滤属 decisionPoint 语义）；
 *   - 公司行为：         STEP 7.7 integration（已生效 = effectiveDate<=tradeDate；
 *                       可知 = PIT 时 announcementDate<=asOf，announcementDate 缺失保守视为不可知）；
 *   - 市场状态：         tradeDate 核心指数日线（按 indexCode 升序）；
 *   - 可知性审计：       每个维度独立标注 KNOWN/UNKNOWN（缺失不等于「无事实」，禁止默认填充）。
 *
 * 反泄漏边界（与铁律 §4/§5 一致）：
 *   - asOf = null（默认）为「全知视角」，仅供调试/审计；研究口径必须显式传 asOf。
 *   - 提供 code 键日级数据但代码与 tradeDate 生效代码不一致 → 抛错（默认拒绝，禁止静默错配）。
 *   - code 归属 helper（isCodeOwnedBySecurityAt / isCodeIntervalOwnedBySecurity）供 DB 加载层
 *     过滤「代码复用」场景下其它证券的历史数据（见 loader 注释）。
 */

import {
  actionsEffectiveOnOrBefore,
  filterActionsKnownAt,
} from "../corporateActions/integration";
import { canonicalCode } from "../security/code";
import { isValidIsoDate } from "../security/dates";
import {
  resolveHistoricalUniverse,
  type ExclusionReason,
  type HistoricalStStatus,
} from "../security/historicalUniverse";
import { intervalContains, intervalsOverlap } from "../security/identifierHistory";
import type { Exchange, SecurityIdentifier } from "../security/types";
import { getIndustryAt } from "../marketData/industry";
import type {
  IndustryAssignment,
  IndexDailyBar,
  IndexMasterEntry,
} from "../marketData/types";
import type { CorporateAction } from "../corporateActions/types";
import type { SecurityStatusSnapshot } from "../securityStatus/types";
import type {
  CorporateActionsState,
  HistoricalKnowledge,
  HistoricalStateInput,
  HistoricalStateOptions,
  IndustryState,
  KnowledgePolicy,
  LifecycleVerdict,
  MarketStateEntry,
  SecurityHistoricalState,
} from "./types";

// ---------------------------------------------------------------------------
// 基础校验
// ---------------------------------------------------------------------------

/** 只做形态校验（YYYY-MM-DD）；深层语义（如行业区间重叠）由各 STEP 模块自行校验。 */
function assertIsoDate(value: string, label: string): void {
  if (!isValidIsoDate(value)) throw new Error(`${label} 非法日期（需 YYYY-MM-DD）：${value}`);
}

// ---------------------------------------------------------------------------
// 身份解析
// ---------------------------------------------------------------------------

/**
 * 解析某 security 在 date 生效的标识符：优先 primary，其次任意别名。
 * 与 server/security/historicalUniverse 的 resolveActiveIdentifier 语义一致；
 * 多候选时按 (effectiveFrom, code, identifierType) 升序取首个，保证确定性。
 * 无生效标识符返回 null。
 */
export function resolveActiveIdentifierAt(
  identifiers: readonly SecurityIdentifier[],
  securityId: string,
  date: string,
): SecurityIdentifier | null {
  const candidates = identifiers.filter(
    (identifier) =>
      identifier.securityId === securityId &&
      intervalContains(identifier.effectiveFrom, identifier.effectiveTo, date),
  );
  if (candidates.length === 0) return null;
  const primary = candidates.filter((identifier) => identifier.identifierType === "primary");
  const pool = primary.length > 0 ? primary : candidates;
  const sorted = pool
    .slice()
    .sort(
      (a, b) =>
        a.effectiveFrom.localeCompare(b.effectiveFrom) ||
        a.code.localeCompare(b.code) ||
        a.identifierType.localeCompare(b.identifierType),
    );
  return sorted[0]!;
}

// ---------------------------------------------------------------------------
// code 归属（防代码复用串扰）
// ---------------------------------------------------------------------------

/**
 * 该 security 在 date 是否「拥有」该 6 位代码（即 date 落在其任一标识符有效区间内）。
 * 用于 DB 加载层过滤 code 键数据（industry/liquidity/price/CA）：代码复用时，
 * 同一 code 在其它区间属于别的 security，必须剔除，禁止把他人历史拼进本 security。
 */
export function isCodeOwnedBySecurityAt(
  identifiers: readonly SecurityIdentifier[],
  securityId: string,
  digits: string,
  exchange: Exchange,
  date: string,
): boolean {
  return identifiers.some(
    (identifier) =>
      identifier.securityId === securityId &&
      identifier.exchange === exchange &&
      identifier.code === digits &&
      intervalContains(identifier.effectiveFrom, identifier.effectiveTo, date),
  );
}

/**
 * 该 security 是否在 [from, to]（闭区间）内任一时刻拥有该代码
 * （= 存在本 security 对该 (exchange, code) 的标识符区间与 [from, to] 重叠）。
 * 用于行业等「区间型」code 键数据的归属过滤。
 */
export function isCodeIntervalOwnedBySecurity(
  identifiers: readonly SecurityIdentifier[],
  securityId: string,
  digits: string,
  exchange: Exchange,
  from: string,
  to: string | null,
): boolean {
  return identifiers.some(
    (identifier) =>
      identifier.securityId === securityId &&
      identifier.exchange === exchange &&
      identifier.code === digits &&
      intervalsOverlap(identifier.effectiveFrom, identifier.effectiveTo, from, to),
  );
}

// ---------------------------------------------------------------------------
// 维度解析
// ---------------------------------------------------------------------------

/** Q2/Q3 生命周期裁决（描述性；结合 master 时间界 + LISTING/DELISTING 维度）。 */
function resolveLifecycleVerdict(
  security: { listedDate: string | null; delistedDate: string | null },
  listing: SecurityStatusSnapshot["resolved"]["LISTING"] | undefined,
  delisting: SecurityStatusSnapshot["resolved"]["DELISTING"] | undefined,
  tradeDate: string,
): LifecycleVerdict {
  if (listing?.statusValue === "DELISTED") return "DELISTED";
  if (delisting?.statusValue === "DELISTED") return "DELISTED";
  if (listing?.statusValue === "NOT_YET_LISTED") return "NOT_YET_LISTED";

  const { listedDate, delistedDate } = security;
  if (listedDate !== null && tradeDate < listedDate) return "NOT_YET_LISTED";
  if (delistedDate !== null && tradeDate > delistedDate) return "DELISTED";
  if (listedDate !== null && (delistedDate === null || tradeDate <= delistedDate)) {
    return "LISTED";
  }
  if (listing?.statusValue === "LISTED") return "LISTED";
  return "UNKNOWN";
}

/** Q4 行业：按 (tradeDate, asOf) 解析；无归属 / 未加载 / 无 code → null。 */
function resolveIndustryState(
  assignments: readonly IndustryAssignment[] | undefined,
  code: string | null,
  tradeDate: string,
  asOf: string | null,
): IndustryState | null {
  if (assignments === undefined || code === null) return null;
  const assignment = getIndustryAt(assignments, code, tradeDate, { asOf });
  if (assignment === null) return null;
  return {
    industryCode: assignment.industryCode,
    industryName: assignment.industryName,
    effectiveFrom: assignment.effectiveFrom,
    effectiveTo: assignment.effectiveTo,
    source: assignment.source,
  };
}

/** 断言 code 键日级事实的归属代码与 tradeDate 生效代码一致（不一致 = 数据错配，抛错）。 */
function assertCodeKeyedFact(code: string | null, symbol: string, label: string): void {
  if (code === null || symbol !== code) {
    throw new Error(
      `${label} 的代码 ${symbol} 与 ${code === null ? "（无生效标识符）" : `tradeDate 生效代码 ${code}`} 不一致，` +
        `禁止把错误代码的日级数据装配进本 security 的状态`,
    );
  }
}

/** Q8 公司行为：按 effectiveDate 与 announcementDate（PIT）双层过滤。 */
function resolveCorporateActionsState(
  actions: readonly CorporateAction[] | undefined,
  tradeDate: string,
  asOf: string | null,
): CorporateActionsState {
  const policy: KnowledgePolicy = asOf === null ? "FULL_KNOWLEDGE" : "PIT";
  const sortKey = (action: CorporateAction) =>
    `${action.effectiveDate}|${action.actionType}|${action.announcementDate ?? ""}|${action.securityCode}`;
  const effective = actionsEffectiveOnOrBefore(actions ?? [], tradeDate)
    .slice()
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
  const knownAtAsOf =
    policy === "PIT" ? filterActionsKnownAt(effective, asOf!) : effective.slice();
  return { policy, effectiveOnOrBefore: effective, knownAtAsOf };
}

/** Q9 市场状态：核心指数日线，按 indexCode 升序（确定性）。 */
function resolveMarketState(
  indexBars: readonly IndexDailyBar[] | undefined,
  indexMaster: readonly IndexMasterEntry[] | undefined,
): MarketStateEntry[] {
  const nameByCode = new Map((indexMaster ?? []).map((entry) => [entry.indexCode, entry.indexName]));
  return (indexBars ?? [])
    .slice()
    .sort((a, b) => a.indexCode.localeCompare(b.indexCode))
    .map((bar) => ({ indexCode: bar.indexCode, indexName: nameByCode.get(bar.indexCode) ?? null, bar }));
}

/** Q10 可知性审计。 */
function resolveKnowledge(
  policy: KnowledgePolicy,
  listingKnown: boolean,
  delistingKnown: boolean,
  tradingKnown: boolean,
  industry: IndustryState | null,
  liquidityKnown: boolean,
  priceKnown: boolean,
  corporateActionsLoaded: boolean,
  marketStateLength: number,
  asOf: string | null,
): HistoricalKnowledge {
  const note =
    policy === "PIT"
      ? `PIT 口径（asOf=${asOf}）：状态维度按 availability（T+1=下一交易日）、行业按 retrievedAt、` +
        `公司行为按 announcementDate 过滤；缺失 announcementDate 的事件保守视为不可知。` +
        `OHLCV/流动性/核心指数日线为 tradeDate 日级事实（收盘后可知），盘中决策点过滤属 decisionPoint 语义。`
      : `全知视角（asOf=null）：不过滤未来可知信息，仅供调试/审计，研究口径必须显式传 asOf。` +
        `OHLCV/流动性/核心指数日线为 tradeDate 日级事实（收盘后可知）。`;
  return {
    policy,
    dimensions: {
      identity: "KNOWN",
      listing: listingKnown ? "KNOWN" : "UNKNOWN",
      delisting: delistingKnown ? "KNOWN" : "UNKNOWN",
      tradability: tradingKnown ? "KNOWN" : "UNKNOWN",
      industry: industry !== null ? "KNOWN" : "UNKNOWN",
      liquidity: liquidityKnown ? "KNOWN" : "UNKNOWN",
      price: priceKnown ? "KNOWN" : "UNKNOWN",
      corporateActions: corporateActionsLoaded ? "KNOWN" : "UNKNOWN",
      marketState: marketStateLength > 0 ? "KNOWN" : "UNKNOWN",
    },
    note,
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 重建某 security 在 tradeDate 的完整历史状态（asOf(T)）。
 *
 * @param input 各数据域的纯数据输入（调用方负责从 DB 加载并做 code 归属过滤）。
 * @param tradeDate 被查询的交易日（YYYY-MM-DD）。
 * @param options.asOf point-in-time 信息截止点；null = 全知视角（默认，仅供调试/审计）。
 * @param options.calendar 可选交易日历（T+1 用下一交易日；isTradingDay 判定）。
 * @returns 完整 SecurityHistoricalState；纯函数、确定性、无 IO。
 */
export function resolveSecurityHistoricalState(
  input: HistoricalStateInput,
  tradeDate: string,
  options: HistoricalStateOptions = {},
): SecurityHistoricalState {
  assertIsoDate(tradeDate, "tradeDate");
  const asOf = options.asOf ?? null;
  if (asOf !== null) assertIsoDate(asOf, "asOf");
  const calendar = options.calendar ?? null;

  const { security, identifiers, statusIntervals } = input;
  const active = resolveActiveIdentifierAt(identifiers, security.securityId, tradeDate);
  const codeDigits = active?.code ?? null;
  const code = active === null ? null : canonicalCode({ digits: active.code, exchange: active.exchange });

  // 可交易判定 + 状态快照：复用 STEP 11 的默认拒绝语义（含 asOf/calendar PIT）。
  const universe = resolveHistoricalUniverse(
    { securities: [security], identifiers, statusIntervals, calendar: calendar ?? undefined },
    tradeDate,
    { asOf, includeExcluded: true },
  );
  const member = universe.members[0] ?? null;
  const exclusion = member === null ? (universe.excluded[0] ?? null) : null;
  const outcome = member ?? exclusion;
  if (outcome === null) {
    // 不可达：resolveHistoricalUniverse 对单 security 必然落入 members 或 excluded（includeExcluded=true）。
    throw new Error(`内部错误：universe 未返回 ${security.securityId} 的判定结果`);
  }
  const snapshot = outcome.snapshot;
  const st = outcome.st as HistoricalStStatus;
  const reason = exclusion === null ? null : (exclusion.reason as ExclusionReason);
  const listing = snapshot.resolved.LISTING;
  const delisting = snapshot.resolved.DELISTING;
  const trading = snapshot.resolved.TRADING ?? null;
  const suspension = snapshot.resolved.SUSPENSION ?? null;

  const industry = resolveIndustryState(input.industryAssignments, code, tradeDate, asOf);

  // 日级事实（Q6/Q7）：归属代码校验（默认拒绝）。
  const price = input.priceBar ?? null;
  const liquidity = input.liquidity ?? null;
  if (price !== null) assertCodeKeyedFact(code, price.symbol, "priceBar");
  if (liquidity !== null) assertCodeKeyedFact(code, liquidity.securityId, "liquidity");

  const corporateActions = resolveCorporateActionsState(input.corporateActions, tradeDate, asOf);
  const marketState = resolveMarketState(input.indexBars, input.indexMaster);

  return {
    query: {
      securityId: security.securityId,
      tradeDate,
      asOf,
      isTradingDay: calendar === null ? null : calendar.isTradingDay(tradeDate),
      calendar: calendar?.name ?? null,
    },
    identity: {
      securityId: security.securityId,
      securityType: security.securityType,
      exchange: security.exchange,
      currency: security.currency,
      country: security.country,
      codeDigits,
      code,
      identifierType: active?.identifierType ?? null,
      identifierEffectiveFrom: active?.effectiveFrom ?? null,
      identifierEffectiveTo: active?.effectiveTo ?? null,
    },
    lifecycle: {
      masterStatus: security.status,
      listedDate: security.listedDate,
      delistedDate: security.delistedDate,
      listing: listing ?? null,
      delisting: delisting ?? null,
      verdict: resolveLifecycleVerdict(security, listing, delisting, tradeDate),
    },
    tradability: {
      eligible: member !== null,
      reason,
      st,
      trading,
      suspension,
      snapshot,
    },
    industry,
    liquidity,
    price,
    corporateActions,
    marketState,
    knowledge: resolveKnowledge(
      corporateActions.policy,
      listing !== undefined,
      delisting !== undefined,
      trading !== null,
      industry,
      liquidity !== null,
      price !== null,
      input.corporateActions !== undefined,
      marketState.length,
      asOf,
    ),
  };
}
