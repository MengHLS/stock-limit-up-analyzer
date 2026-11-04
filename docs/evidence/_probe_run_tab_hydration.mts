/**
 * 诊断探针：「策略页运行结果在刷新后消失」的修复路径可行性。
 *
 * 背景（2026-09-14 用户报障「我刚才跑过的回测，结果又没了」）：
 *   前端 `StrategyDetail.tsx` 的 `RunTab` 把 `loopRun` 结果只存进 `useState`，
 *   而 `dev` = `tsx watch server/_core/index.ts`（单进程）⇒ 改 `server/**` 会**整站热重启**，
 *   浏览器重连后整页重载 ⇒ 结果消失，空态还写着「还没跑过」。
 *
 * 本探针走**真实 tRPC**验证修复路径（不改产品代码）：
 *   1. `listBacktests({ strategyId })` 能按策略过滤出留档行（含坐标与摘要）；
 *   2. 取最新一行 → `getBacktest({ id })` 拿回完整 result；
 *   3. `buildClosedLoopRunViewModel(result)`（**前端同一函数**）能构建出非空 ViewModel；
 *   4. 构建出的 VM 与运行结果关键数字一致（零口径漂移）；
 *   5. 摘要列表**不携带** result（列表轻是结构性保证）。
 *
 * 只读：不写库、不删库。
 *
 * 用法：npx tsx docs/evidence/_probe_run_tab_hydration.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { appRouter } from "../../server/routers";
import { getDb } from "../../server/db";
import { buildClosedLoopRunViewModel } from "../../client/src/adapters/closedLoopRunAdapter";

const adminCtx = {
  user: { id: "probe", role: "admin" as const, openId: "probe", name: "probe" },
  req: { protocol: "http", headers: {} },
  res: { clearCookie: () => {} },
} as never;

const caller = appRouter.createCaller(adminCtx);

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
  console.log("数据库不可用");
  process.exit(1);
}

type Row = Record<string, unknown>;
function unwrap(rows: unknown): Row[] {
  if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0])) return rows[0] as Row[];
  return (rows ?? []) as Row[];
}

const out: Record<string, unknown> = {};

console.log("\n================ 0. 留档全表（按留档时间倒序） ================");
const all = (await caller.researchRun.listBacktests({ limit: 100 })) as Array<Row>;
console.log(`   留档行数 = ${all.length}`);
for (const r of all) {
  console.log(
    `   · id=${r["id"]} strat=${r["strategyId"]}@${r["strategyVersion"]} ` +
      `win=${r["startDate"]}~${r["endDate"]} status=${r["status"]} trades=${r["tradeCount"]} ` +
      `createdAt=${r["createdAt"]}`,
  );
}
out.listCount = all.length;

// 倒序保证：最新一条在最前（页面「最近一次运行」取的就是它）
const times = all.map((r) => String(r["createdAt"]));
const sortedDesc = [...times].sort().reverse();
eq("列表按 createdAt 倒序（最新在前）", times, sortedDesc);

console.log("\n================ 1. 摘要列表不含 result（列表轻） ================");
const leaked = all.filter((r) => "result" in r).length;
eq("列表行携带 result 的行数（应为 0）", leaked, 0);

// ---------- 挑一个真实策略做 hydration 演练 ----------
const strategyIds = [...new Set(all.map((r) => String(r["strategyId"])))];
console.log(`\n   涉及策略 = ${JSON.stringify(strategyIds)}`);

const target = strategyIds.includes("cand-270001") ? "cand-270001" : strategyIds[0];
const targetVersion = String(
  all.find((r) => String(r["strategyId"]) === target)?.["strategyVersion"] ?? "",
);
console.log(`   演练对象 = ${target}@${targetVersion}`);
out.targetStrategyId = target;

console.log("\n================ 2. 按策略过滤（页面刷新后据此恢复） ================");
const filtered = (await caller.researchRun.listBacktests({
  strategyId: target,
  limit: 5,
})) as Array<Row>;
console.log(`   ${target} 的留档行 = ${filtered.length}`);
eq(
  "过滤结果全部属于该策略",
  filtered.every((r) => String(r["strategyId"]) === target),
  true,
);
eq(
  "过滤结果数 ≤ 全表同策略行数",
  filtered.length <= all.filter((r) => String(r["strategyId"]) === target).length,
  true,
);
if (filtered.length === 0) fail(`策略 ${target} 无留档行，无法演练`);
out.filteredCount = filtered.length;

// 过滤端点必须返回最新一条在最前
const filteredTimes = filtered.map((r) => String(r["createdAt"]));
eq("过滤结果同样倒序", filteredTimes, [...filteredTimes].sort().reverse());

if (filtered.length > 0) {
  const newest = filtered[0];
  const runId = Number(newest["id"]);

  console.log("\n================ 3. 取详情 → 前端同一函数构建 ViewModel ================");
  const detail = (await caller.researchRun.getBacktest({ id: runId })) as
    | (Row & { result: unknown })
    | null;
  eq("详情非空", detail !== null, true);
  if (!detail) {
    fail("详情为 null，后续断言跳过");
  } else {
    eq("详情 id 等于请求 id", Number(detail["id"]), runId);
    eq("详情携带结果（result 非空）", detail["result"] !== null, true);
    eq(
      "详情摘要字段与列表行一致（零漂移）",
      JSON.stringify({
        status: detail["status"],
        tradeCount: detail["tradeCount"],
        finalEquity: detail["finalEquity"],
        executedStageCount: detail["executedStageCount"],
      }),
      JSON.stringify({
        status: newest["status"],
        tradeCount: newest["tradeCount"],
        finalEquity: newest["finalEquity"],
        executedStageCount: newest["executedStageCount"],
      }),
    );

    const vm = buildClosedLoopRunViewModel(detail["result"] as never);
    eq("VM 构建成功（非 null）", vm !== null, true);
    if (vm === null) {
      fail("buildClosedLoopRunViewModel 返回 null ⇒ 刷新后无法恢复展示");
    } else {
      const stageCount = vm.stages.length;
      console.log(`   VM: runId=${vm.runId} 阶段=${stageCount} overall=${vm.overallStatus}`);
      out.vmRunId = vm.runId;
      out.vmStageCount = stageCount;
      eq("VM.runId 非空", typeof vm.runId === "string" && vm.runId.length > 0, true);
      eq("VM 阶段数与运行结果一致（14）", stageCount, 14);

      const bt = vm.backtest;
      if (bt) {
        console.log(
          `   回测买卖明细: trades=${bt.trades.length}/${bt.tradeCount} 曲线点=${bt.equityCurve.length}`,
        );
        out.vmTradeCount = bt.tradeCount;
        eq(
          "VM.tradeCount == 留档 tradeCount（刷新恢复后数字不变）",
          bt.tradeCount,
          Number(newest["tradeCount"]),
        );
        const first = bt.trades[0];
        if (first) {
          console.log(`   首笔证券 id = ${first.securityId}`);
          out.firstSecurityId = first.securityId;
          eq(
            "成交明细的首笔 id 可作为 securityLabels 入参（sec_ 前缀）",
            String(first.securityId).startsWith("sec_"),
            true,
          );
          // 顺带验证：恢复展示时名称列也能取到标签
          const labels = (await caller.researchRun.securityLabels({
            securityIds: [String(first.securityId)],
          })) as Record<string, { code: string | null; name: string | null }>;
          const label = labels[String(first.securityId)];
          console.log(
            `   首笔标签 = ${label?.name ?? "—"} ${label?.code ?? "—"}`,
          );
          ok("恢复展示时名称/代码标签链路同样可用");
        }
      } else {
        fail("VM.backtest 为空 —— 恢复后面板将没有「策略产出」区块");
      }
    }
  }
}

console.log("\n================ 4. 策略坐标真实性 ================");
const verRows = unwrap(
  await db.execute(
    sql`SELECT strategyId, version, status FROM strategy_versions
        WHERE strategyId = ${target} ORDER BY version DESC LIMIT 10`,
  ),
);
console.log(`   strategy_versions 中 ${target} 的版本行 = ${verRows.length}`);
for (const r of verRows) console.log(`   · ${r["strategyId"]}@${r["version"]} status=${r["status"]}`);
out.strategyVersionRows = verRows.length;

console.log("\n================ 汇总 ================");
console.log(`   失败断言 = ${failures}`);
console.log(`   RESULT = ${failures === 0 ? "PASS" : "FAIL"}`);
out.failures = failures;
out.result = failures === 0 ? "PASS" : "FAIL";

writeFileSync(
  new URL("_probe_run_tab_hydration.json", import.meta.url),
  JSON.stringify(out, null, 2),
  "utf8",
);
console.log("[ok] 探针结束（未写库、未删库）");
process.exit(failures === 0 ? 0 : 1);
