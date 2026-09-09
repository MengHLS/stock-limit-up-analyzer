import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  const [stocks] = await conn.query(
    `SELECT DISTINCT stockCode FROM limit_up_records WHERE limitUpDate >= '2024-09-09' AND limitUpDate <= '2026-09-09'`,
  );
  const codes = stocks.map((r) => r.stockCode);
  const rangeStart = "2024-08-09", rangeEnd = "2026-09-23";
  const COLS = "stockCode, tradeDate, openPrice, closePrice, highPrice, lowPrice, amount, volume, preClosePrice";

  // 测试 1：小批量 IN(100) 9 列 SELECT
  const in100 = codes.slice(0, 100).map((c) => conn.escape(c)).join(",");
  let t = Date.now();
  const [r100] = await conn.query(
    `SELECT ${COLS} FROM stock_daily_prices WHERE stockCode IN (${in100}) AND tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  console.log(`IN(100) 9cols: ${r100.length} rows, ${Date.now() - t}ms`);

  // 测试 2：IN(500) 9 列 SELECT
  const in500 = codes.slice(0, 500).map((c) => conn.escape(c)).join(",");
  t = Date.now();
  const [r500] = await conn.query(
    `SELECT ${COLS} FROM stock_daily_prices WHERE stockCode IN (${in500}) AND tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  console.log(`IN(500) 9cols: ${r500.length} rows, ${Date.now() - t}ms`);

  // 测试 3：FORCE INDEX 全量 IN(3936) 9 列
  const inAll = codes.map((c) => conn.escape(c)).join(",");
  t = Date.now();
  const [rAll] = await conn.query(
    `SELECT ${COLS} FROM stock_daily_prices FORCE INDEX (idx_stock_daily_price_stock_date)
     WHERE stockCode IN (${inAll}) AND tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  console.log(`IN(ALL) 9cols FORCE INDEX: ${rAll.length} rows, ${Date.now() - t}ms`);

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
