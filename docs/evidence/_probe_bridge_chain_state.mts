/**
 * 探针：RESEARCH-STRATEGY-BRIDGE 全链路现状（只读，真库）。
 *
 * 目的：审计任务 §12 要求的 13 级链路「每一级真实存在什么」。
 * 纪律：**列名一律由 information_schema 驱动**（禁凭记忆写列名）；行数用 COUNT(*)；
 *       明细只打印「坐标列 + 长度」以免刷屏。缺表要显式报 MISSING，不得静默跳过。
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const TABLES = [
  "dataset_version",
  "dataset_definition",
  "research_experiment",
  "research_run",
  "research_analysis",
  "research_result",
  "research_conclusion",
  "research_strategy_candidate",
  "strategy_research_provenance",
  "strategies",
  "strategy_versions",
  "strategy_parameters",
  "strategy_entry_rules",
  "strategy_exit_rules",
  "strategy_execution_rules",
  "strategy_version_datasets",
] as const;

const conn = await createConnection(process.env.DATABASE_URL as string);

async function columnsOf(table: string): Promise<string[] | null> {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    [table],
  );
  const list = (rows as Array<{ c: string }>).map((r) => r.c);
  return list.length === 0 ? null : list;
}

async function countOf(table: string): Promise<number | string> {
  try {
    const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    return Number((rows as Array<{ n: number | string }>)[0].n);
  } catch (err) {
    return `ERR:${(err as Error).message.slice(0, 80)}`;
  }
}

console.log("=== 0. 表存在性与行数 ===");
const cols: Record<string, string[]> = {};
for (const t of TABLES) {
  const c = await columnsOf(t);
  if (c === null) {
    console.log(`${t} : MISSING`);
    continue;
  }
  cols[t] = c;
  console.log(`${t} : rows=${await countOf(t)}`);
  console.log(`    cols=${c.join(", ")}`);
}

function pick(table: string, wanted: string[]): string[] {
  const have = cols[table] ?? [];
  return wanted.filter((w) => have.includes(w));
}

console.log("\n=== 1. dataset_version（数据源）===");
if (cols.dataset_version) {
  const sel = pick("dataset_version", ["id", "datasetId", "version", "status", "startDate", "endDate", "createdAt"]);
  const [rows] = await conn.query(`SELECT ${sel.map((c) => `\`${c}\``).join(", ")} FROM dataset_version ORDER BY id`);
  for (const r of rows as Array<Record<string, unknown>>) console.log("  " + JSON.stringify(r));
}

console.log("\n=== 2. research_experiment（实验 = 研究输入边界）===");
if (cols.research_experiment) {
  const sel = pick("research_experiment", ["id", "name", "status", "datasetVersionId", "createdAt"]);
  const [rows] = await conn.query(`SELECT ${sel.map((c) => `\`${c}\``).join(", ")} FROM research_experiment ORDER BY id`);
  for (const r of rows as Array<Record<string, unknown>>) console.log("  " + JSON.stringify(r));
}

console.log("\n=== 3. research_run（每个实验的 Run 数与状态）===");
if (cols.research_run) {
  const [rows] = await conn.query(
    "SELECT experimentId, status, COUNT(*) AS n, MIN(id) AS minId, MAX(id) AS maxId FROM research_run GROUP BY experimentId, status ORDER BY experimentId, status",
  );
  for (const r of rows as Array<Record<string, unknown>>) console.log("  " + JSON.stringify(r));
}

console.log("\n=== 4. research_analysis / research_result（按 Run 聚合）===");
if (cols.research_analysis) {
  const [rows] = await conn.query(
    "SELECT runId, COUNT(*) AS n, SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS done FROM research_analysis GROUP BY runId ORDER BY runId",
  );
  for (const r of rows as Array<Record<string, unknown>>) console.log("  analysis " + JSON.stringify(r));
}
if (cols.research_result) {
  const [rows] = await conn.query("SELECT COUNT(*) AS n FROM research_result");
  console.log("  research_result 总行数 = " + JSON.stringify(rows));
}

console.log("\n=== 5. research_conclusion（结论：取最近 10 条）===");
if (cols.research_conclusion) {
  const sel = pick("research_conclusion", ["id", "experimentId", "title", "summary", "status", "createdAt"]);
  const [rows] = await conn.query(`SELECT ${sel.map((c) => `\`${c}\``).join(", ")} FROM research_conclusion ORDER BY id DESC LIMIT 10`);
  for (const r of rows as Array<Record<string, unknown>>) {
    const row = r as Record<string, unknown>;
    const brief: Record<string, unknown> = {};
    for (const k of Object.keys(row)) {
      const v = row[k];
      brief[k] = typeof v === "string" && v.length > 70 ? `${v.slice(0, 70)}…(${v.length})` : v;
    }
    console.log("  " + JSON.stringify(brief));
  }
}

console.log("\n=== 6. research_strategy_candidate（候选：全部）===");
if (cols.research_strategy_candidate) {
  const sel = pick("research_strategy_candidate", [
    "id", "name", "status", "experimentId", "conclusionId",
    "sourceResearchRunId", "sourceDatasetVersionId", "sourceDatasetDivergenceReason",
    "sourceTraceJson", "entryRuleJson", "filterRuleJson", "exitRuleJson", "riskRuleJson",
    "parameterSpaceJson", "strategyDefinitionId", "createdAt", "updatedAt",
  ]);
  const [rows] = await conn.query(`SELECT ${sel.map((c) => `\`${c}\``).join(", ")} FROM research_strategy_candidate ORDER BY id`);
  for (const r of rows as Array<Record<string, unknown>>) {
    const row = r as Record<string, unknown>;
    const brief: Record<string, unknown> = {};
    for (const k of Object.keys(row)) {
      const v = row[k];
      if (typeof v === "string" && v.length > 60) brief[k] = `<len ${v.length}> ${v.slice(0, 60)}…`;
      else brief[k] = v;
    }
    console.log("  " + JSON.stringify(brief));
  }
  const [trace] = await conn.query(
    "SELECT id, LENGTH(sourceTraceJson) AS traceLen, sourceTraceJson FROM research_strategy_candidate ORDER BY id DESC LIMIT 1",
  );
  const t0 = (trace as Array<Record<string, unknown>>)[0];
  if (t0) {
    console.log("\n  最新候选 sourceTraceJson 全文：");
    console.log("  " + String(t0.sourceTraceJson));
  }
}

console.log("\n=== 7. strategy_research_provenance（溯源切面）===");
if (cols.strategy_research_provenance) {
  const [rows] = await conn.query("SELECT * FROM strategy_research_provenance ORDER BY id");
  for (const r of rows as Array<Record<string, unknown>>) {
    const row = r as Record<string, unknown>;
    const brief: Record<string, unknown> = {};
    for (const k of Object.keys(row)) {
      const v = row[k];
      if (typeof v === "string" && v.length > 60) brief[k] = `<len ${v.length}>`;
      else brief[k] = v;
    }
    console.log("  " + JSON.stringify(brief));
  }
}

console.log("\n=== 8. strategies / strategy_versions ===");
if (cols.strategies) {
  const sel = pick("strategies", ["id", "name", "code", "status", "createdAt"]);
  const [rows] = await conn.query(`SELECT ${sel.map((c) => `\`${c}\``).join(", ")} FROM strategies ORDER BY id`);
  for (const r of rows as Array<Record<string, unknown>>) console.log("  strategy " + JSON.stringify(r));
}
if (cols.strategy_versions) {
  const sel = pick("strategy_versions", ["id", "strategyId", "version", "status", "datasetId", "datasetVersionId", "createdAt"]);
  const [rows] = await conn.query(`SELECT ${sel.map((c) => `\`${c}\``).join(", ")} FROM strategy_versions ORDER BY id`);
  for (const r of rows as Array<Record<string, unknown>>) console.log("  version " + JSON.stringify(r));
}

console.log("\n=== 9. 投影表（按 strategyVersionId 聚合）===");
for (const t of ["strategy_parameters", "strategy_entry_rules", "strategy_exit_rules", "strategy_execution_rules", "strategy_version_datasets"] as const) {
  if (!cols[t]) { console.log(`  ${t} : MISSING`); continue; }
  const idCol = cols[t].includes("strategyVersionId") ? "strategyVersionId" : null;
  if (!idCol) { console.log(`  ${t} : 无 strategyVersionId 列（cols=${cols[t].join(",")}）`); continue; }
  const [rows] = await conn.query(`SELECT \`${idCol}\` AS v, COUNT(*) AS n FROM \`${t}\` GROUP BY \`${idCol}\` ORDER BY v`);
  for (const r of rows as Array<Record<string, unknown>>) console.log(`  ${t} ` + JSON.stringify(r));
}

await conn.end();
process.exit(0);
