/**
 * PHASE-R1-001 只读审计探针 —— 首板回踩 Sample Selection / look-ahead 事实核对。
 *
 * 回答四个问题（全部以库内真实列为准，不做猜测）：
 *   1. 现有 dataset_version 是否启用过 `universeFilter.pullback`（回踩筛选）？
 *   2. 首板回踩 Dataset（datasetCode=first_limit_pullback）的构建配置到底是什么？
 *   3. 真实 Research Run 的池子来自哪个 datasetVersionId、其 inputSnapshot 里有没有 pullback？
 *   4. Run 的样本量 / 分析条件里是否出现 `pullback_holds_event_open_{d}d`（决定 d 的池子资格口径）。
 *
 * 只读：仅 SELECT。不写库、不改源码。
 * 用法：node node_modules/tsx/dist/cli.mjs docs/evidence/_probe_r1_pullback_audit.mts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createConnection } from "mysql2/promise";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, "_probe_r1_pullback_audit.out.txt");

const lines: string[] = [];
const log = (text = "") => { lines.push(text); };

function readDatabaseUrl(): string | null {
  const envPath = join(HERE, "..", "..", ".env");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.+)\s*$/.exec(line);
    if (match) return match[1].replace(/^["']|["']$/g, "");
  }
  return null;
}

function parseConnection(raw: string) {
  const sslMatch = raw.match(/[?&]ssl=(\{[^&]*\})/);
  let ssl: { rejectUnauthorized?: boolean } | undefined;
  if (sslMatch) {
    try {
      const parsed = JSON.parse(sslMatch[1]) as unknown;
      if (parsed && typeof parsed === "object") ssl = parsed as { rejectUnauthorized?: boolean };
    } catch { ssl = undefined; }
  }
  const withoutSsl = raw.replace(/[?&]ssl=\{[^&]*\}/, "");
  const parsed = new URL(withoutSsl);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 4000,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    connectTimeout: 20_000,
    enableKeepAlive: true,
    ...(ssl ? { ssl } : {}),
  };
}

/** 截断长 JSON 便于人读；同时把「是否含 pullback 关键字」单独判定（不被截断掩盖）。 */
function probeJson(raw: unknown): { hasPullback: boolean; head: string } {
  const text = raw === null || raw === undefined ? "" : String(raw);
  return { hasPullback: /pullback/i.test(text), head: text.slice(0, 400) };
}

