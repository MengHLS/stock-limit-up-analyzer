/**
 * STEP 12 WORK D — Corporate Action / Adjustment Factor 落库验证。
 * 查询 corporate_actions / adjustment_factors 的行数、样例股票、字段抽查。
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { corporateActions, adjustmentFactors } from "../drizzle/schema";

async function main(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("数据库不可用（DATABASE_URL 未配置或连接失败）");
    process.exit(1);
  }

  const actionRows = await db.select({
    rowCount: sql<number>`COUNT(*)`,
    stockCount: sql<number>`COUNT(DISTINCT ${corporateActions.securityCode})`,
    minDate: sql<string | null>`MIN(${corporateActions.effectiveDate})`,
    maxDate: sql<string | null>`MAX(${corporateActions.effectiveDate})`,
  }).from(corporateActions);
  const factorRows = await db.select({
    rowCount: sql<number>`COUNT(*)`,
    stockCount: sql<number>`COUNT(DISTINCT ${adjustmentFactors.securityCode})`,
    minDate: sql<string | null>`MIN(${adjustmentFactors.effectiveDate})`,
    maxDate: sql<string | null>`MAX(${adjustmentFactors.effectiveDate})`,
  }).from(adjustmentFactors);

  console.log("== corporate_actions ==");
  console.log(`  rows=${Number(actionRows[0]?.rowCount ?? 0)} stocks=${Number(actionRows[0]?.stockCount ?? 0)} min=${actionRows[0]?.minDate ?? "-"} max=${actionRows[0]?.maxDate ?? "-"}`);
  console.log("== adjustment_factors ==");
  console.log(`  rows=${Number(factorRows[0]?.rowCount ?? 0)} stocks=${Number(factorRows[0]?.stockCount ?? 0)} min=${factorRows[0]?.minDate ?? "-"} max=${factorRows[0]?.maxDate ?? "-"}`);

  // 样例：600519.SH 的最近 5 条公司行为 + 复权因子
  const sampleActions = await db.select().from(corporateActions)
    .where(sql`${corporateActions.securityCode} = '600519.SH'`)
    .orderBy(corporateActions.effectiveDate)
    .limit(8);
  console.log("\n== 样例：600519.SH 公司行为（前 8 条，按生效日升序）==");
  for (const r of sampleActions) {
    console.log(`  ${r.actionType.padEnd(12)} effective=${r.effectiveDate} record=${r.recordDate ?? "-"} ann=${r.announcementDate ?? "-"} cash=${r.cashAmount ?? "-"} bonus=${r.bonusRatio ?? "-"} transfer=${r.transferRatio ?? "-"} src=${r.source}`);
  }

  const sampleFactors = await db.select().from(adjustmentFactors)
    .where(sql`${adjustmentFactors.securityCode} = '600519.SH'`)
    .orderBy(adjustmentFactors.effectiveDate)
    .limit(5);
  console.log("\n== 样例：600519.SH 复权因子（前 5 条，按生效日升序）==");
  for (const r of sampleFactors) {
    console.log(`  effective=${r.effectiveDate} fore=${r.foreFactor} back=${r.backFactor} src=${r.source}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("验证失败：", error);
    process.exit(1);
  });
