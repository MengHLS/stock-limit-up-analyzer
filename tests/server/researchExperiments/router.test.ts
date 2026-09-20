/**
 * RESEARCH-EXPERIMENT-001 / 004 · tRPC 端点测试
 *
 * 覆盖四件事：
 *   1. **注册守卫** —— `appRouter` 上确实挂了 `researchExperiments.*` 全部端点
 *      （漏挂 = 前端恒 404 而页面不报错，这类「静默退化」必须由测试挡住）；
 *   2. **鉴权** —— 读端点公开、`run` / `reconcileRun` 必须 admin（未登录 / 非管理员 `FORBIDDEN`）；
 *   3. **领域码过 tRPC 边界** —— 失败时 message 里带 `[CODE]`，前端既有
 *      `readRpcDomainCode` 可直接抠码（不新造第二套协议）；
 *   4. **004 的返回面加宽**（`list` → 摘要、`get` → 详情、`run` → 执行 + 持久化坐标）
 *      **没有另开同义端点** —— 这一条也由注册守卫钉住。
 *
 * 用 `buildResearchExperimentsRouter` + 内存数据面（含内存 Run 仓储 / 内存对象存储），
 * **不连真库、不连 MinIO**。
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NOT_ADMIN_ERR_MSG } from "@shared/const";
import { appRouter } from "../../../server/routers";
import type { ExperimentDefinition } from "@shared/researchExperimentsContracts";
import { InMemoryArtifactStorage } from "../../../server/artifactStorage";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import {
  InMemoryExperimentRunRepository,
  createExperimentRunService,
} from "../../../server/researchExperiments/persistence";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { buildResearchExperimentsRouter } from "../../../server/researchExperiments/router";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";

const VERSION_ID = 900_200;

const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 120001,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-router",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-06-30",
  totalEvents: 1,
  horizons: [5],
  pathRelativeDayRange: { min: 1, max: 5 },
  postRelativeDayRange: { min: 1, max: 5 },
  decisionOffsetDays: null,
};

const definition: ExperimentDefinition = {
  descriptor: {
    id: "demo/router",
    name: "Router 测试实验",
    version: "1.0.0",
    description: "演示",
    source: "test",
    parameters: [{ code: "n", label: "数量", kind: "INT", required: false, defaultValue: 2 }],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: { events: ["isFirstLimit"] },
      prefixRelativeDays: [0],
      postRelativeDays: [],
      decisionOffsetDays: null,
      usesForwardData: false,
    },
    pageKey: "demo/router",
    pageTitle: "Router 测试实验",
  },
  resultSchema: z.object({ ok: z.boolean() }),
  run: () => ({
    sampleSummary: { candidateCount: 1, eligibleCount: 1, excludedCount: 0, excludedByReason: {} },
    customPayload: { ok: true },
  }),
};

const adminUser = {
  id: 1,
  openId: "test-admin",
  name: "test-admin",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function buildRouter() {
  const registry = new ExperimentRegistry();
  registry.register(definition);
  const datasetPort = createRegistryExperimentDatasetPort({
    reader: new InMemoryResearchDatasetReader({ context, events: [], prefixBars: [], postBars: [] }),
    listVersionOptions: async (filter) =>
      filter?.datasetCode === undefined || filter.datasetCode === "first_limit_pullback"
        ? [
            {
              datasetVersionId: VERSION_ID,
              datasetCode: "first_limit_pullback",
              datasetName: "首板回踩",
              version: "v-router",
              status: "READY",
              startDate: "2025-01-01",
              endDate: "2025-06-30",
              totalEvents: 1,
            },
          ]
        : [],
  });
  const runner = createExperimentRunner({ registry, datasetPort });
  // RESEARCH-EXPERIMENT-004：router 现在还要一份 Run 持久化编排（内存替身，不连真库 / 真 MinIO）。
  const runService = createExperimentRunService({
    runner,
    repository: new InMemoryExperimentRunRepository(),
    resolveStorage: () => new InMemoryArtifactStorage(),
  });
  return buildResearchExperimentsRouter({ runner, datasetPort, runService });
}

const adminCaller = buildRouter().createCaller({ req: {} as never, res: {} as never, user: adminUser });
const anonCaller = buildRouter().createCaller({ req: {} as never, res: {} as never, user: null });

describe("appRouter 注册守卫", () => {
  it("researchExperiments 全部端点已挂载（漏挂 = 前端恒 404 且页面不报错）", () => {
    const keys = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);
    // 001 既有 4 个（004 只加宽它们的返回面，**没有**另开同义端点）
    expect(keys).toContain("researchExperiments.list");
    expect(keys).toContain("researchExperiments.get");
    expect(keys).toContain("researchExperiments.listDatasetVersions");
    expect(keys).toContain("researchExperiments.run");
    // 004 新增 5 个（规格 §14 的 Run 查询面）
    expect(keys).toContain("researchExperiments.listRuns");
    expect(keys).toContain("researchExperiments.getRun");
    expect(keys).toContain("researchExperiments.getRunResultManifest");
    expect(keys).toContain("researchExperiments.getArtifactMetadata");
    expect(keys).toContain("researchExperiments.reconcileRun");
    // 反面：不许出现第二套同义端点（历史上「两套并存」是本仓库的重灾区）。
    for (const forbidden of [
      "researchExperiments.listExperiments",
      "researchExperiments.getExperiment",
      "researchExperiments.getExperimentRun",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("读端点（公开）", () => {
  it("list 返回**摘要**（描述符 + Run 数 + 最近 Run；未运行 ⇒ runCount=0 / latestRun=null）", async () => {
    const rows = await adminCaller.list({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.descriptor.id).toBe("demo/router");
    expect(rows[0]!.descriptor.parameters[0]!.code).toBe("n");
    expect(rows[0]!.descriptor.datasetRequirement.requiredColumns.events).toEqual(["isFirstLimit"]);
    expect(rows[0]!.runCount).toBe(0);
    expect(rows[0]!.latestRun).toBeNull();
    expect(rows[0]!.runsAvailable).toBe(true);
    expect(rows[0]!.runsError).toBeNull();
  });

  it("list 可按 datasetCode 过滤", async () => {
    expect(await adminCaller.list({ datasetCode: "first_limit_pullback" })).toHaveLength(1);
    expect(await adminCaller.list({ datasetCode: "other_dataset" })).toHaveLength(0);
  });

  it("get 返回**详情**（描述符 + 该实验的 Run 列表）", async () => {
    const detail = await adminCaller.get({ experimentId: "demo/router" });
    expect(detail.descriptor.id).toBe("demo/router");
    expect(detail.runs).toEqual([]);
    expect(detail.runsAvailable).toBe(true);
    expect(detail.runsError).toBeNull();
  });

  it("get 未注册实验 ⇒ NOT_FOUND 且 message 带 [EXPERIMENT_NOT_FOUND]（前端可抠码）", async () => {
    await expect(adminCaller.get({ experimentId: "no/such" })).rejects.toThrowError(
      /\[EXPERIMENT_NOT_FOUND\]/u,
    );
  });

  it("listDatasetVersions 返回只读版本目录", async () => {
    const options = await adminCaller.listDatasetVersions({ datasetCode: "first_limit_pullback" });
    expect(options).toHaveLength(1);
    expect(options[0]!.datasetVersionId).toBe(VERSION_ID);
    expect(options[0]!.status).toBe("READY");
  });

  it("getRun 未知 runId ⇒ NOT_FOUND 且 message 带 [EXPERIMENT_RUN_NOT_FOUND]", async () => {
    await expect(adminCaller.getRun({ runId: "RUN-NOPE" })).rejects.toThrowError(
      /\[EXPERIMENT_RUN_NOT_FOUND\]/u,
    );
    await expect(adminCaller.getRunResultManifest({ runId: "RUN-NOPE" })).rejects.toThrowError(
      /\[EXPERIMENT_RUN_NOT_FOUND\]/u,
    );
  });
});

describe("run 端点（admin）", () => {
  it("未登录 / 非管理员一律 FORBIDDEN（鉴权在 resolver 之前）", async () => {
    // 断言「与项目既有的 FORBIDDEN 文案一致」，而不是自己编一个字面量：
    // 文案来源 = `@shared/const#NOT_ADMIN_ERR_MSG`（`adminProcedure` 用的就是它）。
    await expect(
      anonCaller.run({ experimentId: "demo/router", datasetVersionId: VERSION_ID }),
    ).rejects.toThrowError(NOT_ADMIN_ERR_MSG);
    await expect(anonCaller.reconcileRun({ runId: "RUN-X", reason: "r" })).rejects.toThrowError(
      NOT_ADMIN_ERR_MSG,
    );
  });

  it("admin 执行成功 ⇒ **已持久化** + Run=COMPLETED + manifest 引用 + 完整 outcome", async () => {
    const execution = await adminCaller.run({
      experimentId: "demo/router",
      datasetVersionId: VERSION_ID,
      parameters: { n: 3 },
    });
    expect(execution.persisted).toBe(true);
    expect(execution.run?.status).toBe("COMPLETED");
    expect(execution.run?.resultManifestKey).toMatch(/\/manifest\.json$/u);
    expect(execution.run?.summary?.candidateCount).toBe(1);
    // outcome 仍然是 001 的那份事实（执行元数据没被 004 改写）
    const outcome = execution.outcome;
    expect(outcome.runStatus).toBe("SUCCEEDED");
    expect(outcome.result?.customPayload).toEqual({ ok: true });
    expect(outcome.execution.resolvedParameters).toEqual({ n: 3 });
    expect(outcome.execution.datasetFacts.datasetVersionId).toBe(VERSION_ID);
    expect(outcome.execution.datasetFacts.decisionOffsetDays).toBeNull();
    expect(outcome.execution.datasetFacts.forwardDataRead).toBe(false);
  });

  it("参数非法 ⇒ BAD_REQUEST 且 message 带 [EXPERIMENT_PARAMETER_INVALID]", async () => {
    await expect(
      adminCaller.run({ experimentId: "demo/router", datasetVersionId: VERSION_ID, parameters: { nope: 1 } }),
    ).rejects.toThrowError(/\[EXPERIMENT_PARAMETER_INVALID\]/u);
  });

  it("未知 Dataset 版本 ⇒ NOT_FOUND 且 message 带 [EXPERIMENT_DATASET_VERSION_NOT_FOUND]", async () => {
    await expect(
      adminCaller.run({ experimentId: "demo/router", datasetVersionId: 1 }),
    ).rejects.toThrowError(/\[EXPERIMENT_DATASET_VERSION_NOT_FOUND\]/u);
  });
});

/**
 * 用一次真实执行把「写 → 读」这条面走一遍。
 *
 * 刻意用**局部** router 实例（不依赖上面那些测试的执行顺序）—— 模块级 caller 共享内存仓储，
 * 让测试之间产生隐式顺序依赖是这一组最不该有的脆弱性。
 */
