// STEP DATASET-001 — 数据质量校验脚本（真实 DB，只读）。
// 校验（事件窗口五表分层，DATABASE_REDESIGN §2）：唯一性/幂等、版本隔离、relativeDay 区间、
// horizon 集合、五表行数一致性、交易日历推进、无策略绑定列、涨停价口径 sanity、
// 以及结构级 PIT 防线（prefix/post 不含衍生列、event 不含日线行情列）。
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL=(\S+)/)[1].replace(/["']/g, "");
const u = new URL(url);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: +u.port,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 15000,
  dateStrings: true,
});

const q = async (sql, params = []) => (await conn.query(sql, params))[0];

const CODE = "first_limit_pullback";
const T = {
  event: `ds_${CODE}_event`,
  prefix: `ds_${CODE}_prefix`,
  post: `ds_${CODE}_post`,
  path: `ds_${CODE}_path`,
  outcome: `ds_${CODE}_outcome`,
};

const versions = await q("SELECT id, version, status, totalEvents, totalRows FROM dataset_version ORDER BY id");

const report = { versions: [], schema: {}, global: {} };

// 0) 结构：五表列集合 + PIT 防线
const tableList = await q(
  `SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?,?,?,?,?)`,
  Object.values(T),
);
report.schema.tablesPresent = tableList.map((r) => r.TABLE_NAME).sort();
report.schema.fiveTablesPresent = tableList.length === 5;

const allCols = await q(
  `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?,?,?,?,?)`,
  Object.values(T),
);
const colsOf = (t) => allCols.filter((c) => c.TABLE_NAME === t).map((c) => c.COLUMN_NAME.toLowerCase());
report.schema.eventHasDailyBars = ["open", "high", "low", "close", "volume", "amount"].filter((c) =>
  colsOf(T.event).includes(c),
);
report.schema.prefixHasDerived = colsOf(T.prefix).filter(
  (c) => c.includes("fromeventclose") || c.includes("fromeventhigh") || c === "isbreakout",
);
report.schema.postHasDerived = colsOf(T.post).filter(
  (c) => c.includes("fromeventclose") || c.includes("fromeventhigh") || c === "isbreakout",
);

