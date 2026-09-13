/**
 * 探针：前端闭环运行全路径仿真（tRPC 真实调用 + 真实 adapter 解析）。
 *
 * 目的：判定「点运行策略后 UI 到底呈现什么」——是错误、空态、还是 14 阶段全阻塞面板。
 * 严格复用前端同一套：deriveExperimentId 规则 + buildClosedLoopRunViewModel。
 *
 * 只读：不落库、不改状态。
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { appRouter } from "../../server/routers";
import { buildClosedLoopRunViewModel } from "../../client/src/adapters/closedLoopRunAdapter";

const adminCtx = {
  user: { id: "probe", role: "admin" as const, openId: "probe", name: "probe" },
  req: { protocol: "http", headers: {} },
  res: { clearCookie: () => {} },
} as never;

const caller = appRouter.createCaller(adminCtx);

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
  return `EXP-${ymd}-${fnv1a8(`${strategyId}|${dr.startDate}|${dr.endDate}|${executionModel}`).toUpperCase()}`;
}

const cases: Array<[string, { startDate: string; endDate: string }]> = [
  ["未填日期（前端初始态）", { startDate: "", endDate: "" }],
  ["填了日期", { startDate: "2025-06-03", endDate: "2025-06-30" }],
];

const out: Record<string, unknown> = {};
for (const [label, dr] of cases) {
  const t = Date.now();
  const payload = {
    experimentId: deriveExperimentId("leader-candidate-baseline", dr, "NEXT_OPEN"),
    strategyId: "leader-candidate-baseline",
    strategyVersion: "1.0.0",
    dateRange: dr,
    executionModel: "NEXT_OPEN",
  };
  try {
    const raw = await caller.researchRun.loopRun(payload as never);
    const vm = buildClosedLoopRunViewModel(raw);
    out[label] = {
      ms: Date.now() - t,
      uiState: vm === null ? "解析失败→运行失败提示" : "渲染结果面板",
      adapterParsed: vm !== null,
      vm:
        vm === null
          ? null
          : {
              status: vm.status,
              counts: vm.counts,
              firstBlockedReasonCode: vm.firstBlockedReasonCode,
              evaluation: vm.evaluation,
              footerNote: vm.note,
            },
    };
  } catch (e) {
    out[label] = {
      ms: Date.now() - t,
      uiState: "运行失败提示（runError）",
      message: String((e as { message?: string })?.message).replace(/\s+/g, " ").slice(0, 300),
    };
  }
}

out.generatedAt = new Date().toISOString();
writeFileSync("docs/evidence/_probe_looprun_ui.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
