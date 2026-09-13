/**
 * 诊断：run 570001 的 13 个 CONDITIONAL 分析 —— 关键指标汇总（只读）。
 *
 * 输出：每组条件的 sampleCount / DIFFERENCE / p / t / CONDITION 均值与胜率 / ALL 均值与胜率。
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL as string);

const [analyses] = await conn.query(
  "SELECT id, name FROM research_analysis WHERE id BETWEEN 540001 AND 540013 ORDER BY id",
);
const nameById = new Map<number, string>();
for (const a of analyses as Array<{ id: number; name: string }>) nameById.set(a.id, a.name);

const [rows] = await conn.query(
  "SELECT analysisId, resultType, dimensionJson, metricCode, metricValue, sampleCount "
  + "FROM research_result WHERE analysisId BETWEEN 540001 AND 540013 ORDER BY analysisId, id",
);

type Agg = Record<string, { value: number | null; n: number | null }>;
const byAnalysis = new Map<number, Agg>();
for (const r of rows as Array<Record<string, unknown>>) {
  const id = Number(r.analysisId);
  let agg = byAnalysis.get(id);
  if (agg === undefined) { agg = {}; byAnalysis.set(id, agg); }
  const dim = typeof r.dimensionJson === "string" ? r.dimensionJson : "";
  const key = dim.includes("CONDITION") ? `C:${String(r.metricCode)}`
    : dim.includes("ALL") ? `A:${String(r.metricCode)}`
    : `S:${String(r.metricCode)}`;
  agg[key] = { value: r.metricValue === null ? null : Number(r.metricValue), n: r.sampleCount === null ? null : Number(r.sampleCount) };
}

const fmt = (v: number | null | undefined, digits = 4): string =>
  v === null || v === undefined ? "—" : v.toFixed(digits);

console.log("analysisId | 条件名 | 条件样本 | ALL样本 | 条件均值 | ALL均值 | 差值 | p | t | 条件胜率 | ALL胜率");
for (const [id, agg] of [...byAnalysis.entries()].sort((a, b) => a[0] - b[0])) {
  const cN = agg["C:SAMPLE_COUNT"]?.value ?? null;
  const aN = agg["A:SAMPLE_COUNT"]?.value ?? null;
  const lines = [
    String(id),
    nameById.get(id) ?? "?",
    String(cN ?? "—"),
    String(aN ?? "—"),
    fmt(agg["C:MEAN_RETURN"]?.value),
    fmt(agg["A:MEAN_RETURN"]?.value),
    fmt(agg["S:DIFFERENCE"]?.value, 5),
    fmt(agg["S:P_VALUE_DIFFERENCE"]?.value, 5),
    fmt(agg["S:T_STAT_DIFFERENCE"]?.value, 3),
    fmt(agg["C:WIN_RATE"]?.value),
    fmt(agg["A:WIN_RATE"]?.value),
  ];
  console.log(lines.join(" | "));
}

await conn.end();
process.exit(0);
