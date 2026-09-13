/**
 * 探针：验证连接池修复 + 重试兜底是否真的生效。
 *
 * 三件事：
 *   1. 池配置是否为 maxIdle < connectionLimit（回收定时器能否启动）；
 *   2. 真实执行 `getLeaderCandidates()`（报错来源函数）端到端能否成功；
 *   3. 人为杀掉池中空闲连接后，`withReadRetry` 能否恢复（模拟对端断连）。
 *
 * 🚫 只读；不写任何表。
 * 重跑：项目根目录 `npx tsx docs/evidence/_probe_pool_fix_verify.mts`
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getDb, getLeaderCandidates } from "../../server/db";
import { isTransientReadError, withReadRetry } from "../../server/researchEngine/readRetry";

const OUT = "docs/evidence/_probe_pool_fix_verify.json";
const report: Record<string, unknown> = {};

/** `getLeaderCandidates()` 返回 `LeaderCandidateResult`（非数组）；取真实口径字段记账。 */
function describeResult(value: unknown): Record<string, unknown> {
  const r = (value ?? {}) as { date?: unknown; totalMainBoardLimitUps?: unknown; candidates?: unknown };
  return {
    date: r.date ?? null,
    totalMainBoardLimitUps: r.totalMainBoardLimitUps ?? null,
    candidateCount: Array.isArray(r.candidates) ? r.candidates.length : null,
  };
}

// ---- 1. 池配置 ------------------------------------------------------------
const db = await getDb();
const poolCandidate = (db as unknown as { $client?: unknown })?.$client
  ?? (db as unknown as { session?: { client?: unknown } })?.session?.client;
const cfg = (poolCandidate as { config?: Record<string, unknown> })?.config ?? {};
report.poolConfig = {
  connectionLimit: cfg.connectionLimit ?? null,
  maxIdle: cfg.maxIdle ?? null,
  idleTimeout: cfg.idleTimeout ?? null,
  recycleTimerArmed:
    typeof cfg.maxIdle === "number" && typeof cfg.connectionLimit === "number"
      ? cfg.maxIdle < cfg.connectionLimit
      : null,
};
console.log(`1) 池配置 = ${JSON.stringify(report.poolConfig)}`);
const armed = report.poolConfig.recycleTimerArmed;
console.log(armed === true ? "   ✅ idle 回收定时器已可启动（maxIdle < connectionLimit）" : "   ❌ 回收定时器仍不会启动");

// ---- 2. 真实调用报错来源函数 ----------------------------------------------
try {
  const started = Date.now();
  const result = await getLeaderCandidates();
  report.getLeaderCandidates = { ok: true, elapsedMs: Date.now() - started, ...describeResult(result) };
  console.log(`2) getLeaderCandidates(): OK (${Date.now() - started}ms, ${JSON.stringify(describeResult(result))})`);
} catch (error) {
  const e = error as { message?: string; code?: string };
  report.getLeaderCandidates = { ok: false, message: e.message, code: e.code };
  console.log(`2) getLeaderCandidates(): FAIL ${e.code ?? ""} ${e.message}`);
}

// ---- 3. 重试语义验证（不依赖读私有池状态）--------------------------------
// 池的 `_freeConnections` 被 Drizzle 包裹、外部读不到 ⇒ 改为**直接验证重试契约本身**：
//   3a. 注入一个「首次抛 ECONNRESET、第二次成功」的函数 ⇒ 必须恢复且恰好重试 1 次；
//   3b. 注入一个「恒抛语义错误」的函数 ⇒ 必须**不重试**、原样抛出（不得掩盖真错误）。
let transientAttempts = 0;
try {
  const value = await withReadRetry("probe.transientThenOk", async () => {
    transientAttempts += 1;
    if (transientAttempts === 1) {
      const err = new Error("Failed query: select `stockCode`, `tradeDate` from `stock_daily_prices` where tradeDate = ?");
      (err as { cause?: unknown }).cause = new Error("read ECONNRESET");
      throw err;
    }
    return "recovered";
  }, { onRetry: () => { /* 静音，计数已在 fn 内 */ }, baseDelayMs: 10 });
  report.transientRecovery = { ok: true, attempts: transientAttempts, value };
  console.log(`3a) 首次 ECONNRESET → 恢复（尝试 ${transientAttempts} 次，值 "${value}"）`);
} catch (error) {
  report.transientRecovery = { ok: false, attempts: transientAttempts, message: String(error) };
  console.log(`3a) ❌ 未恢复（尝试 ${transientAttempts} 次）`);
}

let semanticAttempts = 0;
try {
  await withReadRetry("probe.semantic", async () => {
    semanticAttempts += 1;
    throw new Error("Table 'stock_daily_prices' doesn't exist");
  }, { baseDelayMs: 10 });
  report.semanticNoRetry = { ok: false, note: "本该抛出却没抛" };
  console.log("3b) ❌ 语义错误竟未抛出");
} catch {
  report.semanticNoRetry = { threw: true, attempts: semanticAttempts, noRetry: semanticAttempts === 1 };
  console.log(`3b) 语义错误原样抛出且不重试（尝试 ${semanticAttempts} 次）${semanticAttempts === 1 ? " ✅" : " ❌"}`);
}

// 附：瞬时错误识别能力自检（保证判据没被改坏）
report.transientClassifierSelfCheck = {
  econnreset: isTransientReadError(new Error("read ECONNRESET")),
  wrapped: isTransientReadError(new Error("Failed query: select 1", { cause: new Error("read ECONNRESET") })),
  semantic: isTransientReadError(new Error("Table 'x' doesn't exist")),
};
console.log(`附) 瞬时错误识别自检 = ${JSON.stringify(report.transientClassifierSelfCheck)}`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
console.log(`报告 → ${OUT}`);
process.exit(0);
