import "dotenv/config";
import { getLeaderCandidateBacktest } from "../server/db";

const result: any = await getLeaderCandidateBacktest({ observationDays: 1 });
console.log("顶层字段:", Object.keys(result).join(", "));
console.log("historicalRows.length:", result.historicalRows?.length);
console.log("scoreBands:", JSON.stringify(result.scoreBands?.map((b: any) => ({ label: b.label, n: b.sampleSize, success: b.successRate }))));
console.log("calibration:", JSON.stringify(result.calibration));
const sim = result.realisticSimulation;
console.log("sim.tradeCount:", sim?.tradeCount, "sim.trades.length:", sim?.trades?.length);
console.log("sim 前3笔:", JSON.stringify((sim?.trades ?? []).slice(0, 3).map((t: any) => ({ code: t.stockCode, entry: t.entryDate, exit: t.exitDate, pnl: t.netPnl }))));
process.exit(0);
