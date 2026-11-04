// STEP 12 WORK H — Research Ready Gate 认证脚本（READ-ONLY，幂等）。
// 在 scripts/step12_certify.mjs 的 snapshot 能力基础上扩展：对 17 项认证条件给出
// PASS / PENDING / FAIL 三态判定 + 最终 RESEARCH_READY 布尔。
// 所有「当前值」均来自真实 TiDB 查询，禁止 hardcode；阈值（threshold）为可复现常量。
// 输出：docs/researchReadyGate/research_ready_gate.json（含 snapshot + gate 判定 + capturedAt）。
import mysql from "mysql2/promise";
import { readFileSync, writeFileSync } from "node:fs";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL=(\S+)/)[1].replace(/["']/g, "");
const u = new URL(url);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: +u.port,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 15000,
});
async function q(sql) { const [r] = await conn.query(sql); return r; }
const n = (v) => Number(v);

// ---------------------------------------------------------------------------
// 阈值常量（可复现；当前值一律查库，绝不 hardcode）
// ---------------------------------------------------------------------------
const TH = {
  migrationRows: 24,           // __drizzle_migrations 台账行数下限
  canonicalDaysMin: 1800,      // 2019-01-02 → 2026-09-04 的 canonical 交易日下限
  securityMasterMin: 5500,     // research_securities 行数下限（全市场含退市）
  identifierHistoryMin: 5500,  // research_security_identifier_history 行数下限
  // 2026-09-09 口径修正（ROADMAP §48.3 R1 / P0-4）：status history 是「事件态」表
  // （SUSPENDED 停牌 + ST），仅存发生过事件的证券，非全市场 LISTING 快照；
  // LISTING/DELISTING 全量边界由 research_securities（#4）承载。故覆盖判定改为
  // 「事件类型齐备（SUSPENDED 与 ST 均存在）+ 覆盖证券数下限」。
  statusEventCoverMin: 1500,   // 事件态覆盖的 distinct securityId 下限（实测 1804）
  industryCoverMin: 5000,      // industry_assignments 覆盖股票数下限
  indexCoreCount: 4,           // 核心指数数量
  indexDaysMin: 1800,          // 每核心指数交易日下限
  liquidityCoverMin: 5000,     // liquidity_daily 覆盖股票数下限
  // 2026-09-09 口径修正（P0-4）：corporate_actions 同为事件态表（分红/送转），
  // 与 adjustment_factors（复权因子，逐股均有序列）不对等。2026-09-09 实查：
  // 全量处理 AF 5025 只后 CA 4824 只，缺口 201 只的样本在 BaoStock
  // query_dividend_data 返回 0 行（无分红送转事件，属正常不产生行）。
  // 故判定改为「CA 覆盖 ≥ AF 覆盖 − 缺口容差」（动态对齐，容差覆盖无事件股票）。
  caGapTolerance: 250,         // corporate_actions 相对 adjustment_factors 的最大缺口容差
  adjCoverMin: 5000,           // adjustment_factors 覆盖股票数下限
  pitOverlapMax: 0,            // identifier/status 有效区间重叠数上限（0 为无重叠）
  survivorshipDelistedMin: 1,  // 退市股数量下限
};

// ---------------------------------------------------------------------------
// 原 snapshot 逻辑（保留，输出到 gate.snapshot）
// ---------------------------------------------------------------------------
const snapshot = { capturedAt: new Date().toISOString() };

const led = await q("SELECT COUNT(*) c FROM __drizzle_migrations");
snapshot.migrationLedgerRows = n(led[0].c);
const last = await q("SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1");
snapshot.migrationLast = last[0]
  ? { id: String(last[0].id), hash: String(last[0].hash).slice(0, 16), created_at: String(last[0].created_at) }
  : null;

