/**
 * STEP 12 WORK E — Liquidity 落库（integration 层）。
 *
 * 把 canonical LiquidityDaily bar 幂等写入 liquidity_daily。
 *
 * 唯一约束（drizzle/schema.ts）：uq_liquidity_daily_security_date (securityCode, tradeDate)。
 * 关键：natural key 是 securityCode（如 600000.SH）；securityId（sec_<uuid>）是可空软引用，
 * 若已知确定性身份则一并写入（由调用方用 server/security/deterministicId 生成），未知时为 null。
 *
 * 单位换算不在此层发生：调用方必须复用 normalizeLiquidity("baostock-daily", raw) 产出 canonical bar，
 * 本层只做 bar → DB 行的映射与幂等写入。
 */

import { sql } from "drizzle-orm";
import {
  liquidityDaily,
  type InsertLiquidityDaily,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { LiquidityDaily } from "./types";

/** 幂等键（与 uq_liquidity_daily_security_date 对齐）。纯函数。 */
export function liquidityDailyIdempotencyKey(securityCode: string, tradeDate: string): string {
  return `${securityCode}|${tradeDate}`;
}

/** 纯函数：canonical LiquidityDaily bar → InsertLiquidityDaily（单位不变，仅映射键）。 */
export function liquidityBarToInsert(
  bar: LiquidityDaily,
  securityCode: string,
  securityId?: string | null,
): InsertLiquidityDaily {
  return {
    securityId: securityId ?? null,
    securityCode,
    tradeDate: bar.tradeDate,
    turnoverRate: bar.turnoverRate,
    circulationMarketCap: bar.circulationMarketCap,
    totalMarketCap: bar.totalMarketCap,
    amount: bar.amount,
    volume: bar.volume,
    source: bar.source,
  };
}

/** 幂等写入流动性日线（同 securityCode+tradeDate 覆盖更新）。返回提交行数。
 *  批大小 5000：覆盖每股全区间（~1863 行）单条 INSERT，把公网 DB 往返从 4 次压到 1 次
 *  （500/批时每股 4 次往返，TiDB Cloud 公网单次往返 ~200ms+ 执行时间，是回填主要瓶颈）。 */
export async function upsertLiquidityDaily(rows: InsertLiquidityDaily[]): Promise<number> {
  const db = await getDb();
  if (!db || rows.length === 0) return 0;
  const BATCH_SIZE = 5000;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db.insert(liquidityDaily).values(batch).onDuplicateKeyUpdate({
      set: {
        securityId: sql`VALUES(\`securityId\`)`,
        turnoverRate: sql`VALUES(\`turnoverRate\`)`,
        circulationMarketCap: sql`VALUES(\`circulationMarketCap\`)`,
        totalMarketCap: sql`VALUES(\`totalMarketCap\`)`,
        amount: sql`VALUES(\`amount\`)`,
        volume: sql`VALUES(\`volume\`)`,
        source: sql`VALUES(\`source\`)`,
      },
    });
  }
  return rows.length;
}

/** 查询已回填的 securityCode 集合（供 resume 跳过已回填 code；无库返回空集）。 */
export async function getBackfilledSecurityCodes(): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set();
  const rows = await db
    .selectDistinct({ securityCode: liquidityDaily.securityCode })
    .from(liquidityDaily);
  return new Set(rows.map((row) => row.securityCode));
}
