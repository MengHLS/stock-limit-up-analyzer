import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

/** WORK B 验证：直接 SQL 确认两张表行数与明细。 */
async function main() {
  const db = await getDb();
  if (!db) throw new Error("无法连接数据库");

  const [securities, identifiers, distinct, reuse] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) AS c FROM research_securities`),
    db.execute(sql`SELECT COUNT(*) AS c FROM research_security_identifier_history`),
    db.execute(sql`SELECT COUNT(DISTINCT securityId) AS c FROM research_securities`),
    db.execute(sql`
      SELECT exchange, securityCode, COUNT(DISTINCT securityId) AS n
      FROM research_security_identifier_history
      GROUP BY exchange, securityCode
      HAVING n > 1
    `),
  ]);

  const first = (rows: unknown): number => {
    const arr = rows as Array<{ c: number | bigint | string }>;
    return Number(arr[0]?.c ?? 0);
  };

  console.log("=== SQL 验证 ===");
  console.log(`research_securities 行数 = ${first(securities[0])}`);
  console.log(`research_security_identifier_history 行数 = ${first(identifiers[0])}`);
  console.log(`distinct securityId = ${first(distinct[0])}`);
  console.log(`code reuse（同 code 多 securityId）组数 = ${(reuse[0] as unknown[]).length}`);

  const detail = await db.execute(sql`
    SELECT s.securityId, s.exchange, s.status, s.listedDate, s.delistedDate, i.securityCode, i.effectiveFrom, i.effectiveTo
    FROM research_securities s
    LEFT JOIN research_security_identifier_history i ON i.securityId = s.securityId
    ORDER BY s.listedDate
  `);
  console.log("明细：");
  for (const row of detail[0] as Array<Record<string, unknown>>) {
    console.log(`  ${String(row.securityId)} ${String(row.exchange)} ${String(row.securityCode)} [${String(row.effectiveFrom)}, ${String(row.effectiveTo)}] status=${String(row.status)} listed=${String(row.listedDate)} delisted=${String(row.delistedDate)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("验证失败：", e);
    process.exit(1);
  });
