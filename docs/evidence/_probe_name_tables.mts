/**
 * 只读探针：列出真实库里所有「可能承载证券名称」的表与列。
 *
 * 动因：`drizzle/schema.ts` 里没有 name history 表，但真实库可能已有
 * backfill 侧写入的证券主数据表（本项目 schema 并非库的全集）。
 * 名称覆盖率若能从 63% 提到接近 100%，成交明细就不会大面积显示「—」。
 *
 * 不写库、不删库。
 *
 * 用法：npx tsx docs/evidence/_probe_name_tables.mts
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

const tables = unwrap(
  await db.execute(
    sql`SELECT table_name AS tableName, table_rows AS tableRows
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
        ORDER BY table_name`,
  ),
);
console.log(`=== 真实库表总数 = ${tables.length} ===`);
for (const t of tables) console.log("  ", t.tableName, "|rows≈", t.tableRows ?? "?");

const cols = unwrap(
  await db.execute(
    sql`SELECT table_name AS tableName, column_name AS columnName, data_type AS dataType
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND (LOWER(column_name) LIKE '%name%' OR LOWER(column_name) LIKE '%简称%')
        ORDER BY table_name, column_name`,
  ),
);
console.log(`\n=== 含 name 的列（共 ${cols.length}）===`);
for (const c of cols) console.log("  ", c.tableName, ".", c.columnName, "|", c.dataType);

console.log("\n[ok] 只读探针结束");
process.exit(0);