// 1) 无策略绑定列检查（information_schema）
const stratColumns = await q(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME IN (?,?,?,?,?)
     AND LOWER(COLUMN_NAME) IN ('buysignal','buysignalprice','stoploss','stoplosspx','positionsize','strategyid','sellprice','entryprice')`,
  Object.values(T),
);
report.global.strategyBoundColumns = stratColumns.length;

// 2) 逐版本校验
for (const v of versions) {
  const vid = v.id;
  const one = async (table, extra = "") =>
    (await q(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE datasetVersionId = ?${extra}`, [vid]))[0].n;

  const evt = await q(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT eventId) AS d, MIN(tradeDate) AS mn, MAX(tradeDate) AS mx
       FROM \`${T.event}\` WHERE datasetVersionId = ?`,
    [vid],
  );
  const prefix = await q(
    `SELECT COUNT(*) AS n, MIN(relativeDay) AS mn, MAX(relativeDay) AS mx,
            SUM(relativeDay = 0) AS d0, SUM(relativeDay < 0) AS neg
       FROM \`${T.prefix}\` WHERE datasetVersionId = ?`,
    [vid],
  );
  const post = await q(
    `SELECT COUNT(*) AS n, MIN(relativeDay) AS mn, MAX(relativeDay) AS mx
       FROM \`${T.post}\` WHERE datasetVersionId = ?`,
    [vid],
  );
  const path = await q(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT CONCAT(eventId,'#',relativeDay)) AS d,
            MIN(relativeDay) AS mn, MAX(relativeDay) AS mx, SUM(relativeDay <= 0) AS le0
       FROM \`${T.path}\` WHERE datasetVersionId = ?`,
    [vid],
  );
  // I10：post 与 path 键集合完全相等
  const keyDiff = await q(
    `SELECT
       (SELECT COUNT(*) FROM \`${T.post}\` p WHERE p.datasetVersionId = ?
          AND NOT EXISTS (SELECT 1 FROM \`${T.path}\` q
                           WHERE q.datasetVersionId = p.datasetVersionId AND q.eventId = p.eventId
                             AND q.relativeDay = p.relativeDay)) AS postOnly,
       (SELECT COUNT(*) FROM \`${T.path}\` q WHERE q.datasetVersionId = ?
          AND NOT EXISTS (SELECT 1 FROM \`${T.post}\` p
                           WHERE p.datasetVersionId = q.datasetVersionId AND p.eventId = q.eventId
                             AND p.relativeDay = q.relativeDay)) AS pathOnly`,
    [vid, vid],
  );
  const outcome = await q(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT CONCAT(eventId,'#',horizon)) AS d
       FROM \`${T.outcome}\` WHERE datasetVersionId = ?`,
    [vid],
  );
  const horizons = await q(
    `SELECT DISTINCT horizon FROM \`${T.outcome}\` WHERE datasetVersionId = ? ORDER BY horizon`,
    [vid],
  );
  // 交易日历：找一个周五事件（2024-01-05），其 relativeDay=1 的 tradeDate 应为周一 2024-01-08。
  const cal = await q(
    `SELECT p.relativeDay, p.tradeDate FROM \`${T.post}\` p
      WHERE p.datasetVersionId = ? AND p.eventId = ? AND p.relativeDay = 1`,
    [vid, "600239.SH@2024-01-05"],
  );
  // 涨停价 sanity：t 日收盘（= prefix 的 relativeDay=0 行）应 >= limitUpPrice（允许极小浮点误差）。
  const sanity = await q(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN p.close >= e.limitUpPrice - 1e-6 THEN 1 ELSE 0 END) AS ok
       FROM \`${T.event}\` e
       JOIN \`${T.prefix}\` p
         ON p.datasetVersionId = e.datasetVersionId AND p.eventId = e.eventId AND p.relativeDay = 0
      WHERE e.datasetVersionId = ? AND e.limitUpPrice IS NOT NULL`,
    [vid],
  );
  const I2 = await q(
    `SELECT COUNT(*) AS bad FROM (
       SELECT eventId FROM \`${T.prefix}\` WHERE datasetVersionId = ? AND relativeDay = 0
        GROUP BY eventId HAVING COUNT(*) <> 1
     ) t`,
    [vid],
  );

  report.versions.push({
    id: vid,
    version: v.version,
    status: v.status,
    declared: { totalEvents: v.totalEvents, totalRows: v.totalRows },
    actual: {
      events: evt[0].n,
      eventUnique: evt[0].d,
      dateRange: [evt[0].mn, evt[0].mx],
      prefixes: prefix[0].n,
      prefixRelativeDayRange: [prefix[0].mn, prefix[0].mx],
      prefixDay0: Number(prefix[0].d0),
      prefixNegative: Number(prefix[0].neg),
      posts: post[0].n,
      postRelativeDayRange: [post[0].mn, post[0].mx],
      paths: path[0].n,
      pathUnique: path[0].d,
      pathRelativeDayRange: [path[0].mn, path[0].mx],
      pathNonPositiveRows: Number(path[0].le0),
      outcomes: outcome[0].n,
      outcomeUnique: outcome[0].d,
      horizons: horizons.map((h) => h.horizon),
      declaredRowsRecomputed: await (async () =>
        (await one(T.event)) +
        (await one(T.prefix)) +
        (await one(T.post)) +
        (await one(T.path)) +
        (await one(T.outcome)))(),
    },
    invariants: {
      I1_prefixPathPostDisjoint: Number(prefix[0].mx) <= 0 || Number(path[0].mn) >= 1,
      I2_prefixDay0ExactlyOnePerEvent: Number(I2[0].bad) === 0,
      I4_pathRangeOk: Number(path[0].mn) >= 1,
      I5_eventsEqPrefixDay0: evt[0].n === Number(prefix[0].d0),
      I10_postPathKeySetsEqual: Number(keyDiff[0].postOnly) === 0 && Number(keyDiff[0].pathOnly) === 0,
      I10_detail: `postOnly=${keyDiff[0].postOnly} pathOnly=${keyDiff[0].pathOnly}`,
    },
    calendarCheck:
      cal.length > 0
        ? { eventId: "600239.SH@2024-01-05", relativeDay1TradeDate: cal[0].tradeDate, expectedMonday: "2024-01-08" }
        : "no-such-event",
    limitUpSanity: { checked: sanity[0].n, closeGteLimitUp: sanity[0].ok },
  });
}

// 3) 全局唯一性（跨版本是否被 datasetVersionId 隔离）
const cross = await q(
  `SELECT (SELECT COUNT(*) FROM \`${T.event}\`) AS evt,
          (SELECT COUNT(*) FROM (SELECT DISTINCT datasetVersionId, eventId FROM \`${T.event}\`) t) AS evtUniq,
          (SELECT COUNT(*) FROM \`${T.prefix}\` WHERE relativeDay = 0) AS prefixDay0,
          (SELECT COUNT(*) FROM \`${T.path}\` WHERE relativeDay <= 0) AS pathNonPositive,
          (SELECT COUNT(*) FROM \`${T.post}\`) AS postRows,
          (SELECT COUNT(*) FROM \`${T.path}\`) AS pathRows`,
);
report.global.totalEventRows = cross[0].evt;
report.global.distinctVersionEventPairs = cross[0].evtUniq;
report.global.prefixDay0Rows = cross[0].prefixDay0;
report.global.pathNonPositiveRows = cross[0].pathNonPositive;
report.global.postRows = cross[0].postRows;
report.global.pathRows = cross[0].pathRows;
report.global.I5_eventsEqPrefixDay0 = cross[0].evt === cross[0].prefixDay0;
report.global.I1_pathHasNoNonPositive = cross[0].pathNonPositive === 0;
report.global.I10_postPathCountsEqual = Number(cross[0].postRows) === Number(cross[0].pathRows);

console.log(JSON.stringify(report, null, 2));
await conn.end();
