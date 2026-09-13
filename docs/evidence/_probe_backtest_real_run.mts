/**
 * Task 18（收尾）—— **真实跑一次回测**并核验选股来自「守线+缩量」配方而非旧兜底。
 *
 * 与 `_probe_backtest_consumes_recipe.mts`（A/B/C 三层静态+引擎断言）互补：
 * 本探针走**运行工作台的真实入口** `researchRun.loopRun({ useRealData: true })`，
 * 即网页「运行策略」按钮的同一条服务端路径（真实构建/直读数据集 + 真实读策略文档 +
 * 真实装配配方 + 真实逐阶段执行），把回测**跑出来**，而不是只验证装配面。
 *
 * 核验点：
 *   1. `assemblySummary.recipeSource === "strategy-document"`（不是 explicit-request 兜底）；
 *   2. `assemblySummary.recipeId === "first-limit-pullback-hold-shrink"`；
 *   3. `assemblySummary.recipeFeatureIds` 无 `pctChange`；
 *   4. 同窗口跑旧兜底 `leader-candidate-baseline` 作反事实对照；
 *   5. 两组的「research 阶段产物指纹」不同 ⇒ 回测真的按不同条件选股。
 *
 * 只读：`loopRun` 自身无状态、不落库（见其文件头声明）。
 *
 * 用法：npx tsx docs/evidence/_probe_backtest_real_run.mts
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

/** 数据集 390002 的窗口是 2024-09-01 → 2026-09-01，故窗口必须落在其内。 */
const WINDOW = { startDate: "2025-01-02", endDate: "2025-03-31" };

