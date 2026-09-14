/**
 * 核实：真实库里的策略文档到底声明了什么观察窗口（决定直读桥的投影窗口怎么取）。
 *
 * 只读。用法（项目根目录）：npx tsx docs/evidence/_probe_strategy_observation_window.mts
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

const res = await db.execute(sql`
  select strategyId, version, strategyDocumentJson
    from strategy_versions
   order by strategyId, version
`);
const rows = (res as unknown as [Array<Record<string, unknown>>])[0] ?? [];
console.log(`策略版本数 = ${rows.length}\n`);

for (const r of rows) {
  const raw = r["strategyDocumentJson"];
  let doc: any = null;
  try {
    doc = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    console.log(`${r["strategyId"]}@${r["version"]}  JSON 解析失败`);
    continue;
  }
  const def = doc?.definition ?? null;
  const ow = def?.entry?.observationWindow ?? null;
  const datasets = def?.datasets ?? null;
  console.log(`${r["strategyId"]}@${r["version"]}`);
  console.log(`  document.datasetVersionId   = ${doc?.datasetVersionId ?? "(无)"}`);
  console.log(`  definition.entry.observationWindow = ${ow ? JSON.stringify(ow) : "(未声明)"}`);
  console.log(
    `  definition.datasets         = ${
      Array.isArray(datasets)
        ? JSON.stringify(datasets.map((d: any) => ({ role: d?.role, datasetVersionId: d?.datasetVersionId })))
        : datasets
          ? JSON.stringify(datasets)
          : "(无)"
    }`,
  );
  console.log(`  top-level keys = ${Object.keys(doc).join(", ")}`);
  console.log(`  definition keys = ${def ? Object.keys(def).join(", ") : "(无 definition)"}`);
  console.log("");
}

process.exit(0);