async function main() {
  const url = readDatabaseUrl();
  if (!url) { log("未找到 DATABASE_URL。"); return; }
  const connection = await createConnection(parseConnection(url));
  try {
    log("=== 1. dataset_definition ===");
    const [defs] = await connection.query(
      "SELECT id, datasetCode, name, datasetType, status, eventTableName, postTableName, pathTableName, outcomeTableName "
      + "FROM dataset_definition ORDER BY id",
    );
    for (const row of defs as Array<Record<string, unknown>>) log(`  ${JSON.stringify(row)}`);

    log();
    log("=== 2. dataset_version（含 universeDefinitionJson / filterDefinitionJson 的 pullback 判定）===");
    const [versions] = await connection.query(
      "SELECT id, datasetId, version, status, startDate, endDate, totalEvents, totalRows, "
      + "universeDefinitionJson, filterDefinitionJson FROM dataset_version ORDER BY id",
    );
    for (const row of versions as Array<Record<string, unknown>>) {
      const u = probeJson(row.universeDefinitionJson);
      const f = probeJson(row.filterDefinitionJson);
      log(
        `  id=${row.id} datasetId=${row.datasetId} ${row.version} ${row.status} `
        + `${row.startDate}~${row.endDate} events=${row.totalEvents} rows=${row.totalRows} `
        + `universePullback=${u.hasPullback} filterPullback=${f.hasPullback}`,
      );
      if (u.head) log(`      universeJson: ${u.head.replace(/\s+/g, " ")}`);
      if (f.head) log(`      filterJson  : ${f.head.replace(/\s+/g, " ")}`);
    }

    log();
    log("=== 3. dataset_build_config ===");
    const [cfgs] = await connection.query(
      "SELECT datasetVersionId, excludeSt, preWindowDays, postWindowDays, outcomeHorizonsJson, batchSize, configVersion "
      + "FROM dataset_build_config ORDER BY datasetVersionId",
    );
    for (const row of cfgs as Array<Record<string, unknown>>) log(`  ${JSON.stringify(row)}`);

    log();
    log("=== 4. research_run（最近 20 条）===");
    const [runs] = await connection.query(
      "SELECT id, experimentId, runNo, status, sampleCount, startedAt, completedAt, "
      + "substring(inputSnapshotJson, 1, 1200) as snapshotHead FROM research_run ORDER BY id DESC LIMIT 20",
    );
    for (const row of runs as Array<Record<string, unknown>>) {
      const snap = probeJson(row.snapshotHead);
      log(
        `  run=${row.id} exp=${row.experimentId} no=${row.runNo} ${row.status} samples=${row.sampleCount} `
        + `${row.startedAt ?? "-"} → ${row.completedAt ?? "-"} snapshotPullback=${snap.hasPullback}`,
      );
      if (snap.head) log(`      snapshot: ${snap.head.slice(0, 700).replace(/\s+/g, " ")}`);
    }

    log();
    log("=== 5. research_analysis_condition 中的 pullback_* 口径使用（按 d 分组统计）===");
    const [conds] = await connection.query(
      "SELECT fieldName, count(*) as c, min(analysisId) as minAnalysis, max(analysisId) as maxAnalysis "
      + "FROM research_analysis_condition WHERE fieldName LIKE 'pullback%' GROUP BY fieldName ORDER BY fieldName",
    );
    const condRows = conds as Array<Record<string, unknown>>;
    if (condRows.length === 0) log("  （无 pullback_* 条件行）");
    for (const row of condRows) log(`  ${JSON.stringify(row)}`);

    log();
    log("=== 6. 指定数据集 390002 的事件池与 post 视界 ===");
    const [ev] = await connection.query(
      "SELECT count(*) as events, sum(isFirstLimit = 1) as firstBoardEvents, min(tradeDate) as minDate, max(tradeDate) as maxDate "
      + "FROM ds_first_limit_pullback_event WHERE datasetVersionId = 390002",
    );
    log(`  event: ${JSON.stringify((ev as Array<Record<string, unknown>>)[0])}`);
    const [postRange] = await connection.query(
      "SELECT min(relativeDay) as minRd, max(relativeDay) as maxRd, count(*) as rows_ "
      + "FROM ds_first_limit_pullback_post WHERE datasetVersionId = 390002",
    );
    log(`  post : ${JSON.stringify((postRange as Array<Record<string, unknown>>)[0])}`);
    const [pathRange] = await connection.query(
      "SELECT min(relativeDay) as minRd, max(relativeDay) as maxRd, count(*) as rows_ "
      + "FROM ds_first_limit_pullback_path WHERE datasetVersionId = 390002",
    );
    log(`  path : ${JSON.stringify((pathRange as Array<Record<string, unknown>>)[0])}`);
    const [outH] = await connection.query(
      "SELECT horizon, count(*) as c FROM ds_first_limit_pullback_outcome WHERE datasetVersionId = 390002 GROUP BY horizon ORDER BY horizon",
    );
    log(`  outcome horizons: ${JSON.stringify(outH)}`);
  } finally {
    await connection.end();
  }
}

main()
  .catch((error: unknown) => { log(`探针异常：${error instanceof Error ? error.message : String(error)}`); })
  .finally(() => {
    const text = lines.join("\n") + "\n";
    writeFileSync(OUT_PATH, text, "utf8");
    process.stdout.write(`written: ${OUT_PATH}\n`);
  });
