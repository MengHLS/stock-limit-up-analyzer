/**
 * 只读诊断探针：龙头候选回测「冷算慢路径」在**当前跨境链路**上的可行性实测。
 *
 * 背景：2026-09-19 22:08 用户报「复盘分析 → 龙头候选加载不出来」。
 * 现场实测 `sentiment.getLeaderCandidateHistoryPage` 返回 **500**（169.7s）：
 *   `Connection lost: The server closed the connection.`
 *   栈顶 = `loadBacktestPriceRows`（server/db.ts:2316，即那条拉 ~150 万行的 JOIN）。
 * 同时 `.cache/leader-candidate-backtest/` 为空（快照被清）⇒ 每次访问都要走冷算。
 *
 * 本探针**只做 SELECT / CREATE TEMPORARY TABLE**（会话级临时表，不写任何业务表），
 * 用于回答三个问题：
 *   ① 数据戳三条链末端是否推进过（是否刚有写入 ⇒ 清空了快照）；
 *   ② 大查询的数据规模（涨停记录数 / 窗口合并后区间数）；
 *   ③ 那条 JOIN 在分段窗口下能否跑通、耗时随窗口如何增长（判断是「太大」还是「链路已不可用」）。
 *
 * 用法（必须在仓内跑，且需沙箱外网络）：
 *   node --env-file=.env docs/evidence/_probe_lc_slowpath.mjs
 */
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

/* ---------------- 连接（口径与 server/db.ts#getDb 完全一致） ---------------- */

function loadEnv() {
  const out = {};
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function buildConnectionOptions(raw) {
  // 与 `docs/evidence/_probe_paper_run_params.mts`（已实测可连）同一套解析：
  // 必须先把 `?ssl={...}` 剥离再 `new URL`，并把 ssl 以**对象**传入。
  // 注意 `compress` 不显式开启（实测开启时本机新建连接偶发握手失败，见下方重试逻辑）。
  const sslMatch = raw.match(/[?&]ssl=(\{[^&]*\})/);
  let ssl;
  if (sslMatch) {
    try {
      ssl = JSON.parse(sslMatch[1]);
    } catch {
      ssl = undefined;
    }
  }
  const withoutSsl = raw.replace(/[?&]ssl=\{[^&]*\}/, "");
  const u = new URL(withoutSsl);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 4000,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ...(ssl ? { ssl } : {}),
    enableKeepAlive: true,
    connectTimeout: 20_000,
  };
}

const env = loadEnv();
if (!env.DATABASE_URL) {
  console.log("FAIL: .env 缺 DATABASE_URL");
  process.exit(1);
}

