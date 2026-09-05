/**
 * STEP 7.3 — Canonical Backfill Bar 校验。
 *
 * 三态语义（与既有 server/data/validation 等价）：
 *   - VALID   ：硬性不变量全部满足。
 *   - WARNING ：缺失字段 / 轻微不一致（仍可消费，但调用方应知晓）。
 *   - INVALID ：违反硬性不变量（NaN/Infinity、负值、OHLC 矛盾、空代码、非法日期）。
 *
 * 本模块只「报告」不「修复」；禁止 close || 0 等静默填零。
 * 价格采用 > 0（与 STEP 5 `validateMarketBar` 的 NOT_POSITIVE 语义一致，
 * 严格于 §15 的 ">= 0" 下界，安全方向一致）；volume/amount 采用 >= 0。
 */

import type {
  BarValidationResult,
  CanonicalBackfillBar,
  DataQuality,
  ValidationIssue,
} from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 交易所感知代码格式：6 位数字 + .SH/.SZ/.BJ。 */
const SECURITY_CODE_RE = /^\d{6}\.(SH|SZ|BJ)$/;

/** 校验 YYYY-MM-DD 且为真实存在的日历日。 */
export function isValidTradeDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const isPositive = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0;
const isNonNegative = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0;

function priceField(name: string, value: number | null): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (value === null) {
    issues.push({ severity: "WARNING", code: "FIELD_MISSING", message: `${name} 缺失（null）` });
  } else if (!Number.isFinite(value)) {
    issues.push({ severity: "INVALID", code: "NOT_FINITE", message: `${name} 非有限数值` });
  } else if (value <= 0) {
    issues.push({ severity: "INVALID", code: "NOT_POSITIVE", message: `${name} 必须 > 0，实际 ${value}` });
  }
  return issues;
}

/** 校验一根 canonical 全市场 bar。 */
export function validateCanonicalBackfillBar(
  bar: CanonicalBackfillBar,
  options: { tradingDates?: ReadonlySet<string> } = {},
): BarValidationResult {
  const issues: ValidationIssue[] = [];

  // 1. securityCode 非空 + 格式
  if (!bar.securityCode || bar.securityCode.trim().length === 0) {
    issues.push({ severity: "INVALID", code: "EMPTY_SYMBOL", message: "securityCode 为空" });
  } else if (!SECURITY_CODE_RE.test(bar.securityCode)) {
    issues.push({ severity: "WARNING", code: "MALFORMED_CODE", message: `securityCode 格式异常：${bar.securityCode}` });
  }

  // 2. tradeDate 合法
  if (!isValidTradeDate(bar.tradeDate)) {
    issues.push({ severity: "INVALID", code: "INVALID_DATE", message: `tradeDate 非法：${bar.tradeDate}` });
  }

  // 3-7. OHLC + preClose > 0
  for (const name of ["openPrice", "highPrice", "lowPrice", "closePrice", "preClosePrice"] as const) {
    issues.push(...priceField(name, bar[name]));
  }

  // 8. volume >= 0（shares）
  if (bar.volume === null) {
    issues.push({ severity: "WARNING", code: "FIELD_MISSING", message: "volume 缺失（null）" });
  } else if (!Number.isFinite(bar.volume) || bar.volume < 0) {
    issues.push({ severity: "INVALID", code: "NEGATIVE_VOLUME", message: `volume 必须 >= 0，实际 ${bar.volume}` });
  }

  // 9. amount >= 0（CNY）
  if (bar.amount === null) {
    issues.push({ severity: "WARNING", code: "FIELD_MISSING", message: "amount 缺失（null）" });
  } else if (!Number.isFinite(bar.amount) || bar.amount < 0) {
    issues.push({ severity: "INVALID", code: "NEGATIVE_AMOUNT", message: `amount 必须 >= 0，实际 ${bar.amount}` });
  }

  // 10. OHLC 关系不变量（仅在有足够有效价格时）
  const prices = [bar.openPrice, bar.highPrice, bar.lowPrice, bar.closePrice].filter(isPositive);
  if (prices.length >= 2) {
    const highCand = [bar.openPrice, bar.closePrice, bar.lowPrice].filter(isPositive);
    if (isPositive(bar.highPrice) && highCand.length > 0 && bar.highPrice < Math.max(...highCand)) {
      issues.push({ severity: "INVALID", code: "HIGH_LT_MAX", message: `high ${bar.highPrice} 小于 max(open/close/low)` });
    }
    const lowCand = [bar.openPrice, bar.closePrice, bar.highPrice].filter(isPositive);
    if (isPositive(bar.lowPrice) && lowCand.length > 0 && bar.lowPrice > Math.min(...lowCand)) {
      issues.push({ severity: "INVALID", code: "LOW_GT_MIN", message: `low ${bar.lowPrice} 大于 min(open/close/high)` });
    }
    if (isPositive(bar.highPrice) && isPositive(bar.lowPrice) && bar.highPrice < bar.lowPrice) {
      issues.push({ severity: "INVALID", code: "HIGH_LT_LOW", message: `high ${bar.highPrice} < low ${bar.lowPrice}` });
    }
  }

  // 11. tradeDate 是合法交易日（仅当提供交易日历时校验；日历缺失不误报）
  if (options.tradingDates && options.tradingDates.size > 0 && isValidTradeDate(bar.tradeDate) && !options.tradingDates.has(bar.tradeDate)) {
    issues.push({ severity: "WARNING", code: "NON_TRADING_DATE", message: `tradeDate ${bar.tradeDate} 不在交易日历内` });
  }

  const status: DataQuality = issues.some((issue) => issue.severity === "INVALID")
    ? "INVALID"
    : issues.length > 0
      ? "WARNING"
      : "VALID";
  return { status, issues };
}

/** 便捷断言：是否 VALID。 */
export function isBarValid(bar: CanonicalBackfillBar, options?: { tradingDates?: ReadonlySet<string> }): boolean {
  return validateCanonicalBackfillBar(bar, options).status === "VALID";
}
