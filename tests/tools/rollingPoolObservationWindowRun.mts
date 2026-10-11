/**
 * `FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003` · S5 预检 / 正式矩阵 Run 工具。
 *
 * ```bash
 * # S5 技术预检（真实 Dataset 端口 + 真实撮合；**不持久化**）——同时提供确定性的「重放 A」
 * node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs \
 *   tests/tools/rollingPoolObservationWindowRun.mts --mode precheck
 *
 * # S5 正式矩阵 Run（1005 账户；经既有 startRun 入口持久化 1 条 Run + 产物）——「重放 B」
 * node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs \
 *   tests/tools/rollingPoolObservationWindowRun.mts --mode formal
 * ```
 *
 * 纪律：只读 Dataset；预检只看账平 / 边界 / 资金 / 覆盖 / 确定性，**不据预检收益改规则**；
 * 正式 Run 只跑一次（A–E 五组 × 201 账户同处一个 Run）。
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { defaultExperimentRunner, defaultExperimentRunService } from "../../server/researchExperiments/defaults";

const EXPERIMENT_ID = "first-board-pullback/rolling-pool-observation-window";
const DATASET_VERSION_ID = 780_004;
const OUT_DIR = new URL("../../_scratch/fbp3/", import.meta.url);

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
console.log(`[obs-window] mode=${mode} dataset=${DATASET_VERSION_ID} experiment=${EXPERIMENT_ID}`);

if (mode === "precheck") {
  const runner = defaultExperimentRunner();
  const started = Date.now();
  const { outcome, artifactFiles } = await runner.runDetailed({
    experimentId: EXPERIMENT_ID,
    datasetVersionId: DATASET_VERSION_ID,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[obs-window] precheck runStatus=${outcome.runStatus} elapsed=${elapsed}s artifacts=${artifactFiles.length}`);
  const artifactDir = new URL("./precheck-artifacts/", OUT_DIR);
  mkdirSync(artifactDir, { recursive: true });
  for (const file of artifactFiles) {
    const body = typeof file.body === "string" ? file.body : Buffer.from(file.body);
    writeFileSync(new URL(file.name, artifactDir), body);
  }
  console.log(`[obs-window] datasetFacts=${JSON.stringify(outcome.execution.datasetFacts)}`);
  if (outcome.error !== null) {
    console.log(`[obs-window] error=${JSON.stringify(outcome.error)}`);
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
  console.log("[obs-window] wrote _scratch/fbp3/precheck-outcome.json");
} else if (mode === "formal") {
  const service = defaultExperimentRunService();
  const started = Date.now();
  const result = await service.execute({
    experimentId: EXPERIMENT_ID,
    datasetVersionId: DATASET_VERSION_ID,
  });
  console.log(`[obs-window] formal elapsed=${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`[obs-window] run=${JSON.stringify(result.run)}`);
  console.log(`[obs-window] runStatus=${result.outcome.runStatus}`);
  console.log(`[obs-window] datasetFacts=${JSON.stringify(result.outcome.execution.datasetFacts)}`);
  if (result.outcome.error !== null) {
    console.log(`[obs-window] error=${JSON.stringify(result.outcome.error)}`);
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
  console.log("[obs-window] wrote _scratch/fbp3/formal-run.json");
} else {
  console.error(`未知 mode=${mode}（支持 precheck / formal）`);
  process.exit(2);
}

process.exit(pendingExitCode);