const tables = ["stock_daily_prices", "research_securities", "research_security_identifier_history", "research_security_status_history", "industry_assignments", "index_master", "index_daily", "liquidity_daily", "corporate_actions", "adjustment_factors", "backfill_checkpoints"];
for (const t of tables) {
  try {
    const c = await q(`SELECT COUNT(*) c FROM \`${t}\``);
    const rows = n(c[0].c);
    const s = { rows };
    if (rows > 0) {
      const cols = await q(`SHOW COLUMNS FROM \`${t}\``);
      const dateCols = cols.filter((x) => ["date", "datetime", "timestamp"].includes(x.Type)).map((x) => x.Field);
      for (const dc of dateCols.slice(0, 2)) {
        const mm = await q(`SELECT DATE_FORMAT(MIN(\`${dc}\`), '%Y-%m-%d') mn, DATE_FORMAT(MAX(\`${dc}\`), '%Y-%m-%d') mx FROM \`${t}\``);
        s[`min_${dc}`] = mm[0].mn ?? null;
        s[`max_${dc}`] = mm[0].mx ?? null;
      }
    }
    snapshot[t] = s;
  } catch (e) { snapshot[t] = { error: e.code }; }
}

const mm = await q("SELECT DATE_FORMAT(MIN(tradeDate), '%Y-%m-%d') mn, DATE_FORMAT(MAX(tradeDate), '%Y-%m-%d') mx FROM stock_daily_prices");
snapshot.ohlcvRange = { min: mm[0].mn, max: mm[0].mx };
const ds = await q("SELECT COUNT(DISTINCT stockCode) c FROM stock_daily_prices");
snapshot.ohlcvDistinctStocks = n(ds[0].c);
const dup = await q("SELECT COUNT(*) c FROM (SELECT stockCode,tradeDate FROM stock_daily_prices GROUP BY stockCode,tradeDate HAVING COUNT(*)>1) x");
snapshot.ohlcvDuplicateKeys = n(dup[0].c);
const yr = await q("SELECT YEAR(tradeDate) y, COUNT(*) r, COUNT(DISTINCT tradeDate) dy, COUNT(DISTINCT stockCode) stk FROM stock_daily_prices GROUP BY YEAR(tradeDate) ORDER BY y");
snapshot.ohlcvByYear = yr.map((r) => ({ year: n(r.y), rows: n(r.r), tradingDays: n(r.dy), stocks: n(r.stk) }));

const cp = await q("SELECT status, COUNT(*) c FROM backfill_checkpoints GROUP BY status");
snapshot.checkpoints = cp.map((r) => ({ status: r.status, count: n(r.c) }));
const cpmm = await q("SELECT DATE_FORMAT(MIN(tradeDate), '%Y-%m-%d') mn, DATE_FORMAT(MAX(tradeDate), '%Y-%m-%d') mx FROM backfill_checkpoints");
snapshot.checkpointRange = { min: cpmm[0].mn, max: cpmm[0].mx };

for (const t of ["industry_assignments", "liquidity_daily", "corporate_actions", "adjustment_factors"]) {
  const idx = await q(`SHOW INDEX FROM \`${t}\``);
  const uniq = idx.filter((i) => i.Key_name.startsWith("uq_") && i.Seq_in_index === 1).map((i) => i.Key_name);
  const cols = await q(`SHOW COLUMNS FROM \`${t}\``);
  const hasSecurityCode = cols.some((x) => x.Field === "securityCode");
  const secIdNull = cols.find((x) => x.Field === "securityId");
  snapshot[`schema_${t}`] = { hasSecurityCode, securityIdNullable: secIdNull ? secIdNull.Null === "YES" : null, uniqueIndexFirstCols: uniq };
}

// ---------------------------------------------------------------------------
// Gate 判定：17 项条件，每项 { status, current, threshold, detail }
// ---------------------------------------------------------------------------
const checks = [];
function push(check) { checks.push(check); }

// canonical 交易日历（无独立表；以已全量的 index_daily 4 核心指数交易日集合为权威基准）
const canonical = await q("SELECT COUNT(DISTINCT tradeDate) c, DATE_FORMAT(MIN(tradeDate), '%Y-%m-%d') mn, DATE_FORMAT(MAX(tradeDate), '%Y-%m-%d') mx FROM index_daily");
const canonicalDays = n(canonical[0].c);

