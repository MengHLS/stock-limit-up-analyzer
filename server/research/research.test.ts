/**
 * STEP 6.1 — Strategy Research Contract + Experiment 基础模型 测试。
 *
 * 覆盖：Strategy Contract / Parameter / Experiment / Serialization / Registry / Determinism / Identity / Adapter。
 */

import { describe, expect, it } from "vitest";
import {
  buildLeaderCandidateBaselineResearchDefinition,
  createExperiment,
  createExperimentSnapshot,
  deserializeResearchExperiment,
  deserializeResearchExperimentSnapshot,
  deserializeResearchStrategyDefinition,
  formatExperimentId,
  generateExperimentId,
  isExperimentIdFormat,
  normalizeStrategyKey,
  parseStrategyKey,
  ResearchStrategyRegistry,
  ResearchValidationError,
  resolveParameterSet,
  serializeResearchExperiment,
  serializeResearchExperimentSnapshot,
  serializeResearchStrategyDefinition,
  toExperimentSnapshot,
  validateParameterSchema,
  validateParameterSet,
  validateResearchExperiment,
  validateStrategyDefinition,
  type ResearchBacktestConfig,
  type ResearchDatasetSpec,
  type ResearchExperiment,
  type ResearchParameterSchema,
  type ResearchStrategyDefinition,
} from "./index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validSchema: ResearchParameterSchema = {
  parameters: [
    { name: "minScore", type: "number", required: false, nullable: true, defaultValue: null },
    { name: "maxSignals", type: "number", required: true, min: 1, max: 100, step: 1 },
    { name: "featureMode", type: "string", required: false, defaultValue: "off", allowedValues: ["off", "limit-up-confirm"] },
    { name: "verbose", type: "boolean", required: false, defaultValue: false },
  ],
};

const validDataset: ResearchDatasetSpec = {
  startDate: "2026-01-01",
  endDate: "2026-06-30",
  universe: "limit-up",
};

const validBacktest: ResearchBacktestConfig = {
  initialCapital: 100_000,
  commissionRate: 0.0003,
  slippageRate: 0.001,
  maxPositions: 5,
  lotSize: 100,
  executionModel: "next-open",
};

const validStrategyDefinition: ResearchStrategyDefinition = {
  strategyId: "leader-candidate-baseline",
  version: "1.0.0",
  name: "龙头候选原始评分",
  requiredFeatures: ["limitUpHit"],
  requiredData: ["leaderCandidateDataView"],
  decisionPoint: "close",
  parameterSchema: validSchema,
};

const validSnapshotInput = {
  experimentId: "EXP-20260906-ABC12345",
  strategyId: "leader-candidate-baseline",
  strategyVersion: "1.0.0",
  parameterSet: { maxSignals: 5, minScore: null },
  dataset: validDataset,
  featureConfig: { featureMode: "limit-up-confirm", requiredFeatures: ["limitUpHit"] },
  backtestConfig: validBacktest,
};

// ---------------------------------------------------------------------------
// 1. Strategy Research Contract
// ---------------------------------------------------------------------------

