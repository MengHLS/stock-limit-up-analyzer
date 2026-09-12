import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
const db = await getDb();
const r = await db.execute(sql.raw(`
SELECT
  (SELECT COUNT(*) FROM ds_first_limit_pullback_event) AS ev_total,
  (SELECT SUM(turnover IS NOT NULL) FROM ds_first_limit_pullback_event) AS ev_turnover_ok,
  (SELECT COUNT(*) FROM ds_first_limit_pullback_path) AS p_total,
  (SELECT SUM(turnover IS NOT NULL) FROM ds_first_limit_pullback_path) AS p_turnover_ok
`));
console.log("RESULT " + JSON.stringify((r as any[])[0][0]));
process.exit(0);