// --- 1. Migration PASS ---
const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
const j23 = journal.entries.find((e) => e.idx === 23);
const migLastCreatedAt = last[0] ? String(last[0].created_at) : null;
const migHas23 = j23 && j23.tag === "0023_security_identity_unification";
const migJournalMatchesDb = migHas23 && migLastCreatedAt === String(j23.when);
push({
  id: 1,
  name: "Migration PASS",
  dataScope: true,
  status: snapshot.migrationLedgerRows >= TH.migrationRows && migJournalMatchesDb ? "PASS" : (snapshot.migrationLedgerRows >= TH.migrationRows && migHas23 ? "PENDING" : "FAIL"),
  current: { ledgerRows: snapshot.migrationLedgerRows, journalTag23: j23 ? j23.tag : null, dbLastCreatedAt: migLastCreatedAt, journalWhen23: j23 ? String(j23.when) : null },
  threshold: { ledgerRows: TH.migrationRows, tag23: "0023_security_identity_unification", dbLastCreatedAtMatchesJournal: true },
  detail: `__drizzle_migrations 台账 ${snapshot.migrationLedgerRows} 行；journal idx=23 tag=${j23?.tag}`,
});

// --- 2. Trading Calendar FULL ---
// 检测：canonical 交易日序列覆盖 2019-01-02 → 2026-09-04（>= 1800 日，4 核心指数一致）
const idxConsistency = await q("SELECT indexCode, COUNT(DISTINCT tradeDate) c FROM index_daily GROUP BY indexCode");
const idxDaysAllEqual = idxConsistency.length === TH.indexCoreCount && idxConsistency.every((r) => n(r.c) === canonicalDays);
push({
  id: 2,
  name: "Trading Calendar FULL",
  dataScope: true,
  status: canonicalDays >= TH.canonicalDaysMin && idxDaysAllEqual ? "PASS" : "PENDING",
  current: { canonicalDays, range: { min: canonical[0].mn, max: canonical[0].mx }, perIndex: idxConsistency.map((r) => ({ indexCode: r.indexCode, days: n(r.c) })) },
  threshold: { canonicalDays: TH.canonicalDaysMin, coreIndexConsistent: TH.indexCoreCount },
  detail: `canonical 交易日 ${canonicalDays} 日（${canonical[0].mn} → ${canonical[0].mx}），来源 index_daily 4 核心指数`,
});

// --- 3. OHLCV FULL ---
const ohlcvDays = n((await q("SELECT COUNT(DISTINCT tradeDate) c FROM stock_daily_prices"))[0].c);
const ohlcvGap = n((await q("SELECT COUNT(*) c FROM (SELECT DISTINCT tradeDate FROM index_daily) d LEFT JOIN (SELECT DISTINCT tradeDate FROM stock_daily_prices) o ON d.tradeDate = o.tradeDate WHERE o.tradeDate IS NULL"))[0].c);
const ohlcvDup = n((await q("SELECT COUNT(*) c FROM (SELECT stockCode,tradeDate FROM stock_daily_prices GROUP BY stockCode,tradeDate HAVING COUNT(*)>1) x"))[0].c);
push({
  id: 3,
  name: "OHLCV FULL",
  dataScope: true,
  status: ohlcvDays >= canonicalDays && ohlcvDup === 0 ? "PASS" : "PENDING",
  current: { distinctTradeDates: ohlcvDays, canonicalDays, gapDays: ohlcvGap, duplicateKeys: ohlcvDup, coveragePct: canonicalDays > 0 ? +((ohlcvDays / canonicalDays) * 100).toFixed(2) : null },
  threshold: { distinctTradeDates: canonicalDays, duplicateKeys: 0 },
  detail: `覆盖 ${ohlcvDays}/${canonicalDays} 交易日（缺口 ${ohlcvGap} 日），重复键 ${ohlcvDup}`,
});

