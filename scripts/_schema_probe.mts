/**
 * 一次性探针：导出当前数据库全量结构（表 + 字段 + 索引）+ ds_* 精确行数分布。
 * 只读，不写任何数据。
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { writeFileSync } from "node:fs";

function log(msg: string) {
  process.stdout.write(msg + "\n");
}

async function main() {
  const db = await getDb();
  if (!db) {
    log("no db");
    return;
  }

  const tablesRaw = await db.execute(
    sql.raw(`
SELECT TABLE_NAME AS name, TABLE_ROWS AS approxRows, TABLE_COMMENT AS comment
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME`),
  );

  const colsRaw = await db.execute(
    sql.raw(`
SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
       COLUMN_KEY AS ckey, COLUMN_DEFAULT AS def, EXTRA AS extra, COLUMN_COMMENT AS comment
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, ORDINAL_POSITION`),
  );

  const idxRaw = await db.execute(
    sql.raw(`
SELECT TABLE_NAME AS tbl, INDEX_NAME AS name, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seq,
       COLUMN_NAME AS col
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`),
  );

  const tables = (tablesRaw as any[])[0] as any[];
  const cols = (colsRaw as any[])[0] as any[];
  const idx = (idxRaw as any[])[0] as any[];

  log(`tables=${tables.length} columns=${cols.length} indexRows=${idx.length}`);

  // ds_* 精确行数 + relativeDay 分布
  const dsTables = (tables as any[])
    .map((t) => String(t.name))
    .filter((n) => n.startsWith("ds_"))
    .sort();
  log("ds tables: " + JSON.stringify(dsTables));

  const dsDetail: Record<string, any> = {};
  for (const t of dsTables) {
    const cnt = await db.execute(sql.raw(`SELECT COUNT(*) AS c FROM \`${t}\``));
    const detail: any = { rows: Number(((cnt as any[])[0] as any[])[0]?.c ?? 0) };
    if (t.endsWith("_path")) {
      const dist = await db.execute(
        sql.raw(
          `SELECT datasetVersionId AS v, MIN(relativeDay) AS mn, MAX(relativeDay) AS mx,
                  SUM(relativeDay < 0) AS negRows, SUM(relativeDay = 0) AS zeroRows, SUM(relativeDay > 0) AS posRows,
                  COUNT(*) AS total
           FROM \`${t}\` GROUP BY datasetVersionId ORDER BY datasetVersionId`,
        ),
      );
      detail.relativeDayByVersion = dist;
    }
    dsDetail[t] = detail;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    tables,
    columns: cols,
    indexes: idx,
    dsDetail,
  };
  writeFileSync("scripts/_schema_probe_out.json", JSON.stringify(out, null, 2), "utf8");
  log("wrote scripts/_schema_probe_out.json");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    process.stdout.write("ERR " + String(e).slice(0, 500) + "\n");
    process.exit(1);
  });
