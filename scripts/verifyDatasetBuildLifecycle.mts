/**
 * DATASET-LIFECYCLE-001 — 数据集构建「元数据 ↔ 物理数据」一致性审计（只读，零破坏）。
 *
 * 背景（2026-09-11 实测）：
 *   取消构建曾经只改状态、**不清理已落库的 ds_* 行**；重新构建又是「从零重跑 + 幂等 upsert」。
 *   而落库 upsert 是 `ON DUPLICATE KEY UPDATE id = id`（**空更新**），于是：
 *     - 本轮不再产出的旧行 **不会被清理**；
 *     - 同业务键的新值 **不会覆盖旧值**（先写入者胜出）。
 *   更严重的是取消/崩溃后的**孤儿 RUNNING 作业**：runner 的取消标志是**进程内内存态**，
 *   没有任何启动时回收机制 ⇒ 作业永久卡 RUNNING、版本永久卡 BUILDING，
 *   于是 `createJob` 报 `VERSION_NOT_BUILDABLE`、`deleteVersion` 报 `VERSION_HAS_RUNNING_JOB`
 *   —— 该版本**既不能重建也不能删除**（v2=390002 就是这么死的）。
 *
 * 已落地的治本（同轮）：
 *   - `registry.cancelJobAndRollback` —— **取消 = 回滚**（作业 CANCELLED + 版本 FAILED + 清空该版本行），幂等可重试；
 *   - `runner.execute` 构建开始前 `purgeVersionRows` —— **重建 = 从零**；
 *   - `registry.reclaimStaleJobs` + 服务启动钩子 —— 回收停更超阈值的孤儿作业（阈值 `DATASET_RECLAIM_STALE_MINUTES`）。
 *
 * 本脚本把这些不自洽状态变成**可检测的断言**，供每轮验收常驻运行。
 *
 * 用法：
 *   npx tsx scripts/verifyDatasetBuildLifecycle.mts
 *   npx tsx scripts/verifyDatasetBuildLifecycle.mts --stale-minutes=10
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const db = await getDb();
if (!db) {
  console.error("数据库不可用：未找到 DATABASE_URL");
  process.exit(1);
}

const argv = process.argv.slice(2);
const staleArg = argv.find((a) => a.startsWith("--stale-minutes="));
/** 判定「作业已停更（疑似孤儿）」的阈值（分钟）。 */
const STALE_MINUTES = staleArg ? Math.max(1, Number(staleArg.slice("--stale-minutes=".length)) || 10) : 10;

async function q<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res: unknown = await db!.execute(sql.raw(query));
  const rows = Array.isArray(res) ? (res as unknown[])[0] : res;
  return (rows ?? []) as T[];
}
const num = (v: unknown): number => Number(v ?? 0);