describe("004 · Run 查询面（写一次 → 走 tRPC 读回来）", () => {
  async function runOnce(storageOptions?: { unavailable?: boolean }) {
    const registry = new ExperimentRegistry();
    registry.register(definition);
    const datasetPort = createRegistryExperimentDatasetPort({
      reader: new InMemoryResearchDatasetReader({ context, events: [], prefixBars: [], postBars: [] }),
      listVersionOptions: async () => [],
    });
    const runner = createExperimentRunner({ registry, datasetPort });
    const storage = new InMemoryArtifactStorage(storageOptions);
    const built = buildResearchExperimentsRouter({
      runner,
      datasetPort,
      runService: createExperimentRunService({
        runner,
        repository: new InMemoryExperimentRunRepository(),
        resolveStorage: () => storage,
      }),
    });
    const caller = built.createCaller({
      req: {} as never,
      res: {} as never,
      user: adminUser,
    });
    return { caller, storage };
  }

  it("listRuns / getRun / getRunResultManifest / getArtifactMetadata 串起来可用", async () => {
    const { caller } = await runOnce();
    const execution = await caller.run({
      experimentId: "demo/router",
      datasetVersionId: VERSION_ID,
      parameters: { n: 4 },
    });
    const runId = execution.run!.runId;

    const runs = await caller.listRuns({ experimentId: "demo/router" });
    expect(runs.map((r) => r.runId)).toEqual([runId]);
    expect(runs[0]!.status).toBe("COMPLETED");
    expect(runs[0]!.stale).toBe(false);

    const detail = await caller.getRun({ runId });
    expect(detail.run.runId).toBe(runId);
    expect(detail.artifactsAvailable).toBe(true);
    expect(detail.manifest?.runId).toBe(runId);
    expect(detail.result?.customPayload).toEqual({ ok: true });
    expect(detail.artifacts.length).toBeGreaterThan(0);
    expect(detail.artifacts.every((item) => item.present)).toBe(true);

    const manifest = await caller.getRunResultManifest({ runId });
    expect(manifest?.experimentCode).toBe("demo/router");
    expect(manifest?.result?.key).toBeTruthy();

    const metadata = await caller.getArtifactMetadata({ runId, key: manifest!.result!.key });
    expect(metadata.present).toBe(true);
    expect(metadata.inlineViewable).toBe(true);
    expect(metadata.ref.kind).toBe("RESULT");

    // 不在 Manifest 里的 Key ⇒ NOT_FOUND（下载白名单）
    await expect(
      caller.getArtifactMetadata({ runId, key: "experiments/demo/router/runs/NOPE/x.json" }),
    ).rejects.toThrowError(/\[EXPERIMENT_ARTIFACT_NOT_FOUND\]/u);
  });

  it("getRun 的「最新 Run」也会反映在 list 摘要里（页面列表列的来源）", async () => {
    const { caller } = await runOnce();
    await caller.run({ experimentId: "demo/router", datasetVersionId: VERSION_ID });
    const summaries = await caller.list({});
    expect(summaries[0]!.runCount).toBe(1);
    expect(summaries[0]!.latestRun?.status).toBe("COMPLETED");
    expect(summaries[0]!.runsAvailable).toBe(true);
  });

  it("reconcileRun：非 RUNNING 的 Run ⇒ BAD_REQUEST + [EXPERIMENT_RUN_STATE_INVALID]", async () => {
    const { caller } = await runOnce();
    const execution = await caller.run({
      experimentId: "demo/router",
      datasetVersionId: VERSION_ID,
    });
    await expect(
      caller.reconcileRun({ runId: execution.run!.runId, reason: "不该成功" }),
    ).rejects.toThrowError(/\[EXPERIMENT_RUN_STATE_INVALID\]/u);
  });

  it("对象存储不可用 ⇒ 返回**请求成功但 Run=FAILED**（不伪装成成功，也不抛 500）", async () => {
    const { caller } = await runOnce({ unavailable: true });
    const execution = await caller.run({
      experimentId: "demo/router",
      datasetVersionId: VERSION_ID,
    });
    // 关键：这是 endpoint 的**正常返回**，不是错误 —— 页面需要同时看到 outcome 与 FAILED 的 Run。
    expect(execution.persisted).toBe(true);
    expect(execution.outcome.runStatus).toBe("SUCCEEDED");
    expect(execution.run?.status).toBe("FAILED");
    expect(execution.run?.errorCode).toBe("EXPERIMENT_ARTIFACT_STORAGE_UNAVAILABLE");
  });
});
