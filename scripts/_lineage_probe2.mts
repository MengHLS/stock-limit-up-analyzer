/**
 * 一次性探针：定位 outcome↔path 重算中 3/1509 不匹配的原因（是否为 NULL 语义）。
 * 只读。范围 v1（id=30001）。
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

  const r = await db.execute(
    sql.raw(`
SELECT
  COUNT(*)                                                          AS compared,
  SUM(o.maxReturn IS NULL)                                          AS out_null,
  SUM(e.close IS NULL)                                              AS evclose_null,
  SUM(w.maxHigh IS NULL)                                            AS maxhigh_null,
  SUM(ABS(o.maxReturn - (w.maxHigh/e.close - 1)) < 1e-9)            AS match_tight,
  SUM(ABS(o.maxReturn - (w.maxHigh/e.close - 1)) < 1e-6)            AS match_loose,
  MAX(ABS(o.maxReturn - (w.maxHigh/e.close - 1)))                   AS max_abs_diff
FROM ds_first_limit_pullback_outcome o
JOIN ds_first_limit_pullback_event e
  ON e.datasetVersionId = o.datasetVersionId AND e.eventId = o.eventId
JOIN (
  SELECT p.datasetVersionId AS v, p.eventId AS eid, o2.horizon AS h,
         MAX(p.high) AS maxHigh
  FROM ds_first_limit_pullback_path p
  JOIN ds_first_limit_pullback_outcome o2
    ON o2.datasetVersionId = p.datasetVersionId AND o2.eventId = p.eventId
   AND p.relativeDay >= 1 AND p.relativeDay <= o2.horizon
  WHERE p.datasetVersionId = ${V}
  GROUP BY p.datasetVersionId, p.eventId, o2.horizon
) w ON w.v = o.datasetVersionId AND w.eid = o.eventId AND w.h = o.horizon
WHERE o.datasetVersionId = ${V}`),
  );
  console.log("R3 差异归因: " + JSON.stringify((r as any[])[0]));

  // 列出不匹配明细
  const r2 = await db.execute(
    sql.raw(`
SELECT o.eventId, o.horizon, o.maxReturn, e.close AS evClose, w.maxHigh,
       (w.maxHigh/e.close - 1) AS recomputed
FROM ds_first_limit_pullback_outcome o
JOIN ds_first_limit_pullback_event e
  ON e.datasetVersionId = o.datasetVersionId AND e.eventId = o.eventId
JOIN (
  SELECT p.datasetVersionId AS v, p.eventId AS eid, o2.horizon AS h, MAX(p.high) AS maxHigh
  FROM ds_first_limit_pullback_path p
  JOIN ds_first_limit_pullback_outcome o2
    ON o2.datasetVersionId = p.datasetVersionId AND o2.eventId = p.eventId
   AND p.relativeDay >= 1 AND p.relativeDay <= o2.horizon
  WHERE p.datasetVersionId = ${V}
  GROUP BY p.datasetVersionId, p.eventId, o2.horizon
) w ON w.v = o.datasetVersionId AND w.eid = o.eventId AND w.h = o.horizon
WHERE o.datasetVersionId = ${V}
  AND (ABS(o.maxReturn - (w.maxHigh/e.close - 1)) >= 1e-9 OR w.maxHigh IS NULL OR e.close IS NULL)
LIMIT 10`),
  );
  console.log("R4 不匹配明细: " + JSON.stringify((r2 as any[])[0]));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log("ERR " + String(e).slice(0, 400));
    process.exit(1);
  });
