/**
 * 孤儿残骸详情（**只读**，STEP 0-1 取证用）：
 * 回答「全库这些非终态 research_run / research_analysis 到底是什么，
 * 以及它们究竟有没有被执行过」——回收判据必须建立在事实之上，不能靠推断。
 *
 * 决定性证据：
 *   - `research_run.inputSnapshotJson` 只在**首次执行时**落定（schema 注释：冻结快照）。
 *     ⇒ 非终态 Run 的该列若为 NULL，说明它**从未进入执行**（合法地停在「建了计划未执行」），
 *       而不是「执行中被进程重启杀死」。二者处置完全不同：
 *         从未执行 → **不该**回收成 FAILED（用户可能随时点执行）；
 *         执行中被杀 → 是孤儿，必须收敛成终态。
 *   - `research_analysis` 无同类快照，改用「父 Run 是否已终态」+「是否有 result 行」判定。
 *
 * 用法：node --import tsx docs/evidence/_probe_orphan_detail.mts
 * 输出同步落盘到 _probe_orphan_detail.out.txt（异步 pipe 被杀时未 flush ⇒ 空 stdout）。
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const OUT = "docs/evidence/_probe_orphan_detail.out.txt";
const lines: string[] = [];
const say = (s = "") => {
  lines.push(s);
  process.stdout.write(s + "\n");
};

const db = await getDb();
if (!db) {
  say(JSON.stringify({ dbAvailable: false }));
  writeFileSync(OUT, lines.join("\n"), "utf8");
  process.exit(1);
}

/** db.execute 的返回形状：[[rows], fields] / [rows]。只取第一段。 */
async function q(statement: unknown): Promise<Array<Record<string, unknown>>> {
  const res = await db!.execute(statement as never);
  const first = (res as unknown as unknown[])[0];
  return Array.isArray(first) ? (first as Array<Record<string, unknown>>) : [];
}

const runStatusAll = await q(sql`
  select status, count(*) as c from research_run group by status order by status`);
const analysisStatusAll = await q(sql`
  select status, count(*) as c from research_analysis group by status order by status`);

/** 非终态 Run：带「是否执行过」的决定性证据。 */
const nonTerminalRuns = await q(sql`
  select r.id, r.experimentId, r.runNo, r.status,
         r.inputSnapshotJson is not null as hasSnapshot,
         r.executionLogJson is not null as hasExecLog,
         r.sampleCount, r.startedAt, r.completedAt, r.errorCode, r.errorMessage, r.createdAt,
         e.status as experimentStatus, e.name as experimentName, e.datasetVersionId
  from research_run r
  left join research_experiment e on e.id = r.experimentId
  where r.status not in ('COMPLETED','FAILED','CANCELLED')
  order by r.id`);

/** 非终态 Analysis：带父 Run / 父 Experiment 状态 + 结果行数。 */
const nonTerminalAnalyses = await q(sql`
  select a.id, a.runId, a.status, a.analysisType, a.name, a.planId, a.moduleKey,
         a.createdAt, a.completedAt,
         r.status as runStatus, r.experimentId,
         (select count(*) from research_result rr where rr.analysisId = a.id) as resultRows
  from research_analysis a
  left join research_run r on r.id = a.runId
  where a.status not in ('COMPLETED','FAILED','CANCELLED')
  order by a.id`);

/**
 * 涉及到的 Experiment 全景：它一共有几个 Run、各自状态、各自 Analysis 状态分布。
 * 用于回答「收掉这条 Run 会不会把一个本来正常的实验弄坏」。
 */
const involvedExperimentIds = [
  ...new Set([
    ...nonTerminalRuns.map((r) => Number(r["experimentId"])),
    ...nonTerminalAnalyses.map((a) => Number(a["experimentId"])),
  ]),
].filter((n) => Number.isFinite(n) && n > 0);

const experiments: Array<Record<string, unknown>> = [];
for (const experimentId of involvedExperimentIds) {
  const runs = await q(sql`
    select r.id, r.runNo, r.status,
           r.inputSnapshotJson is not null as hasSnapshot,
           r.startedAt, r.completedAt, r.createdAt,
           (select count(*) from research_analysis a where a.runId = r.id) as analyses,
           (select count(*) from research_analysis a where a.runId = r.id and a.status = 'COMPLETED') as completedAnalyses
    from research_run r where r.experimentId = ${experimentId} order by r.runNo`);
  const experiment = await q(sql`
    select id, name, status, datasetVersionId, sampleCount, startedAt, completedAt, createdAt
    from research_experiment where id = ${experimentId}`);
  experiments.push({ experimentId, experiment: experiment[0] ?? null, runs });
}

say("=== research_run 状态分布（全库） ===");
say(JSON.stringify(runStatusAll));
say("=== research_analysis 状态分布（全库） ===");
say(JSON.stringify(analysisStatusAll));
say("=== 非终态 Run（hasSnapshot = 是否执行过） ===");
say(JSON.stringify(nonTerminalRuns, null, 2));
say("=== 非终态 Analysis（父 Run 状态 + 结果行数） ===");
say(JSON.stringify(nonTerminalAnalyses, null, 2));
say("=== 涉及 Experiment 全景 ===");
say(JSON.stringify(experiments, null, 2));
say(`=== 结论 ===`);
say(`非终态 Run = ${nonTerminalRuns.length}，其中 hasSnapshot=true（执行过）= ${nonTerminalRuns.filter((r) => r["hasSnapshot"] === 1 || r["hasSnapshot"] === true).length}`);
say(`非终态 Analysis = ${nonTerminalAnalyses.length}，其中父 Run 已终态（真孤儿）= ${nonTerminalAnalyses.filter((a) => a["runStatus"] && !["RUNNING", "PENDING"].includes(String(a["runStatus"]))).length}`);

writeFileSync(OUT, lines.join("\n"), "utf8");
process.exit(0);
