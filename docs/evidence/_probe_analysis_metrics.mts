/**
 * 只读诊断：把指定分析的**全部** result 行打印出来。
 *
 * 起因：`_e2e_research_second_question.mts` 里用 `/mean/i` 抓第一个指标，
 * 结果抓到了 `BENCHMARK_*`（全样本基准）而不是 `GROUP_*`（条件分组），
 * 于是四条深度分档分析的输出看起来「全都一样」——那是探针的显示缺陷，不是执行缺陷。
 *
 * 用法：npx tsx docs/evidence/_probe_analysis_metrics.mts 720094 720095
 */
import "dotenv/config";
import { createDbResearchRepositories } from "../../server/researchCore";

const ids = process.argv.slice(2).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
if (ids.length === 0) {
  console.log("用法：npx tsx docs/evidence/_probe_analysis_metrics.mts <analysisId> [analysisId...]");
  process.exit(1);
}

const repos = createDbResearchRepositories();
const out: string[] = [];

for (const id of ids) {
  const a = await repos.analyses.getById(id);
  const rows = await repos.results.list({ analysisId: id });
  const conds = await repos.conditions.listByAnalysis(id);
  out.push("=".repeat(78));
  out.push(`analysisId=${id}  type=${a?.analysisType}  status=${a?.status}  runId=${a?.runId}  priority=${a?.priority}`);
  out.push(`name   = ${a?.name}`);
  out.push(`target = ${a?.target}`);
  out.push(`条件（groupNo/sortOrder/字段/运算符/值）：`);
  for (const c of conds) {
    out.push(`  g${c.groupNo} s${c.sortOrder}  ${c.fieldName} ${c.operator} ${JSON.stringify(c.value)}`);
  }
  out.push(`结果行 ${rows.length} 条：`);
  for (const r of rows) {
    // 🔴 分组行与基准行的 `metricCode` 是**同名**的（各有 SAMPLE_COUNT / MEAN_RETURN / …），
    //    真正的区分字段是 `resultType`（GROUP / BENCHMARK）+ `dimensionJson`。
    //    只按 metricCode 抓第一个必然抓到基准行 —— 这正是一次误判的成因。
    out.push(`  [${r.resultType}] ${String(r.metricCode).padEnd(24)} = ${r.metricValue}   dim=${r.dimensionJson ?? "-"}`);
  }
  out.push("");
}

const { writeFileSync } = await import("node:fs");
writeFileSync("docs/evidence/_probe_analysis_metrics.out.txt", out.join("\n"), "utf8");
console.log(out.join("\n"));
process.exit(0);
