/**
 * 只读探针：验证 OBSERVATION（观察日）变量族在**真实库**上端到端可用。
 *
 * 查什么：
 *   1. `post.relativeDay` 的真实覆盖（决定 observationMaxOffset，而不是写死 20）；
 *   2. 逐日 / 累积变量的**真实取值抽样**（证明 post 通道真的读到了 K 线，不是全 null）；
 *   3. `pullback_holds_event_low_3d` 的 0/1 分布（这是用户「回踩不破首板日最低价」的核心条件）；
 *   4. 若按它做条件，条件组规模是多大（分母口径）。
 *
 * 只读，不写任何表。运行：`npx tsx docs/evidence/_probe_observation_real.mts`
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const url = process.env.DATABASE_URL ?? "";
const m = /mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/.exec(url);
if (m === null) {
  console.error("DATABASE_URL 解析失败");
  process.exit(1);
}
const [, user, password, host, port, database] = m as unknown as [string, string, string, string, string, string];

const conn = await mysql.createConnection({
  host: host.trim(),
  port: Number(port),
  user: user.trim(),
  password: decodeURIComponent(password),
  database: database.trim(),
  ssl: { rejectUnauthorized: false },
  connectTimeout: 30_000,
});

const t0 = Date.now();

/**
 * 数据集版本必须**显式钉住**。
 * 教训：本库存在 2 个 Dataset Version（390001 小样本 + 390002 全量），
 * 早期不加 `WHERE datasetVersionId = ?` 的探针把两版混在一起数，得出
 * 「事件 25,108」而真实主版本只有 23,978 —— 差的就是 390001 那 1,130 个。
 * 这正是「Dataset 唯一坐标」这条铁律的现实版本：**任何聚合都必须带版本坐标**。
 */
const DATASET_VERSION_ID = Number(process.env.PROBE_DATASET_VERSION_ID ?? 390002);

// ---- 1. post 视界（真实覆盖） ----
const [rangeRows] = await conn.query(
  `SELECT MIN(relativeDay) AS mn, MAX(relativeDay) AS mx, COUNT(*) AS n,
          COUNT(DISTINCT eventId) AS events
     FROM ds_first_limit_pullback_post
    WHERE datasetVersionId = ?`,
  [DATASET_VERSION_ID],
);
const range = (rangeRows as Array<Record<string, unknown>>)[0]!;
console.log(`=== 1. post 表真实覆盖（datasetVersionId=${DATASET_VERSION_ID}，决定 observationMaxOffset） ===`);
console.log(`  relativeDay ∈ [${range.mn}, ${range.mx}]  行数=${Number(range.n).toLocaleString()}  事件=${Number(range.events).toLocaleString()}`);

// ---- 1b. 各 relativeDay 的覆盖衰减（决定「用 T+k 条件时样本会掉多少」） ----
const [covRows] = await conn.query(
  `SELECT relativeDay, COUNT(*) AS n
     FROM ds_first_limit_pullback_post
    WHERE datasetVersionId = ?
    GROUP BY relativeDay ORDER BY relativeDay`,
  [DATASET_VERSION_ID],
);
console.log("\n=== 1b. 各观察日的覆盖（T+k 条件的分母会随 k 收缩） ===");
const cov = covRows as Array<Record<string, unknown>>;
for (const r of cov) {
  const first = Number(cov[0]!.n);
  console.log(`  T+${String(r.relativeDay).padStart(2)}  ${Number(r.n).toLocaleString().padStart(9)}  保留 ${((Number(r.n) / first) * 100).toFixed(2)}%`);
}

// ---- 2. 抽样：逐日 / 累积变量的真实取值 ----
const [sampleRows] = await conn.query(
  `SELECT eventId, relativeDay, open, high, low, close, volume
     FROM ds_first_limit_pullback_post
    WHERE datasetVersionId = ?
      AND eventId = (SELECT eventId FROM ds_first_limit_pullback_post WHERE datasetVersionId = ? ORDER BY eventId, relativeDay LIMIT 1)
      AND relativeDay <= 3
    ORDER BY relativeDay`,
  [DATASET_VERSION_ID, DATASET_VERSION_ID],
);
console.log("\n=== 2. 同一事件 T+1..T+3 的 post K 线（观察日变量的原料） ===");
for (const r of sampleRows as Array<Record<string, unknown>>) {
  console.log(
    `  ${r.eventId}  T+${r.relativeDay}  open=${r.open} high=${r.high} low=${r.low} close=${r.close} vol=${r.volume}`,
  );
}

