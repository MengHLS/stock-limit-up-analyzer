import { readFileSync } from "node:fs";
import { createConnection } from "mysql2/promise";
const env = readFileSync("./.env", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const conn = await createConnection(url);
const snap = async (tag) => {
  const [r] = await conn.query(
    `SELECT (SELECT COUNT(DISTINCT securityCode) FROM liquidity_daily) ec,
            (SELECT COUNT(*) FROM liquidity_daily) er,
            (SELECT COUNT(*) FROM research_security_status_history) c
     FROM dual`
  );
  console.log(tag.padEnd(6), JSON.stringify(r[0]), new Date().toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" }));
  return r[0];
};
const a = await snap("t0");
for (let i = 1; i <= 5; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  await snap(`t${i}`);
}
const b = await snap("t6");
await conn.end();
