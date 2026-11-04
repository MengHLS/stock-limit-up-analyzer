/**
 * STEP 12 WORK G — Historical Industry Assignment 持久化（integration 层）。
 *
 * 职责：把 provider-neutral 的 IndustryAssignment 幂等写入 industry_assignments 表
 * （ON DUPLICATE KEY UPDATE）。
 *
 * 唯一约束（drizzle/schema.ts）：uq_industry_assign_security_effective (securityCode, effectiveFrom)，
 * 保证同股同生效日不重复；重跑 upsert 幂等覆盖。
 *
 * 本层需要真实 DB；upsert 函数在无库环境下静默返回 0（ENVIRONMENTAL 降级），
 * 纯函数（转换）不依赖 DB，可独立单测。
 */

import { sql } from "drizzle-orm";
import {
  industryAssignments,
  type InsertIndustryAssignment,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { IndustryAssignment } from "./types";

/**
 * 纯函数：IndustryAssignment → InsertIndustryAssignment。
 *
 * 领域类型 IndustryAssignment.securityId 即规范化证券代码（如 "600000.SH"，见 types.ts），
 * 落库时映射到权威自然键 securityCode；DB 的 securityId 列是「永久身份」软引用
 * （sec_<uuid>，指向 research_securities），尚未回填 security master 时置 null
 * （与 corporateActions 口径一致，unique constraint 由 securityCode+effectiveFrom 承担）。
 */
export function industryAssignmentToInsert(assignment: IndustryAssignment): InsertIndustryAssignment {
  return {
    securityId: null,
    securityCode: assignment.securityId,
    industryCode: assignment.industryCode,
    industryName: assignment.industryName,
    effectiveFrom: assignment.effectiveFrom,
    effectiveTo: assignment.effectiveTo,
    source: assignment.source,
    retrievedAt: new Date(assignment.retrievedAt),
  };
}

/** 幂等写入行业归属（同 securityCode+effectiveFrom 覆盖更新）。 */
export async function upsertIndustryAssignments(assignments: IndustryAssignment[]): Promise<number> {
  const db = await getDb();
  if (!db || assignments.length === 0) return 0;
  const BATCH_SIZE = 500;
  for (let i = 0; i < assignments.length; i += BATCH_SIZE) {
    const batch = assignments.slice(i, i + BATCH_SIZE).map(industryAssignmentToInsert);
    await db.insert(industryAssignments).values(batch).onDuplicateKeyUpdate({
      set: {
        industryCode: sql`VALUES(\`industryCode\`)`,
        industryName: sql`VALUES(\`industryName\`)`,
        effectiveTo: sql`VALUES(\`effectiveTo\`)`,
        source: sql`VALUES(\`source\`)`,
        retrievedAt: sql`VALUES(\`retrievedAt\`)`,
      },
    });
  }
  return assignments.length;
}

/** 返回已回填的 securityCode 集合（供 resume 跳过）。无库返回空集。 */
export async function listBackfilledIndustrySecurityCodes(): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set();
  const rows = await db
    .selectDistinct({ securityCode: industryAssignments.securityCode })
    .from(industryAssignments);
  return new Set(rows.map((row) => row.securityCode));
}

/** 返回 industry_assignments 总行数（供验证）。无库返回 0。 */
export async function countIndustryAssignments(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ n: sql<number>`COUNT(*)` }).from(industryAssignments);
  return Number(rows[0]?.n ?? 0);
}
