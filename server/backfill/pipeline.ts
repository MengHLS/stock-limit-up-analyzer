/**
 * STEP 7.3 — 单日数据处理管线（Raw → Canonical → Validate → Persistable）。
 *
 * 把一次 provider response 处理为：
 *   - canonical bars（shares/CNY，用于审计）
 *   - persistable upsert rows（raw 手/千元，用于写入 stock_daily_prices）
 *   - 质量计数（invalid / unpersistable / warning）+ 质量留痕。
 * 纯函数、无副作用，便于单测。
 */

import type { ProviderDailyResult, RawDailyBar, ValidationIssue } from "./types";
import { mapRawToCanonical } from "./canonical";
import { validateCanonicalBackfillBar } from "./validation";
import { hasRequiredPrices, rawBarToUpsert, toPersistableUpsert } from "./persistence";
import type { StockDailyPriceUpsert } from "../db";

/** 单条质量留痕。 */
export interface QualityIssue {
  securityCode: string;
  tradeDate: string;
  status: "VALID" | "WARNING" | "INVALID" | "UNPERSISTABLE";
  codes: string[];
}

export interface DailyPipelineResult {
  persistRows: StockDailyPriceUpsert[];
  invalidCount: number;
  unpersistableCount: number;
  warningCount: number;
  qualityIssues: QualityIssue[];
}

/**
 * 处理单日数据。仅 VALID / WARNING 且具备 NOT NULL 价格列的行进入 persistRows；
 * INVALID 与缺价格列的行拒写并计数。
 */
export function runDailyPipeline(
  result: ProviderDailyResult,
  options: { tradingDates?: ReadonlySet<string> } = {},
): DailyPipelineResult {
  const context = {
    source: result.provider,
    sourceVersion: result.schemaVersion,
    retrievedAt: result.retrievedAt,
    rawHash: result.rawHash,
  };

  const persistRows: StockDailyPriceUpsert[] = [];
  const qualityIssues: QualityIssue[] = [];
  let invalidCount = 0;
  let unpersistableCount = 0;
  let warningCount = 0;

  for (const raw of result.rows) {
    const bar = mapRawToCanonical(raw, context);
    const validation = validateCanonicalBackfillBar(bar, options);
    if (validation.status === "INVALID") {
      invalidCount += 1;
      qualityIssues.push({
        securityCode: bar.securityCode,
        tradeDate: bar.tradeDate,
        status: "INVALID",
        codes: validation.issues.map((issue: ValidationIssue) => issue.code),
      });
      continue;
    }
    const upsert = rawBarToUpsert(raw, result.provider);
    if (!hasRequiredPrices(upsert)) {
      unpersistableCount += 1;
      qualityIssues.push({
        securityCode: bar.securityCode,
        tradeDate: bar.tradeDate,
        status: "UNPERSISTABLE",
        codes: ["REQUIRED_PRICE_MISSING"],
      });
      continue;
    }
    persistRows.push(toPersistableUpsert(upsert));
    if (validation.status === "WARNING") {
      warningCount += 1;
      qualityIssues.push({
        securityCode: bar.securityCode,
        tradeDate: bar.tradeDate,
        status: "WARNING",
        codes: validation.issues.map((issue: ValidationIssue) => issue.code),
      });
    }
  }

  return { persistRows, invalidCount, unpersistableCount, warningCount, qualityIssues };
}

/** 从一次 provider response 中构造 canonical bars（审计用）。 */
export function toCanonicalBars(result: ProviderDailyResult): ReturnType<typeof mapRawToCanonical>[] {
  const context = {
    source: result.provider,
    sourceVersion: result.schemaVersion,
    retrievedAt: result.retrievedAt,
    rawHash: result.rawHash,
  };
  return result.rows.map((raw: RawDailyBar) => mapRawToCanonical(raw, context));
}
