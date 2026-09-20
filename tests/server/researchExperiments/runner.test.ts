/**
 * RESEARCH-EXPERIMENT-001 · Runner Test（规格 §17「Runner Test」：load / execute / error）
 *
 * 本文件钉住 Runner 的**两条出口**（这是本体系最容易被写错的地方）：
 *
 * | 情形 | 出口 |
 * | --- | --- |
 * | **执行前**可判定（未注册 / 参数非法 / 版本不存在或非 READY / 相对日超视界） | **抛领域错误** |
 * | **执行中**才发生（`run()` 抛异常 / 结果不符契约 / 样本账不平） | **返回 `FAILED` outcome**（`result: null` + `error` 如实回报） |
 *
 * 数据面走**真实**的 Registry 桥（在内存读取层上），不手搓替身 ——
 * 这样参数校验、Dataset 校验、PIT 闸门、结果校验四条路径全都真跑一遍。
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  ExperimentDefinition,
  ExperimentResultPayload,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentError } from "../../../server/researchExperiments/errors";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import {
  MAX_EXPERIMENT_LOG_LINES,
  createExperimentRunner,
} from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 900_100;
const MISSING_VERSION_ID = 900_999;

const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 120001,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-runner",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-06-30",
  totalEvents: 2,
  horizons: [5],
  pathRelativeDayRange: { min: 1, max: 5 },
  postRelativeDayRange: { min: 1, max: 5 },
  decisionOffsetDays: null,
};

function makeEvent(eventId: string, tradeDate: string): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate,
    market: "SH",
    industryCode: "IND",
    boardType: "main",
    previousClose: 10,
    limitUpPrice: 11,
    turnover: 2,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 1,
    marketCap: 1,
    floatMarketCap: 1,
  };
}

function makeBar(eventId: string, relativeDay: number, tradeDate: string, close: number): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate,
    relativeDay,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    amount: 1,
  };
}

const EVENTS = [makeEvent("e1", "2025-01-02"), makeEvent("e2", "2025-01-03")];
const PREFIX = [makeBar("e1", 0, "2025-01-02", 10), makeBar("e2", 0, "2025-01-03", 20)];
const POST = [makeBar("e1", 1, "2025-01-03", 11), makeBar("e2", 1, "2025-01-06", 19)];

/** 记录 `run()` 实际拿到的 context，用于断言「数据面确实按声明注入」。 */
let lastContext: ExperimentRunContext | null = null;

function testDefinition(
  overrides: Partial<ExperimentDefinition> = {},
  runOverride?: ExperimentDefinition["run"],
): ExperimentDefinition {
  const base: ExperimentDefinition = {
    descriptor: {
      id: "demo/runner",
      name: "Runner 测试实验",
      version: "2.3.4",
      description: "演示",
      source: "test",
      parameters: [
        { code: "n", label: "数量", kind: "INT", required: false, defaultValue: 3, bounds: { min: 1, max: 5 } },
      ],
      datasetRequirement: {
        datasetCode: "first_limit_pullback",
        requiredColumns: { events: ["isFirstLimit"], feature: ["close"] },
        prefixRelativeDays: [0],
        postRelativeDays: [1],
        decisionOffsetDays: 1,
        usesForwardData: true,
        forwardDataPurpose: "研究事件后第 1 个交易日的价格",
      },
      pageKey: "demo/runner",
      pageTitle: "Runner 测试实验",
    },
    resultSchema: z.object({ echo: z.number() }),
    // 默认实现**真的读一遍数据面**（events + feature(0) + observation(1)）——
    // 这样 `execution.datasetFacts` 的行数与 `forwardDataRead` 才有可断言的取值
    // （读取计数只统计**真的读过**的行，不是表级 COUNT）。
    run: async (ctx) => {
      const events = await ctx.dataset.events();
      await ctx.dataset.feature(0);
      await ctx.dataset.observation(1);
      ctx.log(`读取事件 ${events.length} 条`);
      return {
        sampleSummary: {
          candidateCount: events.length,
          eligibleCount: events.length,
          excludedCount: 0,
          excludedByReason: {},
        },
        customPayload: { echo: ctx.parameters.n },
      };
    },
  };
  return { ...base, ...overrides, ...(runOverride !== undefined ? { run: runOverride } : {}) };
}

function makeRunner(definition: ExperimentDefinition) {
  const registry = new ExperimentRegistry();
  registry.register(definition);
  const datasetPort = createRegistryExperimentDatasetPort({
    reader: new InMemoryResearchDatasetReader({
      context,
      events: EVENTS,
      prefixBars: PREFIX,
      postBars: POST,
    }),
    eventPageSize: 1,
  });
  let tick = 0;
  const runner = createExperimentRunner({
    registry,
    datasetPort,
    // 固定时钟：1700000000000 → 1700000002500（耗时 2500 ms）
    now: () => new Date(1_700_000_000_000 + tick++ * 2_500),
  });
  return runner;
}

