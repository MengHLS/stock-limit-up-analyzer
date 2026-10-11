/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005` 续修 · **Finding A** 覆盖测试
 * —— 辅助**装配**路径不得撮合，也就不得买进隔夜 ST。
 *
 * ## 被钉住的洞（AUDIT-004 §9.2 的同源缺陷）
 *
 * `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts#run` 曾为
 * **每组**调用一次 `runCompositeRunnerBacktest(...)`，只为拿 `assembly.simulationConfig`；
 * 而那个函数内部会**真的撮合一次**（`runTradeSimulation`），且当时**不接受**执行资格闸门
 * ⇒ 即使正式账户已全部受闸门保护，这次「结果被丢弃」的辅助撮合**仍可能买进一笔隔夜 ST**。
 *
 * ## 本文件钉住的判据（全部走**真实**装配 / 真实撮合，不检查布尔标志）
 *
 *   1. `assembleCompositeRunnerSimulationConfig` **不调用** `runTradeSimulation`（调用计数 = 0，
 *      且返回值结构上不存在 `run` / 交易 / 权益曲线）——「不需要的撮合真的没了」；
 *   2. 同一份输入下，它与 `runCompositeRunnerBacktest` 产出的 `simulationConfig`
 *      **深层相等 + 配置指纹相等**（两入口共用同一段装配实现 ⇒ 不可能漂移），
 *      差别**恰好**是那次撮合（后者调用计数 = 1）；
 *   3. 缺省（未注入闸门）时，装配出的配置**真的会成交**，且与旧路径（`runCompositeRunnerBacktest`
 *      的真实 `run`）`tradeDigest` / `equityDigest` / `run.fingerprint` / `canonicalMetrics`
 *      **逐字节相同**，`run.config` 里**没有** `executionEligibility` 键（缺省不变，可证伪）；
 *   4. 把研究侧闸门按实验的同一种方式注入该配置（`{...cfg, executionEligibilityGate}`）后，
 *      确认日 NORMAL + 成交日 ST ⇒ **真实撮合输出**：0 成交、0 扣款、0 建仓、
 *      `rejectedOrders=1`、逐笔审计 `status=ST` / `outcome=REJECTED` / `checkedAt=<成交日>T09:15:00`。
 *
 * ## 边界（本文件**不做**什么）
 *
 * - 不读真实 Dataset、不连数据库（数据集 `post` 上限读取被 mock 成 `null`；公司行为解析器注入空实现）、
 *   不建 Run、不产出收益矩阵、不写任何文件；
 * - 不改任何口径：只数「谁调用了唯一撮合入口」，撮合仍走真实 `runTradeSimulation`。
 */

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CostModel } from "../../../server/engine/domain";
import type { ResearchDataset } from "../../../server/researchDataset/types";
import type { EquityPoint, Trade } from "../../../server/backtest/types";
import { canonicalMetrics } from "../../../server/backtest/backtestResult";
import { createCorporateActionResolver } from "../../../server/corporateActions/resolver";
import { evaluateCandidateRun } from "../../../server/research/signalEngine/evaluate";
import { computeCandidateEvaluationRunFingerprint } from "../../../server/research/signalEngine/serialize";
import type {
  CandidateDayRecord,
  CandidateEvaluationRun,
  PositionIntent,
  SelectedCandidate,
} from "../../../server/research/signalEngine/types";
import { createStrategyDocument } from "../../../server/research/strategySchema/map";
import type {
  StrategyDocument,
  StrategyDocumentInput,
} from "../../../server/research/strategySchema/types";
import type { RunnerHoldingBridgePolicyDefinition } from "../../../server/research/exitPolicyCommon";
import {
  COMPOSITE_ASSEMBLY_CONFIG_CONTRACT_VERSION,
  assembleCompositeRunnerSimulationConfig,
  fingerprintSimulationConfig,
  runCompositeRunnerBacktest,
  type AssembleCompositeRunnerSimulationConfigInput,
} from "../../../server/research/compositeRunner/index";
import { runTradeSimulation } from "../../../server/research/simulator/engine";
import type {
  ExecutionEligibilityAuditEntry,
  SimulationConfig,
  TradeSimulationRun,
} from "../../../server/research/simulator/types";
import {
  sealRollingPoolExecutionDataset,
  type RollingPoolExecutionRowInput,
} from "../../../server/researchExperiments/rollingPoolExecutionSupport";
import {
  ST_GATE_CONTRACT_VERSION,
  type SecurityStatusFact,
  type SecurityStatusProvider,
} from "../../../research-experiments/shared/rollingPoolRecovery";
import {
  ST_EXECUTION_ELIGIBILITY_GATE_ID,
  createStExecutionEligibilityGate,
} from "../../../research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment";

