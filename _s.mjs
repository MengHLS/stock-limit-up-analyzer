import { readFileSync } from "node:fs";
import { createConnection } from "mysql2/promise";
const url = readFileSync("./.env","utf8").match(/^DATABASE_URL=(.+)$/m)[1].trim();
const conn = await createConnection(url);
const q = async (tag) => {
  const [r] = await conn.query(`SELECT (SELECT COUNT(*) FROM liquidity_daily) e, (SELECT COUNT(DISTINCT securityCode) FROM liquidity_daily) ec, (SELECT COUNT(*) FROM research_security_status_history) c, (SELECT COUNT(DISTINCT securityId) FROM research_security_status_history) cc, (SELECT MAX(id) FROM liquidity_daily) maxid FROM dual`);
  console.log(tag, JSON.stringify(r[0]), new Date().toLocaleTimeString("zh-CN",{timeZone:"Asia/Shanghai"}));
};
await q("t0");
await new Promise(r=>setTimeout(r,12000));
await q("t1");
await conn.end();