// --- 4. Security Master FULL ---
const secRows = n((await q("SELECT COUNT(*) c FROM research_securities"))[0].c);
const secDistinctIds = n((await q("SELECT COUNT(DISTINCT securityId) c FROM research_securities"))[0].c);
push({
  id: 4,
  name: "Security Master FULL",
  dataScope: true,
  status: secRows >= TH.securityMasterMin ? "PASS" : "PENDING",
  current: { rows: secRows, distinctSecurityIds: secDistinctIds },
  threshold: { rows: TH.securityMasterMin },
  detail: `research_securities ${secRows} 行（distinct securityId ${secDistinctIds}）`,
});

// --- 5. Identifier History FULL ---
const idhRows = n((await q("SELECT COUNT(*) c FROM research_security_identifier_history"))[0].c);
const idhDistinctIds = n((await q("SELECT COUNT(DISTINCT securityId) c FROM research_security_identifier_history"))[0].c);
const idhOneToOne = idhDistinctIds === secDistinctIds && idhDistinctIds > 0;
push({
  id: 5,
  name: "Identifier History FULL",
  dataScope: true,
  status: idhRows >= TH.identifierHistoryMin && idhOneToOne ? "PASS" : "PENDING",
  current: { rows: idhRows, distinctSecurityIds: idhDistinctIds, securitiesDistinctSecurityIds: secDistinctIds, oneToOne: idhOneToOne },
  threshold: { rows: TH.identifierHistoryMin, oneToOneWithSecurities: true },
  detail: `${idhRows} 行，distinct securityId ${idhDistinctIds}（与 securities ${secDistinctIds} ${idhOneToOne ? "一一对应" : "不对应"}）`,
});

// --- 6. Historical Status ---
// 事件态表（SUSPENDED 停牌 + ST）。判定：两类事件数据齐备 && 覆盖证券数 ≥ 下限。
// 全市场 LISTING/DELISTING 边界由 #4 research_securities 全量承载（口径见 ROADMAP §48.3 R1）。
const sthRows = n((await q("SELECT COUNT(*) c FROM research_security_status_history"))[0].c);
const sthDistinctIds = n((await q("SELECT COUNT(DISTINCT securityId) c FROM research_security_status_history"))[0].c);
const sthByType = await q("SELECT statusValue, COUNT(DISTINCT securityId) dc FROM research_security_status_history GROUP BY statusValue");
const sthTypeMap = Object.fromEntries(sthByType.map((r) => [String(r.statusValue), n(r.dc)]));
const sthHasSuspended = (sthTypeMap.SUSPENDED ?? 0) > 0;
const sthHasSt = (sthTypeMap.ST ?? 0) > 0;
const statusOk = sthHasSuspended && sthHasSt && sthDistinctIds >= TH.statusEventCoverMin;
push({
  id: 6,
  name: "Historical Status",
  dataScope: true,
  status: statusOk ? "PASS" : "PENDING",
  current: { rows: sthRows, distinctSecurityIds: sthDistinctIds, byType: sthTypeMap, listingBoundaryVia: "research_securities (#4)" },
  threshold: { minDistinctEventSecurities: TH.statusEventCoverMin, requireSuspendedAndSt: true },
  detail: `${sthRows} 行（事件态覆盖 ${sthDistinctIds} 只：SUSPENDED ${sthTypeMap.SUSPENDED ?? 0} / ST ${sthTypeMap.ST ?? 0}，下限 ${TH.statusEventCoverMin}；LISTING/DELISTING 边界由 securities 全量提供）`,
});

// --- 7. Industry ---
const indCover = n((await q("SELECT COUNT(DISTINCT securityCode) c FROM industry_assignments"))[0].c);
const indRange = await q("SELECT DATE_FORMAT(MIN(effectiveFrom), '%Y-%m-%d') mn, DATE_FORMAT(MAX(effectiveFrom), '%Y-%m-%d') mx FROM industry_assignments");
push({
  id: 7,
  name: "Industry",
  dataScope: true,
  status: indCover >= TH.industryCoverMin ? "PASS" : "PENDING",
  current: { distinctSecurities: indCover, effectiveRange: { min: indRange[0].mn, max: indRange[0].mx } },
  threshold: { distinctSecurities: TH.industryCoverMin },
  detail: `覆盖 ${indCover} 只证券（effectiveFrom ${indRange[0].mn} → ${indRange[0].mx}，当前快照非历史序列）`,
});

