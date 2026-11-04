/**
 * STEP 7.4 — As-Of Universe / Survivorship 基础。
 *
 * getTradableSecurities(date) 必须回答「在某个历史日期，市场上有哪些证券可交易」，
 * 不能使用今天的股票列表回填历史（禁止 survivorship bias）。
 *
 * 判定依据（identity lifecycle foundation）：
 *   - 已上市：listedDate 非空且 <= date。
 *   - 未退市：delistedDate 为空或 >= date（delistedDate 为最后一个可交易日，含）。
 *   - 有有效标识：在 date 存在生效的标识符区间（代码可解析）。
 * 完整 survivorship（Historical Status / Trading Universe / Corporate Action）仍依赖 STEP 7.5。
 */

import { compareDate } from "./dates";
import { intervalContains } from "./identifierHistory";
import type { Security, SecurityIdentifier } from "./types";

/** as-of universe 查询入参。 */
export interface UniverseContext {
  securities: readonly Security[];
  identifiers: readonly SecurityIdentifier[];
}

/** 建立「在 date 有生效标识符」的 security_id 集合。 */
function activeSecurityIds(identifiers: readonly SecurityIdentifier[], date: string): Set<string> {
  const active = new Set<string>();
  for (const identifier of identifiers) {
    if (intervalContains(identifier.effectiveFrom, identifier.effectiveTo, date)) {
      active.add(identifier.securityId);
    }
  }
  return active;
}

/**
 * 在指定日期可交易的证券（survivorship-safe）。
 * 返回满足：已上市 && 未退市 && 有生效标识符 的证券。
 */
export function getTradableSecurities(
  securities: readonly Security[],
  identifiers: readonly SecurityIdentifier[],
  date: string,
): Security[] {
  const active = activeSecurityIds(identifiers, date);
  return securities.filter((security) => {
    if (security.listedDate === null) return false; // 无上市日期，无法判定 → 排除
    if (compareDate(security.listedDate, date) > 0) return false; // 尚未上市
    if (security.delistedDate !== null && compareDate(date, security.delistedDate) > 0) return false; // 已退市
    if (!active.has(security.securityId)) return false; // 无生效标识符（代码不可解析）
    return true;
  });
}

/** 别名：as-of universe（与 getTradableSecurities 等价，语义更直白）。 */
export function getAsOfUniverse(
  securities: readonly Security[],
  identifiers: readonly SecurityIdentifier[],
  date: string,
): Security[] {
  return getTradableSecurities(securities, identifiers, date);
}

/**
 * 在指定日期，某代码对应证券是否可交易（survivorship-safe 单点查询）。
 * 先按代码解析 security_id，再判定该证券在 date 是否满足上市/退市约束。
 */
export function isTradableByCode(
  securities: readonly Security[],
  identifiers: readonly SecurityIdentifier[],
  exchange: Security["exchange"],
  code: string,
  date: string,
): boolean {
  // 复用 identifierHistory 的解析逻辑（延迟 import 避免循环引用）。
  // 这里直接用区间匹配 + security 时间界判定。
  const matches = identifiers.filter(
    (identifier) =>
      identifier.exchange === exchange &&
      identifier.code === code &&
      intervalContains(identifier.effectiveFrom, identifier.effectiveTo, date),
  );
  if (matches.length === 0) return false;
  const securityId = matches[0]!.securityId;
  const security = securities.find((item) => item.securityId === securityId);
  if (!security) return false;
  if (security.listedDate === null || compareDate(security.listedDate, date) > 0) return false;
  if (security.delistedDate !== null && compareDate(date, security.delistedDate) > 0) return false;
  return true;
}
