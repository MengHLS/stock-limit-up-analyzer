/**
 * 探针：验证 regime 阶段真实执行（subset 链：跳过未装配的 optimization…discipline）。
 *
 * 背景：编排器有一条硬规则 —— **任一阶段阻塞则其后继全部 CL_UPSTREAM_BLOCKED**
 * （`orchestrator.ts:338-350`）。因此要在 optimization 未装配时跑到 regime，必须显式
 * 传一个**保序子集** `stageIds`，把链外阶段声明为 SKIPPED 而非 BLOCKED。
 *
 * 这条规则本身是对的（禁止伪造中间产物），本探针证明的是：
 *   「regime 一旦被请求且其前驱在链内，它就能真跑」。
 *
 * 重跑：项目根目录 `npx tsx docs/evidence/_probe_regime_subset.mts`
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { appRouter } from "../../server/routers";

const OUT = "docs/evidence/_probe_regime_subset.json";

const adminCtx = {
  user: { id: "probe", role: "admin" as const, openId: "probe", name: "probe" },
  req: { protocol: "http", headers: {} },
  res: { clearCookie: () => {} },
} as never;

const caller = appRouter.createCaller(adminCtx);
const startedAt = Date.now();

const input = {
  experimentId: "EXP-20260913-REGIME01",
  strategyId: "limit-up-baseline",
  strategyVersion: "1.1.0",
  dateRange: { startDate: "2025-06-03", endDate: "2025-06-30" },
  useRealData: true,
  datasetGuards: { dataReady: true, maxTradingDays: 8, maxSecuritiesPerDay: 300 },
  // 保序子集：data → research → strategy → backtest → regime（跳过 evaluation 及其后未装配段）
  stageIds: ["data", "research", "strategy", "backtest", "regime"],
};

const report: Record<string, unknown> = {};
try {
  const result = await caller.researchRun.loopRun(input);
  report.elapsedMs = Date.now() - startedAt;
  report.overall = result.overall;
  report.runnerInjected = result.runnerInjected;
  report.stages = result.stages.map(s => ({
    stageId: s.stageId,
    state: s.state,
    outputKind: s.outputKind,
    blockedReasonCode: s.blocked?.reasonCode ?? null,
    // regimeRef 的真实内容（coverage + compositeSummary）
    output: s.stageId === "regime" ? s.output : undefined,
  }));

  console.log(`完成（${report.elapsedMs}ms）`);
  console.log(`  overall = ${JSON.stringify(result.overall)}`);
  for (const s of report.stages as { stageId: string; state: string; blockedReasonCode: string | null }[]) {
    console.log(`    ${s.stageId.padEnd(14)} ${s.state.padEnd(9)} ${s.blockedReasonCode ?? ""}`);
  }
  const regimeStage = (report.stages as { stageId: string; output: unknown }[]).find(s => s.stageId === "regime");
  console.log("  regimeRef =", JSON.stringify(regimeStage?.output));
} catch (error) {
  report.elapsedMs = Date.now() - startedAt;
  report.error = String(error);
  const e = error as { cause?: unknown; message?: string };
  console.log(`失败（${report.elapsedMs}ms）: ${e.message}`);
  if (e.cause !== undefined) console.log(`  cause: ${String(e.cause)}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
console.log(`报告 → ${OUT}`);
process.exit(0);
