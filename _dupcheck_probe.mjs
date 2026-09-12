/**
 * 证据探针：path / outcome 是否存在真实重复行。
 *
 * 分三层判定，避免把「跨版本同源」误判为「表内重复」：
 *   L1 表内重复：同 (datasetVersionId, eventId, relativeDay) / (datasetVersionId, eventId, horizon) 是否 >1 行
 *      —— 有 UNIQUE 约束 + ON DUPLICATE KEY，理论应为 0。
 *   L2 跨版本同源：同 (eventId, relativeDay) 在多少个 datasetVersionId 下各有一行
 *      —— 每个版本都有自己的行，这是「版本隔离」的正确行为，不是重复。
 *   L3 总量分布：每个版本的 path / outcome / event 行数
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const EVENT = "ds_first_limit_pullback_event";
const PATH = "ds_first_limit_pullback_path";
const OUTCOME = "ds_first_limit_pullback_outcome";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  const out = {};

  const [verRows] = await conn.query(
    "SELECT datasetVersionId, COUNT(*) AS c FROM `" + EVENT + "` GROUP BY datasetVersionId ORDER BY datasetVersionId",
  );
  const [pathRows] = await conn.query(
    "SELECT datasetVersionId, COUNT(*) AS c FROM `" + PATH + "` GROUP BY datasetVersionId ORDER BY datasetVersionId",
  );
  const [ocRows] = await conn.query(
    "SELECT datasetVersionId, COUNT(*) AS c FROM `" + OUTCOME + "` GROUP BY datasetVersionId ORDER BY datasetVersionId",
  );
  out.perVersion = { events: verRows, paths: pathRows, outcomes: ocRows };

  // L1：表内重复
  const [dupPath] = await conn.query(
    "SELECT datasetVersionId, eventId, relativeDay, COUNT(*) AS n FROM `" + PATH + "` " +
      "GROUP BY datasetVersionId, eventId, relativeDay HAVING n > 1 LIMIT 5",
  );
  const [dupPathTotal] = await conn.query(
    "SELECT COUNT(*) AS groups_ FROM (SELECT 1 FROM `" + PATH + "` " +
      "GROUP BY datasetVersionId, eventId, relativeDay HAVING COUNT(*) > 1) t",
  );
  const [dupOcTotal] = await conn.query(
    "SELECT COUNT(*) AS groups_ FROM (SELECT 1 FROM `" + OUTCOME + "` " +
      "GROUP BY datasetVersionId, eventId, horizon HAVING COUNT(*) > 1) t",
  );
  const [dupEvTotal] = await conn.query(
    "SELECT COUNT(*) AS groups_ FROM (SELECT 1 FROM `" + EVENT + "` " +
      "GROUP BY datasetVersionId, eventId HAVING COUNT(*) > 1) t",
  );
  out.L1_inTableDuplicates = {
    pathGroups: Number(dupPathTotal[0]?.groups_ ?? -1),
    outcomeGroups: Number(dupOcTotal[0]?.groups_ ?? -1),
    eventGroups: Number(dupEvTotal[0]?.groups_ ?? -1),
    pathSample: dupPath,
  };

  // 唯一约束实际存在性
  const [idx] = await conn.query(
    "SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols " +
      "FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() " +
      "AND TABLE_NAME IN (?,?,?) AND NON_UNIQUE = 0 GROUP BY TABLE_NAME, INDEX_NAME",
    [EVENT, PATH, OUTCOME],
  );
  out.uniqueIndexes = idx;

  // L2：跨版本同源（同一 eventId+relativeDay 出现在几个版本里）
  const [crossPath] = await conn.query(
    "SELECT eventId, relativeDay, COUNT(DISTINCT datasetVersionId) AS versions " +
      "FROM `" + PATH + "` GROUP BY eventId, relativeDay ORDER BY versions DESC LIMIT 5",
  );
  const [crossDist] = await conn.query(
    "SELECT versions, COUNT(*) AS rows_ FROM (" +
      "SELECT eventId, relativeDay, COUNT(DISTINCT datasetVersionId) AS versions FROM `" + PATH + "` " +
      "GROUP BY eventId, relativeDay) t GROUP BY versions ORDER BY versions",
  );
  out.L2_crossVersion = { top: crossPath, distribution: crossDist };

  // L3：唯一键覆盖比例（path 行是否严格 = 事件数 × 相对日数）
  const [ratio] = await conn.query(
    "SELECT p.datasetVersionId, COUNT(DISTINCT p.eventId) AS events_in_path, " +
      "COUNT(DISTINCT p.relativeDay) AS distinct_rel, COUNT(*) AS path_rows " +
      "FROM `" + PATH + "` p GROUP BY p.datasetVersionId ORDER BY p.datasetVersionId",
  );
  out.L3 = ratio;

  console.log(JSON.stringify(out, null, 2));
  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
