/**
 * DATABASE_REDESIGN §3.5 S4 — 事件窗口五表分层：物理表结构与数据的**就地迁移**（幂等）。
 *
 * 目标形态（§2.2）：Dataset 物理表由 3 张（event / path / outcome）变为 5 张
 *   event（18 列：身份 + 时点属性，**删 6 个日线行情列**）
 *   prefix（13 列：原始行情，relativeDay ∈ [−pre, 0]）— 🆕
 *   post（13 列：原始行情，relativeDay ∈ [1, +post]）— 🆕
 *   path（15 列：**仅**衍生指标，relativeDay ∈ [1, +post]）
 *   outcome（10 列，结构不变）
 *
 * 数据迁移策略（**不重建、不丢数**）：t 日行情在旧结构里同时存在于 `event` 与 `path(rd=0)`
 * 两份（实测 10,907 行完全同值）——迁移只是把 `path` 的行按 `relativeDay` 拆到 `prefix` / `post`，
 * 再把只属于「事实层」的原始列从 `path` / `event` 上摘掉：
 *   1) 建 `prefix` / `post`（DDL 取自插件声明，**无第二份字段清单**）；
 *   2) `path` 中 `relativeDay ≤ 0` 的行 → 复制进 `prefix`（t 日唯一归属）；
 *   3) `path` 中 `relativeDay ≥ 1` 的行 → 复制进 `post`（原始事实层）；
 *   4) 删除 `path` 中 `relativeDay ≤ 0` 的行（PIT 边界收紧为 ≥ 1）；
 *   5) `path` / `event` 摘掉已不属于该层的列（含 2 对完全重复列与死列 `path.turnover`）；
 *   6) 回填 `dataset_definition.prefixTableName/postTableName`（migration 0030 的等价物）
 *      并刷新 `dataset_version.totalRows`（= 五表行数之和）。
 *
 * 纪律：
 *   - 列清单**唯一权威** = `server/datasetRegistry/plugins.ts` 的建表 DDL（本脚本解析其列名，
 *     不另写一份字段清单，避免「文档 / 代码 / 库结构」三方漂移）；
 *   - 幂等：重复运行只做「已达标则跳过」的判定，无副作用；
 *   - `--dry-run` 只输出计划（零写入）；`--check` 只校验目标列集合是否已达标（只读）。
 *
 * 用法：
 *   npx tsx scripts/applyDatasetWindowLayering.mts --dry-run   # 只输出计划
 *   npx tsx scripts/applyDatasetWindowLayering.mts             # 执行迁移
 *   npx tsx scripts/applyDatasetWindowLayering.mts --check     # 只校验（CI/收尾用）
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { buildDatasetTableName, type DatasetRole } from "../server/datasetRegistry/naming";
import { defaultDatasetPluginRegistry, resolvePluginTables } from "../server/datasetRegistry/plugins";

const DRY_RUN = process.argv.includes("--dry-run");
const CHECK_ONLY = process.argv.includes("--check");

/**
 * 从插件 DDL 文本解析列名（唯一权威来源）。
 * 只取「以反引号字段名开头」的行，跳过 `PRIMARY KEY` / `UNIQUE KEY` / `KEY` / 表尾。
 */
function parseDdlColumns(ddl: string): string[] {
  const out: string[] = [];
  for (const rawLine of ddl.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("`")) continue;
    const m = /^`([A-Za-z_][A-Za-z0-9_]*)`/.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
}

const db = await getDb();
if (!db) {
  console.error("数据库不可用：未找到 DATABASE_URL");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

async function rows<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  const raw = await db!.execute(query);
  return ((Array.isArray(raw) ? raw[0] : []) ?? []) as T[];
}

async function tableExists(table: string): Promise<boolean> {
  const r = await rows<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table}`,
  );
  return Number(r[0]?.n ?? 0) > 0;
}

async function tableColumns(table: string): Promise<string[]> {
  const r = await rows<{ COLUMN_NAME: string }>(
    sql`SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table}
        ORDER BY ORDINAL_POSITION`,
  );
  return r.map((x) => x.COLUMN_NAME);
}

async function countRows(table: string, where?: string): Promise<number> {
  if (!(await tableExists(table))) return 0;
  const clause = where ? sql.raw(where) : sql.raw("1=1");
  const r = await rows<{ n: number | bigint }>(
    sql`SELECT COUNT(*) AS n FROM ${sql.raw(`\`${table}\``)} WHERE ${clause}`,
  );
  return Number(r[0]?.n ?? 0);
}

async function exec(statement: string, label: string): Promise<void> {
  const preview = statement.replace(/\s+/g, " ").slice(0, 110);
  if (DRY_RUN || CHECK_ONLY) {
    console.log(`     · [${DRY_RUN ? "dry-run" : "check"}] ${label} :: ${preview}`);
    return;
  }
  try {
    await db!.execute(sql.raw(statement));
    console.log(`     · ${label} ✔`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 幂等容错：列/表已不存在或已存在（重复运行）。
    if (/Duplicate column|Duplicate key name|already exists|Can't DROP|check that column\/key exists|Unknown column|doesn't exist/i.test(msg)) {
      console.log(`     · ${label} ⊘ 已达标（${msg.slice(0, 70)}）`);
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 计划
// ---------------------------------------------------------------------------

interface Plan {
  datasetCode: string;
  roles: DatasetRole[];
  desired: Record<string, string[]>;
  actual: Record<string, string[]>;
}

console.log(`\n=== 事件窗口五表分层：物理表迁移${DRY_RUN ? "（dry-run，只读）" : CHECK_ONLY ? "（check，只读）" : ""} ===\n`);

const definitions = await rows<{ id: number; datasetCode: string }>(
  sql`SELECT \`id\`, \`datasetCode\` FROM \`dataset_definition\` ORDER BY \`id\``,
);
if (definitions.length === 0) {
  console.log("⚠ 无 dataset_definition 行，无需迁移。");
  process.exit(0);
}

