/**
 * 只读探针：为「Research Planner（自动研究编排层）」取证。
 *
 * 回答三个问题（全部要真实库 / 真实变量目录，不猜）：
 *   ① 生产里既有的「首板回踩」分析**实际用的条件字段名**是什么（= Planner 必须对齐的词汇表）；
 *   ② 目标 Dataset Version 的**真实视界**（outcome.horizon / path.relativeDay / post.relativeDay）；
 *   ③ 该版本变量目录里**回调族 + 守护族 + 分位候选特征**的真实名字。
 *
 * 只做 SELECT；不写任何表。
 * 运行：npx tsx docs/evidence/_probe_research_planner_baseline.mts
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";
import { ResearchVariableCatalog } from "../../server/researchEngine/variables";
import { RegistryResearchDatasetReader } from "../../server/researchEngine/datasetReader";

const DV = Number(process.env.PROBE_DATASET_VERSION_ID ?? 390002);

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

async function rows<T = Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db!.execute(q)) as unknown as [T[]];
  return r[0] ?? [];
}

console.log(`=== [1] 既有「回踩/破位」分析的条件字段（Dataset ${DV} 相关 Run）===`);
const conds = await rows(
  sql`select c.analysisId, c.groupNo, c.sortOrder, c.fieldName, c.operator,
             cast(c.valueJson as char) as valueJson, a.analysisType, a.target, a.name
        from research_analysis_condition c
        join research_analysis a on a.id = c.analysisId
       where a.name like '%回踩%' or a.name like '%回撤%' or a.name like '%破位%'
       order by c.analysisId desc, c.groupNo, c.sortOrder limit 120`,
);
const byAnalysis = new Map<number, string[]>();
for (const r of conds) {
  const id = Number(r["analysisId"]);
  const line = `  g${r["groupNo"]}.s${r["sortOrder"]}  ${r["fieldName"]} ${r["operator"]} ${r["valueJson"]}`;
  const list = byAnalysis.get(id) ?? [];
  list.push(line);
  byAnalysis.set(id, list);
}
for (const [id, list] of byAnalysis) {
  const meta = conds.find((r) => Number(r["analysisId"]) === id)!;
  console.log(`\n#${id} [${meta["analysisType"]}] target=${meta["target"]}`);
  console.log(`  name=${meta["name"]}`);
  for (const l of list) console.log(l);
}

console.log(`\n=== [2] Dataset Version ${DV} 真实视界 ===`);
const reader = new RegistryResearchDatasetReader();
const ctx = await reader.getVersionContext(DV);
if (!ctx) {
  console.log(`未找到 Dataset Version ${DV}`);
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      datasetVersionId: ctx.datasetVersionId,
      datasetCode: ctx.datasetCode,
      version: ctx.version,
      horizons: ctx.horizons,
      pathRelativeDayRange: ctx.pathRelativeDayRange,
      postRelativeDayRange: ctx.postRelativeDayRange,
    },
    null,
    2,
  ),
);

const pathHorizons = ctx.pathRelativeDayRange
  ? Array.from({ length: ctx.pathRelativeDayRange.max }, (_, i) => i + 1)
  : [];
const postHorizons = ctx.postRelativeDayRange
  ? Array.from(
      { length: ctx.postRelativeDayRange.max - ctx.postRelativeDayRange.min + 1 },
      (_, i) => ctx.postRelativeDayRange!.min + i,
    )
  : [];
const catalog = new ResearchVariableCatalog(ctx.horizons, pathHorizons, postHorizons);

console.log(`\n=== [3] 变量目录（Dataset ${DV}）===`);
console.log(`FEATURE 共 ${catalog.listFeatures().length} 个：`);
console.log(`  ${catalog.listFeatures().map((v) => v.name).join(", ")}`);
console.log(`\nOUTCOME 共 ${catalog.listOutcomes().length} 个：`);
console.log(`  ${catalog.listOutcomes().map((v) => v.name).join(", ")}`);
const obs = catalog.listObservations();
console.log(`\nOBSERVATION 共 ${obs.length} 个（前 40）：`);
console.log(`  ${obs.slice(0, 40).map((v) => v.name).join(", ")}`);

console.log(`\n=== [3b] Planner 关心的族是否可用 ===`);
const probes = [
  "holds_event_low_5d",
  "holds_event_open_5d",
  "event_low_margin_5d",
  "event_open_margin_5d",
  "pullback_close_ratio_5d",
  "pullback_min_volume_ratio_5d",
  "pullback_last_is_bullish_5d",
  "pullback_holds_event_low_5d",
  "pullback_min_low_5d",
  "pullback_max_high_5d",
  "future_return_5d",
  "future_return_10d",
  "is_breakout_5d",
  "max_drawdown_5d",
  "turnover",
  "event_open_offset",
];
for (const name of probes) {
  const asOutcome = catalog.hasOutcome(name);
  const asFeature = catalog.hasFeature(name);
  const asObs = catalog.hasObservation(name);
  console.log(
    `  ${name.padEnd(30)} outcome=${asOutcome ? "Y" : "-"} feature=${asFeature ? "Y" : "-"} observation=${asObs ? "Y" : "-"}`,
  );
}

console.log(`\n=== [4] research_finding 现状（plan 聚合阶段的输入形态）===`);
const findings = await rows(
  sql`select experimentId, runId, count(*) as c,
             sum(case when status='DISCOVERED' then 1 else 0 end) as discovered
        from research_finding group by experimentId, runId order by runId desc limit 20`,
);
console.log(JSON.stringify(findings, null, 2));

process.exit(0);
