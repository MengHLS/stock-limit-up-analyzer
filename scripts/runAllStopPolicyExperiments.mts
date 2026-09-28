/**
 * Run all registered stop-policy experiments with bounded concurrency.
 *
 * One experiment = one child process = one strategy version/run record.
 * Completed output files are skipped unless --force is provided.
 *
 * Usage:
 *   node --max-old-space-size=2048 node_modules/tsx/dist/cli.mjs \
 *     scripts/runAllStopPolicyExperiments.mts --concurrency 2
 *   ... --ids SL-01.0,SL-01.1
 *   ... --force
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { STOP_POLICY_EXPERIMENTS } from "../server/research/exitPolicyExperiments";

function argOf(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const requested = argOf("ids", "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);
const ids = requested.length === 0
  ? Object.keys(STOP_POLICY_EXPERIMENTS)
  : requested;
const concurrency = Math.min(
  2,
  Math.max(1, Number(argOf("concurrency", "2")) || 2),
);
const force = process.argv.includes("--force");
const scriptsDir = path.resolve("scripts");
const runner = path.join(scriptsDir, "run3FTopNStopPolicyStudy.mts");
const evidenceDir = path.resolve("docs/evidence");
fs.mkdirSync(evidenceDir, { recursive: true });

interface ItemResult {
  readonly id: string;
  readonly version: string;
  readonly status: "completed" | "skipped" | "failed";
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly outputPath: string;
  readonly error?: string;
}

function outputPathFor(id: string): string {
  return path.join(evidenceDir, `_probe_3f_top3_exit_${id}.json`);
}

function logPathFor(id: string): string {
  return path.join(evidenceDir, `_stop_policy_run_${id}.log`);
}

async function runOne(id: string): Promise<ItemResult> {
  const definition = STOP_POLICY_EXPERIMENTS[id];
  if (definition === undefined) {
    throw new Error(`未注册的止损实验：${id}`);
  }
  const outputPath = outputPathFor(id);
  if (!force && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    console.log(`[stop-all] skip ${id} (${definition.version})：结果已存在`);
    return {
      id,
      version: definition.version,
      status: "skipped",
      attempts: 0,
      elapsedMs: 0,
      outputPath,
    };
  }

  const startedAt = Date.now();
  let attempts = 0;
  let lastError: unknown = null;
  while (attempts < 2) {
    attempts += 1;
    const logPath = logPathFor(id);
    const logStream = fs.createWriteStream(logPath, { flags: attempts === 1 ? "w" : "a" });
    try {
      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--max-old-space-size=8192",
            "node_modules/tsx/dist/cli.mjs",
            runner,
            "--sl",
            id,
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              NODE_OPTIONS: "--require=./.cache/codex-os-userinfo-patch.cjs",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        child.stdout.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          logStream.write(text);
          process.stdout.write(`[${id}] ${text}`);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          logStream.write(text);
          process.stderr.write(`[${id}] ${text}`);
        });
        child.on("error", reject);
        child.on("close", code => resolve(code ?? 1));
      });
      logStream.end();
      if (exitCode === 0) {
        return {
          id,
          version: definition.version,
          status: "completed",
          attempts,
          elapsedMs: Date.now() - startedAt,
          outputPath,
        };
      }
      lastError = new Error(`child exit ${String(exitCode)}`);
    } catch (error) {
      logStream.end();
      lastError = error;
    }
    if (attempts < 2) {
      console.warn(`[stop-all] retry ${id} (${definition.version})`);
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }
  }
  return {
    id,
    version: definition.version,
    status: "failed",
    attempts,
    elapsedMs: Date.now() - startedAt,
    outputPath,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  };
}

const results: ItemResult[] = [];
let cursor = 0;
async function worker(): Promise<void> {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= ids.length) return;
    const id = ids[index]!;
    const result = await runOne(id);
    results.push(result);
    console.log(
      `[stop-all] ${result.status} ${result.id}@${result.version} `
      + `attempts=${result.attempts} elapsed=${(result.elapsedMs / 1000).toFixed(1)}s`,
    );
  }
}

await Promise.all(
  Array.from({ length: concurrency }, () => worker()),
);

const summaryPath = path.join(evidenceDir, "_stop_policy_all_summary.json");
fs.writeFileSync(
  summaryPath,
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    concurrency,
    requested: ids,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  }, null, 2),
  "utf8",
);
console.log(
  `[stop-all] summary=${summaryPath} completed=${results.filter(r => r.status === "completed").length} `
  + `skipped=${results.filter(r => r.status === "skipped").length} `
  + `failed=${results.filter(r => r.status === "failed").length}`,
);

if (results.some(result => result.status === "failed")) {
  process.exit(1);
}
