/**
 * 探针：复现「界面运行策略卡住」的真实成因。
 *
 * 用真实 tRPC caller 走 researchRun.loopRun，传入与前端
 * StrategyEditor.tsx#handleRun **逐字段相同**的请求体，
 * 分别在 stageIds 缺省（=全 14 阶段）与只传部分阶段两种情况下测量耗时与结果。
 *
 * 只读：不落库、不改状态。输出写 docs/evidence/。
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

const base = {
  experimentId: "exp-probe-hang",
  strategyId: "leader-candidate-baseline",
  strategyVersion: "1.0.0",
  dateRange: { startDate: "", endDate: "" },
  executionModel: "NEXT_OPEN",
};

const out: Record<string, unknown> = {};
const t0 = Date.now();

// A) 与前端逐字段相同（stageIds 缺省 ⇒ 全 14 阶段，dateRange 为空串）
try {
  const r = await caller.researchRun.loopRun(base as never);
  out.A_frontend_shape = {
    ms: Date.now() - t0,
    ok: true,
    runnerInjected: r.runnerInjected,
    overall: r.overall,
    blockedSummary: r.blockedSummary.map(b => ({
      stageId: b.stageId,
      reasonCode: b.reasonCode,
    })),
    wiredStages: r.wiring.wiredStages,
    executorBound: r.wiring.executorBound,
  };
} catch (e) {
  out.A_frontend_shape = {
    ms: Date.now() - t0,
    ok: false,
    name: (e as Error)?.constructor?.name,
    message: String((e as Error)?.message).slice(0, 800),
  };
}

// B) 真实日期 + 前端形状（stageIds 缺省 ⇒ 全 14 阶段），experimentId 按前端派生规则生成
const t1 = Date.now();
function fnv1a8(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
function deriveExperimentId(
  strategyId: string,
  dr: { startDate: string; endDate: string },
  executionModel: string
): string {
  const now = new Date();
  const ymd = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const digest = fnv1a8(`${strategyId}|${dr.startDate}|${dr.endDate}|${executionModel}`);
  return `EXP-${ymd}-${digest.toUpperCase()}`;
}

const withDates = {
  ...base,
  experimentId: deriveExperimentId(base.strategyId, { startDate: "2025-06-03", endDate: "2025-06-30" }, base.executionModel),
  dateRange: { startDate: "2025-06-03", endDate: "2025-06-30" },
};
try {
  const r = await caller.researchRun.loopRun(withDates as never);
  out.B_real_dates = {
    ms: Date.now() - t1,
    ok: true,
    experimentId: withDates.experimentId,
    runnerInjected: r.runnerInjected,
    overall: r.overall,
    blockedSummary: r.blockedSummary.map(b => ({
      stageId: b.stageId,
      reasonCode: b.reasonCode,
    })),
  };
} catch (e) {
  out.B_real_dates = {
    ms: Date.now() - t1,
    ok: false,
    name: (e as Error)?.constructor?.name,
    message: String((e as Error)?.message).slice(0, 1200),
  };
}

out.totalMs = Date.now() - t0;
writeFileSync("docs/evidence/_probe_looprun_hang.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
