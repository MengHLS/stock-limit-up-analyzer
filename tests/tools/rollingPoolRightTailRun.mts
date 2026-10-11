/**
 * `FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001` · S3 真实预检 / S4 正式 Run 工具。
 *
 * ## 用法
 *
 * ```bash
 * # S3 技术预检（真实 Dataset 端口 + 真实投影；**不持久化、不建 Run**）
 * node --max-old-space-size=6144 node_modules/tsx/dist/cli.mjs \
 *   tests/tools/rollingPoolRightTailRun.mts --mode precheck
 *
 * # S4 正式研究（经**已有 startRun 入口**持久化 1 条 Run + 产物）
 * node --max-old-space-size=6144 node_modules/tsx/dist/cli.mjs \
 *   tests/tools/rollingPoolRightTailRun.mts --mode formal
 * ```
 *
 * ## 纪律
 *
 * - 只读 Dataset；**不**直连 DB 跑正式实验（预检也走 `defaultExperimentRunner`，即平台 Runner 本体）；
 * - 预检**只看**池 / 身份 / 年龄 / 因子值 / 信号 / 标签，**不据预检收益改研究设计**；
 * - 长任务输出由调用方落盘（本文件只写 stdout，不自行重定向）；
 * - 不建账户、不接 Runner/Backtest、不做参数变体；正式 Run **只跑一次**。
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { defaultExperimentRunner, defaultExperimentRunService } from "../../server/researchExperiments/defaults";

const EXPERIMENT_ID = "first-board-pullback/rolling-pool-right-tail-mvp";
const DATASET_VERSION_ID = 780_004;
/** 预检片段的**事件扫描窗**（比决策窗往前留一段，使 2024-01-02 的池是满的）。 */
const PRECHECK_EVENT_WINDOW = { startDate: "2023-11-01", endDate: "2024-03-29" };
const OUT_DIR = new URL("../../_scratch/fbpool/", import.meta.url);

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
console.log(`[rolling-pool] mode=${mode} dataset=${DATASET_VERSION_ID} experiment=${EXPERIMENT_ID}`);

if (mode === "precheck") {
  const runner = defaultExperimentRunner();
  const started = Date.now();
  const { outcome, artifactFiles } = await runner.runDetailed({
    experimentId: EXPERIMENT_ID,
    datasetVersionId: DATASET_VERSION_ID,
    evaluationWindow: PRECHECK_EVENT_WINDOW,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[rolling-pool] precheck runStatus=${outcome.runStatus} elapsed=${elapsed}s`);
  console.log(`[rolling-pool] artifactFiles=${artifactFiles.length}`);
  // 预检的**产物也落盘**（供人工逐日核对真实重复事件股票；不写对象存储）。
  const artifactDir = new URL("./precheck-artifacts/", OUT_DIR);
  mkdirSync(artifactDir, { recursive: true });
  for (const file of artifactFiles) {
    const body = typeof file.body === "string" ? file.body : Buffer.from(file.body);
    writeFileSync(new URL(file.name, artifactDir), body);
  }
  console.log(`[rolling-pool] wrote ${artifactFiles.length} artifact(s) to _scratch/fbpool/precheck-artifacts/`);
  console.log(`[rolling-pool] datasetFacts=${JSON.stringify(outcome.execution.datasetFacts)}`);
  if (outcome.error !== null) {
    console.log(`[rolling-pool] error=${JSON.stringify(outcome.error)}`);
    pendingExitCode = 1;
  }
  console.log(`[rolling-pool] logs:`);
  for (const line of outcome.execution.logs) console.log(`  ${line}`);
  save("precheck-outcome.json", {
    runStatus: outcome.runStatus,
    error: outcome.error,
    execution: outcome.execution,
    sampleSummary: outcome.result?.sampleSummary ?? null,
    tables: outcome.result?.tables ?? null,
    customPayload: outcome.result?.customPayload ?? null,
  });
  console.log("[rolling-pool] wrote _scratch/fbpool/precheck-outcome.json");
} else if (mode === "formal") {
  const service = defaultExperimentRunService();
  const started = Date.now();
  const result = await service.execute({
    experimentId: EXPERIMENT_ID,
    datasetVersionId: DATASET_VERSION_ID,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[rolling-pool] formal elapsed=${elapsed}s`);
  console.log(`[rolling-pool] run=${JSON.stringify(result.run)}`);
  console.log(`[rolling-pool] outcome.runStatus=${result.outcome.runStatus}`);
  console.log(`[rolling-pool] datasetFacts=${JSON.stringify(result.outcome.execution.datasetFacts)}`);
  if (result.outcome.error !== null) {
    console.log(`[rolling-pool] error=${JSON.stringify(result.outcome.error)}`);
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
  console.log("[rolling-pool] wrote _scratch/fbpool/formal-run.json");
} else {
  console.error(`未知 mode=${mode}（支持 precheck / formal）`);
  process.exit(2);
}

/**
 * 🔴 平台默认装配持有 DB 连接池 / 对象存储客户端，进程不会自己退出。
 * 显式退出：正常路径 0，失败路径由上面的 `outcome.error` 判定后置 1（**不吞错**）。
 */
process.exit(pendingExitCode);