// ---------------------------------------------------------------------------
// 隔离：唯一撮合入口的调用计数 + 数据集 post 上限读取（纯合成 ⇒ 不连库）
// ---------------------------------------------------------------------------

/** 唯一撮合入口 `runTradeSimulation` 的调用计数（**不改行为**，只数谁调了）。 */
const engineCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../../server/research/simulator/engine", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../server/research/simulator/engine")>();
  return {
    ...actual,
    runTradeSimulation: (args: Parameters<typeof actual.runTradeSimulation>[0]) => {
      engineCalls.count += 1;
      return actual.runTradeSimulation(args);
    },
  };
});

/**
 * `assembleRunWorkbenchInputs` 会读「数据集 post 相对日上限」以夹取执行尾窗。
 * 本文件的数据集是**注入的合成 fixture**（`resolveDataset` 走 `injected` 分支，不做任何解析），
 * 因此这里把它替换为 `null`（= 不夹取）—— 目的只是让单元测试**完全不碰数据库**。
 */
vi.mock(
  "../../../server/datasetRegistry/snapshot/contentDependencies",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../server/datasetRegistry/snapshot/contentDependencies")
    >();
    return {
      ...actual,
      defaultDatasetContentDependencies: () => ({
        store: {} as never,
        metadataReader: {} as never,
        reader: { getPostRelativeDayRange: async () => null } as never,
        identityProvider: {} as never,
      }),
    };
  },
);

