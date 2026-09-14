/**
 * 只读探针：查清「股票代码 → 名称」的真实来源与格式。
 *
 * 目的：成交明细要展示「名称 + 代码」，必须先证明：
 *   1. `limit_up_records.stockCode` 的真实格式；
 *   2. 留档回测结果 `resultJson` 里 `trades[].securityId` 的真实格式；
 *   3. 两者能否直接对齐（覆盖率），有多少代码取不到名称；
 *   4. 结果里是否已经带了任何名称字段（避免重复造轮子）。
 *
 * 注意：TiDB 不支持 JSON_TABLE ⇒ 一律在 Node 侧 JSON.parse。
 * 不写库、不删库。
 *
 * 用法：npx tsx docs/evidence/_probe_symbol_name_source.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const db = await getDb();
if (!db) {
  console.log("数据库不可用");
  process.exit(1);
}

type Row = Record<string, unknown>;

function unwrap(rows: unknown): Row[] {
  if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0])) {
    return rows[0] as Row[];
  }
  return (rows ?? []) as Row[];
}

async function q(label: string, statement: ReturnType<typeof sql>): Promise<Row[]> {
  const list = unwrap(await db!.execute(statement));
  console.log(`\n=== ${label} ===  rows=${list.length}`);
  return list;
}

const out: Record<string, unknown> = {};

// ---------- 1) limit_up_records.stockCode 格式 ----------
const lr = await q(
  "limit_up_records 样例（最近 8 条）",
  sql`SELECT stockCode, stockName, limitUpDate FROM limit_up_records ORDER BY limitUpDate DESC, id DESC LIMIT 8`,
);
for (const r of lr) console.log("  ", r.stockCode, "|", r.stockName, "|", r.limitUpDate);

const lrMeta = await q(
  "limit_up_records 总量",
  sql`SELECT COUNT(*) AS total, COUNT(DISTINCT stockCode) AS distinctCodes, MIN(limitUpDate) AS minDate, MAX(limitUpDate) AS maxDate FROM limit_up_records`,
);
console.log("  ", JSON.stringify(lrMeta[0]));
out.limitUpRecords = lrMeta[0];

const nameMap = new Map<string, string>();
for (const r of await unwrap(
  await db.execute(sql`SELECT stockCode, stockName FROM limit_up_records`),
)) {
  const code = String(r.stockCode ?? "");
  const name = String(r.stockName ?? "").trim();
  if (code && name) nameMap.set(code, name);
}
console.log(`\n  [nameMap] 代码→名称 条目数 = ${nameMap.size}`);

// ---------- 2) stock_daily_prices.stockCode 格式 ----------
const sd = await q(
  "stock_daily_prices 唯一代码样例",
  sql`SELECT DISTINCT stockCode FROM stock_daily_prices ORDER BY stockCode LIMIT 8`,
);
for (const r of sd) console.log("  ", r.stockCode);

// ---------- 3) 留档回测结果 —— trades[].securityId ----------
const runs = await q(
  "closed_loop_backtest_run 留档行",
  sql`SELECT id, runId, strategyId, strategyVersion, status, tradeCount, LENGTH(resultJson) AS jsonLen FROM closed_loop_backtest_run ORDER BY id`,
);
for (const r of runs) console.log("  ", JSON.stringify(r));

type TradeShape = Record<string, unknown>;

function collectTrades(node: unknown, sink: TradeShape[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectTrades(item, sink);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    // 命中判据：同时具备 securityId + entryTime 即为 Trade 形状。
    if (typeof obj.securityId === "string" && typeof obj.entryTime === "string") {
      sink.push(obj);
      return;
    }
    for (const value of Object.values(obj)) collectTrades(value, sink);
  }
}

const allTradeCodes = new Set<string>();
const tradeKeys = new Set<string>();
let totalTrades = 0;

for (const run of runs) {
  const id = Number(run.id);
  const rawRows = unwrap(
    await db.execute(sql`SELECT resultJson FROM closed_loop_backtest_run WHERE id = ${id} LIMIT 1`),
  );
  const raw = rawRows[0]?.resultJson;
  if (typeof raw !== "string") {
    console.log(`  [run ${id}] resultJson 非字符串（${typeof raw}）`);
    continue;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.log(`  [run ${id}] resultJson 解析失败：${(error as Error).message}`);
    continue;
  }
  const sink: TradeShape[] = [];
  collectTrades(parsed, sink);
  for (const t of sink) {
    for (const k of Object.keys(t)) tradeKeys.add(k);
    allTradeCodes.add(String(t.securityId));
  }
  totalTrades += sink.length;
  console.log(
    `  [run ${id}] trades=${sink.length}  securityId 样例 = ${sink.slice(0, 5).map((t) => t.securityId).join(", ") || "（无）"}`,
  );
}

console.log(`\n  [汇总] 留档总成交笔数 = ${totalTrades}，唯一代码数 = ${allTradeCodes.size}`);
console.log(`  [汇总] Trade 对象出现过的字段（并集）= ${[...tradeKeys].sort().join(", ")}`);
console.log(`  [汇总] 代码样例 = ${[...allTradeCodes].slice(0, 10).join(", ")}`);

const hasNameField = [...tradeKeys].some((k) => /name/i.test(k));
console.log(`  [汇总] Trade 里是否已存在名称类字段 = ${hasNameField}`);

// ---------- 4) 覆盖率 ----------
let matched = 0;
const unmatched: string[] = [];
for (const code of allTradeCodes) {
  if (nameMap.has(code)) matched += 1;
  else unmatched.push(code);
}
console.log(`\n  [覆盖率] 回测代码 ${allTradeCodes.size} 个，能取到名称 = ${matched}，取不到 = ${unmatched.length}`);
if (unmatched.length > 0) {
  console.log(`  [覆盖率] 取不到的代码（前 20）：${unmatched.slice(0, 20).join(", ")}`);
}

out.tradeFields = [...tradeKeys].sort();
out.tradeCodeCount = allTradeCodes.size;
out.matchedCount = matched;
out.unmatchedCodes = unmatched.slice(0, 50);
out.sampleTradeCodes = [...allTradeCodes].slice(0, 10);

console.log("\n[ok] 只读探针结束");
console.log(JSON.stringify(out, null, 2));
process.exit(0);
