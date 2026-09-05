// Focused read-only follow-up queries for coverage precision.
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL=(\S+)/)[1].replace(/["']/g, "");
const u = new URL(url);
const conn = await mysql.createConnection({
  host: u.hostname, port: Number(u.port || 4000),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1), ssl: { rejectUnauthorized: true },
});
const q = async (sql, p = []) => (await conn.query(sql, p))[0];

const out = {};

// migration state
try {
  out.drizzleMigrations = await q("SELECT * FROM `__drizzle_migrations` ORDER BY created_at DESC LIMIT 200");
} catch (e) { out.drizzleMigrations = { error: e.sqlMessage }; }

// OHLCV clean dates
out.ohlcvDates = await q("SELECT DATE_FORMAT(MIN(tradeDate),'%Y-%m-%d') mn, DATE_FORMAT(MAX(tradeDate),'%Y-%m-%d') mx, COUNT(DISTINCT tradeDate) d FROM stock_daily_prices");

// OHLCV daily row distribution
out.ohlcvDailyDist = await q(`
  SELECT DATE_FORMAT(tradeDate,'%Y-%m-%d') d, COUNT(*) c FROM stock_daily_prices
  GROUP BY tradeDate ORDER BY tradeDate`);

// OHLCV distinct stocks per year
out.ohlcvStocksPerYear = await q(`
  SELECT YEAR(tradeDate) y, COUNT(DISTINCT stockCode) c FROM stock_daily_prices GROUP BY YEAR(tradeDate) ORDER BY y`);

// OHLCV exchange breakdown (SH/SZ/BJ)
out.ohlcvExchange = await q(`
  SELECT CASE
    WHEN stockCode LIKE '%.SH' THEN 'SH'
    WHEN stockCode LIKE '%.SZ' THEN 'SZ'
    WHEN stockCode LIKE '%.BJ' THEN 'BJ'
    ELSE 'OTHER' END AS ex,
    COUNT(*) c, COUNT(DISTINCT stockCode) ds
  FROM stock_daily_prices GROUP BY ex ORDER BY c DESC`);

// limit_up clean dates
out.limitUpDates = await q("SELECT DATE_FORMAT(MIN(limitUpDate),'%Y-%m-%d') mn, DATE_FORMAT(MAX(limitUpDate),'%Y-%m-%d') mx, COUNT(DISTINCT limitUpDate) d FROM limit_up_records");

// limit_up daily distribution (first/last 5)
out.limitUpDailyDist = await q(`
  SELECT DATE_FORMAT(limitUpDate,'%Y-%m-%d') d, COUNT(*) c FROM limit_up_records
  GROUP BY limitUpDate ORDER BY limitUpDate`);

// market_data clean dates + note coverage (verified vs not)
out.marketDataDates = await q("SELECT DATE_FORMAT(MIN(dataDate),'%Y-%m-%d') mn, DATE_FORMAT(MAX(dataDate),'%Y-%m-%d') mx, COUNT(DISTINCT dataDate) d FROM market_data");
out.marketDataNoteVerified = await q(`
  SELECT SUM(CASE WHEN note LIKE '%真实来源%' THEN 1 ELSE 0 END) verified,
         SUM(CASE WHEN note LIKE '%真实来源%' THEN 0 ELSE 1 END) unverified,
         COUNT(*) total
  FROM market_data`);

// suspension clean dates
out.suspensionDates = await q("SELECT DATE_FORMAT(MIN(startDate),'%Y-%m-%d') mn, DATE_FORMAT(MAX(endDate),'%Y-%m-%d') mx FROM stock_suspension_windows");

// backtest_runs (research artifacts)
out.backtestRuns = await q("SELECT COUNT(*) c, DATE_FORMAT(MIN(createdAt),'%Y-%m-%d') mn, DATE_FORMAT(MAX(createdAt),'%Y-%m-%d') mx FROM backtest_runs");

console.log(JSON.stringify(out, null, 2));
await conn.end();
