/**
 * 探针：回测结果持久化的真实库现状。
 *
 * 回答三个问题（只读，零写入）：
 *   1. `backtest_runs`（旧：龙头候选回测保存表）在真实库里**是否存在**、有几行、
 *      最近一条的时间与摘要 —— 判定「前端点保存是否真能落库」。
 *   2. `paper_trading_runs` 对照组。
 *   3. 闭环 `loopRun` 的结果当前落在哪（预期：**无处可落**）——
 *      逐一检查候选表是否存在可承载的列。
 *
 * 输出 JSON 到同目录 .json，便于留证。
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

type TableReport = {
  table: string;
  exists: boolean;
  rowCount: number | null;
  error: string | null;
  columns?: Array<{ name: string; type: string; nullable: string }>;
  latest?: unknown;
};

async function inspectTable(db: Awaited<ReturnType<typeof getDb>>, table: string): Promise<TableReport> {
  const report: TableReport = { table, exists: false, rowCount: null, error: null };
  try {
    const cols = (await db!.execute(
      sql`SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table}
          ORDER BY ORDINAL_POSITION`,
    )) as unknown as Array<Array<{ name: string; type: string; nullable: string }>>;
    const colRows = (cols as unknown as { 0?: unknown })[0] as
      | Array<{ name: string; type: string; nullable: string }>
      | undefined;
    const list = Array.isArray(colRows) ? colRows : [];
    if (list.length === 0) return report;
    report.exists = true;
    report.columns = list.map((c) => ({ name: c.name, type: c.type, nullable: c.nullable }));

    const cnt = (await db!.execute(sql.raw(`SELECT COUNT(*) AS c FROM \`${table}\``))) as unknown as Array<
      Array<{ c: number }>
    >;
    const first = (cnt as unknown as { 0?: unknown })[0] as Array<{ c: number }> | undefined;
    report.rowCount = Number(Array.isArray(first) && first[0] ? first[0].c : 0);
  } catch (error) {
    report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  return report;
}

async function main() {
  const db = await getDb();
  if (!db) {
    console.log("数据库不可用（DATABASE_URL 未配置）");
    process.exit(1);
  }

  const targets = ["backtest_runs", "paper_trading_runs", "research_run"];
  const reports: TableReport[] = [];
  for (const t of targets) {
    reports.push(await inspectTable(db, t));
  }

  // 旧保存表若有数据，取最近一条的摘要列（不取 longtext 正文）
  const bt = reports.find((r) => r.table === "backtest_runs");
  if (bt?.exists) {
    try {
      const rows = (await db.execute(
        sql`SELECT id, paramsHash, LEFT(paramsJson, 200) AS paramsHead,
                   LEFT(summaryJson, 300) AS summaryHead,
                   CHAR_LENGTH(COALESCE(resultJson,'')) AS resultChars,
                   DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt
            FROM backtest_runs ORDER BY id DESC LIMIT 3`,
      )) as unknown as Array<Array<unknown>>;
      const first = (rows as unknown as { 0?: unknown })[0];
      bt.latest = Array.isArray(first) ? first : [];
    } catch (error) {
      bt.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  }

  const out = { generatedAt: new Date().toISOString(), database: "TiDB(TiDB Cloud)", tables: reports };
  writeFileSync(
    new URL("./_probe_backtest_storage_state.json", import.meta.url),
    JSON.stringify(out, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error("探针失败：", error);
  process.exit(1);
});
