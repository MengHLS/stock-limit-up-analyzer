import { describe, expect, it, vi } from "vitest";
import {
  EXPERIMENT_ARTIFACT_MAX_COUNT,
  EXPERIMENT_RESULT_JSON_MAX_BYTES,
  type ExperimentResultEnvelope,
} from "@shared/researchExperimentsContracts";
import {
  ArtifactStorageError,
  InMemoryArtifactStorage,
  type ArtifactStorage,
} from "../../../server/artifactStorage";
import { publishRunArtifacts } from "../../../server/researchExperiments/persistence/artifactPublisher";

function resultWith(customPayload: unknown): ExperimentResultEnvelope {
  return {
    metadata: {
      experimentId: "test/experiment",
      experimentName: "test",
      experimentVersion: "1.0.0",
      datasetVersionId: 1,
      datasetCode: "test_dataset",
      datasetVersionLabel: "v1",
      datasetStartDate: null,
      datasetEndDate: null,
      computationVersion: "1.0.0",
    },
    parameters: {},
    sampleSummary: {
      candidateCount: 0,
      eligibleCount: 0,
      excludedCount: 0,
      excludedByReason: {},
    },
    customPayload,
  };
}

const BASE = {
  storage: new InMemoryArtifactStorage(),
  experimentId: "test/experiment",
  experimentVersion: "1.0.0",
  experimentCodeDigest: "exp-code-sha256:test",
  runId: "RUN-TEST",
  datasetVersionId: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  logs: [],
  artifactFiles: [],
};

describe("实验 Result / Artifact 配额", () => {
  it("result.json 超限 ⇒ 上传前拒绝，不写任何对象", async () => {
    const storage = new InMemoryArtifactStorage();
    await expect(
      publishRunArtifacts({
        ...BASE,
        storage,
        result: resultWith("x".repeat(EXPERIMENT_RESULT_JSON_MAX_BYTES)),
      }),
    ).rejects.toThrow(/result\.json/);
    expect(await storage.list("experiments/", { maxKeys: 10 })).toEqual([]);
  });

  it("产物数量超限 ⇒ 上传前拒绝", async () => {
    const storage = new InMemoryArtifactStorage();
    const files = Array.from({ length: EXPERIMENT_ARTIFACT_MAX_COUNT }, (_, index) => ({
      name: `part-${index}.txt`,
      role: "artifact" as const,
      body: "x",
    }));
    await expect(
      publishRunArtifacts({ ...BASE, storage, result: resultWith({}), artifactFiles: files }),
    ).rejects.toThrow(/超过上限/);
    expect(await storage.list("experiments/", { maxKeys: 10 })).toEqual([]);
  });

  it("上传中途失败 ⇒ 删除本次已写对象，不留半套产物", async () => {
    const deleted: string[] = [];
    let puts = 0;
    const storage: ArtifactStorage = {
      kind: "failing",
      describe: () => "failing",
      async put(key) {
        puts += 1;
        if (puts === 2) {
          throw new ArtifactStorageError("ARTIFACT_STORAGE_PUT_FAILED", "second put failed");
        }
        return {
          metadata: { key, sizeBytes: 1, contentType: null, lastModified: null, etag: null },
          overwritten: false,
        };
      },
      async get() {
        throw new Error("unused");
      },
      async exists() {
        return false;
      },
      async delete(key) {
        deleted.push(key);
        return true;
      },
      async list() {
        return [];
      },
      async getMetadata() {
        return null;
      },
    };
    await expect(
      publishRunArtifacts({
        ...BASE,
        storage,
        result: resultWith({}),
        artifactFiles: [{ name: "one.csv", role: "table", body: "a\n1\n" }],
      }),
    ).rejects.toThrow(/second put failed/);
    // 第二次 put（首个声明产物）失败时，只有 result.json 已成功写入，
    // 清理范围必须精确等于本次已写对象，不能把失败的 key 也算进去。
    expect(deleted).toEqual(["experiments/test/experiment/runs/RUN-TEST/result.json"]);
  });
});
