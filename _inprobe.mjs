import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);

  // 拿候选股票列表
  const [stocks] = await conn.query(
    `SELECT DISTINCT stockCode FROM limit_up_records WHERE limitUpDate >= '2024-09-09' AND limitUpDate <= '2026-09-09'`,
  );
  const codes = stocks.map((r) => r.stockCode);
  console.log(`candidate stocks: ${codes.length}`);

  const rangeStart = "2024-08-09", rangeEnd = "2026-09-23";

  // 测试 1：IN 500 只 + 2年范围
  const batch500 = codes.slice(0, 500);
  const in500 = batch500.map((c) => conn.escape(c)).join(",");
  const t0 = Date.now();
  const [r1] = await conn.query(
    `SELECT COUNT(*) AS c FROM stock_daily_prices WHERE stockCode IN (${in500}) AND tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  console.log(`[1] IN(500) + 2y range COUNT: ${r1[0].c} rows, ${Date.now() - t0}ms`);

  // 测试 2：IN 全部 3936 只 + 2年范围
  const inAll = codes.map((c) => conn.escape(c)).join(",");
  const t1 = Date.now();
  const [r2] = await conn.query(
    `SELECT COUNT(*) AS c FROM stock_daily_prices WHERE stockCode IN (${inAll}) AND tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  console.log(`[2] IN(ALL ${codes.length}) + 2y range COUNT: ${r2[0].c} rows, ${Date.now() - t1}ms`);

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
