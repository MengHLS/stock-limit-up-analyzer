/**
 * 只读探针：把已转正策略文档的 **真实条件面** 原样打出来。
 *
 * 上一版 `_probe_promote_to_backtest_gap.mts` 读的是 `definition.entryRule`（不存在）；
 * 真实键是 `definition.entry`（见 server/research/strategySchema/definition.ts 的 EntryDefinition）。
 *
 * 要回答：
 *   ① `definition.entry.conditions` 是否存在、内容是什么（= candidate.filterRule 的真实投影）；
 *   ② `definition.execution` 三元组（signalTiming / executionTiming / priceType）是什么；
 *   ③ `definition.exit.rules` / `position` / `risk` 是什么；
 *   ④ `document.recipe` 是否存在（= 回测执行面能否解析）。
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const m = /^mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/.exec(process.env.DATABASE_URL!);
if (!m) throw new Error("DATABASE_URL 解析失败");
const cfg = {
  user: decodeURIComponent(m[1]),
  password: decodeURIComponent(m[2]),
  host: m[3],
  port: Number(m[4]),
  database: m[5].split("/")[0],
};

const conn = await mysql.createConnection({ ...cfg, ssl: { rejectUnauthorized: false }, connectTimeout: 30_000 });

const [rows] = await conn.query<any[]>(
  `SELECT id, strategyId, version, strategyDocumentJson FROM strategy_versions ORDER BY id DESC`,
);

for (const row of rows) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`#${row.id}  ${row.strategyId}@${row.version}`);
  console.log("=".repeat(78));
  const doc = JSON.parse(String(row.strategyDocumentJson));
  const def = doc.definition ?? null;

  console.log(`顶层键: ${Object.keys(doc).join(", ")}`);
  console.log(`recipe（回测执行面）= ${doc.recipe === undefined ? "🔴 不存在" : JSON.stringify(doc.recipe)}`);

  if (def === null) {
    console.log("🔴 definition 段不存在（该文档只有 v1 legacy 视图）");
    console.log(`entryRules(v1 视图) 条数 = ${Array.isArray(doc.entryRules) ? doc.entryRules.length : "(非数组)"}`);
    if (Array.isArray(doc.entryRules)) {
      for (const r of doc.entryRules) console.log(`   · ${JSON.stringify(r)}`);
    }
    continue;
  }

  console.log(`definition.schemaVersion = ${def.schemaVersion}`);
  const entry = def.entry ?? {};
  console.log(`definition.entry.event = ${JSON.stringify(entry.event)}`);
  console.log(`definition.entry.observationWindow = ${JSON.stringify(entry.observationWindow)}`);
  console.log(`definition.entry.trigger = ${JSON.stringify(entry.trigger)}`);
  const conds = entry.conditions;
  if (!Array.isArray(conds)) {
    console.log(`🔴 definition.entry.conditions = (不存在)`);
  } else if (conds.length === 0) {
    console.log(`⚠️ definition.entry.conditions = [] （空数组 —— 该策略没有任何入场条件）`);
  } else {
    console.log(`definition.entry.conditions（${conds.length} 条）=`);
    for (const c of conds) {
      console.log(`   · id=${c.id} field=${c.field} ${c.operator} ${JSON.stringify(c.value)} (${c.valueType}) enabled=${c.enabled}`);
    }
  }

  console.log(`definition.execution = ${JSON.stringify(def.execution)}`);
  console.log(`definition.exit.rules（${(def.exit?.rules ?? []).length} 条）= ${JSON.stringify(def.exit?.rules)}`);
  console.log(`definition.position = ${JSON.stringify(def.position)}`);
  console.log(`definition.risk = ${JSON.stringify(def.risk)}`);
  console.log(`definition.parameters（${(def.parameters ?? []).length} 项）= ${JSON.stringify((def.parameters ?? []).map((p: any) => p.code))}`);
  console.log(`definition.datasets = ${JSON.stringify(def.datasets)}`);
}

await conn.end();