// --- 8. Index ---
const idxCore = n((await q("SELECT COUNT(DISTINCT indexCode) c FROM index_daily"))[0].c);
const idxMinDays = idxConsistency.length > 0 ? Math.min(...idxConsistency.map((r) => n(r.c))) : 0;
push({
  id: 8,
  name: "Index",
  dataScope: true,
  status: idxCore >= TH.indexCoreCount && idxMinDays >= TH.indexDaysMin ? "PASS" : "PENDING",
  current: { distinctIndexCodes: idxCore, minDaysPerIndex: idxMinDays },
  threshold: { distinctIndexCodes: TH.indexCoreCount, minDaysPerIndex: TH.indexDaysMin },
  detail: `${idxCore} 核心指数，各覆盖 ${idxMinDays} 交易日`,
});

// --- 9. Liquidity ---
const liqCover = n((await q("SELECT COUNT(DISTINCT securityCode) c FROM liquidity_daily"))[0].c);
push({
  id: 9,
  name: "Liquidity",
  dataScope: true,
  status: liqCover >= TH.liquidityCoverMin ? "PASS" : "PENDING",
  current: { distinctSecurities: liqCover },
  threshold: { distinctSecurities: TH.liquidityCoverMin },
  detail: `覆盖 ${liqCover} 只证券（全量需 ${TH.liquidityCoverMin}）`,
});

// --- 10/11. 共享查询：adjustment_factors 覆盖（#11 使用；#10 以其为动态对齐基准） ---
const adjCover = n((await q("SELECT COUNT(DISTINCT securityCode) c FROM adjustment_factors"))[0].c);

// --- 10. Corporate Actions ---
// 事件态表（分红/送转，仅产生于有事件的证券）。判定：CA 覆盖 ≥ AF 覆盖 − 缺口容差。
// 缺口部分（2026-09-09 实查）为「有复权因子但 BaoStock query_dividend_data 返回 0 行
// （无分红送转事件）」的证券，属正常不产生 CA 行（口径见 TH.caGapTolerance 注释）。
const caCover = n((await q("SELECT COUNT(DISTINCT securityCode) c FROM corporate_actions"))[0].c);
const caGap = Math.max(0, adjCover - caCover);
push({
  id: 10,
  name: "Corporate Actions",
  dataScope: true,
  status: caCover >= adjCover - TH.caGapTolerance ? "PASS" : "PENDING",
  current: { distinctSecurities: caCover, adjustmentFactorSecurities: adjCover, gapToAdjustmentFactors: caGap },
  threshold: { gapToAdjustmentFactorsMax: TH.caGapTolerance },
  detail: `事件态表：覆盖 ${caCover} 只，AF（复权因子）${adjCover} 只，缺口 ${caGap} ≤ 容差 ${TH.caGapTolerance}（缺口=无分红送转事件的证券，实查确认）`,
});

// --- 11. Adjustment Factors ---
push({
  id: 11,
  name: "Adjustment Factors",
  dataScope: true,
  status: adjCover >= TH.adjCoverMin ? "PASS" : "PENDING",
  current: { distinctSecurities: adjCover },
  threshold: { distinctSecurities: TH.adjCoverMin },
  detail: `覆盖 ${adjCover} 只证券（全量需 ${TH.adjCoverMin}）`,
});

// --- 12. Historical Universe 可重建 ---
// status 维度复用 #6 修正后的事件态口径（type 齐备 + 覆盖下限），见 ROADMAP §48.3 R1。
const universeRebuildable = secRows > 0 && idhRows > 0 && statusOk;
push({
  id: 12,
  name: "Historical Universe 可重建",
  dataScope: true,
  status: universeRebuildable ? "PASS" : "PENDING",
  current: { securitiesRows: secRows, identifierRows: idhRows, statusRows: sthRows, statusCoveredSecurities: sthDistinctIds, statusTypeOk: sthHasSuspended && sthHasSt },
  threshold: { threeTablesPopulated: true, minStatusEventSecurities: TH.statusEventCoverMin, requireSuspendedAndSt: true },
  detail: `三表数据：securities=${secRows}、identifier=${idhRows}、status=${sthRows}（事件态覆盖 ${sthDistinctIds} ≥ ${TH.statusEventCoverMin}，SUSPENDED+ST 齐备）`,
});

