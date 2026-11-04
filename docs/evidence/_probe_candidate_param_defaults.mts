/**
 * 探针：转正链路的「参数默认值」完整性（只读，真库）。
 *
 * 动机：`definitionBuild.buildParameters` 会**透传** `defaultValue`，而运行时
 * `StrategyRecipeRuntime.resolveParameters(schema)` 取**每个参数的 defaultValue** 作为本次运行的
 * 参数集；缺 `defaultValue` ⇒ 抛 `RECIPE_PARAMETER_NO_DEFAULT`。若草稿层根本无处写 defaultValue，
 * 则「候选 → 策略版本」看似成功、但策略**必然运行失败** —— 这是闭环的功能性命门，必须实测。
 *
 * 判据：逐条列出 候选草稿 parameterSpaceJson 的键 / 是否有 defaultValue，
 *       以及 strategy_parameters 投影的 defaultValueJson / parameterRole。
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL as string);

console.log("=== A. 候选草稿 parameterSpaceJson 全文 ===");
const [cands] = await conn.query(
  "SELECT id, status, parameterSpaceJson FROM research_strategy_candidate "
  + "WHERE parameterSpaceJson IS NOT NULL ORDER BY id",
);
for (const r of cands as Array<{ id: number; status: string; parameterSpaceJson: string }>) {
  console.log(`--- candidate ${r.id} (${r.status}) ---`);
  console.log("  raw = " + r.parameterSpaceJson);
  try {
    const parsed = JSON.parse(r.parameterSpaceJson) as Record<string, Record<string, unknown>>;
    for (const [code, spec] of Object.entries(parsed)) {
      const hasDefault = Object.prototype.hasOwnProperty.call(spec, "defaultValue")
        && spec.defaultValue !== null && spec.defaultValue !== undefined;
      console.log(
        `  ${code}: keys=[${Object.keys(spec).join(",")}] defaultValue=${hasDefault ? JSON.stringify(spec.defaultValue) : "❌缺"}`,
      );
    }
  } catch (err) {
    console.log("  PARSE_ERR " + (err as Error).message);
  }
}

console.log("\n=== B. 投影 strategy_parameters（转正后）===");
const [params] = await conn.query(
  // ⚠️ `MAXVALUE` 是 TiDB/MySQL 保留字 ⇒ 列名必须加反引号，否则 ER_PARSE_ERROR。
  "SELECT strategyVersionId, code, dataType, parameterRole, defaultValueJson, `minValue`, `maxValue`, stepValue "
  + "FROM strategy_parameters WHERE strategyVersionId >= 420001 ORDER BY strategyVersionId, ordinal",
);
for (const r of params as Array<Record<string, unknown>>) {
  console.log("  " + JSON.stringify(r));
}

console.log("\n=== C. 判据汇总 ===");
const rows = params as Array<Record<string, unknown>>;
const missing = rows.filter((r) => r.defaultValueJson === null);
console.log(`  strategy_parameters 行数 = ${rows.length}`);
console.log(`  defaultValueJson IS NULL 的行数 = ${missing.length}`);
console.log(`  → ${missing.length === 0 ? "全部有默认值（运行不会被 RECIPE_PARAMETER_NO_DEFAULT 拦）" : "⚠️ 存在无默认值参数 ⇒ 这些策略运行时必然失败"}`);

console.log("\n=== D. 策略文档里 parameters 的 defaultValue（Canonical SoT）===");
const [vers] = await conn.query(
  "SELECT id, strategyId, strategyDocumentJson FROM strategy_versions WHERE id >= 420001 ORDER BY id",
);
for (const r of vers as Array<{ id: number; strategyId: string; strategyDocumentJson: string }>) {
  let summary = "PARSE_ERR";
  try {
    const doc = JSON.parse(r.strategyDocumentJson) as {
      definition?: { parameters?: Array<Record<string, unknown>> };
    };
    const ps = doc.definition?.parameters ?? [];
    summary = ps
      .map((p) => `${String(p.code)}{role=${String(p.parameterRole)},def=${p.defaultValue === undefined ? "❌" : JSON.stringify(p.defaultValue)}}`)
      .join(" ");
  } catch { /* 保留 PARSE_ERR */ }
  console.log(`  version ${r.id} (${r.strategyId}) : ${summary}`);
}

await conn.end();
process.exit(0);
