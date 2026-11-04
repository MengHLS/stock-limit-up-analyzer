/**
 * STRATEGY-ARCH-002 — Run Record：组装 / 快照自洽 / 复现 / 落库形状（规格 §6–§10、§14.3 B·F、§16）。
 *
 * 判据取向：**能重新跑出同一结论**，而不是「字段都填上了」。
 */

import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../../../server/data";
import {
  RUN_SNAPSHOT_VERSION,
  assertSnapshotReplayable,
  computeDefinitionFingerprint,
  replayRunSnapshot,
  snapshotFingerprint,
  verifyStrategyRunSnapshot,
} from "../../../../server/strategyCore";
import {
  STRATEGY_CORE_ENGINE_VERSION,
  buildStrategyRunRecord,
  createCoreDecisionSource,
  createDatasetEventResolver,
  hasStrategyRunRecord,
  runtimeConfigSnapshot,
} from "../../../../server/strategyCore/production";
import { strategyRunRecordSchema } from "../../../../shared/researchContracts";
import { FIXED_CREATED_AT, makePullbackDefinition, makeVersion } from "../_fixtures";

function marketBar(date: string, values: { open: number; low: number; close: number; preClose: number; volume: number }): CanonicalMarketBar {
  return {
    symbol: "600001.SH",
    timestamp: date,
    open: values.open,
    high: values.close,
    low: values.low,
    close: values.close,
    preClose: values.preClose,
    volume: values.volume,
    amount: values.volume * 100,
    turnoverRate: null,
    adjustment: "raw",
  } as unknown as CanonicalMarketBar;
}

const WINDOW: readonly CanonicalMarketBar[] = [
  marketBar("2026-09-10", { open: 10, low: 10, close: 11, preClose: 10, volume: 200_000 }),
  marketBar("2026-09-11", { open: 11, low: 10.6, close: 10.8, preClose: 11, volume: 80_000 }),
  marketBar("2026-09-12", { open: 10.9, low: 10.4, close: 11.2, preClose: 10.8, volume: 60_000 }),
];

function build(input: { parameterSet?: Record<string, number | boolean | string>; runId?: string } = {}) {
  const version = makeVersion(makePullbackDefinition());
  const parameterSet = input.parameterSet ?? { max_volume_ratio: 0.5 };
  const eventResolver = createDatasetEventResolver({
    eventAnchored: true,
    eventTypes: ["FIRST_LIMIT_UP"],
    limitUpRatio: 0.1,
    declaredBy: "test",
  });
  const source = createCoreDecisionSource({
    version,
    parameterSet,
    rankFeatureId: "isBullish",
    point: "close",
    eventResolver,
    eventTypes: ["FIRST_LIMIT_UP"],
  });
  for (let k = 0; k < WINDOW.length; k += 1) {
    const bars = WINDOW.slice(0, k + 1);
    source.signalBuilder({
      securityId: "600001.SH",
      date: bars[bars.length - 1]!.timestamp,
      features: { isBullish: 1 },
      bars,
      point: "close",
    });
  }
  const digest = source.digest();
  const record = buildStrategyRunRecord({
    runId: input.runId ?? "clrun-20260919-test",
    version,
    parameterSet,
    resolvedParameterSet: source.resolvedParameterSet().values,
    codeVersion: "1.0.0+gtest",
    universe: { universeId: "research-dataset:v2", members: null },
    datasetReference: {
      datasetVersionId: 390002,
      datasetLabel: "v2",
      datasetSource: "registry",
      datasetContentFingerprint: "v2",
    },
    seed: null,
    runtimeConfig: runtimeConfigSnapshot({
      startDate: "2026-09-10",
      point: "close",
      maxRelativeDayObserved: digest.maxRelativeDayObserved,
      horizonRelativeDay: digest.maxRelativeDayObserved,
    }),
    createdAt: FIXED_CREATED_AT,
    digest,
    anchorPolicy: "SERIES_START",
    notes: ["test"],
    unmappedExitRuleIds: ["exit-1", "exit-2"],
  });
  return { version, source, record, parameterSet };
}

