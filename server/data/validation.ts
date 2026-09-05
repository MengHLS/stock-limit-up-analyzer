/**
 * STEP 5 — Canonical Market Bar 数据校验。
 *
 * 三态语义：
 *   - VALID   ：不变量全部满足。
 *   - WARNING ：存在缺失字段或轻微不一致（仍可消费，但调用方应知晓）；
 *               绝不把 WARNING 静默升级为 VALID。
 *   - INVALID ：违反硬性不变量（价格非正、OHLC 矛盾等），禁止无修复直接使用。
 *
 * 本模块只「报告」，不「修复」。禁止出现 close = close || 0 / amount || 0 等静默填零；
 * 数据修复必须作为显式策略由上层执行并标记 provenance。
 */

import type { BarValidationResult, CanonicalMarketBar, DataQuality, ValidationIssue } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const positivePrice = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0;
const nonNegative = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0;

function field(name: string, value: number | null): ValidationIssue[] {
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

/**
 * 校验一根 canonical bar。
 * @param options.stockName 当前未使用（为将来扩展保留，防止误以为已覆盖 ST 涨停校验）。
 */
export function validateMarketBar(bar: CanonicalMarketBar, options: { stockName?: string | null } = {}): BarValidationResult {
  const issues: ValidationIssue[] = [];

  // 1. symbol 非空
  if (!bar.symbol || bar.symbol.trim().length === 0) {
    issues.push({ severity: "INVALID", code: "EMPTY_SYMBOL", message: "symbol 为空" });
  }
  // 2. timestamp 合法
  if (!isValidDate(bar.timestamp)) {
    issues.push({ severity: "INVALID", code: "INVALID_DATE", message: `timestamp 非法：${bar.timestamp}` });
  }
  // 3-6. OHLC + preClose > 0（null 为缺失警告，非正为无效）
  for (const name of ["open", "high", "low", "close", "preClose"] as const) {
    issues.push(...field(name, bar[name]));
  }
  // 9. volume >= 0（缺失警告；负值无效）
  if (bar.volume === null) issues.push({ severity: "WARNING", code: "FIELD_MISSING", message: "volume 缺失（null）" });
  else if (!Number.isFinite(bar.volume) || bar.volume < 0) issues.push({ severity: "INVALID", code: "NEGATIVE_VOLUME", message: `volume 必须 >= 0，实际 ${bar.volume}` });
  // 10. amount >= 0
  if (bar.amount === null) issues.push({ severity: "WARNING", code: "FIELD_MISSING", message: "amount 缺失（null）" });
  else if (!Number.isFinite(bar.amount) || bar.amount < 0) issues.push({ severity: "INVALID", code: "NEGATIVE_AMOUNT", message: `amount 必须 >= 0，实际 ${bar.amount}` });
  // 11. turnoverRate（如有）范围：0 ~ 1000%（项目口径 %，极宽松上界避免误报）
  if (bar.turnoverRate !== null) {
    if (!Number.isFinite(bar.turnoverRate) || bar.turnoverRate < 0 || bar.turnoverRate > 1000) {
      issues.push({ severity: "INVALID", code: "TURNOVER_RATE_OUT_OF_RANGE", message: `turnoverRate 超出合理范围，实际 ${bar.turnoverRate}` });
    }
  }

  const prices = [bar.open, bar.high, bar.low, bar.close].filter((v): v is number => positivePrice(v));
  if (prices.length >= 2) {
    // 7. high >= max(open, close, low)
    const cand = [bar.open, bar.close, bar.low].filter((v): v is number => positivePrice(v));
    if (positivePrice(bar.high) && cand.length > 0 && bar.high < Math.max(...cand)) {
      issues.push({ severity: "INVALID", code: "HIGH_LT_MAX", message: `high ${bar.high} 小于 max(open/close/low) ${Math.max(...cand)}` });
    }
    // 8. low <= min(open, close, high)
    const candLow = [bar.open, bar.close, bar.high].filter((v): v is number => positivePrice(v));
    if (positivePrice(bar.low) && candLow.length > 0 && bar.low > Math.min(...candLow)) {
      issues.push({ severity: "INVALID", code: "LOW_GT_MIN", message: `low ${bar.low} 大于 min(open/close/high) ${Math.min(...candLow)}` });
    }
    // 隐含：high < low 本身矛盾
    if (positivePrice(bar.high) && positivePrice(bar.low) && bar.high < bar.low) {
      issues.push({ severity: "INVALID", code: "HIGH_LT_LOW", message: `high ${bar.high} < low ${bar.low}` });
    }
  }

  // 12. 涨停/跌停一致性（存储字段不存在于 canonical bar，由 isLimitUpBar / isLimitDownBar
  //     在读取侧按 boardRules 权威规则计算；此处无存储态可校验）。
  //     注意：close 达到涨停价即判定触及（close >= limitUpPrice），不存在「越过而未命中」。
  const severity: DataQuality = issues.some((issue) => issue.severity === "INVALID") ? "INVALID" : issues.length > 0 ? "WARNING" : "VALID";
  return { status: severity, issues };
}

/** 便捷断言：返回是否 VALID。 */
export function isBarValid(bar: CanonicalMarketBar, options?: { stockName?: string | null }): boolean {
  return validateMarketBar(bar, options).status === "VALID";
}

/**
 * 解析数值字段（DB 以 varchar 存储）。严格：null/空串/非法 → null。
 * 非法数值不会静默变成 0；保留 null 以便上层标记缺失。
 */
export function parseNumericPrice(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 统一「正价格」语义解析（元/股等价格字段）：经 parseNumericPrice 解析后还需 > 0，
 * 否则按缺失处理（null）。这是全系统价格读取的唯一权威语义；
 * 业务层不得再自造一套 toPositiveNumber。
 */
export function parsePositivePrice(value: string | number | null | undefined): number | null {
  const parsed = parseNumericPrice(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * 统一「非负数量/金额」语义解析（volume 手 / amount 千元等）：经 parseNumericPrice 解析后
 * 还需 >= 0，否则按缺失处理（null）。这是全系统非负数值读取的唯一权威语义；
 * 业务层不得再自造一套 toNonNegativeNumber。
 */
export function parseNonNegativeNumber(value: string | number | null | undefined): number | null {
  const parsed = parseNumericPrice(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}
