/**
 * 只读探针：核准「候选 → 策略 → 回测」链路的**真实断点**。
 *
 * 要回答的三个问题（全部只读，不写任何表）：
 *   ① `promote` 之后，策略文档里的 `entryRule.conditions`（= 用户那些「守线 + 缩量」条件）
 *      到底存不存在、长什么样？
 *   ② 回测执行侧（`recipeRegistry` / `runWorkbenchAssembly`）**消费**文档的哪些字段？
 *      是否包含 `entryRule.conditions`？
 *   ③ 已注册的 `recipeId` 有几个？它们各自代表什么？
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

console.log("=== ① 已转正的策略版本（strategy_versions）===");
const [versions] = await conn.query<any[]>(
  `SELECT id, strategyId, version, fingerprint, createdAt,
          CHAR_LENGTH(strategyDocumentJson) AS docLen
     FROM strategy_versions ORDER BY id DESC LIMIT 10`,
);
if (versions.length === 0) {
  console.log("(无)");
} else {
  for (const v of versions) {
    console.log(`  #${v.id} ${v.strategyId}@${v.version}  docLen=${v.docLen}  fp=${String(v.fingerprint).slice(0, 16)}…  ${v.createdAt}`);
  }

  console.log("\n=== ② 最新一份策略文档的「条件面」抽取 ===");
  const [docRows] = await conn.query<any[]>(
    `SELECT strategyDocumentJson FROM strategy_versions ORDER BY id DESC LIMIT 1`,
  );
  const doc = JSON.parse(String(docRows[0].strategyDocumentJson));
  const def = doc.definition ?? {};
  console.log(`  顶层键: ${Object.keys(doc).join(", ")}`);
  console.log(`  definition.entryRule 存在: ${def.entryRule !== undefined}`);
  if (def.entryRule) {
    console.log(`  entryRule 键: ${Object.keys(def.entryRule).join(", ")}`);
    console.log(`  entryRule.event = ${JSON.stringify(def.entryRule.event)}`);
    const conds = def.entryRule.conditions;
    console.log(`  🔴 entryRule.conditions = ${conds === undefined ? "(不存在)" : JSON.stringify(conds).slice(0, 400)}`);
  }
  console.log(`  recipe（回测执行面）= ${JSON.stringify(doc.recipe)}`);
}

console.log("\n=== ③ 候选表状态分布 ===");
const [cands] = await conn.query<any[]>(
  `SELECT status, COUNT(*) AS n FROM research_strategy_candidate GROUP BY status`,
);
if (cands.length === 0) console.log("(无候选)");
else for (const c of cands) console.log(`  ${c.status}: ${c.n}`);

await conn.end();
