/**
 * EVENT-STATE-LONG-EXECUTION-PARITY-001 · S6 可达性核验（**只读**）。
 *
 * 目的：证明用户能从**既有**入口到达「策略版本 → 正式 Run → 证据」，
 * 且**没有**把工程复现 PASS 呈现成 OOS PASS。
 *
 * 本探针只调用**界面实际消费的服务端口**（`listClosedLoopBacktestRuns` /
 * `StrategyService.listVersions`），不新建任何界面或后端接口。
 */
import 'dotenv/config';
import fs from 'node:fs';
import { listClosedLoopBacktestRuns } from '../../server/closedLoopBacktestRun/repository';
import { StrategyService } from '../../server/research/strategyPersistence/service';
import { DbStrategyRepository } from '../../server/research/strategyPersistence/db';

const STRATEGY_ID = 'event-state-long-maxamp5-top3';

async function main(): Promise<void> {
  const repo = new DbStrategyRepository();
  const service = new StrategyService(repo, { codeVersion: '1.0.0+gf8b6810.dirty' });

  const runs = await listClosedLoopBacktestRuns({ strategyId: STRATEGY_ID, limit: 20 });
  const versions = await service.listVersions(STRATEGY_ID);

  const out = {
    strategyId: STRATEGY_ID,
    /** UI 入口 A：`client/src/pages/BacktestRuns.tsx` 读 `closed_loop_backtest_run`。 */
    runEntry: {
      count: runs.length,
      records: runs.map((r) => {
        const record = r as unknown as Record<string, unknown>;
        return {
          archiveId: record.id,
          runId: record.runId,
          strategyVersion: record.strategyVersion,
          datasetVersion: record.datasetVersion ?? null,
          datasetVersionId: record.datasetVersionId ?? null,
          dateRange: record.dateRange ?? `${String(record.startDate)}~${String(record.endDate)}`,
          status: record.status,
          executedStageCount: record.executedStageCount,
          blockedStageCount: record.blockedStageCount,
          skippedStageCount: record.skippedStageCount,
          firstBlockedReasonCode: record.firstBlockedReasonCode,
          metrics: record.metrics ?? null,
          recordKeys: Object.keys(record).sort(),
        };
      }),
    },
    /** UI 入口 B：`/strategies/:strategyId?version=…&tab=evaluation|paper`（策略 → 版本）。 */
    versionEntry: {
      count: versions.length,
      versions: versions.map((v) => ({
        version: v.version,
        status: v.status,
        codeVersion: v.codeVersion ?? null,
        parentVersionId: v.parentVersionId ?? null,
        datasetVersionId: v.datasetVersionId ?? null,
        createdAt: v.createdAt ?? null,
      })),
    },
  };

  fs.writeFileSync('_scratch/goalParityS6Reachability.json', JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 1));

  // 断言（不足即响亮失败，不静默）
  const problems: string[] = [];
  if (out.runEntry.count !== 2) problems.push(`期望 2 条正式 Run，实际 ${out.runEntry.count}`);
  if (out.versionEntry.count < 2) problems.push(`期望至少 2 个策略版本，实际 ${out.versionEntry.count}`);
  const old = out.versionEntry.versions.find((v) => v.version === '1.0.0');
  const fixed = out.versionEntry.versions.find((v) => v.version === '2.0.0');
  if (old?.status !== 'Validated') problems.push(`期望 1.0.0 状态 Validated，实际 ${String(old?.status)}`);
  if (fixed?.status !== 'Draft') problems.push(`期望 2.0.0 状态 Draft，实际 ${String(fixed?.status)}`);
  if (fixed?.parentVersionId !== 3600006) problems.push(`期望 2.0.0 谱系指向 3600006，实际 ${String(fixed?.parentVersionId)}`);
  console.log('\nproblems = ' + JSON.stringify(problems));
  if (problems.length > 0) process.exitCode = 1;
  // 池化连接会保持事件循环存活 ⇒ 显式退出（否则调用方会误判为挂起）。
  process.exit(problems.length > 0 ? 1 : 0);
}
main().catch((e) => { console.error((e as Error).stack ?? String(e)); process.exitCode = 1; });
