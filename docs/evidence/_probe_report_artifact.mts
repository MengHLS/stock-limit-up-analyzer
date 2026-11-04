/**
 * PHASE-A-001 只读探针 —— `research_artifact` 落库事实核对。
 *
 * 用途：为验收 A-1 / A-2 / A-3 / A-8 提供**可复核的原始证据**（不依赖前端渲染）。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs docs/evidence/_probe_report_artifact.mts
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

async function q(statement: ReturnType<typeof sql>): Promise<Array<Record<string, unknown>>> {
  const res = (await db!.execute(statement)) as unknown as [Array<Record<string, unknown>>];
  return res[0] ?? [];
}

const totals = await q(sql`
  select artifactType, storageType, count(*) as c
  from research_artifact group by artifactType, storageType order by artifactType
`);

/** 同一个 run 出现多份 REPORT 即为违反 A-1（应恒为 1）。 */
const perRun = await q(sql`
  select runId, count(*) as reportCount, group_concat(id order by id) as artifactIds,
         group_concat(distinct checksum) as checksums
  from research_artifact where artifactType = 'REPORT'
  group by runId order by runId
`);

const rows = await q(sql`
  select id, experimentId, runId, artifactType, storageType, uri, checksum,
         char_length(metadataJson) as metadataChars,
         json_unquote(json_extract(metadataJson, '$.datasetVersionId')) as datasetVersionId,
         json_unquote(json_extract(metadataJson, '$.conclusionId')) as conclusionId,
         json_unquote(json_extract(metadataJson, '$.generatorVersion')) as generatorVersion,
         json_unquote(json_extract(metadataJson, '$.patternId')) as patternId,
         json_unquote(json_extract(metadataJson, '$.patternIds')) as patternIds,
         json_unquote(json_extract(metadataJson, '$.report.format')) as reportFormat,
         json_unquote(json_extract(metadataJson, '$.report.bytes')) as reportBytes,
         json_length(json_extract(metadataJson, '$.analysisIds')) as analysisCount,
         json_length(json_extract(metadataJson, '$.findingIds')) as findingCount,
         json_unquote(json_extract(metadataJson, '$.unresolvedTraceFields')) as unresolved,
         createdAt
  from research_artifact order by id
`);

const runCoverage = await q(sql`
  select count(*) as completedRuns,
         sum(case when a.runId is null then 1 else 0 end) as completedRunsWithoutReport
  from research_run r
  left join (select distinct runId from research_artifact where artifactType = 'REPORT') a
    on a.runId = r.id
  where r.status = 'COMPLETED'
`);

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      artifactByType: totals,
      reportPerRun: perRun,
      rows,
      runCoverage: runCoverage[0] ?? null,
    },
    null,
    2,
  ),
);
process.exit(0);