describe("Run Record — 组装与自洽", () => {
  it("快照坐标齐备：定义指纹 / 引擎版本 / 代码版本 / 数据集坐标 / 解析后参数", () => {
    const { version, record } = build();
    const snapshot = record.strategyRunSnapshot;
    expect(snapshot.snapshotVersion).toBe(RUN_SNAPSHOT_VERSION);
    expect(snapshot.definitionFingerprint).toBe(computeDefinitionFingerprint(version.definition));
    expect(snapshot.engineVersion).toBe(STRATEGY_CORE_ENGINE_VERSION);
    expect(snapshot.codeVersion).toBe("1.0.0+gtest");
    expect(snapshot.datasetReference?.datasetVersionId).toBe(390002);
    expect(snapshot.datasetReference?.datasetSource).toBe("registry");
    expect(snapshot.resolvedParameterSet["max_volume_ratio"]).toBe(0.5);
    // DERIVED 参数也进了 resolvedParameterSet（复现主判据）
    expect(snapshot.resolvedParameterSet["max_drawdown_tolerance"]).toBeCloseTo(0.95, 10);
    expect(record.executionMetadata.decisionSource).toBe("strategy-core");
    expect(record.executionMetadata.unmappedExitRuleIds).toEqual(["exit-1", "exit-2"]);
  });

  it("空 engineVersion / codeVersion ⇒ 响亮抛错（拒绝不可复现的留档）", () => {
    const { version, source } = build();
    expect(() =>
      buildStrategyRunRecord({
        runId: "r",
        version,
        parameterSet: { max_volume_ratio: 0.5 },
        resolvedParameterSet: source.resolvedParameterSet().values,
        codeVersion: "",
        universe: { universeId: "u" },
        datasetReference: null,
        runtimeConfig: runtimeConfigSnapshot({
          startDate: "2026-09-10",
          point: "close",
          maxRelativeDayObserved: 2,
          horizonRelativeDay: 2,
        }),
        createdAt: FIXED_CREATED_AT,
        digest: source.digest(),
        anchorPolicy: "SERIES_START",
        notes: [],
      }),
    ).toThrowError();
  });

  it("解析后参数与快照重算不一致 ⇒ 响亮抛错（防「复现出来是另一个策略」）", () => {
    const { version, source } = build();
    expect(() =>
      buildStrategyRunRecord({
        runId: "r",
        version,
        parameterSet: { max_volume_ratio: 0.5 },
        resolvedParameterSet: { ...source.resolvedParameterSet().values, max_volume_ratio: 0.999 },
        codeVersion: "1.0.0+gtest",
        universe: { universeId: "u" },
        datasetReference: null,
        runtimeConfig: runtimeConfigSnapshot({
          startDate: "2026-09-10",
          point: "close",
          maxRelativeDayObserved: 2,
          horizonRelativeDay: 2,
        }),
        createdAt: FIXED_CREATED_AT,
        digest: source.digest(),
        anchorPolicy: "SERIES_START",
        notes: [],
      }),
    ).toThrowError(/解析后参数与快照重算结果不一致/);
  });
});

describe("Run Record — 快照指纹与复现（Test B / F）", () => {
  it("Test B：同版本 + 同参数 + 同数据集坐标 + 同配置 ⇒ 快照指纹相同（runId / createdAt 不进指纹）", () => {
    const a = build({ runId: "clrun-a" });
    const b = build({ runId: "clrun-b" });
    expect(snapshotFingerprint(a.record.strategyRunSnapshot)).toBe(
      snapshotFingerprint(b.record.strategyRunSnapshot),
    );
    expect(a.record.strategyRunSnapshot.runId).not.toBe(b.record.strategyRunSnapshot.runId);
  });

  it("Test B2：参数变了 ⇒ 快照指纹改变（运行级行为确实不同）", () => {
    const a = build({ parameterSet: { max_volume_ratio: 0.5 } });
    const b = build({ parameterSet: { max_volume_ratio: 0.2 } });
    expect(snapshotFingerprint(a.record.strategyRunSnapshot)).not.toBe(
      snapshotFingerprint(b.record.strategyRunSnapshot),
    );
    // 定义指纹**不变**（参数不进定义）—— 语义分界如实可辨
    expect(a.record.strategyRunSnapshot.definitionFingerprint).toBe(
      b.record.strategyRunSnapshot.definitionFingerprint,
    );
  });

  it("Test F：verify → replay 全程通过，且复现出的参数集与快照逐键相等", () => {
    const { version, record } = build();
    const snapshot = record.strategyRunSnapshot;
    const report = verifyStrategyRunSnapshot(snapshot, version);
    expect(report.valid).toBe(true);
    expect(report.checks.every((check) => check.ok)).toBe(true);
    expect(() => assertSnapshotReplayable(snapshot, version)).not.toThrow();
    const replayed = replayRunSnapshot(snapshot, version);
    expect(replayed.resolvedParameterSet.values).toEqual(snapshot.resolvedParameterSet);
    expect(replayed.engineVersion).toBe(snapshot.engineVersion);
    expect(replayed.runtimeConfig).toEqual(snapshot.runtimeConfig);
  });

  it("Test F2：定义被换掉（模拟「同一版本号但定义改了」）⇒ 复现被拒", () => {
    const { record } = build();
    const tampered = makeVersion(makePullbackDefinition({ includeBullishCondition: false }));
    const report = verifyStrategyRunSnapshot(record.strategyRunSnapshot, tampered);
    expect(report.valid).toBe(false);
    expect(report.checks.find((check) => check.name.startsWith("V3"))?.ok).toBe(false);
    expect(() => assertSnapshotReplayable(record.strategyRunSnapshot, tampered)).toThrowError();
  });
});

describe("Run Record — 落库形状（进既有 resultJson，零 schema 变更）", () => {
  it("Run Record 本身能通过共享契约（zod）校验", () => {
    const { record } = build();
    const parsed = strategyRunRecordSchema.safeParse(record);
    if (!parsed.success) {
      throw new Error("strategyRun 契约校验失败：" + JSON.stringify(parsed.error.issues.slice(0, 6)));
    }
    expect(parsed.success).toBe(true);
    expect(parsed.data.executionMetadata.decisionSource).toBe("strategy-core");
  });

  it("未接线（非 Core 路径）⇒ strategyRun 可缺省 / null（向后兼容既有留档）", () => {
    expect(strategyRunRecordSchema.safeParse(null).success).toBe(false);
    expect(hasStrategyRunRecord({ runId: "legacy-run" })).toBe(false);
    expect(hasStrategyRunRecord(null)).toBe(false);
    expect(hasStrategyRunRecord({ strategyRun: null })).toBe(false);
    expect(hasStrategyRunRecord({ strategyRun: build().record })).toBe(true);
  });
});
