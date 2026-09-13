/**
 * 在途检查（动手前必跑）：research_run / research_analysis 是否有 RUNNING/PENDING。
 *
 * 用途：`tsx watch` 下改任何 `server/**` 都会热重启并杀死在途 Run（永久卡 RUNNING、无恢复入口）。
 * 本探针只读，用于判定「现在能不能安全改 server」。
 *
 * 用法：npx tsx docs/evidence/_probe_inflight_state.mts
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

const runRows = await db.execute(
  sql`select status, count(*) as c from research_run group by status order by status`,
);
const analysisRows = await db.execute(
  sql`select status, count(*) as c from research_analysis group by status order by status`,
);
const pendingAnalysis = await db.execute(
  sql`select id, runId, status, createdAt, completedAt from research_analysis
      where status <> 'COMPLETED' order by id desc limit 20`,
);

const runs = (runRows as unknown as [Array<Record<string, unknown>>])[0] ?? [];
const analyses = (analysisRows as unknown as [Array<Record<string, unknown>>])[0] ?? [];
const pending = (pendingAnalysis as unknown as [Array<Record<string, unknown>>])[0] ?? [];

const inFlightRuns = runs
  .filter((r) => r["status"] === "RUNNING" || r["status"] === "PENDING")
  .reduce((sum, r) => sum + Number(r["c"] ?? 0), 0);
const inFlightAnalyses = analyses
  .filter((a) => a["status"] === "RUNNING" || a["status"] === "PENDING")
  .reduce((sum, a) => sum + Number(a["c"] ?? 0), 0);

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      researchRunByStatus: runs,
      researchAnalysisByStatus: analyses,
      nonCompletedAnalyses: pending,
      inFlightRunCount: inFlightRuns,
      inFlightAnalysisCount: inFlightAnalyses,
    },
    null,
    2,
  ),
);
process.exit(0);
