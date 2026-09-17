/**
 * _probe_analysis_780001.mts —— 缺陷复现探针：用户报告 ID 780001。
 *
 * 用户现象：在 `/research/ask` 的结论页点「创建 Candidate」→ toast 报
 *   「创建候选失败 · 分析 780001 没有任何条件，无法导出候选题筛选条件。」
 *
 * 待验证的假设：780001 是该 Run 的 **第一条 P0 分析 = EVENT_STUDY 全样本基准**
 *   （`analysisPlan.ts:361` 是全函数第一条 `push`，priority = "P0"），
 *   而前端 `ResearchAsk.tsx:219` 取的是 `find(a => a.priority === "P0")`
 *   ⇒ 必然落在没有 `research_analysis_condition` 行的那条上。
 *
 * 只读，零写库。
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

const ID = Number(process.argv[2] ?? 780001);

function say(line = "") {
  console.log(line);
}

/**
 * drizzle `db.execute()` 在 mysql2 驱动下返回 `[rows, fields]` **元组**，
 * 直接 `.rows` 会 `TypeError: not iterable`。统一取元组首元素。
 */
function pick(res: unknown): Record<string, unknown>[] {
  return ((res as [Record<string, unknown>[]] | undefined)?.[0]) ?? [];
}

async function main() {
  const db = await getDb();
  if (db === null) throw new Error("数据库不可用（DATABASE_URL 未配置）");

  say(`=== 分析 ${ID} ===`);
  const a = await db.execute(sql`
    SELECT a.id, a.runId, a.name, a.analysisType, a.status,
           a.target, a.priority, a.requiredFlag, a.planId, a.moduleKey, a.purpose
      FROM research_analysis a
     WHERE a.id = ${ID}
  `);
  for (const row of pick(a)) say(JSON.stringify(row, null, 2));

  say("");
  say(`=== 该分析的落库条件（research_analysis_condition）===`);
  const c = await db.execute(sql`
    SELECT c.id, c.groupNo, c.sortOrder, c.fieldName, c.operator, c.valueJson
      FROM research_analysis_condition c
     WHERE c.analysisId = ${ID}
     ORDER BY c.groupNo, c.sortOrder
  `);
  say(`条件行数 = ${pick(c).length}`);
  for (const row of pick(c)) say(JSON.stringify(row));

  // ---- 该分析所属 Run 的 P0 清单，按 id 升序（模拟前端 find 的遍历顺序）----
  say("");
  say(`=== 所属 Run 的 P0 分析（按 id 升序 = 前端 find 的遍历顺序）===`);
  const p0 = await db.execute(sql`
    SELECT a.id, a.priority, a.requiredFlag, a.analysisType, a.name,
           (SELECT COUNT(*) FROM research_analysis_condition c WHERE c.analysisId = a.id) AS conditionCount
      FROM research_analysis a
     WHERE a.runId = (SELECT runId FROM research_analysis WHERE id = ${ID})
       AND a.priority = 'P0'
     ORDER BY a.id
  `);
  for (const row of pick(p0)) say(JSON.stringify(row));

  say("");
  say("=== 判定 ===");
  const first = pick(p0)[0];
  if (first === undefined) {
    say("该 Run 没有任何 P0 分析 —— 那么前端会回落到 outcome.analyses[0]。");
  } else {
    const isTarget = Number(first.id) === ID;
    say(`前端 find(a => a.priority === "P0") 会取到 #${first.id}`
      + `（type=${String(first.analysisType)}，条件数=${String(first.conditionCount)}）`);
    say(isTarget
      ? "⇒ 与本探针对象一致：**根因成立** —— 前端取到了无条件分析。"
      : "⇒ 与本探针对象不一致，需继续排查。");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("探针失败：", err);
  process.exit(1);
});
