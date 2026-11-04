// READ-ONLY historical dataset coverage audit (STEP 11 / Work F).
// Only SELECT queries. No writes, no DDL, no provider calls.
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const urlMatch = env.match(/DATABASE_URL=(\S+)/);
if (!urlMatch) throw new Error("DATABASE_URL not found in .env");
const url = urlMatch[1].replace(/["']/g, "");

const u = new URL(url);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port || 4000),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
});

async function q(sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

const out = {};

// 1. List tables
const tables = await q("SHOW TABLES");
const tableKey = Object.keys(tables[0] || {})[0];
const tableNames = tables.map((r) => r[tableKey]).sort();
out.tableNames = tableNames;

async function count(table) {
  const r = await q(`SELECT COUNT(*) AS c FROM \`${table}\``);
  return Number(r[0].c);
}
async function distinct(table, col) {
  const r = await q(`SELECT COUNT(DISTINCT \`${col}\`) AS c FROM \`${table}\``);
  return Number(r[0].c);
}
async function minMax(table, col) {
  const r = await q(`SELECT MIN(\`${col}\`) AS mn, MAX(\`${col}\`) AS mx FROM \`${table}\``);
  return r[0];
}
async function nullCount(table, col) {
  const r = await q(`SELECT COUNT(*) AS c FROM \`${table}\` WHERE \`${col}\` IS NULL`);
  return Number(r[0].c);
}
async function byYear(table, col) {
  const r = await q(`SELECT YEAR(\`${col}\`) AS y, COUNT(*) AS c FROM \`${table}\` GROUP BY YEAR(\`${col}\`) ORDER BY y`);
  return r.map((x) => ({ year: Number(x.y), rows: Number(x.c) }));
}
async function groupDist(table, col) {
  const r = await q(`SELECT \`${col}\` AS k, COUNT(*) AS c FROM \`${table}\` GROUP BY \`${col}\` ORDER BY c DESC`);
  return r.map((x) => ({ k: String(x.k ?? "NULL"), c: Number(x.c) }));
}

const stats = {};

async function auditTable(name, fn) {
  try {
    stats[name] = await fn();
  } catch (e) {
    stats[name] = { error: e.code || e.name, message: e.sqlMessage || e.message, missing: e.code === "ER_NO_SUCH_TABLE" };
  }
}

// ============ OHLCV: stock_daily_prices ============
await auditTable("ohlcv", async () => {
  const t = "stock_daily_prices";
  const s = {};
  s.rows = await count(t);
  const mm = await minMax(t, "tradeDate");
  s.minDate = mm.mn;
  s.maxDate = mm.mx;
  s.distinctStocks = await distinct(t, "stockCode");
  s.distinctDates = await distinct(t, "tradeDate");
  s.byYear = await byYear(t, "tradeDate");
  s.nullHigh = await nullCount(t, "highPrice");
  s.nullLow = await nullCount(t, "lowPrice");
  s.nullAmount = await nullCount(t, "amount");
  s.nullVolume = await nullCount(t, "volume");
  s.nullPreClose = await nullCount(t, "preClosePrice");
  s.nullOpen = await nullCount(t, "openPrice");
  s.nullClose = await nullCount(t, "closePrice");
  s.bySource = await groupDist(t, "source");
  const dup = await q(`SELECT COUNT(*) AS c FROM (SELECT stockCode, tradeDate FROM \`${t}\` GROUP BY stockCode, tradeDate HAVING COUNT(*) > 1) d`);
  s.duplicateGroups = Number(dup[0].c);
  s.sample = await q(`SELECT stockCode, tradeDate, openPrice, closePrice, highPrice, lowPrice, amount, volume, preClosePrice, source FROM \`${t}\` ORDER BY tradeDate DESC LIMIT 3`);
  return s;
});

// ============ limit_up_records ============
await auditTable("limitUp", async () => {
  const t = "limit_up_records";
  const s = {};
  s.rows = await count(t);
  const mm = await minMax(t, "limitUpDate");
  s.minDate = mm.mn;
  s.maxDate = mm.mx;
  s.distinctStocks = await distinct(t, "stockCode");
  s.distinctDates = await distinct(t, "limitUpDate");
  s.byYear = await byYear(t, "limitUpDate");
  s.nullTime = await nullCount(t, "limitUpTime");
  s.nullBoardCount = await nullCount(t, "boardCount");
  s.nullCirculationValue = await nullCount(t, "circulationValue");
  s.nullTurnover = await nullCount(t, "turnover");
  s.nullSector = await nullCount(t, "sector");
  return s;
});

// ============ market_data ============
await auditTable("marketData", async () => {
  const t = "market_data";
  const s = {};
  s.rows = await count(t);
  const mm = await minMax(t, "dataDate");
  s.minDate = mm.mn;
  s.maxDate = mm.mx;
  s.distinctDates = await distinct(t, "dataDate");
  s.byYear = await byYear(t, "dataDate");
  s.nullTurnover = await nullCount(t, "turnover");
  s.nullMarginBalance = await nullCount(t, "marginBalance");
  s.notes = await q(`SELECT dataDate, note FROM \`${t}\` ORDER BY dataDate DESC LIMIT 3`);
  return s;
});

// ============ stock_suspension_windows ============
await auditTable("suspension", async () => {
  const t = "stock_suspension_windows";
  const s = {};
  s.rows = await count(t);
  const mm = await minMax(t, "startDate");
  s.minStart = mm.mn;
  s.maxStart = mm.mx;
  s.distinctStocks = await distinct(t, "stockCode");
  s.bySource = await groupDist(t, "source");
  return s;
});

// ============ backfill_checkpoints ============
await auditTable("backfillCheckpoints", async () => {
  const t = "backfill_checkpoints";
  const s = {};
  s.rows = await count(t);
  const mm = await minMax(t, "tradeDate");
  s.minDate = mm.mn;
  s.maxDate = mm.mx;
  s.distinctDates = await distinct(t, "tradeDate");
  s.byStatus = await groupDist(t, "status");
  s.byYear = await byYear(t, "tradeDate");
  return s;
});

// ============ industry_assignments ============
await auditTable("industry", async () => {
  const t = "industry_assignments";
  const s = {};
  s.rows = await count(t);
  const mm = await minMax(t, "effectiveFrom");
  s.minEffectiveFrom = mm.mn;
  s.maxEffectiveFrom = mm.mx;
  s.distinctSecurities = await distinct(t, "securityId");
  s.distinctIndustries = await distinct(t, "industryCode");
  s.bySource = await groupDist(t, "source");
  s.nullEffectiveTo = await nullCount(t, "effectiveTo");
  s.byYear = await byYear(t, "effectiveFrom");
  s.sample = await q(`SELECT securityId, industryCode, industryName, effectiveFrom, effectiveTo, source FROM \`${t}\` ORDER BY effectiveFrom DESC LIMIT 5`);
  return s;
});

// ============ index_master ============
await auditTable("indexMaster", async () => {
  const t = "index_master";
  const s = {};
  s.rows = await count(t);
  s.distinctIndex = await distinct(t, "indexCode");
  s.byProvider = await groupDist(t, "provider");
  s.detail = await q(`SELECT indexCode, indexName, provider, providerCode, firstDate, lastDate, source FROM \`${t}\``);
  return s;
});

// ============ index_daily ============
await auditTable("indexDaily", async () => {
  const t = "index_daily";
  const s = {};
  s.rows = await count(t);
  const mm = await minMax(t, "tradeDate");
  s.minDate = mm.mn;
  s.maxDate = mm.mx;
  s.distinctIndex = await distinct(t, "indexCode");
  s.distinctDates = await distinct(t, "tradeDate");
  s.byIndex = await q(`SELECT indexCode, COUNT(*) AS c, MIN(tradeDate) AS mn, MAX(tradeDate) AS mx FROM \`${t}\` GROUP BY indexCode ORDER BY c DESC`);
  s.nullOpen = await nullCount(t, "open");
  s.nullClose = await nullCount(t, "close");
  s.nullAmount = await nullCount(t, "amount");
  s.nullVolume = await nullCount(t, "volume");
  return s;
});

// ============ liquidity_daily ============
await auditTable("liquidity", async () => {
  const t = "liquidity_daily";
  const s = {};
  s.rows = await count(t);
  const mm = await minMax(t, "tradeDate");
  s.minDate = mm.mn;
  s.maxDate = mm.mx;
  s.distinctSecurities = await distinct(t, "securityId");
  s.distinctDates = await distinct(t, "tradeDate");
  s.nullTurnoverRate = await nullCount(t, "turnoverRate");
  s.nullCirculationMcap = await nullCount(t, "circulationMarketCap");
  s.nullTotalMcap = await nullCount(t, "totalMarketCap");
  s.nullAmount = await nullCount(t, "amount");
  s.nullVolume = await nullCount(t, "volume");
  s.bySource = await groupDist(t, "source");
  s.byYear = await byYear(t, "tradeDate");
  return s;
});

// ============ corporate_actions ============
await auditTable("corporateActions", async () => {
  const t = "corporate_actions";
  const s = {};
  s.rows = await count(t);
  const mm = await minMax(t, "effectiveDate");
  s.minEffective = mm.mn;
  s.maxEffective = mm.mx;
  s.distinctSecurities = await distinct(t, "securityId");
  s.byActionType = await groupDist(t, "actionType");
  s.bySource = await groupDist(t, "source");
  s.byYear = await byYear(t, "effectiveDate");
  s.nullRecordDate = await nullCount(t, "recordDate");
  s.nullAnnouncementDate = await nullCount(t, "announcementDate");
  return s;
});

// ============ adjustment_factors ============
await auditTable("adjustmentFactors", async () => {
  const t = "adjustment_factors";
  const s = {};
  s.rows = await count(t);
  const mm = await minMax(t, "effectiveDate");
  s.minEffective = mm.mn;
  s.maxEffective = mm.mx;
  s.distinctSecurities = await distinct(t, "securityId");
  s.bySource = await groupDist(t, "source");
  s.byYear = await byYear(t, "effectiveDate");
  return s;
});

// ============ research_securities ============
await auditTable("securityMaster", async () => {
  const t = "research_securities";
  const s = {};
  s.rows = await count(t);
  s.distinctSecurityId = await distinct(t, "securityId");
  s.byExchange = await groupDist(t, "exchange");
  s.byStatus = await groupDist(t, "status");
  s.bySecurityType = await groupDist(t, "securityType");
  s.nullListedDate = await nullCount(t, "listedDate");
  s.nullDelistedDate = await nullCount(t, "delistedDate");
  const mm = await minMax(t, "listedDate");
  s.minListedDate = mm.mn;
  s.maxListedDate = mm.mx;
  return s;
});

// ============ research_security_identifier_history ============
await auditTable("identifierHistory", async () => {
  const t = "research_security_identifier_history";
  const s = {};
  s.rows = await count(t);
  s.distinctSecurityId = await distinct(t, "securityId");
  s.distinctCode = await distinct(t, "securityCode");
  s.byIdentifierType = await groupDist(t, "identifierType");
  s.byExchange = await groupDist(t, "exchange");
  s.bySource = await groupDist(t, "source");
  const mm = await minMax(t, "effectiveFrom");
  s.minEffectiveFrom = mm.mn;
  s.maxEffectiveFrom = mm.mx;
  return s;
});

// ============ research_security_status_history ============
await auditTable("statusHistory", async () => {
  const t = "research_security_status_history";
  const s = {};
  s.rows = await count(t);
  s.distinctSecurityId = await distinct(t, "securityId");
  s.byStatusType = await groupDist(t, "statusType");
  s.bySource = await groupDist(t, "source");
  s.byConfidence = await groupDist(t, "confidence");
  s.byAvailability = await groupDist(t, "availability");
  const mm = await minMax(t, "effectiveFrom");
  s.minEffectiveFrom = mm.mn;
  s.maxEffectiveFrom = mm.mx;
  s.byYear = await byYear(t, "effectiveFrom");
  s.statusValueByType = await q(`SELECT statusType, statusValue, COUNT(*) AS c FROM \`${t}\` GROUP BY statusType, statusValue ORDER BY statusType, c DESC`);
  return s;
});

out.stats = stats;
console.log(JSON.stringify(out, null, 2));
await conn.end();
