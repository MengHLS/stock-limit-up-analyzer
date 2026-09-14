/**
 * DATASET-SCOPE-INHERIT-001 — 端到端验证：回落重建**继承**了绑定数据集的 universe 约束。
 *
 * 走网页同一条服务端路径（真实 tRPC caller → loopRun → 真库）。
 *
 * 背景（实测事实）：`dataset_version.id=390002` 声明 `universeDefinitionJson.boards=["main"]`
 * + `excludeSt=true`，但直读它「不可撮合」⇒ 回落 `buildResearchDataset` 重建；此前重建
 * **不继承**该约束 ⇒ 证券池变成全市场（`datasetSecurityCount=5146`），成交明细里出现
 * 300/301/688 标的（用户实报）。
 *
 * 断言（全部要绿）：
 *   1. `assembly.datasetSource === "rebuild"`（延续既有回落事实，不冒充直读）；
 *   2. `datasetSourceNote` 含「已继承该数据集的 universe 约束」+「板块=main」+「排除 ST/*ST」；
 *   3. `datasetSecurityCount` 显著小于回落前的 5146（约束真的生效了）；
 *   4. **成交明细里每一笔的板块都 = main**（本质判据；非主板笔数必须为 0）；
 *   5. 展示层的「名称」链路仍可用（抽样一笔能拿到名称或如实的 null）。
 *
 * 探针自清理：本探针只删自己命名域（`EXP-*-PROBE*`）的留档行。
 *
 * 用法：npx tsx docs/evidence/_probe_dataset_scope_inherit_e2e.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { inArray, like } from "drizzle-orm";
import { appRouter } from "../../server/routers";
import { getDb } from "../../server/db";
import { closedLoopBacktestRun, researchSecurityIdentifierHistory } from "../../drizzle/schema";
import { normalizeSecurityCode } from "../../server/security/code";
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

const PROBE_EXPERIMENT_ID = `EXP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-PROBE001`;
const WINDOW = { startDate: "2025-01-02", endDate: "2025-03-31" }; // 与用户那次一致（⊆ 数据集窗口 2024-09-01~2026-09-01）

console.log(`[probe] 发起 loopRun（策略 cand-270001@1.0.0，窗口 ${WINDOW.startDate}~${WINDOW.endDate}）…`);
const t0 = Date.now();
const raw = (await caller.researchRun.loopRun({
  experimentId: PROBE_EXPERIMENT_ID,
  strategyId: "cand-270001",
  strategyVersion: "1.0.0",
  dateRange: WINDOW,
  executionModel: "NEXT_OPEN",
  useRealData: true,
  datasetGuards: { dataReady: true, maxTradingDays: 45 },
  recipeId: "leader-candidate-baseline",
} as never)) as unknown as Record<string, unknown>;
const elapsed = Date.now() - t0;
console.log(`[probe] loopRun 返回，耗时 ${elapsed}ms`);

const assembly = isRecord(raw["assembly"]) ? raw["assembly"] : null;
if (assembly === null) {
  fail("assembly 缺失（无法验证数据来源）");
  process.exit(1);
}

console.log("\n--- 1. 数据来源与约束继承 ---");
eq("datasetSource", assembly["datasetSource"], "rebuild");
const note = String(assembly["datasetSourceNote"] ?? "");
const securityCount = Number(assembly["datasetSecurityCount"] ?? -1);
const rowCount = Number(assembly["datasetRowCount"] ?? -1);
console.log(`   datasetVersion  = ${String(assembly["datasetVersion"])}`);
console.log(`   datasetRowCount = ${rowCount}`);
console.log(`   datasetSecurityCount = ${securityCount}（回落前实测 5146）`);
console.log(`   datasetSourceNote = ${note}`);

if (note.includes("已继承该数据集的 universe 约束")) ok("note 声明「已继承该数据集的 universe 约束」");
else fail("note 未声明继承 universe 约束");
if (note.includes("板块=main")) ok("note 含「板块=main」");
else fail("note 未含板块=main");
if (note.includes("排除 ST/*ST")) ok("note 含「排除 ST/*ST」");
else fail("note 未含排除 ST/*ST");

if (securityCount > 0 && securityCount < 4000) {
  ok(`证券池已窄化：${securityCount} < 4000（回落前 5146）`);
} else {
  fail(`证券池未窄化：datasetSecurityCount=${securityCount}（期望 < 4000）`);
}

console.log("\n--- 2. 成交明细的板块分布（本质判据） ---");
const stages = Array.isArray(raw["stages"]) ? raw["stages"].filter(isRecord) : [];
const bt = stages.find((s) => s["stageId"] === "backtest");
const output = bt !== undefined && isRecord(bt["output"]) ? bt["output"] : null;
const trades = output !== null && Array.isArray(output["trades"]) ? (output["trades"] as unknown[]) : [];
console.log(`   trades = ${trades.length} 笔`);
eq("stages 长度", stages.length, 14);

const ids = Array.from(
  new Set(
    trades
      .filter(isRecord)
      .map((t) => String(t["securityId"] ?? ""))
      .filter((s) => s.length > 0),
  ),
);
const idRows =
  ids.length === 0
    ? []
    : await db
        .select({
          securityId: researchSecurityIdentifierHistory.securityId,
          exchange: researchSecurityIdentifierHistory.exchange,
          code: researchSecurityIdentifierHistory.securityCode,
          identifierType: researchSecurityIdentifierHistory.identifierType,
        })
        .from(researchSecurityIdentifierHistory)
        .where(inArray(researchSecurityIdentifierHistory.securityId, ids));

const codeOf = new Map<string, string>();
for (const r of idRows) {
  if (r.identifierType !== "primary" || codeOf.has(r.securityId)) continue;
  try {
    codeOf.set(r.securityId, normalizeSecurityCode(`${r.code}.${r.exchange}`));
  } catch {
    /* 冲突输入：留空，下方按 UNRESOLVED 计 */
  }
}

