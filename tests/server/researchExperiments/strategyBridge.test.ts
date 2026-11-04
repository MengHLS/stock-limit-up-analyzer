/**
 * RESEARCH-EXPERIMENT-002 · Experiment → Strategy 桥 + Experiment provenance 单测。
 *
 * 本文件钉住四件事（都是「不写测试就会静默退化」的那类）：
 *
 * 1. **转换器不读旧 Research 锚**（把「载体里那三个锚填 null/0 无害」从注释变成断言）：
 *    用两组**不同**的锚值跑同一份草稿，产出的 `definition` / `executionAssumptions` / `recipe`
 *    必须**逐字节相等** —— 将来若有人让转换器依赖旧锚，这条立刻变红；
 * 2. **溯源按 sourceKind 分派必填面**：旧体系缺锚 ⇒ 拒；独立实验填了旧锚 ⇒ 拒（禁假 id 凑数）；
 * 3. **桥的失败出口**：实验执行失败 / 策略创建失败 / 溯源写失败各有专属领域码，
 *    且**溯源写失败时必须回报已产生的策略坐标**（不装成「什么都没发生」）；
 * 4. **执行摘要指纹稳定**（同结果 ⇒ 同 digest）。
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ExperimentDefinition, ExperimentRunOutcome } from "@shared/researchExperimentsContracts";
import {
  EXPERIMENT_STRATEGY_ERROR,
  ExperimentStrategyError,
  createExperimentStrategyBridge,
  digestOfExperimentResult,
  type ExperimentStrategyDraft,
} from "../../../server/researchExperiments/strategyBridge";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import type { ExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import {
  STRATEGY_PROVENANCE_ERROR,
  assertProvenanceInput,
  type StrategyResearchProvenanceRepository,
} from "../../../server/research/strategyCandidate/types";
import { createInMemoryStrategyResearchProvenanceRepository } from "../../../server/research/strategyCandidate/provenance";
import { buildExecutionAssumptions, buildStrategyDefinition, buildStrategyRecipe } from "../../../server/research/strategyCandidate/definitionBuild";
import type { ResearchStrategyCandidate } from "../../../server/research/vocabulary";
import type { StrategyPromotionPort } from "../../../server/research/strategyCandidate/strategyPromotionPort";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const VERSION_ID = 903_001;

const DRAFT: ExperimentStrategyDraft = {
  entryRule: {
    event: "FIRST_LIMIT_UP",
    timing: "NEXT_OPEN",
    extra: {
      observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
      trigger: "FIRST_VALID_DAY",
      eventParams: { limitUpRatio: 0.1 },
      execution: {
        quantityMethod: "TARGET_WEIGHT",
        lotSize: 100,
        slippageModel: "BPS",
        commissionModel: "BPS",
        executionConstraints: ["一字板不成交"],
      },
      position: { sizingMethod: "FIXED_RATIO", positionRatio: 0.2, maxExposure: 0.8 },
      risk: { stopLoss: 0.08, maxExposure: 0.8, maxDrawdown: 0.25 },
      document: {
        backtestConfig: { initialCapital: 1_000_000, maxPositions: 5 },
        costModel: {
          commissionRate: 0.00025,
          stampDutyRate: 0.0005,
          transferFeeRate: 0.00001,
          slippageBps: 5,
          lotSize: 100,
          minCommission: 5,
        },
      },
    },
  },
  filterRule: {
    groups: [
      {
        groupNo: 0,
        groupLogicalOperator: "AND",
        conditions: [
          {
            groupNo: 0,
            sortOrder: 0,
            fieldName: "bar.low",
            operator: ">=",
            value: "prefix.rd0.open",
            logicalOperator: "AND",
            groupLogicalOperator: "AND",
          },
        ],
      },
    ],
  },
  parameterSpace: { holdingDays: { type: "number", min: 1, max: 20, step: 1 } },
  exitRule: { holdingDays: 3, takeProfit: 0.15, stopLoss: 0.08 },
  riskRule: { maxPositions: 5, maxPositionWeight: 0.3 },
};

/** 一段不含任何领域依赖的样例实验结果（runner 用内存 port 跑出来）。 */
function experimentDefinition(): ExperimentDefinition {
  return {
    descriptor: {
      id: "demo/bridge",
      name: "桥测试实验",
      version: "1.0.0",
      description: "演示",
      source: "test",
      parameters: [],
      datasetRequirement: {
        datasetCode: "first_limit_pullback",
        requiredColumns: { events: ["isFirstLimit"] },
        prefixRelativeDays: [0],
        postRelativeDays: [],
        decisionOffsetDays: null,
        usesForwardData: false,
      },
      pageKey: "demo/bridge",
      pageTitle: "桥测试实验",
    },
    resultSchema: z.object({ ok: z.boolean() }),
    run: () => ({
      sampleSummary: { candidateCount: 1, eligibleCount: 1, excludedCount: 0, excludedByReason: {} },
      customPayload: { ok: true },
      statistics: [{ code: "n", label: "计数", value: 1 }],
    }),
  };
}

