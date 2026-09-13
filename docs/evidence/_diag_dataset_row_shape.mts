/** 诊断：`ResearchDataset.rows[]` 的真实形状（只读）—— 定位 bars 的实际字段名。 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { assembleRunWorkbenchInputs } from "../../server/runWorkbenchAssembly/assemble";
import type { StrategyDocument } from "../../server/research/strategySchema/types";

const conn = await createConnection(process.env.DATABASE_URL as string);
const [rows] = await conn.query(
  "SELECT strategyDocumentJson FROM strategy_versions WHERE strategyId = 'cand-360001' ORDER BY id DESC LIMIT 1",
);
const doc = JSON.parse(
  typeof (rows as Array<{ strategyDocumentJson: unknown }>)[0].strategyDocumentJson === "string"
    ? ((rows as Array<{ strategyDocumentJson: string }>)[0].strategyDocumentJson)
    : JSON.stringify((rows as Array<{ strategyDocumentJson: unknown }>)[0].strategyDocumentJson),
) as StrategyDocument;

const versionId = doc.definition?.datasets?.[0]?.datasetVersionId;
const assembled = await assembleRunWorkbenchInputs({
  strategyId: "cand-360001",
  strategyVersion: doc.version,
  startDate: "2024-01-02",
  endDate: "2024-03-29",
  createdAt: new Date().toISOString(),
  codeVersion: "probe",
  strategyDocument: doc,
  ...(versionId === undefined ? {} : { datasetVersionId: versionId }),
  maxSecuritiesPerDay: 20,
});

const ds = assembled.dataset;
console.log("dataset 顶层键:", Object.keys(ds).join(", "));
const r0 = ds.rows[0];
console.log("\nrows[0] 键:", Object.keys(r0).join(", "));
console.log("rows[0] =", JSON.stringify(r0).slice(0, 900));

// 逐键找数组型字段（bars 的候选）
console.log("\n=== 各键类型 ===");
for (const [k, v] of Object.entries(r0 as Record<string, unknown>)) {
  const t = Array.isArray(v) ? `array(${v.length})` : typeof v;
  console.log(`  ${k}: ${t}${Array.isArray(v) && v.length > 0 ? ` → 元素键=[${Object.keys(v[0] as object).join(", ")}]` : ""}`);
}

// 有没有别的顶层容器放 bars
console.log("\n=== dataset 顶层各键 ===");
for (const [k, v] of Object.entries(ds as unknown as Record<string, unknown>)) {
  const t = Array.isArray(v) ? `array(${v.length})` : typeof v;
  console.log(`  ${k}: ${t}`);
}

await conn.end();
process.exit(0);
