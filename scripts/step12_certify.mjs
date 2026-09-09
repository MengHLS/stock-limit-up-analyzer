// STEP 12 final certification snapshot — READ-ONLY. Writes JSON to docs/researchReadyGate/.
import mysql from "mysql2/promise";
import { readFileSync, writeFileSync } from "node:fs";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL=(\S+)/)[1].replace(/["']/g, "");
const u = new URL(url);
const conn = await mysql.createConnection({host:u.hostname,port:+u.port,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:u.pathname.slice(1),ssl:{rejectUnauthorized:true},connectTimeout:15000});
async function q(sql){const [r]=await conn.query(sql);return r;}
const out = { capturedAt: new Date().toISOString() };

// migration ledger
const led = await q("SELECT COUNT(*) c FROM __drizzle_migrations");
out.migrationLedgerRows = Number(led[0].c);
const last = await q("SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1");
out.migrationLast = last[0] ? { id: last[0].id, hash: String(last[0].hash).slice(0,16), created_at: String(last[0].created_at) } : null;

// domain tables
const tables = ["stock_daily_prices","research_securities","research_security_identifier_history","research_security_status_history","industry_assignments","index_master","index_daily","liquidity_daily","corporate_actions","adjustment_factors","backfill_checkpoints"];
for (const t of tables) {
  try {
    const c = await q(`SELECT COUNT(*) c FROM \`${t}\``);
    const rows = Number(c[0].c);
    const s = { rows };
    if (rows > 0) {
      // pick date column(s)
      const cols = await q(`SHOW COLUMNS FROM \`${t}\``);
      const dateCols = cols.filter((x) => ["date","datetime","timestamp"].includes(x.Type)).map((x) => x.Field);
      for (const dc of dateCols.slice(0,2)) {
        const mm = await q(`SELECT MIN(\`${dc}\`) mn, MAX(\`${dc}\`) mx FROM \`${t}\``);
        s[`min_${dc}`] = mm[0].mn ? String(mm[0].mn) : null;
        s[`max_${dc}`] = mm[0].mx ? String(mm[0].mx) : null;
      }
    }
    out[t] = s;
  } catch (e) { out[t] = { error: e.code }; }
}

// OHLCV detail
const mm = await q("SELECT MIN(tradeDate) mn, MAX(tradeDate) mx FROM stock_daily_prices");
out.ohlcvRange = { min: String(mm[0].mn).slice(0,10), max: String(mm[0].mx).slice(0,10) };
const ds = await q("SELECT COUNT(DISTINCT stockCode) c FROM stock_daily_prices");
out.ohlcvDistinctStocks = Number(ds[0].c);
const dup = await q("SELECT COUNT(*) c FROM (SELECT stockCode,tradeDate FROM stock_daily_prices GROUP BY stockCode,tradeDate HAVING COUNT(*)>1) x");
out.ohlcvDuplicateKeys = Number(dup[0].c);
const yr = await q("SELECT YEAR(tradeDate) y, COUNT(*) r, COUNT(DISTINCT tradeDate) dy, COUNT(DISTINCT stockCode) stk FROM stock_daily_prices GROUP BY YEAR(tradeDate) ORDER BY y");
out.ohlcvByYear = yr.map((r) => ({ year: Number(r.y), rows: Number(r.r), tradingDays: Number(r.dy), stocks: Number(r.stk) }));

// checkpoint
const cp = await q("SELECT status, COUNT(*) c FROM backfill_checkpoints GROUP BY status");
out.checkpoints = cp.map((r) => ({ status: r.status, count: Number(r.c) }));
const cpmm = await q("SELECT MIN(tradeDate) mn, MAX(tradeDate) mx FROM backfill_checkpoints");
out.checkpointRange = { min: String(cpmm[0].mn).slice(0,10), max: String(cpmm[0].mx).slice(0,10) };

// index sanity for 0023 tables
for (const t of ["industry_assignments","liquidity_daily","corporate_actions","adjustment_factors"]) {
  const idx = await q(`SHOW INDEX FROM \`${t}\``);
  const uniq = idx.filter((i) => i.Key_name.startsWith("uq_") && i.Seq_in_index === 1).map((i) => i.Key_name);
  const cols = await q(`SHOW COLUMNS FROM \`${t}\``);
  const hasSecurityCode = cols.some((x) => x.Field === "securityCode");
  const secIdNull = cols.find((x) => x.Field === "securityId");
  out[`schema_${t}`] = { hasSecurityCode, securityIdNullable: secIdNull ? secIdNull.Null === "YES" : null, uniqueIndexFirstCols: uniq };
}

writeFileSync(new URL("../docs/researchReadyGate/certify_final.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("snapshot written to docs/researchReadyGate/certify_final.json");
console.log(JSON.stringify({ migrationLedgerRows: out.migrationLedgerRows, migrationLast: out.migrationLast, stockDailyRows: out.stock_daily_prices?.rows, ohlcvRange: out.ohlcvRange, ohlcvDistinctStocks: out.ohlcvDistinctStocks, checkpoints: out.checkpoints }, null, 2));
await conn.end();
