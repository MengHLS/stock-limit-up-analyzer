/**
 * RESEARCH-FINDING-001 Phase A —— 只读架构审计探针（**不写任何表**）。
 *
 * 用途：把「审计」落到真库事实，而不是只读历史报告。回答四件事：
 *   ① 目标表在真实 DB 里到底存不存在、行数多少；
 *   ② `research_hypothesis` / `research_conclusion` / `research_strategy_candidate` 的**真实列**；
 *   ③ 是否存在任何 Finding 载体（表 / 列）；
 *   ④ `research_finding` 是否已存在（本任务是否真需要新建）。
 *
 * 同时捎带在途检查（改 `server/**` 前的硬前置，规则见 .workbuddy/memory/PROJECT_RULES.md）。
 *
 * 用法：npx tsx docs/evidence/_probe_research_finding_audit.mts
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

/** 只读白名单：本探针只允许对下列表做 count / describe。 */
const TABLES = [
  // 新 Research Core（RESEARCH-001/002 系）
  "research_experiment",
  "research_hypothesis",
  "research_run",
  "research_analysis",
  "research_analysis_condition",
  "research_analysis_metric",
  "research_result",
  "research_conclusion",
  "research_strategy_candidate",
  "research_artifact",
  "research_analysis_template",
  "research_analysis_template_item",
  // legacy（STEP 6.x / 12.6，复数）
  "research_experiments",
  "research_runs",
  "research_experiment_batches",
  "research_datasets",
  // 本任务候选新增
  "research_finding",
] as const;

async function rows<T = Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db!.execute(q)) as unknown as [T[]];
  return r[0] ?? [];
}

async function tableExists(name: string): Promise<boolean> {
  const r = await rows<{ c: number }>(
    sql`select count(*) as c from information_schema.TABLES
        where TABLE_SCHEMA = database() and TABLE_NAME = ${name}`,
  );
  return Number(r[0]?.c ?? 0) > 0;
}

async function countOf(name: string): Promise<number | null> {
  if (!(TABLES as readonly string[]).includes(name)) return null;
  try {
    const r = await rows<{ c: number }>(sql`select count(*) as c from ${sql.raw("`" + name + "`")}`);
    return Number(r[0]?.c ?? 0);
  } catch {
    return null;
  }
}

async function describe(name: string) {
  return rows<{ COLUMN_NAME: string; COLUMN_TYPE: string; IS_NULLABLE: string; COLUMN_KEY: string }>(
    sql`select COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
        from information_schema.COLUMNS
        where TABLE_SCHEMA = database() and TABLE_NAME = ${name}
        order by ORDINAL_POSITION`,
  );
}

// ---- ① 表存在性 + 行数 ----
const tableState: Record<string, { exists: boolean; rowCount: number | null }> = {};
for (const t of TABLES) {
  const exists = await tableExists(t);
  tableState[t] = { exists, rowCount: exists ? await countOf(t) : null };
}

// ---- ② 三个待扩展表的真实列 ----
const hypothesisColumns = await describe("research_hypothesis");
const conclusionColumns = await describe("research_conclusion");
const candidateColumns = await describe("research_strategy_candidate");

// ---- ③ 是否存在任何 Finding 载体 ----
const findingLikeTables = await rows<{ TABLE_NAME: string }>(
  sql`select TABLE_NAME from information_schema.TABLES
      where TABLE_SCHEMA = database() and TABLE_NAME like '%finding%'`,
);
const findingLikeColumns = await rows<{ TABLE_NAME: string; COLUMN_NAME: string }>(
  sql`select TABLE_NAME, COLUMN_NAME from information_schema.COLUMNS
      where TABLE_SCHEMA = database() and COLUMN_NAME like '%finding%'`,
);

// ---- ④ 在途检查（改 server 的硬前置）----
const runByStatus = await rows(
  sql`select status, count(*) as c from research_run group by status order by status`,
);
const analysisByStatus = await rows(
  sql`select status, count(*) as c from research_analysis group by status order by status`,
);
const experimentByStatus = await rows(
  sql`select status, count(*) as c from research_experiment group by status order by status`,
);
const inFlight =
  runByStatus
    .filter((r) => r["status"] === "RUNNING" || r["status"] === "PENDING")
    .reduce((s, r) => s + Number(r["c"] ?? 0), 0) +
  analysisByStatus
    .filter((r) => r["status"] === "RUNNING" || r["status"] === "PENDING")
    .reduce((s, r) => s + Number(r["c"] ?? 0), 0);

// ---- 数据集：验收要用哪一份 ----
const datasetVersions = await rows(
  sql`select id, datasetId, version, status, startDate, endDate, totalEvents, totalRows
      from dataset_version order by id asc`,
);

// ---- 已产出的 Result / Conclusion 规模（Finding 的真实输入）----
const resultByType = await rows(
  sql`select resultType, count(*) as c from research_result group by resultType order by resultType`,
);
const metricTop = await rows(
  sql`select metricCode, count(*) as c from research_result group by metricCode order by c desc limit 20`,
);
const analysesByType = await rows(
  sql`select analysisType, count(*) as c from research_analysis group by analysisType order by c desc`,
);

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      dbAvailable: true,
      inFlight: { runOrAnalysisNotDone: inFlight, safeToEditServer: inFlight === 0 },
      tableState,
      findingCarrier: {
        tablesMatchingFinding: findingLikeTables.map((r) => r["TABLE_NAME"]),
        columnsMatchingFinding: findingLikeColumns.map((r) => `${r["TABLE_NAME"]}.${r["COLUMN_NAME"]}`),
      },
      hypothesisColumns,
      conclusionColumns,
      candidateColumns,
      lifecycle: { runByStatus, analysisByStatus, experimentByStatus },
      datasetVersions,
      resultShape: { resultByType, metricTop, analysesByType },
    },
    null,
    2,
  ),
);
process.exit(0);
