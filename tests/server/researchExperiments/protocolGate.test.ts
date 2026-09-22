import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  ExperimentDefinition,
} from "@shared/researchExperimentsContracts";
import { InMemoryArtifactStorage } from "../../../server/artifactStorage";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import {
  InMemoryExperimentRunRepository,
  createExperimentRunService,
} from "../../../server/researchExperiments/persistence";
import { createExperimentRunQueue } from "../../../server/researchExperiments/persistence/runQueue";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { computeProtocolFingerprint } from "../../../server/researchExperiments/protocol";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type { FirstLimitPullbackEvent } from "../../../server/datasetRegistry/types";

const VERSION_ID = 920_001;

const versionContext: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 940_001,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-protocol",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2026-12-31",
  totalEvents: 2,
  horizons: [],
  pathRelativeDayRange: null,
  postRelativeDayRange: null,
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
    turnover: 1,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 1,
    marketCap: 1,
    floatMarketCap: 1,
  };
}

function protocolDefinition(): ExperimentDefinition {
  return {
    descriptor: {
      id: "demo/protocol",
      name: "Protocol",
      version: "1.0.0",
      description: "protocol test",
      source: "test",
      parameters: [],
      datasetRequirement: {
        datasetCode: "first_limit_pullback",
        requiredColumns: { events: ["isFirstLimit"] },
        decisionOffsetDays: null,
        usesForwardData: false,
      },
      pageKey: "demo/protocol",
      pageTitle: "Protocol",
    },
    resultSchema: z.object({ ok: z.boolean() }),
    run(context) {
      const phase = context.protocol?.phase;
      return {
        sampleSummary: {
          candidateCount: 0,
          eligibleCount: 0,
          excludedCount: 0,
          excludedByReason: {},
        },
        ...(phase === "OBSERVATION" || phase === "HOLDOUT"
          ? {
              confirmatoryGate: {
                status: phase === "OBSERVATION" ? "OBSERVATION_READY" : "PASS",
                protocolFingerprint: context.protocol!.protocolFingerprint!,
                sampleCount: 0,
                checks: [
                  {
                    code: "fixture",
                    label: "fixture",
                    status: "PASS" as const,
                  },
                ],
                summary: `${phase} fixture`,
              },
            }
          : {}),
        customPayload: { ok: true },
      };
    },
  };
}

function buildService(definition: ExperimentDefinition = protocolDefinition()) {
  const registry = new ExperimentRegistry();
  registry.register(definition);
  const datasetPort = createRegistryExperimentDatasetPort({
    reader: new InMemoryResearchDatasetReader({
      context: versionContext,
      events: [makeEvent("e1", "2025-06-02"), makeEvent("e2", "2026-06-02")],
      prefixBars: [],
      postBars: [],
    }),
  });
  const runner = createExperimentRunner({ registry, datasetPort });
  const repository = new InMemoryExperimentRunRepository({
    now: () => new Date("2026-09-22T00:00:00.000Z"),
  });
  const queue = createExperimentRunQueue({ concurrency: 1 });
  const service = createExperimentRunService({
    runner,
    repository,
    resolveStorage: () => new InMemoryArtifactStorage(),
    queue,
  });
  return { service, repository, queue };
}

const protocol = {
  protocolId: "first-board-forward",
  protocolVersion: "1.0.0",
  hypothesisCode: "H1",
  observationWindow: { startDate: "2025-01-01", endDate: "2025-12-31" },
  holdoutWindow: { startDate: "2026-01-01", endDate: "2026-12-31" },
} as const;

