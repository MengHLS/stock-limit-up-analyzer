/**
 * STEP 11 / Work C — Historical Tradable Universe（历史可交易股票池）canonical 集成层。
 *
 * 把 STEP 7.4 Security Master + Identifier History、STEP 7.5 Historical Status、
 * Trading Calendar 真正整合为「无 survivorship bias 的历史可交易 universe」的单一事实来源。
 *
 * 关键语义（默认拒绝，禁止静默放行）：
 *   - 永久身份：一切判定以 security_id 为键，绝不把 stock_code 冒充 security_id。
 *   - as-of：以 tradeDate 为准，绝不使用今天的股票列表；历史状态绝不回填当前状态。
 *   - point-in-time：可选 asOf 截止点，保证未来状态不泄漏到过去。
 *   - 交易日历：T+1 用「下一交易日」，绝不用 calendar date + 1。
 *
 * 维度分类（明确记录，禁止静默改变既有业务语义）：
 *   - 正向确认维度（UNKNOWN → 拒绝）：LISTING、TRADING。
 *   - 负向阻断维度（仅显式负向阻断；UNKNOWN/缺失 → 放行）：SUSPENSION、DELISTING。
 *   - 信息维度（永不阻断，仅随结果携带）：ST（NORMAL/ST/*ST/UNKNOWN）。
 *
 * ST 是否影响 Universe eligibility？—— 不影响。理由：
 *   ST / *ST 是「特别处理」风险标签，不是停牌；ST 股票仍以 ±5% 涨跌幅正常交易。
 *   把 ST 视为不可交易会错误地把大量可交易标的踢出 universe（历史 ST 误判）。
 *   因此 ST 作为独立信息维度随结果返回，供下游策略/风控自行决定是否过滤。
 */

import { compareDate } from "./dates";
import { intervalContains } from "./identifierHistory";
import { resolveSecurityStatus } from "../securityStatus/timeline";
import type { SecurityStatusInterval, SecurityStatusSnapshot } from "../securityStatus/types";
import type { Exchange, Security, SecurityIdentifier, SecurityType } from "./types";
import type { TradingCalendar } from "./tradingCalendar";

/** ST 维度（信息维度）的归一化取值。 */
export type HistoricalStStatus = "NORMAL" | "ST" | "*ST" | "UNKNOWN";

/** 历史 universe 查询入参（全部只读、可序列化、确定性）。 */
export interface HistoricalUniverseInput {
  /** 证券主数据（永久身份）。 */
  securities: readonly Security[];
  /** 标识符历史（时间有效区间）。 */
  identifiers: readonly SecurityIdentifier[];
  /** 历史状态区间（LISTING/TRADING/ST/DELISTING/SUSPENSION）。 */
  statusIntervals: readonly SecurityStatusInterval[];
  /** 可选交易日历；提供时启用 T+1 交易日语义与 isTradingDay 判定。 */
  calendar?: TradingCalendar;
}

/** 历史 universe 查询选项。 */
export interface HistoricalUniverseOptions {
  /** point-in-time 截止点（YYYY-MM-DD）；null = 全知视角。 */
  asOf?: string | null;
  /** 是否在结果中附带被剔除的证券（含原因）；默认 true。 */
  includeExcluded?: boolean;
}

/** 可交易成员（已通过全部 gate）。 */
export interface HistoricalUniverseMember {
  securityId: string;
  exchange: Exchange;
  /** 该日在生效的 primary 代码；无则 null（理论上可交易成员必有代码）。 */
  code: string | null;
  securityType: SecurityType;
  /** ST 信息维度（不参与 eligibility）。 */
  st: HistoricalStStatus;
  /** 完整状态快照（含各维度 resolved / unknownDimensions）。 */
  snapshot: SecurityStatusSnapshot;
}

/** 被剔除的证券（含确定性最高优先级的剔除原因）。 */
export interface HistoricalUniverseExclusion {
  securityId: string;
  exchange: Exchange;
  code: string | null;
  securityType: SecurityType;
  st: HistoricalStStatus;
  /** 剔除原因（稳定 code）。 */
  reason: string;
  snapshot: SecurityStatusSnapshot;
}

/** 历史 universe 完整结果（成员 + 剔除审计，确定性排序）。 */
export interface HistoricalUniverseResult {
  tradeDate: string;
  asOf: string | null;
  /** tradeDate 是否为交易日；无 calendar 时为 null。 */
  isTradingDay: boolean | null;
  /** 可交易成员（按 exchange → code → securityId 升序）。 */
  members: HistoricalUniverseMember[];
  /** 被剔除证券（同序）。includeExcluded=false 时为空。 */
  excluded: HistoricalUniverseExclusion[];
}

