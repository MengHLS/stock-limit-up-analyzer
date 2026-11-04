/**
 * STEP 12.6 — Research Dataset：装配层（纯函数，无 IO）。
 *
 * 职责：
 *   - 把全量内存数据（securities/identifiers/statusIntervals/industry/CA）按 securityId
 *     分组，并对 code 键数据（industry/CA）做 code-ownership 过滤（防代码复用串扰）——
 *     语义与 C-12.5.1 db.ts 完全一致，并覆盖「更名证券早期事件挂旧代码」的批量场景
 *     （db.ts 头注释明言交由 STEP 12.6 builder 处理）；
 *   - 对每个 (member, tradeDate) 组装 HistoricalStateInput → 调 resolveSecurityHistoricalState
 *     纯函数（复用 STEP 12.5 状态语义，不重复实现）→ 投影为 ResearchDatasetRow 标准行。
 *
 * 全部纯内存、确定性、无 IO；可直接单测。
 */

import {
  resolveActiveIdentifierAt,
  resolveSecurityHistoricalState,
} from "../historicalState/reconstruct";
import type { HistoricalStateInput } from "../historicalState/types";
import type { Security, SecurityIdentifier } from "../security/types";
import type { SecurityStatusInterval } from "../securityStatus/types";
import type { CorporateAction } from "../corporateActions/types";
import type {
  IndustryAssignment,
  IndexDailyBar,
  IndexMasterEntry,
  LiquidityDaily,
} from "../marketData/types";
import type { CanonicalMarketBar } from "../data/types";
import {
  isCodeIntervalOwnedBySecurity,
  isCodeOwnedBySecurityAt,
} from "../historicalState/reconstruct";
import type { ResearchDatasetRow, ResearchDatasetInput } from "./types";
import type { SecurityHistoricalState } from "../historicalState/types";

// ---------------------------------------------------------------------------
// 静态上下文（整个窗口不变）
// ---------------------------------------------------------------------------

/** 某证券的静态上下文（与 tradeDate 无关的部分）。 */
export interface PerSecurityStaticContext {
  security: Security;
  identifiers: readonly SecurityIdentifier[];
  statusIntervals: readonly SecurityStatusInterval[];
  /** code-ownership 过滤后的行业区间（含更名前的旧代码，若该证券曾拥有）。 */
  industryAssignments: readonly IndustryAssignment[];
  /** code-ownership 过滤后的公司行为（含旧代码早期事件）。 */
  corporateActions: readonly CorporateAction[];
}

function groupIdentifiers(identifiers: readonly SecurityIdentifier[]): Map<string, SecurityIdentifier[]> {
  const map = new Map<string, SecurityIdentifier[]>();
  for (const item of identifiers) {
    const list = map.get(item.securityId) ?? [];
    list.push(item);
    map.set(item.securityId, list);
  }
  return map;
}

function groupStatus(statusIntervals: readonly SecurityStatusInterval[]): Map<string, SecurityStatusInterval[]> {
  const map = new Map<string, SecurityStatusInterval[]>();
  for (const item of statusIntervals) {
    const list = map.get(item.securityId) ?? [];
    list.push(item);
    map.set(item.securityId, list);
  }
  return map;
}

/** 行业区间按完整代码（securityCode）分组。 */
function groupIndustryByCode(
  assignments: readonly IndustryAssignment[],
): Map<string, IndustryAssignment[]> {
  const map = new Map<string, IndustryAssignment[]>();
  for (const item of assignments) {
    const code = item.securityId; // 行业域键 = 完整代码
    const list = map.get(code) ?? [];
    list.push(item);
    map.set(code, list);
  }
  return map;
}

/** 公司行为按完整代码（securityCode）分组。 */
function groupCaByCode(actions: readonly CorporateAction[]): Map<string, CorporateAction[]> {
  const map = new Map<string, CorporateAction[]>();
  for (const item of actions) {
    const list = map.get(item.securityCode) ?? [];
    list.push(item);
    map.set(item.securityCode, list);
  }
  return map;
}