describe("Research Protocol / phase lock", () => {
  it("协议指纹区分辅助 Dataset 版本", () => {
    const input = {
      protocol: { ...protocol, phase: "OBSERVATION" as const },
      experimentId: "demo/protocol",
      datasetVersionId: VERSION_ID,
      parameters: {},
      datasetBindings: [
        {
          alias: "primary",
          datasetVersionId: VERSION_ID,
          datasetCode: "first_limit_pullback",
          datasetVersionLabel: "v-protocol",
        },
        {
          alias: "market",
          datasetVersionId: 111,
          datasetCode: "market_regime",
          datasetVersionLabel: "v1",
        },
      ],
    };
    const first = computeProtocolFingerprint(input);
    const second = computeProtocolFingerprint({
      ...input,
      datasetBindings: [
        input.datasetBindings[0]!,
        { ...input.datasetBindings[1]!, datasetVersionId: 222 },
      ],
    });
    expect(first).not.toBe(second);
  });

  it("OBSERVATION 不接受仅适用于 Holdout 的 FAIL Gate", async () => {
    const definition = protocolDefinition();
    definition.run = async (context) => ({
      sampleSummary: {
        candidateCount: 0,
        eligibleCount: 0,
        excludedCount: 0,
        excludedByReason: {},
      },
      confirmatoryGate: {
        status: "FAIL" as const,
        protocolFingerprint: context.protocol!.protocolFingerprint!,
        sampleCount: 0,
        checks: [
          {
            code: "invalid_for_observation",
            label: "invalid for observation",
            status: "FAIL" as const,
          },
        ],
        summary: "fixture",
      },
      customPayload: { ok: true },
    });
    const built = buildService(definition);
    const pending = await built.service.start({
      experimentId: "demo/protocol",
      datasetVersionId: VERSION_ID,
      protocol: { ...protocol, phase: "OBSERVATION" },
    });
    await built.queue.drain();
    const run = await built.service.getRun(pending.runId);
    expect(run).toMatchObject({
      status: "FAILED",
      errorCode: "EXPERIMENT_CONFIRMATORY_GATE_INVALID",
    });
  });

  it("OBSERVATION 持久化协议指纹、窗口和 OBSERVATION_READY Gate", async () => {
    const built = buildService();
    const pending = await built.service.start({
      experimentId: "demo/protocol",
      datasetVersionId: VERSION_ID,
      protocol: { ...protocol, phase: "OBSERVATION" },
    });
    await built.queue.drain();
    const run = await built.service.getRun(pending.runId);
    expect(run).toMatchObject({
      status: "COMPLETED",
      researchPhase: "OBSERVATION",
      protocolId: protocol.protocolId,
      protocolVersion: protocol.protocolVersion,
      parentRunId: null,
      evaluationWindow: protocol.observationWindow,
      confirmatoryGate: { status: "OBSERVATION_READY" },
    });
    expect(run?.protocolFingerprint).toMatch(/^protocol-sha256:[0-9a-f]{64}$/u);
  });

  it("HOLDOUT 复用父 Observation 的冻结参数并只允许一次", async () => {
    const built = buildService();
    const observation = await built.service.start({
      experimentId: "demo/protocol",
      datasetVersionId: VERSION_ID,
      parameters: {},
      protocol: { ...protocol, phase: "OBSERVATION" },
    });
    await built.queue.drain();

    const holdout = await built.service.start({
      experimentId: "demo/protocol",
      datasetVersionId: VERSION_ID,
      protocol: {
        ...protocol,
        phase: "HOLDOUT",
        parentRunId: observation.runId,
      },
    });
    await built.queue.drain();
    const completed = await built.service.getRun(holdout.runId);
    expect(completed).toMatchObject({
      status: "COMPLETED",
      researchPhase: "HOLDOUT",
      parentRunId: observation.runId,
      evaluationWindow: protocol.holdoutWindow,
      confirmatoryGate: { status: "PASS" },
    });

    await expect(
      built.service.start({
        experimentId: "demo/protocol",
        datasetVersionId: VERSION_ID,
        protocol: {
          ...protocol,
          phase: "HOLDOUT",
          parentRunId: observation.runId,
        },
      }),
    ).rejects.toMatchObject({ code: "EXPERIMENT_PROTOCOL_PHASE_CONFLICT" });
  });

  it("HOLDOUT 修改参数被冻结闸门拒绝", async () => {
    const definition = protocolDefinition();
    definition.descriptor.parameters = [
      {
        code: "threshold",
        label: "threshold",
        kind: "NUMBER",
        required: false,
        defaultValue: 0.5,
      },
    ];
    const built = buildService(definition);
    const observation = await built.service.start({
      experimentId: "demo/protocol",
      datasetVersionId: VERSION_ID,
      parameters: { threshold: 0.5 },
      protocol: { ...protocol, phase: "OBSERVATION" },
    });
    await built.queue.drain();

    await expect(
      built.service.start({
        experimentId: "demo/protocol",
        datasetVersionId: VERSION_ID,
        parameters: { threshold: 0.7 },
        protocol: {
          ...protocol,
          phase: "HOLDOUT",
          parentRunId: observation.runId,
        },
      }),
    ).rejects.toMatchObject({ code: "EXPERIMENT_PROTOCOL_PARAMETERS_FROZEN" });
  });

  it("HOLDOUT 窗口被历史探索 Run 看过时拒绝启动", async () => {
    const built = buildService();
    await built.service.execute({
      experimentId: "demo/protocol",
      datasetVersionId: VERSION_ID,
    });
    const observation = await built.service.execute({
      experimentId: "demo/protocol",
      datasetVersionId: VERSION_ID,
      protocol: { ...protocol, phase: "OBSERVATION" },
    });

    await expect(
      built.service.start({
        experimentId: "demo/protocol",
        datasetVersionId: VERSION_ID,
        protocol: {
          ...protocol,
          phase: "HOLDOUT",
          parentRunId: observation.run.runId,
        },
      }),
    ).rejects.toMatchObject({ code: "EXPERIMENT_PROTOCOL_HOLDOUT_CONTAMINATED" });
  });

  it("Evaluation Window 真实过滤事件", async () => {
    const definition = protocolDefinition();
    definition.run = async (context) => {
      const events = await context.dataset.events();
      return {
        sampleSummary: {
          candidateCount: events.length,
          eligibleCount: events.length,
          excludedCount: 0,
          excludedByReason: {},
        },
        confirmatoryGate: {
          status: "OBSERVATION_READY" as const,
          protocolFingerprint: context.protocol!.protocolFingerprint!,
          sampleCount: events.length,
          checks: [
            {
              code: "window_filter",
              label: "window filter",
              status: "PASS" as const,
            },
          ],
          summary: "window filter fixture",
        },
        customPayload: { ok: true },
      };
    };
    definition.resultSchema = z.object({ ok: z.boolean() });
    const built = buildService(definition);
    const observation = await built.service.start({
      experimentId: "demo/protocol",
      datasetVersionId: VERSION_ID,
      protocol: { ...protocol, phase: "OBSERVATION" },
    });
    await built.queue.drain();
    const completed = await built.service.getRun(observation.runId);
    expect(completed?.summary?.candidateCount).toBe(1);
  });
});