/** 剔除原因稳定 code（唯一事实来源）。 */
export const EXCLUSION_REASONS = {
  NO_ACTIVE_IDENTIFIER: "NO_ACTIVE_IDENTIFIER",
  LISTING_UNKNOWN: "LISTING_UNKNOWN",
  NOT_YET_LISTED: "NOT_YET_LISTED",
  DELISTED: "DELISTED",
  TRADING_SUSPENDED: "TRADING_SUSPENDED",
  TRADING_NOT_YET_LISTED: "TRADING_NOT_YET_LISTED",
  TRADING_DELISTED: "TRADING_DELISTED",
  TRADING_UNKNOWN: "TRADING_UNKNOWN",
  SUSPENDED: "SUSPENDED",
  DELISTING_DELISTED: "DELISTING_DELISTED",
} as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[keyof typeof EXCLUSION_REASONS];

/** 在 tradeDate 该 security 生效的标识符（优先 primary，其次任意别名）。 */
function resolveActiveIdentifier(
  identifiers: readonly SecurityIdentifier[],
  securityId: string,
  tradeDate: string,
): SecurityIdentifier | null {
  let fallback: SecurityIdentifier | null = null;
  for (const identifier of identifiers) {
    if (identifier.securityId !== securityId) continue;
    if (!intervalContains(identifier.effectiveFrom, identifier.effectiveTo, tradeDate)) continue;
    if (identifier.identifierType === "primary") return identifier;
    if (fallback === null) fallback = identifier;
  }
  return fallback;
}

/** 从快照提取 ST 信息维度（无记录 → UNKNOWN，不默认 NORMAL）。 */
function stFromSnapshot(snapshot: SecurityStatusSnapshot): HistoricalStStatus {
  const value = snapshot.resolved.ST?.statusValue;
  if (value === "ST" || value === "*ST" || value === "NORMAL") return value;
  return "UNKNOWN";
}

/**
 * 单一证券的历史可交易判定（纯函数、确定性）。
 * 返回 { tradable, reason }，reason 仅在 tradable=false 时为稳定 code。
 * 判定优先级：LISTING（生命周期，最根本）→ 标识符 → TRADING → SUSPENSION → DELISTING。
 */
export function evaluateHistoricalEligibility(
  security: Security,
  activeIdentifier: SecurityIdentifier | null,
  snapshot: SecurityStatusSnapshot,
  tradeDate: string,
): { tradable: boolean; reason: ExclusionReason | null } {
  // 1. LISTING gate：身份时间界（STEP 7.4 权威 listedDate/delistedDate）为基底，
  //    状态维度 LISTING（更细粒度时间序列）作交叉验证——两者任一表明确切负向即拒绝。
  const listing = snapshot.resolved.LISTING;
  if (security.listedDate === null) {
    return { tradable: false, reason: EXCLUSION_REASONS.LISTING_UNKNOWN };
  }
  if (compareDate(security.listedDate, tradeDate) > 0) {
    return { tradable: false, reason: EXCLUSION_REASONS.NOT_YET_LISTED };
  }
  if (security.delistedDate !== null && compareDate(tradeDate, security.delistedDate) > 0) {
    return { tradable: false, reason: EXCLUSION_REASONS.DELISTED };
  }
  if (listing !== undefined) {
    // 状态维度仅作「额外负向」交叉验证：NOT_YET_LISTED / DELISTED 阻断，LISTED 放行。
    if (listing.statusValue === "NOT_YET_LISTED") {
      return { tradable: false, reason: EXCLUSION_REASONS.NOT_YET_LISTED };
    }
    if (listing.statusValue === "DELISTED") {
      return { tradable: false, reason: EXCLUSION_REASONS.DELISTED };
    }
  }

  // 2. 标识符 gate（无法解析代码 → 无法构成可交易标的）。
  if (activeIdentifier === null) {
    return { tradable: false, reason: EXCLUSION_REASONS.NO_ACTIVE_IDENTIFIER };
  }

  // 3. TRADING gate（正向确认，UNKNOWN/缺失 → 拒绝）。
  const trading = snapshot.resolved.TRADING;
  if (trading === undefined || trading.statusValue === "UNKNOWN") {
    return { tradable: false, reason: EXCLUSION_REASONS.TRADING_UNKNOWN };
  }
  if (trading.statusValue === "SUSPENDED") {
    return { tradable: false, reason: EXCLUSION_REASONS.TRADING_SUSPENDED };
  }
  if (trading.statusValue === "NOT_YET_LISTED") {
    return { tradable: false, reason: EXCLUSION_REASONS.TRADING_NOT_YET_LISTED };
  }
  if (trading.statusValue === "DELISTED") {
    return { tradable: false, reason: EXCLUSION_REASONS.TRADING_DELISTED };
  }
  // 仅 "TRADING" 放行。

  // 4. SUSPENSION gate（负向阻断：仅显式 SUSPENDED 阻断）。
  if (snapshot.resolved.SUSPENSION?.statusValue === "SUSPENDED") {
    return { tradable: false, reason: EXCLUSION_REASONS.SUSPENDED };
  }

  // 5. DELISTING gate（负向阻断：仅显式 DELISTED 阻断；AT_RISK 仍可交易）。
  if (snapshot.resolved.DELISTING?.statusValue === "DELISTED") {
    return { tradable: false, reason: EXCLUSION_REASONS.DELISTING_DELISTED };
  }

  return { tradable: true, reason: null };
}

