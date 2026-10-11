/**
 * EVENT-STATE-LONG-EXECUTION-PARITY-001 · 修复已落库留档的 `result.wiring`（**只改这一个子对象**）。
 *
 * 背景：本目标的复现工具 `tests/tools/eventStateLongFormalRun.mts` 初版**自己拼**了
 * `wiring: {requested, streaming}`，而 `closedLoopBacktestRun` 的**读路径**
 * （`researchRun.getBacktests`）会按契约校验 `wiring.requestedStages / wiredStages /
 * unwiredStages / coveredStages / uncoveredStages / executorBound` ⇒ 落库成功但**读不出来**，
 * 前端「回测对比」因此显示「该留档已落库，但结果读不出来（不符合当前契约）」。
 *
 * 本工具用**平台自己的** `researchRunRouter#toWiringSummary`（同一实现）重建该字段并就地替换。
 *
 * 纪律：
 *   - **只**替换 `result.wiring`；`stages`（含 equityCurve / trades / costs / executionStats）、
 *     `assembly`、`fingerprint`、`chainFingerprint`、`overall` 等**逐字节不动**；
 *   - 只作用于**本目标自己创建的**两条留档（`6210013` / `6210014`），按 id 精确定位；
 *   - 不新增/删除行；无 DDL / migration；改后逐项复核 `getBacktests` 可读且台账未变。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongFormalRunRepair.mts --dry-run
 *   node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongFormalRunRepair.mts
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { assembleRunWorkbenchInputs } from '../../server/runWorkbenchAssembly/assemble';
import { toWiringSummary } from '../../server/researchRunRouter';
import { StrategyService } from '../../server/research/strategyPersistence/service';
import { DbStrategyRepository } from '../../server/research/strategyPersistence/db';
import { appRouter } from '../../server/routers';

const STRATEGY_ID = 'event-state-long-maxamp5-top3';
const STRATEGY_VERSION = '2.0.0';
const CODE_VERSION = '1.0.0+gf8b6810.dirty';
const STAGES = ['data', 'research', 'strategy', 'backtest', 'evaluation'] as const;
const DRY_RUN = process.argv.includes('--dry-run');

/** 只修本目标自己创建的两条留档。 */
const TARGETS: Record<number, { datasetVersionId: number; startDate: string; endDate: string }> = {
  6210013: { datasetVersionId: 780004, startDate: '2019-01-03', endDate: '2026-01-28' },
  6210014: { datasetVersionId: 780005, startDate: '2026-01-29', endDate: '2026-09-04' },
};

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL missing');
  const u = new URL(raw);
  const m = raw.match(/[?&]ssl=(\{[^&]*\})/);
  const conn = await mysql.createConnection({
    host: u.hostname, port: Number(u.port || 4000),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.slice(1), ...(m ? { ssl: JSON.parse(m[1]) } : {}),
    dateStrings: true, connectTimeout: 20000,
  });

  const repo = new DbStrategyRepository();
  const service = new StrategyService(repo, { codeVersion: CODE_VERSION });
  const record = await service.loadVersion(STRATEGY_ID, STRATEGY_VERSION);

  const report: unknown[] = [];
  try {
    for (const [idText, target] of Object.entries(TARGETS)) {
      const id = Number(idText);
      const [rows] = await conn.query(
        'SELECT id,runId,resultJson FROM closed_loop_backtest_run WHERE id=?',
        [id],
      ) as unknown as [Record<string, unknown>[], unknown];
      const row = rows[0];
      if (row === undefined) throw new Error(`留档 ${id} 不存在`);

      const built = await assembleRunWorkbenchInputs({
        strategyDocument: record.strategy,
        strategyId: STRATEGY_ID,
        strategyVersion: STRATEGY_VERSION,
        startDate: target.startDate,
        endDate: target.endDate,
        datasetVersionId: target.datasetVersionId,
        dataReady: true,
        codeVersion: CODE_VERSION,
        createdAt: String(row.runId),
      } as never);
      const canonicalWiring = toWiringSummary(built.inputs, [...STAGES] as never);

      const parsed = JSON.parse(String(row.resultJson)) as Record<string, unknown>;
      const before = parsed.wiring ?? null;
      const stagesBefore = JSON.stringify(parsed.stages ?? null);
      parsed.wiring = canonicalWiring as never;
      const after = JSON.stringify(parsed);

      const entry = {
        id, runId: row.runId,
        datasetVersionId: target.datasetVersionId,
        wiringBefore: before,
        wiringAfter: canonicalWiring,
        stagesUnchanged: stagesBefore === JSON.stringify(parsed.stages ?? null),
        bytesBefore: String(row.resultJson).length,
        bytesAfter: after.length,
      };
      report.push(entry);
      console.log('[repair] ' + JSON.stringify(entry, null, 1));

      if (!DRY_RUN) {
        await conn.query('UPDATE closed_loop_backtest_run SET resultJson=? WHERE id=?', [after, id]);
      }
    }

    // 复核：读路径（getBacktests）现在必须能读出 result
    if (!DRY_RUN) {
      const caller = appRouter.createCaller({} as never);
      const details = await caller.researchRun.getBacktests({ ids: Object.keys(TARGETS).map(Number) } as never);
      const items = (details as unknown as { items?: readonly Record<string, unknown>[] }).items
        ?? (details as unknown as readonly Record<string, unknown>[]);
      const verify = items.map((r) => ({
        id: r.id,
        resultIssue: r.resultIssue ?? null,
        resultIsNull: r.result === null,
        equityCurvePointCount: r.equityCurvePointCount ?? null,
        tradeCount: r.tradeCount ?? null,
        totalReturnPct: r.totalReturnPct ?? null,
      }));
      console.log('[repair] === 读路径复核（getBacktests）===');
      console.log(JSON.stringify(verify, null, 1));
      const ok = verify.every((v) => v.resultIssue === null && v.resultIsNull === false);
      console.log('[repair] READ_PATH_OK = ' + String(ok));
      await conn.end();
      process.exit(ok ? 0 : 1);
    }
  } finally {
    if (DRY_RUN) await conn.end();
  }
  console.log('[repair] DRY_RUN 完成（未写库）');
  process.exit(0);
}
main().catch((e) => { console.error((e as Error).stack ?? String(e)); process.exit(1); });
