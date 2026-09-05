/**
 * STEP 7.3 — Raw → Canonical 归一化。
 *
 * 把 provider-neutral RawDailyBar 转换为 CanonicalBackfillBar：
 *   - 字段重命名（open→openPrice 等）
 *   - 单位归一：volume → shares、amount → CNY（复用 units.ts，禁止自行乘除）
 *   - 挂载 provenance（source / sourceVersion / retrievedAt / rawHash）
 * 本层不做静默修复：非法数值保持 null，交由 validation 层报告。
 */

import type { CanonicalBackfillBar, RawDailyBar } from "./types";
import { normalizeAmountToCny, normalizeVolumeToShares } from "./units";

/** 单次 provider response 的 provenance 上下文（该批次所有行共享）。 */
export interface CanonicalizationContext {
  source: string;
  sourceVersion: string;
  retrievedAt: string;
  rawHash: string | null;
}

/** 严格解析数字（null/非有限 → null；不静默填零）。 */
function toFiniteNumber(value: number | null): number | null {
  if (value === null) return null;
  return Number.isFinite(value) ? value : null;
}

/**
 * Raw → Canonical。单位归一后 price 为 元/股、volume 为 shares、amount 为 CNY。
 */
export function mapRawToCanonical(
  row: RawDailyBar,
  context: CanonicalizationContext,
): CanonicalBackfillBar {
  return {
    securityCode: row.securityCode,
    tradeDate: row.tradeDate,
    openPrice: toFiniteNumber(row.open),
    highPrice: toFiniteNumber(row.high),
    lowPrice: toFiniteNumber(row.low),
    closePrice: toFiniteNumber(row.close),
    preClosePrice: toFiniteNumber(row.preClose),
    volume: normalizeVolumeToShares(row.volume, row.volumeUnit),
    amount: normalizeAmountToCny(row.amount, row.amountUnit),
    source: context.source,
    sourceVersion: context.sourceVersion,
    retrievedAt: context.retrievedAt,
    rawHash: context.rawHash,
    adjustment: "raw",
  };
}

/**
 * 批量 Raw → Canonical（保持输入顺序）。
 */
export function mapRawToCanonicalBatch(
  rows: RawDailyBar[],
  context: CanonicalizationContext,
): CanonicalBackfillBar[] {
  return rows.map((row) => mapRawToCanonical(row, context));
}
