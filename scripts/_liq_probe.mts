import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
const db = await getDb();
const r = await db.execute(sql.raw(`
SELECT COUNT(*) AS total,
  SUM(turnoverRate IS NOT NULL) AS turnover_ok,
  SUM(totalMarketCap IS NOT NULL) AS totalmc_ok,
  SUM(circulationMarketCap IS NOT NULL) AS circmc_ok
FROM liquidity_daily`));
console.log("liquidity_daily 列覆盖: " + JSON.stringify((r as any[])[0]));
process.exit(0);