async function expectThrowCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`期望抛出 ${code}，但没有抛出`);
  } catch (error) {
    expect(error).toBeInstanceOf(ExperimentError);
    expect((error as ExperimentError).code).toBe(code);
  }
}

describe("Runner · load（未注册即抛）", () => {
  it("listDescriptors / requireDescriptor", () => {
    const runner = makeRunner(testDefinition());
    expect(runner.listDescriptors().map((descriptor) => descriptor.id)).toEqual(["demo/runner"]);
    expect(runner.requireDescriptor("demo/runner").version).toBe("2.3.4");
    expect(() => runner.requireDescriptor("nope/nothere")).toThrowError(ExperimentError);
  });

  it("未注册实验 ⇒ EXPERIMENT_NOT_FOUND（执行前抛，不是 FAILED outcome）", async () => {
    const runner = makeRunner(testDefinition());
    await expectThrowCode(
      runner.run({ experimentId: "nope/nothere", datasetVersionId: VERSION_ID }),
      "EXPERIMENT_NOT_FOUND",
    );
  });
});

describe("Runner · validate（执行前一律抛）", () => {
  it("参数非法 ⇒ EXPERIMENT_PARAMETER_INVALID", async () => {
    const runner = makeRunner(testDefinition());
    await expectThrowCode(
      runner.run({ experimentId: "demo/runner", datasetVersionId: VERSION_ID, parameters: { n: 99 } }),
      "EXPERIMENT_PARAMETER_INVALID",
    );
    await expectThrowCode(
      runner.run({ experimentId: "demo/runner", datasetVersionId: VERSION_ID, parameters: { nope: 1 } }),
      "EXPERIMENT_PARAMETER_INVALID",
    );
  });

  it("Dataset 版本不存在 ⇒ EXPERIMENT_DATASET_VERSION_NOT_FOUND", async () => {
    const runner = makeRunner(testDefinition());
    await expectThrowCode(
      runner.run({ experimentId: "demo/runner", datasetVersionId: MISSING_VERSION_ID }),
      "EXPERIMENT_DATASET_VERSION_NOT_FOUND",
    );
  });

  it("Dataset 语义代码不匹配 ⇒ EXPERIMENT_DATASET_CODE_MISMATCH（不静默换数据集）", async () => {
    const definition = testDefinition();
    definition.descriptor.datasetRequirement.datasetCode = "some_other_dataset";
    const runner = makeRunner(definition);
    await expectThrowCode(
      runner.run({ experimentId: "demo/runner", datasetVersionId: VERSION_ID }),
      "EXPERIMENT_DATASET_CODE_MISMATCH",
    );
  });

  it("prepare() 返回解析结果与 Dataset 事实（同一份事实供 run 复用）", async () => {
    const runner = makeRunner(testDefinition());
    const prepared = await runner.prepare({
      experimentId: "demo/runner",
      datasetVersionId: VERSION_ID,
      parameters: { n: 5 },
    });
    expect(prepared.resolvedParameters).toEqual({ n: 5 });
    expect(prepared.facts.datasetCode).toBe("first_limit_pullback");
    expect(prepared.facts.datasetVersionId).toBe(VERSION_ID);
  });
});