/**
 * 构建 全窗口静态上下文（对每个证券做 code-ownership 过滤）。
 *
 * industry：对 security 的每个 (code, exchange) 标识符区间，取其该代码下的行业行，
 *   再按 isCodeIntervalOwnedBySecurity 校验区间归属，只保留本证券真正拥有的区间。
 * CA：按 isCodeOwnedBySecurityAt（以 event effectiveDate 判定）过滤，防止代码复用串扰。
 *   不过滤 effectiveDate<=date（逐日 reconstruct 内部会过滤），因此一次构建全窗口可用。
 */
export function buildStaticContexts(input: Pick<
  ResearchDatasetInput,
  "securities" | "identifiers" | "statusIntervals" | "industryAssignments" | "corporateActions"
>): Map<string, PerSecurityStaticContext> {
  const identifiersBySecurity = groupIdentifiers(input.identifiers);
  const statusBySecurity = groupStatus(input.statusIntervals);
  const industryByCode = groupIndustryByCode(input.industryAssignments ?? []);
  const caByCode = groupCaByCode(input.corporateActions ?? []);

  const contexts = new Map<string, PerSecurityStaticContext>();
  for (const security of input.securities) {
    const identifiers = identifiersBySecurity.get(security.securityId) ?? [];
    const statusIntervals = statusBySecurity.get(security.securityId) ?? [];

    // industry 全代码收集（按 code → interval ownership 过滤）。
    const ownedIndustry: IndustryAssignment[] = [];
    const seenIndustry = new Set<string>();
    for (const identifier of identifiers) {
      const { exchange, code } = identifier;
      const fullCode = `${code}.${exchange}`;
      const rows = industryByCode.get(fullCode) ?? [];
      for (const row of rows) {
        const key = `${row.securityId}|${row.effectiveFrom}|${row.effectiveTo ?? ""}|${row.source}`;
        if (seenIndustry.has(key)) continue;
        if (
          !isCodeIntervalOwnedBySecurity(
            identifiers,
            security.securityId,
            code,
            exchange,
            row.effectiveFrom,
            row.effectiveTo,
          )
        ) {
          continue;
        }
        seenIndustry.add(key);
        ownedIndustry.push(row);
      }
    }

    // CA 全代码收集（ownership 以 effectiveDate 判定）。
    const ownedCa: CorporateAction[] = [];
    const seenCa = new Set<string>();
    for (const identifier of identifiers) {
      const { exchange, code } = identifier;
      const fullCode = `${code}.${exchange}`;
      const rows = caByCode.get(fullCode) ?? [];
      for (const row of rows) {
        const key = `${row.securityCode}|${row.effectiveDate}|${row.actionType}`;
        if (seenCa.has(key)) continue;
        if (
          !isCodeOwnedBySecurityAt(
            identifiers,
            security.securityId,
            code,
            exchange,
            row.effectiveDate,
          )
        ) {
          continue;
        }
        seenCa.add(key);
        ownedCa.push(row);
      }
    }

    contexts.set(security.securityId, {
      security,
      identifiers,
      statusIntervals,
      industryAssignments: ownedIndustry,
      corporateActions: ownedCa,
    });
  }
  return contexts;
}

// ---------------------------------------------------------------------------
// 单日行装配
// ---------------------------------------------------------------------------

/** 组装某 (security, tradeDate) 的 HistoricalStateInput（纯函数；price/liquidity 来自当日事实）。 */
export function buildHistoricalStateInput(
  context: PerSecurityStaticContext,
  tradeDate: string,
  facts: {
    priceBar?: CanonicalMarketBar | null;
    liquidity?: LiquidityDaily | null;
    indexBars?: readonly IndexDailyBar[];
    indexMaster?: readonly IndexMasterEntry[];
  },
): HistoricalStateInput {
  return {
    security: context.security,
    identifiers: context.identifiers,
    statusIntervals: context.statusIntervals,
    industryAssignments: context.industryAssignments,
    corporateActions: context.corporateActions,
    priceBar: facts.priceBar ?? null,
    liquidity: facts.liquidity ?? null,
    indexBars: facts.indexBars ?? [],
    indexMaster: facts.indexMaster ?? [],
  };
}

/** 由 (securityId, identifiers) 解析当日生效完整代码（无则 null）。复用 reconstruct 单一实现。 */
export function activeFullCodeAt(
  context: PerSecurityStaticContext,
  tradeDate: string,
): string | null {
  const active = resolveActiveIdentifierAt(context.identifiers, context.security.securityId, tradeDate);
  return active === null ? null : `${active.code}.${active.exchange}`;
}

