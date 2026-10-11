/**
 * `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` · S5 真实预检 / 正式对照 Run 工具。
 *
 * ```bash
 * # S5 技术预检（真实 Dataset 端口 + 真实撮合；**不持久化、不建 Run**）
 * node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs \
 *   tests/tools/rollingPoolEarlyEntryRun.mts --mode precheck
 *
 * # S5 正式对照 Run（经**已有 startRun 入口**持久化 1 条 Run + 产物）
 * node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs \
 *   tests/tools/rollingPoolEarlyEntryRun.mts --mode formal
 * ```
 *
 * 纪律：只读 Dataset；预检**只看**账平 / 边界 / 资金 / 确定性，**不据预检收益改规则**；
 * 正式 Run 只跑一次（R + 200 随机账户同处一个 Run）。
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { defaultExperimentRunner, defaultExperimentRunService } from "../../server/researchExperiments/defaults";

const EXPERIMENT_ID = "first-board-pullback/rolling-pool-early-entry-runner";
const DATASET_VERSION_ID = 780_004;
/** 预检片段的**事件扫描窗**（比决策窗往前留一段，使 2024-01-02 的池是满的）。 */
const PRECHECK_EVENT_WINDOW = { startDate: "2023-11-01", endDate: "2024-03-29" };
const OUT_DIR = new URL("../../_scratch/fbpool2/", import.meta.url);

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1]! : null;
}
function save(name: string, value: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(new URL(name, OUT_DIR), JSON.stringify(value, null, 2));
}

const mode = argValue("--mode") ?? "precheck";
let pendingExitCode = 0;
console.log(`[early-entry] mode=${mode} dataset=${DATASET_VERSION_ID} experiment=${EXPERIMENT_ID}`);

if (mode === "precheck") {
  const runner = defaultExperimentRunner();
  const started = Date.now();
  const { outcome, artifactFiles } = await runner.runDetailed({
    experimentId: EXPERIMENT_ID,
    datasetVersionId: DATASET_VERSION_ID,
    evaluationWindow: PRECHECK_EVENT_WINDOW,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[early-entry] precheck runStatus=${outcome.runStatus} elapsed=${elapsed}s`);
  console.log(`[early-entry] artifactFiles=${artifactFiles.length}`);
  const artifactDir = new URL("./precheck-artifacts/", OUT_DIR);
  mkdirSync(artifactDir, { recursive: true });
  for (const file of artifactFiles) {
    const body = typeof file.body === "string" ? file.body : Buffer.from(file.body);
    writeFileSync(new URL(file.name, artifactDir), body);
  }
  console.log(`[early-entry] wrote ${artifactFiles.length} artifact(s) to _scratch/fbpool2/precheck-artifacts/`);
  console.log(`[early-entry] datasetFacts=${JSON.stringify(outcome.execution.datasetFacts)}`);
  if (outcome.error !== null) {
    console.log(`[early-entry] error=${JSON.stringify(outcome.error)}`);
    pendingExitCode = 1;
  }
  for (const line of outcome.execution.logs) console.log(`  ${line}`);
  save("precheck-outcome.json", {
    runStatus: outcome.runStatus,
    error: outcome.error,
    execution: outcome.execution,
    sampleSummary: outcome.result?.sampleSummary ?? null,
    tables: outcome.result?.tables ?? null,
    customPayload: outcome.result?.customPayload ?? null,
  });
} else if (mode === "formal") {
  const service = defaultExperimentRunService();
  const started = Date.now();
  const result = await service.execute({
    experimentId: EXPERIMENT_ID,
    datasetVersionId: DATASET_VERSION_ID,
  });
  console.log(`[early-entry] formal elapsed=${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`[early-entry] run=${JSON.stringify(result.run)}`);
  console.log(`[early-entry] runStatus=${result.outcome.runStatus}`);
  console.log(`[early-entry] datasetFacts=${JSON.stringify(result.outcome.execution.datasetFacts)}`);
  if (result.outcome.error !== null) {
    console.log(`[early-entry] error=${JSON.stringify(result.outcome.error)}`);
    pendingExitCode = 1;
  }
  for (const line of result.outcome.execution.logs) console.log(`  ${line}`);
  save("formal-run.json", {
    run: result.run,
    runStatus: result.outcome.runStatus,
    error: result.outcome.error,
    execution: {
      startedAt: result.outcome.execution.startedAt,
      finishedAt: result.outcome.execution.finishedAt,
      durationMs: result.outcome.execution.durationMs,
      datasetFacts: result.outcome.execution.datasetFacts,
      logs: result.outcome.execution.logs,
    },
    sampleSummary: result.outcome.result?.sampleSummary ?? null,
    tables: result.outcome.result?.tables ?? null,
    customPayload: result.outcome.result?.customPayload ?? null,
  });
} else {
  console.error(`未知 mode=${mode}（支持 precheck / formal）`);
  process.exit(2);
}

process.exit(pendingExitCode);
