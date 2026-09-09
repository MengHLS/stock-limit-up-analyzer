/**
 * 涨停记录历史回填 CLI（主板）。
 *
 * 目标：把 limit_up_records（涨停表）从 2019-01-01 回填到与现有数据无缝衔接，
 *       只用数据库里已有的数据（stock_daily_prices 日线 + research_security_status_history 的 ST 状态），
 *       创业板（300/301）与科创板（688/689）本轮跳过。
 *
 * 涨停判定（已用真实数据交叉验证，与已录数据 100% 命中）：
 *   收盘价 >= 涨停价，涨停价 = 前收价 × (1 + 比例) 四舍五入到 0.01 元。
 *   主板非 ST：+10%。整数分运算，规避浮点误差（round-half-up）。
 *
 * ST 过滤（2026-09 数据清理口径）：主板当日处于 ST 状态（status history，+5% 涨停）
 *   的记录【不写入】涨停表——ST 的 5% 涨停不属于本表收录的涨停语义，仅收录真实
 *   10% 涨停。若需回填已被 ST 处理的历史区间，直接跳过该股当日。
 *
 * 回填字段：
 *   stockCode / stockName（本地 BaoStock 名称快照，当前名称）/ limitUpDate /
 *   boardCount（"首板" / "N天N板"，按交易日历连续计算）/ turnover（成交额亿元，由 amount 千元换算）。
 *   其余（limitUpTime / circulationValue / sector / keywords）留空 —— 日线数据不含分时与题材。
 *
 * 用法：
 *   node scripts/backfillLimitUpRecords.mjs --dry-run              # 只统计，不写库
 *   node scripts/backfillLimitUpRecords.mjs                        # 正式回填（默认 2019-01-01 ~ 2025-10-15）
 *   node scripts/backfillLimitUpRecords.mjs --start=2019-01-01 --end=2024-12-31
 *   node scripts/backfillLimitUpRecords.mjs --batch-size=2000
 *
 * 幂等：写入前按 (stockCode, limitUpDate) 去重，重复运行不会产生重复记录。
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------
const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(`--${name}=`.length) : def;
};
const START = arg("start", "2019-01-01");
const END = arg("end", "2025-10-15");
const DRY = process.argv.includes("--dry-run");
const BATCH = Number(arg("batch-size", "1000"));
const NAME_DUMP = arg("name-dump", "./_baostock_stock_basic_dump.json");

// 主板代码前缀（创业板 300/301、科创板 688/689、北交所 920/43/83/87/88/4/8 均排除）
const MAIN_BOARD_RE = /^(60|000|001|002|003)/;

// ---------------------------------------------------------------------------
// 连接
// ---------------------------------------------------------------------------
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
  connectTimeout: 20000,
  dateStrings: true, // DATE 返回 "YYYY-MM-DD"，避免时区偏移
});
const q = async (sql, params) => (await conn.query(sql, params))[0];

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

/** 涨停价（分）：round(preC × (10000 + bps) / 10000)，round-half-up，纯整数运算。 */
function limitUpCents(preC, bps) {
  const num = preC * (10000 + bps); // bps: 1000=+10%, 500=+5%
  return Math.floor((num + 5000) / 10000);
}

/** 是否触及涨停（收盘价 >= 涨停价）。 */
function isLimitUp(closeStr, preStr, isST) {
  const pre = Number(preStr);
  const close = Number(closeStr);
  if (!Number.isFinite(pre) || pre <= 0 || !Number.isFinite(close) || close <= 0) return false;
  const preC = Math.round(pre * 100);
  const upC = limitUpCents(preC, isST ? 500 : 1000);
  return Math.round(close * 100) >= upC;
}

/** 成交额（千元）→ 亿元，最多 2 位小数并去掉尾零（对齐现有 "51"/"19.2"/"0.72" 风格）。 */
function fmtTurnoverYi(amountStr) {
  if (amountStr === null || amountStr === undefined || amountStr === "") return null;
  const a = Number(amountStr);
  if (!Number.isFinite(a) || a < 0) return null;
  return String(Math.round(a / 1e3) / 100); // a/1e5 亿元，×100 取 2 位小数再 /100
}

