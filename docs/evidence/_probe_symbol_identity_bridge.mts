/**
 * 只读探针：查 `sec_<uuid>` → 股票代码 → 股票名称 的可用链路。
 *
 * 背景：闭环回测结果 `trades[].securityId` 实测是 `sec_<uuid>` 永久身份，
 * 而 `limit_up_records.stockCode` 是 `002361.SZ` 形式 ⇒ 中间必须要一次「身份 → 代码」的翻译。
 *
 * 本探针回答：
 *   A. `research_securities` 有多少行、样例；
 *   B. `research_security_identifier_history` 有无数据、能否按 securityId 反查 6 位代码；
 *   C. `ds_first_limit_pullback_event.symbol` 的真实格式（数据集侧 symbol 是代码还是身份）；
 *   D. 留档 trades 的 251 个 sec_<uuid> 中，有多少能在 B/C 两条链路上翻译成代码，再对到名称。
 *
 * 不写库、不删库。
 *
 * 用法：npx tsx docs/evidence/_probe_symbol_identity_bridge.mts
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
  console.log(`\n=== ${label} ===`);
  return list;
}

// A) research_securities
const secMeta = await q(
  "research_securities 规模",
  sql`SELECT COUNT(*) AS total, COUNT(DISTINCT securityId) AS distinctIds FROM research_securities`,
);
console.log("  ", JSON.stringify(secMeta[0]));
const secSample = await q(
  "research_securities 样例",
  sql`SELECT id, securityId, exchange, securityType, status, listedDate FROM research_securities ORDER BY id LIMIT 5`,
);
for (const r of secSample) console.log("  ", JSON.stringify(r));

// B) research_security_identifier_history
const idMeta = await q(
  "identifier_history 规模",
  sql`SELECT COUNT(*) AS total, COUNT(DISTINCT securityId) AS distinctIds, COUNT(DISTINCT securityCode) AS distinctCodes FROM research_security_identifier_history`,
);
console.log("  ", JSON.stringify(idMeta[0]));
const idSample = await q(
  "identifier_history 样例",
  sql`SELECT securityId, exchange, securityCode, identifierType, effectiveFrom, effectiveTo FROM research_security_identifier_history ORDER BY id LIMIT 8`,
);
for (const r of idSample) console.log("  ", JSON.stringify(r));

// C) ds_first_limit_pullback_event.symbol 格式
const evSample = await q(
  "ds_first_limit_pullback_event symbol 样例",
  sql`SELECT DISTINCT symbol FROM ds_first_limit_pullback_event ORDER BY symbol LIMIT 10`,
);
for (const r of evSample) console.log("  ", r.symbol);

// D) 留档 trades 的 sec_<uuid>
const runs = await q(
  "留档行",
  sql`SELECT id, strategyId, tradeCount FROM closed_loop_backtest_run ORDER BY id`,
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
    if (typeof obj.securityId === "string" && typeof obj.entryTime === "string") {
      sink.push(obj);
      return;
    }
    for (const value of Object.values(obj)) collectTrades(value, sink);
  }
}

const tradeIds = new Set<string>();
for (const run of runs) {
  const rawRows = unwrap(
    await db.execute(sql`SELECT resultJson FROM closed_loop_backtest_run WHERE id = ${Number(run.id)} LIMIT 1`),
  );
  const raw = rawRows[0]?.resultJson;
  if (typeof raw !== "string") continue;
  const sink: TradeShape[] = [];
  try {
    collectTrades(JSON.parse(raw), sink);
  } catch {
    continue;
  }
  for (const t of sink) tradeIds.add(String(t.securityId));
}
console.log(`\n  [trades] 唯一 securityId = ${tradeIds.size}`);

// D1) 用 identifier_history 反查
const idRows = await q(
  "identifier_history 全量（primary 优先）",
  sql`SELECT securityId, exchange, securityCode, identifierType, effectiveFrom FROM research_security_identifier_history`,
);
const codeByIdentity = new Map<string, string>();
for (const r of idRows) {
  const sid = String(r.securityId ?? "");
  const code = String(r.securityCode ?? "");
  const ex = String(r.exchange ?? "");
  if (!sid || !code) continue;
  const t = String(r.identifierType ?? "");
  const formatted = code.includes(".") ? code : `${code}.${ex}`;
  const existing = codeByIdentity.get(sid);
  // primary 优先；否则保留第一条。
  if (!existing || t === "primary") codeByIdentity.set(sid, formatted);
}

// D2) 用 research_securities 反查（自身只有 id，无 code）
let hitIdentifier = 0;
const missIdentifier: string[] = [];
for (const sid of tradeIds) {
  if (codeByIdentity.has(sid)) hitIdentifier += 1;
  else missIdentifier.push(sid);
}
console.log(
  `  [链路 B] 用 identifier_history 可翻译 = ${hitIdentifier} / ${tradeIds.size}；miss = ${missIdentifier.length}`,
);
if (missIdentifier.length > 0) console.log(`       miss 前 5 = ${missIdentifier.slice(0, 5).join(", ")}`);

// D3) 名称对齐
const nameRows = unwrap(await db.execute(sql`SELECT stockCode, stockName FROM limit_up_records`));
const nameByCode = new Map<string, string>();
for (const r of nameRows) {
  const c = String(r.stockCode ?? "");
  const n = String(r.stockName ?? "").trim();
  if (c && n) nameByCode.set(c, n);
}
let hitName = 0;
const sample: string[] = [];
for (const sid of tradeIds) {
  const code = codeByIdentity.get(sid);
  if (!code) continue;
  const name = nameByCode.get(code);
  if (name) {
    hitName += 1;
    if (sample.length < 8) sample.push(`${sid.slice(0, 20)}… → ${code} ${name}`);
  }
}
console.log(`  [链路 B+C] 最终能拿到名称 = ${hitName} / ${tradeIds.size}`);
for (const s of sample) console.log("       ", s);

console.log("\n[ok] 只读探针结束");
process.exit(0);
