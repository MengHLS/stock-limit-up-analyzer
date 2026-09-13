/**
 * 验证：7 个新转正策略的**真实策略文档**是否带 `recipe`（可序列化执行面）。
 *
 * 这是「条件能否进回测」的判据：`assemble.ts` 的 `requireRecipe()` 读 `document.recipe`；
 * 缺它 ⇒ 落 `DEFAULT_STRATEGY_RECIPE_ID`（「涨跌幅取前 5 名」）⇒ 条件进不了回测。
 *
 * 🔴 真实 JSON 路径（实测，禁凭记忆）：
 *   - `$.recipe.recipeId` / `$.recipe.point`
 *   - **`$.parameters.parameters[]`**（不是 `$.parameters[]`！`parameters` 是 `{parameters:[…]}` 包装）
 *   - `$.definition.execution.executionTiming` / `$.definition.execution.priceType`
 *   - `$.definition.entry.conditions[]`
 *
 * 用**裸 SQL 独立复核**（不拿 Service 返回值当证据）。
 *
 * 用法：npx tsx docs/evidence/_probe_promoted_recipes.mts
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL as string);

const [rows] = await conn.query(
  "SELECT v.id AS versionId, v.strategyId, v.version, v.fingerprint, "
  + "JSON_UNQUOTE(JSON_EXTRACT(v.strategyDocumentJson, '$.recipe.recipeId')) AS recipeId, "
  + "JSON_UNQUOTE(JSON_EXTRACT(v.strategyDocumentJson, '$.recipe.point')) AS recipePoint, "
  + "JSON_UNQUOTE(JSON_EXTRACT(v.strategyDocumentJson, '$.definition.execution.executionTiming')) AS execTiming, "
  + "JSON_UNQUOTE(JSON_EXTRACT(v.strategyDocumentJson, '$.definition.execution.priceType')) AS priceType, "
  + "JSON_LENGTH(v.strategyDocumentJson, '$.parameters.parameters') AS paramCount, "
  + "JSON_LENGTH(v.strategyDocumentJson, '$.definition.entry.conditions') AS condCount, "
  + "JSON_EXTRACT(v.strategyDocumentJson, '$.parameters.parameters') AS params "
  + "FROM strategy_versions v WHERE v.strategyId LIKE 'cand-36%' ORDER BY v.id",
);

console.log("versionId | strategyId | recipeId | point | execTiming | price | params | conds");
console.log("--- | --- | --- | --- | --- | --- | --- | ---");
type ParamDef = { name: string; defaultValue?: unknown; min?: number; max?: number };
for (const r of rows as Array<Record<string, unknown>>) {
  const row = r as Record<string, unknown>;
  console.log([
    String(row.versionId), String(row.strategyId),
    String(row.recipeId ?? "🔴 undefined"), String(row.recipePoint ?? "—"),
    String(row.execTiming ?? "—"), String(row.priceType ?? "—"),
    String(row.paramCount ?? "—"), String(row.condCount ?? "—"),
  ].join(" | "));
}

console.log("\n=== 参数（`resolveParameters` 的唯一来源 = defaultValue） ===");
for (const r of rows as Array<Record<string, unknown>>) {
  const row = r as Record<string, unknown>;
  const raw = typeof row.params === "string" ? row.params : JSON.stringify(row.params);
  const parsed = JSON.parse(raw) as ParamDef[];
  const brief = parsed
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `${p.name}=${JSON.stringify(p.defaultValue)} [${p.min},${p.max}]`)
    .join("  ");
  console.log(`${row.strategyId}: ${brief}`);
}

await conn.end();
process.exit(0);
