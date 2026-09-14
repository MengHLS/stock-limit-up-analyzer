/**
 * 「直读桥把 `event.symbol` 当 `securityId`」是否为键域违规 —— 真实库取证（2026-09-14）。
 *
 * 背景：`assemble.ts` 从今天起**默认走直读桥**（此前 `executionBarsAvailable` 恒 false ⇒ 恒回落
 * 重建），于是 `datasetFromRegistry.ts` 里 `securityId: event.symbol` 这一潜伏赋值被激活。
 *
 * 契约两侧（已读源码，非推断）：
 *   - `drizzle/schema.ts#researchSecurities`：`securityId` 注释「永久身份（系统分配，如 sec_<uuid>）」
 *     ⇒ canonical identity = `sec_<uuid>`；
 *   - `server/researchDataset/types.ts#ResearchDatasetRow`：`securityId: string` 为身份，
 *     `code: string | null` 才是「该日生效完整代码（如 600000.SH）」—— 两者是不同字段；
 *   - 重建路径（`researchDataset/db.ts#loadSecurities` 读 `research_securities` ⇒
 *     `projectStateToRow.securityId = state.query.securityId`）确实产出 `sec_<uuid>`；
 *   - `ds_*` 三张表（plugins.ts#eventCreateSql / rawBarCreateSql）**只有 `symbol`**，无身份列。
 *
 * 本探针只回答两个问题（决定要不要在桥里补 symbol → sec_<uuid> 解析）：
 *   A. `ds_*` 事件 symbol 在 `research_security_identifier_history` 里**能否**解析到唯一
 *      `sec_<uuid>`（asOf = 事件日）—— 解析率不足则「补解析」会把直读变成新的失败源；
 *   B. 加载解析所需数据（primary 标识全量）的成本与规模 —— 决定实现方式（全量载入 vs 分批 IN）。
 *
 * 只读、无写入、无自清理需求。用法（项目根目录）：
 *   npx tsx docs/evidence/_probe_symbol_identity_coverage.mts
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { parseSecurityCode, canonicalCode } from "../../server/security/code";

const VERSION_ID = 390002;

const url = process.env.DATABASE_URL!;
const u = new URL(url);
const sslRaw = /ssl=(\{.*\})/.exec(url)?.[1];
const c = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port || 4000),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ""),
  ssl: sslRaw ? JSON.parse(sslRaw) : undefined,
  compress: true,
  connectTimeout: 20_000,
});

async function q<T = any>(label: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const t = Date.now();
  const [rows] = await c.query<any[]>(sql, params as any[]);
  console.log(`\n[${label}] ${Date.now() - t}ms  rows=${rows.length}`);
  return rows as T[];
}

/** 区间包含（与 server/security/identifierHistory.ts 同口径；此处内联以免跨层耦合）。 */
function contains(from: string, to: string | null, asOf: string): boolean {
  return from <= asOf && (to === null || asOf <= to);
}

console.log("=== A. ds_* 事件 symbol 规模 ===");
const [evCount] = await q<{ n: number }>(
  "A1 事件总数",
  `select count(*) as n from ds_first_limit_pullback_event where datasetVersionId=?`,
  [VERSION_ID],
);
const symRows = await q<{ symbol: string; n: number; minDate: string; maxDate: string }>(
  "A2 distinct symbol",
  `select symbol, count(*) as n, min(tradeDate) as minDate, max(tradeDate) as maxDate
     from ds_first_limit_pullback_event where datasetVersionId=? group by symbol`,
  [VERSION_ID],
);
console.log(`   事件 ${evCount?.n} 条 / distinct symbol ${symRows.length} 个`);

