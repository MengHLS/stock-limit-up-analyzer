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


// ---------------------------------------------------------------------------
// BaoStock daily 单位换算（STEP 7.3 扩展）
// ---------------------------------------------------------------------------
//
// BaoStock `query_history_k_data_plus` 日线原始单位：volume = 股（shares）、amount = 元（CNY）。
// 目标表 `stock_daily_prices` 的既有口径（与 Tushare 窄样本生产数据一致）为 volume = 手、
// amount = 千元，因此 BaoStock 行必须先 股→手（×0.01）、元→千元（×0.001）再入库。
// 换算系数与 `server/marketData/liquidity.ts` 的 `baostock-daily` scale 保持唯一一致。

/** 1 股 = 0.01 手（股 → 手）。 */
export const HANDS_PER_SHARE = 0.01;

/** 1 元 = 0.001 千元（元 → 千元）。 */
export const THOUSAND_CNY_PER_CNY = 0.001;

/** 股 → 手（stock_daily_prices.volume 口径）。 */
export function baostockVolToHands(vol: number): number {
  return vol * HANDS_PER_SHARE;
}

/** 元 → 千元（stock_daily_prices.amount 口径）。 */
export function baostockAmountToThousandCny(amount: number): number {
  return amount * THOUSAND_CNY_PER_CNY;
}

/** 股 → 手；null / 非有限 → null（不静默填零）。 */
export function normalizeBaostockVolumeToHands(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return baostockVolToHands(value);
}

/** 元 → 千元；null / 非有限 → null（不静默填零）。 */
export function normalizeBaostockAmountToThousandCny(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return baostockAmountToThousandCny(value);
}

/** 一次性把 BaoStock 原始 volume(股)/amount(元) 归一到 stock_daily_prices 口径 volume(手)/amount(千元)。 */
export function convertBaostockDailyUnits(input: {
  volume: number | null;
  amount: number | null;
}): { volume: number | null; amount: number | null } {
  return {
    volume: normalizeBaostockVolumeToHands(input.volume),
    amount: normalizeBaostockAmountToThousandCny(input.amount),
  };
}