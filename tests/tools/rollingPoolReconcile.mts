/**
 * 把一条卡死的 RUNNING Run 收敛为 FAILED（**必须给 reason**；不伪造成功）。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs tests/tools/rollingPoolReconcile.mts \
 *        --run RUN-20261010-745C38AA --reason "读取阶段 30 分钟无进展，技术中止后重跑"
 */

import "dotenv/config";
import { defaultExperimentRunService } from "../../server/researchExperiments/defaults";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1]! : null;
}

const runId = argValue("--run");
const reason = argValue("--reason");
if (runId === null || reason === null) {
  console.error("用法：--run <runId> --reason <text>");
  process.exit(2);
}

const service = defaultExperimentRunService();
const before = await service.getRun(runId);
console.log(`[reconcile] before = ${JSON.stringify(before)}`);
const record = await service.reconcileRun(runId, reason);
console.log(`[reconcile] after  = ${JSON.stringify(record)}`);
process.exit(0);
