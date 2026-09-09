/**
 * STEP 12.6 — Research Dataset：分片（分区）行表持久化。
 *
 * 每数据集一张行表（表名 rd_rows_<buildKey>，buildKey = 请求规范化指纹），标准行按
 * 「半结构化」存储：核心键列（tradeDate/securityId/partitionSeq）+ rowJson（完整标准行 JSON）。
 * 这样：
 *   - 分片直接增量写入最终表（不做本地中间文件），断点续跑按 partitionSeq 判断；
 *   - 读回复用按 (tradeDate, securityId) 确定性排序，喂给信号/回测绑定层；
 *   - 流式读回（mysql2 stream）供流式 datasetVersion 指纹计算，避免 9.8M 行一次性进内存。
 *
 * 安全：表名由 buildKey 派生，rowsTableName 严格校验 [0-9a-f]{16}，杜绝动态表名注入；
 *   行值一律参数化（mysql2 VALUES ? 批量 / escape），不拼接字面量。
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { rowsTableName } from "./buildKey";
import type { ResearchDatasetRow } from "./types";

/** 单批 INSERT 行数（控制单条 SQL 体积，避免超包）。 */
const INSERT_BATCH_SIZE = 500;

/** mysql2 底层连接池类型（drizzle 实例的 $client，promise 风格）。 */
type Mysql2PromisePool = {
  getConnection(): Promise<Mysql2Connection>;
};
type Mysql2Connection = {
  query(sql: string, params?: unknown[]): Promise<[unknown[], unknown]>;
  escape(value: unknown): string;
  release(): void;
  connection: {
    query(sql: string): { stream(opts?: { highWaterMark?: number }): AsyncIterable<Record<string, unknown>> };
  };
};

async function rawPool(): Promise<Mysql2PromisePool> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用，无法访问分片行表");
  // drizzle-orm/mysql2 的 $client 是回调风格 pool，需 .promise() 转 promise 风格（与 db.ts 一致）。
  return (db as unknown as { $client: { promise(): Mysql2PromisePool } }).$client.promise();
}

/** 幂等建表（表名经 rowsTableName 校验）。 */
export async function ensureRowsTable(buildKey: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用，无法创建分片行表");
  const table = rowsTableName(buildKey);
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS \`${table}\` (
         \`id\` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
         \`tradeDate\` DATE NOT NULL,
         \`securityId\` VARCHAR(64) NOT NULL,
         \`partitionSeq\` INT NOT NULL,
         \`rowJson\` LONGTEXT NOT NULL,
         KEY \`idx_date_sec\` (\`tradeDate\`, \`securityId\`),
         KEY \`idx_partition\` (\`partitionSeq\`)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ),
  );
}

/** 写入一个分片的标准行（参数化批量 INSERT）。 */
export async function insertPartition(
  buildKey: string,
  partitionSeq: number,
  rows: readonly ResearchDatasetRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const pool = await rawPool();
  const conn = await pool.getConnection();
  try {
    const table = rowsTableName(buildKey);
    let total = 0;
    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
      const values = batch.map((row) => [
        row.tradeDate,
        row.securityId,
        partitionSeq,
        JSON.stringify(row),
      ]);
      await conn.query(
        `INSERT INTO \`${table}\` (\`tradeDate\`, \`securityId\`, \`partitionSeq\`, \`rowJson\`) VALUES ?`,
        [values],
      );
      total += batch.length;
    }
    return total;
  } finally {
    conn.release();
  }
}

/** 该分片是否已写入（断点续跑：已写则跳过）。 */
export async function hasPartition(buildKey: string, partitionSeq: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const table = rowsTableName(buildKey);
  const result = await db.execute(
    sql.raw(`SELECT 1 AS x FROM \`${table}\` WHERE \`partitionSeq\` = ${Math.trunc(partitionSeq)} LIMIT 1`),
  );
  const rows = result as unknown as Array<Array<{ x: number }>>;
  return (rows?.[0]?.length ?? 0) > 0;
}

/** 已写入行数。 */
export async function countRows(buildKey: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const table = rowsTableName(buildKey);
  const result = await db.execute(sql.raw(`SELECT COUNT(*) AS c FROM \`${table}\``));
  const rows = result as unknown as Array<Array<{ c: number | string }>>;
  return Number(rows?.[0]?.[0]?.c ?? 0);
}

/** 已写入的分片数（复用场景判断完整度）。 */
export async function countPartitions(buildKey: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const table = rowsTableName(buildKey);
  const result = await db.execute(sql.raw(`SELECT COUNT(DISTINCT \`partitionSeq\`) AS c FROM \`${table}\``));
  const rows = result as unknown as Array<Array<{ c: number | string }>>;
  return Number(rows?.[0]?.[0]?.c ?? 0);
}

/** 删除行表（覆盖式重建前调用）。 */
export async function dropRowsTable(buildKey: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const table = rowsTableName(buildKey);
  await db.execute(sql.raw(`DROP TABLE IF EXISTS \`${table}\``));
}

/**
 * 流式读回全部标准行（按 (tradeDate, securityId, id) 确定性升序），内存 O(1) 逐行。
 * 供流式 datasetVersion 指纹计算与后续绑定层复用。
 */
export async function* readRowsStreaming(buildKey: string): AsyncGenerator<ResearchDatasetRow> {
  const pool = await rawPool();
  const conn = await pool.getConnection();
  try {
    const table = rowsTableName(buildKey);
    const stream = conn.connection
      .query(`SELECT \`rowJson\` FROM \`${table}\` ORDER BY \`tradeDate\`, \`securityId\`, \`id\``)
      .stream({ highWaterMark: 1024 });
    for await (const row of stream) {
      const raw = row as { rowJson?: string };
      if (typeof raw.rowJson === "string") {
        yield JSON.parse(raw.rowJson) as ResearchDatasetRow;
      }
    }
  } finally {
    conn.release();
  }
}