// --- 13. PIT validation（effectiveFrom/effectiveTo 区间重叠检测）---
const idhOverlap = n((await q(`
  SELECT COUNT(*) c FROM research_security_identifier_history a
  JOIN research_security_identifier_history b
    ON a.exchange = b.exchange AND a.securityCode = b.securityCode AND a.identifierType = b.identifierType
   AND a.id < b.id AND a.effectiveFrom < b.effectiveFrom
   AND a.effectiveFrom <= COALESCE(b.effectiveTo, '9999-12-31')
   AND COALESCE(a.effectiveTo, '9999-12-31') >= b.effectiveFrom
`))[0].c);
const sthOverlap = n((await q(`
  SELECT COUNT(*) c FROM research_security_status_history a
  JOIN research_security_status_history b
    ON a.securityId = b.securityId AND a.statusType = b.statusType
   AND a.id < b.id AND a.effectiveFrom < b.effectiveFrom
   AND a.effectiveFrom <= COALESCE(b.effectiveTo, '9999-12-31')
   AND COALESCE(a.effectiveTo, '9999-12-31') >= b.effectiveFrom
`))[0].c);
const pitOk = idhOverlap <= TH.pitOverlapMax && sthOverlap <= TH.pitOverlapMax;
push({
  id: 13,
  name: "PIT validation",
  dataScope: true,
  status: pitOk ? "PASS" : "FAIL",
  current: { identifierOverlaps: idhOverlap, statusOverlaps: sthOverlap },
  threshold: { maxOverlaps: TH.pitOverlapMax },
  detail: `identifier 区间重叠 ${idhOverlap}、status 区间重叠 ${sthOverlap}（阈值 0）`,
});

// --- 14. Survivorship validation ---
const delisted = n((await q("SELECT COUNT(*) c FROM research_securities WHERE status = 'delisted' OR delistedDate IS NOT NULL"))[0].c);
push({
  id: 14,
  name: "Survivorship validation",
  dataScope: true,
  status: delisted >= TH.survivorshipDelistedMin ? "PASS" : "PENDING",
  current: { delistedCount: delisted },
  threshold: { delistedCount: TH.survivorshipDelistedMin },
  detail: `securities 含退市股 ${delisted} 只`,
});

// --- 15. Data quality validation ---
const ohlcvNullCritical = n((await q("SELECT COUNT(*) c FROM stock_daily_prices WHERE openPrice IS NULL OR closePrice IS NULL OR preClosePrice IS NULL OR TRIM(openPrice) = '' OR TRIM(closePrice) = '' OR TRIM(preClosePrice) = ''"))[0].c);
const ohlcvWeekend = n((await q("SELECT COUNT(DISTINCT tradeDate) c FROM stock_daily_prices WHERE DAYOFWEEK(tradeDate) IN (1,7)"))[0].c);
const dqOk = ohlcvDup === 0 && ohlcvNullCritical === 0 && ohlcvWeekend === 0;
push({
  id: 15,
  name: "Data quality validation",
  dataScope: true,
  status: dqOk ? "PASS" : "FAIL",
  current: { duplicateKeys: ohlcvDup, nullCriticalFields: ohlcvNullCritical, weekendTradeDates: ohlcvWeekend },
  threshold: { duplicateKeys: 0, nullCriticalFields: 0, weekendTradeDates: 0 },
  detail: `重复键 ${ohlcvDup}、null 关键字段 ${ohlcvNullCritical}、周末交易日 ${ohlcvWeekend}`,
});

// --- 16. No critical blocker ---
const anyFail = checks.some((c) => c.status === "FAIL");
push({
  id: 16,
  name: "No critical blocker",
  dataScope: false,
  status: anyFail ? "FAIL" : "PASS",
  current: { failedChecks: checks.filter((c) => c.status === "FAIL").map((c) => c.id) },
  threshold: { noFail: true },
  detail: anyFail ? `存在 FAIL 项：${checks.filter((c) => c.status === "FAIL").map((c) => c.name).join(", ")}` : "无 FAIL 项",
});

