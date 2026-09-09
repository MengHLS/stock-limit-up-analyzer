/**
 * STEP 12.5 WORK C-12.5.2 — PIT / 反泄漏抽样审计 CLI（只读，幂等，确定性）。
 *
 * 用法（真实 DB；需项目根 .env 的 DATABASE_URL）：
 *   npx tsx scripts/runStep125PitAudit.mts                 # 冒烟口径（dataReady=false）
 *   npx tsx scripts/runStep125PitAudit.mts --budget=60 --seed=20260906
 *   # A~H 全 DATA_READY 后，认证口径：
 *   npx tsx scripts/runStep125PitAudit.mts --data-ready --budget=80
 *
 * 参数：
 *   --seed=N        随机种子（默认 20260906；相同 seed 输出可复现）
 *   --budget=N      基础样本量（默认 24；另派生 CA/行业 PIT 边界样本）
 *   --data-ready    声明数据链已就绪（A~H 全 DATA_READY）；无 FAIL 时 gate 才可判 PASS
 *   --out=PATH      报告输出路径（默认 docs/step12-evidence/pit_audit_report.json）
 *
 * gate 判定与认证边界见 server/historicalState/audit/runAudit.ts 头注释。
 * 输出 JSON 含 capturedAt / options / samplesPlanned / samplesQueried / sampleErrors /
 * checks（按 checkId 的 pass/fail）/ failures / industryPitGuardExercised / gate。
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runPitAudit } from "../server/historicalState/audit";

interface CliArgs {
  seed: number;
  budget: number;
  dataReady: boolean;
  out: string;
}

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function parseArgs(args: string[]): CliArgs {
  return {
    seed: Number(readFlag(args, "seed") ?? 20260906),
    budget: Number(readFlag(args, "budget") ?? 24),
    dataReady: args.includes("--data-ready"),
    out: resolve(readFlag(args, "out") ?? "docs/step12-evidence/pit_audit_report.json"),
  };
}

const { seed, budget, dataReady, out } = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const summary = await runPitAudit({ seed, budget, dataReady });

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(summary, null, 2), "utf8");

const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
const failedCount = summary.failures.length;
const byBucket = new Map<string, number>();
for (const sampleError of summary.sampleErrors) {
  byBucket.set(sampleError.bucket, (byBucket.get(sampleError.bucket) ?? 0) + 1);
}

console.log("PIT / 反泄漏抽样审计完成（%ss）", elapsedSec);
console.log("  gate          : %s", summary.gate);
console.log("  样本          : planned=%d queried=%d errors=%d", summary.samplesPlanned, summary.samplesQueried, summary.sampleErrors.length);
console.log("  检查          : %d 项失败，行业 PIT 护栏触发 %d 样本", failedCount, summary.industryPitGuardExercised);
if (summary.sampleErrors.length > 0) {
  console.log("  样本级错误    : %d（%s）", summary.sampleErrors.length, Array.from(byBucket.entries()).map(([k, v]) => `${k}×${v}`).join(", "));
}
if (failedCount > 0) {
  console.log("  失败明细（前 10）:");
  for (const issue of summary.failures.slice(0, 10)) {
    console.log("    [%s] %s %s: %s", issue.checkId, issue.sampleId, issue.bucket, issue.message);
  }
}
console.log("  报告输出      : %s", out);
console.log("  认证边界      : %s（A~H 全 DATA_READY 后加 --data-ready 重跑方可作为 VALIDATED 证据）", dataReady ? "dataReady=true" : "dataReady=false（冒烟口径）");

// 显式退出：drizzle mysql2 连接池的空闲连接会保持事件循环存活，防止 CLI 结束后进程悬挂。
process.exit(summary.gate === "FAIL" ? 1 : 0);
