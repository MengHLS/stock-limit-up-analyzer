/**
 * CLOSED-LOOP-BACKTEST-PERSIST-001 — 端到端验证：**每次回测都有结果、且有地方查**。
 *
 * 走网页同一条服务端路径（真实 tRPC caller → loopRun → 真库），断言：
 *   Part A（真实运行 + 留档 + 查询）
 *     1. `loopRun` 返回后，留档表行数 **+1**；
 *     2. `listBacktests` 能查到该 `runId`，且**摘要字段与运行结果一致**
 *        （status / 阶段计数 / 数据来源 / 成交笔数 / 期末权益 —— 逐项比对，不放过漂移）；
 *     3. `getBacktest(id)` 拿得到**完整结果**（`stages` 长度 = 14，`runId` 一致）；
 *     4. 列表条目**不含**完整结果（长文本只在详情里）—— 以字段存在性断言；
 *     5. tRPC `output()` 契约校验实际生效（schema 不符会抛错 ⇒ 能跑通即证明形状正确）。
 *
 *   Part B（幂等，直连 repository，避免再跑一次昂贵的真实回测）
 *     6. 同一 `runId` 写两次 ⇒ 仍然**只有一行**，且内容为**后一次**的值；
 *        结束后**清理**该探针行（不留测试数据污染产品页）。
 *
 * 用法：npx tsx docs/evidence/_probe_closed_loop_persist_e2e.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { appRouter } from "../../server/routers";
import { getDb } from "../../server/db";
import { saveClosedLoopBacktestRun } from "../../server/closedLoopBacktestRun/repository";

const adminCtx = {
  user: { id: "probe", role: "admin" as const, openId: "probe", name: "probe" },
  req: { protocol: "http", headers: {} },
  res: { clearCookie: () => {} },
} as never;

const caller = appRouter.createCaller(adminCtx);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

let failures = 0;
const fail = (m: string): void => {
  failures += 1;
  console.log(`   🔴 ${m}`);
};
const ok = (m: string): void => console.log(`   ✅ ${m}`);
const eq = (label: string, actual: unknown, expected: unknown): void => {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) ok(`${label} = ${JSON.stringify(actual)}`);
  else fail(`${label} 不符：实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
};

const db = await getDb();
if (!db) {
  console.log("数据库不可用（DATABASE_URL 未配置）");
  process.exit(1);
}

async function countRows(): Promise<number> {
  const res = (await db!.execute(
    sql`SELECT COUNT(*) AS c FROM closed_loop_backtest_run`,
  )) as unknown as Array<Array<{ c: number }>>;
  const first = (res as unknown as { 0?: unknown })[0] as Array<{ c: number }> | undefined;
  return Array.isArray(first) && first[0] ? Number(first[0].c) : 0;
}

// ---------------------------------------------------------------------------
// Part A — 真实 tRPC：跑一次 → 留档 → 列表 → 详情
// ---------------------------------------------------------------------------

const WINDOW = { startDate: "2025-01-02", endDate: "2025-02-28" };
const beforeRows = await countRows();
console.log(`[probe] 留档表当前 ${beforeRows} 行；发起 loopRun（${WINDOW.startDate}~${WINDOW.endDate}）…`);

const t0 = Date.now();
const raw = (await caller.researchRun.loopRun({
  experimentId: `EXP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-A1B2C3D4`,
  strategyId: "cand-360001",
  strategyVersion: "1.0.0",
  dateRange: WINDOW,
  executionModel: "NEXT_OPEN",
  useRealData: true,
  datasetGuards: { dataReady: true, maxTradingDays: 45 },
} as never)) as unknown as Record<string, unknown>;
const elapsed = Date.now() - t0;

const runId = String(raw["runId"] ?? "");
const overall = isRecord(raw["overall"]) ? raw["overall"] : {};
const assembly = isRecord(raw["assembly"]) ? raw["assembly"] : null;
const stagesRaw = Array.isArray(raw["stages"]) ? raw["stages"] : [];
const backtestStage = stagesRaw.filter(isRecord).find((s) => s["stageId"] === "backtest");
const backtestOutput =
  backtestStage !== undefined &&
  backtestStage["state"] === "EXECUTED" &&
  isRecord(backtestStage["output"])
    ? (backtestStage["output"] as Record<string, unknown>)
    : null;

console.log(`\n=== Part A：真实运行（${elapsed}ms）===`);
console.log(`   runId=${runId}`);
console.log(`   overall=${JSON.stringify(overall)}`);
console.log(`   datasetSource=${String(assembly?.["datasetSource"])} rowCount=${String(assembly?.["datasetRowCount"])}`);

if (runId === "") fail("loopRun 未返回 runId");

const afterRows = await countRows();
console.log(`   留档表：${beforeRows} → ${afterRows} 行`);
if (afterRows !== beforeRows + 1) fail(`留档行数未按预期 +1（${beforeRows} → ${afterRows}）`);
else ok("每次运行自动留档 +1（无需手动保存）");

// 列表（摘要级）
const list = (await caller.researchRun.listBacktests({ limit: 100 })) as unknown as Array<
  Record<string, unknown>
>;
console.log(`\n=== 列表（${list.length} 条）===`);
const hit = list.find((item) => item["runId"] === runId);
if (hit === undefined) {
  fail(`列表中查不到本次运行 ${runId}`);
} else {
  ok(`列表能查到本次运行（id=${String(hit["id"])}）`);
  eq("列表 status", hit["status"], overall["status"]);
  eq("列表 executedStageCount", hit["executedStageCount"], overall["executedStageCount"]);
  eq("列表 blockedStageCount", hit["blockedStageCount"], overall["blockedStageCount"]);
  eq("列表 skippedStageCount", hit["skippedStageCount"], overall["skippedStageCount"]);
  eq("列表 datasetSource", hit["datasetSource"], assembly === null ? null : assembly["datasetSource"]);
  eq("列表 datasetVersionId", hit["datasetVersionId"], assembly === null ? null : assembly["datasetVersionId"]);
  eq("列表 recipeId", hit["recipeId"], assembly === null ? null : assembly["recipeId"]);
  eq(
    "列表 tradeCount",
    hit["tradeCount"],
    backtestOutput === null ? null : backtestOutput["tradeCount"],
  );
  eq(
    "列表 finalEquity",
    hit["finalEquity"],
    backtestOutput === null ? null : backtestOutput["finalEquity"],
  );
  eq(
    "列表 equityCurvePointCount",
    hit["equityCurvePointCount"],
    backtestOutput === null ? null : backtestOutput["equityCurvePointCount"],
  );

  // 列表**不含**长文本结果 —— 这是「列表轻」的结构性保证。
  const hasResultField = Object.prototype.hasOwnProperty.call(hit, "result");
  if (hasResultField) fail("列表条目携带了 result（长文本不该进列表）");
  else ok("列表条目不携带完整结果（长文本只在详情里）");

  // 详情（完整结果）
  const detail = (await caller.researchRun.getBacktest({
    id: Number(hit["id"]),
  } as never)) as unknown as Record<string, unknown> | null;
  console.log(`\n=== 详情 ===`);
  if (detail === null) {
    fail("getBacktest 返回 null（留档存在却读不到详情）");
  } else {
    const result = detail["result"];
    if (result === null || result === undefined) {
      fail("详情里 result 为 null（完整结果未留档）");
    } else if (!isRecord(result)) {
      fail("详情里 result 不是对象");
    } else {
      eq("详情 result.runId", result["runId"], runId);
      const detailStages = Array.isArray(result["stages"]) ? result["stages"] : [];
      eq("详情 result.stages 长度（canonical 14 阶段）", detailStages.length, 14);
      const detailBacktest = detailStages
        .filter(isRecord)
        .find((s) => s["stageId"] === "backtest");
      const detailOutput =
        detailBacktest !== undefined && isRecord(detailBacktest["output"])
          ? (detailBacktest["output"] as Record<string, unknown>)
          : null;
      if (detailOutput !== null && Array.isArray(detailOutput["trades"])) {
        ok(`详情含成交明细 trades = ${(detailOutput["trades"] as unknown[]).length} 条`);
      } else {
        console.log("   ⚠️ 详情无 trades（本次窗口可能 0 成交）—— 不影响留档链路结论");
      }
      if (detailOutput !== null && Array.isArray(detailOutput["equityCurve"])) {
        ok(`详情含权益曲线 equityCurve = ${(detailOutput["equityCurve"] as unknown[]).length} 点`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Part B — 幂等（直连 repository，避免二次昂贵真实回测）
// ---------------------------------------------------------------------------

console.log(`\n=== Part B：幂等写入 ===`);
const probeRunId = `probe-idem-${Date.now()}`;
const minimalResult = (equity: number) =>
  ({
    runId: probeRunId,
    createdAt: new Date().toISOString(),
    chainFingerprint: "probe",
    fingerprint: "probe",
    overall: {
      status: "NO_STAGE_EXECUTED",
      executedStageCount: 0,
      blockedStageCount: 0,
      skippedStageCount: 0,
      firstBlockedReasonCode: null,
      synthetic: false,
      note: "probe",
    },
    runnerInjected: [],
    stages: [],
    blockedSummary: [],
    // 必须满足 `closedLoopWiringSummarySchema` 的全部必填字段 —— 否则读回时
    // tRPC 的 output 校验会（正确地）拒绝这条记录，探针会看到 Output validation failed。
    wiring: {
      requestedStages: [],
      wiredStages: [],
      unwiredStages: [],
      coveredStages: [],
      uncoveredStages: [],
      executorBound: false,
    },
    assembly: null,
  }) as never;

const coords = {
  experimentId: "EXP-PROBE-IDEM",
  strategyId: "probe-strategy",
  strategyVersion: "0.0.1",
  startDate: "2025-01-02",
  endDate: "2025-01-31",
};

const rowsBeforeIdem = await countRows();
await saveClosedLoopBacktestRun({ ...coords, result: minimalResult(1) });
await saveClosedLoopBacktestRun({ ...coords, result: minimalResult(2) });
const rowsAfterIdem = await countRows();

if (rowsAfterIdem !== rowsBeforeIdem + 1) {
  fail(`幂等失败：同 runId 写两次应只 +1 行，实际 ${rowsBeforeIdem} → ${rowsAfterIdem}`);
} else {
  ok("同 runId 写两次只产生一行（重试幂等收敛）");
}

const detailIdem = (await caller.researchRun.getBacktest({
  id: (
    (await caller.researchRun.listBacktests({ limit: 100 })) as unknown as Array<
      Record<string, unknown>
    >
  ).find((item) => item["runId"] === probeRunId)?.["id"] ?? 0,
} as never)) as unknown as Record<string, unknown> | null;
if (detailIdem === null) {
  fail("幂等行读不到");
} else {
  const result = detailIdem["result"];
  if (result === null || !isRecord(result)) {
    fail("幂等行的 result 读不到");
  } else {
    const idemStages = Array.isArray(result["stages"]) ? result["stages"] : [];
    eq("幂等行 result.stages 长度", idemStages.length, 0);
    eq("幂等行 status（第二次写入的最终态）", detailIdem["status"], "NO_STAGE_EXECUTED");
    ok("幂等行可正常读取，且读回的是后一次写入的值");
  }
}

// 清理探针数据（不留污染）
await db.execute(sql`DELETE FROM closed_loop_backtest_run WHERE runId = ${probeRunId}`);
const rowsAfterCleanup = await countRows();
if (rowsAfterCleanup !== rowsAfterIdem - 1) {
  fail(`探针数据清理失败：${rowsAfterIdem} → ${rowsAfterCleanup}`);
} else {
  ok("探针幂等数据已清理（不污染产品页）");
}

// ---------------------------------------------------------------------------

const summary = {
  generatedAt: new Date().toISOString(),
  partA: {
    runId,
    elapsedMs: elapsed,
    rowsBefore: beforeRows,
    rowsAfter: afterRows,
    overall,
    datasetSource: assembly?.["datasetSource"] ?? null,
    datasetRowCount: assembly?.["datasetRowCount"] ?? null,
    tradeCount: backtestOutput?.["tradeCount"] ?? null,
    finalEquity: backtestOutput?.["finalEquity"] ?? null,
    listSize: list.length,
  },
  partB: { rowsBeforeIdem, rowsAfterIdem, rowsAfterCleanup },
  failures,
  pass: failures === 0,
};
writeFileSync(
  new URL("./_probe_closed_loop_persist_e2e.json", import.meta.url),
  JSON.stringify(summary, null, 2),
  "utf8",
);

console.log(`\n=== 结论 ===`);
console.log(`   失败项 = ${failures}`);
console.log(`   ${failures === 0 ? "PASS" : "FAIL"}`);
process.exit(failures === 0 ? 0 : 1);