function memoryPort(): ExperimentDatasetPort {
  return {
    async getVersionFacts() {
      return {
        datasetVersionId: VERSION_ID,
        datasetCode: "first_limit_pullback",
        datasetName: "首板回踩",
        datasetVersionLabel: "v-test",
        status: "READY",
        startDate: "2025-01-01",
        endDate: "2025-06-30",
        totalEvents: 1,
        postRelativeDayRange: { min: 1, max: 5 },
      };
    },
    async listVersionOptions() {
      return [];
    },
    createAccess() {
      return {
        access: {
          facts: {
            datasetVersionId: VERSION_ID,
            datasetCode: "first_limit_pullback",
            datasetName: "首板回踩",
            datasetVersionLabel: "v-test",
            status: "READY",
            startDate: null,
            endDate: null,
            totalEvents: 1,
            postRelativeDayRange: null,
          },
          async events() {
            return [];
          },
          async feature() {
            return [];
          },
          async observation() {
            return [];
          },
        },
        stats: {
          eventCount: 0,
          prefixRowCount: 0,
          postRowCount: 0,
          maxPostRelativeDayRead: null,
          eventScanTruncated: false,
        },
      };
    },
  };
}

function runnerFor(definition: ExperimentDefinition) {
  const registry = new ExperimentRegistry();
  registry.register(definition);
  return createExperimentRunner({ registry, datasetPort: memoryPort() });
}

/** 记录调用的策略创建端口替身（**不是 mock 冒名**：它执行与真实端口同形的幂等语义）。 */
function fakeStrategies(options: { fail?: boolean } = {}): {
  port: StrategyPromotionPort;
  calls: number;
} {
  const state = { calls: 0 };
  const port = {
    async findVersion() {
      return undefined;
    },
    async createStrategyVersion(input: { strategyId: string; version: string }) {
      state.calls += 1;
      if (options.fail === true) throw new Error("版本冲突（夹具）");
      return {
        strategyId: input.strategyId,
        version: input.version,
        versionRowId: 902_001,
        fingerprint: "f".repeat(64),
        mainComponentCount: 0,
        projectableComponentCount: 0,
        created: true,
      };
    },
    async inspectVersion() {
      return undefined;
    },
  } as unknown as StrategyPromotionPort;
  return { port, get calls() { return state.calls; } } as { port: StrategyPromotionPort; calls: number };
}

// ---------------------------------------------------------------------------
// 1) 转换器不读旧 Research 锚（可断言的事实，不是注释承诺）
// ---------------------------------------------------------------------------

describe("桥 · CandidateSketchCarrier 的旧锚不影响产物", () => {
  it("两组不同旧锚值 ⇒ definition / executionAssumptions / recipe 逐字节相等", () => {
    const executionDataset = {
      datasetVersionId: VERSION_ID,
      datasetVersionLabel: "v-test",
      datasetCode: "first_limit_pullback",
    };
    const carrierA = {
      experimentId: 0,
      conclusionId: null,
      name: "A",
      entryRule: DRAFT.entryRule,
      filterRule: DRAFT.filterRule,
      exitRule: DRAFT.exitRule,
      riskRule: DRAFT.riskRule,
      parameterSpace: DRAFT.parameterSpace,
    } as unknown as ResearchStrategyCandidate;
    const carrierB = {
      experimentId: 999_999,
      conclusionId: 123_456,
      name: "B",
      entryRule: DRAFT.entryRule,
      filterRule: DRAFT.filterRule,
      exitRule: DRAFT.exitRule,
      riskRule: DRAFT.riskRule,
      parameterSpace: DRAFT.parameterSpace,
    } as unknown as ResearchStrategyCandidate;

    const build = (carrier: ResearchStrategyCandidate) => ({
      definition: buildStrategyDefinition({ candidate: carrier, executionDataset }),
      executionAssumptions: buildExecutionAssumptions(carrier),
      recipe: buildStrategyRecipe(carrier) ?? null,
    });
    expect(JSON.stringify(build(carrierB))).toBe(JSON.stringify(build(carrierA)));
  });
});

// ---------------------------------------------------------------------------
// 2) 溯源按 sourceKind 分派必填面
// ---------------------------------------------------------------------------