const results: { step: string; ok: boolean; detail: string }[] = [];
function check(step: string, ok: boolean, detail = ""): void {
  results.push({ step, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${step}${detail ? ` — ${detail}` : ""}`);
}

console.log(`\n=== 数据集构建生命周期审计（只读；孤儿阈值 ${STALE_MINUTES} 分钟）===\n`);

// ---------------------------------------------------------------------------
// L1 作业状态 ↔ 版本状态自洽性
// ---------------------------------------------------------------------------
console.log("=== L1 作业状态 ↔ 版本状态自洽性 ===");

const versions = await q<{
  id: number;
  datasetId: number;
  version: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  totalEvents: number | null;
  totalRows: number | null;
  datasetCode: string;
}>(
  `SELECT v.id, v.datasetId, v.version, v.status, v.startDate, v.endDate, v.totalEvents, v.totalRows, d.datasetCode
   FROM dataset_version v JOIN dataset_definition d ON d.id = v.datasetId ORDER BY v.id`,
);

const jobs = await q<{
  id: number;
  jobId: string;
  datasetVersionId: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  processedRows: number | null;
  completedChunks: number | null;
  totalChunks: number | null;
  staleMinutes: number;
}>(
  `SELECT id, jobId, datasetVersionId, status, startedAt, completedAt, updatedAt,
          processedRows, completedChunks, totalChunks,
          TIMESTAMPDIFF(MINUTE, updatedAt, NOW()) AS staleMinutes
   FROM dataset_build_job ORDER BY id`,
);

console.log(`  版本 ${versions.length} 个 / 作业 ${jobs.length} 条`);
for (const j of jobs) {
  console.log(
    `    v${j.datasetVersionId} ${j.jobId} status=${j.status} ` +
      `chunks=${j.completedChunks ?? "-"}/${j.totalChunks ?? "-"} rows=${j.processedRows ?? 0} ` +
      `updatedAt=${j.updatedAt}（${num(j.staleMinutes)} 分钟前）`,
  );
}

const runningJobs = jobs.filter((j) => j.status === "RUNNING");
const staleRunning = runningJobs.filter((j) => num(j.staleMinutes) >= STALE_MINUTES);

check(
  "L1a 不存在「停更超时的 RUNNING 作业」（孤儿/幽灵作业）",
  staleRunning.length === 0,
  staleRunning.length === 0
    ? `RUNNING 作业 ${runningJobs.length} 个，无停更超时`
    : `${staleRunning.length} 个停更 ≥ ${STALE_MINUTES} 分钟：` +
      staleRunning
        .map((j) => `${j.jobId}(v${j.datasetVersionId}, ${num(j.staleMinutes)}min, ${j.completedChunks ?? "-"}/${j.totalChunks ?? "-"})`)
        .join("; ") +
      " ⇒ 协程已死但状态未回收，该版本既不能重建也不能删除",
);

const runningByVersion = new Map(runningJobs.map((j) => [j.datasetVersionId, j]));
const buildingWithoutRunning = versions.filter((v) => v.status === "BUILDING" && !runningByVersion.has(v.id));
check(
  "L1b 不存在「BUILDING 但无 RUNNING 作业」的版本（卡死态）",
  buildingWithoutRunning.length === 0,
  buildingWithoutRunning.length === 0
    ? "无"
    : buildingWithoutRunning.map((v) => `v${v.id}(${v.version})`).join(", ") +
      " ⇒ 无法 createJob（VERSION_NOT_BUILDABLE），只能手工置 FAILED 后重建",
);

const notBuildingWithRunning = versions.filter(
  (v) => runningByVersion.has(v.id) && v.status !== "BUILDING",
);
check(
  "L1c 不存在「有 RUNNING 作业但版本非 BUILDING」的版本",
  notBuildingWithRunning.length === 0,
  notBuildingWithRunning.length === 0
    ? "无"
    : notBuildingWithRunning.map((v) => `v${v.id}(${v.version}) status=${v.status}`).join(", "),
);

const readyWithoutCompleted = versions.filter((v) => {
  if (v.status !== "READY") return false;
  return !jobs.some((j) => j.datasetVersionId === v.id && j.status === "COMPLETED");
});
check(
  "L1d 每个 READY 版本都有 COMPLETED 作业（可追溯构建来源）",
  readyWithoutCompleted.length === 0,
  readyWithoutCompleted.length === 0 ? "无" : readyWithoutCompleted.map((v) => `v${v.id}(${v.version})`).join(", "),
);

// ---------------------------------------------------------------------------
// L2 版本声明行数 ↔ ds_* 物理表实际行数
// ---------------------------------------------------------------------------
console.log("\n=== L2 版本声明行数 ↔ 物理表实际行数（P7/P4 之外的「声明 vs 实际」脱节）===");

/** 按 datasetCode 派生五张物理表名（与 naming.ts 同规则）。 */
function physicalTables(datasetCode: string): string[] {
  return ["event", "prefix", "post", "path", "outcome"].map((role) => `ds_${datasetCode}_${role}`);
}

const mismatches: string[] = [];
for (const v of versions) {
  const tables = physicalTables(v.datasetCode);
  let actual = 0;
  let missing = 0;
  let eventRows = 0;
  for (const t of tables) {
    const exists = await q<{ c: number }>(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${t}'`,
    );
    if (num(exists[0]?.c) === 0) {
      missing += 1;
      continue;
    }
    const r = await q<{ c: number }>(`SELECT COUNT(*) AS c FROM \`${t}\` WHERE datasetVersionId = ${v.id}`);
    actual += num(r[0]?.c);
    if (t.endsWith("_event")) eventRows = num(r[0]?.c);
  }
  if (missing > 0) {
    console.log(`    v${v.id}(${v.version}) 物理表缺失 ${missing}/5 → 跳过行数比对`);
    continue;
  }
  const declaredRows = v.totalRows === null ? null : num(v.totalRows);
  const declaredEvents = v.totalEvents === null ? null : num(v.totalEvents);
  console.log(
    `    v${v.id}(${v.version}) status=${v.status} 声明 rows=${declaredRows ?? "null"} events=${declaredEvents ?? "null"} ` +
      `| 实际 rows=${actual} events=${eventRows}`,
  );
  if (declaredRows !== null && declaredRows !== actual) {
    mismatches.push(`v${v.id} totalRows 声明 ${declaredRows} ≠ 实际 ${actual}（差 ${actual - declaredRows}）`);
  }
  if (declaredEvents !== null && declaredEvents !== eventRows) {
    mismatches.push(`v${v.id} totalEvents 声明 ${declaredEvents} ≠ 实际 ${eventRows}（差 ${eventRows - declaredEvents}）`);
  }
}

check(
  "L2 READY 版本的 totalRows/totalEvents 与物理表行数一致",
  mismatches.length === 0,
  mismatches.length === 0
    ? "全部一致"
    : `${mismatches.join("; ")} ⇒ 重建不会清理旧行（no-op upsert），声明值只反映「本轮产出」`,
);

