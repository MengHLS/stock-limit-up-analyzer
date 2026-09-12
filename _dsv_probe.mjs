import "dotenv/config";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
const env = readFileSync(".env", "utf8");
const raw = env.match(/DATABASE_URL=(\S+)/)[1].replace(/["']/g, "");
const p = new URL(raw);
const conn = await mysql.createConnection({
  host: p.hostname, port: p.port === "" ? 4000 : Number(p.port),
  user: decodeURIComponent(p.username), password: decodeURIComponent(p.password),
  database: p.pathname.slice(1), ssl: { rejectUnauthorized: true }, connectTimeout: 15000,
});
const out = {};
const [defs] = await conn.query("SELECT id, datasetCode, name FROM dataset_definition ORDER BY id");
out.definitions = defs;
const [vers] = await conn.query("SELECT id, datasetId, version, status, totalEvents FROM dataset_version ORDER BY id");
out.versions = vers;
const [sv] = await conn.query("SELECT COUNT(*) AS n FROM strategy_versions");
const [svd] = await conn.query("SELECT COUNT(*) AS n FROM strategy_version_datasets");
out.strategyVersions = sv[0].n;
out.strategyVersionDatasets = svd[0].n;
const [cols] = await conn.query("SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('strategy_versions','strategy_version_datasets') AND COLUMN_NAME='datasetVersionId'");
out.columns = cols;
console.log(JSON.stringify(out, null, 2));
await conn.end();
process.exit(0);
