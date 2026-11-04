/**
 * 探针：列出 `closed_loop_backtest_run` 现有行（判断是否有探针残留污染产品页）。
 *
 * 默认**只读**。带 `--clean-probe-rows` 时才删除「探针残留」——判据是**双重命名守卫**
 * （`experimentId` 以 `EXP-PROBE` 开头 **且** `strategyId` 以 `probe-` 开头），
 * 绝不误删真实运行（`cand-*` 策略）。
 *
 * 用法：
 *   npx tsx docs/evidence/_probe_clbr_rows.mts
 *   npx tsx docs/evidence/_probe_clbr_rows.mts --clean-probe-rows
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const shouldClean = process.argv.includes("--clean-probe-rows");

const db = await getDb();
if (!db) {
  console.log("数据库不可用");
  process.exit(1);
}

const rows = (await db.execute(sql`
  SELECT id, runId, experimentId, strategyId, strategyVersion, startDate, endDate,
         status, executedStageCount, blockedStageCount, skippedStageCount,
         tradeCount, finalEquity, createdAt,
         CHAR_LENGTH(COALESCE(resultJson, '')) AS resultJsonChars
  FROM closed_loop_backtest_run
  ORDER BY id
`)) as unknown as Array<Array<Record<string, unknown>>>;
const list = (Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : []) as Array<
  Record<string, unknown>
>;

console.log(`留档行数 = ${list.length}`);
for (const r of list) {
  console.log(
    [
      `id=${r["id"]}`,
      `runId=${r["runId"]}`,
      `exp=${r["experimentId"]}`,
      `strat=${r["strategyId"]}@${r["strategyVersion"]}`,
      `win=${String(r["startDate"]).slice(0, 10)}~${String(r["endDate"]).slice(0, 10)}`,
      `status=${r["status"]}`,
      `stage=${r["executedStageCount"]}/${r["blockedStageCount"]}/${r["skippedStageCount"]}`,
      `trades=${r["tradeCount"]}`,
      `equity=${r["finalEquity"]}`,
      `createdAt=${r["createdAt"]}`,
      `resultJsonChars=${r["resultJsonChars"]}`,
    ].join(" | "),
  );
}

// --- 可选：清理探针残留（双重命名守卫；默认不动） -------------------------------
const probeRows = (await db.execute(sql`
  SELECT id, runId FROM closed_loop_backtest_run
  WHERE experimentId LIKE 'EXP-PROBE%' AND strategyId LIKE 'probe-%'
  ORDER BY id
`)) as unknown as Array<Array<{ id: unknown; runId: unknown }>>;
const probeList = (
  Array.isArray(probeRows) && Array.isArray(probeRows[0]) ? probeRows[0] : []
) as Array<{ id: unknown; runId: unknown }>;

// 只命中一半守卫的行 = 可疑但不自动删（避免守卫放宽后误删真实运行）。
const suspectRows = (await db.execute(sql`
  SELECT id, runId, experimentId, strategyId FROM closed_loop_backtest_run
  WHERE (experimentId LIKE 'EXP-PROBE%' OR strategyId LIKE 'probe-%')
    AND NOT (experimentId LIKE 'EXP-PROBE%' AND strategyId LIKE 'probe-%')
  ORDER BY id
`)) as unknown as Array<Array<Record<string, unknown>>>;
const suspectList = (
  Array.isArray(suspectRows) && Array.isArray(suspectRows[0]) ? suspectRows[0] : []
) as Array<Record<string, unknown>>;

console.log(`\n探针残留行（双守卫命中）= ${probeList.length}`);
for (const r of probeList) console.log(`   · id=${r.id} runId=${r.runId}`);
if (suspectList.length > 0) {
  console.log(`\n⚠️ 可疑但未自动删除（只命中单侧守卫）= ${suspectList.length}`);
  for (const r of suspectList) {
    console.log(`   · id=${r["id"]} runId=${r["runId"]} exp=${r["experimentId"]} strat=${r["strategyId"]}`);
  }
}

if (shouldClean) {
  if (probeList.length === 0) {
    console.log("\n无探针残留，无需清理。");
  } else {
    for (const r of probeList) {
      await db.execute(sql`DELETE FROM closed_loop_backtest_run WHERE id = ${Number(r.id)}`);
    }
    const after = (await db.execute(
      sql`SELECT COUNT(*) AS c FROM closed_loop_backtest_run`,
    )) as unknown as Array<Array<{ c: number }>>;
    const afterCount =
      Array.isArray(after) && Array.isArray(after[0]) && after[0][0] ? Number(after[0][0].c) : -1;
    console.log(`\n已删除探针残留 ${probeList.length} 行 ⇒ 现留档行数 = ${afterCount}`);
  }
} else if (probeList.length > 0) {
  console.log("\n（只读模式；加 --clean-probe-rows 才会删除上述残留行）");
}

process.exit(0);
