/**
 * RESEARCH-EXPERIMENT-001 · Contract Test
 *
 * 覆盖规格 §17 的「Contract Test」四项：
 *   - metadata：描述符自洽性（id 形态 / 参数定义 / Dataset 声明）
 *   - parameter validation：参数校验 + 默认值归并
 *   - dataset validation：Dataset 需求与版本准入
 *   - result validation：结果信封 + 样本账 + 自定义 schema
 *
 * 本文件只碰**纯逻辑**（registry / runner 的参数与结果校验），不连真库。
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ExperimentDescriptor } from "@shared/researchExperimentsContracts";
import { ExperimentError } from "../../../server/researchExperiments/errors";
import { ExperimentRegistry, validateExperimentDescriptor } from "../../../server/researchExperiments/registry";
import {
  resolveExperimentParameters,
  validateExperimentResultEnvelope,
} from "../../../server/researchExperiments/runner";
import type { ExperimentDefinition } from "@shared/researchExperimentsContracts";

/** 一份「合法」的基线描述符；各用例只改它的一处。 */
function baseDescriptor(overrides: Partial<ExperimentDescriptor> = {}): ExperimentDescriptor {
  return {
    id: "demo/params",
    name: "演示",
    version: "1.0.0",
    description: "演示用",
    source: "test",
    parameters: [
      {
        code: "n",
        label: "数量",
        kind: "INT",
        required: false,
        defaultValue: 10,
        bounds: { min: 1, max: 100 },
      },
    ],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: { events: ["isFirstLimit"] },
      prefixRelativeDays: [0],
      postRelativeDays: [],
      decisionOffsetDays: null,
      usesForwardData: false,
    },
    pageKey: "demo/params",
    pageTitle: "演示",
    ...overrides,
  };
}

function definitionOf(descriptor: ExperimentDescriptor): ExperimentDefinition {
  return {
    descriptor,
    resultSchema: z.unknown(),
    run: () => ({
      sampleSummary: {
        candidateCount: 0,
        eligibleCount: 0,
        excludedCount: 0,
        excludedByReason: {},
      },
    }),
  };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`期望抛出 ${code}，但没有抛出`);
  } catch (error) {
    expect(error).toBeInstanceOf(ExperimentError);
    expect((error as ExperimentError).code).toBe(code);
  }
}

describe("Contract · 元数据校验", () => {
  it("合法描述符通过", () => {
    expect(() => validateExperimentDescriptor(baseDescriptor())).not.toThrow();
  });

  it("id 形态非法（缺组名 / 大写 / 三段）被拒", () => {
    for (const id of ["demo", "Demo/params", "a/B", "a/b/c", "a//b", "-x/y"]) {
      expectCode(
        () => validateExperimentDescriptor(baseDescriptor({ id })),
        "EXPERIMENT_METADATA_INVALID",
      );
    }
  });

  it("参数 code 重复被拒（重复会让默认值归并静默丢项）", () => {
    expectCode(
      () =>
        validateExperimentDescriptor(
          baseDescriptor({
            parameters: [
              { code: "n", label: "A", kind: "INT", defaultValue: 1 },
              { code: "n", label: "B", kind: "INT", defaultValue: 2 },
            ],
          }),
        ),
      "EXPERIMENT_METADATA_INVALID",
    );
  });

  it("非必填参数缺 defaultValue 被拒（避免运行时出现「没有值的参数」）", () => {
    expectCode(
      () =>
        validateExperimentDescriptor(
          baseDescriptor({ parameters: [{ code: "n", label: "A", kind: "INT" }] }),
        ),
      "EXPERIMENT_METADATA_INVALID",
    );
  });

  it("ENUM 无 allowedValues / 默认值不在枚举内 / 非 ENUM 声明枚举 都被拒", () => {
    expectCode(
      () =>
        validateExperimentDescriptor(
          baseDescriptor({ parameters: [{ code: "k", label: "A", kind: "ENUM", defaultValue: "x" }] }),
        ),
      "EXPERIMENT_METADATA_INVALID",
    );
    expectCode(
      () =>
        validateExperimentDescriptor(
          baseDescriptor({
            parameters: [
              { code: "k", label: "A", kind: "ENUM", defaultValue: "z", allowedValues: ["x", "y"] },
            ],
          }),
        ),
      "EXPERIMENT_METADATA_INVALID",
    );
    expectCode(
      () =>
        validateExperimentDescriptor(
          baseDescriptor({
            parameters: [{ code: "k", label: "A", kind: "INT", defaultValue: 1, allowedValues: ["x"] }],
          }),
        ),
      "EXPERIMENT_METADATA_INVALID",
    );
  });

  it("bounds.min > bounds.max 被拒", () => {
    expectCode(
      () =>
        validateExperimentDescriptor(
          baseDescriptor({
            parameters: [
              { code: "n", label: "A", kind: "INT", defaultValue: 5, bounds: { min: 10, max: 1 } },
            ],
          }),
        ),
      "EXPERIMENT_METADATA_INVALID",
    );
  });

  it("datasetCode 不合规范被拒（复用 Dataset 域命名正则）", () => {
    expectCode(
      () =>
        validateExperimentDescriptor(
          baseDescriptor({
            datasetRequirement: {
              ...baseDescriptor().datasetRequirement,
              datasetCode: "First-Limit",
            },
          }),
        ),
      "EXPERIMENT_METADATA_INVALID",
    );
  });

  it("相对日方向写反被拒（prefix > 0 / post < 1）", () => {
    const req = baseDescriptor().datasetRequirement;
    expectCode(
      () =>
        validateExperimentDescriptor(
          baseDescriptor({ datasetRequirement: { ...req, prefixRelativeDays: [1] } }),
        ),
      "EXPERIMENT_METADATA_INVALID",
    );
    expectCode(
      () =>
        validateExperimentDescriptor(
          baseDescriptor({
            datasetRequirement: { ...req, postRelativeDays: [0], usesForwardData: true },
          }),
        ),
      "EXPERIMENT_METADATA_INVALID",
    );
  });

  it("声明了 post 相对日却没声明 usesForwardData ⇒ 被拒（堵「偷偷读未来数据」）", () => {
    expectCode(
      () =>
        validateExperimentDescriptor(
          baseDescriptor({
            datasetRequirement: {
              ...baseDescriptor().datasetRequirement,
              postRelativeDays: [1, 2],
              usesForwardData: false,
            },
          }),
        ),
      "EXPERIMENT_METADATA_INVALID",
    );
  });

  it("usesForwardData=true 却没写用途 ⇒ 被拒", () => {
    expectCode(
      () =>
        validateExperimentDescriptor(
          baseDescriptor({
            datasetRequirement: {
              ...baseDescriptor().datasetRequirement,
              postRelativeDays: [1],
              usesForwardData: true,
            },
          }),
        ),
      "EXPERIMENT_METADATA_INVALID",
    );
  });

  it("一个列都没声明 ⇒ 被拒（不读数据的实验多半是写错了）", () => {
    expectCode(
      () =>
        validateExperimentDescriptor(
          baseDescriptor({
            datasetRequirement: {
              ...baseDescriptor().datasetRequirement,
              requiredColumns: {},
            },
          }),
        ),
      "EXPERIMENT_METADATA_INVALID",
    );
  });
});

