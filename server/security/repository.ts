/**
 * STEP 7.4 — Security Master 落库仓库（幂等 upsert）。
 *
 * 把构建器产出的 Security[] / SecurityIdentifier[] 写入
 *   research_securities / research_security_identifier_history。
 *
 * 幂等依据：
 *   - research_securities 唯一键：securityId → ON DUPLICATE KEY UPDATE 覆盖快照字段。
 *   - research_security_identifier_history 唯一键：(exchange, securityCode, identifierType, effectiveFrom)
 *     → 同区间重复写入仅更新 securityId/effectiveTo/source。
 * 安全：均走参数化 drizzle 查询，不拼接用户输入。
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  researchSecurities,
  researchSecurityIdentifierHistory,
  type InsertResearchSecurity,
  type InsertResearchSecurityIdentifier,
} from "../../drizzle/schema";
import { detectCodeReuse, type CodeReuseRecord } from "./identifierHistory";
import type { Security, SecurityIdentifier } from "./types";

/** Security 领域对象 → research_securities 插入行（纯函数）。 */
export function toSecurityInsertRow(security: Security): InsertResearchSecurity {
  return {
    securityId: security.securityId,
    securityType: security.securityType,
    exchange: security.exchange,
    currency: security.currency,
    country: security.country,
    status: security.status,
    listedDate: security.listedDate,
    delistedDate: security.delistedDate,
  };
}

/** SecurityIdentifier 领域对象 → identifier history 插入行（纯函数）。 */
export function toIdentifierInsertRow(identifier: SecurityIdentifier): InsertResearchSecurityIdentifier {
  return {
    securityId: identifier.securityId,
    exchange: identifier.exchange,
    securityCode: identifier.code,
    identifierType: identifier.identifierType,
    effectiveFrom: identifier.effectiveFrom,
    effectiveTo: identifier.effectiveTo,
    source: identifier.source,
  };
}

/** 落库统计。 */
export interface PersistStats {
  securitiesPersisted: number;
  identifiersPersisted: number;
}

const BATCH_SIZE = 500;

/** 幂等写入 securities + identifiers；返回实际提交行数。 */
export async function upsertSecurityMaster(
  securities: readonly Security[],
  identifiers: readonly SecurityIdentifier[],
): Promise<PersistStats> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用（DATABASE_URL 未配置或连接失败）");

  let securitiesPersisted = 0;
  let identifiersPersisted = 0;

  for (let i = 0; i < securities.length; i += BATCH_SIZE) {
    const batch = securities.slice(i, i + BATCH_SIZE).map(toSecurityInsertRow);
    await db.insert(researchSecurities).values(batch).onDuplicateKeyUpdate({
      set: {
        securityType: sql`VALUES(\`securityType\`)`,
        exchange: sql`VALUES(\`exchange\`)`,
        currency: sql`VALUES(\`currency\`)`,
        country: sql`VALUES(\`country\`)`,
        status: sql`VALUES(\`status\`)`,
        listedDate: sql`VALUES(\`listedDate\`)`,
        delistedDate: sql`VALUES(\`delistedDate\`)`,
        updatedAt: new Date(),
      },
    });
    securitiesPersisted += batch.length;
  }

  for (let i = 0; i < identifiers.length; i += BATCH_SIZE) {
    const batch = identifiers.slice(i, i + BATCH_SIZE).map(toIdentifierInsertRow);
    await db.insert(researchSecurityIdentifierHistory).values(batch).onDuplicateKeyUpdate({
      set: {
        securityId: sql`VALUES(\`securityId\`)`,
        effectiveTo: sql`VALUES(\`effectiveTo\`)`,
        source: sql`VALUES(\`source\`)`,
        retrievedAt: new Date(),
      },
    });
    identifiersPersisted += batch.length;
  }

  return { securitiesPersisted, identifiersPersisted };
}

/** Security Master 表级统计（用于验证与报告）。 */
export interface SecurityMasterCounts {
  securities: number;
  identifiers: number;
  distinctSecurityIds: number;
}

export async function getSecurityMasterCounts(): Promise<SecurityMasterCounts> {
  const db = await getDb();
  if (!db) return { securities: 0, identifiers: 0, distinctSecurityIds: 0 };

  const [securityRows, identifierRows, distinctRows] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(researchSecurities),
    db.select({ c: sql<number>`COUNT(*)` }).from(researchSecurityIdentifierHistory),
    db.select({ c: sql<number>`COUNT(DISTINCT ${researchSecurities.securityId})` }).from(researchSecurities),
  ]);

  return {
    securities: Number(securityRows[0]?.c ?? 0),
    identifiers: Number(identifierRows[0]?.c ?? 0),
    distinctSecurityIds: Number(distinctRows[0]?.c ?? 0),
  };
}

/** 读取全量标识符历史（供 code reuse 检测 / 审计）。 */
export async function getIdentifierHistoryFromDb(): Promise<SecurityIdentifier[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    securityId: researchSecurityIdentifierHistory.securityId,
    exchange: researchSecurityIdentifierHistory.exchange,
    code: researchSecurityIdentifierHistory.securityCode,
    identifierType: researchSecurityIdentifierHistory.identifierType,
    effectiveFrom: researchSecurityIdentifierHistory.effectiveFrom,
    effectiveTo: researchSecurityIdentifierHistory.effectiveTo,
    source: researchSecurityIdentifierHistory.source,
  }).from(researchSecurityIdentifierHistory);
  return rows.map((row) => ({
    securityId: row.securityId,
    exchange: row.exchange,
    code: row.code,
    identifierType: row.identifierType,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    source: row.source,
  }));
}

/** 从库中检测代码复用（同一 code 在不同区间对应不同 security_id）。 */
export async function detectCodeReuseFromDb(): Promise<CodeReuseRecord[]> {
  return detectCodeReuse(await getIdentifierHistoryFromDb());
}
