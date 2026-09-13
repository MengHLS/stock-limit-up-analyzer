/**
 * 端到端核实：`assembleRunWorkbenchInputs` 现在**真的优先直读**已绑定数据集。
 *
 * 待验证（用户原话：「我明明是设置了数据集…为什么又要去日线行情表中去查」）：
 *   A. 传入 `datasetVersionId=390002` → 装配摘要 `datasetSource === "registry"`、
 *      行数 = 23,978、`datasetVersionId` 回填；
 *   B. 不传 `datasetVersionId` → `datasetSource === "rebuild"` 且 sourceNote 如实说明原因；
 *   C. 传一个不存在的 id → 回落 rebuild 且 note 带 `REGISTRY_VERSION_NOT_FOUND`（不静默）；
 *   D. 耗时对比（registry vs rebuild 同窗口）。
 *
 * 只读（不写库；rebuild 路径只读行情表）。
 * 运行：项目根目录 `npx tsx docs/evidence/_probe_runworkbench_dataset_source.mts`
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { assembleRunWorkbenchInputs } from '../../server/runWorkbenchAssembly/assemble';
import { StrategyService } from '../../server/research/strategyPersistence/service';
import { DbStrategyRepository } from '../../server/research/strategyPersistence/db';

async function main(): Promise<void> {
  const service = new StrategyService(new DbStrategyRepository());
  const record = await service.loadVersion('limit-up-baseline', '1.1.0');
  const doc = record.strategy;

  const boundId =
    doc.definition?.datasets.find((d) => d.role === 'PRIMARY')?.datasetVersionId ??
    doc.datasetVersionId ??
    undefined;
  console.log(`策略文档绑定 datasetVersionId = ${String(boundId)}`);

  console.log('\n=== A. 带 datasetVersionId（应直读）===');
  {
    const t0 = Date.now();
    const r = await assembleRunWorkbenchInputs({
      strategyId: 'limit-up-baseline',
      strategyVersion: '1.1.0',
      startDate: '2024-09-01',
      endDate: '2026-09-01',
      createdAt: new Date().toISOString(),
      codeVersion: 'probe',
      strategyDocument: doc,
      ...(boundId !== undefined ? { datasetVersionId: boundId } : {}),
    });
    console.log(`耗时 ${Date.now() - t0}ms`);
    console.log(
      JSON.stringify(
        {
          datasetSource: r.assembly.datasetSource,
          datasetSourceNote: r.assembly.datasetSourceNote,
          datasetVersionId: r.assembly.datasetVersionId,
          datasetRowCount: r.assembly.datasetRowCount,
          datasetGate: r.assembly.datasetGate,
          datasetVersion: r.assembly.datasetVersion,
          recipeSource: r.assembly.recipeSource,
        },
        null,
        2,
      ),
    );
  }

  console.log('\n=== B. 不带 datasetVersionId（应如实 rebuild + 说明原因）===');
  {
    const t0 = Date.now();
    const r = await assembleRunWorkbenchInputs({
      strategyId: 'limit-up-baseline',
      strategyVersion: '1.1.0',
      startDate: '2024-09-01',
      endDate: '2024-10-01',
      createdAt: new Date().toISOString(),
      codeVersion: 'probe',
      strategyDocument: { ...doc, definition: undefined, datasetVersionId: undefined },
    });
    console.log(`耗时 ${Date.now() - t0}ms`);
    console.log(
      JSON.stringify(
        {
          datasetSource: r.assembly.datasetSource,
          datasetSourceNote: r.assembly.datasetSourceNote,
          datasetRowCount: r.assembly.datasetRowCount,
        },
        null,
        2,
      ),
    );
  }

  console.log('\n=== C. 不存在的 id（应回落 + note 带错误码）===');
  {
    const r = await assembleRunWorkbenchInputs({
      strategyId: 'limit-up-baseline',
      strategyVersion: '1.1.0',
      startDate: '2024-09-01',
      endDate: '2024-10-01',
      createdAt: new Date().toISOString(),
      codeVersion: 'probe',
      strategyDocument: doc,
      datasetVersionId: 999999999,
    });
    console.log(
      JSON.stringify(
        {
          datasetSource: r.assembly.datasetSource,
          datasetSourceNote: r.assembly.datasetSourceNote,
          datasetRowCount: r.assembly.datasetRowCount,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((e) => {
  console.log('异常:', (e as Error).message);
  console.log((e as Error).stack?.slice(0, 1000));
  process.exitCode = 3;
});