// ---------------------------------------------------------------------------
// 1. 股票名称映射（本地 BaoStock stock_basic 快照，当前名称）
// ---------------------------------------------------------------------------
function loadNameMap() {
  const dump = JSON.parse(readFileSync(new URL(NAME_DUMP, import.meta.url), "utf8"));
  const map = new Map();
  for (const e of dump) {
    if (e.type !== "1") continue;
    const m = e.code.match(/^(sh|sz|bj)\.(\d{6})$/i);
    if (!m) continue;
    map.set(`${m[2]}.${m[1].toUpperCase()}`, e.name);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 2. ST 区间映射：securityCode.SH/SZ → [{ef, et}]
// ---------------------------------------------------------------------------
async function loadStPeriods() {
  const rows = await q(
    `SELECT i.securityCode, i.exchange,
            DATE_FORMAT(s.effectiveFrom, '%Y-%m-%d') ef,
            DATE_FORMAT(s.effectiveTo, '%Y-%m-%d') et
     FROM research_security_status_history s
     LEFT JOIN research_security_identifier_history i
       ON i.securityId = s.securityId AND i.identifierType = 'primary'
     WHERE s.statusType = 'ST'`,
  );
  const map = new Map(); // code -> [ [ef, et|null] ]
  for (const r of rows) {
    if (!r.securityCode || !r.exchange) continue;
    const code = `${r.securityCode}.${r.exchange}`;
    if (!map.has(code)) map.set(code, []);
    map.get(code).push([r.ef, r.et]); // et 可为 null（至今）
  }
  return map;
}

/** 判断某 code 在某 date 是否处于 ST 区间（ef <= date <= et，et null 视为至今）。 */
function buildStChecker(stPeriods) {
  return (code, date) => {
    const periods = stPeriods.get(code);
    if (!periods) return false;
    for (const [ef, et] of periods) {
      if (date >= ef && (et === null || date <= et)) return true;
    }
    return false;
  };
}

// ---------------------------------------------------------------------------
// 3. 交易日历（index_daily 全量 distinct，连续连板判定依据）
// ---------------------------------------------------------------------------
async function loadTradingCalendar() {
  const rows = await q(`SELECT DISTINCT tradeDate FROM index_daily ORDER BY tradeDate`);
  const arr = rows.map((r) => r.tradeDate);
  return { arr, idx: new Map(arr.map((d, i) => [d, i])) };
}

// ---------------------------------------------------------------------------
// 4. 已有记录去重键
// ---------------------------------------------------------------------------
async function loadExistingKeys() {
  const rows = await q(
    `SELECT stockCode, limitUpDate FROM limit_up_records WHERE limitUpDate >= ? AND limitUpDate <= ?`,
    [START, END],
  );
  return new Set(rows.map((r) => `${r.stockCode}|${r.limitUpDate}`));
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  log(`回填区间 ${START} ~ ${END}（主板 60/000/001/002/003，跳过创业板/科创板）${DRY ? " [DRY-RUN]" : ""}`);

  const nameMap = loadNameMap();
  log(`名称快照加载：${nameMap.size} 只（含退市股）`);

  const stPeriods = await loadStPeriods();
  const isStOn = buildStChecker(stPeriods);
  log(`ST 区间加载：${stPeriods.size} 只股票存在 ST 区间`);

  const calendar = await loadTradingCalendar();
  log(`交易日历加载：${calendar.arr.length} 个交易日`);

  const existing = await loadExistingKeys();
  log(`已存在记录（去重键）：${existing.size}`);

  // 逐月读取主板日线，检测涨停（内存只保留命中项，月级有界，避免全表物化）
  const hits = []; // { code, date, amount }
  let cursor = new Date(`${START}T00:00:00Z`);
  const end = new Date(`${END}T00:00:00Z`);
  let monthNo = 0;
  while (cursor <= end) {
    const mStart = cursor.toISOString().slice(0, 10);
    const next = new Date(cursor);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const mEnd0 = new Date(next);
    mEnd0.setUTCDate(mEnd0.getUTCDate() - 1);
    const mEnd = mEnd0 > end ? END : mEnd0.toISOString().slice(0, 10);
    monthNo += 1;

    const rows = await q(
      `SELECT stockCode, tradeDate, closePrice, preClosePrice, amount
       FROM stock_daily_prices
       WHERE tradeDate >= ? AND tradeDate <= ?`,
      [mStart, mEnd],
    );
    let monthHits = 0;
    for (const r of rows) {
      if (!MAIN_BOARD_RE.test(r.stockCode)) continue; // 只要主板
      // ST 过滤（数据清理口径 2026-09）：主板当日处于 ST 状态（5% 涨停）不写入涨停表；
      // 仅以 10% 判定收录非 ST 的真实涨停。
      if (isStOn(r.stockCode, r.tradeDate)) continue;
      if (isLimitUp(r.closePrice, r.preClosePrice, false)) {
        hits.push({ code: r.stockCode, date: r.tradeDate, amount: r.amount });
        monthHits += 1;
      }
    }
    log(`  ${mStart} ~ ${mEnd}：读取 ${rows.length} 行，命中涨停 ${monthHits}（累计 ${hits.length}）`);
    cursor = new Date(next);
  }

  // 去重（排除已存在记录）
  const fresh = hits.filter((h) => !existing.has(`${h.code}|${h.date}`));
  log(`检测到涨停 ${hits.length} 条，其中新记录 ${fresh.length} 条（跳过已存在 ${hits.length - fresh.length}）`);

  if (fresh.length === 0) {
    log("无新增记录，结束。");
    return;
  }

  // 计算连板数（boardCount）：按全市场交易日历连续涨停天数
  const byCode = new Map(); // code -> Set<date>
  for (const h of fresh) {
    if (!byCode.has(h.code)) byCode.set(h.code, new Map());
    byCode.get(h.code).set(h.date, h);
  }
  const boardOf = new Map(); // `${code}|${date}` -> n
  for (const [code, dateMap] of byCode) {
    const dates = [...dateMap.keys()].sort();
    let streak = 0;
    let prevIdx = -Infinity;
    for (const d of dates) {
      const idx = calendar.idx.get(d);
      streak = idx !== undefined && idx === prevIdx + 1 ? streak + 1 : 1;
      prevIdx = idx;
      boardOf.set(`${code}|${d}`, streak);
    }
  }

  // 组装插入行
  const rowsToInsert = fresh.map((h) => {
    const n = boardOf.get(`${h.code}|${h.date}`) ?? 1;
    let name = nameMap.get(h.code);
    if (!name || name.trim() === "") name = h.code;
    return {
      stockCode: h.code,
      stockName: name,
      limitUpDate: h.date,
      boardCount: n === 1 ? "首板" : `${n}天${n}板`,
      turnover: fmtTurnoverYi(h.amount),
    };
  });

  if (DRY) {
    log(`[DRY-RUN] 将写入 ${rowsToInsert.length} 条，未落库。`);
    // 展示首末几条样例
    for (const r of rowsToInsert.slice(0, 5)) log(`  样例 ${JSON.stringify(r)}`);
    return;
  }

  // 分批写入
  let inserted = 0;
  const cols = ["stockCode", "stockName", "limitUpDate", "boardCount", "turnover"];
  for (let i = 0; i < rowsToInsert.length; i += BATCH) {
    const batch = rowsToInsert.slice(i, i + BATCH);
    const values = batch.map((r) => [r.stockCode, r.stockName, r.limitUpDate, r.boardCount, r.turnover]);
    await conn.query(`INSERT INTO limit_up_records (${cols.join(", ")}) VALUES ?`, [values]);
    inserted += batch.length;
    log(`  已写入 ${inserted}/${rowsToInsert.length}`);
  }
  log(`回填完成：写入 ${inserted} 条涨停记录。`);
}

await main();
await conn.end();
