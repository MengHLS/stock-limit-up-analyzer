/**
 * 探针：厘清两套 dataset 表的真实关系（Registry vs legacy），为「运行策略真跑通」选入口。
 * 只读。
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const u = new URL(process.env.DATABASE_URL!);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ""),
  ssl: { rejectUnauthorized: false },
});

const out: Record<string, unknown> = {};
async function q(label: string, sql: string) {
  try {
    const [rows] = await conn.execute(sql);
    out[label] = rows;
  } catch (e) {
    out[label] = { error: String((e as Error).message).slice(0, 200) };
  }
}

// 两套表的列
for (const t of ["dataset_version", "dataset_definition", "research_datasets"]) {
  await q(
    `cols_${t}`,
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='${t}' ORDER BY ORDINAL_POSITION`,
  );
}
// research_experiments 真实列名
await q(
  "cols_research_experiments",
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='research_experiments' ORDER BY ORDINAL_POSITION",
);
// Registry 内容
await q(
  "dataset_definition_rows",
  "SELECT id, datasetCode FROM dataset_definition ORDER BY id",
);
await q(
  "dataset_version_rows",
  "SELECT id, datasetId, version, status FROM dataset_version ORDER BY id",
);
// research_experiments 内容（用真实列）
await q(
  "research_experiments_rows",
  "SELECT * FROM research_experiments ORDER BY id LIMIT 5",
);
// dataset_build_config（003B 筛选固化）
await q(
  "cols_dataset_build_config",
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dataset_build_config' ORDER BY ORDINAL_POSITION",
);

const brief: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
};
for (const [k, v] of Object.entries(out)) {
  if (k.startsWith("cols_")) {
    brief[k] = (v as Array<{ COLUMN_NAME: string }>)?.map?.((c) => c.COLUMN_NAME);
  } else if (k === "research_experiments_rows") {
    // 只显示键名，避免巨型 JSON
    const rows = v as Array<Record<string, unknown>>;
    brief[k] = {
      count: rows.length,
      keys: rows[0] ? Object.keys(rows[0]) : [],
      sample: rows.map((r) => ({
        id: r.id,
        datasetVersionId: r.datasetVersionId,
        status: r.status,
      })),
    };
  } else {
    brief[k] = v;
  }
}
writeFileSync(
  "docs/evidence/_probe_dataset_relation.json",
  JSON.stringify(brief, null, 2),
);
console.log(JSON.stringify(brief, null, 2));
await conn.end();
process.exit(0);
