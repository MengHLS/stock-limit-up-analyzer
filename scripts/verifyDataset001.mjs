// STEP DATASET-001 — 数据质量校验脚本（真实 DB，只读）。
// 校验：唯一性/幂等、版本隔离、relativeDay 范围、horizon 集合、行数一致性、
// 交易日历推进、无策略绑定列、涨停价口径 sanity。
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

// 版本列表
const versions = await q("SELECT id, version, status, totalEvents, totalRows FROM dataset_version ORDER BY id");

const report = { versions: [], schema: {}, global: {} };

// 1) 无策略绑定列检查（information_schema）
const stratColumns = await q(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME IN ('ds_first_limit_pullback_event','ds_first_limit_pullback_path','ds_first_limit_pullback_outcome')
     AND LOWER(COLUMN_NAME) IN ('buysignal','buysignalprice','stoploss','stoplosspx','positionsize','strategyid','sellprice','entryprice')`,
);
report.global.strategyBoundColumns = stratColumns.length;

// 2) 逐版本校验
for (const v of versions) {
  const vid = v.id;
  const evt = await q(
    "SELECT COUNT(*) AS n, COUNT(DISTINCT eventId) AS d, MIN(tradeDate) AS mn, MAX(tradeDate) AS mx FROM ds_first_limit_pullback_event WHERE datasetVersionId = ?",
    [vid],
  );
  const path = await q(
    "SELECT COUNT(*) AS n, COUNT(DISTINCT CONCAT(eventId,'#',relativeDay)) AS d, MIN(relativeDay) AS mn, MAX(relativeDay) AS mx FROM ds_first_limit_pullback_path WHERE datasetVersionId = ?",
    [vid],
  );
  const outcome = await q(
    "SELECT COUNT(*) AS n, COUNT(DISTINCT CONCAT(eventId,'#',horizon)) AS d FROM ds_first_limit_pullback_outcome WHERE datasetVersionId = ?",
    [vid],
  );
  const horizons = await q(
    "SELECT DISTINCT horizon FROM ds_first_limit_pullback_outcome WHERE datasetVersionId = ? ORDER BY horizon",
    [vid],
  );
  // 交易日历：找一个周五事件（2024-01-05），其 relativeDay=1 的 tradeDate 应为周一 2024-01-08。
  const cal = await q(
    `SELECT p.relativeDay, p.tradeDate FROM ds_first_limit_pullback_path p
     WHERE p.datasetVersionId = ? AND p.eventId = ? AND p.relativeDay = 1`,
    [vid, "600239.SH@2024-01-05"],
  );
  // 涨停价 sanity：事件 close 应 >= limitUpPrice（允许极小浮点误差），且 limitUpPrice 非空。
  const sanity = await q(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN close >= limitUpPrice - 1e-6 THEN 1 ELSE 0 END) AS ok
     FROM ds_first_limit_pullback_event WHERE datasetVersionId = ? AND limitUpPrice IS NOT NULL`,
    [vid],
  );
  report.versions.push({
    id: vid,
    version: v.version,
    status: v.status,
    declared: { totalEvents: v.totalEvents, totalRows: v.totalRows },
    actual: {
      events: evt[0].n, eventUnique: evt[0].d, dateRange: [evt[0].mn, evt[0].mx],
      paths: path[0].n, pathUnique: path[0].d, relativeDayRange: [path[0].mn, path[0].mx],
      outcomes: outcome[0].n, outcomeUnique: outcome[0].d,
      horizons: horizons.map((h) => h.horizon),
    },
    calendarCheck: cal.length > 0 ? { eventId: "600239.SH@2024-01-05", relativeDay1TradeDate: cal[0].tradeDate, expectedMonday: "2024-01-08" } : "no-such-event",
    limitUpSanity: { checked: sanity[0].n, closeGteLimitUp: sanity[0].ok },
  });
}

// 3) 全局唯一性（跨版本是否被 datasetVersionId 隔离）
const cross = await q(
  `SELECT (SELECT COUNT(*) FROM ds_first_limit_pullback_event) AS evt,
          (SELECT COUNT(*) FROM (SELECT DISTINCT datasetVersionId, eventId FROM ds_first_limit_pullback_event) t) AS evtUniq
  `,
);
report.global.totalEventRows = cross[0].evt;
report.global.distinctVersionEventPairs = cross[0].evtUniq;

console.log(JSON.stringify(report, null, 2));
await conn.end();