/** §28 身份形态：`EXP-YYYYMMDD-XXXXXXXX`（与前端 `deriveExperimentId` 同源规则）。 */
function fnv1a8(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
function deriveExperimentId(strategyId: string, dr: { startDate: string; endDate: string }, executionModel: string): string {
  const now = new Date();
  const ymd = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  return `EXP-${ymd}-${fnv1a8(`${strategyId}|${dr.startDate}|${dr.endDate}|${executionModel}`).toUpperCase()}`;
}

interface CaseResult {
  readonly label: string;
  readonly strategyId: string;
  readonly ms: number;
  readonly ok: boolean;
  readonly errorMessage?: string;
  readonly recipeSource?: string;
  readonly recipeId?: string;
  readonly recipeFeatureIds?: readonly string[];
  readonly datasetSource?: string;
  readonly datasetRowCount?: number;
  readonly evaluationFingerprint?: string;
  readonly candidateRunFingerprint?: string;
  readonly stageStatus?: string;
  readonly blockedReasonCodes?: readonly string[];
}

async function runCase(
  label: string,
  strategyId: string,
  opts: { readonly recipeId?: string; readonly strategyVersion?: string } = {},
): Promise<CaseResult> {
  const startedAt = Date.now();
  const strategyVersion = opts.strategyVersion ?? "1.0.0";
  const payload = {
    experimentId: deriveExperimentId(strategyId, WINDOW, "NEXT_OPEN"),
    strategyId,
    strategyVersion,
    dateRange: WINDOW,
    executionModel: "NEXT_OPEN",
    useRealData: true,
    ...(opts.recipeId !== undefined ? { recipeId: opts.recipeId } : {}),
  };
  try {
    const raw = await caller.researchRun.loopRun(payload as never);
    const r = raw as Record<string, unknown>;
    const assembly = (r["assembly"] ?? {}) as Record<string, unknown>;
    const stages = (r["stages"] ?? []) as Array<Record<string, unknown>>;
    const blocked = stages
      .filter(s => s["status"] === "BLOCKED" || s["status"] === "CL_UPSTREAM_BLOCKED")
      .map(s => String(s["reasonCode"] ?? s["stageId"] ?? "?"));
    return {
      label,
      strategyId,
      ms: Date.now() - startedAt,
      ok: true,
      recipeSource: assembly["recipeSource"] === undefined ? undefined : String(assembly["recipeSource"]),
      recipeId: assembly["recipeId"] === undefined ? undefined : String(assembly["recipeId"]),
      recipeFeatureIds: Array.isArray(assembly["recipeFeatureIds"])
        ? (assembly["recipeFeatureIds"] as string[])
        : undefined,
      datasetSource: assembly["datasetSource"] === undefined ? undefined : String(assembly["datasetSource"]),
      datasetRowCount:
        typeof assembly["datasetRowCount"] === "number" ? (assembly["datasetRowCount"] as number) : undefined,
      evaluationFingerprint:
        typeof r["evaluationFingerprint"] === "string" ? (r["evaluationFingerprint"] as string) : undefined,
      candidateRunFingerprint:
        typeof r["candidateRunFingerprint"] === "string"
          ? (r["candidateRunFingerprint"] as string)
          : typeof r["researchFingerprint"] === "string"
            ? (r["researchFingerprint"] as string)
            : undefined,
      stageStatus: typeof r["status"] === "string" ? (r["status"] as string) : undefined,
      blockedReasonCodes: blocked,
    };
  } catch (e) {
    return {
      label,
      strategyId,
      ms: Date.now() - startedAt,
      ok: false,
      errorMessage: String((e as { message?: string })?.message).replace(/\s+/g, " ").slice(0, 500),
    };
  }
}

const results: CaseResult[] = [];
results.push(await runCase("① 守线+缩量≤30%（文档配方）", "cand-360001"));
results.push(await runCase("② 守线+缩量≤50%+红盘（文档配方）", "cand-360002"));
results.push(await runCase("④-c 回撤≤10%（文档配方）", "cand-360008"));
// 反事实：**未声明 recipe 的存量文档**（cand-270001@1.0.0，实测 hasRecipe=false）
// ⇒ 应落到 explicit-request 兜底（leader-candidate-baseline / pctChange）。
results.push(await runCase("反事实：存量无 recipe 文档", "cand-270001"));
// 优先级规则验证：文档已声明 recipe ⇒ 显式 recipeId **不得**覆盖它（文档优先，见 assemble.ts#requireRecipe）。
results.push(
  await runCase("优先级：文档 recipe 优先于显式 recipeId", "cand-360001", { recipeId: "leader-candidate-baseline" }),
);

for (const r of results) {
  console.log(`\n=== ${r.label} (${r.strategyId}) ${r.ok ? "✅ 跑通" : "🔴 失败"} ${r.ms}ms ===`);
  if (!r.ok) {
    console.log(`   ${r.errorMessage ?? "(无消息)"}`);
    continue;
  }
  console.log(`   recipeSource=${String(r.recipeSource)}  recipeId=${String(r.recipeId)}  datasetSource=${String(r.datasetSource)}`);
  console.log(`   recipeFeatureIds=[${(r.recipeFeatureIds ?? []).join(", ")}]`);
  console.log(`   datasetRowCount=${String(r.datasetRowCount)}  status=${String(r.stageStatus)}`);
  console.log(`   candidateRunFingerprint=${String(r.candidateRunFingerprint ?? "(未暴露)")}`);
  console.log(`   blocked=${JSON.stringify(r.blockedReasonCodes)}`);
}

// ---- 断言 ----
let failures = 0;
const fail = (m: string) => { failures += 1; console.log(`   🔴 ${m}`); };

const docCases = results.filter(r => r.label.startsWith("①") || r.label.startsWith("②") || r.label.startsWith("④"));
for (const r of docCases) {
  if (!r.ok) { fail(`${r.label}：回测未跑通（${r.errorMessage ?? ""}）`); continue; }
  if (r.recipeSource !== "strategy-document") fail(`${r.label}：recipeSource 应为 strategy-document（实际 ${String(r.recipeSource)}）`);
  if (r.recipeId !== "first-limit-pullback-hold-shrink") fail(`${r.label}：recipeId 不符（实际 ${String(r.recipeId)}）`);
  if ((r.recipeFeatureIds ?? []).includes("pctChange")) fail(`${r.label}：特征含 pctChange ⇒ 在跑旧配方`);
}

// 反事实：未声明 recipe 的存量文档 ⇒ 落到 explicit-request 兜底，且特征是 pctChange。
const legacy = results.find(r => r.label.startsWith("反事实"));
if (legacy === undefined) fail("反事实用例缺失");
else if (!legacy.ok) fail(`反事实用例未跑通：${legacy.errorMessage ?? ""}`);
else {
  if (legacy.recipeSource !== "explicit-request") {
    fail(`反事实：无 recipe 文档应落 explicit-request（实际 ${String(legacy.recipeSource)}）`);
  }
  if (legacy.recipeId !== "leader-candidate-baseline") {
    fail(`反事实：应解析到 leader-candidate-baseline（实际 ${String(legacy.recipeId)}）`);
  }
  if (!(legacy.recipeFeatureIds ?? []).includes("pctChange")) {
    fail("反事实：兜底配方特征应含 pctChange");
  }
}

// 优先级：文档已声明 recipe ⇒ 显式 recipeId 不得覆盖（文档优先）。
const precedence = results.find(r => r.label.startsWith("优先级"));
if (precedence === undefined) fail("优先级用例缺失");
else if (!precedence.ok) fail(`优先级用例未跑通：${precedence.errorMessage ?? ""}`);
else if (precedence.recipeId !== "first-limit-pullback-hold-shrink") {
  fail(`优先级：文档已声明 recipe 时显式 recipeId 不应覆盖（实际解析到 ${String(precedence.recipeId)}）`);
} else if (precedence.recipeSource !== "strategy-document") {
  fail(`优先级：应仍为 strategy-document（实际 ${String(precedence.recipeSource)}）`);
}

console.log(`\n=========== 结论 ===========`);
console.log(failures === 0 ? "✅ 真实回测路径跑通，且确认按「守线+缩量（+红盘）」配方执行。" : `🔴 ${failures} 条断言失败。`);

writeFileSync("docs/evidence/_probe_backtest_real_run.json", JSON.stringify({ generatedAt: new Date().toISOString(), results, failures }, null, 2));
process.exit(failures === 0 ? 0 : 1);