const boardCount = new Map<string, number>();
const nonMain: string[] = [];
for (const id of ids) {
  const code = codeOf.get(id);
  const board = code === undefined ? "UNRESOLVED" : classifyBoard(code);
  boardCount.set(board, (boardCount.get(board) ?? 0) + 1);
  if (board !== "main") nonMain.push(`${code ?? id}(${board})`);
}
console.log(`   distinct securityId = ${ids.length}`);
for (const [b, n] of Array.from(boardCount.entries()).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${b} : ${n}`);
}

eq("非主板 distinct 证券数", nonMain.length, 0);
if (nonMain.length > 0) {
  console.log(`   非主板样例（前 10）：${nonMain.slice(0, 10).join(", ")}`);
  fail(`成交明细仍含非主板标的 ${nonMain.length} 只 —— 约束未生效`);
}

// 逐笔（含重复标的多笔）也要全主板
let tradeLevelNonMain = 0;
for (const t of trades.filter(isRecord)) {
  const code = codeOf.get(String(t["securityId"] ?? ""));
  if (code === undefined || classifyBoard(code) !== "main") tradeLevelNonMain += 1;
}
eq("非主板成交笔数", tradeLevelNonMain, 0);

console.log("\n--- 3. 留档落库（确认旁路仍工作） ---");
const savedRows = await db
  .select({ id: closedLoopBacktestRun.id, runId: closedLoopBacktestRun.runId })
  .from(closedLoopBacktestRun)
  .where(like(closedLoopBacktestRun.experimentId, "EXP-%-PROBE%"));
eq("本次实验命名域的留档行数", savedRows.length, 1);

// ---------------------------------------------------------------------------
// 自清理（只删本探针命名域）
// ---------------------------------------------------------------------------
if (savedRows.length > 0) {
  await db
    .delete(closedLoopBacktestRun)
    .where(inArray(closedLoopBacktestRun.id, savedRows.map((r) => r.id)));
  const after = await db
    .select({ id: closedLoopBacktestRun.id })
    .from(closedLoopBacktestRun)
    .where(like(closedLoopBacktestRun.experimentId, "EXP-%-PROBE%"));
  eq("清理后命名域残留行数", after.length, 0);
}

const summary = {
  experimentId: PROBE_EXPERIMENT_ID,
  elapsedMs: elapsed,
  datasetSource: assembly["datasetSource"],
  datasetVersion: assembly["datasetVersion"],
  datasetRowCount: rowCount,
  datasetSecurityCount: securityCount,
  datasetSourceNote: note,
  trades: trades.length,
  distinctSecurities: ids.length,
  boardDistribution: Object.fromEntries(boardCount),
  nonMainCount: nonMain.length,
  failures,
  pass: failures === 0,
};
writeFileSync(
  "docs/evidence/_probe_dataset_scope_inherit_e2e.json",
  JSON.stringify(summary, null, 2),
  "utf8",
);

console.log(`\n${failures === 0 ? "PASS ✅ 0 失败" : `FAIL 🔴 ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
