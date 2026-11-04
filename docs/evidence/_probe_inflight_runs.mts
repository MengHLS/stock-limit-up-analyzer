/**
 * 真库只读探针 —— 在途 Run 闸门检查。
 *
 * 为什么需要它：改 `server/**` 会触发热重启，**杀掉所有在途 Run**。
 * 硬约束（PROJECT_RULES / MEMORY）：在途 = `RUNNING`（唯一判据）。
 * 动手改 server 之前必须先证明「零 RUNNING」，否则用户的运行会被静默打断。
 *
 * 做法：扫 information_schema 找出所有「有 status 列」的表，逐张 COUNT(status='RUNNING')，
 * 并把命中行的 id / 关键字段列出来。不做任何猜测式白名单（旧事故：只查了 1 张表就报「零在途」）。
 *
 * 只读：仅 SELECT / information_schema，不写库、不改源码。
 * 运行：node_modules/.bin/tsx docs/evidence/_probe_inflight_runs.mts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createConnection } from "mysql2/promise";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, "_probe_inflight_runs.out.txt");

const lines: string[] = [];
const log = (text = "") => { lines.push(text); };

/** 从 .env 读取 DATABASE_URL（只取键值，不回显内容）。 */
function readDatabaseUrl(): string | null {
  const envPath = join(HERE, "..", "..", ".env");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.+)\s*$/.exec(line);
    if (match) return match[1].replace(/^["']|["']$/g, "");
  }
  return null;
}

/**
 * 与 `server/db.ts:140-165` 同一套解析：`?ssl={"rejectUnauthorized":true}` 必须从原始
 * 字符串里按 JSON 提取后**以对象**传给 mysql2，否则会被当成 SSL profile 名；
 * 端口缺省取 4000（TiDB Cloud），不是 3306。
 */
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

async function main() {
  const url = readDatabaseUrl();
  if (!url) { log("未找到 DATABASE_URL，无法判定在途 Run。"); return; }
  const connection = await createConnection(parseConnection(url));
  try {
    const [tables] = await connection.query(
      "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS "
      + "WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'status' ORDER BY TABLE_NAME",
    );
    const statusTables = tables as Array<{ TABLE_NAME: string; COLUMN_NAME: string }>;
    log(`=== 含 status 列的候选表（${statusTables.length} 张）===`);

    const runningHits: Array<{ table: string; ids: string[] }> = [];
    for (const table of statusTables) {
      const name = table.TABLE_NAME;
      const [rows] = await connection.query(
        `SELECT id FROM \`${name}\` WHERE status = 'RUNNING' ORDER BY id DESC LIMIT 50`,
      );
      const hits = (rows as Array<Record<string, unknown>>).map((row) => String(row.id));
      if (hits.length > 0) runningHits.push({ table: name, ids: hits });
      log(`  ${name.padEnd(34)} RUNNING = ${hits.length}`);
    }

    log();
    // 命中行的「新鲜度」：RUNNING 可能是真的在途，也可能是历史僵死状态。
    // 判据必须是证据（时间戳），不是直觉 —— 只报「有 RUNNING」会让人误杀用户正在跑的任务，
    // 反过来只看一张表又会漏判（旧事故）。这里把时间戳原样打印出来供人判断。
    for (const hit of runningHits) {
      log(`=== ${hit.table} 命中行明细 ===`);
      const [columns] = await connection.query(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
        + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
        [hit.table],
      );
      const allColumns = (columns as Array<{ COLUMN_NAME: string }>).map((row) => row.COLUMN_NAME);
      const timeColumns = allColumns.filter((name) => /At$|Date$/.test(name));
      const picked = ["id", ...timeColumns].filter((name) => allColumns.includes(name));
      const [detailRows] = await connection.query(
        `SELECT ${picked.map((name) => `\`${name}\``).join(", ")} FROM \`${hit.table}\` `
        + `WHERE status = 'RUNNING' ORDER BY id DESC LIMIT 50`,
      );
      for (const row of detailRows as Array<Record<string, unknown>>) {
        log(`  ${JSON.stringify(row, (_key, value) => (value instanceof Date ? value.toISOString() : value))}`);
      }
      log();
    }

    log("=== 结论 ===");
    if (runningHits.length === 0) {
      log("✅ 零 RUNNING 在途 Run ⇒ 可以改 server/**（热重启不会打断任何运行）。");
    } else {
      log(`⚠️ 存在 RUNNING 行（${runningHits.map((hit) => `${hit.table}:${hit.ids.join("/")}`).join("；")}）`);
      log("   请按上方时间戳判断是「真在途」还是「历史僵死」：");
      log("   - 时间戳在近几分钟内 ⇒ 真在途 ⇒ 禁止改 server/**、禁止跑重库脚本；");
      log("   - 时间戳停在数小时/数天前 ⇒ 僵死状态，热重启不会打断任何真实进度。");
    }
  } finally {
    await connection.end();
  }
}

main()
  .catch((error: unknown) => { log(`探针异常：${error instanceof Error ? error.message : String(error)}`); })
  .finally(() => {
    const text = lines.join("\n") + "\n";
    writeFileSync(OUT_PATH, text, "utf8");
    process.stdout.write(text);
  });
