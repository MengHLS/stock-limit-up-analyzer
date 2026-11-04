/**
 * STEP 7.6 — Historical Industry：历史行业归属的 as-of / interval 访问语义。
 *
 * 铁律：禁止用「当前行业」回填「历史行业」。行业归属必须以带有效期的区间（effectiveFrom/effectiveTo）
 * 表达，任何时点的行业由 getIndustryAt 按 as-of 解析。
 */

import { isValidIsoDate, type IndustryAssignment, type SecurityId } from "./types";

/** 无限远截止日：effectiveTo === null 时用于区间重叠比较。 */
const INFINITE_END = "9999-12-31";

/** 校验结果。 */
export interface IndustryIntervalValidation {
  status: "VALID" | "WARNING" | "INVALID";
  issues: Array<{ code: string; message: string }>;
}

/** 判断两个区间是否重叠（闭区间；null 截止视为无限远）。 */
export function industryIntervalsOverlap(a: IndustryAssignment, b: IndustryAssignment): boolean {
  const aEnd = a.effectiveTo ?? INFINITE_END;
  const bEnd = b.effectiveTo ?? INFINITE_END;
  return a.effectiveFrom <= bEnd && b.effectiveFrom <= aEnd;
}

/**
 * 校验某证券的行业区间列表：
 *   - 区间内 effectiveFrom / effectiveTo 必须是合法日期，且 effectiveFrom <= effectiveTo；
 *   - 任意两个区间不得重叠（重叠会导致 as-of 歧义）。
 */
export function validateIndustryIntervals(
  assignments: readonly IndustryAssignment[],
  securityId: SecurityId,
): IndustryIntervalValidation {
  const issues: Array<{ code: string; message: string }> = [];
  const rows = assignments.filter((a) => a.securityId === securityId);

  for (const row of rows) {
    if (!isValidIsoDate(row.effectiveFrom)) {
      issues.push({ code: "INVALID_EFFECTIVE_FROM", message: `${securityId} effectiveFrom 非法：${row.effectiveFrom}` });
    }
    if (row.effectiveTo !== null && !isValidIsoDate(row.effectiveTo)) {
      issues.push({ code: "INVALID_EFFECTIVE_TO", message: `${securityId} effectiveTo 非法：${row.effectiveTo}` });
    }
    if (isValidIsoDate(row.effectiveFrom) && row.effectiveTo !== null && isValidIsoDate(row.effectiveTo) && row.effectiveFrom > row.effectiveTo) {
      issues.push({ code: "FROM_AFTER_TO", message: `${securityId} effectiveFrom > effectiveTo` });
    }
  }

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (industryIntervalsOverlap(rows[i]!, rows[j]!)) {
        issues.push({
          code: "OVERLAPPING_INTERVALS",
          message: `${securityId} 行业区间重叠：${rows[i]!.industryCode}[${rows[i]!.effectiveFrom},${rows[i]!.effectiveTo ?? "∞"}] vs ${rows[j]!.industryCode}[${rows[j]!.effectiveFrom},${rows[j]!.effectiveTo ?? "∞"}]`,
        });
      }
    }
  }

  const hasInvalid = issues.some((issue) => issue.code.startsWith("INVALID"));
  if (hasInvalid) return { status: "INVALID", issues };
  return { status: issues.length > 0 ? "WARNING" : "VALID", issues };
}

/**
 * 按 as-of 解析某证券在某日的行业归属。
 * 返回该时点生效的 IndustryAssignment；无归属返回 null。
 * 若该时点命中多个区间（数据重叠），抛错（数据质量错误，禁止静默挑一个）。
 *
 * @param options.asOf point-in-time 截止点（YYYY-MM-DD）。提供时，仅当该归属在 asOf 时点「已被
 *   写入系统」（retrievedAt <= asOf）才可见，杜绝「用晚于查询日才获取的行业回填历史」的未来函数。
 *   缺省 asOf 为 null（全知视角，兼容既有只按 effectiveFrom/effectiveTo 的调用）。
 */
export function getIndustryAt(
  assignments: readonly IndustryAssignment[],
  securityId: SecurityId,
  date: string,
  options: { asOf?: string | null } = {},
): IndustryAssignment | null {
  if (!isValidIsoDate(date)) {
    throw new Error(`getIndustryAt 收到非法日期：${date}`);
  }
  const asOf = options.asOf ?? null;
  if (asOf !== null && !isValidIsoDate(asOf)) {
    throw new Error(`getIndustryAt 收到非法 asOf：${asOf}`);
  }
  const matches = assignments.filter(
    (a) =>
      a.securityId === securityId &&
      a.effectiveFrom <= date &&
      (a.effectiveTo === null || date <= a.effectiveTo) &&
      // availability 过滤：asOf 提供时，仅纳入「asOf 时点已写入」的归属。
      (asOf === null || a.retrievedAt.slice(0, 10) <= asOf),
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `getIndustryAt 歧义：${securityId} 在 ${date} 命中 ${matches.length} 个行业区间，数据重叠`,
    );
  }
  return matches[0]!;
}

/** 返回某证券全部行业区间（按 effectiveFrom 升序）。 */
export function getIndustryIntervals(
  assignments: readonly IndustryAssignment[],
  securityId: SecurityId,
): IndustryAssignment[] {
  return assignments
    .filter((a) => a.securityId === securityId)
    .slice()
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** 判断一个证券当前是否存在「当前行业」（effectiveTo === null 的区间）。 */
export function hasCurrentIndustry(
  assignments: readonly IndustryAssignment[],
  securityId: SecurityId,
): boolean {
  return assignments.some((a) => a.securityId === securityId && a.effectiveTo === null);
}
