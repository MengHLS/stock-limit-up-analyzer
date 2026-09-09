import { readFileSync } from "node:fs";
import { createConnection } from "mysql2/promise";
const env = readFileSync("./.env", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const conn = await createConnection(url);
const [r] = await conn.query(`SELECT
  (SELECT COUNT(DISTINCT securityCode) FROM liquidity_daily) eCodes,
  (SELECT COUNT(*) FROM liquidity_daily) eRows,
  (SELECT COUNT(*) FROM research_security_status_history) cRows,
  (SELECT COUNT(DISTINCT securityId) FROM research_security_status_history) cIds,
  (SELECT COUNT(*) FROM corporate_actions) dCa,
  (SELECT COUNT(DISTINCT securityId) FROM corporate_actions) dCaIds,
  (SELECT COUNT(*) FROM adjustment_factors) dAdj,
  (SELECT COUNT(DISTINCT securityId) FROM adjustment_factors) dAdjIds,
  (SELECT COUNT(*) FROM research_security_identifier_history) universe
  FROM dual`);
console.log(JSON.stringify(r[0], null, 1), new Date().toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" }));
await conn.end();
