/**
 * 只读探针：读取 Run #570001 下 13 条 CONDITIONAL 分析的落库结果。
 *
 * 目的：验证「观察日条件」是否真的求值成功（而非全 null / 未命中），
 * 并把「守线」「缩量≤50%」等关键组的样本量与早前独立探针的预期对齐。
 *
 * 只读：仅 SELECT，不写任何表。
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const RUN_ID = 570001;

const m = /^mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/.exec(process.env.DATABASE_URL!);
if (!m) throw new Error("DATABASE_URL 解析失败");

const cfg = {
  user: decodeURIComponent(m[1]),
  password: decodeURIComponent(m[2]),
  host: m[3],
  port: Number(m[4]),
  database: m[5].split("/")[0],
};

const conn = await mysql.createConnection({
  ...cfg,
  ssl: { rejectUnauthorized: false },
  connectTimeout: 30_000,
});

type Row = Record<string, unknown>;

async function main() {
  const [analyses] = await conn.query<Row[]>(
    `SELECT id, analysisType, status, name, target, configJson
       FROM research_analysis
      WHERE runId = ?
      ORDER BY id`,
    [RUN_ID],
  );

  console.log(`analysis count = ${analyses.length}`);

  for (const a of analyses) {
    const [conds] = await conn.query<Row[]>(
      `SELECT groupNo, sortOrder, fieldName, operator, valueJson
         FROM research_analysis_condition
        WHERE analysisId = ?
        ORDER BY groupNo, sortOrder, id`,
      [a.id],
    );
    const [metrics] = await conn.query<Row[]>(
      `SELECT metricCode, metricName, configJson
         FROM research_analysis_metric
        WHERE analysisId = ?
        ORDER BY displayOrder, id`,
      [a.id],
    );

    let cfgObj: any = null;
    try {
      cfgObj = JSON.parse(String(a.configJson));
    } catch {
      cfgObj = null;
    }

    // 按 groupNo 聚合条件文本
    const byGroup = new Map<number, string[]>();
    for (const c of conds) {
      const g = Number(c.groupNo);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(`${c.fieldName} ${c.operator} ${String(c.valueJson)}`);
    }
    const groupText = [...byGroup.entries()]
      .map(([g, items]) => `G${g}:[${items.join(" & ")}]`)
      .join(" | ");

    console.log(`\n=== #${a.id} ${a.status} :: ${a.name}`);
    console.log(`    target      = ${a.target}   (cfg.targetField=${cfgObj?.targetField ?? "-"})`);
    console.log(`    groups      = ${groupText || "(none)"}`);
    console.log(`    metricRows  = ${metrics.length} -> ${metrics.map((x) => x.metricCode).join(",")}`);
  }

  // 结果表（如果有）：先探测表是否存在同名
  const [tables] = await conn.query<any[]>(
    `SELECT table_name AS t FROM information_schema.tables
      WHERE table_schema = ? AND table_name LIKE 'research%' ORDER BY table_name`,
    [cfg.database],
  );
  console.log(`\nresearch* tables => ${tables.map((r) => r.t).join(", ")}`);
}

try {
  await main();
} finally {
  await conn.end();
}
