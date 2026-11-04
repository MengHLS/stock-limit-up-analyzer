/**
 * RESEARCH-EXPERIMENT-004 hardening:
 *   - 实验代码指纹必须能区分“同 version 但 run 源码不同”；
 *   - 后台队列必须有界并发并可收敛；
 *   - startRun 创建后立即返回，执行在后台完成；
 *   - 后台生命周期异常也必须把 Run 收敛为 FAILED；
 *   - Result / Artifact 配额必须在写对象存储之前拒绝。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  ExperimentDefinition,
  ExperimentResultEnvelope,
  ExperimentRunRecord,
} from "@shared/researchExperimentsContracts";
import { InMemoryArtifactStorage } from "../../../server/artifactStorage";
import { computeExperimentCodeDigest } from "../../../server/researchExperiments/codeDigest";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentError } from "../../../server/researchExperiments/errors";
import {
  InMemoryExperimentRunRepository,
  createExperimentRunService,
  publishRunArtifacts,
  type ExperimentRunService,
  type PublishRunArtifactsInput,
  type ExperimentPublishLimits,
  validatePublishLimits,
} from "../../../server/researchExperiments/persistence";
import { createExperimentRunQueue } from "../../../server/researchExperiments/persistence/runQueue";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";

const VERSION_ID = 900_500;

const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 120005,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-hardening",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-06-30",
  totalEvents: 0,
  horizons: [],
  pathRelativeDayRange: null,
  postRelativeDayRange: null,
  decisionOffsetDays: null,
};

function resultEnvelope(): ExperimentResultEnvelope {
  return {
    metadata: {
      experimentId: "demo/hardening",
      experimentName: "Hardening",
      experimentVersion: "1.0.0",
      datasetVersionId: VERSION_ID,
      datasetCode: "first_limit_pullback",
      datasetVersionLabel: "v-hardening",
      datasetStartDate: "2025-01-01",
      datasetEndDate: "2025-06-30",
      computationVersion: "1.0.0",
      experimentCodeDigest: "exp-code-sha256:test",
    },
    parameters: {},
    sampleSummary: {
      candidateCount: 0,
      eligibleCount: 0,
      excludedCount: 0,
      excludedByReason: {},
    },
    customPayload: { ok: true },
  };
}

function makeDefinition(run: ExperimentDefinition["run"]): ExperimentDefinition {
  return {
    descriptor: {
      id: "demo/hardening",
      name: "Hardening",
      version: "1.0.0",
      description: "hardening test",
      source: "test",
      parameters: [],
      datasetRequirement: {
        datasetCode: "first_limit_pullback",
        requiredColumns: { events: ["isFirstLimit"] },
        decisionOffsetDays: null,
        usesForwardData: false,
      },
      pageKey: "demo/hardening",
      pageTitle: "Hardening",
    },
    resultSchema: z.object({ ok: z.boolean() }),
    run,
  };
}

function makeService(
  definition: ExperimentDefinition,
  options?: {
    repository?: InMemoryExperimentRunRepository;
    queue?: ReturnType<typeof createExperimentRunQueue>;
  },
): {
  service: ExperimentRunService;
  repository: InMemoryExperimentRunRepository;
  queue: ReturnType<typeof createExperimentRunQueue>;
} {
  const registry = new ExperimentRegistry();
  registry.register(definition);
  const datasetPort = createRegistryExperimentDatasetPort({
    reader: new InMemoryResearchDatasetReader({ context, events: [], prefixBars: [], postBars: [] }),
  });
  const runner = createExperimentRunner({ registry, datasetPort });
  const repository = options?.repository ?? new InMemoryExperimentRunRepository();
  const queue = options?.queue ?? createExperimentRunQueue({ concurrency: 1 });
  const service = createExperimentRunService({
    runner,
    repository,
    resolveStorage: () => new InMemoryArtifactStorage(),
    queue,
  });
  return { service, repository, queue };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("实验代码指纹", () => {
  it("同一定义稳定；run 源码或 descriptor 变化都会改变指纹", () => {
    const runA = async () => ({
      sampleSummary: { candidateCount: 0, eligibleCount: 0, excludedCount: 0, excludedByReason: {} },
      customPayload: { ok: true, marker: "a" },
    });
    const runB = async () => ({
      sampleSummary: { candidateCount: 0, eligibleCount: 0, excludedCount: 0, excludedByReason: {} },
      customPayload: { ok: true, marker: "b" },
    });

    const first = makeDefinition(runA);
    const same = makeDefinition(runA);
    const changedRun = makeDefinition(runB);
    const changedDescriptor = makeDefinition(runA);
    changedDescriptor.descriptor.version = "1.0.1";

    const digest = computeExperimentCodeDigest(first);
    expect(digest).toMatch(/^exp-code-sha256:[0-9a-f]{64}$/u);
    expect(computeExperimentCodeDigest(same)).toBe(digest);
    expect(computeExperimentCodeDigest(changedRun)).not.toBe(digest);
    expect(computeExperimentCodeDigest(changedDescriptor)).not.toBe(digest);
  });
});

describe("进程内实验队列", () => {
  it("并发有界，drain() 等到全部任务结束", async () => {
    const queue = createExperimentRunQueue({ concurrency: 2 });
    let active = 0;
    let peak = 0;
    let completed = 0;

    for (let index = 0; index < 5; index += 1) {
      queue.enqueue(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        completed += 1;
      });
    }

    await queue.drain();
    expect(completed).toBe(5);
    expect(peak).toBe(2);
    expect(queue.activeCount()).toBe(0);
    expect(queue.queuedCount()).toBe(0);
  });
});

describe("异步 Run 生命周期", () => {
  it("start() 立即返回 PENDING，后台执行完成后变为 COMPLETED", async () => {
    const definition = makeDefinition(() => ({
      sampleSummary: { candidateCount: 0, eligibleCount: 0, excludedCount: 0, excludedByReason: {} },
      customPayload: { ok: true },
    }));
    const { service, queue } = makeService(definition);

    const pending = await service.start({
      experimentId: "demo/hardening",
      datasetVersionId: VERSION_ID,
    });
    expect(pending.status).toBe("PENDING");
    expect(pending.experimentCodeDigest).toMatch(/^exp-code-sha256:/u);

    await queue.drain();
    const completed = await service.getRun(pending.runId);
    expect(completed?.status).toBe("COMPLETED");
    expect(completed?.resultManifestKey).toMatch(/\/manifest\.json$/u);
  });

  it("后台 markRunning() 异常也会把 PENDING Run 收敛为 FAILED", async () => {
    class FailingRepository extends InMemoryExperimentRunRepository {
      override async markRunning(): Promise<ExperimentRunRecord> {
        throw new Error("mark running failed");
      }
    }

    vi.spyOn(console, "error").mockImplementation(() => {});
    const definition = makeDefinition(() => ({
      sampleSummary: { candidateCount: 0, eligibleCount: 0, excludedCount: 0, excludedByReason: {} },
      customPayload: { ok: true },
    }));
    const repository = new FailingRepository();
    const { service, queue } = makeService(definition, { repository });

    const pending = await service.start({
      experimentId: "demo/hardening",
      datasetVersionId: VERSION_ID,
    });
    await queue.drain();
    const failed = await service.getRun(pending.runId);
    expect(failed?.status).toBe("FAILED");
    expect(failed?.errorCode).toBe("EXPERIMENT_RUN_FAILED");
    expect(failed?.errorMessage).toContain("mark running failed");
  });
});

describe("Result / Artifact 配额", () => {
  const storage = new InMemoryArtifactStorage();
  const baseLimits: ExperimentPublishLimits = {
    resultJsonMaxBytes: 1_000_000,
    resultTableMaxRows: 100,
    resultTableMaxCells: 1_000,
    artifactMaxCount: 20,
    artifactMaxSingleBytes: 1_000,
    artifactMaxTotalBytes: 5_000,
  };

  function baseInput(): PublishRunArtifactsInput {
    return {
      storage,
      experimentId: "demo/hardening",
      experimentVersion: "1.0.0",
      experimentCodeDigest: "exp-code-sha256:test",
      runId: "RUN-LIMIT-1",
      datasetVersionId: VERSION_ID,
      createdAt: "2026-09-21T00:00:00.000Z",
      result: resultEnvelope(),
      logs: [],
      artifactFiles: [],
    };
  }

  it("结果信封体积超限 ⇒ 上传前拒绝", () => {
    const input = baseInput();
    expect(() =>
      validatePublishLimits(input, "x".repeat(1_001), {
        ...baseLimits,
        resultJsonMaxBytes: 1_000,
      }),
    ).toThrowError(expect.objectContaining({ code: "EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED" }));
  });

  it("结果表行数 / 单元格数超限 ⇒ 上传前拒绝", () => {
    const input = baseInput();
    input.result = {
      ...input.result,
      tables: [
        {
          key: "large",
          title: "large",
          columns: [{ key: "a", label: "A" }],
          rows: [{ a: 1 }, { a: 2 }],
        },
      ],
    };
    expect(() =>
      validatePublishLimits(input, "{}", {
        ...baseLimits,
        resultTableMaxRows: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED" }));
  });

  it("单产物体积超限 ⇒ 不写任何对象", async () => {
    const input = baseInput();
    input.artifactFiles = [
      { name: "large.csv", role: "table", body: "12345" },
    ];
    await expect(
      publishRunArtifacts({
        ...input,
        limits: { artifactMaxSingleBytes: 4 },
      }),
    ).rejects.toMatchObject({ code: "EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED" });
    expect(storage.size).toBe(0);
  });

  it("对象数量超限 ⇒ 在写入前拒绝", () => {
    const input = baseInput();
    input.artifactFiles = [
      { name: "a.csv", role: "table", body: "a" },
      { name: "b.csv", role: "table", body: "b" },
    ];
    expect(() =>
      validatePublishLimits(input, "{}", {
        ...baseLimits,
        artifactMaxCount: 3,
      }),
    ).toThrowError(expect.objectContaining({ code: "EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED" }));
  });
});
