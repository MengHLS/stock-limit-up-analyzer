/**
 * STEP 7.6 — Point-in-Time 语义。
 *
 * 三类时间必须严格区分，不得混用：
 *   - effectiveDate  事实生效日（如行业归属开始生效的日期）。
 *   - availableAt    该事实「可被公众/系统获得」的时间（发布时点）。
 *   - retrievedAt    我们实际抓取/写入的时间。
 *
 * 当前系统无法确定发布时点（availableAt）时，必须显式标记 UNKNOWN（availableAt = null），
 * 严禁强行假设「T+1 发布」等未经证实的规则。
 */

import { isValidIsoDate } from "./types";

/** Point-in-Time 记录。availableAt = null 表示发布时点 UNKNOWN。 */
export interface PointInTime {
  /** 事实生效日（YYYY-MM-DD）。 */
  effectiveDate: string;
  /** 事实可获取时点（ISO 8601 datetime）；null = UNKNOWN。 */
  availableAt: string | null;
  /** 检索/写入时点（ISO 8601 datetime）。 */
  retrievedAt: string;
}

/** 发布时点已知性。 */
export type AvailabilityKnown = "KNOWN" | "UNKNOWN";

/** 判断发布时点是否已知。 */
export function availabilityStatus(pit: PointInTime): AvailabilityKnown {
  return pit.availableAt === null ? "UNKNOWN" : "KNOWN";
}

/**
 * 构造「发布时点未知」的 PIT 记录（不强行假设 T+1）。
 * retrievedAt 通常取抓取当时的服务器时钟。
 */
export function withUnknownAvailability(effectiveDate: string, retrievedAt: string): PointInTime {
  return { effectiveDate, availableAt: null, retrievedAt };
}

/** 校验结果（与 STEP 5 三态一致）。 */
export interface PointInTimeValidation {
  status: "VALID" | "WARNING" | "INVALID";
  issues: Array<{ code: string; message: string }>;
}

/**
 * 校验 PIT 记录的时间一致性：
 *   - effectiveDate 必须是合法日期；
 *   - retrievedAt 必须是合法 ISO datetime；
 *   - 若 availableAt 已知，必须满足 effectiveDate <= availableAt <= retrievedAt（时间顺序）；
 *   - availableAt 为 null（UNKNOWN）是合法的，不是错误。
 */
export function validatePointInTime(pit: PointInTime): PointInTimeValidation {
  const issues: Array<{ code: string; message: string }> = [];

  if (!isValidIsoDate(pit.effectiveDate)) {
    issues.push({ code: "INVALID_EFFECTIVE_DATE", message: `effectiveDate 非法：${pit.effectiveDate}` });
  }
  if (!isIsoDateTime(pit.retrievedAt)) {
    issues.push({ code: "INVALID_RETRIEVED_AT", message: `retrievedAt 非法：${pit.retrievedAt}` });
  }

  if (pit.availableAt !== null) {
    if (!isIsoDateTime(pit.availableAt)) {
      issues.push({ code: "INVALID_AVAILABLE_AT", message: `availableAt 非法：${pit.availableAt}` });
    } else {
      const effective = toComparable(pit.effectiveDate);
      const available = toComparable(pit.availableAt);
      const retrieved = toComparable(pit.retrievedAt);
      if (effective !== null && available !== null && available < effective) {
        issues.push({ code: "AVAILABLE_BEFORE_EFFECTIVE", message: `availableAt 早于 effectiveDate` });
      }
      if (available !== null && retrieved !== null && retrieved < available) {
        issues.push({ code: "RETRIEVED_BEFORE_AVAILABLE", message: `retrievedAt 早于 availableAt` });
      }
    }
  }

  const hasInvalid = issues.some((issue) => issue.code.startsWith("INVALID"));
  if (hasInvalid) return { status: "INVALID", issues };
  // UNKNOWN（availableAt null）不视为问题；仅当显式给了无效值才告警。
  return { status: issues.length > 0 ? "WARNING" : "VALID", issues };
}

/** 严格校验 ISO 8601 datetime（接受 "YYYY-MM-DDTHH:mm:ss(.mmm)Z"）。 */
function isIsoDateTime(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

/** 转成可比较的毫秒时间戳；非法返回 null。 */
function toComparable(value: string): number | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}
