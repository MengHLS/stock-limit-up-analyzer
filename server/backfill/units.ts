/**
 * STEP 7.3 — 单位转换（Tushare daily → canonical）。
 *
 * Tushare daily 原始单位：vol = 手（1 手 = 100 股）、amount = 千元。
 * Canonical 单位：volume = shares（股）、amount = CNY（元）。
 *
 * 转换铁律（见 STEP 7.3 §16 单位转换测试）：
 *   - vol = 1234（手）  → volume = 123400（股）
 *   - amount = 5678（千元）→ amount = 5,678,000（元）
 * 严禁发生 ×100 两次 / ×1000 两次 / 完全不转换。
 */

/** 1 手 = 100 股。 */
export const SHARES_PER_HAND = 100;

/** 1 千元 = 1000 元。 */
export const CNY_PER_THOUSAND = 1000;

/** 手 → 股（shares）。 */
export function tushareVolToShares(vol: number): number {
  return vol * SHARES_PER_HAND;
}

/** 千元 → 元（CNY）。 */
export function tushareAmountToCny(amount: number): number {
  return amount * CNY_PER_THOUSAND;
}

/** 一次性转换 Tushare daily 的 vol/amount 到 canonical 的 volume/amount。 */
export function convertTushareDailyUnits(input: {
  vol: number;
  amount: number;
}): { volume: number; amount: number } {
  return {
    volume: tushareVolToShares(input.vol),
    amount: tushareAmountToCny(input.amount),
  };
}

/**
 * 把任意 provider 原始成交量规范化为 shares。
 * 输入单位必须显式声明（shares 原样、hands × 100）；null 原样返回 null。
 */
export function normalizeVolumeToShares(value: number | null, unit: "shares" | "hands"): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  return unit === "hands" ? value * SHARES_PER_HAND : value;
}

/**
 * 把任意 provider 原始成交额规范化为 CNY。
 * 输入单位必须显式声明（cny 原样、thousand-cny × 1000）；null 原样返回 null。
 */
export function normalizeAmountToCny(value: number | null, unit: "cny" | "thousand-cny"): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  return unit === "thousand-cny" ? value * CNY_PER_THOUSAND : value;
}
