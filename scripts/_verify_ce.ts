import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { researchSecurityStatusHistory, liquidityDaily } from "../drizzle/schema";

async function main() {
  const db = await getDb();
  if (!db) { console.log("no db"); return; }

  const [liqCount, liqCodes, statusCount, statusTypes] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(liquidityDaily),
    db.select({ c: sql<number>`COUNT(DISTINCT ${liquidityDaily.securityCode})` }).from(liquidityDaily),
    db.select({ c: sql<number>`COUNT(*)` }).from(researchSecurityStatusHistory),
    db.select({
      statusType: researchSecurityStatusHistory.statusType,
      c: sql<number>`COUNT(*)`,
    }).from(researchSecurityStatusHistory).groupBy(researchSecurityStatusHistory.statusType),
  ]);

  console.log("=== 两表行数 ===");
  console.log("liquidity_daily rows:", Number(liqCount[0]?.c ?? 0), "distinct codes:", Number(liqCodes[0]?.c ?? 0));
  console.log("status_history rows:", Number(statusCount[0]?.c ?? 0));
  console.log("status by type:", statusTypes.map((r) => `${r.statusType}=${Number(r.c)}`).join(", "));

  console.log("\n=== 停牌区间抽查（sz.000029 深深房A / sh.600485 信威）===");
  const susp = await db.select().from(researchSecurityStatusHistory)
    .where(sql`${researchSecurityStatusHistory.statusType} = 'SUSPENSION'`)
    .orderBy(researchSecurityStatusHistory.effectiveFrom)
    .limit(5);
  for (const r of susp) {
    console.log(`  ${r.securityId} ${r.statusValue} ${r.effectiveFrom}~${r.effectiveTo} src=${r.source} conf=${r.confidence} avail=${r.availability}`);
  }

  console.log("\n=== ST 区间抽查（sz.000017 深中华A / sh.600485）===");
  const st = await db.select().from(researchSecurityStatusHistory)
    .where(sql`${researchSecurityStatusHistory.statusType} = 'ST'`)
    .orderBy(researchSecurityStatusHistory.effectiveFrom)
    .limit(5);
  for (const r of st) {
    console.log(`  ${r.securityId} ${r.statusValue} ${r.effectiveFrom}~${r.effectiveTo} src=${r.source} conf=${r.confidence}`);
  }

  console.log("\n=== 流动性单位抽查（sh.600000 2026 最近若干行）===");
  const liq = await db.select().from(liquidityDaily)
    .where(sql`${liquidityDaily.securityCode} = '600000.SH'`)
    .orderBy(sql`${liquidityDaily.tradeDate} DESC`)
    .limit(3);
  for (const r of liq) {
    console.log(`  ${r.securityCode} ${r.tradeDate} turn=${r.turnoverRate} amount=${r.amount} volume=${r.volume} circMV=${r.circulationMarketCap} totalMV=${r.totalMarketCap} securityId=${r.securityId}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
