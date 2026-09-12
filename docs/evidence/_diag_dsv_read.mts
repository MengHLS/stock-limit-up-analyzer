/**
 * 诊断：复现「保存失败 / Failed query: select ... from dataset_version where id = 390002」。
 *
 * 走**与生产完全相同的代码路径**：DbDatasetRegistry.getVersionById(390002)
 * 打印完整 cause 链（DrizzleQueryError 把真实原因放在 cause 里）。
 *
 * 同时旁证：① DB 是否可达 ② 390002 是否存在及其 status ③ 连接被复用后的第二次读是否失败。
 */
import "dotenv/config";
import { DbDatasetRegistry } from "../../server/datasetRegistry/db";
import { getDb } from "../../server/db";

function chain(error: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = error;
  while (cur instanceof Error && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    out.push(`${cur.name}: ${cur.message}${code === undefined ? "" : ` [code=${String(code)}]`}`);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}

async function main() {
  console.log(`DB_POOL_SIZE=${process.env.DB_POOL_SIZE ?? "(default 16)"} DB_COMPRESS=${process.env.DB_COMPRESS ?? "(default on)"}`);

  // ① 裸连接可达性
  const db = await getDb();
  if (!db) {
    console.log("getDb() 返回 null —— DATABASE_URL 未配置或初始化失败");
    return;
  }

  const registry = new DbDatasetRegistry();

  for (const round of [1, 2, 3]) {
    const t0 = Date.now();
    try {
      const version = await registry.getVersionById(390002);
      console.log(
        `[round ${round}] OK ${Date.now() - t0}ms — ` +
          (version
            ? `id=${version.id} datasetId=${version.datasetId} version=${version.version} status=${version.status} totalEvents=${version.totalEvents}`
            : "undefined（该 id 不存在）"),
      );
    } catch (error) {
      console.log(`[round ${round}] THROW ${Date.now() - t0}ms`);
      for (const line of chain(error)) console.log(`    ${line}`);
    }
  }

  // ④ dataset_version / dataset_definition 现状（只读）
  try {
    const rows = await db.execute(
      // eslint-disable-next-line
      `SELECT v.id, v.datasetId, v.version, v.status, d.datasetCode
       FROM dataset_version v LEFT JOIN dataset_definition d ON d.id = v.datasetId
       ORDER BY v.id`,
    );
    const list = Array.isArray(rows) ? (rows[0] as unknown[]) : (rows as unknown as { rows: unknown[] }).rows;
    console.log(`dataset_version 共 ${Array.isArray(list) ? list.length : "?"} 行：`);
    for (const r of (list as Array<Record<string, unknown>>) ?? []) {
      console.log(`    id=${r.id} datasetId=${r.datasetId} version=${r.version} status=${r.status} code=${r.datasetCode}`);
    }
  } catch (error) {
    console.log("列表查询失败：");
    for (const line of chain(error)) console.log(`    ${line}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