describe("Runner · execute（成功路径）", () => {
  it("SUCCEEDED：metadata 由 runner 填真实坐标，实验无法谎报", async () => {
    lastContext = null;
    const runner = makeRunner(
      testDefinition({}, async (ctx) => {
        lastContext = ctx;
        const events = await ctx.dataset.events();
        await ctx.dataset.feature(0);
        const post = await ctx.dataset.observation(1);
        ctx.log(`事件 ${events.length} · post ${post.length}`);
        return {
          sampleSummary: {
            candidateCount: events.length,
            eligibleCount: events.length,
            excludedCount: 0,
            excludedByReason: {},
          },
          customPayload: { echo: ctx.parameters.n },
          statistics: [{ code: "c", label: "计数", value: events.length }],
        };
      }),
    );

    const outcome = await runner.run({
      experimentId: "demo/runner",
      datasetVersionId: VERSION_ID,
      parameters: { n: 4 },
    });

    expect(outcome.runStatus).toBe("SUCCEEDED");
    expect(outcome.error).toBeNull();
    expect(outcome.result).not.toBeNull();
    expect(outcome.result!.metadata).toMatchObject({
      experimentId: "demo/runner",
      experimentVersion: "2.3.4",
      datasetVersionId: VERSION_ID,
      datasetCode: "first_limit_pullback",
      datasetVersionLabel: "v-runner",
      computationVersion: "2.3.4",
    });
    expect(outcome.result!.parameters).toEqual({ n: 4 });
    expect(outcome.result!.customPayload).toEqual({ echo: 4 });

    // 执行元数据
    expect(outcome.execution.durationMs).toBe(2_500);
    expect(outcome.execution.resolvedParameters).toEqual({ n: 4 });
    expect(outcome.execution.datasetFacts).toMatchObject({
      datasetVersionId: VERSION_ID,
      status: "READY",
      datasetTotalEvents: 2,
      eventCount: 2,
      decisionOffsetDays: 1,
      forwardDataRead: true,
      maxPostRelativeDayRead: 1,
    });
    expect(outcome.execution.datasetFacts.prefixRowCount).toBe(2);
    expect(outcome.execution.datasetFacts.postRowCount).toBe(2);

    // 数据面真的是按声明投影出来的
    expect(lastContext).not.toBeNull();
    expect(lastContext!.descriptor.id).toBe("demo/runner");
  });

  it("日志进入执行元数据，并有界（不超过 MAX_EXPERIMENT_LOG_LINES）", async () => {
    const runner = makeRunner(
      testDefinition({}, (ctx) => {
        for (let i = 0; i < MAX_EXPERIMENT_LOG_LINES + 50; i += 1) ctx.log(`line-${i}`);
        return {
          sampleSummary: {
            candidateCount: 1,
            eligibleCount: 1,
            excludedCount: 0,
            excludedByReason: {},
          },
          customPayload: { echo: 1 },
        };
      }),
    );
    const outcome = await runner.run({ experimentId: "demo/runner", datasetVersionId: VERSION_ID });
    expect(outcome.execution.logs).toHaveLength(MAX_EXPERIMENT_LOG_LINES);
    expect(outcome.execution.logs[0]).toBe("line-0");
  });

  it("未声明 usesForwardData 的实验拿不到 post 数据（PIT 闸门在 runner 链路里真实生效）", async () => {
    const definition = testDefinition({}, async (ctx) => {
      await ctx.dataset.observation(1);
      return {
        sampleSummary: { candidateCount: 0, eligibleCount: 0, excludedCount: 0, excludedByReason: {} },
        customPayload: { echo: 0 },
      };
    });
    definition.descriptor.datasetRequirement = {
      ...definition.descriptor.datasetRequirement,
      postRelativeDays: [],
      usesForwardData: false,
      forwardDataPurpose: null,
    };
    const runner = makeRunner(definition);

    const outcome = await runner.run({ experimentId: "demo/runner", datasetVersionId: VERSION_ID });
    expect(outcome.runStatus).toBe("FAILED");
    expect(outcome.result).toBeNull();
    expect(outcome.error?.code).toBe("EXPERIMENT_FORWARD_DATA_FORBIDDEN");
  });
});

describe("Runner · capture error（执行期失败一律回报，不吞错）", () => {
  it("run() 抛异常 ⇒ FAILED + 原始消息进 error.message", async () => {
    const runner = makeRunner(
      testDefinition({}, () => {
        throw new Error("研究口径里出现了非法区间");
      }),
    );
    const outcome = await runner.run({ experimentId: "demo/runner", datasetVersionId: VERSION_ID });
    expect(outcome.runStatus).toBe("FAILED");
    expect(outcome.result).toBeNull();
    expect(outcome.error?.code).toBe("EXPERIMENT_RUN_FAILED");
    expect(outcome.error?.message).toContain("非法区间");
    // 失败也要给执行事实（否则用户不知道「跑到哪一步、用了什么参数」）
    expect(outcome.execution.datasetFacts.datasetVersionId).toBe(VERSION_ID);
    expect(outcome.execution.resolvedParameters).toEqual({ n: 3 });
  });

  it("customPayload 不符本实验 resultSchema ⇒ FAILED + EXPERIMENT_RESULT_INVALID", async () => {
    const runner = makeRunner(
      testDefinition({}, () => ({
        sampleSummary: { candidateCount: 1, eligibleCount: 1, excludedCount: 0, excludedByReason: {} },
        customPayload: { echo: "not-a-number" },
      })),
    );
    const outcome = await runner.run({ experimentId: "demo/runner", datasetVersionId: VERSION_ID });
    expect(outcome.runStatus).toBe("FAILED");
    expect(outcome.error?.code).toBe("EXPERIMENT_RESULT_INVALID");
    expect(outcome.error?.message).toContain("resultSchema");
  });

  it("样本账不平 ⇒ FAILED（不让「样本被静默吞掉」的结果过关）", async () => {
    const payload: ExperimentResultPayload = {
      sampleSummary: { candidateCount: 5, eligibleCount: 2, excludedCount: 3, excludedByReason: { A: 1 } },
      customPayload: { echo: 1 },
    };
    const runner = makeRunner(testDefinition({}, () => payload));
    const outcome = await runner.run({ experimentId: "demo/runner", datasetVersionId: VERSION_ID });
    expect(outcome.runStatus).toBe("FAILED");
    expect(outcome.error?.code).toBe("EXPERIMENT_RESULT_INVALID");
  });
});
