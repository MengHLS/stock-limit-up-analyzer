/**
 * RESEARCH-007 — 执行 Run 510001 并把结果落成可读清单（真实 TiDB）。
 *
 * 用法：npx tsx _r007_run_engine.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { researchEngineRouter } from "../../server/researchEngineRouter";

const EXPERIMENT_ID = 240002;
const RUN_ID = 510001;

async function main(): Promise<void> {
  const caller = researchEngineRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: { id: 1, role: "admin", name: "r007" } as never,
  });

  const t0 = Date.now();
  const execution = await caller.runEngine({ experimentId: EXPERIMENT_ID, runId: RUN_ID });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  const lines: string[] = [];
  lines.push(`# Run ${RUN_ID} 执行结果（耗时 ${seconds}s）`);
  lines.push("");
  lines.push("## execution");
  lines.push(JSON.stringify(execution, null, 2).slice(0, 4000));

  const run = await caller.getRun({ runId: RUN_ID });
  lines.push("");
  lines.push(`## run.status = ${run.run.status}, sampleCount = ${run.run.sampleCount}`);
  lines.push(`## executionLog = ${JSON.stringify(run.run.executionLog)}`);

  lines.push("");
  lines.push("## 逐分析结果");
  for (const a of run.analyses) {
    const rows = await caller.getAnalysisResults({ analysisId: a.id! });
    lines.push("");
    lines.push(`### #${a.id} ${a.analysisType} — ${a.name}  [${a.status}] rows=${rows.length}`);
    for (const r of rows) {
      lines.push(
        `  ${r.resultType} | ${r.metricCode} | value=${r.metricValue ?? "null"} | n=${r.sampleCount ?? "null"} | dim=${JSON.stringify(r.dimension ?? null)}`,
      );
    }
  }

  const conclusions = await caller.listConclusions({ experimentId: EXPERIMENT_ID });
  lines.push("");
  lines.push(`## conclusions (${conclusions.length})`);
  for (const c of conclusions) {
    lines.push(`- #${c.id} ${c.conclusionType} confidence=${c.confidence} :: ${c.title}`);
  }

  writeFileSync("_r007_run_result.md", lines.join("\n"));
  console.log(`done in ${seconds}s`, "written _r007_run_result.md");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