describe("Strategy Research Contract", () => {
  it("strategyId / version / requiredFeatures / requiredData / decisionPoint 正常", () => {
    const result = validateStrategyDefinition(validStrategyDefinition);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("strategyId 必填（空则 REJECT）", () => {
    const result = validateStrategyDefinition({ ...validStrategyDefinition, strategyId: "" });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "STRATEGY_ID_EMPTY")).toBe(true);
  });

  it("version 必填（空则 REJECT）", () => {
    const result = validateStrategyDefinition({ ...validStrategyDefinition, version: "   " });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "STRATEGY_VERSION_EMPTY")).toBe(true);
  });

  it("requiredFeatures / requiredData 必须是字符串数组", () => {
    expect(validateStrategyDefinition({ ...validStrategyDefinition, requiredFeatures: [""] }).valid).toBe(false);
    expect(validateStrategyDefinition({ ...validStrategyDefinition, requiredData: "x" as unknown as string[] }).valid).toBe(false);
  });

  it("decisionPoint 必须是 open 或 close", () => {
    expect(validateStrategyDefinition({ ...validStrategyDefinition, decisionPoint: "intraday" as "close" }).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Parameter Contract
// ---------------------------------------------------------------------------

describe("Parameter Contract", () => {
  it("number / string / boolean 合法值全部通过", () => {
    const schema: ResearchParameterSchema = {
      parameters: [
        { name: "num", type: "number", required: true },
        { name: "str", type: "string", required: true },
        { name: "flag", type: "boolean", required: true },
      ],
    };
    expect(validateParameterSet({ num: 1.5, str: "x", flag: true }, schema).valid).toBe(true);
  });

  it("required 缺失 REJECT", () => {
    const result = validateParameterSet({ minScore: null }, validSchema);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "REQUIRED_PARAM_MISSING")).toBe(true);
  });

  it("optional 缺失 + default 应用", () => {
    const resolved = resolveParameterSet({ maxSignals: 3 }, validSchema);
    expect(resolved).toEqual({ maxSignals: 3, minScore: null, featureMode: "off", verbose: false });
  });

  it("number 有限数字（NaN / Infinity REJECT）", () => {
    expect(validateParameterSet({ maxSignals: Number.NaN }, validSchema).valid).toBe(false);
    expect(validateParameterSet({ maxSignals: Number.POSITIVE_INFINITY }, validSchema).valid).toBe(false);
  });

  it("min / max 越界 REJECT", () => {
    expect(validateParameterSet({ maxSignals: 0 }, validSchema).valid).toBe(false); // < min 1
    expect(validateParameterSet({ maxSignals: 101 }, validSchema).valid).toBe(false); // > max 100
  });

  it("schema min>max / step<=0 REJECT", () => {
    expect(validateParameterSchema({ parameters: [{ name: "a", type: "number", required: false, min: 5, max: 1 }] }).valid).toBe(false);
    expect(validateParameterSchema({ parameters: [{ name: "a", type: "number", required: false, step: 0 }] }).valid).toBe(false);
  });

  it("defaultValue 必须满足自身 schema", () => {
    const badDefault = { parameters: [{ name: "a", type: "number", required: false, min: 0, max: 10, defaultValue: 99 }] };
    expect(validateParameterSchema(badDefault).valid).toBe(false);
  });

  it("禁止隐式类型转换（number 传字符串 REJECT）", () => {
    const result = validateParameterSet({ maxSignals: "5" as unknown as number }, validSchema);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "VALUE_TYPE_MISMATCH")).toBe(true);
  });

  it("未知参数 REJECT", () => {
    const result = validateParameterSet({ maxSignals: 3, bogus: 1 }, validSchema);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "UNKNOWN_PARAM")).toBe(true);
  });

  it("null 仅 nullable 参数允许", () => {
    expect(validateParameterSet({ maxSignals: 3, minScore: null }, validSchema).valid).toBe(true);
    expect(validateParameterSet({ maxSignals: null as unknown as number }, validSchema).valid).toBe(false);
  });

  it("参数名唯一（重复 REJECT）", () => {
    const dup = { parameters: [{ name: "a", type: "number" as const, required: false }, { name: "a", type: "number" as const, required: false }] };
    expect(validateParameterSchema(dup).valid).toBe(false);
  });

  it("string allowedValues 生效", () => {
    const result = validateParameterSet({ maxSignals: 3, featureMode: "bogus" }, validSchema);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "VALUE_NOT_ALLOWED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Experiment Contract
// ---------------------------------------------------------------------------

describe("Experiment Contract", () => {
  it("合法 Experiment PASS", () => {
    const experiment = createExperiment(
      { ...validSnapshotInput, createdAt: "2026-09-06T00:00:00.000Z" },
      validStrategyDefinition,
    );
    expect(experiment.status).toBe("created");
    expect(experiment.parameterSet).toEqual({ maxSignals: 5, minScore: null, featureMode: "off", verbose: false });
    expect(validateResearchExperiment(experiment, validSchema).valid).toBe(true);
  });

  it("非法 Experiment REJECT（空 strategyId）", () => {
    const experiment: ResearchExperiment = {
      ...validSnapshotInput,
      strategyId: "",
      createdAt: "2026-09-06T00:00:00.000Z",
      status: "created",
    };
    const result = validateResearchExperiment(experiment, validSchema);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "STRATEGY_ID_EMPTY")).toBe(true);
  });

  it("空 version REJECT", () => {
    const experiment: ResearchExperiment = {
      ...validSnapshotInput,
      strategyVersion: "",
      createdAt: "2026-09-06T00:00:00.000Z",
      status: "created",
    };
    expect(validateResearchExperiment(experiment, validSchema).issues.some((issue) => issue.code === "STRATEGY_VERSION_EMPTY")).toBe(true);
  });

  it("日期反转 REJECT", () => {
    const experiment: ResearchExperiment = {
      ...validSnapshotInput,
      dataset: { startDate: "2026-06-30", endDate: "2026-01-01" },
      createdAt: "2026-09-06T00:00:00.000Z",
      status: "created",
    };
    const result = validateResearchExperiment(experiment, validSchema);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "DATASET_DATE_REVERSED")).toBe(true);
  });

  it("空 experimentId REJECT", () => {
    const experiment: ResearchExperiment = { ...validSnapshotInput, experimentId: "", createdAt: "2026-09-06T00:00:00.000Z", status: "created" };
    expect(validateResearchExperiment(experiment, validSchema).issues.some((issue) => issue.code === "EXPERIMENT_ID_EMPTY")).toBe(true);
  });

  it("非法 initialCapital REJECT", () => {
    const experiment: ResearchExperiment = {
      ...validSnapshotInput,
      backtestConfig: { initialCapital: -1 },
      createdAt: "2026-09-06T00:00:00.000Z",
      status: "created",
    };
    expect(validateResearchExperiment(experiment, validSchema).issues.some((issue) => issue.code === "INITIAL_CAPITAL_INVALID")).toBe(true);
  });

  it("createExperiment 校验策略身份与定义一致", () => {
    expect(() => createExperiment({ ...validSnapshotInput, strategyVersion: "2.0.0" }, validStrategyDefinition)).toThrow(/身份不匹配/);
  });

  it("createExperiment 拒绝缺失 required 参数", () => {
    expect(() => createExperiment({ ...validSnapshotInput, parameterSet: { minScore: null } }, validStrategyDefinition)).toThrow(ResearchValidationError);
  });
});

