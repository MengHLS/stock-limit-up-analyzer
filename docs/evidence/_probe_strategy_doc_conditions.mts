/**
 * 只读探针：实查库里每份策略文档的 `definition.entry.conditions` 真实内容。
 *
 * 用途（STEP A 动手前的前置取证）：
 *   STEP A 要在 `assemble.ts#requireRecipe` 之前插入「从声明式条件合成配方」，
 *   **只要有一个条件无法映射就响亮抛错**（不静默回落默认配方）。
 *   ⇒ 必须先知道**存量文档里到底有哪些条件**，否则可能把「本来能跑的策略」改成「一跑就报错」。
 *
 * 本探针只读，不写任何表。
 * 用法：npx tsx docs/evidence/_probe_strategy_doc_conditions.mts
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
  sql`select id, strategyId, version, status, datasetVersion, strategyDocumentJson
      from strategy_versions order by strategyId, version`,
);
const list = (rows as unknown as [Array<Record<string, unknown>>])[0] ?? [];

interface DocSummary {
  id: unknown;
  strategyId: unknown;
  version: unknown;
  status: unknown;
  datasetVersion: unknown;
  hasRecipe: boolean;
  recipeId: string | null;
  hasDefinition: boolean;
  conditionCount: number;
  conditions: Array<Record<string, unknown>>;
  parameterNames: string[];
  mappableFieldCount: number;
  unmappableFields: string[];
  unmappableOperators: string[];
}

/** STEP A 编译器当前计划支持的策略侧字段（= 配方能真实产出的 4 个派生特征）。 */
const MAPPABLE_FIELDS = new Set([
  "bar.haircutFromEventLow",
  "bar.volumeRatio",
  "bar.isBullish",
  "bar.momentumFromEventClose",
]);
/** STEP A 编译器当前计划支持的运算符（`FeatureGate` 只有 lte/lt/gte/gt/eq 五种）。 */
const MAPPABLE_OPERATORS = new Set([
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "EQUAL",
]);

const documents: DocSummary[] = [];
for (const r of list) {
  let doc: Record<string, unknown> = {};
  try {
    doc = JSON.parse(String(r["strategyDocumentJson"])) as Record<string, unknown>;
  } catch {
    documents.push({
      id: r["id"],
      strategyId: r["strategyId"],
      version: r["version"],
      status: r["status"],
      datasetVersion: r["datasetVersion"],
      hasRecipe: false,
      recipeId: null,
      hasDefinition: false,
      conditionCount: -1,
      conditions: [],
      parameterNames: [],
      mappableFieldCount: 0,
      unmappableFields: ["<strategyDocumentJson 解析失败>"],
      unmappableOperators: [],
    });
    continue;
  }
  const recipe = doc["recipe"] as Record<string, unknown> | null | undefined;
  const def = doc["definition"] as Record<string, unknown> | null | undefined;
  const entry = (def?.["entry"] ?? null) as Record<string, unknown> | null;
  const rawConditions = entry?.["conditions"];
  const conditions: Array<Record<string, unknown>> = Array.isArray(rawConditions)
    ? (rawConditions as Array<Record<string, unknown>>)
    : [];
  const params = (doc["parameters"] as Record<string, unknown> | undefined)?.["parameters"];

  const fields = new Set<string>();
  const ops = new Set<string>();
  let mappable = 0;
  for (const c of conditions) {
    const field = String(c["field"] ?? "");
    const op = String(c["operator"] ?? "");
    fields.add(field);
    ops.add(op);
    if (MAPPABLE_FIELDS.has(field) && MAPPABLE_OPERATORS.has(op) && c["enabled"] !== false) mappable += 1;
  }

  documents.push({
    id: r["id"],
    strategyId: r["strategyId"],
    version: r["version"],
    status: r["status"],
    datasetVersion: r["datasetVersion"],
    hasRecipe: recipe !== undefined && recipe !== null,
    recipeId: (recipe?.["recipeId"] as string | undefined) ?? null,
    hasDefinition: def !== undefined && def !== null,
    conditionCount: conditions.length,
    conditions: conditions.map((c) => ({
      field: c["field"],
      operator: c["operator"],
      valueType: c["valueType"],
      value: c["value"],
      enabled: c["enabled"],
    })),
    parameterNames: Array.isArray(params)
      ? (params as Array<Record<string, unknown>>).map((p) => String(p["name"] ?? ""))
      : [],
    mappableFieldCount: mappable,
    unmappableFields: [...fields].filter((f) => !MAPPABLE_FIELDS.has(f)),
    unmappableOperators: [...ops].filter((o) => !MAPPABLE_OPERATORS.has(o)),
  });
}

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      documentCount: documents.length,
      /** 汇总：所有出现过的条件字段（判断 STEP A 的影响面）。 */
      allConditionFields: [...new Set(documents.flatMap((d) => d.conditions.map((c) => String(c["field"]))))],
      allConditionOperators: [...new Set(documents.flatMap((d) => d.conditions.map((c) => String(c["operator"]))))],
      /** 会被 STEP A 判为「无法映射」的字段全集。 */
      unmappableFieldUnion: [...new Set(documents.flatMap((d) => d.unmappableFields))],
      unmappableOperatorUnion: [...new Set(documents.flatMap((d) => d.unmappableOperators))],
      documents,
    },
    null,
    2,
  ),
);
process.exit(0);
