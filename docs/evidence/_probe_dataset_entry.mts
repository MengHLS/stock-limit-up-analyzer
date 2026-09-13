/**
 * 探针：为「运行策略真跑通」摸清真实数据入口。
 * 只读。目标：
 *   1. research_experiment / research_run 的 datasetVersionId 现状
 *   2. research_datasets（legacy STEP 6.x）与 dataset_version（Registry）的真实内容
 *   3. 是否存在可直接复用的「已落库 ResearchDataset 构建请求」
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
    out[label] = { error: String((e as Error).message).slice(0, 300) };
  }
}

// 只取需要的列，避免巨型 JSON 列（versionSnapshotJson 百万字符）
await q(
  "experiments",
  "SELECT id, name, datasetVersionId, status FROM research_experiments ORDER BY id DESC LIMIT 10",
);
await q(
  "runs",
  "SELECT id, experimentId, status FROM research_runs ORDER BY id DESC LIMIT 10",
);
await q(
  "research_datasets_cols",
  "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='research_datasets' ORDER BY ORDINAL_POSITION",
);
await q(
  "research_datasets_brief",
  "SELECT id, name, datasetVersion, rowCount FROM research_datasets ORDER BY id DESC LIMIT 10",
);
await q(
  "dataset_version",
  "SELECT id, datasetId, version, status, label FROM dataset_version ORDER BY id DESC LIMIT 10",
);
await q(
  "dataset_definition",
  "SELECT id, datasetCode, name FROM dataset_definition ORDER BY id DESC LIMIT 10",
);

// 紧凑摘要（不落巨型字段）
const brief = {
  checkedAt: new Date().toISOString(),
  experiments: out.experiments,
  runs: out.runs,
  research_datasets_cols: (
    out.research_datasets_cols as Array<{ COLUMN_NAME: string }>
  )?.map((c) => c.COLUMN_NAME),
  research_datasets_brief: out.research_datasets_brief,
  dataset_version: out.dataset_version,
  dataset_definition: out.dataset_definition,
};
writeFileSync(
  "docs/evidence/_probe_dataset_entry.json",
  JSON.stringify(brief, null, 2),
);
console.log(JSON.stringify(brief, null, 2));
await conn.end();
process.exit(0);