// ---------------------------------------------------------------------------
// 4. Serialization
// ---------------------------------------------------------------------------

describe("Serialization", () => {
  const fullyPopulated = {
    experimentId: "EXP-20260906-ABC12345",
    strategyId: "leader-candidate-baseline",
    strategyVersion: "1.0.0",
    parameterSet: { maxSignals: 3, minScore: 10, featureMode: "limit-up-confirm", verbose: true },
    dataset: validDataset,
    featureConfig: { featureMode: "limit-up-confirm", requiredFeatures: ["limitUpHit"] },
    backtestConfig: validBacktest,
    createdAt: "2026-09-06T00:00:00.000Z",
    status: "completed" as const,
  };

  it("Experiment serialize → deserialize 语义一致", () => {
    expect(deserializeResearchExperiment(serializeResearchExperiment(fullyPopulated))).toEqual(fullyPopulated);
  });

  it("Snapshot serialize → deserialize 语义一致", () => {
    const snapshot = createExperimentSnapshot(validSnapshotInput, validSchema);
    expect(deserializeResearchExperimentSnapshot(serializeResearchExperimentSnapshot(snapshot))).toEqual(snapshot);
  });

  it("Strategy Definition serialize → deserialize 语义一致", () => {
    expect(deserializeResearchStrategyDefinition(serializeResearchStrategyDefinition(validStrategyDefinition))).toEqual(validStrategyDefinition);
  });

  it("拒绝序列化 NaN / Infinity（不静默转 null）", () => {
    const bad = { ...fullyPopulated, parameterSet: { maxSignals: Number.NaN } };
    expect(() => serializeResearchExperiment(bad)).toThrow(/非有限数字/);
    expect(() => serializeResearchExperiment({ ...fullyPopulated, backtestConfig: { initialCapital: Number.POSITIVE_INFINITY } })).toThrow(/非有限数字/);
  });

  it("deserialize 拒绝非对象 JSON", () => {
    expect(() => deserializeResearchExperiment('"just a string"')).toThrow(ResearchValidationError);
    expect(() => deserializeResearchExperiment("[1,2,3]")).toThrow(ResearchValidationError);
  });
});

// ---------------------------------------------------------------------------
// 5. Strategy Registry
// ---------------------------------------------------------------------------

