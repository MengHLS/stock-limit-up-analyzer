/**
 * STRATEGY-ARCH-001 · 规格 §23.7 Immutability + §23.8 Fingerprint + §23.9 Snapshot / Replay
 */

import { describe, expect, it } from "vitest";
import {
  applyDefinitionChange,
  buildStrategyRunSnapshot,
  canonicalDefinitionJson,
  computeDefinitionFingerprint,
  createCoreDefinition,
  definitionsBehaviorallyEqual,
  deprecateStrategyVersion,
  publishStrategyVersion,
  replayRunSnapshot,
  resolveParameters,
  snapshotFingerprint,
  updateVersionDefinition,
  validateCoreDefinition,
  verifyStrategyRunSnapshot,
  versionIdOf,
} from "../../../server/strategyCore";
import { FIXED_CREATED_AT, TEST_REGISTRY, makePullbackDefinition, makeVersion } from "./_fixtures";

function errorCode(fn: () => unknown): string {
  try {
    fn();
    return "NO_ERROR";
  } catch (error) {
    return (error as { code?: string }).code ?? "NO_CODE";
  }
}

function errorMessage(fn: () => unknown): string {
  try {
    fn();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** 行为级改动：把缩量阈值默认值从 0.3 改成 0.2（同一张图，不同参数默认 ⇒ 行为不同）。 */
function tweakedDefinition() {
  const base = makePullbackDefinition();
  return createCoreDefinition(
    {
      ...base,
      parameterSchema: base.parameterSchema.map((parameter) =>
        parameter.code === "max_volume_ratio" && parameter.dataType === "number"
          ? { ...parameter, defaultValue: 0.2 }
          : parameter,
      ),
    },
    { featureRegistry: TEST_REGISTRY },
  );
}

// ---------------------------------------------------------------------------
// §23.8 Fingerprint
// ---------------------------------------------------------------------------

describe("§23.8 Fingerprint", () => {
  it("same definition → same fingerprint（canonical 串也逐字节相同）", () => {
    const a = makePullbackDefinition();
    const b = makePullbackDefinition();
    expect(computeDefinitionFingerprint(a)).toBe(computeDefinitionFingerprint(b));
    expect(canonicalDefinitionJson(a)).toBe(canonicalDefinitionJson(b));
    expect(definitionsBehaviorallyEqual(a, b)).toBe(true);
  });

  it("different behavior → different fingerprint（参数默认值改变也算行为变化）", () => {
    const base = makePullbackDefinition();
    const tweaked = tweakedDefinition();
    expect(computeDefinitionFingerprint(base)).not.toBe(computeDefinitionFingerprint(tweaked));
    expect(definitionsBehaviorallyEqual(base, tweaked)).toBe(false);
  });

  it("规则图结构变化 → 指纹变化（WINDOW 量化器 ANY_DAY → ALL_DAYS）", () => {
    const anyDay = makePullbackDefinition({ quantifier: "ANY_DAY" });
    const allDays = makePullbackDefinition({ quantifier: "ALL_DAYS" });
    expect(computeDefinitionFingerprint(anyDay)).not.toBe(computeDefinitionFingerprint(allDays));
  });

  it("能力面变化 → 指纹变化（有 / 无出场图）", () => {
    const noExit = makePullbackDefinition();
    const withExit = makePullbackDefinition({ exitRuleGraph: true });
    expect(computeDefinitionFingerprint(noExit)).not.toBe(computeDefinitionFingerprint(withExit));
    expect(withExit.capabilities).toContain("exitIntent");
    expect(noExit.capabilities).not.toContain("exitIntent");
  });

  it("指纹覆盖声明面而非实现：改特征 version 才会改指纹（改 compute 不会）", () => {
    const base = makePullbackDefinition();
    const withNewFeatureVersion = createCoreDefinition(
      {
        ...base,
        featureRequirements: base.featureRequirements.map((item) =>
          item.featureId === "volumeRatio" ? { ...item, version: "2.0.0" } : item,
        ),
      },
      {},
    );
    expect(computeDefinitionFingerprint(withNewFeatureVersion)).not.toBe(computeDefinitionFingerprint(base));
    const issues = validateCoreDefinition(withNewFeatureVersion, { featureRegistry: TEST_REGISTRY });
    expect(issues.some((issue) => issue.code === "FEATURE_VERSION_MISMATCH")).toBe(true);
  });

  it("指纹是 64 位十六进制（sha256）", () => {
    expect(computeDefinitionFingerprint(makePullbackDefinition())).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// §23.7 Immutability
// ---------------------------------------------------------------------------

describe("§23.7 StrategyVersion 不可变", () => {
  it("已发布版本改 Definition ⇒ **不存在**这样的入口（永远抛 VERSION_IMMUTABLE）", () => {
    const version = publishStrategyVersion(makeVersion(makePullbackDefinition()));
    expect(version.status).toBe("PUBLISHED");
    expect(errorCode(() => updateVersionDefinition(version, tweakedDefinition()))).toBe("VERSION_IMMUTABLE");
    expect(errorMessage(() => updateVersionDefinition(version, tweakedDefinition()))).toContain("不可变");
  });

  it("改内容只能走 applyDefinitionChange ⇒ 产出**新版本**（parent 指向旧版；旧版对象不受影响）", () => {
    const v1 = publishStrategyVersion(makeVersion(makePullbackDefinition(), { version: "1.0.0" }));
    const before = JSON.stringify(v1);
    const result = applyDefinitionChange(v1, {
      nextDefinition: tweakedDefinition(),
      bump: "minor",
      createdAt: "2026-09-20T00:00:00.000Z",
      notes: "缩量阈值默认值调整",
    });
    expect(result.kind).toBe("new-version");
    if (result.kind !== "new-version") return;
    expect(result.from).toBe("1.0.0");
    expect(result.to).toBe("1.1.0");
    expect(result.version.parentVersionId).toBe(versionIdOf(v1));
    expect(result.version.status).toBe("DRAFT");
    expect(result.version.fingerprint).not.toBe(v1.fingerprint);
    // 旧版本逐字节未变
    expect(JSON.stringify(v1)).toBe(before);
  });

  it("内容等价（指纹相同）⇒ 幂等 no-op，不产生空版本", () => {
    const v1 = makeVersion(makePullbackDefinition());
    const result = applyDefinitionChange(v1, {
      nextDefinition: makePullbackDefinition(),
      bump: "patch",
      createdAt: "2026-09-20T00:00:00.000Z",
    });
    expect(result.kind).toBe("unchanged");
    if (result.kind !== "unchanged") return;
    expect(result.version.version).toBe("1.0.0");
  });

  it("版本对象深冻结（进程内也无法原地改）", () => {
    const version = makeVersion(makePullbackDefinition());
    expect(Object.isFrozen(version)).toBe(true);
    expect(Object.isFrozen(version.definition)).toBe(true);
  });

  it("状态迁移：PUBLISHED 不可退回 DRAFT；DEPRECATED 是终态", () => {
    const published = publishStrategyVersion(makeVersion(makePullbackDefinition()));
    const retired = deprecateStrategyVersion(published);
    expect(retired.status).toBe("DEPRECATED");
    expect(errorCode(() => publishStrategyVersion(retired))).toBe("VERSION_IMMUTABLE");
    // 发布幂等
    expect(publishStrategyVersion(published).status).toBe("PUBLISHED");
  });

  it("非法版本号 / 缺 createdAt / 空名称被拒（构造期失败，不留半成品）", () => {
    const definition = makePullbackDefinition();
    expect(errorCode(() => makeVersion(definition, { version: "v1" }))).toBe("CORE_DEFINITION_INVALID");
    expect(errorCode(() => makeVersion(definition, { name: " " }))).toBe("CORE_DEFINITION_INVALID");
  });
});

// ---------------------------------------------------------------------------
// §23.9 Snapshot / Replay
// ---------------------------------------------------------------------------

describe("§23.9 StrategyRunSnapshot / Replay", () => {
  const version = makeVersion(makePullbackDefinition());
  const runtimeConfig = {
    evaluationDate: "2026-09-11",
    evaluationPoint: "close" as const,
    currentRelativeDay: 1,
    maxRelativeDay: 5,
  };

  function buildSnapshot(overrides: Record<string, unknown> = {}) {
    return buildStrategyRunSnapshot({
      runId: "clrun-20260911-1",
      version,
      parameterSet: { max_volume_ratio: 0.5 },
      engineVersion: "strategy-core@1.0.0",
      codeVersion: "1.0.0+ga1b2c3d",
      universe: { universeId: "main-board", members: ["sec_a", "sec_b"] },
      datasetReference: {
        datasetVersionId: 390002,
        datasetLabel: "v2",
        datasetSource: "registry",
        datasetContentFingerprint: null,
      },
      seed: 42,
      runtimeConfig,
      createdAt: FIXED_CREATED_AT,
      ...overrides,
    });
  }

  it("快照记录全部坐标（含 legacy 实测缺失的 parameterSet / engineVersion / codeVersion / seed）", () => {
    const snapshot = buildSnapshot();
    expect(snapshot.parameterSet).toEqual({ max_volume_ratio: 0.5 });
    expect(snapshot.resolvedParameterSet.max_volume_ratio).toBe(0.5);
    expect(snapshot.resolvedParameterSet.max_drawdown_tolerance).toBeCloseTo(0.95, 10);
    expect(snapshot.engineVersion).toBe("strategy-core@1.0.0");
    expect(snapshot.codeVersion).toBe("1.0.0+ga1b2c3d");
    expect(snapshot.seed).toBe(42);
    expect(snapshot.datasetReference?.datasetVersionId).toBe(390002);
    expect(snapshot.definitionFingerprint).toBe(version.fingerprint);
    expect(snapshot.executionSemanticsVersion).toContain("T_PLUS_1_OPEN");
  });

  it("缺失 engineVersion / codeVersion ⇒ 拒绝构建（不接受 unknown 占位）", () => {
    expect(errorCode(() => buildSnapshot({ engineVersion: " " }))).toBe("SNAPSHOT_INVALID");
    expect(errorCode(() => buildSnapshot({ codeVersion: "" }))).toBe("SNAPSHOT_INVALID");
    expect(errorCode(() => buildSnapshot({ runId: "" }))).toBe("SNAPSHOT_INVALID");
  });

  it("校验：快照 + 版本自洽 ⇒ valid，且逐项检查都通过", () => {
    const report = verifyStrategyRunSnapshot(buildSnapshot(), version);
    expect(report.valid).toBe(true);
    expect(report.checks.every((check) => check.ok)).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual([
      "V1 快照结构版本",
      "V2 策略身份",
      "V3 定义指纹",
      "V4 参数可解析",
      "V5 解析结果一致",
      "V6 引擎 / 代码版本",
    ]);
  });

  it("校验：定义被改过（指纹不符）⇒ 不可复现", () => {
    const other = makeVersion(tweakedDefinition());
    const report = verifyStrategyRunSnapshot(buildSnapshot(), other);
    expect(report.valid).toBe(false);
    expect(report.checks.find((check) => check.name === "V3 定义指纹")?.ok).toBe(false);
  });

  it("校验：参数被篡改 / 越界 ⇒ V4 失败", () => {
    const tampered = { ...buildSnapshot(), parameterSet: { max_volume_ratio: 99 } } as ReturnType<typeof buildSnapshot>;
    const report = verifyStrategyRunSnapshot(tampered, version);
    expect(report.valid).toBe(false);
    expect(report.checks.find((check) => check.name === "V4 参数可解析")?.ok).toBe(false);
  });

  it("校验：resolvedParameterSet 被篡改（DERIVED 值不一致）⇒ V5 失败", () => {
    const base = buildSnapshot();
    const tampered = {
      ...base,
      resolvedParameterSet: { ...base.resolvedParameterSet, max_drawdown_tolerance: 0.1 },
    } as ReturnType<typeof buildSnapshot>;
    const report = verifyStrategyRunSnapshot(tampered, version);
    expect(report.checks.find((check) => check.name === "V5 解析结果一致")?.ok).toBe(false);
  });

  it("Replay：由快照 + 版本重建运行时配置，逐项与快照一致", () => {
    const snapshot = buildSnapshot();
    const replayed = replayRunSnapshot(snapshot, version);
    expect(replayed.definitionFingerprint).toBe(snapshot.definitionFingerprint);
    expect(replayed.resolvedParameterSet.values).toEqual(snapshot.resolvedParameterSet);
    expect(replayed.runtimeConfig).toEqual(snapshot.runtimeConfig);
    expect(replayed.engineVersion).toBe(snapshot.engineVersion);
    expect(replayed.datasetReference).toEqual(snapshot.datasetReference);
  });

  it("Replay 等价性：用「已解析值」回填当原始覆写 ⇒ 被拒绝（DERIVED 不允许覆写）", () => {
    const first = buildSnapshot();
    const replayed = replayRunSnapshot(first, version);
    // 这正是「resolved 与 raw 不能混用」的机器可判据：把 resolvedParameterSet 当 parameterSet 回填必抛错。
    expect(
      errorCode(() =>
        buildStrategyRunSnapshot({
          runId: "clrun-20260911-2",
          version,
          parameterSet: replayed.resolvedParameterSet.values as never,
          engineVersion: replayed.engineVersion,
          codeVersion: replayed.codeVersion,
          universe: replayed.universe,
          datasetReference: replayed.datasetReference,
          seed: replayed.seed,
          runtimeConfig: replayed.runtimeConfig,
          createdAt: "2027-01-01T00:00:00.000Z",
        }),
      ),
    ).toBe("PARAMETER_DERIVED_OVERRIDE_FORBIDDEN");
  });

  it("Replay 等价性（正确姿势）：参数原样回填 ⇒ 快照指纹相等", () => {
    const first = buildSnapshot();
    const replayed = replayRunSnapshot(first, version);
    const second = buildStrategyRunSnapshot({
      runId: "clrun-20260911-2",
      version,
      parameterSet: first.parameterSet,
      engineVersion: replayed.engineVersion,
      codeVersion: replayed.codeVersion,
      universe: replayed.universe,
      datasetReference: replayed.datasetReference,
      seed: replayed.seed,
      runtimeConfig: replayed.runtimeConfig,
      createdAt: "2027-01-01T00:00:00.000Z",
    });
    expect(snapshotFingerprint(second)).toBe(snapshotFingerprint(first));
    expect(resolveParameters(version.definition.parameterSchema, first.parameterSet).values).toEqual(
      resolveParameters(version.definition.parameterSchema, second.parameterSet).values,
    );
  });

  it("快照指纹不对 createdAt / runId 敏感（它们是「这一次」的标识，不是配置）", () => {
    const a = buildSnapshot({ runId: "run-a", createdAt: "2026-09-19T00:00:00.000Z" });
    const b = buildSnapshot({ runId: "run-b", createdAt: "2026-10-01T00:00:00.000Z" });
    expect(snapshotFingerprint(a)).toBe(snapshotFingerprint(b));
  });

  it("快照对 seed / engineVersion 敏感（复现必须区分它们）", () => {
    const a = buildSnapshot();
    const b = buildSnapshot({ seed: 43 });
    const c = buildSnapshot({ engineVersion: "strategy-core@1.1.0" });
    expect(snapshotFingerprint(a)).not.toBe(snapshotFingerprint(b));
    expect(snapshotFingerprint(a)).not.toBe(snapshotFingerprint(c));
  });

  it("datasetReference 允许出现在快照里，但 Definition 里不得有绑定（规格 §10 vs §16 的分工）", () => {
    const snapshot = buildSnapshot();
    expect(snapshot.datasetReference).not.toBeNull();
    expect(JSON.stringify(version.definition).includes("datasetVersionId")).toBe(false);
  });
});
