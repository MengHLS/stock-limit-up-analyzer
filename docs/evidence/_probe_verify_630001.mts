/**
 * 只读探针：核对分析 #630001 的条件是否成立，并给出「本该填」的条件下的真实统计量。
 *
 * 背景：分析 #630001（run 630002 / exp 360002）存了两条条件：
 *   g0 s0  holds_event_low_5d == 1     ← 正确（T+1..T+5 未破首板日最低价）
 *   g0 s1  obs_1d.open == 0            ← 疑似错误（T+1 开盘价 == 0）
 * 目标 future_return_10d。
 *
 * 本探针只做 SELECT，不写任何表。
 * 口径来源（逐条对齐 server/researchEngine/variables.ts）：
 *   holds_event_low_5d : min(post.low[T+1..T+5]) >= prefix(rd=0).low - 1e-6，
 *                        且 T+1..T+5 五行必须齐（缺一行 → null，不插补）。
 *   is_breakout_5d     : outcome(horizon=5).isBreakout（= [T+1..T+5] 内有 high > 事件日高点）。
 *   future_return_10d  : path(rd=10).closeFromEventClose（比率，已减 1）。
 * 运行：npx tsx docs/evidence/_probe_verify_630001.mts
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const DV = 390002;
const m = /mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/.exec(process.env.DATABASE_URL ?? "");
if (!m) {
  console.log("DATABASE_URL 解析失败");
  process.exit(1);
}
const c = await mysql.createConnection({
  host: m[3],
  port: Number(m[4]),
  user: decodeURIComponent(m[1]),
  password: decodeURIComponent(m[2]),
  database: m[5],
  ssl: { rejectUnauthorized: false },
});

/** 公共 CTE：把三个角色拼成一行一事件。 */
const BASE = `
WITH
  p10 AS (SELECT eventId, closeFromEventClose AS r10 FROM ds_first_limit_pullback_path
           WHERE datasetVersionId = ? AND relativeDay = 10 AND closeFromEventClose IS NOT NULL),
  p5  AS (SELECT eventId, COUNT(*) AS c5, MIN(low) AS minLow
           FROM ds_first_limit_pullback_post
          WHERE datasetVersionId = ? AND relativeDay BETWEEN 1 AND 5 GROUP BY eventId),
  r5  AS (SELECT eventId, closeFromEventClose AS r05 FROM ds_first_limit_pullback_path
           WHERE datasetVersionId = ? AND relativeDay = 5 AND closeFromEventClose IS NOT NULL),
  ev  AS (SELECT eventId, low AS eventLow, close AS eventClose FROM ds_first_limit_pullback_prefix
           WHERE datasetVersionId = ? AND relativeDay = 0),
  o5  AS (SELECT eventId, isBreakout FROM ds_first_limit_pullback_outcome
           WHERE datasetVersionId = ? AND horizon = 5),
  o1  AS (SELECT eventId, open AS open1 FROM ds_first_limit_pullback_post
           WHERE datasetVersionId = ? AND relativeDay = 1),
  base AS (
    SELECT p10.eventId, p10.r10, r5.r05, ev.eventLow, ev.eventClose, o5.isBreakout, o1.open1,
           (p5.c5 = 5 AND p5.minLow >= ev.eventLow - 1e-6) AS holds5
      FROM p10
      JOIN ev ON ev.eventId = p10.eventId
      LEFT JOIN p5 ON p5.eventId = p10.eventId
      LEFT JOIN r5 ON r5.eventId = p10.eventId
      LEFT JOIN o5 ON o5.eventId = p10.eventId
      LEFT JOIN o1 ON o1.eventId = p10.eventId
  )
`;
const P = [DV, DV, DV, DV, DV, DV];

async function stat(title: string, where: string, extraArgs: unknown[] = []) {
  const [r] = await c.query(
    `${BASE} SELECT COUNT(*) AS n, AVG(r10) AS mean10,
              AVG(CASE WHEN r05 IS NOT NULL AND (1 + r05) > 0 THEN (1 + r10) / (1 + r05) - 1 END) AS meanSeg,
              SUM(CASE WHEN r05 IS NOT NULL AND (1 + r05) > 0 THEN 1 ELSE 0 END) AS nSeg
       FROM base WHERE ${where}`,
    [...P, ...extraArgs],
  );
  const row = r[0];
  const n = Number(row.n);
  const seg = row.meanSeg === null ? null : Number(row.meanSeg);
  const fmt = (v: number | null, w = 8) => (v === null ? "-".padStart(w) : `${(v * 100).toFixed(2)}%`.padStart(w));
  console.log(
    `  ${title.padEnd(30)} n=${String(n).padStart(6)}  T→T+10=${fmt(row.mean10 === null ? null : Number(row.mean10))}` +
      `  T+5→T+10=${fmt(seg)}  (n_seg=${row.nSeg})`,
  );
  return { n, mean: row.mean10 === null ? null : Number(row.mean10), seg, nSeg: Number(row.nSeg) };
}

console.log("=== 分析 #630001 条件核对（Dataset 390002，目标 future_return_10d）===\n");

console.log("[0] 可用样本基础");
const all = await stat("全样本（有 T+10 收益）", "1=1");

console.log("\n[1] 当前存的条件");
const cur = await stat("holds_event_low_5d==1 且 obs_1d.open==0", "holds5 = 1 AND open1 = 0");
const onlyObs = await stat("仅 obs_1d.open==0", "open1 = 0");
const nullObs = await stat("obs_1d.open 为 NULL（非 0）", "open1 IS NULL");
const holdsOnly = await stat("仅 holds_event_low_5d==1", "holds5 = 1");

console.log("\n[2] 本该填的条件（is_breakout_5d==0）");
const int = await stat("holds5==1 且 is_breakout_5d==0", "holds5 = 1 AND isBreakout = 0");
const intNoHold = await stat("仅 is_breakout_5d==0", "isBreakout = 0");

console.log("\n[3] 反面参照");
const brk = await stat("is_breakout_5d==1（冲高过首板价）", "isBreakout = 1");
const brkHold = await stat("holds5==1 且 is_breakout_5d==1", "holds5 = 1 AND isBreakout = 1");
const broke = await stat("holds_event_low_5d==0（已破位）", "holds5 = 0");

console.log("\n[4] 逐条结论（pp = 百分点）");
const pp = (x: number | null, y: number | null) =>
  x === null || y === null ? "-" : `${((x - y) * 100).toFixed(2)}pp`;
console.log(`  当前存的条件组                                        = 无样本（n=0），条件组统计不可用`);
console.log(`  正确条件组(holds5=1 且 breakout_5d=0) − 全样本           = ${pp(int.seg, all.seg)}   （纯未来段 T+5→T+10）`);
console.log(`  仅 holds5=1 − 全样本                                   = ${pp(holdsOnly.seg, all.seg)}   （纯未来段）`);
console.log(`  仅 breakout_5d=0 − 全样本                              = ${pp(intNoHold.seg, all.seg)}   （纯未来段）`);
console.log(`  breakout_5d=1 − 全样本                                 = ${pp(brk.seg, all.seg)}   （纯未来段）`);
console.log(`  holds5=0（破位） − 全样本                              = ${pp(broke.seg, all.seg)}   （纯未来段）`);

await c.end();
