/**
 * RESEARCH-EXPERIMENT-001 · tRPC 端点测试
 *
 * 覆盖三件事：
 *   1. **注册守卫** —— `appRouter` 上确实挂了 `researchExperiments.*` 四个端点
 *      （漏挂 = 前端恒 404 而页面不报错，这类「静默退化」必须由测试挡住）；
 *   2. **鉴权** —— 读端点公开、`run` 必须 admin（未登录 / 非管理员 `FORBIDDEN`）；
 *   3. **领域码过 tRPC 边界** —— 失败时 message 里带 `[CODE]`，前端既有
 *      `readRpcDomainCode` 可直接抠码（不新造第二套协议）。
 *
 * 用 `buildResearchExperimentsRouter` + 内存数据面，**不连真库**。
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NOT_ADMIN_ERR_MSG } from "@shared/const";
import { appRouter } from "../../../server/routers";
import type { ExperimentDefinition } from "@shared/researchExperimentsContracts";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
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
  return buildResearchExperimentsRouter({
    runner: createExperimentRunner({ registry, datasetPort }),
    datasetPort,
  });
}

const adminCaller = buildRouter().createCaller({ req: {} as never, res: {} as never, user: adminUser });
const anonCaller = buildRouter().createCaller({ req: {} as never, res: {} as never, user: null });

describe("appRouter 注册守卫", () => {
  it("researchExperiments 四个端点已挂载（漏挂 = 前端恒 404 且页面不报错）", () => {
    const keys = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);
    expect(keys).toContain("researchExperiments.list");
    expect(keys).toContain("researchExperiments.get");
    expect(keys).toContain("researchExperiments.listDatasetVersions");
    expect(keys).toContain("researchExperiments.run");
  });
});

describe("读端点（公开）", () => {
  it("list 返回描述符（含参数定义与 Dataset 声明）", async () => {
    const rows = await adminCaller.list({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("demo/router");
    expect(rows[0]!.parameters[0]!.code).toBe("n");
    expect(rows[0]!.datasetRequirement.requiredColumns.events).toEqual(["isFirstLimit"]);
  });

  it("list 可按 datasetCode 过滤", async () => {
    expect(await adminCaller.list({ datasetCode: "first_limit_pullback" })).toHaveLength(1);
    expect(await adminCaller.list({ datasetCode: "other_dataset" })).toHaveLength(0);
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
});

describe("run 端点（admin）", () => {
  it("未登录 / 非管理员一律 FORBIDDEN（鉴权在 resolver 之前）", async () => {
    // 断言「与项目既有的 FORBIDDEN 文案一致」，而不是自己编一个字面量：
    // 文案来源 = `@shared/const#NOT_ADMIN_ERR_MSG`（`adminProcedure` 用的就是它）。
    await expect(
      anonCaller.run({ experimentId: "demo/router", datasetVersionId: VERSION_ID }),
    ).rejects.toThrowError(NOT_ADMIN_ERR_MSG);
  });

  it("admin 执行成功 ⇒ SUCCEEDED + 结果信封 + 执行元数据", async () => {
    const outcome = await adminCaller.run({
      experimentId: "demo/router",
      datasetVersionId: VERSION_ID,
      parameters: { n: 3 },
    });
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
