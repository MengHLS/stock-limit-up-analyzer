/**
 * STEP 9 — Risk Engine · 限额校验（Risk Limit Validation）。
 *
 * 校验 RiskLimit 配置的合法性（纯函数，确定性）。
 * 本引擎不写死任何策略参数；所有限额都是输入。
 */

import type { RiskLimit } from "./domain";

/** 校验风险限额，返回非法字段列表（空数组表示合法）。 */
export function validateRiskLimits(limits: RiskLimit): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(limits.maxPositions) || limits.maxPositions < 0) {
    errors.push("maxPositions 必须为非负整数");
  }
  if (!Number.isFinite(limits.maxPositionWeight) || limits.maxPositionWeight < 0 || limits.maxPositionWeight > 1) {
    errors.push("maxPositionWeight 必须在 [0,1]");
  }
  if (!Number.isFinite(limits.maxSectorWeight) || limits.maxSectorWeight < 0 || limits.maxSectorWeight > 1) {
    errors.push("maxSectorWeight 必须在 [0,1]");
  }
  if (!Number.isFinite(limits.maxGrossExposure) || limits.maxGrossExposure < 0) {
    errors.push("maxGrossExposure 必须为非负有限数");
  }
  if (!Number.isFinite(limits.maxNetExposure) || limits.maxNetExposure < 0) {
    errors.push("maxNetExposure 必须为非负有限数");
  }
  if (!Number.isFinite(limits.maxDrawdown) || limits.maxDrawdown < 0 || limits.maxDrawdown > 1) {
    errors.push("maxDrawdown 必须在 [0,1]");
  }
  if (!Number.isFinite(limits.maxDailyLoss) || limits.maxDailyLoss < 0 || limits.maxDailyLoss > 1) {
    errors.push("maxDailyLoss 必须在 [0,1]");
  }
  return errors;
}

/** 断言限额合法，非法时抛错。 */
export function assertValidRiskLimits(limits: RiskLimit): void {
  const errors = validateRiskLimits(limits);
  if (errors.length > 0) {
    throw new Error(`RiskLimit 非法：${errors.join("；")}`);
  }
}
