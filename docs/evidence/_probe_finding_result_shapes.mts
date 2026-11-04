/**
 * RESEARCH-FINDING-001 B4 —— 只读探针：`research_result` 的**真实形态**。
 *
 * 用途：Finding Engine 必须**确定性解析** Result 行，绝不能凭想象猜 dimension / details 结构。
 * 本探针按 analysisType 各取若干代表行，输出：
 *   analysisId / resultType / dimensionJson / metricCode / metricValue / sampleCount / details(截断)
 *
 * 同时给出每个实验的「分析类型 × 结果行数」矩阵，便于挑真实验收用的 Run。
 *
 * 用法：npx tsx docs/evidence/_probe_finding_result_shapes.mts
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

async function rows<T = Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db!.execute(q)) as unknown as [T[]];
  return r[0] ?? [];
}

// ① 实验 × Run 概况
const experiments = await rows(
  sql`select id, name, datasetVersionId, researchType, status from research_experiment order by id desc limit 10`,
);
const runs = await rows(
  sql`select id, experimentId, runNo, status, sampleCount from research_run order by id desc limit 12`,
);

// ② 每 Run 的分析类型 × 结果数
const perRun = await rows(
  sql`select a.runId, a.analysisType, count(distinct a.id) as analyses, count(r.id) as results
      from research_analysis a left join research_result r on r.analysisId = a.id
      group by a.runId, a.analysisType order by a.runId desc, a.analysisType`,
);

// ③ 按 analysisType 各取代表行（真实 dimension / details）
const TYPES = ["QUANTILE", "CONDITIONAL", "EVENT_STUDY", "STABILITY", "SEGMENT_RELATION", "DESCRIPTIVE"] as const;
const samples: Record<string, unknown[]> = {};
for (const t of TYPES) {
  const r = await rows(
    sql`select r.id, r.analysisId, r.resultType, r.dimensionJson, r.metricCode, r.metricValue, r.sampleCount,
               left(cast(r.resultJson as char), 420) as detailsHead
        from research_result r
        join research_analysis a on a.id = r.analysisId
        where a.analysisType = ${t}
        order by r.id desc limit 14`,
  );
  samples[t] = r;
}

// ④ 最新 Run 的分析清单（挑验收 Run 用）
const latestRunAnalyses = await rows(
  sql`select id, runId, analysisType, name, target, status
      from research_analysis
      where runId = (select max(id) from research_run)
      order by id`,
);

console.log(
  JSON.stringify(
    { generatedAt: new Date().toISOString(), experiments, runs, perRun, samples, latestRunAnalyses },
    null,
    2,
  ),
);
process.exit(0);
