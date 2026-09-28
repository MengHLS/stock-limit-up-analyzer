/**
 * 3F TopN v1.13.0：移除「观察窗内必须有收盘价低于 T 日涨停价」资格门槛后重跑完整闭环。
 *
 * 冻结口径：
 *   TopN / T+5 决策 / T+6 开盘 / 6% 止损 / 5% 盘中盈利回撤止盈 /
 *   第 5 日收益 >= 3% 且收盘高于 MA5、MA10 时延长到第 10 日 /
 *   T 日 open < high（排除一字板和 T 字板）。
 *
 * 与 v1.12.0 的唯一差别：3F 候选不再要求 T+1..T+5 出现收盘回踩，
 * 纯上升路径也会进入横截面排序。
 */

import "dotenv/config";
import { appRouter } from "../server/routers";
import { STRATEGY_EVALUATION_STAGE_IDS } from "../server/research/strategyEvaluation/evaluate";
import { DbStrategyRepository } from "../server/research/strategyPersistence/db";
import { StrategyService } from "../server/research/strategyPersistence/service";
import {
  buildThreeFactorTopNStrategyDocument,
  THREE_FACTOR_TOPN_CREATED_AT,
  THREE_FACTOR_TOPN_NO_PULLBACK_GATE_STRATEGY_VERSION,
  threeFactorTopNStrategyId,
} from "../server/research/patternLibrary/threeFactorTopNStrategy";

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

const TOP_N = Number(argOf("topn", "3"));
const DATASET_VERSION_ID = Number(argOf("dataset-version-id", "660001"));
const DATASET_LABEL = argOf("dataset-label", "v5");
const START = argOf("start", "2019-01-01");
const END = argOf("end", "2026-09-04");
const AS_OF = argOf("as-of", "20260927");
const STRATEGY_VERSION = THREE_FACTOR_TOPN_NO_PULLBACK_GATE_STRATEGY_VERSION;
const STOP_LOSS_RATIO = 0.06;
const STRONG_HOLD = {
  atHoldingDays: 5,
  minReturnRatio: 0.03,
  requireAboveMa5: true,
  requireAboveMa10: true,
  extendToHoldingDays: 10,
} as const;

if (TOP_N !== 3 && TOP_N !== 5) {
  throw new Error(`本实验只允许 Top3 / Top5，实际 --topn=${String(TOP_N)}`);
}
if (!/^\d{8}$/u.test(AS_OF)) {
  throw new Error(`--as-of 必须是 YYYYMMDD，实际 ${AS_OF}`);
}

const strategyId = threeFactorTopNStrategyId(TOP_N);
const experimentId =
  `EXP-${AS_OF}-${fnv1a8(
    `${strategyId}|${STRATEGY_VERSION}|${START}|${END}|NO_PULLBACK_GATE|`
    + "INTRADAY_TRAILING|STOP_LOSS=6|TRAILING=5|STRONG_HOLD=3-10",
  ).toUpperCase()}`;
const runId = `clrun-3f-top${TOP_N}-v5-v1_13_0-no-pullback-gate-${AS_OF}`;
const codeVersion = "3f-topn-no-pullback-gate-20260927";
const strategyDocument = buildThreeFactorTopNStrategyDocument({
  topN: TOP_N,
  datasetVersionId: DATASET_VERSION_ID,
  datasetLabel: DATASET_LABEL,
  strategyVersion: STRATEGY_VERSION,
  stopLossRatio: STOP_LOSS_RATIO,
  strongHold: STRONG_HOLD,
  excludeEventDayOpenAtLimit: true,
  trailingTakeProfitTrigger: "INTRADAY",
  requirePullback: false,
});

console.log(
  `[3f-v1.13] 落库策略 ${strategyId}@${STRATEGY_VERSION} `
  + `(dataset_version.id=${DATASET_VERSION_ID}, 无回踩门槛 + 盘中回撤止盈)…`,
);
const strategyService = new StrategyService(new DbStrategyRepository(), {
  codeVersion,
  now: () => THREE_FACTOR_TOPN_CREATED_AT,
});
await strategyService.save({
  document: strategyDocument as unknown as Record<string, unknown>,
});
const savedVersion = await strategyService.loadVersion(strategyId, STRATEGY_VERSION);
console.log(
  `[3f-v1.13] 策略版本已落库：documentFingerprint=${savedVersion.strategy.fingerprint} / `
  + `versionRecordFingerprint=${savedVersion.fingerprint}`,
);

const caller = appRouter.createCaller({
  user: { id: 1, role: "admin", openId: "3f-v1.13-run", name: "3f-v1.13-run" },
  req: { protocol: "http", headers: {} },
  res: { clearCookie: () => {} },
} as never);

const startedAt = Date.now();
console.log(
  `[3f-v1.13] 开始闭环：runId=${runId} / experimentId=${experimentId} / `
  + `${START}~${END} / ${STRATEGY_EVALUATION_STAGE_IDS.join(",")}`,
);
const result = await caller.researchRun.loopRun({
  runId,
  createdAt: THREE_FACTOR_TOPN_CREATED_AT,
  experimentId,
  strategyId,
  strategyVersion: STRATEGY_VERSION,
  dateRange: { startDate: START, endDate: END },
  codeVersion,
  executionModel: "NEXT_OPEN",
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
  throw new Error("闭环完成但未生成 backtest 载荷。");
}
if (result.assembly === null) {
  throw new Error("闭环完成但未生成 assembly 摘要。");
}

const history = await caller.researchRun.listBacktests({ strategyId, limit: 30 });
const saved = history.find(item => item.runId === runId);
if (saved === undefined) {
  throw new Error(`留档表回读失败：未找到 runId=${runId}。`);
}

console.log(
  JSON.stringify(
    {
      elapsedMs,
      strategyId,
      strategyVersion: STRATEGY_VERSION,
      runId,
      experimentId,
      archiveId: saved.id,
      datasetSource: result.assembly.datasetSource,
      datasetVersion: result.assembly.datasetVersion,
      datasetVersionId: result.assembly.datasetVersionId,
      recipeId: result.assembly.recipeId,
      recipeSource: result.assembly.recipeSource,
      strategyDecisionEngine: result.assembly.strategyDecisionEngine,
      persisted: result.persistence,
      tradeCount: result.backtest.canonicalMetrics.tradeCount,
      finalEquity: result.backtest.summary.finalEquity,
      canonicalMetrics: result.backtest.canonicalMetrics,
    },
    null,
    2,
  ),
);

process.exit(0);
