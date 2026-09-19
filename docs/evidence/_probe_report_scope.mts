/**
 * PHASE-A-001 只读探针 —— 度量「一个已完成 Run 产出的报告规模」。
 *
 * 目的：确认把 markdown 正文内联进 `research_artifact.uri`（TEXT, 65535 bytes）
 * 是否安全，并确认 runId → datasetVersionId / patternId 的可达性。
 *
 * 用法：node node_modules/tsx/dist/cli.mjs docs/evidence/_probe_report_scope.mts
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

const runs = await q(sql`
  select r.id, r.experimentId, r.status, r.sampleCount, r.createdAt, r.completedAt,
         e.datasetVersionId, e.researchType, e.name as experimentName
  from research_run r
  left join research_experiment e on e.id = r.experimentId
  where r.status = 'COMPLETED'
  order by r.id desc
  limit 20
`);

const rows: Array<Record<string, unknown>> = [];
for (const run of runs) {
  const runId = Number(run["id"]);
  const [analysis] = await q(sql`
    select count(*) as total,
           sum(case when status = 'COMPLETED' then 1 else 0 end) as completed,
           group_concat(distinct analysisType) as types,
           group_concat(distinct moduleKey) as modules
    from research_analysis where runId = ${runId}
  `);
  const [result] = await q(sql`
    select count(*) as total,
           group_concat(distinct metricCode) as metricCodes,
           group_concat(distinct resultType) as resultTypes,
           coalesce(sum(char_length(coalesce(dimensionJson, ''))), 0) as dimensionChars
    from research_result where analysisId in (select id from research_analysis where runId = ${runId})
  `);
  const [finding] = await q(sql`
    select count(*) as total, group_concat(distinct findingType) as types
    from research_finding where runId = ${runId}
  `);
  const [conclusion] = await q(sql`
    select id, conclusionType, status, char_length(coalesce(conclusion, '')) as bodyChars,
           char_length(coalesce(evidenceSummary, '')) as evidenceChars,
           char_length(coalesce(researchQuestion, '')) as questionChars,
           char_length(coalesce(limitationsJson, '')) as limitChars,
           char_length(coalesce(nextQuestionsJson, '')) as nextChars,
           char_length(coalesce(evidenceJson, '')) as evidenceJsonChars,
           char_length(coalesce(findingIdsJson, '')) as findingIdsChars
    from research_conclusion where experimentId = ${run["experimentId"]}
    order by id desc limit 1
  `);

  // 结果的 JSON 体积（真正决定报告正文大小的量）
  const [jsonSize] = await q(sql`
    select coalesce(sum(char_length(coalesce(resultJson, ''))), 0) as payloadChars
    from research_result where analysisId in (select id from research_analysis where runId = ${runId})
  `);

  rows.push({
    runId,
    experimentId: run["experimentId"],
    experimentName: run["experimentName"],
    datasetVersionId: run["datasetVersionId"],
    researchType: run["researchType"],
    sampleCount: run["sampleCount"],
    completedAt: run["completedAt"],
    analysis: analysis,
    result: result,
    payloadChars: jsonSize?.["payloadChars"],
    finding: finding,
    conclusion: conclusion ?? null,
  });
}

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), completedRuns: rows }, null, 2));
process.exit(0);
