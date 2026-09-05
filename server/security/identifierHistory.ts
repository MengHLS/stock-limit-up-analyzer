/**
 * STEP 7.4 — 标识符历史（Identifier History）与有效区间（Effective Interval）。
 *
 * 关键约束（满足「代码在不同时间复用/变化」）：
 *   - 同一 security_id 可在不同区间拥有不同 code。
 *   - 同一 code 可在不同历史区间对应不同 security_id。
 *   - 因此禁止 UNIQUE(code) 全局永久约束；正确逻辑是「在有效区间内唯一」。
 *
 * 区间语义：[effectiveFrom, effectiveTo] 闭区间；effectiveTo = null 表示开放区间（至今）。
 */

import { compareDate } from "./dates";
import type { Exchange, IdentifierType, SecurityIdentifier } from "./types";

/** 区间是否包含 date（null = 至今，视为 +∞）。 */
export function intervalContains(from: string, to: string | null, date: string): boolean {
  return compareDate(from, date) <= 0 && (to === null || compareDate(date, to) <= 0);
}

/** 两个闭区间是否重叠（null = +∞）。 */
export function intervalsOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  const aLE_bTo = bTo === null ? true : compareDate(aFrom, bTo) <= 0;
  const bLE_aTo = aTo === null ? true : compareDate(bFrom, aTo) <= 0;
  return aLE_bTo && bLE_aTo;
}

/** 标识符分组键（同一交易所 + 同一代码 + 同一类型），用于区间唯一性校验。 */
function identifierKey(identifier: SecurityIdentifier): string {
  return `${identifier.exchange}|${identifier.code}|${identifier.identifierType}`;
}

/** 校验单个分组内的区间互不重叠；重叠即数据错误，抛错。 */
function assertGroupNoOverlap(group: readonly SecurityIdentifier[]): void {
  const sorted = group.slice().sort((a, b) => compareDate(a.effectiveFrom, b.effectiveFrom));
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;
    if (intervalsOverlap(current.effectiveFrom, current.effectiveTo, next.effectiveFrom, next.effectiveTo)) {
      throw new Error(
        `标识符区间重叠：${current.exchange} ${current.code} 的 ` +
          `[${current.effectiveFrom},${current.effectiveTo ?? "至今"}] 与 ` +
          `[${next.effectiveFrom},${next.effectiveTo ?? "至今"}]`,
      );
    }
  }
}

/** 校验整份标识符历史：按 (exchange, code, type) 分组，各组区间互不重叠。 */
export function validateIdentifierHistory(history: readonly SecurityIdentifier[]): void {
  const groups = new Map<string, SecurityIdentifier[]>();
  for (const identifier of history) {
    const key = identifierKey(identifier);
    const group = groups.get(key);
    if (group) group.push(identifier);
    else groups.set(key, [identifier]);
  }
  for (const group of Array.from(groups.values())) assertGroupNoOverlap(group);
}

/**
 * as-of 解析：在指定日期，某 (exchange, code) 生效的标识符（按类型过滤可选）。
 * 无匹配返回 null；若同一类型出现多个匹配（数据错误）则抛错。
 */
export function resolveIdentifierAt(
  history: readonly SecurityIdentifier[],
  exchange: Exchange,
  code: string,
  date: string,
  identifierType?: IdentifierType,
): SecurityIdentifier | null {
  const matches = history.filter(
    (identifier) =>
      identifier.exchange === exchange &&
      identifier.code === code &&
      (identifierType === undefined || identifier.identifierType === identifierType) &&
      intervalContains(identifier.effectiveFrom, identifier.effectiveTo, date),
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `标识符历史数据错误：${exchange} ${code} 在 ${date} 存在多个重叠区间`,
    );
  }
  return matches[0]!;
}

/**
 * as-of 解析：在指定日期，某 (exchange, code) 对应的 security_id。
 * 优先 primary 标识；否则取任意类型的匹配（各类型为别名，应指向同一 security_id）。
 * 无匹配返回 null。
 */
export function resolveSecurityByCode(
  history: readonly SecurityIdentifier[],
  exchange: Exchange,
  code: string,
  date: string,
): string | null {
  const primary = resolveIdentifierAt(history, exchange, code, date, "primary");
  if (primary) return primary.securityId;

  const any = history.filter(
    (identifier) =>
      identifier.exchange === exchange &&
      identifier.code === code &&
      intervalContains(identifier.effectiveFrom, identifier.effectiveTo, date),
  );
  if (any.length === 0) return null;

  const securityId = any[0]!.securityId;
  if (any.some((identifier) => identifier.securityId !== securityId)) {
    throw new Error(
      `标识符历史数据错误：${exchange} ${code} 在 ${date} 指向了多个不同 security_id`,
    );
  }
  return securityId;
}

/** 代码复用检测结果。 */
export interface CodeReuseRecord {
  exchange: Exchange;
  code: string;
  /** 该 code 历史区间内出现过的不同 security_id（按有效区间起点排序）。 */
  securityIds: string[];
  /** 各 security_id 对应的有效区间。 */
  intervals: Array<{ securityId: string; effectiveFrom: string; effectiveTo: string | null }>;
}

/**
 * 检测代码复用：同一 (exchange, code) 在不同（互不重叠）历史区间对应不同 security_id。
 * 复用是 A 股退市后代码重新分配给新上市主体的常见现象，也是 survivorship 审计的关键信号。
 */
export function detectCodeReuse(history: readonly SecurityIdentifier[]): CodeReuseRecord[] {
  const groups = new Map<string, SecurityIdentifier[]>();
  for (const identifier of history) {
    const key = `${identifier.exchange}|${identifier.code}`;
    const group = groups.get(key);
    if (group) group.push(identifier);
    else groups.set(key, [identifier]);
  }

  const records: CodeReuseRecord[] = [];
  for (const [key, group] of Array.from(groups.entries())) {
    const securityIds = Array.from(new Set(group.map((identifier) => identifier.securityId)));
    if (securityIds.length < 2) continue;
    const [exchange, code] = key.split("|") as [Exchange, string];
    records.push({
      exchange,
      code,
      securityIds: securityIds.sort(),
      intervals: group
        .slice()
        .sort((a, b) => compareDate(a.effectiveFrom, b.effectiveFrom))
        .map((identifier) => ({
          securityId: identifier.securityId,
          effectiveFrom: identifier.effectiveFrom,
          effectiveTo: identifier.effectiveTo,
        })),
    });
  }
  return records;
}
