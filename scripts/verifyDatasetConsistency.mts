/**
 * P2-T2 — 同输入两次构建一致性验证（串行、同进程、真实 DB）。
 *
 * 串行调用 buildResearchDataset 两次（相同请求），对比 datasetVersion / rowsFingerprint /
 * universe 摘要 / policySetFingerprint 是否完全一致（diff 为空）。
 * 用单日窗口 + maxSecuritiesPerDay 限制，避免全历史构建耗时；确定性验证与窗口大小无关。
 */

import "dotenv/config";
import { buildResearchDataset, computeRowsFingerprint, computePolicySetFingerprint } from "../server/researchDataset";
import type { ResearchDatasetRequest } from "../server/researchDataset";

const request: ResearchDatasetRequest = {
  name: "consistency-check",
  startDate: "2024-01-02",
  endDate: "2024-01-02",
  asOfPerTradeDate: true,
  asOf: null,
};

const opts = { dataReady: false, maxSecuritiesPerDay: 200 };

const startedAt = Date.now();
const a = await buildResearchDataset(request, opts);
const b = await buildResearchDataset(request, opts);
const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

const memberDaysA = a.universeDefinition.days.reduce((s, d) => s + d.members.length, 0);
const memberDaysB = b.universeDefinition.days.reduce((s, d) => s + d.members.length, 0);

const results = {
  elapsedSec,
  datasetVersion: { a: a.datasetVersion, b: b.datasetVersion, equal: a.datasetVersion === b.datasetVersion },
  rowsFingerprint: {
    a: computeRowsFingerprint(a.rows),
    b: computeRowsFingerprint(b.rows),
    equal: computeRowsFingerprint(a.rows) === computeRowsFingerprint(b.rows),
  },
  policySetFingerprint: {
    a: computePolicySetFingerprint(a.policySet),
    b: computePolicySetFingerprint(b.policySet),
    equal: computePolicySetFingerprint(a.policySet) === computePolicySetFingerprint(b.policySet),
  },
  rowCount: { a: a.rows.length, b: b.rows.length, equal: a.rows.length === b.rows.length },
  memberDayCount: { a: memberDaysA, b: memberDaysB, equal: memberDaysA === memberDaysB },
  gate: { a: a.gate, b: b.gate },
};

console.log(JSON.stringify(results, null, 2));
const allEqual = results.datasetVersion.equal && results.rowsFingerprint.equal && results.policySetFingerprint.equal && results.rowCount.equal && results.memberDayCount.equal;
console.log("一致性判定:", allEqual ? "PASS（两次构建 diff 为空）" : "FAIL");
process.exit(allEqual ? 0 : 1);
