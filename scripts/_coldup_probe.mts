/**
 * 一次性探针：核查 ds_*_path 表的列级冗余（衍生列是否两两重复）。
 * 只读。
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) {
    console.log("no db");
    return;
  }
  const T = "ds_first_limit_pullback_path";

  const r = await db.execute(
    sql.raw(`
SELECT COUNT(*) AS total,
       SUM(returnFromEventClose <=> closeFromEventClose) AS pair1_same,
       SUM(lowFromEventClose    <=> pullbackFromEventClose) AS pair2_same,
       SUM(isBreakout IS NOT NULL) AS breakout_nonnull,
       SUM(volumeRatio IS NOT NULL) AS volratio_nonnull,
       SUM(turnover IS NOT NULL) AS turnover_nonnull
FROM \`${T}\``),
  );
  console.log("列级冗余核查:", JSON.stringify((r as any[])[0]));

  // outcome 能否由 path 重算 —— 抽样比对 maxReturn = max(high)/eventClose - 1
  const r2 = await db.execute(
    sql.raw(`
SELECT o.datasetVersionId, o.eventId, o.horizon, o.maxReturn,
       MAX(p.high) AS pathMaxHigh,
       COUNT(*) AS pathRowsInWindow
FROM \`ds_first_limit_pullback_outcome\` o
JOIN \`${T}\` p
  ON p.datasetVersionId = o.datasetVersionId AND p.eventId = o.eventId
 AND p.relativeDay >= 1 AND p.relativeDay <= o.horizon
WHERE o.datasetVersionId = 90001
GROUP BY o.datasetVersionId, o.eventId, o.horizon
LIMIT 5`),
  );
  console.log("outcome↔path 血缘抽样:", JSON.stringify(r2, null, 1));

  // path 中 relativeDay=0 行与 event 行是否同价
  const r3 = await db.execute(
    sql.raw(`
SELECT COUNT(*) AS matched
FROM \`${T}\` p
JOIN \`ds_first_limit_pullback_event\` e
  ON e.datasetVersionId = p.datasetVersionId AND e.eventId = p.eventId
WHERE p.relativeDay = 0
  AND p.close <=> e.close AND p.high <=> e.high AND p.low <=> e.low AND p.open <=> e.open`),
  );
  console.log("path(0) 与 event 同价行数:", JSON.stringify((r3 as any[])[0]));
  const r4 = await db.execute(sql.raw(`SELECT COUNT(*) AS c FROM \`${T}\` WHERE relativeDay = 0`));
  console.log("path(0) 总行数:", JSON.stringify((r4 as any[])[0]));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log("ERR " + String(e).slice(0, 400));
    process.exit(1);
  });
