/**
 * RESEARCH-PLANNER-001 — 清理 E2E 试跑产物（**默认 dry-run**）。
 *
 * 为什么需要它：E2E 是「真跑」，会在真实库里留下 Question / Plan / Run / Analysis / Result /
 * Finding / Conclusion / Candidate。E2E 过程中修掉过一个真实缺陷（SEGMENT_RELATION 窗 A 不存在），
 * 那次失败的试跑产物没有任何研究价值，只会让页面列表多出一堆 `[自动研究] …` 噪音。
 *
 * 🔴 安全设计：
 *   - **默认 dry-run**，只打印将删除的行数；必须显式 `--apply` 才落刀。
 *   - 只认 `research_experiment.name like '[自动研究]%'` —— 这个前缀只可能来自 Research Planner
 *     （`deriveExperimentName`），因此**不可能误删用户手工建的实验**。
 *   - `--keep=<id,id>` 指定要保留的 experimentId（它是唯一坐标；question / plan / run / analysis
 *     全部由它派生）。
 *   - 已转正为策略的候选（`strategyDefinitionId is not null`）**不删**，并把它们列出来。
 *   - 按依赖顺序删；用子查询而不是先查 id 再拼 IN，避免「查完又新增」的竞态。
 *
 * 用法：
 *   npx tsx docs/evidence/_cleanup_research_planner_trials.mts                 # dry-run（列出计划）
 *   npx tsx docs/evidence/_cleanup_research_planner_trials.mts --keep=420001   # dry-run + 保留
 *   npx tsx docs/evidence/_cleanup_research_planner_trials.mts --keep=420001 --apply
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const keepArg = process.argv.find((a) => a.startsWith("--keep="));
const keep = (keepArg ? keepArg.slice("--keep=".length) : "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s !== "")
  .map((s) => Number(s))
  .filter((n) => Number.isInteger(n) && n > 0);
const keepSql = keep.length > 0 ? keep.join(",") : "0";

const out: string[] = [];
function say(line = "") {
  out.push(line);
}

say(`模式：${APPLY ? "APPLY（真正删除）" : "DRY-RUN（只列出）"}`);
say(`保留的 experimentId：${keep.length > 0 ? keep.join(", ") : "（无）"}`);

// ---- 命中范围（唯一判据：实验名前缀）----
const expRows = (await db.execute(sql`
  select id, name, status, datasetVersionId, createdAt
  from research_experiment
  where name like '[自动研究]%' and id not in (${sql.raw(keepSql)})
  order by id`)) as unknown as [Array<Record<string, unknown>>];
const experiments = expRows[0] ?? [];

const expIds = experiments.map((e) => Number(e["id"]));
const expSql = expIds.length > 0 ? expIds.join(",") : "0";
const keepExp = keep.length > 0
  ? ((await db.execute(sql`
      select id, name from research_experiment where id in (${sql.raw(keepSql)})`)) as unknown as [
      Array<Record<string, unknown>>,
    ])[0] ?? []
  : [];

say("");
say(`=== 命中（name like '[自动研究]%'）共 ${experiments.length} 个实验 ===`);
for (const e of experiments) {
  say(`  exp=${e["id"]} [${e["status"]}] ds=${e["datasetVersionId"]} ${e["createdAt"]} :: ${String(e["name"]).slice(0, 60)}`);
}
say("");
say(`=== 保留 ===`);
for (const e of keepExp) say(`  exp=${e["id"]} :: ${String(e["name"]).slice(0, 60)}`);

// ---- 派生对象计数 ----
const runIds = (await db.execute(sql`
  select id from research_run where experimentId in (${sql.raw(expSql)})`)) as unknown as [Array<Record<string, unknown>>];
const runSql = (runIds[0] ?? []).map((r) => Number(r["id"])).join(",") || "0";

const anIds = (await db.execute(sql`
  select id from research_analysis where runId in (${sql.raw(runSql)})`)) as unknown as [Array<Record<string, unknown>>];
const anSql = (anIds[0] ?? []).map((r) => Number(r["id"])).join(",") || "0";

const counts = (await db.execute(sql`
  select
    (select count(*) from research_question  where experimentId in (${sql.raw(expSql)})) q,
    (select count(*) from research_plan      where experimentId in (${sql.raw(expSql)})) p,
    (select count(*) from research_run       where experimentId in (${sql.raw(expSql)})) r,
    (select count(*) from research_analysis  where runId in (${sql.raw(runSql)})) a,
    (select count(*) from research_analysis_condition where analysisId in (${sql.raw(anSql)})) ac,
    (select count(*) from research_result    where analysisId in (${sql.raw(anSql)})) res,
    (select count(*) from research_finding   where experimentId in (${sql.raw(expSql)})) f,
    (select count(*) from research_conclusion where experimentId in (${sql.raw(expSql)})) c,
    (select count(*) from research_strategy_candidate where experimentId in (${sql.raw(expSql)})) cand,
    (select count(*) from research_strategy_candidate where experimentId in (${sql.raw(expSql)}) and strategyDefinitionId is not null) candPromoted
`)) as unknown as [Array<Record<string, unknown>>];
say("");
say("=== 将删除的行数 ===");
say(JSON.stringify(counts[0]?.[0], null, 2));

const promoted = (await db.execute(sql`
  select id, name, strategyDefinitionId from research_strategy_candidate
  where experimentId in (${sql.raw(expSql)}) and strategyDefinitionId is not null`)) as unknown as [
  Array<Record<string, unknown>>,
];
if ((promoted[0] ?? []).length > 0) {
  say("");
  say("⚠️ 以下是**已转正为策略**的候选 —— 不会被删除（保留其溯源）：");
  for (const c of promoted[0] ?? []) {
    say(`  candidate=${c["id"]} strategy=${c["strategyDefinitionId"]} :: ${c["name"]}`);
  }
}

if (!APPLY) {
  say("");
  say("（DRY-RUN 结束。加 --apply 才会真正删除。）");
  console.log(out.join("\n"));
  process.exit(0);
}

// ---- 真正删除：依赖顺序，子查询保证一致 ----
const steps: Array<[string, ReturnType<typeof sql>]> = [
  ["research_result", sql`delete from research_result where analysisId in (${sql.raw(anSql)})`],
  ["research_analysis_metric", sql`delete from research_analysis_metric where analysisId in (${sql.raw(anSql)})`],
  ["research_analysis_condition", sql`delete from research_analysis_condition where analysisId in (${sql.raw(anSql)})`],
  ["research_analysis", sql`delete from research_analysis where runId in (${sql.raw(runSql)})`],
  ["research_finding", sql`delete from research_finding where experimentId in (${sql.raw(expSql)})`],
  ["research_conclusion", sql`delete from research_conclusion where experimentId in (${sql.raw(expSql)})`],
  ["research_plan", sql`delete from research_plan where experimentId in (${sql.raw(expSql)})`],
  ["research_question", sql`delete from research_question where experimentId in (${sql.raw(expSql)})`],
  [
    "research_strategy_candidate",
    sql`delete from research_strategy_candidate where experimentId in (${sql.raw(expSql)}) and strategyDefinitionId is null`,
  ],
  ["research_artifact", sql`delete from research_artifact where experimentId in (${sql.raw(expSql)})`],
  ["research_hypothesis", sql`delete from research_hypothesis where experimentId in (${sql.raw(expSql)})`],
  ["research_run", sql`delete from research_run where experimentId in (${sql.raw(expSql)})`],
  ["research_experiment", sql`delete from research_experiment where id in (${sql.raw(expSql)})`],
];

say("");
say("=== 执行删除 ===");
for (const [label, stmt] of steps) {
  try {
    const r = (await db.execute(stmt)) as unknown as [{ affectedRows?: number }];
    say(`  ${label}: affectedRows=${r[0]?.affectedRows ?? "?"}`);
  } catch (e) {
    // 某些表可能不存在（历史遗留）—— 如实记录，不隐瞒
    say(`  ${label}: SKIPPED (${e instanceof Error ? e.message.slice(0, 90) : String(e)})`);
  }
}

// ---- 删除后断言 ----
const after = (await db.execute(sql`
  select
    (select count(*) from research_experiment where name like '[自动研究]%' and id not in (${sql.raw(keepSql)})) exp,
    (select count(*) from research_question where experimentId in (${sql.raw(expSql)})) q,
    (select count(*) from research_plan where experimentId in (${sql.raw(expSql)})) p,
    (select count(*) from research_run where experimentId in (${sql.raw(expSql)})) r,
    (select count(*) from research_analysis where runId in (${sql.raw(runSql)})) a,
    (select count(*) from research_result where analysisId in (${sql.raw(anSql)})) res
`)) as unknown as [Array<Record<string, unknown>>];
say("");
say("=== 删除后残留（应全为 0）===");
say(JSON.stringify(after[0]?.[0], null, 2));
const residual = after[0]?.[0] ?? {};
const pass = Object.values(residual).every((v) => Number(v) === 0);
say(pass ? "结论：✓ 清理完成，无残留" : "结论：✗ 仍有残留，需人工处理");

console.log(out.join("\n"));
process.exit(pass ? 0 : 2);