// ---- 3. holds_event_low 的 0/1 分布（真实 SQL 复算，不走 tsx 内存） ----
// 口径：min(low[T+1..T+3]) >= prefix(rd=0).low
const [holdsRows] = await conn.query(
  `SELECT
     SUM(CASE WHEN p.minLow >= e.low - 1e-6 THEN 1 ELSE 0 END) AS holds,
     SUM(CASE WHEN p.minLow <  e.low - 1e-6 THEN 1 ELSE 0 END) AS breaks,
     COUNT(*) AS total
   FROM (
     SELECT post.eventId, MIN(post.low) AS minLow
       FROM ds_first_limit_pullback_post post
      WHERE post.datasetVersionId = ? AND post.relativeDay BETWEEN 1 AND 3
      GROUP BY post.eventId
   ) p
   JOIN ds_first_limit_pullback_prefix e
     ON e.datasetVersionId = ? AND e.eventId = p.eventId AND e.relativeDay = 0`,
  [DATASET_VERSION_ID, DATASET_VERSION_ID],
);
const holds = (holdsRows as Array<Record<string, unknown>>)[0]!;
const holdsN = Number(holds.holds);
const breaksN = Number(holds.breaks);
const totalN = Number(holds.total);
console.log("\n=== 3. pullback_holds_event_low_3d 的真实分布（min(low[T+1..T+3]) ≥ 首板日最低价）===");
console.log(`  未破 = ${holdsN.toLocaleString()}（${((holdsN / totalN) * 100).toFixed(2)}%）`);
console.log(`  已破 = ${breaksN.toLocaleString()}（${((breaksN / totalN) * 100).toFixed(2)}%）`);
console.log(`  合计 = ${totalN.toLocaleString()}`);

// ---- 4. 事件总数（分母基准） ----
const [evRows] = await conn.query(
  `SELECT COUNT(*) AS n FROM ds_first_limit_pullback_event WHERE datasetVersionId = ?`,
  [DATASET_VERSION_ID],
);
const evN = Number((evRows as Array<Record<string, unknown>>)[0]!.n);
console.log(`\n=== 4. 分母基准 ===`);
console.log(`  事件总数 = ${evN.toLocaleString()}`);
console.log(`  有 post 覆盖并可判定 holds 的事件 = ${totalN.toLocaleString()}（${((totalN / evN) * 100).toFixed(2)}%）`);
console.log(`  缺口 = ${(evN - totalN).toLocaleString()}（窗口不足 T+3 的事件，条件分析时会被如实剔除）`);

// ---- 5. 缩量口径：min_volume / 首板日成交量 ----
const [volRows] = await conn.query(
  `SELECT
     SUM(CASE WHEN p.minVol <= e.volume * 0.5  THEN 1 ELSE 0 END) AS le50,
     SUM(CASE WHEN p.minVol <= e.volume * 0.30 THEN 1 ELSE 0 END) AS le30,
     COUNT(*) AS total
   FROM (
     SELECT post.eventId, MIN(post.volume) AS minVol
       FROM ds_first_limit_pullback_post post
      WHERE post.datasetVersionId = ? AND post.relativeDay BETWEEN 1 AND 3
      GROUP BY post.eventId
   ) p
   JOIN ds_first_limit_pullback_prefix e
     ON e.datasetVersionId = ? AND e.eventId = p.eventId AND e.relativeDay = 0`,
  [DATASET_VERSION_ID, DATASET_VERSION_ID],
);
const vol = (volRows as Array<Record<string, unknown>>)[0]!;
console.log("\n=== 5. 「缩量」口径的真实分布（min(volume[T+1..T+3]) vs 首板日成交量）===");
console.log(`  ≤ 50%  = ${Number(vol.le50).toLocaleString()}（${((Number(vol.le50) / Number(vol.total)) * 100).toFixed(2)}%）`);
console.log(`  ≤ 30%  = ${Number(vol.le30).toLocaleString()}（${((Number(vol.le30) / Number(vol.total)) * 100).toFixed(2)}%）`);

console.log(`\n耗时 ${Date.now() - t0}ms`);
await conn.end();
