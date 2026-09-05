/**
 * STEP 7.7 — Corporate Action / Adjustment Factor 持久化（integration 层）。
 *
 * 职责：把 provider-neutral 对象写入/读出 corporate_actions 与 adjustment_factors 表。
 * 纯解析与复权计算在 engine/provider 层完成；本层只做「类型 ↔ DB varchar」转换与幂等写入。
 * 注意：本层需要真实 DB，测试在无库环境下跳过（属 ENVIRONMENTAL）。
 */

import { and, eq, sql } from "drizzle-orm";
import {
  adjustmentFactors,
  corporateActions,
  type InsertAdjustmentFactor,
  type InsertCorporateAction,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { AdjustmentFactor, CorporateAction } from "./types";

function numToStr(value: number | null): string | null {
  return value === null || !Number.isFinite(value) ? null : String(value);
}

function strToNum(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function actionToInsert(action: CorporateAction): InsertCorporateAction {
  return {
    securityId: action.securityId,
    securityCode: action.securityCode,
    actionType: action.actionType,
    effectiveDate: action.effectiveDate,
    recordDate: action.recordDate,
    announcementDate: action.announcementDate,
    cashAmount: numToStr(action.cashAmount),
    bonusRatio: numToStr(action.bonusRatio),
    transferRatio: numToStr(action.transferRatio),
    rightsRatio: numToStr(action.rightsRatio),
    rightsPrice: numToStr(action.rightsPrice),
    splitRatio: numToStr(action.splitRatio),
    description: action.description,
    source: action.source,
    retrievedAt: new Date(action.retrievedAt),
  };
}

function rowToAction(
  row: typeof corporateActions.$inferSelect
): CorporateAction {
  return {
    securityId: row.securityId,
    securityCode: row.securityCode,
    actionType: row.actionType,
    effectiveDate: row.effectiveDate,
    recordDate: row.recordDate,
    announcementDate: row.announcementDate,
    cashAmount: strToNum(row.cashAmount),
    bonusRatio: strToNum(row.bonusRatio),
    transferRatio: strToNum(row.transferRatio),
    rightsRatio: strToNum(row.rightsRatio),
    rightsPrice: strToNum(row.rightsPrice),
    splitRatio: strToNum(row.splitRatio),
    description: row.description,
    source: row.source,
    retrievedAt: row.retrievedAt.toISOString(),
  };
}

function factorToInsert(factor: AdjustmentFactor): InsertAdjustmentFactor {
  return {
    securityId: factor.securityId,
    securityCode: factor.securityCode,
    effectiveDate: factor.effectiveDate,
    foreFactor: String(factor.foreFactor),
    backFactor: String(factor.backFactor),
    source: factor.source,
    retrievedAt: new Date(factor.retrievedAt),
  };
}

/** 幂等写入公司行为（同 securityId+effectiveDate+actionType 覆盖更新）。 */
export async function upsertCorporateActions(
  actions: CorporateAction[]
): Promise<number> {
  const db = await getDb();
  if (!db || actions.length === 0) return 0;
  const BATCH_SIZE = 200;
  for (let i = 0; i < actions.length; i += BATCH_SIZE) {
    const batch = actions.slice(i, i + BATCH_SIZE).map(actionToInsert);
    await db
      .insert(corporateActions)
      .values(batch)
      .onDuplicateKeyUpdate({
        set: {
          recordDate: sql`VALUES(\`recordDate\`)`,
          announcementDate: sql`VALUES(\`announcementDate\`)`,
          cashAmount: sql`VALUES(\`cashAmount\`)`,
          bonusRatio: sql`VALUES(\`bonusRatio\`)`,
          transferRatio: sql`VALUES(\`transferRatio\`)`,
          rightsRatio: sql`VALUES(\`rightsRatio\`)`,
          rightsPrice: sql`VALUES(\`rightsPrice\`)`,
          splitRatio: sql`VALUES(\`splitRatio\`)`,
          description: sql`VALUES(\`description\`)`,
          source: sql`VALUES(\`source\`)`,
          retrievedAt: sql`VALUES(\`retrievedAt\`)`,
          updatedAt: new Date(),
        },
      });
  }
  return actions.length;
}

/** 幂等写入复权因子（同 securityId+effectiveDate 覆盖更新）。 */
export async function upsertAdjustmentFactors(
  factors: AdjustmentFactor[]
): Promise<number> {
  const db = await getDb();
  if (!db || factors.length === 0) return 0;
  const BATCH_SIZE = 200;
  for (let i = 0; i < factors.length; i += BATCH_SIZE) {
    const batch = factors.slice(i, i + BATCH_SIZE).map(factorToInsert);
    await db
      .insert(adjustmentFactors)
      .values(batch)
      .onDuplicateKeyUpdate({
        set: {
          foreFactor: sql`VALUES(\`foreFactor\`)`,
          backFactor: sql`VALUES(\`backFactor\`)`,
          source: sql`VALUES(\`source\`)`,
          retrievedAt: sql`VALUES(\`retrievedAt\`)`,
          updatedAt: new Date(),
        },
      });
  }
  return factors.length;
}

/** 按证券代码查询公司行为（effectiveDate 升序）。 */
export async function listCorporateActions(
  securityCode: string
): Promise<CorporateAction[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(corporateActions)
    .where(eq(corporateActions.securityCode, securityCode))
    .orderBy(corporateActions.effectiveDate);
  return rows.map(rowToAction);
}

/** 按证券代码查询复权因子（effectiveDate 升序）。 */
export async function listAdjustmentFactors(
  securityCode: string
): Promise<AdjustmentFactor[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(adjustmentFactors)
    .where(eq(adjustmentFactors.securityCode, securityCode))
    .orderBy(adjustmentFactors.effectiveDate);
  return rows.map(row => ({
    securityId: row.securityId,
    securityCode: row.securityCode,
    effectiveDate: row.effectiveDate,
    foreFactor: Number(row.foreFactor),
    backFactor: Number(row.backFactor),
    source: row.source,
    retrievedAt: row.retrievedAt.toISOString(),
  }));
}

/** 查询某证券代码在指定生效日的公司行为。 */
export async function getCorporateAction(
  securityCode: string,
  effectiveDate: string,
  actionType: CorporateAction["actionType"]
): Promise<CorporateAction | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(corporateActions)
    .where(
      and(
        eq(corporateActions.securityCode, securityCode),
        eq(corporateActions.effectiveDate, effectiveDate),
        eq(corporateActions.actionType, actionType)
      )
    )
    .limit(1);
  return rows.length > 0 ? rowToAction(rows[0]!) : null;
}
