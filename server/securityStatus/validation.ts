/**
 * STEP 7.5 — 状态区间校验（纯函数，只报告不修复）。
 */

import { isValidIsoDate } from "../security/dates";
import { isValidSecurityId } from "../security/securityId";
import { AVAILABILITIES, CONFIDENCE_LEVELS, STATUS_TYPES, STATUS_VALUES } from "./types";
import type { SecurityStatusInterval, StatusType } from "./types";

/** 单条校验问题。 */
export interface StatusValidationIssue {
  code: string;
  message: string;
}

/** 是否为合法状态维度。 */
export function isStatusType(value: string): value is StatusType {
  return (STATUS_TYPES as readonly string[]).includes(value);
}

/** 某维度下的取值是否合法。 */
export function isValidStatusValue(statusType: StatusType, statusValue: string): boolean {
  return (STATUS_VALUES[statusType] as readonly string[]).includes(statusValue);
}

/** 校验单条状态区间；返回问题列表（空 = 合法）。 */
export function validateStatusInterval(interval: SecurityStatusInterval): StatusValidationIssue[] {
  const issues: StatusValidationIssue[] = [];

  if (!isValidSecurityId(interval.securityId)) {
    issues.push({ code: "INVALID_SECURITY_ID", message: `非法 security_id：${interval.securityId}` });
  }
  if (!isStatusType(interval.statusType)) {
    issues.push({ code: "INVALID_STATUS_TYPE", message: `非法 status_type：${interval.statusType}` });
  } else if (!isValidStatusValue(interval.statusType, interval.statusValue)) {
    issues.push({
      code: "INVALID_STATUS_VALUE",
      message: `${interval.statusType} 不允许 status_value=${interval.statusValue}`,
    });
  }
  if (!isValidIsoDate(interval.effectiveFrom)) {
    issues.push({ code: "INVALID_EFFECTIVE_FROM", message: `非法 effectiveFrom：${interval.effectiveFrom}` });
  }
  if (interval.effectiveTo !== null && !isValidIsoDate(interval.effectiveTo)) {
    issues.push({ code: "INVALID_EFFECTIVE_TO", message: `非法 effectiveTo：${interval.effectiveTo}` });
  }
  if (
    isValidIsoDate(interval.effectiveFrom) &&
    interval.effectiveTo !== null &&
    isValidIsoDate(interval.effectiveTo) &&
    interval.effectiveFrom > interval.effectiveTo
  ) {
    issues.push({ code: "INVERTED_INTERVAL", message: `effectiveFrom > effectiveTo` });
  }
  if (!(CONFIDENCE_LEVELS as readonly string[]).includes(interval.confidence)) {
    issues.push({ code: "INVALID_CONFIDENCE", message: `非法 confidence：${interval.confidence}` });
  }
  if (!(AVAILABILITIES as readonly string[]).includes(interval.availability)) {
    issues.push({ code: "INVALID_AVAILABILITY", message: `非法 availability：${interval.availability}` });
  }

  return issues;
}