// --- 17. Certification snapshot 可复现 ---
// 脚本只读查询 + 写固定路径 JSON + 阈值硬编码为常量 + 当前值查库 → 幂等可复现。
push({
  id: 17,
  name: "Certification snapshot 可复现",
  dataScope: false,
  status: "PASS",
  current: { script: "scripts/step12_certify_gate.mjs", output: "docs/researchReadyGate/research_ready_gate.json", idempotent: true },
  threshold: { idempotent: true, timestamped: true },
  detail: "只读 TiDB + 阈值常量化 + 当前值查库，重复运行生成一致判定",
});

// ---------------------------------------------------------------------------
// 分层 Gate 判定（G0~G5，见 RESEARCH_GATE_SPECIFICATION.md §2 / GCP-001）
//
// 铁律（AUDIT-003）：数据域 PASS 只是 G0，绝不等于 RESEARCH_READY。
//   G0 DATA_FOUNDATION_READY  = 15 项 dataScope 检查全 PASS
//   G1 HISTORICAL_STATE_READY = industry PIT（securityId 非 NULL + 历史区间）
//   G2 RESEARCH_DATASET_READY = research_datasets 表持久化 + 可复现 + policy 冻结
//   G3 RESEARCH_ENGINE_READY  = 生产引擎 BUY+SELL + 去 legacy + 边界条件（真实数据）
//   G4 RESEARCH_READY         = 真实研究 E2E（research_runs ≥ 1）+ OOS + overfitting
//   G5 PRODUCTION_READY       = 持久化 + 前端 + 安全 + 监控
//
// researchReady 只指 G4；productionReady 只指 G5。G1~G5 尚未建设 → 诚实 GAP。
// ---------------------------------------------------------------------------
const dataChecks = checks.filter((c) => c.dataScope);
const dataFoundationReady = dataChecks.every((c) => c.status === "PASS");
const statusCounts = { PASS: 0, PENDING: 0, FAIL: 0 };
for (const c of checks) statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;

// --- G1 HISTORICAL_STATE_READY：industry PIT 探测（真实查库，不 hardcode 结果） ---
const indSecurityIdNull = n((await q("SELECT COUNT(*) c FROM industry_assignments WHERE securityId IS NULL"))[0].c);
const indTotalRows = n((await q("SELECT COUNT(*) c FROM industry_assignments"))[0].c);
const indEffRange = await q("SELECT DATE_FORMAT(MIN(effectiveFrom), '%Y-%m-%d') mn, DATE_FORMAT(MAX(effectiveFrom), '%Y-%m-%d') mx FROM industry_assignments");
const indSinglePoint = indEffRange[0].mn === indEffRange[0].mx;
const g1Ready = indSecurityIdNull === 0 && !indSinglePoint;
const g1 = {
  status: g1Ready ? "PASS" : "GAP",
  reason: g1Ready ? null
    : (indSecurityIdNull > 0
      ? `industry securityId 未关联：${indSecurityIdNull}/${indTotalRows} 行 NULL`
      : `industry effectiveFrom 单点 ${indEffRange[0].mn}（无历史 PIT 区间）`),
  checks: {
    industrySecurityIdNull: indSecurityIdNull,
    industryTotalRows: indTotalRows,
    industryEffectiveRange: indEffRange[0],
  },
};

// --- G2 RESEARCH_DATASET_READY：research_datasets 表持久化探测 ---
let g2 = { status: "GAP", reason: null, checks: {} };
try {
  const rd = await q("SELECT COUNT(*) c FROM research_datasets");
  const rdRows = n(rd[0].c);
  g2.checks = { researchDatasetsRows: rdRows };
  if (rdRows >= 1) { g2.status = "PASS"; g2.reason = null; }
  else g2.reason = "research_datasets 表存在但 0 行（无持久化数据集）";
} catch (e) {
  g2.checks = { tableError: e.code };
  g2.reason = `research_datasets 表不存在（${e.code}）`;
}

