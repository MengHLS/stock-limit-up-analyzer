/**
 * 端到端核实：运行工作台「优先直读已绑定数据集」新路径（`buildResearchDatasetFromRegistry`）。
 *
 * 背景（见 _probe_ds_rows.mts / _probe_strategy_dataset_binding.mts）：
 *   - 策略文档已绑定 `datasetVersionId=390002`（first_limit_pullback / v2 / READY）；
 *   - `ds_*` 五表已真实落库 1,543,082 行；
 *   - 但 `assemble.ts` 此前无条件从零重建 ⇒ 无视绑定、分钟级等待、可能漂移。
 *
 * 本探针验证新桥：
 *   A. 390002 能被直读（版本 / 定义 / 事件 / rd=0 行情）；
 *   B. 投影出的 `ResearchDataset` 满足 `bindResearchDataset` 的全部不变量；
 *   C. 投影规模与真实库一致（事件数 = ds_first_limit_pullback_event 计数）；
 *   D. 直读耗时（对比全窗重建分钟级）。
 *
 * 只读（不写任何表）。运行：项目根目录 `npx tsx docs/evidence/_probe_registry_direct_e2e.mts`
 */
import * as dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import { buildResearchDatasetFromRegistry } from '../../server/runWorkbenchAssembly/datasetFromRegistry';
import { bindResearchDataset } from '../../server/research/datasetAccess/handle';
import { getDb } from '../../server/db';

async function main(): Promise<void> {
  const db = await getDb();
  if (db === null) {
    console.log('DB 不可用，终止');
    return;
  }

  console.log('=== A. 直读 390002 ===');
  const t0 = Date.now();
  const result = await buildResearchDatasetFromRegistry({
    datasetVersionId: 390002,
    name: 'probe-run-workbench-registry-direct',
    dataReady: true,
  });
  const elapsed = Date.now() - t0;

  console.log(`直读耗时: ${elapsed}ms`);
  console.log('stats:', JSON.stringify(result.stats));
  console.log(`dataset.datasetVersion = ${result.dataset.datasetVersion}`);
  console.log(`dataset.gate = ${result.dataset.gate}`);
  console.log(`dataset.rows.length = ${result.dataset.rows.length}`);
  console.log(`universeDefinition.days = ${result.dataset.universeDefinition.days.length}`);
  console.log('gateNotes:', result.dataset.gateNotes);

  console.log('\n=== B. bind 不变量校验（真实访问层，非自测）===');
  try {
    const handle = bindResearchDataset(result.dataset);
    console.log(`bind 成功: rowCount=${handle.rowCount} universeDayCount=${handle.universeDayCount}`);
    console.log(`startDate=${handle.startDate} endDate=${handle.endDate} gate=${handle.gate}`);
  } catch (err) {
    console.log('❌ bind 失败:', (err as Error).message);
    process.exitCode = 2;
    return;
  }

  console.log('\n=== C. 与真实库计数交叉核对 ===');
  const url = process.env.DATABASE_URL!;
  const u = new URL(url);
  const sslRaw = /ssl=(\{.*\})/.exec(url)?.[1];
  const conn = await mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 4000),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    ssl: sslRaw ? JSON.parse(sslRaw) : undefined,
    compress: true,
    connectTimeout: 20_000,
  });
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS c FROM ds_first_limit_pullback_event WHERE datasetVersionId = 390002',
  );
  const dbEventCount = Number((rows as Array<{ c: number }>)[0]!.c);
  console.log(`ds_first_limit_pullback_event(390002) 真实计数 = ${dbEventCount}`);
  console.log(`直读投影事件数 = ${result.stats.eventCount}`);
  console.log(`一致: ${dbEventCount === result.stats.eventCount ? '✅' : '❌'}`);

  const [prefixRows] = await conn.query(
    'SELECT COUNT(*) AS c FROM ds_first_limit_pullback_prefix WHERE datasetVersionId = 390002 AND relativeDay = 0',
  );
  const dbRd0 = Number((prefixRows as Array<{ c: number }>)[0]!.c);
  console.log(`prefix(390002, rd=0) 真实计数 = ${dbRd0} / 直读读回 = ${result.stats.prefixBarsRead}`);

  console.log('\n=== D. 行样本（前 2 行）===');
  console.log(JSON.stringify(result.dataset.rows.slice(0, 2), null, 2));

  await conn.end();
  console.log('\n完成。');
}

main().catch((err) => {
  console.log('探针异常:', (err as Error).message);
  console.log((err as Error).stack?.slice(0, 1200));
  process.exitCode = 3;
});
