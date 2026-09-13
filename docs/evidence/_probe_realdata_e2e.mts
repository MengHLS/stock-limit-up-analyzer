/**
 * 探针：运行工作台「真实跑通」端到端取证（`useRealData=true` 的等价路径）。
 *
 * 走的是与 `researchRun.loopRun` 完全相同的代码路径（真实 tRPC caller），只把数据集
 * 护栏调到极小以换取可接受的跨境 RTT：
 *   真实 tRPC caller → loopRun({ useRealData:true, strategyId, strategyVersion, dateRange,
 *                              datasetGuards:{ maxTradingDays, maxSecuritiesPerDay } })
 *
 * 判据（非 0 执行才算跑通）：
 *   - overall.executedStageCount > 0；
 *   - runnerInjected 含 data / research / backtest / evaluation / regime；
 *   - assembly 非 null 且 datasetRowCount > 0；
 *   - 各阶段 blocked 只在 optimization…discipline（未装配）出现。
 *
 * 🚫 本探针**不写库**（loopRun 本身无状态）。
 * 重跑：项目根目录 `npx tsx docs/evidence/_probe_realdata_e2e.mts`
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { appRouter } from "../../server/routers";

const OUT = "docs/evidence/_probe_realdata_e2e.json";

const adminCtx = {
  user: { id: "probe", role: "admin" as const, openId: "probe", name: "probe" },
  req: { protocol: "http", headers: {} },
  res: { clearCookie: () => {} },
} as never;

const caller = appRouter.createCaller(adminCtx);

const startedAt = Date.now();
const report: Record<string, unknown> = {};

const input = {
  experimentId: "EXP-20260913-RDATA001",
  strategyId: "limit-up-baseline",
  strategyVersion: "1.1.0",
  dateRange: { startDate: "2025-06-03", endDate: "2025-06-30" },
  useRealData: true,
  datasetGuards: { dataReady: true, maxTradingDays: 5, maxSecuritiesPerDay: 300 },
};

try {
  const result = await caller.researchRun.loopRun(input);
  const elapsedMs = Date.now() - startedAt;
  report.elapsedMs = elapsedMs;
  report.overall = result.overall;
  report.runnerInjected = result.runnerInjected;
  report.assembly = result.assembly;
  report.wiring = {
    wiredStages: result.wiring.wiredStages,
    unwiredStages: result.wiring.unwiredStages,
    coveredStages: result.wiring.coveredStages,
    uncoveredStages: result.wiring.uncoveredStages,
    executorBound: result.wiring.executorBound,
  };
  report.stages = result.stages.map(s => ({
    stageId: s.stageId,
    state: s.state,
    outputKind: s.outputKind,
    blockedReasonCode: s.blocked?.reasonCode ?? null,
    blockedDetail: s.blocked ? String(s.blocked.detail).slice(0, 220) : null,
  }));

  console.log(`完成（${elapsedMs}ms）`);
  console.log(`  overall = ${JSON.stringify(result.overall)}`);
  console.log(`  runnerInjected = ${result.runnerInjected.join(", ") || "(无)"}`);
  console.log(`  assembly = ${result.assembly ? `rows=${result.assembly.datasetRowCount} sec=${result.assembly.datasetSecurityCount} gate=${result.assembly.datasetGate} recipe=${result.assembly.recipeId}(${result.assembly.recipeSource})` : "null"}`);
  console.log("  --- 逐阶段 ---");
  for (const s of report.stages as { stageId: string; state: string; outputKind: string; blockedReasonCode: string | null }[]) {
    console.log(`    ${s.stageId.padEnd(14)} ${s.state.padEnd(9)} ${s.outputKind.padEnd(22)} ${s.blockedReasonCode ?? ""}`);
  }
} catch (error) {
  report.error = String(error);
  report.elapsedMs = Date.now() - startedAt;
  const e = error as { cause?: unknown; message?: string };
  console.log(`失败（${report.elapsedMs}ms）: ${e.message}`);
  if (e.cause !== undefined) console.log(`  cause: ${String(e.cause)}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
console.log(`报告 → ${OUT}`);
process.exit(0);