const plans: Plan[] = [];
for (const def of definitions) {
  const plugin = defaultDatasetPluginRegistry.get(def.datasetCode);
  if (!plugin) {
    console.log(`⚠ [${def.datasetCode}] 未注册插件 → 跳过物理表迁移（BUILDER_NOT_REGISTERED）`);
    continue;
  }
  const desired: Record<string, string[]> = {};
  const actual: Record<string, string[]> = {};
  const roles: DatasetRole[] = [];
  for (const t of resolvePluginTables(plugin, def.datasetCode)) {
    roles.push(t.role);
    desired[t.tableName] = parseDdlColumns(t.createSql);
    actual[t.tableName] = (await tableExists(t.tableName)) ? await tableColumns(t.tableName) : [];
  }
  plans.push({ datasetCode: def.datasetCode, roles, desired, actual });
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

let unreachable = 0;

for (const plan of plans) {
  console.log(`\n【${plan.datasetCode}】`);
  const tableOf = (role: DatasetRole) => buildDatasetTableName(plan.datasetCode, role);
  const cols = (role: DatasetRole) => plan.actual[tableOf(role)] ?? [];
  const want = (role: DatasetRole) => plan.desired[tableOf(role)] ?? [];

  const eventT = tableOf("event");
  const prefixT = tableOf("prefix");
  const postT = tableOf("post");
  const pathT = tableOf("path");

  // ---- 1) 建 prefix / post（幂等） ----
  for (const role of ["prefix", "post"] as const) {
    const t = tableOf(role);
    if (cols(role).length > 0) {
      console.log(`  · ${role} 表已存在（${cols(role).length} 列）`);
      continue;
    }
    const ddl = buildCreateSql(plan.datasetCode, role);
    if (!ddl) throw new Error(`插件未声明 ${role} 的 DDL`);
    await exec(ddl, `建表 ${t}`);
  }

  // ---- 2) 判定是否需要迁移数据（旧 path 仍带原始行情列） ----
  const legacyRawCols = ["open", "high", "low", "close", "volume", "amount"];
  const pathCols = cols("path");
  const pathHasRaw = legacyRawCols.every((c) => pathCols.includes(c));

  if (!pathHasRaw) {
    console.log("  · path 已不含原始行情列 → 数据迁移已完成，跳过");
  } else {
    const copyCols = ["datasetVersionId", "eventId", "symbol", "tradeDate", "relativeDay", ...legacyRawCols]
      .filter((c) => pathCols.includes(c))
      .map((c) => `\`${c}\``)
      .join(",");

    const prefixRows = await countRows(pathT, "`relativeDay` <= 0");
    const postRows = await countRows(pathT, "`relativeDay` >= 1");
    const prefixExisting = await countRows(prefixT);
    const postExisting = await countRows(postT);
    console.log(`  · 待迁移：prefix ← path(rd ≤ 0) ${prefixRows} 行；post ← path(rd ≥ 1) ${postRows} 行`);

    if (prefixExisting === 0 && prefixRows > 0) {
      await exec(
        `INSERT INTO \`${prefixT}\` (${copyCols}) SELECT ${copyCols} FROM \`${pathT}\` WHERE \`relativeDay\` <= 0`,
        `灌入 prefix ${prefixRows} 行`,
      );
    } else {
      console.log(`  · prefix 已有 ${prefixExisting} 行 → 跳过灌数（幂等）`);
    }
    if (postExisting === 0 && postRows > 0) {
      await exec(
        `INSERT INTO \`${postT}\` (${copyCols}) SELECT ${copyCols} FROM \`${pathT}\` WHERE \`relativeDay\` >= 1`,
        `灌入 post ${postRows} 行`,
      );
    } else {
      console.log(`  · post 已有 ${postExisting} 行 → 跳过灌数（幂等）`);
    }
  }

  // ---- 3) 收紧 path.relativeDay ≤ 0（PIT 边界：t 日已归 prefix） ----
  const negRows = await countRows(pathT, "`relativeDay` <= 0");
  if (negRows > 0) {
    await exec(`DELETE FROM \`${pathT}\` WHERE \`relativeDay\` <= 0`, `删除 path 中 rd ≤ 0 的 ${negRows} 行`);
  } else {
    console.log("  · path 无 rd ≤ 0 行");
  }

  // ---- 4) 摘掉不属于本层的列（权威 = 插件 DDL） ----
  for (const role of ["path", "event"] as const) {
    const t = tableOf(role);
    const current = cols(role);
    const target = new Set(want(role));
    const obsolete = current.filter((c) => !target.has(c));
    if (obsolete.length === 0) {
      console.log(`  · ${role} 列集合已达标（${current.length} 列）`);
      continue;
    }
    console.log(`  · ${role} 待删列：${obsolete.join(", ")}`);
    for (const c of obsolete) {
      await exec(`ALTER TABLE \`${t}\` DROP COLUMN \`${c}\``, `${role}.${c} 删除`);
    }
  }

  // ---- 5) 回填 dataset_definition 表名 + 刷新版本行数 ----
  // 先补齐 registry 列（= migration 0030 的非破坏性部分，幂等）。
  const defCols = await tableColumns("dataset_definition");
  for (const [col, after] of [
    ["prefixTableName", "eventTableName"],
    ["postTableName", "prefixTableName"],
  ] as const) {
    if (defCols.includes(col)) continue;
    await exec(
      `ALTER TABLE \`dataset_definition\` ADD COLUMN \`${col}\` varchar(128) DEFAULT NULL AFTER \`${after}\``,
      `dataset_definition 增列 ${col}`,
    );
  }
  await exec(
    `UPDATE \`dataset_definition\`
        SET \`prefixTableName\` = '${prefixT}', \`postTableName\` = '${postT}'
      WHERE \`datasetCode\` = '${plan.datasetCode}'`,
    "回填 dataset_definition.prefixTableName / postTableName",
  );

  // ---- 6) 终态校验 ----
  if (DRY_RUN) continue;
  const after: Record<string, number> = {};
  for (const role of plan.roles) after[role] = await countRows(tableOf(role));
  const inconsistent: string[] = [];
  for (const role of plan.roles) {
    const cur = (await tableColumns(tableOf(role))).slice().sort();
    const tgt = want(role).slice().sort();
    if (JSON.stringify(cur) !== JSON.stringify(tgt)) {
      inconsistent.push(`${role}: 实际[${cur.join(",")}] ≠ 目标[${tgt.join(",")}]`);
    }
  }
  console.log(
    `  · 行数：${plan.roles.map((r) => `${r}=${after[r]}`).join(" ")}`,
  );
  if (inconsistent.length > 0) {
    unreachable += 1;
    console.log(`  ❌ 列集合未达标：\n     ${inconsistent.join("\n     ")}`);
  } else {
    console.log("  ✅ 五表列集合与插件 DDL 完全一致");
  }

  // 刷新 dataset_version.totalRows（= 五表行数之和，与 DatasetVersionCounts.rowCount 同口径）
  const versionRows = await rows<{ id: number }>(
    sql`SELECT v.\`id\` FROM \`dataset_version\` v
         JOIN \`dataset_definition\` d ON d.\`id\` = v.\`datasetId\`
        WHERE d.\`datasetCode\` = ${plan.datasetCode}`,
  );
  for (const v of versionRows) {
    const five: number[] = [];
    for (const role of plan.roles) {
      five.push(await countRows(tableOf(role), `\`datasetVersionId\` = ${Number(v.id)}`));
    }
    const total = five.reduce((a, b) => a + b, 0);
    await exec(`UPDATE \`dataset_version\` SET \`totalRows\` = ${total} WHERE \`id\` = ${Number(v.id)}`, `刷新 version ${v.id} totalRows=${total}`);
  }
}

/** 从插件 DDL 取建表语句（保证与 Registry `ensureTables` 完全同源）。 */
function buildCreateSql(datasetCode: string, role: DatasetRole): string {
  const plugin = defaultDatasetPluginRegistry.get(datasetCode);
  if (!plugin) throw new Error(`未注册插件：${datasetCode}`);
  const spec = plugin.physicalTables.find((t) => t.role === role);
  if (!spec) throw new Error(`插件未声明 role=${role}`);
  return spec.createSql(buildDatasetTableName(datasetCode, role));
}

console.log(
  `\n${unreachable === 0 ? "✅ 目标形态已达标" : `❌ 有 ${unreachable} 处列集合未达标`}` +
    `${DRY_RUN ? "（dry-run，未写入）" : CHECK_ONLY ? "（check，未写入）" : "（已执行迁移）"}\n`,
);
process.exit(unreachable === 0 ? 0 : 1);
