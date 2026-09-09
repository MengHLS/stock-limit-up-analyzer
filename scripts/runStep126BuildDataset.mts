/**
 * STEP 12.6 WORK C-12.6.1 — Research Dataset 构建 CLI（真实 DB；只读，幂等，确定性）。
 *
 * 用法（需项目根 .env 的 DATABASE_URL）：
 *   npx tsx scripts/runStep126BuildDataset.mts --from=2024-01-02 --to=2024-01-05
 *   # 固定 asOf 快照（冻结视角）：
 *   npx tsx scripts/runStep126BuildDataset.mts --from=2024-01-02 --to=2024-01-05 --as-of=2024-01-05
 *   # 认证口径（A~H 全 DATA_READY 后）：
 *   npx tsx scripts/runStep126BuildDataset.mts --from=... --to=... --data-ready
 *
 * 参数：
 *   --name=NAME        数据集名称（默认 "universe-tradable-daily"）
 *   --from=YYYY-MM-DD  起始日期（含）
 *   --to=YYYY-MM-DD    结束日期（含）
 *   --as-of=YYYY-MM-DD 固定 asOf（缺省 = 逐日 PIT）
 *   --data-ready       声明数据链已就绪；无覆盖缺口时 gate 才可判 PASS
 *   --max-days=N       单日护栏（可选）
 *   --max-securities=N 单日成员护栏（可选）
 *   --out=PATH         报告输出路径（默认 docs/step12-evidence/research_dataset_report.json）
 *
 * 输出 JSON：datasetVersion / universeDefinition / dataSnapshot / rows（数量摘要，不写全行）/
 * gate / gateNotes。gate 语义与 builder.ts 头注释一致。
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildResearchDataset } from "../server/researchDataset";
import type { ResearchDatasetRequest } from "../server/researchDataset";

interface CliArgs {
  name: string;
  from: string;
  to: string;
  asOf: string | null;
  dataReady: boolean;
  maxDays: number | undefined;
  maxSecurities: number | undefined;
  out: string;
}

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function parseArgs(args: string[]): CliArgs {
  const from = readFlag(args, "from") ?? "";
  const to = readFlag(args, "to") ?? "";
  const asOf = readFlag(args, "as-of") ?? null;
  const maxDaysRaw = readFlag(args, "max-days");
  const maxSecuritiesRaw = readFlag(args, "max-securities");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("必须提供 --from 与 --to（YYYY-MM-DD）");
  }
  return {
    name: readFlag(args, "name") ?? "universe-tradable-daily",
    from,
    to,
    asOf,
    dataReady: args.includes("--data-ready"),
    maxDays: maxDaysRaw === undefined ? undefined : Number(maxDaysRaw),
    maxSecurities: maxSecuritiesRaw === undefined ? undefined : Number(maxSecuritiesRaw),
    out: resolve(readFlag(args, "out") ?? "docs/step12-evidence/research_dataset_report.json"),
  };
}

const { name, from, to, asOf, dataReady, maxDays, maxSecurities, out } = parseArgs(process.argv.slice(2));
const request: ResearchDatasetRequest = {
  name,
  startDate: from,
  endDate: to,
  asOfPerTradeDate: asOf === null,
  asOf,
};

const startedAt = Date.now();
const dataset = await buildResearchDataset(request, {
  dataReady,
  maxTradingDays: maxDays,
  maxSecuritiesPerDay: maxSecurities,
});

const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
const rowCount = dataset.rows.length;
const memberDays = dataset.universeDefinition.days.reduce((sum, d) => sum + d.members.length, 0);
const indexDates = dataset.dataSnapshot.domains.find((d) => d.domain === "F Index")?.datesCovered ?? 0;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
  datasetVersion: dataset.datasetVersion,
  gate: dataset.gate,
  gateNotes: dataset.gateNotes,
  universeDefinition: dataset.universeDefinition,
  dataSnapshot: dataset.dataSnapshot,
  rowSummary: {
    rows: rowCount,
    memberDays,
    indexDates,
    sampleRow: dataset.rows[0] ?? null,
  },
}, null, 2), "utf8");

console.log("Research Dataset 构建完成（%ss）", elapsedSec);
console.log("  gate        : %s", dataset.gate);
console.log("  版本        : %s", dataset.datasetVersion);
console.log("  交易日      : %d（index 覆盖 %d）", dataset.dataSnapshot.tradingDays, indexDates);
console.log("  universe    : %d 个成员日", memberDays);
console.log("  行数        : %d", rowCount);
console.log("  域快照      : %s",
  dataset.dataSnapshot.domains.map((d) => `${d.domain}=${d.rowsLoaded}`).join(" "));
if (dataset.dataSnapshot.coverageGaps.length > 0) {
  console.log("  覆盖缺口    : %d（%s）", dataset.dataSnapshot.coverageGaps.length, dataset.dataSnapshot.coverageGaps.join(", "));
}
if (dataset.gateNotes.length > 0) {
  console.log("  gateNotes   : %s", dataset.gateNotes.join("；"));
}
console.log("  报告输出    : %s", out);
console.log("  认证边界    : %s（A~H 全 DATA_READY 后加 --data-ready 重跑方可作为 VALIDATED 证据）", dataReady ? "dataReady=true" : "dataReady=false（冒烟口径）");

// 显式退出：drizzle mysql2 连接池空闲连接保持事件循环存活，防止 CLI 结束后进程悬挂。
process.exit(dataset.gate === "FAIL" ? 1 : 0);
