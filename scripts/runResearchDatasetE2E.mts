/**
 * STEP DS-V2 — 真实 Research E2E（禁止 Mock）。
 *
 * 流程（任务 §8 / §25 最终 E2E）：
 *   Dataset → Validation → Certification → Strategy → DatasetAccess → Signal Engine
 *   → Position Intent → Simulator → Metrics → Research Run → Persist。
 *
 * 使用项目当前真实历史数据（TiDB）。真实构建 + 认证 + 持久化 + 正式链（C-13.2 signalEngine
 * → C-14.1 simulator → C-16.x metrics）跑通，并把 Research Run 以 datasetId / datasetVersion /
 * datasetFingerprint 强绑定落库到 research_runs。
 *
 * 用法：
 *   npx tsx scripts/runResearchDatasetE2E.mts --from=2025-01-02 --to=2025-03-31 --data-ready
 *   # 可选：--name / --require-industry / --require-liquidity / --require-ca
 *
 * 输出：控制台摘要 + docs/researchDataset/e2e_report.json（含 datasetId/fingerprint/universe/bar/coverage/PIT 等）。
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { getDb } from "../server/db";
import { researchRuns } from "../drizzle/schema";
import {
  buildResearchDataset,
  certifyResearchDataset,
  deriveCapabilityFacts,
  persistResearchDataset,
  probeDatasetMetadata,
  type ResearchDatasetRequest,
} from "../server/researchDataset";
import { bindResearchDataset } from "../server/research/datasetAccess/handle";
import { runCandidateEngine } from "../server/research/signalEngine";
import { runTradeSimulation } from "../server/research/simulator";
import { evaluatePerformance } from "../server/research/performanceMetrics";
import { evaluateRiskAdjustedMetrics } from "../server/research/riskAdjustedMetrics";
import { evaluateTradeQualityMetrics } from "../server/research/tradeQualityMetrics";
import {
  makeBarFeatureProvider,
  makeWeightedSignalBuilder,
  type ExperimentConfig,
  type StrategyContract,
} from "../server/research/framework";
import { deriveDatasetUniverseId } from "../server/research/datasetAccess/handle";
import type { CanonicalMarketBar } from "../server/data/types";
import type { CostModel } from "../server/engine/domain";

// ---------------------------------------------------------------------------
// CLI 参数
// ---------------------------------------------------------------------------

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const argv = process.argv.slice(2);
const from = readFlag(argv, "from") ?? "2025-01-02";
const to = readFlag(argv, "to") ?? "2025-03-31";
const name = readFlag(argv, "name") ?? "e2e-tradable-daily";
const dataReady = argv.includes("--data-ready");
const requireIndustry = argv.includes("--require-industry");
const requireLiquidity = argv.includes("--require-liquidity");
const requireCA = argv.includes("--require-ca");
const out = resolve(readFlag(argv, "out") ?? "docs/researchDataset/e2e_report.json");

const COST_MODEL: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
};

const STRATEGY_ID = "leader-candidate-baseline";
const STRATEGY_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const startedAt = Date.now();

// 1. 元数据探测 + 能力事实（真实，aggregate）。
const metadata = await probeDatasetMetadata();
const facts = deriveCapabilityFacts(metadata);

// 2. 真实构建。
const request: ResearchDatasetRequest = {
  name,
  startDate: from,
  endDate: to,
  asOfPerTradeDate: true,
};
const dataset = await buildResearchDataset(request, { dataReady });

// 3. 认证（依赖声明按 CLI 标志）。
const certification = certifyResearchDataset(
  dataset,
  {
    ...(requireIndustry ? { industry: true } : {}),
    ...(requireLiquidity ? { liquidity: true } : {}),
    ...(requireCA ? { corporateActions: true } : {}),
  },
  facts,
);

// 4. 持久化（幂等）。
const persisted = await persistResearchDataset(dataset);

// 5. 正式链：绑定 → 信号引擎 → 模拟器 → 指标。
const handle = bindResearchDataset(dataset);
const firstDay = handle.universeDays.find((d) => d.isTradingDay)?.tradeDate ?? from;

const strategy: StrategyContract = {
  strategyId: STRATEGY_ID,
  strategyVersion: STRATEGY_VERSION,
  name: "打板候选 baseline（E2E）",
  description: "按日涨跌幅 topN 择优（long-only 候选研究，close 决策）",
  parameters: { parameters: [{ name: "topN", type: "number", required: true, min: 1 }] },
  requiredData: ["OHLCV"],
  signalFrequency: "daily",
};

const strategy13 = {
  point: "close" as const,
  features: [
    makeBarFeatureProvider({
      featureId: "pctChange",
      version: "1.0.0",
      availability: {
        requiredDataThrough: { date: firstDay, point: "close" },
        availableAt: { date: firstDay, point: "close" },
      },
      compute: (bars: readonly CanonicalMarketBar[]) => {
        const last = bars[bars.length - 1];
        if (last === undefined || last.close === null || last.preClose === null || last.preClose === 0) return null;
        return last.close / last.preClose - 1;
      },
    }),
  ],
  signalBuilder: makeWeightedSignalBuilder({ pctChange: 1 }),
  rankingConfig: { higherIsBetter: true },
  selectionConfig: { method: { kind: "topN", n: 5 } },
  signalDescription: "按日涨跌幅择优（long-only 候选研究）",
};

const config: ExperimentConfig = {
  datasetVersion: handle.datasetVersion,
  strategyId: STRATEGY_ID,
  strategyVersion: STRATEGY_VERSION,
  parameters: { topN: 5 },
  universe: { universeId: deriveDatasetUniverseId(handle.datasetVersion) },
  dateRange: { startDate: handle.startDate, endDate: handle.endDate },
  costModel: COST_MODEL,
  randomSeed: 7,
};

const candidateRun = runCandidateEngine({ dataset, config, strategy, strategy13 });

const simulation = runTradeSimulation({
  dataset,
  sourceRun: candidateRun,
  simConfig: {
    initialCapital: 1_000_000,
    cost: COST_MODEL,
    executionModel: "NEXT_OPEN",
    maxPositions: 5,
    directionPolicy: "longOnly",
  },
});

const equityCurve = [...simulation.equityCurve];
const trades = [...simulation.trades];
const perf = evaluatePerformance({ equityCurve, ...(trades.length > 0 ? { trades } : {}) });
const risk = evaluateRiskAdjustedMetrics({ equityCurve, ...(trades.length > 0 ? { trades } : {}) });
const quality = evaluateTradeQualityMetrics({ equityCurve, ...(trades.length > 0 ? { trades } : {}) });

// 6. Research Run 强绑定落库（research_runs 三列 datasetId/datasetVersion/datasetFingerprint）。
const db = await getDb();
const experimentId = `EXP-E2E-${randomBytes(3).toString("hex").toUpperCase()}`;
const runId = `RUN-${experimentId}-${randomBytes(2).toString("hex").toUpperCase()}`;
const now = new Date();
const resultJson = JSON.stringify({
  recordKind: "RESEARCH_RUN_E2E",
  strategyId: STRATEGY_ID,
  strategyVersion: STRATEGY_VERSION,
  datasetVersion: handle.datasetVersion,
  finalEquity: simulation.finalEquity,
  tradeCount: trades.length,
  equityCurvePointCount: equityCurve.length,
  performance: perf.metrics,
  riskAdjusted: risk.metrics,
  tradeQuality: quality.metrics,
  candidateFingerprint: candidateRun.fingerprint,
  simulationFingerprint: simulation.fingerprint,
});

if (db) {
  await db.insert(researchRuns).values({
    runId,
    experimentId,
    status: "succeeded",
    datasetId: persisted.datasetId,
    datasetVersion: persisted.datasetVersion,
    datasetFingerprint: persisted.versionSnapshotFingerprint,
    resultJson,
    startedAt: now,
    finishedAt: now,
    createdAt: now,
  });
}

const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
const memberDays = dataset.universeDefinition.days.reduce((s, d) => s + d.members.length, 0);

const report = {
  e2e: {
    dataset: {
      datasetId: persisted.datasetId,
      datasetVersion: persisted.datasetVersion,
      name,
      dateRange: { from, to },
      rowCount: dataset.rows.length,
      memberDays,
      gate: dataset.gate,
      gateNotes: dataset.gateNotes,
      fingerprints: {
        rowsFingerprint: persisted.rowsFingerprint,
        policySetFingerprint: persisted.policySetFingerprint,
        versionSnapshotFingerprint: persisted.versionSnapshotFingerprint,
      },
    },
    certification,
    capabilityFacts: facts,
    metadata: {
      securitiesTotal: metadata.securitiesTotal,
      securitiesDelisted: metadata.securitiesDelisted,
      industryRows: metadata.industryRows,
      industryDistinctEffectiveFrom: metadata.industryDistinctEffectiveFrom,
      priceWindow: [metadata.priceEarliestDate, metadata.priceLatestDate],
      liquidityWindow: [metadata.liquidityEarliestDate, metadata.liquidityLatestDate],
      indexWindow: [metadata.indexEarliestDate, metadata.indexLatestDate],
    },
    researchRun: {
      runId,
      experimentId,
      datasetId: persisted.datasetId,
      datasetVersion: persisted.datasetVersion,
      datasetFingerprint: persisted.versionSnapshotFingerprint,
      strategyId: STRATEGY_ID,
      strategyVersion: STRATEGY_VERSION,
      persisted: db !== null,
    },
    chain: {
      candidateDays: candidateRun.days.length,
      selectedSlots: candidateRun.evaluation.totalSelectedSlots,
      simulationFinalEquity: simulation.finalEquity,
      tradeCount: trades.length,
      equityCurvePointCount: equityCurve.length,
      candidateFingerprint: candidateRun.fingerprint,
      simulationFingerprint: simulation.fingerprint,
    },
    elapsedSec,
  },
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2), "utf8");

// ---------------------------------------------------------------------------
// 控制台摘要
// ---------------------------------------------------------------------------

console.log("真实 Research E2E 完成（%ss）", elapsedSec);
console.log("  认证        : %s（researchSafe=%s）", certification.status, certification.researchSafe);
console.log("  datasetId   : %s", persisted.datasetId);
console.log("  datasetVer  : %s", persisted.datasetVersion);
console.log("  gate        : %s", dataset.gate);
console.log("  行数        : %d（memberDays=%d）", dataset.rows.length, memberDays);
console.log("  能力事实    : industry=%s liquidity=%s ca=%s", facts.industryHistoricalPit, facts.liquidityHistoricalCoverage, facts.corporateActionPit);
console.log("  正式链      : 候选日=%d 选中槽=%d", candidateRun.days.length, candidateRun.evaluation.totalSelectedSlots);
console.log("  模拟        : 期末权益=%s 交易=%d 权益点=%d", simulation.finalEquity.toFixed(2), trades.length, equityCurve.length);
console.log("  ResearchRun : %s（datasetVersion=%s%s）", runId, persisted.datasetVersion, db ? "，已落库" : "，DB 不可用未落库");
console.log("  报告        : %s", out);

if (certification.reasons.length > 0) {
  console.log("  认证理由    : %s", certification.reasons.join("；"));
}

process.exit(0);
