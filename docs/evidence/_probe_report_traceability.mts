/**
 * PHASE-A-001 只读探针 —— 报告溯源字段与数据库真身的**逐条交叉核对**（验收 A-3）。
 *
 * 验收 A-3 原文：
 *   > 报告可追溯到 Run / Experiment / Dataset / Analysis / Finding / Conclusion，
 *   > **不得出现伪造字段**。
 *
 * 本探针不信任 metadata 的自述，而是回到四张源表重算一遍，再逐项比对：
 *   - `metadata.analysisIds`  ⟷ `research_analysis where runId = ?`   （集合必须完全相等）
 *   - `metadata.findingIds`   ⟷ `research_finding  where runId = ?`   （集合必须完全相等）
 *   - `metadata.runId` / `experimentId` / `datasetVersionId` ⟷ run / experiment 真身
 *   - `metadata.conclusionId` ⟷ 独立按
 *       `evidenceJson.primaryAnalysis.analysisId → research_analysis.runId` 两跳重算
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs docs/evidence/_probe_report_traceability.mts
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

const artifacts = await q(sql`
  select id, runId, experimentId,
         json_extract(metadataJson, '$.analysisIds') as analysisIds,
         json_extract(metadataJson, '$.findingIds') as findingIds,
         json_unquote(json_extract(metadataJson, '$.runId')) as metaRunId,
         json_unquote(json_extract(metadataJson, '$.experimentId')) as metaExperimentId,
         json_unquote(json_extract(metadataJson, '$.datasetVersionId')) as metaDatasetVersionId,
         json_unquote(json_extract(metadataJson, '$.conclusionId')) as metaConclusionId,
         json_unquote(json_extract(metadataJson, '$.conclusionResolution')) as conclusionResolution
  from research_artifact
  where artifactType = 'REPORT'
  order by runId
`);

function numList(raw: unknown): number[] {
  if (raw === null || raw === undefined) return [];
  const s = typeof raw === "string" ? raw : JSON.stringify(raw);
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.map((x) => Number(x)) : [];
  } catch {
    return [];
  }
}

function sameSet(a: number[], b: number[]): boolean {
  const A = [...new Set(a)].sort((x, y) => x - y);
  const B = [...new Set(b)].sort((x, y) => x - y);
  return A.length === B.length && A.every((v, i) => v === B[i]);
}

const checks: Array<Record<string, unknown>> = [];
let allPass = true;

for (const art of artifacts) {
  const runId = Number(art.runId);

  const runRows = await q(sql`select id, experimentId, status from research_run where id = ${runId}`);
  const run = runRows[0];
  const expRows = await q(
    sql`select id, datasetVersionId from research_experiment where id = ${Number(run?.experimentId ?? -1)}`,
  );
  const experiment = expRows[0];

  const dbAnalysisRows = await q(sql`select id from research_analysis where runId = ${runId} order by id`);
  const dbFindingRows = await q(sql`select id from research_finding where runId = ${runId} order by id`);
  const dbAnalysisIds = dbAnalysisRows.map((r) => Number(r.id));
  const dbFindingIds = dbFindingRows.map((r) => Number(r.id));

  const metaAnalysisIds = numList(art.analysisIds);
  const metaFindingIds = numList(art.findingIds);

  // 独立重算结论归属（不复用服务层实现，避免「用被测代码验证被测代码」）
  const analysisIdSet = new Set(dbAnalysisIds);
  const conclusions = await q(
    sql`select id, evidenceJson from research_conclusion where experimentId = ${Number(experiment?.id ?? -1)} order by id desc`,
  );
  let expectedConclusionId: number | null = null;
  for (const c of conclusions) {
    let evidence: Record<string, unknown> | null = null;
    try {
      const raw = c.evidenceJson;
      evidence = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown> | null);
    } catch {
      evidence = null;
    }
    const primary = evidence && typeof evidence === "object" ? (evidence["primaryAnalysis"] as Record<string, unknown> | undefined) : undefined;
    const analysisId = primary ? primary["analysisId"] : null;
    if (typeof analysisId === "number" && analysisIdSet.has(analysisId)) {
      expectedConclusionId = Number(c.id);
      break; // 已按 id desc 排序 ⇒ 命中第一条即「id 最大者」，与服务层确定性口径一致
    }
  }
  const metaConclusionId =
    art.metaConclusionId === null || art.metaConclusionId === undefined || art.metaConclusionId === "null"
      ? null
      : Number(art.metaConclusionId);

  const result = {
    runId,
    artifactId: Number(art.id),
    analysisIdsMatch: sameSet(metaAnalysisIds, dbAnalysisIds),
    metaAnalysisCount: metaAnalysisIds.length,
    dbAnalysisCount: dbAnalysisIds.length,
    findingsIdsMatch: sameSet(metaFindingIds, dbFindingIds),
    metaFindingCount: metaFindingIds.length,
    dbFindingCount: dbFindingIds.length,
    runIdMatch: Number(art.metaRunId) === runId,
    experimentIdMatch: Number(art.metaExperimentId) === Number(run?.experimentId),
    datasetVersionIdMatch: Number(art.metaDatasetVersionId) === Number(experiment?.datasetVersionId),
    conclusionIdExpected: expectedConclusionId,
    conclusionIdInMetadata: metaConclusionId,
    conclusionIdMatch: expectedConclusionId === metaConclusionId,
    /** metadata 里出现的、DB 中并不存在的分析 id（伪造字段 = 非空） */
    forgedAnalysisIds: metaAnalysisIds.filter((x) => !dbAnalysisIds.includes(x)),
    /** metadata 里出现的、DB 中并不存在的 finding id（伪造字段 = 非空） */
    forgedFindingIds: metaFindingIds.filter((x) => !dbFindingIds.includes(x)),
    conclusionResolution: art.conclusionResolution,
  };
  const pass =
    result.analysisIdsMatch &&
    result.findingsIdsMatch &&
    result.runIdMatch &&
    result.experimentIdMatch &&
    result.datasetVersionIdMatch &&
    result.conclusionIdMatch &&
    result.forgedAnalysisIds.length === 0 &&
    result.forgedFindingIds.length === 0;
  if (!pass) allPass = false;
  checks.push({ ...result, pass });
}

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      reportArtifactsChecked: checks.length,
      allPass,
      checks,
    },
    null,
    2,
  ),
);
process.exit(allPass ? 0 : 1);