/** 确定性排序键：exchange → code（null 视为空串）→ securityId。 */
function sortKey(exchange: Exchange, code: string | null, securityId: string): string {
  return `${exchange}|${code ?? ""}|${securityId}`;
}

/**
 * 解析历史 universe 的完整结果（成员 + 剔除审计）。
 * 纯函数、确定性、无 IO；绝不使用今天的股票列表。
 */
export function resolveHistoricalUniverse(
  input: HistoricalUniverseInput,
  tradeDate: string,
  options: HistoricalUniverseOptions = {},
): HistoricalUniverseResult {
  const { securities, identifiers, statusIntervals, calendar } = input;
  const asOf = options.asOf ?? null;
  const includeExcluded = options.includeExcluded ?? true;

  const members: HistoricalUniverseMember[] = [];
  const excluded: HistoricalUniverseExclusion[] = [];

  for (const security of securities) {
    const activeIdentifier = resolveActiveIdentifier(identifiers, security.securityId, tradeDate);
    const exchange = activeIdentifier?.exchange ?? security.exchange;
    const code = activeIdentifier?.code ?? null;

    const snapshot = resolveSecurityStatus(statusIntervals, security.securityId, tradeDate, { asOf, calendar });
    const st = stFromSnapshot(snapshot);
    const { tradable, reason } = evaluateHistoricalEligibility(security, activeIdentifier, snapshot, tradeDate);

    if (tradable) {
      members.push({ securityId: security.securityId, exchange, code, securityType: security.securityType, st, snapshot });
    } else if (includeExcluded) {
      excluded.push({
        securityId: security.securityId,
        exchange,
        code,
        securityType: security.securityType,
        st,
        reason: reason ?? EXCLUSION_REASONS.TRADING_UNKNOWN,
        snapshot,
      });
    }
  }

  const byKey = (item: { exchange: Exchange; code: string | null; securityId: string }) =>
    sortKey(item.exchange, item.code, item.securityId);

  members.sort((a, b) => (byKey(a) < byKey(b) ? -1 : byKey(a) > byKey(b) ? 1 : 0));
  excluded.sort((a, b) => (byKey(a) < byKey(b) ? -1 : byKey(a) > byKey(b) ? 1 : 0));

  return {
    tradeDate,
    asOf,
    isTradingDay: calendar ? calendar.isTradingDay(tradeDate) : null,
    members,
    excluded,
  };
}

/**
 * canonical API：历史可交易股票池。
 * 返回 tradeDate（as-of）下、point-in-time（asOf）视角内的可交易成员（确定性排序）。
 */
export function getHistoricalTradableUniverse(
  input: HistoricalUniverseInput,
  tradeDate: string,
  options: HistoricalUniverseOptions = {},
): HistoricalUniverseMember[] {
  return resolveHistoricalUniverse(input, tradeDate, { ...options, includeExcluded: false }).members;
}

/** 便捷：只取可交易成员的 security_id 列表（确定性排序，供 pipeline/backtest 消费）。 */
export function getHistoricalTradableSecurityIds(
  input: HistoricalUniverseInput,
  tradeDate: string,
  options: HistoricalUniverseOptions = {},
): string[] {
  return getHistoricalTradableUniverse(input, tradeDate, options).map((member) => member.securityId);
}