describe("Strategy Registry", () => {
  it("register / get / list", () => {
    const registry = new ResearchStrategyRegistry();
    registry.register(validStrategyDefinition);
    expect(registry.has("leader-candidate-baseline", "1.0.0")).toBe(true);
    expect(registry.get("leader-candidate-baseline", "1.0.0").name).toBe("龙头候选原始评分");
    expect(registry.list()).toHaveLength(1);
  });

  it("同 strategyId+version 重复注册 REJECT", () => {
    const registry = new ResearchStrategyRegistry();
    registry.register(validStrategyDefinition);
    expect(() => registry.register(validStrategyDefinition)).toThrow(/拒绝重复注册/);
  });

  it("同 strategyId 不同 version 可并存", () => {
    const registry = new ResearchStrategyRegistry();
    registry.register(validStrategyDefinition);
    registry.register({ ...validStrategyDefinition, version: "1.1.0" });
    expect(registry.list()).toHaveLength(2);
    expect(registry.get("leader-candidate-baseline", "1.1.0").version).toBe("1.1.0");
  });

  it("未知身份 get REJECT", () => {
    const registry = new ResearchStrategyRegistry();
    expect(() => registry.get("nope", "1.0.0")).toThrow(/未注册/);
  });

  it("非法定义 register REJECT", () => {
    const registry = new ResearchStrategyRegistry();
    expect(() => registry.register({ ...validStrategyDefinition, strategyId: "" })).toThrow(ResearchValidationError);
  });

  it("get() 返回独立副本（外部修改不污染内部状态）", () => {
    const registry = new ResearchStrategyRegistry();
    registry.register(validStrategyDefinition);

    const strategy = registry.get("leader-candidate-baseline", "1.0.0");
    strategy.name = "被篡改";
    strategy.requiredFeatures.push("injectedFeature");

    const original = registry.get("leader-candidate-baseline", "1.0.0");
    expect(original.name).toBe("龙头候选原始评分");
    expect(original.requiredFeatures).toEqual(["limitUpHit"]);
  });

  it("list() 返回独立副本（外部修改不污染内部状态）", () => {
    const registry = new ResearchStrategyRegistry();
    registry.register(validStrategyDefinition);

    const strategies = registry.list();
    strategies[0].name = "被篡改";
    strategies[0].requiredFeatures.push("injectedFeature");

    const original = registry.get("leader-candidate-baseline", "1.0.0");
    expect(original.name).toBe("龙头候选原始评分");
    expect(original.requiredFeatures).toEqual(["limitUpHit"]);
  });
});

// ---------------------------------------------------------------------------
// 6. Determinism
// ---------------------------------------------------------------------------

describe("Determinism", () => {
  it("相同输入构造 Snapshot 语义一致", () => {
    const left = createExperimentSnapshot(validSnapshotInput, validSchema);
    const right = createExperimentSnapshot(validSnapshotInput, validSchema);
    expect(left).toEqual(right);
  });

  it("toExperimentSnapshot 确定性 + 独立副本", () => {
    const experiment = createExperiment({ ...validSnapshotInput, createdAt: "2026-09-06T00:00:00.000Z" }, validStrategyDefinition);
    const snapshotA = toExperimentSnapshot(experiment);
    // 修改原实验后，快照不受影响
    experiment.parameterSet.maxSignals = 999;
    const snapshotB = toExperimentSnapshot(experiment);
    expect(snapshotA.parameterSet.maxSignals).toBe(5);
    expect(snapshotB.parameterSet.maxSignals).toBe(999);
  });

  it("resolveParameterSet 确定性", () => {
    expect(resolveParameterSet({ maxSignals: 3 }, validSchema)).toEqual(resolveParameterSet({ maxSignals: 3 }, validSchema));
  });
});

// ---------------------------------------------------------------------------
// 7. Identity
// ---------------------------------------------------------------------------

describe("Identity", () => {
  it("normalizeStrategyKey / parseStrategyKey", () => {
    expect(normalizeStrategyKey("leader-candidate", "1.0.0")).toBe("leader-candidate@1.0.0");
    expect(parseStrategyKey("leader-candidate@1.0.0")).toEqual({ strategyId: "leader-candidate", version: "1.0.0" });
    expect(parseStrategyKey("no-at-sign")).toBeNull();
  });

  it("formatExperimentId 确定性", () => {
    expect(formatExperimentId("20260906", "ABC12345")).toBe("EXP-20260906-ABC12345");
  });

  it("generateExperimentId 注入 now/suffix 时确定性", () => {
    const now = new Date(2026, 8, 6); // 2026-09-06
    expect(generateExperimentId(now, "DEADBEEF")).toBe("EXP-20260906-DEADBEEF");
  });

  it("isExperimentIdFormat", () => {
    expect(isExperimentIdFormat("EXP-20260906-ABC12345")).toBe(true);
    expect(isExperimentIdFormat("nope")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Adapter（生产策略 → 研究定义）
// ---------------------------------------------------------------------------

describe("Research Adapter", () => {
  it("研究定义身份与生产策略 metadata 一致", () => {
    const definition = buildLeaderCandidateBaselineResearchDefinition();
    expect(definition.strategyId).toBe("leader-candidate-baseline");
    expect(definition.version).toBe("1.0.0");
    expect(definition.decisionPoint).toBe("close");
    expect(definition.requiredData).toContain("leaderCandidateDataView");
    expect(definition.requiredFeatures).toContain("limitUpHit");
  });

  it("研究定义参数 schema 覆盖生产配置（minScore/maxSignals/featureMode）", () => {
    const definition = buildLeaderCandidateBaselineResearchDefinition();
    const names = definition.parameterSchema.parameters.map((param) => param.name);
    expect(names).toEqual(expect.arrayContaining(["minScore", "maxSignals", "featureMode"]));
    expect(validateStrategyDefinition(definition).valid).toBe(true);
  });
});
