/**
 * 真实 tRPC 全链 E2E：前向纸面交易「推进」不再谎报成功。
 *
 * 事故（2026-09-14）：`index_daily` 交易日历停更在 2026-09-04，而行情已到 09-14 ⇒
 * `datesToAdvance` 恒为空 ⇒ 推进静默 no-op，前端无条件报「已推进到最新交易日」。
 *
 * 本探针走**网页同一条服务端路径**（`appRouter.createCaller` → sentiment router → db.ts → TiDB），断言：
 *   1. 首次推进：`diagnosis.kind === "advanced"`、`advancedDates` 精确等于缺口交易日、摘要真的变化；
 *   2. 再次推进：`diagnosis.kind === "already-latest"`（合法空转，如实区分，不是「成功推进」）；
 *   3. 落库状态与返回值一致（equityCurve / orders / lastProcessedDate 读回比对）；
 *   4. 不存在的 runId ⇒ `run-not-found`（不是 null / 不是成功）。
 *
 * ⚠️ 本探针**会写入** `paper_trading_runs`（推进就是它的职责），但只推进既有 active 运行，不新建、不删行。
 *
 * 用法：npx tsx docs/evidence/_probe_paper_advance_e2e.mts [runId]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { appRouter } from "../../server/routers";
import { getDb } from "../../server/db";

const runId = Number(process.argv[2] ?? 1);

const adminCtx = {
  user: { id: "probe", role: "admin" as const, openId: "probe", name: "probe" },
  req: { protocol: "http", headers: {} },
  res: { clearCookie: () => {} },
} as never;
const caller = appRouter.createCaller(adminCtx);

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}

const db = await getDb();
if (!db) {
  console.log("数据库不可用（DATABASE_URL 未配置）");
  process.exit(1);
}

function unwrap<T>(res: unknown): T[] {
  if (Array.isArray(res)) return (Array.isArray(res[0]) ? res[0] : res) as T[];
  return [];
}

const before = unwrap<Record<string, unknown>>(
  await db.execute(sql`select id, status, lastProcessedDate, updatedAt, length(stateJson) as len from paper_trading_runs where id = ${runId}`),
)[0];
console.log(`\n=== run #${runId} 推进前 ===`);
console.log(JSON.stringify(before ?? null));

if (!before || before["status"] !== "active") {
  console.log(`run #${runId} 不存在或非 active，无法验证推进；请传一个 active 运行的 id。`);
  process.exit(0);
}

console.log("\n=== 1) 首次推进（真实 tRPC） ===");
const first = await caller.sentiment.advancePaperTradingRun({ id: runId });
console.log(JSON.stringify({ diagnosis: first.diagnosis, summary: first.summary }, null, 2));
check("首次推进 diagnosis.kind = advanced", first.diagnosis.kind === "advanced", `实际 ${first.diagnosis.kind}`);
check("推进日期非空且升序", first.diagnosis.advancedDates.length > 0
  && [...first.diagnosis.advancedDates].sort().join("|") === first.diagnosis.advancedDates.join("|"),
  first.diagnosis.advancedDates.join("、"));
check("日历末端不早于行情末端（否则应报 calendar-stale）", first.diagnosis.calendarStale === false,
  `calendar=${first.diagnosis.calendarLastDate} market=${first.diagnosis.marketLastDate}`);
check("推进末日严格晚于推进前的 lastProcessedDate",
  first.diagnosis.lastProcessedDate === null || (first.diagnosis.advancedDates.at(-1) ?? "") > first.diagnosis.lastProcessedDate,
  `${first.diagnosis.lastProcessedDate} -> ${first.diagnosis.advancedDates.at(-1)}`);
check("summary 非空", first.summary !== null);
if (first.summary !== null) {
  check("已产生成交或已有持仓（不再恒为 0）",
    first.summary.filledCount > 0 || first.summary.openPositionCount > 0,
    `filled=${first.summary.filledCount} open=${first.summary.openPositionCount}`);
  check("前向曲线有交易日数（> 0）", first.summary.tradingDayCount > 0, `tradingDayCount=${first.summary.tradingDayCount}`);
}

console.log("\n=== 2) 落库状态与返回值一致 ===");
const detail = await caller.sentiment.getPaperTradingRun({ id: runId });
const afterRow = unwrap<Record<string, unknown>>(
  await db.execute(sql`select id, lastProcessedDate, updatedAt, length(stateJson) as len from paper_trading_runs where id = ${runId}`),
)[0];
console.log(JSON.stringify(afterRow ?? null));
check("lastProcessedDate 已落库前移", afterRow?.["lastProcessedDate"] === first.diagnosis.advancedDates.at(-1),
  `库=${afterRow?.["lastProcessedDate"]} 期望=${first.diagnosis.advancedDates.at(-1)}`);
check("stateJson 长度变化（真的写了新状态）",
  Number(afterRow?.["len"] ?? 0) !== Number(before["len"] ?? 0),
  `${before["len"]} -> ${afterRow?.["len"]}`);
if (detail !== null) {
  check("读回 state.lastProcessedDate = 推进末日", detail.state.lastProcessedDate === first.diagnosis.advancedDates.at(-1),
    String(detail.state.lastProcessedDate));
  check("读回 orders 数量 = 摘要 filledCount", detail.state.orders.length === (first.summary?.filledCount ?? -1),
    `orders=${detail.state.orders.length} filled=${first.summary?.filledCount}`);
  check("读回 equityCurve 点数 = 摘要 tradingDayCount",
    detail.state.equityCurve.length === (first.summary?.tradingDayCount ?? -1),
    `curve=${detail.state.equityCurve.length} tradingDayCount=${first.summary?.tradingDayCount}`);
}

console.log("\n=== 3) 再次推进 ⇒ 必须如实报 already-latest（不是「成功推进」） ===");
const second = await caller.sentiment.advancePaperTradingRun({ id: runId });
console.log(JSON.stringify({ diagnosis: second.diagnosis }, null, 2));
check("第二次 diagnosis.kind = already-latest", second.diagnosis.kind === "already-latest", `实际 ${second.diagnosis.kind}`);
check("第二次无推进日期", second.diagnosis.advancedDates.length === 0);
check("第二次不误报 calendar-stale", second.diagnosis.calendarStale === false);

console.log("\n=== 4) 不存在的运行 ⇒ run-not-found（不是 null / 不是成功） ===");
const missing = await caller.sentiment.advancePaperTradingRun({ id: 999_999_999 });
check("kind = run-not-found", missing.diagnosis.kind === "run-not-found", `实际 ${missing.diagnosis.kind}`);
check("summary = null", missing.summary === null);

console.log(`\n=== 汇总：${checks - failures}/${checks} 通过，失败 ${failures} ===`);
process.exit(failures === 0 ? 0 : 1);