// ---------------------------------------------------------------------------
// L3 已知残缺版本清单（供研究侧排他）
// ---------------------------------------------------------------------------
console.log("\n=== L3 可用于研究的版本清单（READY + 五表齐备 + 行数自洽）===");
const researchable: string[] = [];
const unusable: string[] = [];
for (const v of versions) {
  const tables = physicalTables(v.datasetCode);
  let total = 0;
  let emptyNonEvent = 0;
  let ok = true;
  for (const t of tables) {
    const r = await q<{ c: number }>(`SELECT COUNT(*) AS c FROM \`${t}\` WHERE datasetVersionId = ${v.id}`).catch(() => [{ c: 0 }]);
    const c = num(r[0]?.c);
    total += c;
    if (c === 0) {
      if (t.endsWith("_event")) ok = false;
      else emptyNonEvent += 1;
    }
  }
  const declaredMatches =
    v.totalRows === null ? v.status !== "READY" : num(v.totalRows) === total;
  if (v.status === "READY" && ok && emptyNonEvent === 0 && declaredMatches) researchable.push(`v${v.id}(${v.version})`);
  else {
    const why: string[] = [];
    if (v.status !== "READY") why.push(`status=${v.status}`);
    if (!ok) why.push("event 表空");
    if (emptyNonEvent > 0) why.push(`${emptyNonEvent} 张非 event 表为空`);
    if (!declaredMatches) why.push("声明行数≠实际");
    unusable.push(`v${v.id}(${v.version}): ${why.join(", ")}`);
  }
}
console.log(`    可用于研究：${researchable.length > 0 ? researchable.join(", ") : "（无）"}`);
console.log(`    不可用于研究：`);
for (const u of unusable) console.log(`      - ${u}`);
check(
  "L3 至少有一个可用于研究的 READY 版本",
  researchable.length > 0,
  `可用 ${researchable.length} 个 / 不可用 ${unusable.length} 个`,
);

// ---------------------------------------------------------------------------
// L4 新语义不变式：非 READY 且无 RUNNING 作业的版本不应残留数据
// ---------------------------------------------------------------------------
//
// 「取消 = 回滚」（registry.cancelJobAndRollback）与「重建 = 从零」（runner 执行前清场）
// 落地后，一个**既没有有效产物（非 READY）、也没有在跑的构建**的版本不应有任何 ds_* 行：
//   - FAILED  → 取消/失败的落点，数据必须已回滚；
//   - DRAFT   → 从未产出；
//   - BUILDING 但无 RUNNING 作业 → 卡死态（L1b 已报），同样不该有残留。
// 豁免：READY（有效产物）、BUILDING 且有 RUNNING 作业（正在写）。
console.log("\n=== L4 非 READY 且无 RUNNING 作业的版本不应残留数据（取消即回滚的不变式）===");

const residue: string[] = [];
for (const v of versions) {
  if (v.status === "READY") continue;
  if (v.status === "BUILDING" && runningByVersion.has(v.id)) continue;
  const tables = physicalTables(v.datasetCode);
  let total = 0;
  let missing = 0;
  for (const t of tables) {
    const r = await q<{ c: number }>(`SELECT COUNT(*) AS c FROM \`${t}\` WHERE datasetVersionId = ${v.id}`).catch(() => {
      missing += 1;
      return [{ c: 0 }];
    });
    total += num(r[0]?.c);
  }
  if (missing === tables.length) continue; // 表不存在（未建表）→ 无残留可言
  if (total > 0) {
    residue.push(`v${v.id}(${v.version}) status=${v.status} 残留 ${total} 行`);
  }
}
check(
  "L4 非 READY 版本（无在跑构建）零数据残留",
  residue.length === 0,
  residue.length === 0
    ? "全部干净（取消/失败的版本已回滚）"
    : `${residue.join("; ")} ⇒ 旧语义遗留：用 cancelJobAndRollback / deleteVersion 清理，或重建（重建前会自动清场）`,
);

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------
const passed = results.filter((r) => r.ok).length;
console.log(`\n=== 汇总：${passed}/${results.length} 通过 ===`);
for (const r of results.filter((x) => !x.ok)) console.log(`  ❌ ${r.step}\n     ${r.detail}`);
if (passed < results.length) {
  console.log(
    `\n修复入口（本脚本只读，不执行任何写操作）：\n` +
      `  · 孤儿作业：服务启动时会自动回收（阈值 DATASET_RECLAIM_STALE_MINUTES，缺省 ${STALE_MINUTES} 分钟）；\n` +
      `    也可调 service.reclaimStaleJobs({ staleMinutes }) 或走 UI「取消构建」（取消 = 回滚）。\n` +
      `  · 旧语义遗留的残留数据：对该版本执行 deleteVersion，或直接重建（构建开始前会自动清场）。`,
  );
}
process.exit(0);
