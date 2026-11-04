/**
 * RESEARCH-PLANNER-001 — 为什么 `market_cap 分位` 产出 0 行？（只读诊断）
 * 用法：npx tsx docs/evidence/_probe_market_cap_feature.mts
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";
import { DbDatasetRegistry } from "../../server/datasetRegistry/db";

const db = await getDb();
if (!db) process.exit(1);

const registry = new DbDatasetRegistry();
const version = await registry.getVersion(390002);
console.log("version:", JSON.stringify({ id: version?.id, version: version?.version, datasetId: version?.datasetId }));

const def = version?.datasetId !== undefined ? await registry.getDefinition(version.datasetId) : null;
console.log("definition:", JSON.stringify({ id: def?.id, code: def?.datasetCode, name: def?.name }));

// 物理表
const tables = (await db.execute(sql`
  select table_name from information_schema.tables
  where table_schema = database() and (table_name like 'ds\\_%' or table_name like 'dataset%')
  order by table_name`)) as unknown as [Array<Record<string, unknown>>];
console.log("物理表:", (tables[0] ?? []).map((t) => t["table_name"]).join("  "));
process.exit(0);
