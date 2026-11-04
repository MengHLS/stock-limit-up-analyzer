/**
 * STEP 12 WORK D — 全市场回填的纯函数批处理层（provider-neutral，无副作用）。
 *
 * 与 provider.ts 的「单股归一化解析」互补：本层负责「全市场按交易日拉取」后的
 * 批处理聚合 / 去重 / 事件股票推导，纯函数、可单测，不发网络、不写库。
 *
 * 硬约束：不动 types/provider/storage 现有纯函数逻辑——本文件只新增，不改既有实现。
 */

import { parseBaoStockAdjustFactors } from "./provider";
import type { AdjustmentFactor } from "./types";

/**
 * 聚合全市场复权因子（多交易日 daily_adjust_factor 行合并后统一解析 + 去重）。
 *
 * `query_daily_adjust_factor(date)` 逐日返回该除权除息日的全市场因子；跨日合并且
 * 逐股唯一（同一 securityCode 每个 effectiveDate 至多出现一次）。本函数做防御性去重：
 * 同 `securityCode|effectiveDate` 保留首条，`duplicates` 计数（幂等重跑时归零）。
 *
 * @param rows 与 parseBaoStockAdjustFactors 相同的行数组（[code, date, fore, back, ...]）。
 */
export function accumulateAdjustmentFactors(
  rows: readonly (string | number)[][],
  options: { retrievedAt?: string; source?: string } = {}
): { factors: AdjustmentFactor[]; skipped: number; duplicates: number } {
  const { factors, skipped } = parseBaoStockAdjustFactors(rows, options);
  const seen = new Set<string>();
  const deduped: AdjustmentFactor[] = [];
  let duplicates = 0;
  for (const factor of factors) {
    const key = `${factor.securityCode}|${factor.effectiveDate}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    deduped.push(factor);
  }
  return { factors: deduped, skipped, duplicates };
}

/**
 * 从复权因子推导「发生过除权除息事件的股票代码」去重列表（升序）。
 * 用于 dividend 全市场回填的股票清单（只对有事件的股票拉分红，避免无谓请求）。
 */
export function distinctEventCodes(
  factors: readonly AdjustmentFactor[]
): string[] {
  return Array.from(new Set(factors.map((f) => f.securityCode))).sort();
}

/** 把任意数组按固定大小切块（供 dividend 批量请求分组，避免单次 argv 过长）。 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
