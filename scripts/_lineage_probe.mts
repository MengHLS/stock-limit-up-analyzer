/**
 * 一次性探针：① event/path 的 turnover 是否死列；② outcome 是否可由 path 精确重算。
 * 只读。范围取 v1（id=30001，path 6,454 行）以控制跨境查询耗时。
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const V = 30001;

async function main() {
  const db = await getDb();
  if (!db) {
    console.log("no db");
    return;
  }

  const r1 = await db.execute(
    sql.raw(`
SELECT 'event' AS tbl, COUNT(*) AS total, SUM(turnover IS NOT NULL) AS turnover_nonnull,
       SUM(marketCap IS NOT NULL) AS mcap_nonnull, SUM(industryCode IS NOT NULL) AS ind_nonnull
FROM ds_first_limit_pullback_event
UNION ALL
SELECT 'path', COUNT(*), SUM(turnover IS NOT NULL), NULL, NULL
FROM ds_first_limit_pullback_path`),
  );
  console.log("R1 死列核查: " + JSON.stringify((r1 as any[])[0]));

  const r2 = await db.execute(
    sql.raw(`
SELECT COUNT(*) AS compared,
       SUM(ABS(o.maxReturn  - (w.maxHigh /e.close - 1)) < 1e-9) AS maxReturn_match,
       SUM(ABS(o.minReturn  - (w.minLow  /e.close - 1)) < 1e-9) AS minReturn_match,
       SUM(ABS(o.maxDrawdown- (w.minClose/e.close - 1)) < 1e-9) AS maxDD_match
FROM ds_first_limit_pullback_outcome o
JOIN ds_first_limit_pullback_event e
  ON e.datasetVersionId = o.datasetVersionId AND e.eventId = o.eventId
JOIN (
  SELECT p.datasetVersionId AS v, p.eventId AS eid, o2.horizon AS h,
         MAX(p.high) AS maxHigh, MIN(p.low) AS minLow, MIN(p.close) AS minClose
  FROM ds_first_limit_pullback_path p
  JOIN ds_first_limit_pullback_outcome o2
    ON o2.datasetVersionId = p.datasetVersionId AND o2.eventId = p.eventId
   AND p.relativeDay >= 1 AND p.relativeDay <= o2.horizon
  WHERE p.datasetVersionId = ${V}
  GROUP BY p.datasetVersionId, p.eventId, o2.horizon
) w ON w.v = o.datasetVersionId AND w.eid = o.eventId AND w.h = o.horizon
WHERE o.datasetVersionId = ${V}`),
  );
  console.log("R2 outcome←path 重算: " + JSON.stringify((r2 as any[])[0]));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log("ERR " + String(e).slice(0, 400));
    process.exit(1);
  });
