/**
 * RESEARCH-007.3 — Run 540001 增量补跑（真实 TiDB）。
 *
 * 为什么用 `runIncremental` 而不是 `runEngine`：
 *   - `runEngine` = 整轮，会**覆盖该 Run 全部分析的结果**；
 *   - `runIncremental` = 只补算「尚无有效结果」的分析（PENDING/FAILED/CANCELLED），
 *     **不覆盖已 COMPLETED 的 135 条**，并复用 Run 冻结快照（Dataset Version + 日期窗口）
 *     ⇒ 新旧结果**可比**。
 *   - 代价（须如实登记）：增量批次**不生成结论**，结论仍是 480001 REJECTED 一条。
 *
 * 用法：npx tsx _r010_backfill_run.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { researchEngineRouter } from "../../server/researchEngineRouter";

const EXPERIMENT_ID = 240002;
const RUN_ID = 540001;
/** 本批新增的 45 条（`_r010_backfill_apply.mts --execute` 的产物）。 */
const NEW_IDS: number[] = Array.from({ length: 45 }, (_, i) => 510001 + i);

async function main(): Promise<void> {
  const caller = researchEngineRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: { id: 1, role: "admin", name: "r010" } as never,
  });

  const t0 = Date.now();
  const inc = await caller.runIncremental({ experimentId: EXPERIMENT_ID, runId: RUN_ID });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  const lines: string[] = [];
  lines.push(`# Run ${RUN_ID} 增量补跑结果（耗时 ${seconds}s）`);
  lines.push("");
  lines.push(`| 字段 | 值 |`);
  lines.push(`|---|---|`);
  lines.push(`| executionSequence | ${inc.executionSequence} |`);
  lines.push(`| basisSource | ${inc.basisSource} |`);
  lines.push(`| datasetVersionId | ${inc.datasetVersionId} |`);
  lines.push(`| sampleCount | ${inc.sampleCount} |`);
  lines.push(`| analysisCount（本批） | ${inc.analysisCount} |`);
  lines.push(`| resultCount（本批） | ${inc.resultCount} |`);
  lines.push(`| conclusionId | ${inc.conclusionId}（恒为 null） |`);
  lines.push(`| durationMs | ${inc.durationMs} |`);
  lines.push("");
  lines.push(`conclusionSkippedReason：${inc.conclusionSkippedReason}`);
  lines.push("");

  const run = await caller.getRun({ runId: RUN_ID });
  lines.push(`## run.status = ${run.run.status}，分析总数 = ${run.analyses.length}`);
  lines.push("");
  lines.push(`executionLog（最后 2 条）：`);
  const log = Array.isArray(run.run.executionLog) ? run.run.executionLog : [];
  lines.push("```json");
  lines.push(JSON.stringify(log.slice(-2), null, 2));
  lines.push("```");

  lines.push("");
  lines.push(`## 本批 45 条逐条结果`);
  lines.push("");
  lines.push(`| 分析 | 名称 | status | 行数 | 条件组样本 | 差值 | t | p |`);
  lines.push(`|---:|---|---|---:|---:|---:|---:|---:|`);
  for (const id of NEW_IDS) {
    const a = run.analyses.find((x) => x.id === id);
    const rows = await caller.getAnalysisResults({ analysisId: id });
    const cond = rows.filter((r) => (r.dimension as { group?: string } | null)?.group === "CONDITION");
    const scalar = rows.find((r) => r.resultType === "SCALAR" && r.metricCode === "DIFFERENCE");
    const t = rows.find((r) => r.resultType === "SCALAR" && r.metricCode === "T_STAT_DIFFERENCE");
    const p = rows.find((r) => r.resultType === "SCALAR" && r.metricCode === "P_VALUE_DIFFERENCE");
    const sample = cond.find((r) => r.metricCode === "SAMPLE_COUNT") ?? cond[0];
    const nf = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(4));
    lines.push(
      `| ${id} | ${a?.name ?? "?"} | ${a?.status ?? "?"} | ${rows.length} | ${sample?.metricValue ?? "—"} | ${nf(scalar?.metricValue)} | ${nf(t?.metricValue)} | ${nf(p?.metricValue)} |`,
    );
  }

  writeFileSync("_r010_backfill_run_result.md", lines.join("\n"));
  console.log(`done in ${seconds}s → _r010_backfill_run_result.md`);
  console.log(`analysisCount=${inc.analysisCount} resultCount=${inc.resultCount} run.status=${run.run.status}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
