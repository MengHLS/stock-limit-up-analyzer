/**
 * 3F TopN 正式回测重跑：策略版本落库 + 闭环真实执行 + 自动留档。
 *
 * 与 docs/evidence/_probe_3f_topn_backtest.mts 的区别：
 * - 官方 `researchRun.loopRun({ useRealData: true })` 只跑一遍；
 * - 完整 evidence 与交易明细由同一轮 stage artifacts 保留；
 * - 结束后由既有 persistClosedLoopBacktestRun 自动写入 closed_loop_backtest_run。
 *
 * 用法：
 * node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs \
 *   scripts/run3FTopNStrategyBacktest.mts --topn 3
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { appRouter } from "../server/routers";
import { composeCodeVersion } from "../server/research/experimentLineage/codeVersion";
import { STRATEGY_EVALUATION_STAGE_IDS } from "../server/research/strategyEvaluation/evaluate";
import { DbStrategyRepository } from "../server/research/strategyPersistence/db";
import { StrategyService } from "../server/research/strategyPersistence/service";
import {
  buildThreeFactorTopNStrategyDocument,
  THREE_FACTOR_TOPN_CREATED_AT,
  THREE_FACTOR_TOPN_STRATEGY_VERSION,
  threeFactorTopNStrategyId,
} from "../server/research/patternLibrary/threeFactorTopNStrategy";
import { THREE_FACTOR_TOPN_STOP_LOSS_RATIO } from "../server/research/patternLibrary/patterns/firstLimitPullback3FTopN";

function argOf(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < process.argv.length) return process.argv[index + 1]!;
  return fallback;
}

function fnv1a8(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function resolveCodeVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return composeCodeVersion({
      packageVersion: typeof pkg.version === "string" ? pkg.version : null,
      git: { commitShortHash: null, dirty: null },
    });
  } catch {
    return "unknown";
  }
}

const TOP_N = Number(argOf("topn", "5"));
const DATASET_VERSION_ID = Number(argOf("dataset-version-id", "660001"));
const DATASET_LABEL = argOf("dataset-label", "v5");
const START = argOf("start", "2019-01-01");
const END = argOf("end", "2026-09-04");
const AS_OF = argOf("as-of", "20260926");
const EXECUTION_MODEL = "NEXT_OPEN";

if (!Number.isInteger(TOP_N) || TOP_N <= 0) {
  throw new Error(`--topn 必须是正整数，实际 ${String(TOP_N)}`);
}
if (!/^\d{8}$/u.test(AS_OF)) {
  throw new Error(`--as-of 必须是 YYYYMMDD，实际 ${AS_OF}`);
}

const strategyId = threeFactorTopNStrategyId(TOP_N);
const strategyVersionTag = THREE_FACTOR_TOPN_STRATEGY_VERSION.replaceAll(".", "_");
const stopLossPercent = Math.round(THREE_FACTOR_TOPN_STOP_LOSS_RATIO * 100);
const experimentId =
  `EXP-${AS_OF}-${fnv1a8(
    `${strategyId}|${THREE_FACTOR_TOPN_STRATEGY_VERSION}|${START}|${END}|${EXECUTION_MODEL}|STOP_LOSS=${stopLossPercent}`,
  ).toUpperCase()}`;
const runId = `clrun-3f-top${TOP_N}-v5-v${strategyVersionTag}-sl${stopLossPercent}-${AS_OF}`;
const codeVersion = resolveCodeVersion();

const strategyDocument = buildThreeFactorTopNStrategyDocument({
  topN: TOP_N,
  datasetVersionId: DATASET_VERSION_ID,
  datasetLabel: DATASET_LABEL,
});

console.log(
  `[3f-persist] 落库策略 ${strategyId}@${THREE_FACTOR_TOPN_STRATEGY_VERSION} `
  + `(dataset_version.id=${DATASET_VERSION_ID})…`,
);
const strategyService = new StrategyService(new DbStrategyRepository(), {
  codeVersion,
  now: () => THREE_FACTOR_TOPN_CREATED_AT,
});
await strategyService.save({ document: strategyDocument as unknown as Record<string, unknown> });
const savedVersion = await strategyService.loadVersion(strategyId, THREE_FACTOR_TOPN_STRATEGY_VERSION);
console.log(`[3f-persist] 策略版本已落库：fingerprint=${savedVersion.fingerprint}`);

const caller = appRouter.createCaller({
  user: { id: 1, role: "admin", openId: "3f-persist", name: "3f-persist" },
  req: { protocol: "http", headers: {} },
  res: { clearCookie: () => {} },
} as never);

const startedAt = Date.now();
console.log(
  `[3f-persist] 开始官方闭环：runId=${runId} / experimentId=${experimentId} / `
  + `${START}~${END} / stages=${STRATEGY_EVALUATION_STAGE_IDS.join(",")}`,
);
const result = await caller.researchRun.loopRun({
  runId,
  createdAt: THREE_FACTOR_TOPN_CREATED_AT,
  experimentId,
  strategyId,
  strategyVersion: THREE_FACTOR_TOPN_STRATEGY_VERSION,
  dateRange: { startDate: START, endDate: END },
  codeVersion,
  executionModel: EXECUTION_MODEL,
  parameterSet: {},
  useRealData: true,
  datasetGuards: { dataReady: true },
  stageIds: [...STRATEGY_EVALUATION_STAGE_IDS],
});
const elapsedMs = Date.now() - startedAt;

if (result.persistence?.persisted !== true) {
  throw new Error(
    `闭环完成但自动留档失败：${JSON.stringify(result.persistence ?? null)}`,
  );
}
if (result.backtest === null || result.backtest === undefined) {
  throw new Error("闭环完成但未生成有界 backtest 载荷。");
}
if (result.assembly === null) {
  throw new Error("闭环完成但未生成 assembly 摘要。");
}

const history = await caller.researchRun.listBacktests({ strategyId, limit: 10 });
const saved = history.find(item => item.runId === runId);
if (saved === undefined) {
  throw new Error(`留档表回读失败：未找到 runId=${runId}。`);
}
const detail = await caller.researchRun.getBacktest({ id: saved.id });
if (detail === null || detail.result === null || detail.result.runId !== runId) {
  throw new Error(`留档详情回读失败：id=${saved.id}。`);
}

console.log(
  JSON.stringify(
    {
      elapsedMs,
      strategyId,
      strategyVersion: THREE_FACTOR_TOPN_STRATEGY_VERSION,
      stopLossPercent,
      experimentId,
      runId,
      datasetSource: result.assembly.datasetSource,
      datasetVersion: result.assembly.datasetVersion,
      datasetVersionId: result.assembly.datasetVersionId,
      datasetRowCount: result.assembly.datasetRowCount,
      executedStages: result.overall.executedStageCount,
      skippedStages: result.overall.skippedStageCount,
      persisted: result.persistence,
      archive: {
        id: saved.id,
        status: saved.status,
        tradeCount: saved.tradeCount,
        finalEquity: saved.finalEquity,
        equityCurvePointCount: saved.equityCurvePointCount,
        detailResultReadable: detail.result !== null,
      },
      canonicalMetrics: result.backtest.canonicalMetrics,
    },
    null,
    2,
  ),
);

process.exit(0);