describe("溯源 · sourceKind 分派必填面", () => {
  const base = {
    strategyVersionId: 1,
    strategyId: "s-1",
    strategyVersion: "1.0.0",
    sourceDatasetVersionId: VERSION_ID,
    sourceDatasetLabel: "v-test",
    origin: "DIRECT" as const,
  };

  it("旧体系（缺省）三个旧锚必须为正整数（与 002 之前逐字一致）", () => {
    expect(() =>
      assertProvenanceInput({
        ...base,
        sourceCandidateId: null,
        sourceConclusionId: 2,
        sourceExperimentId: 3,
      }),
    ).toThrowError(/sourceCandidateId/);
    expect(() =>
      assertProvenanceInput({ ...base, sourceCandidateId: 1, sourceConclusionId: 2, sourceExperimentId: 3 }),
    ).not.toThrow();
  });

  it("独立实验来源：三个旧锚必须为 null（禁假 id 凑数），且必须给实验坐标", () => {
    const full = {
      ...base,
      sourceKind: "INDEPENDENT_EXPERIMENT" as const,
      sourceCandidateId: null,
      sourceConclusionId: null,
      sourceExperimentId: null,
      experimentRef: "demo/bridge",
      experimentVersion: "1.0.0",
      experimentParametersJson: { n: 1 },
      experimentResultDigest: "exp-sha256:abc",
    };
    expect(() => assertProvenanceInput(full)).not.toThrow();

    // 填了假 id ⇒ 拒（这正是「不伪造来源坐标」的结构保证）
    for (const field of ["sourceCandidateId", "sourceConclusionId", "sourceExperimentId"] as const) {
      expect(() => assertProvenanceInput({ ...full, [field]: 7 })).toThrowError(/必须为 null/u);
    }
    // 缺实验坐标 ⇒ 拒
    expect(() =>
      assertProvenanceInput({ ...full, experimentRef: "" }),
    ).toThrowError(/experimentRef/);
    expect(() =>
      assertProvenanceInput({ ...full, experimentParametersJson: null }),
    ).toThrowError(/experimentParametersJson/);
  });

  it("InMemory 仓储按同一批断言（两个实现同一语义）", async () => {
    const repo = createInMemoryStrategyResearchProvenanceRepository();
    // 🔴 判据用 `error.code`（**结构**），不用 message 里的裸子串：
    //    `StrategyProvenanceError` 的码在 `code` 字段上，message 里没有它
    //    （与 tRPC 边界的 `[CODE] …` 是不同的两层，别混）。
    try {
      await repo.create({
        ...base,
        sourceKind: "INDEPENDENT_EXPERIMENT",
        sourceCandidateId: 1,
        sourceConclusionId: null,
        sourceExperimentId: null,
        experimentRef: "demo/bridge",
        experimentVersion: "1.0.0",
        experimentParametersJson: { n: 1 },
        experimentResultDigest: "exp-sha256:abc",
      });
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as { code?: string }).code).toBe(STRATEGY_PROVENANCE_ERROR.INVALID_INPUT);
    }
  });
});

// ---------------------------------------------------------------------------
// 3) 桥的失败出口
// ---------------------------------------------------------------------------

function makeBridge(options: { runFails?: boolean; strategyFails?: boolean; provenanceFails?: boolean } = {}) {
  const definition = experimentDefinition();
  const runner = runnerFor(
    options.runFails === true
      ? {
          ...definition,
          run: () => {
            throw new Error("研究口径里出现了非法区间");
          },
        }
      : definition,
  );
  const strategies = fakeStrategies({ fail: options.strategyFails === true });
  const repository: StrategyResearchProvenanceRepository =
    options.provenanceFails === true
      ? ({
          // 只让写入失败：读取仍然可用（模拟「策略已建、溯源写失败」这一真实形态）。
          create: async () => {
            throw new Error("溯源表不可用（夹具）");
          },
          getByStrategyVersionId: async () => undefined,
          listByStrategyId: async () => [],
          getBySourceCandidateId: async () => undefined,
          deleteByStrategyVersionId: async () => false,
        } as unknown as StrategyResearchProvenanceRepository)
      : createInMemoryStrategyResearchProvenanceRepository();
  const bridge = createExperimentStrategyBridge({
    runner,
    strategies: strategies.port,
    provenance: repository,
  });
  return { bridge, strategies };
}

const REQUEST = {
  experimentId: "demo/bridge",
  datasetVersionId: VERSION_ID,
  strategyId: "cand-e2e",
  name: "实验来源策略",
  draft: DRAFT,
};