console.log("\n=== B. 标识历史规模（决定实现方式） ===");
const [idAll] = await q<{ n: number }>("B1 identifier_history 总行数", `select count(*) as n from research_security_identifier_history`);
const [idPrimary] = await q<{ n: number }>(
  "B2 primary 行数",
  `select count(*) as n from research_security_identifier_history where identifierType='primary'`,
);
console.log(`   总行 ${idAll?.n} / primary ${idPrimary?.n}`);
const idRows = await q<{ securityId: string; exchange: string; securityCode: string; effectiveFrom: string; effectiveTo: string | null }>(
  "B3 载入 primary 全量",
  `select securityId, exchange, securityCode, effectiveFrom, effectiveTo
     from research_security_identifier_history where identifierType='primary'`,
);

// 按 engineKey（6位.交易所）索引，保留 securityId 集合（code reuse 可能多段）
type Seg = { securityId: string; from: string; to: string | null };
const byEngineKey = new Map<string, Seg[]>();
let badCode = 0;
for (const r of idRows) {
  let engineKey: string;
  try {
    engineKey = canonicalCode(parseSecurityCode(`${r.securityCode}.${r.exchange}`));
  } catch {
    badCode += 1;
    continue;
  }
  const list = byEngineKey.get(engineKey) ?? [];
  list.push({ securityId: r.securityId, from: r.effectiveFrom, to: r.effectiveTo });
  byEngineKey.set(engineKey, list);
}
console.log(`   建索引 engineKey=${byEngineKey.size} 个（代码非法跳过 ${badCode} 行）`);

console.log("\n=== C. 逐 symbol 解析（asOf = 该 symbol 最早事件日） ===");
let okCount = 0;
let noIdentifier = 0;
let ambiguous = 0;
const unresolved: string[] = [];
const ambiguousSamples: string[] = [];
for (const row of symRows) {
  const segs = byEngineKey.get(row.symbol);
  if (segs === undefined || segs.length === 0) {
    noIdentifier += 1;
    if (unresolved.length < 10) unresolved.push(row.symbol);
    continue;
  }
  const asOf = row.minDate;
  const hits = segs.filter((s) => contains(s.from, s.to, asOf));
  const ids = new Set(hits.map((s) => s.securityId));
  if (hits.length === 0) {
    noIdentifier += 1;
    if (unresolved.length < 10) unresolved.push(`${row.symbol}@${asOf}(无生效区间)`);
  } else if (ids.size > 1) {
    ambiguous += 1;
    if (ambiguousSamples.length < 10) ambiguousSamples.push(`${row.symbol}@${asOf}→${ids.size} 个 identity`);
  } else {
    // 唯一区间但可能多行同 id：只要 identity 唯一即视为可解析
    okCount += 1;
  }
}
const total = symRows.length;
const pct = total === 0 ? 0 : ((okCount / total) * 100).toFixed(2);
console.log(`   可解析 = ${okCount} / ${total} = ${pct}%`);
console.log(`   NO_IDENTIFIER = ${noIdentifier}${unresolved.length > 0 ? `（样例 ${unresolved.join(", ")}）` : ""}`);
console.log(`   AMBIGUOUS     = ${ambiguous}${ambiguousSamples.length > 0 ? `（样例 ${ambiguousSamples.join("; ")}）` : ""}`);

console.log("\n=== D. 抽样核对：symbol → identity → 回解析 engineKey ===");
for (const row of symRows.slice(0, 5)) {
  const segs = byEngineKey.get(row.symbol);
  if (segs === undefined) {
    console.log(`   ${row.symbol} → (无标识)`);
    continue;
  }
  const hits = segs.filter((s) => contains(s.from, s.to, row.minDate));
  console.log(
    `   ${row.symbol}@${row.minDate} → ${hits.map((h) => h.securityId).join("|") || "(无生效区间)"}`,
  );
}

console.log("\n=== 结论 ===");
if (okCount === total && total > 0) {
  console.log(`   ✅ 全部 ${total} 个 symbol 都能在事件日解析到唯一 sec_<uuid> ⇒ 直读桥可补齐 canonical securityId。`);
} else {
  console.log(`   🔴 解析率 ${pct}%（${noIdentifier} 个查不到 / ${ambiguous} 个歧义）⇒ 补齐前必须先处理这部分。`);
}

await c.end();
