/**
 * STEP 7.3 — Bounded Batch Persistence（幂等 upsert）。
 *
 * 目标表 `stock_daily_prices` 已按 (stockCode, tradeDate) 建立唯一约束，写入走
 * ON DUPLICATE KEY UPDATE，由数据库唯一约束承担最终一致性（禁止「先 select 再 insert」
 * 作为唯一幂等保障）。写入行使用表的既有单位约定（volume=手 / amount=千元，与既有
 * 候选池窄样本数据一致），canonical 的 shares/CNY 口径见 canonical.ts。
 */

import type { RawDailyBar } from "./types";
import type { StockDailyPriceUpsert } from "../db";

/** 数值 → 字符串（null/undefined/非有限 → null，绝不写 "null"/"undefined" 字面量）。 */
export function toNullableText(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return Number.isFinite(value) ? String(value) : null;
}

/** DB NOT NULL 价格列（任缺其一即无法按现有 schema 入库）。 */
export const REQUIRED_PRICE_FIELDS = ["open", "close", "preClose"] as const;

/**
 * 写入候选行（open/close/preClose 可能为 null，尚未满足 DB NOT NULL）。
 * 经 isPersistableUpsert 窄化后才可交给 upsertStockDailyPrices。
 */
export type StockDailyPriceUpsertCandidate = {
  stockCode: string;
  tradeDate: string;
  openPrice: string | null;
  closePrice: string | null;
  highPrice: string | null;
  lowPrice: string | null;
  amount: string | null;
  volume: string | null;
  preClosePrice: string | null;
  source: string;
};

/**
 * 原始行 → stock_daily_prices 写入候选行（表存 raw：volume 手 / amount 千元）。
 * 注意：open/close/preClose 缺失时为 null，由 isPersistableUpsert 过滤。
 */
export function rawBarToUpsert(raw: RawDailyBar, source: string): StockDailyPriceUpsertCandidate {
  return {
    stockCode: raw.securityCode,
    tradeDate: raw.tradeDate,
    openPrice: toNullableText(raw.open),
    closePrice: toNullableText(raw.close),
    highPrice: toNullableText(raw.high),
    lowPrice: toNullableText(raw.low),
    amount: toNullableText(raw.amount),
    volume: toNullableText(raw.volume),
    preClosePrice: toNullableText(raw.preClose),
    source,
  };
}

/** 是否具备 DB NOT NULL 列（open/close/preClose 均非 null）。 */
export function hasRequiredPrices(row: StockDailyPriceUpsertCandidate): boolean {
  return (
    row.openPrice !== null &&
    row.closePrice !== null &&
    row.preClosePrice !== null
  );
}

/**
 * 候选行 → 最终写入行（调用方保证已通过 hasRequiredPrices 检查）。
 * 用非空断言消除 null（与既有 toValidatedStockDailyPriceUpserts 的 text(bar.open)! 一致）。
 */
export function toPersistableUpsert(candidate: StockDailyPriceUpsertCandidate): StockDailyPriceUpsert {
  return {
    stockCode: candidate.stockCode,
    tradeDate: candidate.tradeDate,
    openPrice: candidate.openPrice!,
    closePrice: candidate.closePrice!,
    highPrice: candidate.highPrice,
    lowPrice: candidate.lowPrice,
    amount: candidate.amount,
    volume: candidate.volume,
    preClosePrice: candidate.preClosePrice!,
    source: candidate.source,
  };
}

export type UpsertFn = (rows: StockDailyPriceUpsert[]) => Promise<number>;

export interface PersistResult {
  /** 实际提交的行数。 */
  written: number;
  /** 批次数。 */
  batches: number;
}

/**
 * 有界分批持久化：把若干写入行按 batchSize 切片，逐批调用 upsertFn。
 * 禁止 9M 行一次性 INSERT，也禁止逐行 INSERT。批内失败向上抛出（由上层决定重试/标记）。
 */
export async function persistInBatches(
  rows: StockDailyPriceUpsert[],
  upsertFn: UpsertFn,
  batchSize: number,
): Promise<PersistResult> {
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  let written = 0;
  let batches = 0;
  for (let index = 0; index < rows.length; index += safeBatchSize) {
    const batch = rows.slice(index, index + safeBatchSize);
    if (batch.length === 0) continue;
    written += await upsertFn(batch);
    batches += 1;
  }
  return { written, batches };
}