/** 建连重试（跨境链路对「新建连接」极不稳，实测多次被对端关闭/超时）。 */
async function connectWithRetry(attempts = 5, delayMs = 4000) {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    const t0 = Date.now();
    try {
      const c = await mysql.createConnection(buildConnectionOptions(env.DATABASE_URL));
      console.log(`=== 建连成功（第 ${i} 次尝试，${Date.now() - t0}ms）===`);
      return c;
    } catch (error) {
      lastError = error;
      console.log(`[建连失败] 第 ${i}/${attempts} 次  ${Date.now() - t0}ms  ${String(error.message).slice(0, 120)}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

const conn = await connectWithRetry();

async function step(label, sql) {
  const t0 = Date.now();
  try {
    const [rows] = await conn.query(sql);
    const ms = Date.now() - t0;
    console.log(`\n[OK] ${label}  ${ms}ms`);
    return { ok: true, ms, rows };
  } catch (error) {
    const ms = Date.now() - t0;
    console.log(`\n[FAIL] ${label}  ${ms}ms  ${String(error.message).slice(0, 200)}`);
    return { ok: false, ms, error: String(error.message) };
  }
}

/* ---------------- 阶段 1：数据戳 + 规模（轻量） ---------------- */

const stamp = await step(
  "数据戳（三条链末端）",
  `SELECT
     (SELECT MAX(limitUpDate) FROM limit_up_records)   AS lu,
     (SELECT MAX(tradeDate)   FROM index_daily)        AS cal,
     (SELECT MAX(tradeDate)   FROM stock_daily_prices) AS px`,
);
if (stamp.ok) console.log("  ", JSON.stringify(stamp.rows[0]));

const luCount = await step("涨停记录总数", "SELECT COUNT(*) AS n FROM limit_up_records");
if (luCount.ok) console.log("  ", JSON.stringify(luCount.rows[0]));

const execTime = await step(
  "服务端执行时限变量",
  "SELECT @@max_execution_time AS max_exec, @@wait_timeout AS wait_to, @@net_read_timeout AS net_read, @@net_write_timeout AS net_write",
);
if (execTime.ok) console.log("  ", JSON.stringify(execTime.rows[0]));

/* ---------------- 阶段 2：分段窗口复现（同 loadBacktestPriceRows 的两步 SQL） ---------------- */

const LOOKBACK = 30;
const FORWARD = 14;

async function pullWindow(startDate, endDate) {
  const t0 = Date.now();
  const [limitUpRows] = await conn.query(
    `SELECT stockCode, DATE_FORMAT(limitUpDate, '%Y-%m-%d') AS limitUpDate FROM limit_up_records` +
      ` WHERE limitUpDate >= ? AND limitUpDate <= ? ORDER BY stockCode, limitUpDate`,
    [startDate, endDate],
  );
  const tInner = Date.now() - t0;
  const rows = limitUpRows;
  if (rows.length === 0) return { ms: Date.now() - t0, signalDays: 0, ranges: 0, priceRows: 0 };

  // 合并相邻涨停日为不相交区间（间隔 <= lookback+forward 自然日）
  const MAX_GAP_DAYS = LOOKBACK + FORWARD;
  const DAY = 86400000;
  const byStock = new Map();
  for (const r of rows) {
    if (!byStock.has(r.stockCode)) byStock.set(r.stockCode, []);
    byStock.get(r.stockCode).push(r.limitUpDate);
  }
  const ranges = [];
  for (const [code, dates] of byStock) {
    let start = dates[0];
    let end = dates[0];
    for (let i = 1; i < dates.length; i += 1) {
      const d = dates[i];
      if (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${end}T00:00:00Z`) <= MAX_GAP_DAYS * DAY) {
        end = d;
      } else {
        ranges.push({ code, start, end });
        start = d;
        end = d;
      }
    }
    ranges.push({ code, start, end });
  }

  await conn.query("DROP TEMPORARY TABLE IF EXISTS tmp_lc_probe_window");
  await conn.query(
    "CREATE TEMPORARY TABLE tmp_lc_probe_window (stockCode VARCHAR(20), startDate DATE, endDate DATE, KEY idx_win (stockCode, startDate))",
  );
  const values = ranges
    .map((r) => `(${conn.escape(r.code)},${conn.escape(r.start)},${conn.escape(r.end)})`)
    .join(",");
  const tIns0 = Date.now();
  await conn.query(
    `INSERT INTO tmp_lc_probe_window (stockCode, startDate, endDate) VALUES ${values}`,
  );
  const tIns = Date.now() - tIns0;

  const tJoin0 = Date.now();
  // 关键差异：这里**真实取回全部列**（而非 COUNT），才能反映「跨境传输」这一真正的瓶颈；
  // COUNT 只是服务端聚合，不代表把 ~150 万行搬回 Node 的成本。
  const [priceRows] = await conn.query(
    `SELECT p.stockCode, DATE_FORMAT(p.tradeDate, '%Y-%m-%d') AS tradeDate,
            p.openPrice, p.closePrice, p.highPrice, p.lowPrice, p.amount, p.volume
       FROM stock_daily_prices p
       JOIN tmp_lc_probe_window w ON w.stockCode = p.stockCode
         AND p.tradeDate >= DATE_SUB(w.startDate, INTERVAL ${LOOKBACK} DAY)
         AND p.tradeDate <= DATE_ADD(w.endDate, INTERVAL ${FORWARD} DAY)`,
  );
  const tJoin = Date.now() - tJoin0;

  return {
    ms: Date.now() - t0,
    signalDays: rows.length,
    ranges: ranges.length,
    priceRows: priceRows.length,
    bytes: Buffer.byteLength(JSON.stringify(priceRows), "utf8"),
    detail: `innerQuery=${tInner}ms  insert=${tIns}ms  fetchAll=${tJoin}ms`,
  };
}

console.log("\n=== 阶段 2：分段窗口实测（真实取回） ===");
for (const [start, end, tag] of [
  ["2026-08-01", "2026-09-19", "最近 ~7 周"],
  ["2026-06-01", "2026-09-19", "最近 ~3.5 月"],
  ["2026-01-01", "2026-09-19", "2026 年内"],
]) {
  try {
    const r = await pullWindow(start, end);
    console.log(
      `[OK] ${tag} (${start}~${end})  ${r.ms}ms  信号日=${r.signalDays} 区间=${r.ranges} 价格行=${r.priceRows}  ≈${(r.bytes / 1048576).toFixed(1)}MB`,
    );
    console.log("     ", r.detail ?? "");
  } catch (error) {
    console.log(`[FAIL] ${tag} (${start}~${end})  已耗时 ${Date.now()}  ${String(error.message).slice(0, 200)}`);
  }
}

console.log("\n=== 阶段 3：全区间（dev server 实际走的那条） ===");
try {
  const r = await pullWindow("2019-01-01", "2026-09-19");
  console.log(
    `[OK] 全区间  ${r.ms}ms  信号日=${r.signalDays} 区间=${r.ranges} 价格行=${r.priceRows}  ≈${(r.bytes / 1048576).toFixed(1)}MB`,
  );
  console.log("     ", r.detail ?? "");
} catch (error) {
  console.log(`[FAIL] 全区间  ${String(error.message).slice(0, 300)}`);
}

await conn.end();
console.log("\n=== 探针结束 ===");
