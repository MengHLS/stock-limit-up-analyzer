/**
 * 只读：把某个 Run 的全部 Finding 按研究强度降序打印，标出哪些进了默认 Top N。
 *
 * 用途：解释「某条分析为什么没出现在结论页的关键发现里」——是强度不够、被去重合并，
 * 还是压根没检测出 Finding。禁靠猜。
 *
 * 用法：npx tsx docs/evidence/_probe_run_findings.mts <runId> [topN]
 */
import "dotenv/config";
import { createDbResearchRepositories } from "../../server/researchCore";

const runId = Number(process.argv[2]);
const topN = process.argv[3] ? Number(process.argv[3]) : 8;
if (!Number.isInteger(runId) || runId <= 0) {
  console.log("用法：npx tsx docs/evidence/_probe_run_findings.mts <runId> [topN]");
  process.exit(1);
}

const repos = createDbResearchRepositories();
const out: string[] = [];

const analyses = await repos.analyses.list({ runId });
const byId = new Map(analyses.filter((a) => a.id !== undefined).map((a) => [a.id as number, a]));
out.push(`Run ${runId}：分析 ${analyses.length} 条`);
const findings = await repos.findings.list({ runId });
out.push(`Finding ${findings.length} 条（按 researchStrength 降序）`);
const sorted = [...findings].sort((a, b) => (b.researchStrength ?? 0) - (a.researchStrength ?? 0));

const guardedIds = new Set(
  analyses.filter((a) => (a.name ?? "").includes("回踩深度")).map((a) => a.id as number),
);
out.push(`其中来自「回踩深度」分析的有：${[...guardedIds].join(", ") || "（无）"}\n`);

let rank = 0;
for (const f of sorted) {
  rank += 1;
  const a = f.primaryAnalysisId !== null && f.primaryAnalysisId !== undefined ? byId.get(f.primaryAnalysisId) : undefined;
  const isDepth = f.primaryAnalysisId !== null && f.primaryAnalysisId !== undefined && guardedIds.has(f.primaryAnalysisId);
  out.push(
    `${rank === 1 ? " " : String(rank).padStart(2)}. ${rank <= topN ? "★TOP" : "     "} `
    + `${isDepth ? "【深度】" : "      "} `
    + `strength=${String(f.researchStrength ?? "-").padEnd(6)} grade=${String(f.researchStrengthGrade ?? "-").padEnd(8)} `
    + `type=${f.findingType} status=${f.status}`,
  );
  out.push(`    title  = ${f.title}`);
  if (a !== undefined) out.push(`    from   = #${a.id} [${a.priority ?? "-"}] ${a.analysisType}「${a.name}」`);
  const eff = f.effect as Record<string, unknown> | null;
  if (eff !== null && eff !== undefined) out.push(`    effect = ${JSON.stringify(eff)}`);
  const samp = f.sample as Record<string, unknown> | null;
  if (samp !== null && samp !== undefined) out.push(`    sample = ${JSON.stringify(samp)}`);
  out.push("");
}

const depthRanked = sorted
  .map((f, i) => ({ f, i }))
  .filter((x) => x.f.primaryAnalysisId !== null && x.f.primaryAnalysisId !== undefined && guardedIds.has(x.f.primaryAnalysisId));
out.push("小结：深度分档 Finding 的排位 = " + (depthRanked.length === 0
  ? "（没有检测出 Finding）"
  : depthRanked.map((x) => `#${x.f.primaryAnalysisId} 第 ${x.i + 1} 名`).join(" / ") + `（默认只展示前 ${topN} 名）`));

const { writeFileSync } = await import("node:fs");
writeFileSync("docs/evidence/_probe_run_findings.out.txt", out.join("\n"), "utf8");
console.log(out.join("\n"));
process.exit(0);
