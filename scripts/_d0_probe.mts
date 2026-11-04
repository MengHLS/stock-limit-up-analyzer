import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();

// D0（relativeDay=0）行情完整性：这是 C3 决策的直接依据
const r1 = await db.execute(sql.raw(`
SELECT datasetVersionId,
  COUNT(*) AS rd0_rows,
  SUM(close IS NOT NULL) AS close_ok,
  SUM(open IS NOT NULL) AS open_ok,
  SUM(high IS NOT NULL) AS high_ok,
  SUM(low IS NOT NULL) AS low_ok,
  SUM(volume IS NOT NULL) AS vol_ok,
  SUM(amount IS NOT NULL) AS amt_ok
FROM ds_first_limit_pullback_path
WHERE relativeDay = 0
GROUP BY datasetVersionId
`));
console.log("R_D0 " + JSON.stringify((r1 as any[])[0]));

// event 表行数（与 rd=0 行数对比，验证一一对应）
const r2 = await db.execute(sql.raw(`
SELECT datasetVersionId, COUNT(*) AS ev_rows
FROM ds_first_limit_pullback_event
GROUP BY datasetVersionId
`));
console.log("R_EV " + JSON.stringify((r2 as any[])[0]));

// 反向：每个 event 是否都缺 D0 行（当前 rd=0 语义下的孤儿）
const r3 = await db.execute(sql.raw(`
SELECT e.datasetVersionId, COUNT(*) AS orphan_events
FROM ds_first_limit_pullback_event e
LEFT JOIN ds_first_limit_pullback_path p
  ON p.datasetVersionId = e.datasetVersionId
 AND p.eventId = e.eventId
 AND p.relativeDay = 0
WHERE p.id IS NULL
GROUP BY e.datasetVersionId
`));
console.log("R_ORPHAN " + JSON.stringify((r3 as any[])[0]));

// path 表 relativeDay 区间实测（确认是否含负值）
const r4 = await db.execute(sql.raw(`
SELECT datasetVersionId, MIN(relativeDay) AS minRD, MAX(relativeDay) AS maxRD,
  SUM(relativeDay < 0) AS neg_rows, SUM(relativeDay = 0) AS zero_rows, SUM(relativeDay > 0) AS pos_rows
FROM ds_first_limit_pullback_path
GROUP BY datasetVersionId
`));
console.log("R_RANGE " + JSON.stringify((r4 as any[])[0]));

process.exit(0);
