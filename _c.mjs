import { readFileSync } from "node:fs";
import { createConnection } from "mysql2/promise";
const url = readFileSync("./.env","utf8").match(/^DATABASE_URL=(.+)$/m)[1].trim();
const conn = await createConnection(url);
const [r] = await conn.query("SELECT (SELECT COUNT(DISTINCT securityCode) FROM liquidity_daily) ec FROM dual");
console.log("ec:", r[0].ec, new Date().toLocaleTimeString("zh-CN",{timeZone:"Asia/Shanghai"}));
await conn.end();
