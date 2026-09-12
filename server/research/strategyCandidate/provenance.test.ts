/**
 * RESEARCH-006.1 — Research → Strategy 桥的领域层测试（InMemory 侧）。
 *
 * 本文件驱动**唯一一份**契约用例（`provenanceContract.ts`）：
 *   - `runProvenanceContract`：溯源仓储的 create / get / list / 幂等闸门 / 删除 / 入参校验；
 *   - `runCandidateSourceContract`：Candidate 4 个来源字段读写的完整往返 + update 越界边界。
 *
 * 🔴 同一批用例也会在**真实 TiDB** 上跑一遍（`scripts/verifyResearchStrategyBridge.mts`）
 * ⇒ 这才构成 006.0 §12 要求的「DB / InMemory 语义一致」证据，而不是「两边各写一套断言」。
 */

import { describe, expect, it } from "vitest";
import { createInMemoryResearchRepositories } from "../../researchCore/repository/inMemory";
import type { ResearchRepositories } from "../../researchCore/repository/contract";
import { createInMemoryStrategyResearchProvenanceRepository } from "./provenance";
import { runCandidateSourceContract, runProvenanceContract } from "./provenanceContract";

const KNOWN_DATASET_VERSION = 42;

function makeRepos(): ResearchRepositories {
  return createInMemoryResearchRepositories({
    datasetVersionExists: async (id) => id === KNOWN_DATASET_VERSION,
    now: () => new Date("2026-09-12T10:00:00.000Z"),
  });
}

describe("Research → Strategy 溯源仓储（InMemory 契约）", () => {
  it("全部契约用例通过", async () => {
    const repo = createInMemoryStrategyResearchProvenanceRepository({
      now: () => new Date("2026-09-12T10:00:00.000Z"),
    });
    const checks = await runProvenanceContract(repo);
    const failed = checks.filter((c) => !c.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(8);
  });

  it("DIRECT / INHERITED 两种 origin 都被覆盖到", async () => {
    const repo = createInMemoryStrategyResearchProvenanceRepository();
    const checks = await runProvenanceContract(repo);
    const names = checks.map((c) => c.name).join(" | ");
    expect(names).toContain("DIRECT");
    expect(names).toContain("INHERITED");
  });
});

describe("Candidate 来源快照字段（InMemory 契约）", () => {
  it("全部契约用例通过（含自建自清）", async () => {
    const repos = makeRepos();
    const experiment = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "0061-experiment",
      researchType: "CONDITIONAL",
    });
    const conclusion = await repos.conclusions.create({
      experimentId: experiment.id as number,
      conclusionType: "SUPPORTED",
      title: "首板回踩不破开盘价",
      conclusion: "回踩不破组未来收益分布与跌破组存在方向性差异",
      status: "DRAFT",
    });
    const checks = await runCandidateSourceContract(repos, {
      experimentId: experiment.id as number,
      conclusionId: conclusion.id as number,
    });
    const failed = checks.filter((c) => !c.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(6);
  });

  it("自建自清：契约结束后该实验下无残留候选", async () => {
    const repos = makeRepos();
    const experiment = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "0061-experiment-2",
      researchType: "CONDITIONAL",
    });
    await runCandidateSourceContract(repos, {
      experimentId: experiment.id as number,
      conclusionId: null,
    });
    expect(await repos.candidates.list({ experimentId: experiment.id as number })).toEqual([]);
  });
});
