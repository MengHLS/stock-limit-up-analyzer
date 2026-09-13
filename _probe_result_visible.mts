import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
const client = createTRPCClient<any>({
  links: [httpBatchLink({ url: "http://localhost:3000/api/trpc", transformer: superjson })],
});
const t0 = Date.now();
const raw: any = await client.researchRun.loopRun.mutate({
  experimentId: "EXP-20260913-VISIBLE1",
  strategyId: "limit-up-baseline",
  strategyVersion: "1.1.0",
  dateRange: { startDate: "2025-01-02", endDate: "2025-03-31" },
  executionModel: "NEXT_OPEN",
  useRealData: true,
  datasetGuards: { dataReady: true },
});
console.log("elapsed(ms) =", Date.now() - t0);
const j = raw?.result?.data?.json ?? raw?.result?.json ?? raw;
console.log("输出结构 =", raw?.result?.data ? "result.data.json" : Object.keys(raw ?? {}));
console.log("json 顶层键 =", Object.keys(j ?? {}).join(", "));
console.log("runId =", j?.runId);
console.log("overall.status =", j?.overall?.status, "| executed =", j?.overall?.executedStageCount, "| blocked =", j?.overall?.blockedStageCount);
console.log("firstBlockedReasonCode =", j?.overall?.firstBlockedReasonCode);
console.log("runnerInjected =", JSON.stringify(j?.runnerInjected));
console.log("assembly =", JSON.stringify(j?.assembly));
console.log("stages.len =", j?.stages?.length);
for (const s of (j?.stages ?? [])) console.log("   -", s.stageId, s.state, s.reasonCode ?? "");