/** SecurityHistoricalState → ResearchDatasetRow 投影（纯函数；row schema 见 types）。 */
export function projectStateToRow(state: SecurityHistoricalState): ResearchDatasetRow {
  const marketState = state.marketState;
  const indexClose: Record<string, number> = {};
  for (const entry of marketState) {
    if (entry.bar.close !== null) indexClose[entry.indexCode] = entry.bar.close;
  }
  return {
    tradeDate: state.query.tradeDate,
    asOf: state.query.asOf ?? state.query.tradeDate,
    securityId: state.query.securityId,
    code: state.identity.code,
    securityType: state.identity.securityType,
    exchange: state.identity.exchange,
    lifecycleVerdict: state.lifecycle.verdict,
    eligible: state.tradability.eligible,
    exclusionReason: state.tradability.reason,
    st: state.tradability.st,
    industryCode: state.industry?.industryCode ?? null,
    industryName: state.industry?.industryName ?? null,
    turnoverRate: state.liquidity?.turnoverRate ?? null,
    circulationMarketCap: state.liquidity?.circulationMarketCap ?? null,
    totalMarketCap: state.liquidity?.totalMarketCap ?? null,
    liquidityAmount: state.liquidity?.amount ?? null,
    liquidityVolume: state.liquidity?.volume ?? null,
    open: state.price?.open ?? null,
    high: state.price?.high ?? null,
    low: state.price?.low ?? null,
    close: state.price?.close ?? null,
    preClose: state.price?.preClose ?? null,
    volume: state.price?.volume ?? null,
    amount: state.price?.amount ?? null,
    corporateActionsEffectiveCount: state.corporateActions.effectiveOnOrBefore.length,
    corporateActionsKnownCount: state.corporateActions.knownAtAsOf.length,
    indexClose,
    knowledge: {
      policy: state.corporateActions.policy,
      listing: state.knowledge.dimensions.listing,
      delisting: state.knowledge.dimensions.delisting,
      tradability: state.knowledge.dimensions.tradability,
      industry: state.knowledge.dimensions.industry,
      liquidity: state.knowledge.dimensions.liquidity,
      price: state.knowledge.dimensions.price,
      corporateActions: state.knowledge.dimensions.corporateActions,
      marketState: state.knowledge.dimensions.marketState,
    },
  };
}

/**
 * 装配单日全部成员的标准行（纯函数）。
 *
 * @param contexts 静态上下文（buildStaticContexts 输出）。
 * @param memberSecurityIds 该日 universe 成员（resolveUniverseDefinition 输出，已确定性排序）。
 * @param tradeDate 交易日。
 * @param asOf 该日 asOf（逐日 PIT = tradeDate；固定快照 = 请求 asOf）。
 * @param priceByCode 该日全市场价格（code → bar）。
 * @param liquidityByCode 该日全市场流动性（code → row）。
 * @param indexBars 该日核心指数日线。
 * @param indexMaster 指数身份。
 * @returns 标准行数组（按 memberSecurityIds 顺序，即确定性）。
 */
export function assembleDayRows(
  contexts: ReadonlyMap<string, PerSecurityStaticContext>,
  memberSecurityIds: readonly string[],
  tradeDate: string,
  asOf: string | null,
  priceByCode: ReadonlyMap<string, CanonicalMarketBar>,
  liquidityByCode: ReadonlyMap<string, LiquidityDaily>,
  indexBars: readonly IndexDailyBar[],
  indexMaster: readonly IndexMasterEntry[] | undefined,
): ResearchDatasetRow[] {
  const rows: ResearchDatasetRow[] = [];
  for (const securityId of memberSecurityIds) {
    const context = contexts.get(securityId);
    if (!context) continue; // 理论不可达：成员必来自 securities 输入
    const code = activeFullCodeAt(context, tradeDate);
    const priceBar = code === null ? null : (priceByCode.get(code) ?? null);
    const liquidity = code === null ? null : (liquidityByCode.get(code) ?? null);
    const input = buildHistoricalStateInput(context, tradeDate, {
      priceBar,
      liquidity,
      indexBars,
      indexMaster,
    });
    const state = resolveSecurityHistoricalState(input, tradeDate, { asOf });
    rows.push(projectStateToRow(state));
  }
  return rows;
}