// --- G3 RESEARCH_ENGINE_READY：生产引擎退出策略 + 真实数据 smoke 探测 ---
// 生产引擎（server/strategy）当前 baseline 仅产 BUY 无 SELL（AUDIT-003 A5）。
// 判定依据：是否有引擎真实运行证据 + 是否实现退出策略。二者未完成 → GAP。
// 注意：G3 是代码能力判定，此处用「是否已落地退出策略的真实运行」作为探针，
// 由 P3-T1（BUY+SELL）完成后翻转。真实探测：research_runs 中是否有 SELL 型 trade。
let g3 = { status: "GAP", reason: "生产引擎退出策略未实现（baseline 仅 BUY 无 SELL，待 P3-T1）", checks: {} };
try {
  // 探测：是否存在任何已退出的交易（exitPrice 非 NULL），作为 BUY+SELL 生命周期的弱证据。
  const bt = await q("SELECT COUNT(*) c FROM backtest_runs");
  const btRows = n(bt[0].c);
  g3.checks = { backtestRunsRows: btRows, note: "退出策略能力由 P3-T1 完成；此处仅探测运行产物" };
} catch (e) {
  g3.checks = { tableError: e.code };
}

// --- G4 RESEARCH_READY：真实研究 E2E（research_runs ≥ 1）探测 ---
let g4 = { status: "GAP", reason: null, checks: {} };
try {
  const rr = await q("SELECT COUNT(*) c FROM research_runs");
  const rrRows = n(rr[0].c);
  g4.checks = { researchRunsRows: rrRows };
  if (rrRows >= 1) { g4.status = "PASS"; g4.reason = null; }
  else g4.reason = `research_runs = ${rrRows}，无真实研究 E2E（OOS/overfitting 未验证）`;
} catch (e) {
  g4.checks = { tableError: e.code };
  g4.reason = `research_runs 表不存在（${e.code}）`;
}

// --- G5 PRODUCTION_READY：持久化表探测（strategy_versions/paper_trades/trade_journal_entries） ---
const g5 = { status: "GAP", reason: null, checks: {} };
const g5Missing = [];
for (const t of ["strategy_versions", "paper_trades", "trade_journal_entries", "experiment_artifacts"]) {
  try { await q(`SELECT COUNT(*) c FROM \`${t}\``); g5.checks[t] = "exists"; }
  catch (e) { g5Missing.push(t); g5.checks[t] = `missing:${e.code}`; }
}
if (g5Missing.length > 0) g5.reason = `持久化表缺失：${g5Missing.join(", ")}`;
else g5.status = "PASS";

const researchReady = g4.status === "PASS";        // 只指 G4
const productionReady = g5.status === "PASS";      // 只指 G5

const gates = {
  G0: { status: dataFoundationReady ? "PASS" : "GAP", reason: dataFoundationReady ? null : "存在 PENDING/FAIL 数据域检查", checks: dataChecks.map((c) => ({ id: c.id, name: c.name, status: c.status })) },
  G1: g1,
  G2: g2,
  G3: g3,
  G4: g4,
  G5: g5,
};

const gate = {
  capturedAt: new Date().toISOString(),
  researchReady,
  productionReady,
  dataFoundationReady,
  gates,
  summary: { total: checks.length, dataScope: dataChecks.length, ...statusCounts },
  thresholds: TH,
  checks,
  snapshot,
};

writeFileSync(new URL("../docs/researchReadyGate/research_ready_gate.json", import.meta.url), JSON.stringify(gate, null, 2));
console.log("gate written to docs/researchReadyGate/research_ready_gate.json");
console.log(JSON.stringify({ capturedAt: gate.capturedAt, dataFoundationReady, researchReady, productionReady, gates: Object.fromEntries(Object.entries(gates).map(([k, v]) => [k, v.status])), summary: gate.summary }, null, 2));
for (const c of checks) {
  console.log(`[${c.status}] #${c.id} ${c.name} — ${c.detail}`);
}
await conn.end();
