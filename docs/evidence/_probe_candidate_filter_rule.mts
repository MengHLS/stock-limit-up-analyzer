/**
 * 只读探针：实查候选表 `research_strategy_candidate` 的 filterRule 真实字段命名。
 *
 * 为什么必须查：研究侧条件（`research_analysis_condition.fieldName`）用的是**研究变量名**
 * （`holds_event_low_5d` / `days_since_previous_limit`，snake_case + 符号形运算符），
 * 而转正转换器 `definitionBuild#buildConditions` 要求 `fieldName` 能被
 * `parseStrategyFieldReference` 解析（`bar.*` / `prefix.rd*.*` / `event.*`）—— 两者不同构。
 * ⇒ 必须知道候选表里到底存的是哪一套名字，才能判断「研究条件能否走到回测」。
 *
 * 只读，不写任何表。
 * 用法：npx tsx docs/evidence/_probe_candidate_filter_rule.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

const candidates = await db.execute(
  sql`select id, experimentId, conclusionId, name, status,
             sourceDatasetVersionId, sourceResearchRunId, sourceResearchPlanId,
             filterRuleJson, entryRuleJson, riskRuleJson, parameterSpaceJson
      from research_strategy_candidate order by id asc`,
);
const list = (candidates as unknown as [Array<Record<string, unknown>>])[0] ?? [];

function summarizeConditions(json: unknown): Record<string, number> | string {
  if (json === null || json === undefined || String(json).length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(json));
  } catch {
    return "<parse-fail>";
  }
  const groups = (parsed as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) return "<no-groups>";
  const counts: Record<string, number> = {};
  for (const g of groups as Array<Record<string, unknown>>) {
    const rows = g["conditions"];
    if (!Array.isArray(rows)) continue;
    for (const c of rows as Array<Record<string, unknown>>) {
      const key =
        String(c["fieldName"]) +
        " " +
        String(c["operator"]) +
        " " +
        JSON.stringify(c["value"]);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

const out = list.map((r) => ({
  id: r["id"],
  name: r["name"],
  status: r["status"],
  experimentId: r["experimentId"],
  conclusionId: r["conclusionId"],
  sourceDatasetVersionId: r["sourceDatasetVersionId"],
  sourceResearchRunId: r["sourceResearchRunId"],
  sourceResearchPlanId: r["sourceResearchPlanId"],
  conditionSummary: summarizeConditions(r["filterRuleJson"]),
  hasEntryRule: String(r["entryRuleJson"] ?? "").length > 2,
  hasRiskRule: String(r["riskRuleJson"] ?? "").length > 2,
  hasParameterSpace: String(r["parameterSpaceJson"] ?? "").length > 2,
}));

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      candidateCount: out.length,
      candidates: out,
    },
    null,
    2,
  ),
);
process.exit(0);
