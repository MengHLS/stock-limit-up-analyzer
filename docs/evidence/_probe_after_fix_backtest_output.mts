/**
 * 验证：运行工作台「运行策略」现在**真的产出可展示的数据**（走网页同一条服务端路径）。
 *
 * 与 `_probe_backtest_zero_trades.mts`（改动前取证）配对：本探针跑 `researchRun.loopRun`
 * 并直接读**前端能拿到的** `stages[backtest].output`，断言：
 *   1. 数据集不再因「事件面板不可撮合」而静默产出全 0 —— `datasetSourceNote` 必须说明
 *      「直读成功但不可撮合 → 回落重建」；
 *   2. `tradeCount > 0` 且权益曲线**不是平的**；
 *   3. `executionStats.byReason` 中**没有** SUSPENDED（这正是改动前的 100% 拒单原因）；
 *   4. 明细（equityCurve / executionStats / trades / skippedCounts）确实进入了阶段产出 ⇒
 *      前端拿得到、画得出。
 *
 * 用法：npx tsx docs/evidence/_probe_after_fix_backtest_output.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { appRouter } from "../../server/routers";

const adminCtx = {
  user: { id: "probe", role: "admin" as const, openId: "probe", name: "probe" },
  req: { protocol: "http", headers: {} },
  res: { clearCookie: () => {} },
} as never;

const caller = appRouter.createCaller(adminCtx);
const WINDOW = { startDate: "2025-01-02", endDate: "2025-03-31" };

function fnv1a8(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

let failures = 0;
const fail = (m: string): void => {
  failures += 1;
  console.log(`   🔴 ${m}`);
};
const ok = (m: string): void => console.log(`   ✅ ${m}`);

const startedAt = Date.now();
console.log(`[probe] 发起 loopRun（useRealData / NEXT_OPEN / ${WINDOW.startDate}~${WINDOW.endDate}）…`);
const raw = (await caller.researchRun.loopRun({
  experimentId: `EXP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-A1B2C3D4`,
  strategyId: "cand-360001",
  strategyVersion: "1.0.0",
  dateRange: WINDOW,
  executionModel: "NEXT_OPEN",
  useRealData: true,
  datasetGuards: { dataReady: true },
} as never)) as unknown as Record<string, unknown>;

const ms = Date.now() - startedAt;
const assembly = isRecord(raw["assembly"]) ? raw["assembly"] : {};
const stages = Array.isArray(raw["stages"]) ? raw["stages"] : [];
const backtest = stages.filter(isRecord).find((s) => s["stageId"] === "backtest");
const output = backtest !== undefined && isRecord(backtest["output"]) ? backtest["output"] : null;

console.log(`\n=== loopRun（真实 HTTP 路径）${ms}ms ===`);
console.log(`   overall=${JSON.stringify(raw["overall"])}`);
console.log(
  `   assembly: source=${String(assembly["datasetSource"])} versionId=${String(assembly["datasetVersionId"])} rows=${String(assembly["datasetRowCount"])} gate=${String(assembly["datasetGate"])} recipe=${String(assembly["recipeId"])}`,
);
console.log(`   sourceNote=${String(assembly["datasetSourceNote"])}`);

if (output === null) {
  fail("backtest 阶段未产出 output（前端将无可展示数据）");
} else {
  const stats = isRecord(output["executionStats"]) ? output["executionStats"] : null;
  const byReason = stats !== null && isRecord(stats["byReason"]) ? stats["byReason"] : {};
  const curve = Array.isArray(output["equityCurve"]) ? (output["equityCurve"] as unknown[]) : [];
  const trades = Array.isArray(output["trades"]) ? (output["trades"] as unknown[]) : [];
  const skipped = Array.isArray(output["skippedCounts"]) ? (output["skippedCounts"] as unknown[]) : [];
  const equities = curve
    .filter(isRecord)
    .map((p) => (typeof p["equity"] === "number" ? p["equity"] : NaN))
    .filter((v) => Number.isFinite(v));
  const distinctEquity = new Set(equities.map((v) => v.toFixed(2))).size;

  console.log(
    `   backtest.output: tradeCount=${String(output["tradeCount"])} finalEquity=${String(output["finalEquity"])} curvePoints=${curve.length} 明细trades=${trades.length} truncated=${String(output["tradesTruncated"])}`,
  );
  console.log(`   executionStats=${JSON.stringify(stats)}`);
  console.log(`   skippedCounts=${JSON.stringify(skipped)}`);
  console.log(`   权益曲线取值变化（去重后点数）= ${distinctEquity} / ${equities.length}`);

  // 1. 回落事实必须如实记录
  if (assembly["datasetSource"] !== "rebuild") {
    fail(`datasetSource 应为 rebuild（不可撮合回落），实际 ${String(assembly["datasetSource"])}`);
  } else {
    ok("数据集已按「不可撮合」判据回落重建");
  }
  const note = String(assembly["datasetSourceNote"] ?? "");
  if (!note.includes("不可用于撮合") && !note.includes("不可撮合")) {
    fail(`datasetSourceNote 未说明回落原因：${note}`);
  } else {
    ok("datasetSourceNote 如实说明「直读成功但不可撮合」");
  }
  // 2. 真成交
  const tradeCount = typeof output["tradeCount"] === "number" ? (output["tradeCount"] as number) : 0;
  if (tradeCount <= 0) fail(`tradeCount=${tradeCount}，仍是 0 成交`);
  else ok(`真实成交 ${tradeCount} 笔`);
  // 3. 拒单原因不再是 SUSPENDED（改动前 100% 是它）
  const suspended = typeof byReason["SUSPENDED"] === "number" ? (byReason["SUSPENDED"] as number) : 0;
  if (suspended > 0) fail(`仍存在 SUSPENDED 拒单 ${suspended} 单（执行日缺行情）`);
  else ok("无 SUSPENDED 拒单（执行日行情齐备）");
  // 4. 曲线非平
  if (distinctEquity <= 1) fail("权益曲线仍是平的（全是同一个值）");
  else ok(`权益曲线有 ${distinctEquity} 个不同取值（非平）`);
  // 5. 明细进入产出 ⇒ 前端可展示
  if (curve.length === 0) fail("equityCurve 未进入阶段产出");
  if (stats === null) fail("executionStats 未进入阶段产出");
  if (trades.length > 0) ok("成交明细已进入阶段产出（前端可列表展示）");
}

console.log(`\n=========== 结论 ===========`);
console.log(failures === 0 ? "✅ 运行策略现在产出可展示的真实数据。" : `🔴 ${failures} 条断言失败。`);

writeFileSync(
  "docs/evidence/_probe_after_fix_backtest_output.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), ms, failures, overall: raw["overall"], assembly, output }, null, 2),
);
process.exit(failures === 0 ? 0 : 1);