afterEach(() => {
  engineCalls.count = 0;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// digest 口径（与 `server/backtest/backtestResult.ts#rollingDigest` **同一配方**）
// ---------------------------------------------------------------------------

function rollingDigest(seed: string, lines: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update(seed);
  for (const line of lines) {
    hash.update("\u0000");
    hash.update(line);
  }
  return hash.digest("hex");
}

function equityDigestOf(curve: readonly EquityPoint[]): string {
  return rollingDigest(
    "equity/v1",
    curve.map((point) =>
      [point.date, point.equity, point.cash, point.marketValue, point.openPositions].join("|"),
    ),
  );
}

function tradeDigestOf(trades: readonly Trade[]): string {
  return rollingDigest(
    "trade/v1",
    trades.map((trade) =>
      [
        trade.securityId,
        trade.entryTime,
        trade.entryPrice,
        trade.exitTime ?? "",
        trade.exitPrice ?? "",
        trade.quantity,
        trade.netPnl ?? "",
        trade.fees,
        trade.slippageAmount,
      ].join("|"),
    ),
  );
}

// ---------------------------------------------------------------------------
// fixture（纯合成：与 `rollingPoolRecoveryStExecutionGate.test.ts` 同一形状）
// ---------------------------------------------------------------------------

const COST_STD: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00002,
  slippageBps: 5,
  lotSize: 100,
  minCommission: 5,
};

/** 8 个交易日（rd0 = D0；确认日 D0 ⇒ 成交日 D1）。 */
const D0 = "2024-03-01";
const D1 = "2024-03-04";
const D2 = "2024-03-05";
const D3 = "2024-03-06";
const D4 = "2024-03-07";
const D5 = "2024-03-08";
const D6 = "2024-03-11";
const D7 = "2024-03-12";
const DATES: readonly string[] = [D0, D1, D2, D3, D4, D5, D6, D7];

const DATASET_VERSION_ID = 780_004;

const SEC_A = `sec_a::event:000001.SZ@${D0}`;

function executionRow(args: {
  readonly date: string;
  readonly securityId: string;
  readonly open: number;
  readonly close: number;
}): RollingPoolExecutionRowInput {
  return {
    tradeDate: args.date,
    securityId: args.securityId,
    code: `${args.securityId.replace(/[^0-9A-Za-z]/gu, "").slice(0, 8)}.SZ`,
    exchange: "SZ",
    open: args.open,
    high: Math.max(args.open, args.close) + 0.1,
    low: Math.min(args.open, args.close) - 0.1,
    close: args.close,
    preClose: args.open,
    volume: 1_000_000,
    amount: null,
    barPresent: true,
    suspended: false,
  };
}

function fixtureDataset(): ResearchDataset {
  const rows = DATES.map((date, index) =>
    executionRow({ date, securityId: SEC_A, open: 10 + index * 1, close: 10.2 + index * 1 }),
  );
  return sealRollingPoolExecutionDataset({
    name: "fix005-finding-a-aux-assembly",
    startDate: D0,
    endDate: D7,
    datasetVersionId: DATASET_VERSION_ID,
    rows,
    tradingDates: [...DATES],
  });
}

/** 确认日 D0 只对 SEC_A 出一个买入意图 ⇒ 成交日 D1。 */
function fixtureSourceRun(dataset: ResearchDataset): CandidateEvaluationRun {
  const selected: SelectedCandidate[] = [
    { securityId: SEC_A, rank: 1, percentile: 1, value: 0.05 },
  ];
  const positionIntents: PositionIntent[] = [
    {
      securityId: SEC_A,
      direction: "long",
      rank: 1,
      percentile: 1,
      weight: 1,
      signalValue: 0.05,
      confidence: null,
    },
  ];
  const dayRecords: CandidateDayRecord[] = [
    {
      date: D0,
      universeMembers: [SEC_A],
      signalCount: 1,
      dropped: [],
      selected,
      positionIntents,
    },
  ];
  const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
    recordKind: "CANDIDATE_EVALUATION_RUN",
    recordVersion: 1,
    datasetVersion: dataset.datasetVersion,
    builderVersion: "fix005-finding-a-1.0.0",
    rowSchemaVersion: "fix005-finding-a-1.0.0",
    datasetGate: dataset.gate,
    universeId: `fix005-finding-a:${dataset.datasetVersion}`,
    strategyId: "fix005-finding-a-probe",
    strategyVersion: "1.0.0",
    parameters: { topK: 3 },
    dateRange: { startDate: D0, endDate: D0 },
    point: "close",
    signalDescription: "fix005 finding-a auxiliary assembly probe",
    featureVersions: [{ featureId: "preReturn10", version: "1.0.0" }],
    rankingConfig: { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
    selectionConfig: { method: { kind: "topN", n: 3 } },
    days: dayRecords,
    evaluation: evaluateCandidateRun(dayRecords),
  };
  return { ...body, fingerprint: computeCandidateEvaluationRunFingerprint(body) };
}

/**
 * 一份**既无 `recipe`、也无声明式条件**的策略文档（走 `requireRecipe` 兜底路径）。
 *
 * 为什么这样够：本文件要钉的是「装配 → 撮合」这条**结构**，而不是某个策略的规则；
 * 装配口径（成本 / 初始资金 / 持仓上限 / 仓位 / 执行政策）与策略身份无关。
 */
function makeDocInput(dataset: ResearchDataset): StrategyDocumentInput {
  return {
    strategyId: "fix005-finding-a-probe",
    version: "1.0.0",
    name: "Finding A 辅助装配探针策略",
    description: "无 recipe、无声明式条件（装配结构探针）",
    universe: { universeId: `research-dataset:${dataset.datasetVersion}` },
    entryRules: [
      {
        id: "enter-topN",
        kind: "threshold",
        field: "candidate.rank",
        operator: "<=",
        operand: 3,
        description: "候选排名 <= 3 进场（legacy 规则）",
      },
    ],
    exitRules: [],
    positionSizing: { kind: "equal-weight", maxPositions: 5 },
    riskRules: [],
    parameters: { parameters: [] },
    datasetVersion: dataset.datasetVersion,
    executionAssumptions: {
      backtestConfig: { initialCapital: 100_000, maxPositions: 5, maxDailyBuys: 2 },
      costModel: COST_STD,
      executionModel: "NEXT_OPEN",
    },
  };
}

function makeDocument(dataset: ResearchDataset): StrategyDocument {
  return createStrategyDocument(makeDocInput(dataset));
}

/** 空的公司行为解析器：装配口径仍走「解析器已提供」分支，但**不查库**。 */
const EMPTY_CORPORATE_ACTIONS = createCorporateActionResolver([], new Map());

function assemblyRequest(args: {
  readonly dataset: ResearchDataset;
  readonly runnerBridge?: RunnerHoldingBridgePolicyDefinition | null;
}): AssembleCompositeRunnerSimulationConfigInput {
  return {
    dataset: args.dataset,
    strategyDocument: makeDocument(args.dataset),
    dateRange: { startDate: D0, endDate: D7 },
    datasetVersionId: DATASET_VERSION_ID,
    codeVersion: "fix005-finding-a-test",
    createdAt: "2026-10-11T00:00:00.000Z",
    name: "fix005-finding-a-assembly",
    runnerBridge: args.runnerBridge ?? null,
    corporateActionResolver: EMPTY_CORPORATE_ACTIONS,
  };
}

// ---------------------------------------------------------------------------
// 状态 provider（确认日 NORMAL、成交日起 ST）
// ---------------------------------------------------------------------------

function normalOnConfirmDayThenSt(): SecurityStatusProvider {
  return {
    providerId: "TEST_FINDING_A",
    contractVersion: ST_GATE_CONTRACT_VERSION,
    statusAt: (query): SecurityStatusFact | null => {
      if (query.symbol !== "000001.SZ") return null;
      const status = query.tradeDate === D0 ? "NORMAL" : "ST";
      return {
        symbol: query.symbol,
        tradeDate: query.tradeDate,
        status,
        effectiveFrom: status === "ST" ? D1 : D0,
        effectiveTo: status === "ST" ? D7 : D0,
        availableAsOf: D0,
        source: "TEST_FINDING_A",
        confidence: "VERIFIED",
        evidenceFingerprint: `test:finding-a:${status}:${query.tradeDate}`,
      };
    },
  };
}

function auditOf(run: TradeSimulationRun): readonly ExecutionEligibilityAuditEntry[] {
  return run.executionEligibilityAudit ?? [];
}

// ---------------------------------------------------------------------------
// 1) 辅助装配**不撮合**：唯一撮合入口零调用，且产物里没有撮合结果
// ---------------------------------------------------------------------------

describe("Finding A / 1) 权威装配配置入口只装配、不撮合", () => {
  it("装配期间 `runTradeSimulation` 调用计数 = 0；产物没有任何撮合结果", async () => {
    const dataset = fixtureDataset();
    engineCalls.count = 0;

    const assembled = await assembleCompositeRunnerSimulationConfig(assemblyRequest({ dataset }));

    expect(engineCalls.count).toBe(0);
    expect(assembled.contractVersion).toBe(COMPOSITE_ASSEMBLY_CONFIG_CONTRACT_VERSION);
    // 结构判据（不是布尔标志）：产物里根本没有撮合结果类型
    expect(Object.keys(assembled).sort()).toEqual([
      "assembly",
      "assemblyConfigFingerprint",
      "contractVersion",
      "simulationConfig",
    ]);
    expect("run" in assembled).toBe(false);
    expect(assembled.assemblyConfigFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(assembled.assemblyConfigFingerprint).toBe(
      fingerprintSimulationConfig(assembled.simulationConfig),
    );
    // 装配事实（可对账）
    expect(assembled.assembly.datasetVersion).toBe(dataset.datasetVersion);
    expect(assembled.assembly.datasetSource).toBe("injected");
    expect(assembled.assembly.strategyDecisionEngine).toBe("legacy-recipe");
    expect(assembled.assembly.runtimeOverrides).toEqual([]);
    // 缺省：配置里**没有**执行资格闸门（缺省行为不变）
    expect(assembled.simulationConfig.executionEligibilityGate).toBeUndefined();
  });

  it("对照：`runCompositeRunnerBacktest` 在同一输入下**确实**撮合一次（差别只在那次撮合）", async () => {
    const dataset = fixtureDataset();
    const sourceRun = fixtureSourceRun(dataset);
    engineCalls.count = 0;

    const backtest = await runCompositeRunnerBacktest({ ...assemblyRequest({ dataset }), sourceRun });

    expect(engineCalls.count).toBe(1);
    expect(backtest.run.trades.length).toBeGreaterThanOrEqual(0);
    expect(backtest.simulationConfig.name).toBe("fix005-finding-a-assembly");
  });
});

// ---------------------------------------------------------------------------
// 2) 两入口的 `simulationConfig` 逐字同一（同一段装配实现 ⇒ 不可能漂移）
// ---------------------------------------------------------------------------

describe("Finding A / 2) 装配配置入口与组合回测入口的配置逐字同一", () => {
  it("无 runnerBridge：深层相等 + 配置指纹相等", async () => {
    const dataset = fixtureDataset();
    const sourceRun = fixtureSourceRun(dataset);
    const request = assemblyRequest({ dataset });

    const assembled = await assembleCompositeRunnerSimulationConfig(request);
    const backtest = await runCompositeRunnerBacktest({ ...request, sourceRun });

    expect(backtest.simulationConfig).toEqual(assembled.simulationConfig);
    expect(fingerprintSimulationConfig(backtest.simulationConfig)).toBe(
      assembled.assemblyConfigFingerprint,
    );
  });

  it("带 runnerBridge：`exitPolicy.runnerBridge` 合并口径完全相同", async () => {
    const dataset = fixtureDataset();
    const sourceRun = fixtureSourceRun(dataset);
    const runnerBridge: RunnerHoldingBridgePolicyDefinition = {
      kind: "PIT_RUNNER_HOLDING_BRIDGE",
      state: "NEW_HIGH_3",
      decisionHoldingDays: 5,
      extendToHoldingDays: 20,
    };
    const request = assemblyRequest({ dataset, runnerBridge });

    const assembled = await assembleCompositeRunnerSimulationConfig(request);
    const backtest = await runCompositeRunnerBacktest({ ...request, sourceRun });

    expect(assembled.simulationConfig.exitPolicy?.runnerBridge).toEqual(runnerBridge);
    expect(backtest.simulationConfig).toEqual(assembled.simulationConfig);
    expect(fingerprintSimulationConfig(backtest.simulationConfig)).toBe(
      assembled.assemblyConfigFingerprint,
    );
  });
});

// ---------------------------------------------------------------------------
// 3) 缺省（未注入闸门）⇒ 真实撮合仍照旧成交，digest 逐字节相同
// ---------------------------------------------------------------------------

describe("Finding A / 3) 缺省不注入闸门 ⇒ 行为与旧路径逐字节相同", () => {
  it("装配配置直接撮合：真实成交；与 `runCompositeRunnerBacktest` 的 run 逐字节一致", async () => {
    const dataset = fixtureDataset();
    const sourceRun = fixtureSourceRun(dataset);
    const request = assemblyRequest({ dataset });

    const assembled = await assembleCompositeRunnerSimulationConfig(request);
    const runFromAssembly = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: assembled.simulationConfig,
    });
    const backtest = await runCompositeRunnerBacktest({ ...request, sourceRun });

    // 真实成交（不是「永远不买」）
    expect(runFromAssembly.executionStats.totalFills).toBe(1);
    expect(runFromAssembly.trades).toHaveLength(1);
    // 旧路径逐字节一致（tradeDigest / equityDigest / 引擎指纹 / 指标）
    expect(tradeDigestOf(runFromAssembly.trades)).toBe(tradeDigestOf(backtest.run.trades));
    expect(equityDigestOf(runFromAssembly.equityCurve)).toBe(
      equityDigestOf(backtest.run.equityCurve),
    );
    expect(runFromAssembly.fingerprint).toBe(backtest.run.fingerprint);
    expect(runFromAssembly.sourceFingerprint).toBe(backtest.run.sourceFingerprint);
    expect(canonicalMetrics({
      equityCurve: runFromAssembly.equityCurve,
      tradeLedger: runFromAssembly.trades,
      initialCapital: runFromAssembly.initialCapital,
    })).toEqual(canonicalMetrics({
      equityCurve: backtest.run.equityCurve,
      tradeLedger: backtest.run.trades,
      initialCapital: backtest.run.initialCapital,
    }));
    // 缺省的**快照**里没有执行资格身份字段（缺省不变，可证伪）
    expect(Object.keys(runFromAssembly.config)).not.toContain("executionEligibility");
    expect(runFromAssembly.executionEligibilityAudit).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4) 注入闸门后：确认日 NORMAL + 成交日 ST ⇒ 辅助/装配路径真实撮合输出里**没有成交**
// ---------------------------------------------------------------------------

describe("Finding A / 4) 装配配置注入闸门后，隔夜 ST 在真实撮合输出里买不到", () => {
  it("0 成交 / 0 扣款 / 0 建仓 / 1 次拒单 + 逐笔审计（status=ST, outcome=REJECTED）", async () => {
    const dataset = fixtureDataset();
    const sourceRun = fixtureSourceRun(dataset);
    const assembled = await assembleCompositeRunnerSimulationConfig(assemblyRequest({ dataset }));

    // 🔴 与实验 `experiment.ts` 注入闸门的方式**逐字相同**：
    //    `{ ...assembledBase, executionEligibilityGate: stExecutionEligibilityGate }`
    const gatedConfig: SimulationConfig = {
      ...assembled.simulationConfig,
      executionEligibilityGate: createStExecutionEligibilityGate({
        provider: normalOnConfirmDayThenSt(),
      }),
    };
    const run = runTradeSimulation({ dataset, sourceRun, simConfig: gatedConfig });

    expect(run.trades).toHaveLength(0);
    expect(run.positions).toHaveLength(0);
    expect(run.executionStats.totalFills).toBe(0);
    expect(run.executionStats.rejectedOrders).toBe(1);
    for (const point of run.equityCurve) {
      expect(point.cash).toBe(100_000);
      expect(point.marketValue).toBe(0);
      expect(point.equity).toBe(100_000);
    }
    const audit = auditOf(run);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.securityId).toBe(SEC_A);
    expect(audit[0]!.status).toBe("ST");
    expect(audit[0]!.outcome).toBe("REJECTED");
    expect(audit[0]!.gateId).toBe(ST_EXECUTION_ELIGIBILITY_GATE_ID);
    expect(audit[0]!.plannedCheckDate).toBe(D0);
    expect(audit[0]!.executionDate).toBe(D1);
    expect(audit[0]!.checkedAt).toBe(`${D1}T09:15:00`);
    // 拒单发生在成交前：订单审计里留下具名原因
    const rejected = run.audit.orders.find((order) => order.status === "REJECTED")!;
    expect(rejected.explanation).toContain("执行资格闸门拒绝");
    expect(rejected.explanation).toContain("status=ST");
    // 快照里出现闸门**身份**（函数不入 JSON）
    expect(run.config.executionEligibility).toEqual({
      gateId: ST_EXECUTION_ELIGIBILITY_GATE_ID,
      policyVersion: gatedConfig.executionEligibilityGate!.policyVersion,
    });
  });

  it("同一 fixture 的正对照：闸门放行（两时点 NORMAL）时该配置**真的会成交**", async () => {
    const dataset = fixtureDataset();
    const sourceRun = fixtureSourceRun(dataset);
    const assembled = await assembleCompositeRunnerSimulationConfig(assemblyRequest({ dataset }));
    const alwaysNormal: SecurityStatusProvider = {
      providerId: "TEST_FINDING_A_NORMAL",
      contractVersion: ST_GATE_CONTRACT_VERSION,
      statusAt: (query): SecurityStatusFact => ({
        symbol: query.symbol,
        tradeDate: query.tradeDate,
        status: "NORMAL",
        effectiveFrom: D0,
        effectiveTo: D7,
        availableAsOf: D0,
        source: "TEST_FINDING_A_NORMAL",
        confidence: "VERIFIED",
        evidenceFingerprint: `test:finding-a:normal:${query.tradeDate}`,
      }),
    };
    const run = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: {
        ...assembled.simulationConfig,
        executionEligibilityGate: createStExecutionEligibilityGate({ provider: alwaysNormal }),
      },
    });

    expect(run.executionStats.totalFills).toBe(1);
    expect(run.trades).toHaveLength(1);
    expect(run.executionStats.rejectedOrders).toBe(0);
    expect(run.trades[0]!.fees).toBeGreaterThan(0);
  });
});