describe("Contract · 注册表", () => {
  it("注册 / 查询 / 列表 / 未注册即抛", () => {
    const registry = new ExperimentRegistry();
    registry.register(definitionOf(baseDescriptor({ id: "b/two" })));
    registry.register(definitionOf(baseDescriptor({ id: "a/one" })));

    expect(registry.has("a/one")).toBe(true);
    expect(registry.has("a/three")).toBe(false);
    expect(registry.get("a/one")?.descriptor.name).toBe("演示");
    // 排序稳定（按 id 字典序）
    expect(registry.listIds()).toEqual(["a/one", "b/two"]);
    expectCode(() => registry.require("a/three"), "EXPERIMENT_NOT_FOUND");
  });

  it("重复注册被具名拒绝（不静默覆盖）", () => {
    const registry = new ExperimentRegistry();
    registry.register(definitionOf(baseDescriptor({ id: "a/one" })));
    expectCode(
      () => registry.register(definitionOf(baseDescriptor({ id: "a/one" }))),
      "EXPERIMENT_METADATA_INVALID",
    );
  });

  it("run() 不是函数 ⇒ 注册失败", () => {
    const registry = new ExperimentRegistry();
    expectCode(
      () =>
        registry.register({
          descriptor: baseDescriptor({ id: "a/one" }),
          resultSchema: z.unknown(),
          run: undefined as never,
        }),
      "EXPERIMENT_METADATA_INVALID",
    );
  });

  it("注册时即校验元数据（不合规的进不来）", () => {
    const registry = new ExperimentRegistry();
    expectCode(
      () => registry.register(definitionOf(baseDescriptor({ id: "BAD ID" }))),
      "EXPERIMENT_METADATA_INVALID",
    );
    expect(registry.listIds()).toEqual([]);
  });
});

