/**
 * 只读探针：实查 `strategy_versions.strategyDocumentJson.parameters`，
 * 判定「能否从文档参数派生 ParameterSpace（供 optimization 阶段接线）」。
 *
 * 为什么必须先查：`parameterSearch` 的 `SweepNumberParameter` 要求 `step > 0` 且 finite，
 * 而 `ResearchParameterDefinition.step` 是**可选**字段。若真实文档普遍没有 `step`，
 * 「从文档派生搜索空间」这条接线在真实库上就会**一跑就抛错** —— 必须先知道。
 *
 * 本探针只读，不写任何表。
 * 用法：npx tsx docs/evidence/_probe_optimization_parameter_space.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

const rows = await db.execute(
  sql`select id, strategyId, version, status, strategyDocumentJson
      from strategy_versions order by strategyId, version`,
);
const list = (rows as unknown as [Array<Record<string, unknown>>])[0] ?? [];

/** 单个数值参数能否进搜索空间（`SweepNumberParameter` 要求 min/max/step 全 finite 且 step > 0）。 */
function classifyNumberParam(param: Record<string, unknown>): string {
  const missing: string[] = [];
  if (typeof param["min"] !== "number") missing.push("min");
  if (typeof param["max"] !== "number") missing.push("max");
  const step = param["step"];
  if (typeof step !== "number" || !Number.isFinite(step) || step <= 0) missing.push("step(>0)");
  return missing.length === 0 ? "可搜索" : `缺 ${missing.join("/")}`;
}

const documents: Array<Record<string, unknown>> = [];
for (const r of list) {
  let doc: Record<string, unknown> = {};
  try {
    doc = JSON.parse(String(r["strategyDocumentJson"])) as Record<string, unknown>;
  } catch {
    documents.push({ id: r["id"], strategyId: r["strategyId"], parseError: true });
    continue;
  }
  const params = (doc["parameters"] as Record<string, unknown> | undefined)?.["parameters"];
  const paramList = Array.isArray(params) ? (params as Array<Record<string, unknown>>) : [];
  const classified = paramList.map(p => ({
    name: p["name"],
    type: p["type"],
    min: p["min"] ?? null,
    max: p["max"] ?? null,
    step: p["step"] ?? null,
    defaultValue: p["defaultValue"] ?? null,
    verdict: p["type"] === "number" ? classifyNumberParam(p) : `跳过（type=${String(p["type"])}）`,
  }));
  documents.push({
    id: r["id"],
    strategyId: r["strategyId"],
    version: r["version"],
    status: r["status"],
    parameterCount: paramList.length,
    usableForSearchCount: classified.filter(p => p.verdict === "可搜索").length,
    parameters: classified,
  });
}

/** 汇总：真实库里数值参数缺哪些界（决定接线策略：直接派生 vs 响亮抛错）。 */
const allNumberParams = documents.flatMap(d =>
  Array.isArray(d["parameters"]) ? (d["parameters"] as Array<Record<string, unknown>>) : [],
).filter(p => p["type"] === "number");

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      scannedDocumentCount: list.length,
      numberParameterVerdicts: [...new Set(allNumberParams.map(p => String(p["verdict"])))],
      documentsWithUsableSpace: documents.filter(d => Number(d["usableForSearchCount"] ?? 0) > 0).map(d => d["strategyId"]),
      documents,
    },
    null,
    2,
  ),
);
process.exit(0);