async function expectStrategyError(promise: Promise<unknown>, code: string): Promise<ExperimentStrategyError> {
  try {
    await promise;
    throw new Error(`期望抛出 ${code}，但没有抛出`);
  } catch (error) {
    expect(error).toBeInstanceOf(ExperimentStrategyError);
    expect((error as ExperimentStrategyError).code).toBe(code);
    return error as ExperimentStrategyError;
  }
}

describe("桥 · 成功路径与失败出口", () => {
  it("成功：写溯源（sourceKind=INDEPENDENT_EXPERIMENT / 三锚为 null / 有 digest）", async () => {
    const { bridge } = makeBridge();
    const result = await bridge.createStrategyFromExperiment(REQUEST);
    expect(result.sourceKind).toBe("INDEPENDENT_EXPERIMENT");
    expect(result.strategyVersionId).toBe(902_001);
    expect(result.experimentResultDigest).toMatch(/^exp-sha256:[0-9a-f]{16}$/u);
    expect(result.experimentExecution.datasetFacts.datasetVersionId).toBe(VERSION_ID);
  });

  it("实验执行期失败 ⇒ EXPERIMENT_RUN_FAILED（不拿失败结果造策略）", async () => {
    const { bridge, strategies } = makeBridge({ runFails: true });
    const error = await expectStrategyError(
      bridge.createStrategyFromExperiment(REQUEST),
      EXPERIMENT_STRATEGY_ERROR.EXPERIMENT_RUN_FAILED,
    );
    expect(error.message).toContain("不拿失败的结果去创建策略");
    // 关键：实验失败时**根本不该尝试建策略**
    expect(strategies.calls).toBe(0);
  });

  it("实验未注册 ⇒ EXPERIMENT_INVALID（执行前错误透出领域码）", async () => {
    const { bridge } = makeBridge();
    await expectStrategyError(
      bridge.createStrategyFromExperiment({ ...REQUEST, experimentId: "no/such" }),
      EXPERIMENT_STRATEGY_ERROR.EXPERIMENT_INVALID,
    );
  });

  it("策略创建失败 ⇒ STRATEGY_CREATE_FAILED", async () => {
    const { bridge } = makeBridge({ strategyFails: true });
    await expectStrategyError(
      bridge.createStrategyFromExperiment(REQUEST),
      EXPERIMENT_STRATEGY_ERROR.STRATEGY_CREATE_FAILED,
    );
  });

  it("策略已建但溯源写失败 ⇒ PROVENANCE_WRITE_FAILED 且**回报已产生的坐标**", async () => {
    const { bridge } = makeBridge({ provenanceFails: true });
    const error = await expectStrategyError(
      bridge.createStrategyFromExperiment(REQUEST),
      EXPERIMENT_STRATEGY_ERROR.PROVENANCE_WRITE_FAILED,
    );
    expect(error.message).toContain("versionRowId=902001");
    expect(error.message).toContain("仍然可用");
    expect((error.detail as { versionRowId?: number }).versionRowId).toBe(902_001);
  });

  it("草案非法（缺 entryRule）⇒ DRAFT_INVALID", async () => {
    const { bridge } = makeBridge();
    const broken = { ...DRAFT, entryRule: {} } as ExperimentStrategyDraft;
    await expectStrategyError(
      bridge.createStrategyFromExperiment({
        ...REQUEST,
        draft: { ...broken, filterRule: DRAFT.filterRule, parameterSpace: DRAFT.parameterSpace, exitRule: DRAFT.exitRule, riskRule: DRAFT.riskRule },
      }),
      EXPERIMENT_STRATEGY_ERROR.DRAFT_INVALID,
    );
  });
});

// ---------------------------------------------------------------------------
// 4) 结果指纹稳定
// ---------------------------------------------------------------------------

describe("桥 · 实验结果指纹", () => {
  it("同结果 ⇒ 同 digest；改一个统计量 ⇒ digest 变（canonical + sha256）", async () => {
    const { bridge } = makeBridge();
    // 用 runner 直接跑两次拿 outcome（同一份定义 ⇒ 结果相同）
    const runner = runnerFor(experimentDefinition());
    const a = await runner.run({ experimentId: "demo/bridge", datasetVersionId: VERSION_ID });
    const b = await runner.run({ experimentId: "demo/bridge", datasetVersionId: VERSION_ID });
    expect(digestOfExperimentResult(a)).toBe(digestOfExperimentResult(b));

    const mutated: ExperimentRunOutcome = {
      ...a,
      result: {
        ...a.result!,
        statistics: [{ code: "n", label: "计数", value: 2 }],
      },
    };
    expect(digestOfExperimentResult(mutated)).not.toBe(digestOfExperimentResult(a));
    void bridge;
  });
});
