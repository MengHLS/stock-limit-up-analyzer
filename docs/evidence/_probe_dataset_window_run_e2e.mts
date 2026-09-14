/**
 * DATASET-WINDOW-PROJECTION-001 — 端到端验证：**运行策略真正消费被绑定的数据集**。
 *
 * 走网页同一条服务端路径（真实 tRPC caller → `loopRun` → 真库），策略用真库里
 * `definition.entry.observationWindow = {start:1, end:3, unit:TRADING_DAY}` 的
 * `cand-360004@1.0.0`（绑定 `dataset_version.id=390002`）。
 *
 * 本轮修复前的事实：直读桥只投影 `prefix` 的 rd=0 ⇒ `executionBarsAvailable=false`
 * ⇒ 每次都回落 `buildResearchDataset` 回查 `stock_daily_prices` / `liquidity_daily`。
 * 修复后：桥按观察窗口投影 rd=0（首板日，特征基准）+ rd ∈ [1, 4]（观察日 + 次日执行日），
 * 决策日资格 = rd ∈ [1, 3] ⇒ **可撮合**。
 *
 * 断言（全部要绿）：
 *   1. `assembly.datasetSource === "registry"`（不再回落）且 `datasetSourceNote === null`；
 *   2. `assembly.datasetVersionId === 390002`（跑的就是绑定的那一份）；
 *   3. 成交真的发生（`trades.length > 0`、期末权益 ≠ 初始资金）—— 这是「可撮合」的本质判据；
 *   4. **成交 securityId 是 canonical `sec_<uuid>`（身份域），不是代码** —— 留档/展示层
 *      （`closedLoopBacktestRun/securityLabels.ts`、前端 `useSecurityLabels`）按此域解析；
 *   5. 用**权威** `researchRun.securityLabels` 解析这些身份 ⇒ 全部拿到代码，且代码全为主板
 *      （数据集自身约束）；
 *   6. 留档行落库（best-effort 旁路仍工作）。
 *
 * 探针自清理：只删本探针命名域（`experimentId` 含 `PROBEWIN`）**且** `strategyId` 以 `cand-` 开头的行；
 * 只命中单侧守卫的行**只列出、不自动删**。
 *
 * 用法（项目根目录）：npx tsx docs/evidence/_probe_dataset_window_run_e2e.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { inArray, like } from "drizzle-orm";
import { appRouter } from "../../server/routers";
import { getDb } from "../../server/db";
import { closedLoopBacktestRun } from "../../drizzle/schema";
import { classifyBoard } from "../../server/data/boardRules";

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
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(`${label} = ${JSON.stringify(actual)}`);
  else fail(`${label} 不符：实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
};
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const db = await getDb();
if (!db) {
  console.log("数据库不可用");
  process.exit(1);
}

const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const PROBE_EXPERIMENT_ID = `EXP-${STAMP}-PROBEWIN01`;
const WINDOW = { startDate: "2025-01-02", endDate: "2025-03-31" };

console.log(`[probe] 发起 loopRun（cand-360004@1.0.0，窗口 ${WINDOW.startDate}~${WINDOW.endDate}）…`);
const t0 = Date.now();
const raw = (await caller.researchRun.loopRun({
  experimentId: PROBE_EXPERIMENT_ID,
  strategyId: "cand-360004",
  strategyVersion: "1.0.0",
  dateRange: WINDOW,
  executionModel: "NEXT_OPEN",
  useRealData: true,
  datasetGuards: { dataReady: true },
} as never)) as unknown as Record<string, unknown>;
const elapsed = Date.now() - t0;
console.log(`[probe] loopRun 返回，耗时 ${elapsed}ms`);

const assembly = isRecord(raw["assembly"]) ? raw["assembly"] : null;
if (assembly === null) {
  fail("assembly 缺失（无法验证数据来源）");
  process.exit(1);
}

console.log("\n--- 1. 数据来源：必须直读绑定数据集，不得回落 ---");
eq("datasetSource", assembly["datasetSource"], "registry");
eq("datasetSourceNote", assembly["datasetSourceNote"], null);
eq("datasetVersionId", assembly["datasetVersionId"], 390002);
const rowCount = Number(assembly["datasetRowCount"] ?? -1);
// 🔴 wire 字段名是 `datasetSecurityCount`（内部 `LoopRunAssemblySummary.datasetSecretCount`
// 由 researchRunRouter 改名后下发）——此前误读 `datasetSecretCount` ⇒ 恒 -1。
const securityCount = Number(assembly["datasetSecurityCount"] ?? -1);
console.log(`   datasetVersion      = ${String(assembly["datasetVersion"])}`);
console.log(`   datasetGate         = ${String(assembly["datasetGate"])}`);
console.log(`   datasetRowCount     = ${rowCount}`);
console.log(`   datasetSecurityCount= ${securityCount}`);
if (rowCount > 0 && securityCount > 0) ok(`投影出真实面板：${rowCount} 行 / ${securityCount} 证券`);
else fail(`面板为空：rows=${rowCount}, securities=${securityCount}`);
// rd ∈ [0,4] 的去重面板必须显著多于「每事件恰一行」的 23,978（>1.5× 即证明确实扩了窗口）
if (rowCount > 35_000) ok(`行数 ${rowCount} > 35,000 ⇒ 确已并入观察日 + 执行日（旧投影恒为 23,978）`);
else fail(`行数偏少（${rowCount}）⇒ 窗口似乎未并入`);

console.log("\n--- 2. 阶段执行与成交（「可撮合」的本质判据） ---");
const stages = Array.isArray(raw["stages"]) ? raw["stages"].filter(isRecord) : [];
eq("stages 长度", stages.length, 14);
const bt = stages.find((s) => s["stageId"] === "backtest");
eq("backtest 阶段状态", bt?.["state"], "EXECUTED");
const output = bt !== undefined && isRecord(bt["output"]) ? bt["output"] : null;
const trades = output !== null && Array.isArray(output["trades"]) ? (output["trades"] as unknown[]) : [];
const initialCapital = Number(output?.["initialCapital"] ?? NaN);
const finalEquity = Number(output?.["finalEquity"] ?? NaN);
console.log(`   trades = ${trades.length} 笔`);
console.log(`   initialCapital = ${initialCapital}  finalEquity = ${finalEquity}`);
console.log(`   executionStats = ${JSON.stringify(output?.["executionStats"] ?? null)}`);
if (trades.length > 0) ok(`真实成交 ${trades.length} 笔（修复前 registry 路径恒 0 笔 / 全 SUSPENDED）`);
else fail("成交 0 笔 —— 可撮合性未生效");
if (Number.isFinite(initialCapital) && Number.isFinite(finalEquity) && finalEquity !== initialCapital) {
  ok(`期末权益 ${finalEquity} ≠ 初始资金 ${initialCapital} ⇒ 撮合真实发生`);
} else {
  fail(`权益曲线未变化（initial=${initialCapital}, final=${finalEquity}）`);
}

console.log("\n--- 3. 身份域：成交 securityId 必须是 canonical sec_<uuid>，并能解析回代码 ---");
const tradedIds = Array.from(
  new Set(trades.filter(isRecord).map((t) => String(t["securityId"] ?? "")).filter((s) => s.length > 0)),
);
console.log(`   distinct 成交 securityId = ${tradedIds.length}`);

// 3a. 形态断言：身份域（sec_<uuid>）而非代码域。旧直读桥把代码直接写进 securityId，
//     会让下方 securityLabels 全部查空 ⇒ 名称退化为「—」（键域与重建路径分叉）。
const asCodeLike = tradedIds.filter((id) => /^\d{6}\.[A-Z]{2}$/.test(id));
eq("成交 securityId 里「代码形态」的条数", asCodeLike.length, 0);
if (asCodeLike.length > 0) console.log(`   🔴 样例：${asCodeLike.slice(0, 5).join(", ")}`);
const asIdentity = tradedIds.filter((id) => /^sec_/.test(id));
console.log(`   sec_ 形态 = ${asIdentity.length} / ${tradedIds.length}`);
if (asIdentity.length === tradedIds.length) {
  ok(`全部成交键都是 canonical 身份（sec_<uuid>）`);
} else {
  fail(`存在非 sec_ 形态的成交键`);
}

// 3b. 走**权威**解析端点（网页同一条路径，rules：「名称走 researchRun.securityLabels」）。
const labelMap =
  tradedIds.length === 0
    ? {}
    : ((await caller.researchRun.securityLabels({ securityIds: tradedIds })) as Record<
        string,
        { code: string | null; name: string | null } | undefined
      >);
let resolved = 0;
const boardCount = new Map<string, number>();
const nonMain: string[] = [];
const unresolved: string[] = [];
for (const id of tradedIds) {
  const label = labelMap[id];
  const code = label?.code ?? undefined;
  if (code === undefined) {
    unresolved.push(id);
    boardCount.set("UNRESOLVED", (boardCount.get("UNRESOLVED") ?? 0) + 1);
    continue;
  }
  resolved += 1;
  const board = classifyBoard(code);
  boardCount.set(board, (boardCount.get(board) ?? 0) + 1);
  if (board !== "main") nonMain.push(`${code}(${board})`);
}
for (const [b, n] of Array.from(boardCount.entries()).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${b} : ${n}`);
}
eq("非主板 distinct 证券数", nonMain.length, 0);
if (nonMain.length > 0) console.log(`   样例：${nonMain.slice(0, 10).join(", ")}`);
if (resolved === tradedIds.length) {
  ok(`securityLabels 解析率 100%（${resolved}/${tradedIds.length}）—— 身份域与展示层一致`);
} else {
  fail(`securityLabels 有 ${unresolved.length} 个键解析不到（样例 ${unresolved.slice(0, 5).join(", ")}）`);
}
const nameHits = tradedIds.filter((id) => (labelMap[id]?.name ?? null) !== null).length;
console.log(`   带名称的 = ${nameHits} / ${tradedIds.length}（名称源覆盖非 100%，缺口属数据现实）`);

console.log("\n--- 4. 留档落库（旁路 best-effort） ---");
const saved = await db
  .select({ id: closedLoopBacktestRun.id, runId: closedLoopBacktestRun.runId, source: closedLoopBacktestRun.datasetSource })
  .from(closedLoopBacktestRun)
  .where(like(closedLoopBacktestRun.experimentId, "%PROBEWIN%"));
eq("本次命名域留档行数", saved.length, 1);
if (saved.length === 1) console.log(`   落档 datasetSource = ${String(saved[0]!.source)}`);

// ---------------------------------------------------------------------------
// 自清理（双重命名守卫：experimentId 含 PROBEWIN **且** strategyId 以 cand- 开头）
// ---------------------------------------------------------------------------
console.log("\n--- 5. 自清理 ---");
if (saved.length > 0) {
  const guarded = await db
    .select({ id: closedLoopBacktestRun.id, strategyId: closedLoopBacktestRun.strategyId })
    .from(closedLoopBacktestRun)
    .where(like(closedLoopBacktestRun.experimentId, "%PROBEWIN%"));
  const deletable = guarded.filter((r) => String(r.strategyId).startsWith("cand-")).map((r) => r.id);
  const skipped = guarded.filter((r) => !String(r.strategyId).startsWith("cand-"));
  if (skipped.length > 0) console.log(`   ⚠️ 只命中单侧守卫、不自动删：${JSON.stringify(skipped)}`);
  if (deletable.length > 0) {
    await db.delete(closedLoopBacktestRun).where(inArray(closedLoopBacktestRun.id, deletable));
  }
  const after = await db
    .select({ id: closedLoopBacktestRun.id })
    .from(closedLoopBacktestRun)
    .where(like(closedLoopBacktestRun.experimentId, "%PROBEWIN%"));
  eq("清理后命名域残留行数", after.length, 0);
}

const summary = {
  experimentId: PROBE_EXPERIMENT_ID,
  elapsedMs: elapsed,
  datasetSource: assembly["datasetSource"],
  datasetVersionId: assembly["datasetVersionId"],
  datasetVersion: assembly["datasetVersion"],
  datasetRowCount: rowCount,
  datasetSecurityCount: securityCount,
  backtestState: bt?.["state"] ?? null,
  trades: trades.length,
  initialCapital,
  finalEquity,
  tradedIdentityCount: tradedIds.length,
  tradedCodeLikeCount: asCodeLike.length,
  securityLabelResolved: resolved,
  securityLabelNameHits: nameHits,
  boardCount: Object.fromEntries(boardCount),
  failures,
};
writeFileSync("docs/evidence/_probe_dataset_window_run_e2e.json", JSON.stringify(summary, null, 2), "utf8");
console.log("\n=== summary ===");
console.log(JSON.stringify(summary, null, 2));
console.log(failures === 0 ? "\n✅ ALL PASS" : `\n🔴 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
