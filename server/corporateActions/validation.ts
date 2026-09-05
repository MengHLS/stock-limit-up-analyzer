/**
 * STEP 7.7 — Corporate Action / Adjustment Factor 数据校验。
 *
 * 三态语义（与 server/data 层一致）：VALID / WARNING / INVALID。
 * 只「报告」不「修复」；缺失字段 → WARNING，硬性不变量违反（日期非法、因子非正、
 * 分解数值为负、拆/合股比例非法）→ INVALID。
 */

import type {
  ActionValidationResult,
  AdjustmentFactor,
  CorporateAction,
  DataQuality,
  ValidationIssue,
} from "./types";
import { isValidSecurityId } from "../security/securityId";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

const VALID_TYPES = new Set<CorporateAction["actionType"]>([
  "dividend",
  "bonus_issue",
  "transfer",
  "rights_issue",
  "split",
  "reverse_split",
  "other",
]);

/** 校验单条 CorporateAction。 */
export function validateCorporateAction(
  action: CorporateAction
): ActionValidationResult {
  const issues: ValidationIssue[] = [];
  if (!action.securityCode || action.securityCode.trim().length === 0) {
    issues.push({
      severity: "INVALID",
      code: "EMPTY_SECURITY_CODE",
      message: "securityCode 为空",
    });
  }
  // securityId 若已提供，必须为合法 sec_<uuid>，禁止把代码写入 securityId。
  if (action.securityId !== null && action.securityId !== undefined) {
    if (action.securityId.trim().length === 0) {
      issues.push({
        severity: "INVALID",
        code: "EMPTY_SECURITY_ID",
        message: "securityId 为空字符串",
      });
    } else if (!isValidSecurityId(action.securityId)) {
      issues.push({
        severity: "INVALID",
        code: "INVALID_SECURITY_ID",
        message: `securityId 非合法 sec_<uuid>：${action.securityId}`,
      });
    }
  }
  if (!VALID_TYPES.has(action.actionType)) {
    issues.push({
      severity: "INVALID",
      code: "INVALID_ACTION_TYPE",
      message: `actionType 非法：${action.actionType}`,
    });
  }
  if (!isValidDate(action.effectiveDate)) {
    issues.push({
      severity: "INVALID",
      code: "INVALID_EFFECTIVE_DATE",
      message: `effectiveDate 非法：${action.effectiveDate}`,
    });
  }
  for (const [name, value] of [
    ["recordDate", action.recordDate],
    ["announcementDate", action.announcementDate],
  ] as const) {
    if (value !== null && !isValidDate(value)) {
      issues.push({
        severity: "INVALID",
        code: `INVALID_${name.toUpperCase()}`,
        message: `${name} 非法：${value}`,
      });
    }
  }
  const numericFields: [string, number | null][] = [
    ["cashAmount", action.cashAmount],
    ["bonusRatio", action.bonusRatio],
    ["transferRatio", action.transferRatio],
    ["rightsRatio", action.rightsRatio],
    ["rightsPrice", action.rightsPrice],
    ["splitRatio", action.splitRatio],
  ];
  for (const [name, value] of numericFields) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      issues.push({
        severity: "INVALID",
        code: `NEGATIVE_${name.toUpperCase()}`,
        message: `${name} 必须 >= 0，实际 ${value}`,
      });
    }
  }
  // 类型一致性：split/reverse_split 必须带 splitRatio；其余类型不应误设 splitRatio
  if (
    (action.actionType === "split" || action.actionType === "reverse_split") &&
    action.splitRatio === null
  ) {
    issues.push({
      severity: "WARNING",
      code: "MISSING_SPLIT_RATIO",
      message: `${action.actionType} 缺少 splitRatio`,
    });
  }
  // 配股必须有配股价
  if (action.actionType === "rights_issue" && action.rightsPrice === null) {
    issues.push({
      severity: "WARNING",
      code: "MISSING_RIGHTS_PRICE",
      message: "rights_issue 缺少 rightsPrice",
    });
  }
  // 现金分红缺失金额提示
  if (
    action.actionType === "dividend" &&
    (action.cashAmount === null || action.cashAmount <= 0)
  ) {
    issues.push({
      severity: "WARNING",
      code: "MISSING_CASH_AMOUNT",
      message: "dividend 缺少正 cashAmount",
    });
  }

  const status: DataQuality = issues.some(i => i.severity === "INVALID")
    ? "INVALID"
    : issues.length > 0
      ? "WARNING"
      : "VALID";
  return { status, issues };
}

/** 校验单条 AdjustmentFactor。 */
export function validateAdjustmentFactor(
  factor: AdjustmentFactor
): ActionValidationResult {
  const issues: ValidationIssue[] = [];
  if (!factor.securityCode || factor.securityCode.trim().length === 0) {
    issues.push({
      severity: "INVALID",
      code: "EMPTY_SECURITY_CODE",
      message: "securityCode 为空",
    });
  }
  // securityId 若已提供，必须为合法 sec_<uuid>。
  if (factor.securityId !== null && factor.securityId !== undefined) {
    if (factor.securityId.trim().length === 0) {
      issues.push({
        severity: "INVALID",
        code: "EMPTY_SECURITY_ID",
        message: "securityId 为空字符串",
      });
    } else if (!isValidSecurityId(factor.securityId)) {
      issues.push({
        severity: "INVALID",
        code: "INVALID_SECURITY_ID",
        message: `securityId 非合法 sec_<uuid>：${factor.securityId}`,
      });
    }
  }
  if (!isValidDate(factor.effectiveDate)) {
    issues.push({
      severity: "INVALID",
      code: "INVALID_EFFECTIVE_DATE",
      message: `effectiveDate 非法：${factor.effectiveDate}`,
    });
  }
  if (!Number.isFinite(factor.foreFactor) || factor.foreFactor <= 0) {
    issues.push({
      severity: "INVALID",
      code: "NON_POSITIVE_FORE_FACTOR",
      message: `foreFactor 必须 > 0，实际 ${factor.foreFactor}`,
    });
  }
  if (!Number.isFinite(factor.backFactor) || factor.backFactor <= 0) {
    issues.push({
      severity: "INVALID",
      code: "NON_POSITIVE_BACK_FACTOR",
      message: `backFactor 必须 > 0，实际 ${factor.backFactor}`,
    });
  }
  const status: DataQuality = issues.some(i => i.severity === "INVALID")
    ? "INVALID"
    : issues.length > 0
      ? "WARNING"
      : "VALID";
  return { status, issues };
}
