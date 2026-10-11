/**
 * EVENT-STATE-LONG-EXECUTION-PARITY-001 · `3600006` 生命周期状态修正（**唯一允许的 UPDATE**）。
 *
 * 用户裁定（本轮）：「3 可以修改」⇒ 授权把 `3600006` 由 `Validated` 改为 `Retired`，
 * 使其不再呈现为「已验证」，与后续 780005 Stage 1 FAIL（正式复现 −5.46%）一致。
 *
 * 入口纪律：
 *   - 只走 `research/strategyPersistence/service.ts#StrategyService.setVersionStatus` ——
 *     它在源码里被标注为「**唯一允许的 UPDATE**；内容仍不可变」，内部用
 *     `research/lifecycle/types.ts#isStrategyLifecycleStatus` 校验 C-21.1 八态
 *     （Draft/Research/Candidate/Validated/Paper/Approved/Production/Retired）。
 *   - **不改内容**：document / definition / 指纹 / datasetVersionId / parentVersionId / codeVersion 一律不动。
 *   - 实体 `strategies.status` 是「当前版本」的冗余投影，服务层**只在迁移当前版本时同步**
 *     ⇒ 迁移旧版本 `1.0.0` **不应**覆盖首页状态（本工具会断言这一点）。
 *   - `--dry-run` 只报告影响、不写库。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongLifecycle.mts --dry-run
 *   node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongLifecycle.mts
 */
import 'dotenv/config';
import fs from 'node:fs';
import { StrategyService } from '../../server/research/strategyPersistence/service';
import { DbStrategyRepository } from '../../server/research/strategyPersistence/db';

const STRATEGY_ID = 'event-state-long-maxamp5-top3';
const TARGET_VERSION = '1.0.0';
const TARGET_STATUS = 'Retired';
const DRY_RUN = process.argv.includes('--dry-run');

async function snapshot(repo: DbStrategyRepository) {
  const versions = await repo.listVersions(STRATEGY_ID);
  const entity = await repo.getStrategy(STRATEGY_ID);
  return {
    versions: versions.map((v) => ({
      id: (v as unknown as { id?: number }).id ?? null,
      version: v.version, status: v.status,
      codeVersion: v.codeVersion ?? null, fingerprint: v.fingerprint ?? null,
      parentVersionId: v.parentVersionId ?? null, datasetVersionId: v.datasetVersionId ?? null,
      updatedAt: (v as unknown as { updatedAt?: string }).updatedAt ?? null,
    })),
    entity: entity === undefined ? null : {
      strategyId: entity.strategyId,
      status: entity.status ?? null,
      latestVersion: entity.latestVersion ?? null,
      currentVersionId: entity.currentVersionId ?? null,
    },
  };
}

async function main(): Promise<void> {
  const repo = new DbStrategyRepository();
  const service = new StrategyService(repo, { codeVersion: '1.0.0+gf8b6810.dirty' });

  const before = await snapshot(repo);
  const target = before.versions.find((v) => v.version === TARGET_VERSION);
  if (target === undefined) throw new Error(`未找到版本 ${TARGET_VERSION}`);
  if (before.entity === null) throw new Error('未找到 strategies 实体');

  const impact = {
    mode: DRY_RUN ? 'DRY_RUN' : 'EXECUTE',
    entryPoint: 'StrategyService.setVersionStatus（源码标注「唯一允许的 UPDATE」）',
    target: { strategyId: STRATEGY_ID, version: TARGET_VERSION, from: target.status, to: TARGET_STATUS },
    guard: 'C-21.1 八态校验（Draft/Research/Candidate/Validated/Paper/Approved/Production/Retired）',
    contentUntouched: ['document', 'definition', 'fingerprint', 'datasetVersionId', 'parentVersionId', 'codeVersion', 'createdAt'],
    entityStatusPolicy: '仅当迁移「当前版本」时同步 strategies.status；本目标是旧版本 ⇒ 预期 strategies.status 不变',
    entityBefore: before.entity,
    currentVersionIdBefore: before.entity.currentVersionId,
  };
  console.log('[lifecycle] impact = ' + JSON.stringify(impact, null, 1));
  if (DRY_RUN) {
    fs.writeFileSync('_scratch/goalParityLifecycle.json', JSON.stringify({ impact, before }, null, 2) + '\n');
    process.exit(0);
  }

  await service.setVersionStatus(STRATEGY_ID, TARGET_VERSION, TARGET_STATUS);

  const after = await snapshot(repo);
  const targetAfter = after.versions.find((v) => v.version === TARGET_VERSION);
  const otherVersionsUnchanged = after.versions
    .filter((v) => v.version !== TARGET_VERSION)
    .every((v) => {
      const prev = before.versions.find((x) => x.version === v.version);
      return prev !== undefined && JSON.stringify({ ...prev, updatedAt: null }) === JSON.stringify({ ...v, updatedAt: null });
    });
  const contentUntouched = targetAfter !== undefined && target !== undefined &&
    targetAfter.fingerprint === target.fingerprint &&
    targetAfter.codeVersion === target.codeVersion &&
    targetAfter.parentVersionId === target.parentVersionId &&
    targetAfter.datasetVersionId === target.datasetVersionId;

  const result = {
    impact,
    before,
    after,
    assertions: {
      statusChanged: targetAfter?.status === TARGET_STATUS,
      contentUntouched,
      otherVersionsUnchanged,
      entityStatusUnchanged: JSON.stringify(after.entity) === JSON.stringify(before.entity),
    },
  };
  console.log('[lifecycle] after = ' + JSON.stringify(after, null, 1));
  console.log('[lifecycle] assertions = ' + JSON.stringify(result.assertions));
  fs.writeFileSync('_scratch/goalParityLifecycle.json', JSON.stringify(result, null, 2) + '\n');
  const ok = Object.values(result.assertions).every(Boolean);
  console.log('[lifecycle] ALL_ASSERTIONS = ' + String(ok));
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error((e as Error).stack ?? String(e)); process.exit(1); });