describe("Contract · 参数校验与默认值归并", () => {
  const descriptor = baseDescriptor({
    parameters: [
      {
        code: "n",
        label: "数量",
        kind: "INT",
        required: false,
        defaultValue: 10,
        bounds: { min: 1, max: 100 },
      },
      {
        code: "ratio",
        label: "比例",
        kind: "NUMBER",
        required: false,
        defaultValue: 1.5,
        bounds: { min: 0, max: 3 },
      },
      { code: "flag", label: "开关", kind: "BOOLEAN", required: false, defaultValue: false },
      {
        code: "mode",
        label: "模式",
        kind: "ENUM",
        required: false,
        defaultValue: "a",
        allowedValues: ["a", "b"],
      },
      {
        code: "days",
        label: "日集合",
        kind: "INT_LIST",
        required: false,
        defaultValue: [1, 2],
        bounds: { min: 1, max: 5 },
      },
      { code: "must", label: "必填", kind: "INT", required: true },
    ],
  });

  it("全缺省 ⇒ 用 defaultValue 归并；必填缺失即拒", () => {
    expectCode(() => resolveExperimentParameters(descriptor, {}), "EXPERIMENT_PARAMETER_INVALID");
    const resolved = resolveExperimentParameters(descriptor, { must: 7 });
    expect(resolved).toEqual({ n: 10, ratio: 1.5, flag: false, mode: "a", days: [1, 2], must: 7 });
  });

  it("未知参数键被拒（打错参数名不该静默无效）", () => {
    expectCode(
      () => resolveExperimentParameters(descriptor, { must: 1, nope: 3 }),
      "EXPERIMENT_PARAMETER_INVALID",
    );
  });

  it("类型 / 越界 / 枚举外 / 空数组 一律拒绝且**不夹取**", () => {
    expectCode(() => resolveExperimentParameters(descriptor, { must: 1, n: 1.5 }), "EXPERIMENT_PARAMETER_INVALID");
    expectCode(() => resolveExperimentParameters(descriptor, { must: 1, n: 0 }), "EXPERIMENT_PARAMETER_INVALID");
    expectCode(() => resolveExperimentParameters(descriptor, { must: 1, n: 101 }), "EXPERIMENT_PARAMETER_INVALID");
    expectCode(() => resolveExperimentParameters(descriptor, { must: 1, ratio: 9 }), "EXPERIMENT_PARAMETER_INVALID");
    expectCode(() => resolveExperimentParameters(descriptor, { must: 1, flag: "yes" }), "EXPERIMENT_PARAMETER_INVALID");
    expectCode(() => resolveExperimentParameters(descriptor, { must: 1, mode: "c" }), "EXPERIMENT_PARAMETER_INVALID");
    expectCode(() => resolveExperimentParameters(descriptor, { must: 1, days: [] }), "EXPERIMENT_PARAMETER_INVALID");
    expectCode(() => resolveExperimentParameters(descriptor, { must: 1, days: [1, 9] }), "EXPERIMENT_PARAMETER_INVALID");
    expectCode(
      () => resolveExperimentParameters(descriptor, { must: 1, days: [1, 1.5] }),
      "EXPERIMENT_PARAMETER_INVALID",
    );
  });

  it("显式传值优先于默认值（且不丢失其它默认值）", () => {
    const resolved = resolveExperimentParameters(descriptor, { must: 3, n: 55, mode: "b" });
    expect(resolved.n).toBe(55);
    expect(resolved.mode).toBe("b");
    expect(resolved.ratio).toBe(1.5);
  });
});

describe("Contract · 结果校验", () => {
  function envelope(overrides: Record<string, unknown> = {}) {
    return {
      metadata: {
        experimentId: "demo/params",
        experimentName: "演示",
        experimentVersion: "1.0.0",
        datasetVersionId: 1,
        datasetCode: "first_limit_pullback",
        datasetVersionLabel: "v1",
        datasetStartDate: "2024-01-01",
        datasetEndDate: "2024-12-31",
        computationVersion: "1.0.0",
      },
      parameters: { n: 10 },
      sampleSummary: {
        candidateCount: 10,
        eligibleCount: 7,
        excludedCount: 3,
        excludedByReason: { A: 2, B: 1 },
      },
      ...overrides,
    };
  }

  it("合法信封通过", () => {
    expect(() => validateExperimentResultEnvelope(envelope() as never, "demo/params")).not.toThrow();
  });

  it("样本账不平 ⇒ EXPERIMENT_RESULT_INVALID（eligible + excluded ≠ candidate）", () => {
    try {
      validateExperimentResultEnvelope(
        envelope({
          sampleSummary: { candidateCount: 10, eligibleCount: 7, excludedCount: 1, excludedByReason: { A: 1 } },
        }) as never,
        "demo/params",
      );
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as ExperimentError).code).toBe("EXPERIMENT_RESULT_INVALID");
      expect((error as ExperimentError).message).toContain("样本账不平");
    }
  });

  it("剔除原因合计 ≠ excludedCount ⇒ EXPERIMENT_RESULT_INVALID（否则样本为何变少无从诊断）", () => {
    try {
      validateExperimentResultEnvelope(
        envelope({
          sampleSummary: { candidateCount: 10, eligibleCount: 7, excludedCount: 3, excludedByReason: { A: 1 } },
        }) as never,
        "demo/params",
      );
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as ExperimentError).code).toBe("EXPERIMENT_RESULT_INVALID");
      expect((error as ExperimentError).message).toContain("剔除原因合计");
    }
  });

  it("形状不符（缺 metadata / 类型错）⇒ EXPERIMENT_RESULT_INVALID", () => {
    expectCode(
      () => validateExperimentResultEnvelope({ parameters: {} } as never, "demo/params"),
      "EXPERIMENT_RESULT_INVALID",
    );
    expectCode(
      () =>
        validateExperimentResultEnvelope(
          envelope({ statistics: [{ code: "x", label: "y", value: "not-a-number" }] }) as never,
          "demo/params",
        ),
      "EXPERIMENT_RESULT_INVALID",
    );
  });
});
