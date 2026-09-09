/**
 * STEP 7.4 — Security Master 构建器（纯函数、可测试、无 IO）。
 *
 * 把 provider 归一化记录（stock_basic 全量 / namechange 历史）构建为
 *   - Security[]（永久身份主数据）
 *   - SecurityIdentifier[]（标识符时间有效区间）
 *
 * 关键约束：
 *   - 幂等：security_id 由 ts_code 锚点确定性生成，重复运行不产生新 id。
 *   - code reuse：同一 (exchange, code) 在退市后被复用，拆分为多个 security_id。
 *     stock_basic 每 ts_code 仅一条快照，无法暴露复用；namechange 的名称区间
 *     之间的「缺口」是复用信号，据此拆分。
 *   - 区间唯一性：构建完成后用 validateIdentifierHistory 做重叠校验。
 */

import { addDays, compareDate } from "./dates";
import { generateDeterministicSecurityId, securityIdAnchorForTsCode } from "./deterministicId";
import { validateIdentifierHistory } from "./identifierHistory";
import type { NameChangeRecord } from "./namechange";
import { buildSecurityFromRecord } from "./provider";
import type { ProviderSecurityRecord } from "./provider";
import type { Exchange, Security, SecurityIdentifier } from "./types";

/** 构建结果（含被拒绝记录，供 CLI 统计 Rejected）。 */
export interface BuildResult {
  securities: Security[];
  identifiers: SecurityIdentifier[];
  rejected: Array<{ exchange: Exchange; code: string; reason: string }>;
}

/** 代码复用拆分后的单段区间。 */
export interface CodeReuseSegment {
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * 把某 (exchange, code) 的名称历史按「缺口」拆分为代码复用段。
 * 相邻名称区间连续（next.start <= prev.end + 1 天）视为同一证券；
 * 出现缺口（next.start > prev.end + 1 天）即视为退市后代码复用，另起一段。
 * 纯函数，供 buildSecurityMasterFromNameChanges 与测试复用。
 */
export function splitNameChangeSegments(
  group: readonly NameChangeRecord[],
): CodeReuseSegment[] {
  const sorted = group
    .filter((record) => record.effectiveFrom !== null)
    .slice()
    .sort((a, b) => compareDate(a.effectiveFrom!, b.effectiveFrom!));
  if (sorted.length === 0) return [];

  const segments: CodeReuseSegment[] = [];
  let segStart = sorted[0]!.effectiveFrom!;
  let segEnd = sorted[0]!.effectiveTo;

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const current = sorted[i]!;
    // 仅当前一段已闭合（end_date 非空）时才可能产生复用缺口。
    if (prev.effectiveTo !== null && compareDate(current.effectiveFrom!, addDays(prev.effectiveTo, 1)) > 0) {
      segments.push({ effectiveFrom: segStart, effectiveTo: prev.effectiveTo });
      segStart = current.effectiveFrom!;
    }
    segEnd = current.effectiveTo;
  }
  segments.push({ effectiveFrom: segStart, effectiveTo: segEnd });
  return segments;
}

/** 由 stock_basic 全量记录构建 Security Master + primary 标识符历史。 */
export function buildSecurityMasterFromStockBasic(
  records: readonly ProviderSecurityRecord[],
): BuildResult {
  const securities: Security[] = [];
  const identifiers: SecurityIdentifier[] = [];
  const rejected: BuildResult["rejected"] = [];
  const seen = new Set<string>();

  for (const record of records) {
    const key = `${record.exchange}|${record.code}`;
    if (seen.has(key)) {
      rejected.push({ exchange: record.exchange, code: record.code, reason: "重复 ts_code" });
      continue;
    }
    seen.add(key);

    if (!record.listedDate) {
      rejected.push({ exchange: record.exchange, code: record.code, reason: "缺少上市日期" });
      continue;
    }

    const securityId = generateDeterministicSecurityId(securityIdAnchorForTsCode(record.exchange, record.code));
    securities.push(buildSecurityFromRecord(record, securityId));
    identifiers.push({
      securityId,
      exchange: record.exchange,
      code: record.code,
      identifierType: "primary",
      effectiveFrom: record.listedDate,
      effectiveTo: record.delistedDate, // 退市股有效区间闭合于退市日；上市股开放至今
      source: record.source,
    });
  }

  validateIdentifierHistory(identifiers);
  return { securities, identifiers, rejected };
}

/** 由 namechange 名称历史构建 Security Master + 标识符历史（含 code reuse 拆分）。 */
export function buildSecurityMasterFromNameChanges(
  nameChanges: readonly NameChangeRecord[],
): BuildResult {
  const securities: Security[] = [];
  const identifiers: SecurityIdentifier[] = [];
  const rejected: BuildResult["rejected"] = [];

  const groups = new Map<string, NameChangeRecord[]>();
  for (const record of nameChanges) {
    const key = `${record.exchange}|${record.code}`;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  for (const [key, group] of Array.from(groups.entries())) {
    const [exchange, code] = key.split("|") as [Exchange, string];
    const segments = splitNameChangeSegments(group);
    if (segments.length === 0) {
      rejected.push({ exchange, code, reason: "无有效名称起始日期" });
      continue;
    }

    segments.forEach((segment, ordinal) => {
      const anchor = ordinal === 0
        ? securityIdAnchorForTsCode(exchange, code)
        : `${securityIdAnchorForTsCode(exchange, code)}#${ordinal + 1}`;
      const securityId = generateDeterministicSecurityId(anchor);

      securities.push({
        securityId,
        securityType: "stock",
        exchange,
        currency: "CNY",
        country: "CN",
        status: segment.effectiveTo === null ? "listed" : "delisted",
        listedDate: segment.effectiveFrom,
        delistedDate: segment.effectiveTo,
      });
      identifiers.push({
        securityId,
        exchange,
        code,
        identifierType: "primary",
        effectiveFrom: segment.effectiveFrom,
        effectiveTo: segment.effectiveTo,
        source: "tushare_namechange",
      });
    });
  }

  validateIdentifierHistory(identifiers);
  return { securities, identifiers, rejected };
}
