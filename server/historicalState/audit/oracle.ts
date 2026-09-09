/**
 * STEP 12.5 — PIT / 反泄漏抽样审计：朴素预言机（独立期望）。
 *
 * 原则：预言机不调用被测对象（querySecurityHistoricalState / reconstruct / industry /
 * corporateActions / securityStatus 的解析层），只做「从原始事实行直接得出『asOf 时点
 * 应当知道什么』」的朴素判定。与加载层共享的仅有三类基础事实函数：
 *   - 区间包含 / 重叠（intervalContains / intervalsOverlap：基础设施，非泄漏语义）；
 *   - code 归属 helper（isCodeOwnedBySecurityAt / isCodeIntervalOwnedBySecurity：
 *     身份映射，非 PIT 泄漏维度；导入以对齐 loader 的归属过滤，避免误报）；
 *   - canonical 代码构造（纯字符串拼接，不引入策略逻辑）。
 * 泄漏关键语义（announcementDate / retrievedAt / master 时间界 / 日级对齐）全部在
 * 本文件独立实现，不调用任何 canonical 解析函数。
 */

import { intervalContains } from "../../security/identifierHistory";
import type { Security, SecurityIdentifier } from "../../security/types";
import type {
  CorporateAction,
} from "../../corporateActions/types";
import type { IndustryAssignment } from "../../marketData/types";
import {
  isCodeIntervalOwnedBySecurity,
  isCodeOwnedBySecurityAt,
} from "../reconstruct";
import type { LifecycleExpectation, PitAuditFacts } from "./types";

