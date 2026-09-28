/**
 * 3F Top3 v1.11.0：排除 T 日一字板与 T 字板后重跑完整闭环。
 *
 * 冻结口径：
 *   Top3 / T+5 决策 / T+6 开盘 / 6% 止损 / 5% 盈利回撤止盈 /
 *   第 5 日收益 >= 3% 且收盘高于 MA5、MA10 时延长到第 10 日 /
 *   T 日 open < high（即排除一字板和 T 字板）。
 *
 * 用法：
 * node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs \
 *   scripts/run3FTopNExcludeOpenLimitBacktest.mts
 */

import "dotenv/config";
import { appRouter } from "../server/routers";
import { STRATEGY_EVALUATION_STAGE_IDS } from "../server/research/strategyEvaluation/evaluate";
import { DbStrategyRepository } from "../server/research/strategyPersistence/db";
import { StrategyService } from "../server/research/strategyPersistence/service";
import {
  buildThreeFactorTopNStrategyDocument,
  THREE_FACTOR_TOPN_CREATED_AT,
  THREE_FACTOR_TOPN_EXCLUDE_OPEN_LIMIT_STRATEGY_VERSION,
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
const PERSIST = argOf("persist", "true") !== "false";
const STRATEGY_VERSION = THREE_FACTOR_TOPN_EXCLUDE_OPEN_LIMIT_STRATEGY_VERSION;
const STOP_LOSS_RATIO = 0.06;
const STRONG_HOLD = {
  atHoldingDays: 5,
  minReturnRatio: 0.03,
  requireAboveMa5: true,
  requireAboveMa10: true,
  extendToHoldingDays: 10,
} as const;

if (TOP_N !== 3) {
  throw new Error(`本实验只允许 Top3，实际 --topn=${String(TOP_N)}`);
}
if (!/^\d{8}$/u.test(AS_OF)) {
  throw new Error(`--as-of 必须是 YYYYMMDD，实际 ${AS_OF}`);
}

const strategyId = threeFactorTopNStrategyId(TOP_N);
const experimentId =
  `EXP-${AS_OF}-${fnv1a8(
    `${strategyId}|${STRATEGY_VERSION}|${START}|${END}|EXCLUDE_OPEN_LIMIT|STOP_LOSS=6|STRONG_HOLD=3-10`,
  ).toUpperCase()}`;
const runId = `clrun-3f-top3-v5-v1_11_0-exclude-open-limit-${AS_OF}`;
const codeVersion = "3f-topn-exclude-open-limit-20260927";
const strategyDocument = buildThreeFactorTopNStrategyDocument({
  topN: TOP_N,
  datasetVersionId: DATASET_VERSION_ID,
  datasetLabel: DATASET_LABEL,
  strategyVersion: STRATEGY_VERSION,
  stopLossRatio: STOP_LOSS_RATIO,
  strongHold: STRONG_HOLD,
  excludeEventDayOpenAtLimit: true,
});

console.log(
  `[3f-v1.11] 落库策略 ${strategyId}@${STRATEGY_VERSION} `
  + `(dataset_version.id=${DATASET_VERSION_ID}, 排除 T 日一字板/T 字板)…`,
);
const strategyService = new StrategyService(new DbStrategyRepository(), {
  codeVersion,
  now: () => THREE_FACTOR_TOPN_CREATED_AT,
});
await strategyService.save({
  document: strategyDocument as unknown as Record<string, unknown>,
});
const savedVersion = await strategyService.loadVersion(strategyId, STRATEGY_VERSION);
console.log(`[3f-v1.11] 策略版本已落库：fingerprint=${savedVersion.fingerprint}`);

const caller = appRouter.createCaller({
  user: { id: 1, role: "admin", openId: "3f-v1.11-run", name: "3f-v1.11-run" },
  req: { protocol: "http", headers: {} },
  res: { clearCookie: () => {} },
} as never);

const startedAt = Date.now();
console.log(
  `[3f-v1.11] 开始闭环：runId=${runId} / experimentId=${experimentId} / `
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

if (PERSIST && result.persistence?.persisted !== true) {
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

console.log(
  JSON.stringify(
    {
      elapsedMs,
      strategyId,
      strategyVersion: STRATEGY_VERSION,
      runId,
      experimentId,
      datasetSource: result.assembly.datasetSource,
      datasetVersion: result.assembly.datasetVersion,
      datasetVersionId: result.assembly.datasetVersionId,
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
