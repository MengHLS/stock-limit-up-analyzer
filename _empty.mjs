import { readFileSync } from "node:fs";
import { createConnection } from "mysql2/promise";
const url = readFileSync("./.env","utf8").match(/^DATABASE_URL=(.+)$/m)[1].trim();
const conn = await createConnection(url);
// 找出 identifier_history 中但 liquidity_daily 没数据的股
const [r] = await conn.query(`
  SELECT
    COUNT(DISTINCT ih.securityCode) total_in_universe,
    COUNT(DISTINCT CASE WHEN ld.securityCode IS NULL THEN ih.securityCode END) no_data,
    COUNT(DISTINCT CASE WHEN ld.securityCode IS NOT NULL THEN ih.securityCode END) has_data,
    COUNT(DISTINCT ld.securityCode) currently_in_liquidity
  FROM research_security_identifier_history ih
  LEFT JOIN (SELECT DISTINCT securityCode FROM liquidity_daily) ld ON ld.securityCode = CONCAT(ih.securityCode, '.', ih.exchange)
`);
console.log("universe 库存:", JSON.stringify(r[0]));
// 但已 backfilled 的不算，再减去 3018
// 真实场景：现在 universe 5552 中已 backfilled 3018，剩 2534 个未处理
// 其中 no_data 是哪些？
const [r2] = await conn.query(`
  SELECT
    COUNT(*) no_data_unprocessed
  FROM research_security_identifier_history ih
  WHERE NOT EXISTS (
    SELECT 1 FROM liquidity_daily ld
    WHERE ld.securityCode = CONCAT(ih.securityCode, '.', ih.exchange)
  )
`);
console.log("未处理且可能空股:", JSON.stringify(r2[0]));
await conn.end();