/** 朴素活跃标识符：该 security 在 date 生效的标识符（primary 优先，别名兜底，确定性排序）。 */
export function naiveActiveIdentifierAt(
  identifiers: readonly SecurityIdentifier[],
  securityId: string,
  tradeDate: string,
): SecurityIdentifier | null {
  const candidates = identifiers.filter(
    (id) =>
      id.securityId === securityId &&
      intervalContains(id.effectiveFrom, id.effectiveTo, tradeDate),
  );
  if (candidates.length === 0) return null;
  const primary = candidates.filter((id) => id.identifierType === "primary");
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

/** 朴素期望的生效 canonical 代码（如 600000.SH）；无生效标识符 → null。 */
export function naiveActiveCode(
  identifiers: readonly SecurityIdentifier[],
  securityId: string,
  tradeDate: string,
): string | null {
  const active = naiveActiveIdentifierAt(identifiers, securityId, tradeDate);
  return active === null ? null : `${active.code}.${active.exchange}`;
}

/** 朴素身份期望（codeDigits / code / identifierType / 区间），供与重建 identity 比对。 */
export interface NaiveIdentityExpectation {
  codeDigits: string | null;
  code: string | null;
  identifierType: SecurityIdentifier["identifierType"] | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export function naiveIdentityExpectation(
  identifiers: readonly SecurityIdentifier[],
  securityId: string,
  tradeDate: string,
): NaiveIdentityExpectation {
  const active = naiveActiveIdentifierAt(identifiers, securityId, tradeDate);
  if (active === null) {
    return {
      codeDigits: null,
      code: null,
      identifierType: null,
      effectiveFrom: null,
      effectiveTo: null,
    };
  }
  return {
    codeDigits: active.code,
    code: `${active.code}.${active.exchange}`,
    identifierType: active.identifierType,
    effectiveFrom: active.effectiveFrom,
    effectiveTo: active.effectiveTo,
  };
}

/** 朴素生命周期判词：仅依据 master 时间界（与加载层解析逻辑无关）。 */
export function naiveLifecycleExpectation(
  security: Pick<Security, "listedDate" | "delistedDate">,
  tradeDate: string,
): LifecycleExpectation {
  const { listedDate, delistedDate } = security;
  if (listedDate === null) return "UNKNOWN";
  if (tradeDate < listedDate) return "NOT_YET_LISTED";
  if (delistedDate !== null && tradeDate > delistedDate) return "DELISTED";
  return "LISTED";
}

// ---------------------------------------------------------------------------
// 行业 PIT（retrievedAt 可知性）
// ---------------------------------------------------------------------------

export interface NaiveIndustryResult {
  kind: "none" | "single" | "overlap";
  /** kind="single" 时的可用归属。 */
  assignment: IndustryAssignment | null;
  /** 是否存在「本 security 拥有、区间覆盖 tradeDate、但 retrievedAt > asOf」的行（PIT 护栏被触发）。 */
  guardExercised: boolean;
}

/**
 * 朴素行业期望：(facts, tradeDate, asOf) 时点应当可知的行业归属。
 * 过滤链：code 归属（对齐 loader）→ 区间覆盖 tradeDate → retrievedAt <= asOf（PIT）。
 */
export function naiveIndustryAt(
  facts: PitAuditFacts,
  tradeDate: string,
  asOf: string | null,
): NaiveIndustryResult {
  const active = naiveActiveIdentifierAt(facts.identifiers, facts.security.securityId, tradeDate);
  if (active === null) {
    return { kind: "none", assignment: null, guardExercised: false };
  }
  const { code: digits, exchange } = active;

  // loader 同款归属过滤：行业区间须与本 security 对该 (exchange, code) 的拥有区间重叠。
  const owned = facts.industryRows.filter((row) =>
    isCodeIntervalOwnedBySecurity(
      facts.identifiers,
      facts.security.securityId,
      digits,
      exchange,
      row.effectiveFrom,
      row.effectiveTo,
    ),
  );
  const covers = owned.filter((row) => intervalContains(row.effectiveFrom, row.effectiveTo, tradeDate));
  const guardExercised =
    asOf !== null &&
    covers.some((row) => row.retrievedAt.slice(0, 10) > asOf);
  const available = covers.filter(
    (row) => asOf === null || row.retrievedAt.slice(0, 10) <= asOf,
  );
  if (available.length === 0) return { kind: "none", assignment: null, guardExercised };
  if (available.length > 1) return { kind: "overlap", assignment: null, guardExercised };
  return { kind: "single", assignment: available[0]!, guardExercised };
}

// ---------------------------------------------------------------------------
// 公司行为 PIT（announcementDate 可知性）
// ---------------------------------------------------------------------------

/** 稳定事件键（对齐表唯一约束：code + effectiveDate + actionType）。 */
export function corporateActionKey(action: CorporateAction): string {
  return `${action.securityCode}|${action.effectiveDate}|${action.actionType}`;
}

/** 朴素「已生效」事件键集：effectiveDate <= tradeDate 且生效日代码归本 security 所有。 */
export function naiveEffectiveCaKeys(
  facts: PitAuditFacts,
  tradeDate: string,
): Set<string> {
  const active = naiveActiveIdentifierAt(facts.identifiers, facts.security.securityId, tradeDate);
  const keys = new Set<string>();
  if (active === null) return keys;
  const { code: digits, exchange } = active;
  for (const action of facts.caRows) {
    if (action.effectiveDate > tradeDate) continue;
    if (
      !isCodeOwnedBySecurityAt(
        facts.identifiers,
        facts.security.securityId,
        digits,
        exchange,
        action.effectiveDate,
      )
    ) {
      continue;
    }
    keys.add(corporateActionKey(action));
  }
  return keys;
}

/** 朴素「asOf 时点可知」事件键集：已生效 且 announcementDate 非空 且 <= asOf。 */
export function naiveKnownCaKeys(
  facts: PitAuditFacts,
  tradeDate: string,
  asOf: string | null,
): Set<string> {
  const effectiveKeys = naiveEffectiveCaKeys(facts, tradeDate);
  if (asOf === null) return effectiveKeys; // 全知视角：全部已生效事件都「可知」
  const known = new Set<string>();
  for (const action of facts.caRows) {
    if (action.effectiveDate > tradeDate) continue;
    if (!effectiveKeys.has(corporateActionKey(action))) continue;
    const announced = action.announcementDate;
    if (announced !== null && announced !== undefined && announced <= asOf) known.add(corporateActionKey(action));
  }
  return known;
}
