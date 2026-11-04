/**
 * STRATEGY-ARCH-001 — StrategyRunSnapshot（规格 §16）。
 *
 * 解决的问题（对照 legacy，实测）：`closed_loop_backtest_run` 的 6 行留档里，
 * `resultJson` 对 `parameterSet` / `codeVersion` / `engineVersion` / `seed` 的命中数**都是 0**
 * ⇒ 换过参数的那一次回测**无法复现**。
 *
 * 本模块给出运行快照的**完整坐标**：
 *
 *   strategyVersionId · parameterSet · engineVersion · codeVersion ·
 *   executionSemanticsVersion · universe · datasetReference · seed · runtimeConfig
 *
 * 🔴 边界（规格 §10 vs §16 的分工，必须说清）：
 *   - **Dataset 不属于 Definition**（Definition 里出现 datasetVersionId 会被守卫拒绝）；
 *   - `datasetReference` **只允许存在于 RunSnapshot** —— 快照是「这一次运行用了什么数据」的记录，
 *     不是策略的一部分。
 *
 * 纯模块：无 IO / 无 Date.now（`createdAt` 由调用方注入）/ 无 Math.random。
 */

import {
  StrategyCoreError,
  type CoreValidationIssue,
  type CoreValue,
  type RelativeDay,
  validationIssue,
} from "./types";
import { fingerprintOf } from "./canonical";
import type { StrategyCoreDefinition } from "./definition";
import { computeDefinitionFingerprint } from "./fingerprint";
import { resolveParameters, type ParameterSet, type ResolvedParameterSet } from "./parameterResolver";
import { executionSemanticsVersion } from "./executionSemantics";
import { versionIdOf, type StrategyVersion } from "./version";

export const RUN_SNAPSHOT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 坐标
// ---------------------------------------------------------------------------

/** 数据集引用（**只允许出现在快照里**）。 */
export interface DatasetReference {
  /** Dataset Registry 权威坐标 `dataset_version.id`；未绑定时 null。 */
  readonly datasetVersionId: number | null;
  /** 显示 label / legacy 内容寻址串。 */
  readonly datasetLabel: string | null;
  readonly datasetSource: "registry" | "rebuild" | "injected";
  /** 数据集内容指纹（重建路径的内容寻址串；registry 路径可为 null）。 */
  readonly datasetContentFingerprint: string | null;
}

/** 运行配置快照（决定「在哪个时点求值」）。 */
export interface RuntimeConfigSnapshot {
  readonly evaluationDate: string;
  readonly evaluationPoint: "open" | "close";
  readonly currentRelativeDay: RelativeDay;
  readonly maxRelativeDay: RelativeDay;
}

/** 运行快照（一次执行的可复现坐标）。 */
export interface StrategyRunSnapshot {
  readonly snapshotVersion: typeof RUN_SNAPSHOT_VERSION;
  readonly runId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly definitionFingerprint: string;
  /** 调用方提供的原始参数集合（未解析）。 */
  readonly parameterSet: ParameterSet;
  /** 解析后的参数值（含 DERIVED 结果）——复现时用它做主判据。 */
  readonly resolvedParameterSet: Readonly<Record<string, CoreValue>>;
  readonly engineVersion: string;
  readonly codeVersion: string;
  readonly executionSemanticsVersion: string;
  readonly universe: {
    readonly universeId: string;
    readonly members: readonly string[] | null;
  };
  readonly datasetReference: DatasetReference | null;
  readonly seed: number | null;
  readonly runtimeConfig: RuntimeConfigSnapshot;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// 构建
// ---------------------------------------------------------------------------

export interface BuildStrategyRunSnapshotInput {
  readonly runId: string;
  readonly version: StrategyVersion;
  readonly parameterSet?: ParameterSet;
  readonly engineVersion: string;
  readonly codeVersion: string;
  readonly universe: { readonly universeId: string; readonly members?: readonly string[] | null };
  readonly datasetReference?: DatasetReference | null;
  readonly seed?: number | null;
  readonly runtimeConfig: RuntimeConfigSnapshot;
  readonly createdAt: string;
}

/**
 * 构建快照（唯一入口）：解析参数 → 记录全部坐标。
 *
 * 校验：`engineVersion` / `codeVersion` 必须非空字符串 —— 实测 legacy 的 `codeVersion`
 * 全是 `1.0.0+gunknown`，等于没有。Core 选择**显式拒绝空值**，把「版本不可知」变成
 * 调用方必须处理的问题，而不是静默降级。
 */
export function buildStrategyRunSnapshot(input: BuildStrategyRunSnapshotInput): StrategyRunSnapshot {
  if (input.runId.trim() === "") {
    throw new StrategyCoreError("SNAPSHOT_INVALID", "runId 不能为空");
  }
  if (input.engineVersion.trim() === "") {
    throw new StrategyCoreError(
      "SNAPSHOT_INVALID",
      "engineVersion 不能为空（本项目并存多套回测引擎，「不记录引擎版本」等于不可复现）",
    );
  }
  if (input.codeVersion.trim() === "") {
    throw new StrategyCoreError("SNAPSHOT_INVALID", "codeVersion 不能为空（拒绝 legacy 那种 unknown 占位）");
  }
  if (typeof input.createdAt !== "string" || input.createdAt.trim() === "") {
    throw new StrategyCoreError("SNAPSHOT_INVALID", "createdAt 必须由调用方显式注入");
  }
  if (input.seed !== undefined && input.seed !== null && !Number.isFinite(input.seed)) {
    throw new StrategyCoreError("SNAPSHOT_INVALID", "seed 必须是有限数字或 null");
  }

  const resolved = resolveParameters(input.version.definition.parameterSchema, input.parameterSet ?? {});
  const definitionFingerprint = computeDefinitionFingerprint(input.version.definition);

  return Object.freeze({
    snapshotVersion: RUN_SNAPSHOT_VERSION,
    runId: input.runId,
    strategyId: input.version.strategyId,
    strategyVersion: input.version.version,
    definitionFingerprint,
    parameterSet: Object.freeze({ ...(input.parameterSet ?? {}) }),
    resolvedParameterSet: resolved.values,
    engineVersion: input.engineVersion,
    codeVersion: input.codeVersion,
    executionSemanticsVersion: executionSemanticsVersion(input.version.definition.executionSemantics),
    universe: Object.freeze({
      universeId: input.universe.universeId,
      members: input.universe.members == null ? null : Object.freeze([...input.universe.members]),
    }),
    datasetReference: input.datasetReference ?? null,
    seed: input.seed ?? null,
    runtimeConfig: Object.freeze({ ...input.runtimeConfig }),
    createdAt: input.createdAt,
  });
}

/** 快照指纹（不含 `createdAt` / `runId`：这两个是「这一次」的标识，不是配置）。 */
export function snapshotFingerprint(snapshot: StrategyRunSnapshot): string {
  return fingerprintOf({
    snapshotVersion: snapshot.snapshotVersion,
    strategyId: snapshot.strategyId,
    strategyVersion: snapshot.strategyVersion,
    definitionFingerprint: snapshot.definitionFingerprint,
    parameterSet: snapshot.parameterSet,
    resolvedParameterSet: snapshot.resolvedParameterSet,
    engineVersion: snapshot.engineVersion,
    codeVersion: snapshot.codeVersion,
    executionSemanticsVersion: snapshot.executionSemanticsVersion,
    universe: snapshot.universe,
    datasetReference: snapshot.datasetReference,
    seed: snapshot.seed,
    runtimeConfig: snapshot.runtimeConfig,
  });
}

// ---------------------------------------------------------------------------
// 校验（复现前的前置检查）
// ---------------------------------------------------------------------------

export interface SnapshotVerificationReport {
  readonly valid: boolean;
  readonly issues: readonly CoreValidationIssue[];
  /** 复现时必须一致的关键项（供 UI 展示「哪些对不上」）。 */
  readonly checks: readonly { readonly name: string; readonly ok: boolean; readonly detail: string }[];
}

/**
 * 校验快照与给定版本是否自洽（**复现的前置门槛**）。
 *
 * 判据（逐条独立，便于定位是哪一项对不上）：
 *   V1 快照结构版本受支持；
 *   V2 strategyId / strategyVersion 与版本一致；
 *   V3 definitionFingerprint 与版本定义一致（**定义被改过 ⇒ 不可复现**）；
 *   V4 parameterSet 能用该版本的 parameterSchema 重新解析成功（含 DERIVED）；
 *   V5 重新解析出的 resolvedParameterSet 与快照逐键相等（**DERIVED 变了也会被抓到**）；
 *   V6 engineVersion / codeVersion 非空。
 */
export function verifyStrategyRunSnapshot(
  snapshot: StrategyRunSnapshot,
  version: StrategyVersion,
): SnapshotVerificationReport {
  const issues: CoreValidationIssue[] = [];
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  const push = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
    if (!ok) issues.push(validationIssue("SNAPSHOT_INVALID", name, detail));
  };

  push(
    "V1 快照结构版本",
    snapshot.snapshotVersion === RUN_SNAPSHOT_VERSION,
    "snapshotVersion=" + String(snapshot.snapshotVersion),
  );
  push(
    "V2 策略身份",
    snapshot.strategyId === version.strategyId && snapshot.strategyVersion === version.version,
    "快照 " + snapshot.strategyId + "@" + snapshot.strategyVersion + " vs 版本 " + versionIdOf(version),
  );

  const currentFingerprint = computeDefinitionFingerprint(version.definition);
  push(
    "V3 定义指纹",
    snapshot.definitionFingerprint === currentFingerprint,
    "快照 " + snapshot.definitionFingerprint.slice(0, 12) + "… vs 当前 " + currentFingerprint.slice(0, 12) + "…",
  );

  let resolved: ResolvedParameterSet | null = null;
  try {
    resolved = resolveParameters(version.definition.parameterSchema, snapshot.parameterSet);
    push("V4 参数可解析", true, "参数键 " + Object.keys(resolved.values).join("、"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    push("V4 参数可解析", false, message);
  }

  if (resolved !== null) {
    const expected = JSON.stringify(sortedEntries(snapshot.resolvedParameterSet));
    const actual = JSON.stringify(sortedEntries(resolved.values));
    push("V5 解析结果一致", expected === actual, expected === actual ? "逐键相等" : "快照 " + expected + " vs 重算 " + actual);
  }

  push(
    "V6 引擎 / 代码版本",
    snapshot.engineVersion.trim() !== "" && snapshot.codeVersion.trim() !== "",
    "engineVersion=" + snapshot.engineVersion + ", codeVersion=" + snapshot.codeVersion,
  );

  return { valid: issues.length === 0, issues, checks };
}

function sortedEntries(record: Readonly<Record<string, CoreValue>>): readonly (readonly [string, CoreValue])[] {
  return Object.keys(record)
    .sort()
    .map((key) => [key, record[key] as CoreValue] as const);
}

/** 校验不通过即抛（复现前调用）。 */
export function assertSnapshotReplayable(snapshot: StrategyRunSnapshot, version: StrategyVersion): void {
  const report = verifyStrategyRunSnapshot(snapshot, version);
  if (report.valid) return;
  throw new StrategyCoreError(
    "SNAPSHOT_FINGERPRINT_MISMATCH",
    report.issues.map((issue) => issue.path + ": " + issue.message).join(" | "),
    { failedCheckCount: report.issues.length },
  );
}

// ---------------------------------------------------------------------------
// 复现
// ---------------------------------------------------------------------------

/** 复现出的运行时配置（**与 Runtime.evaluate 的输入一一对应**）。 */
export interface ReplayedRuntimeConfig {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly definition: StrategyCoreDefinition;
  readonly definitionFingerprint: string;
  readonly resolvedParameterSet: ResolvedParameterSet;
  readonly runtimeConfig: RuntimeConfigSnapshot;
  readonly universe: StrategyRunSnapshot["universe"];
  readonly datasetReference: DatasetReference | null;
  readonly seed: number | null;
  readonly engineVersion: string;
  readonly codeVersion: string;
}

/**
 * 由「快照 + 版本」重建运行时配置（规格 §23.9 的复现入口）。
 *
 * 复现等价性判据：`snapshotFingerprint(原快照) === snapshotFingerprint(用重建配置重拍的快照)`
 * —— 见测试 `runSnapshot.test.ts`（两条路径必须先各自校验通过再比字节）。
 */
export function replayRunSnapshot(snapshot: StrategyRunSnapshot, version: StrategyVersion): ReplayedRuntimeConfig {
  assertSnapshotReplayable(snapshot, version);
  const resolved = resolveParameters(version.definition.parameterSchema, snapshot.parameterSet);
  return {
    strategyId: version.strategyId,
    strategyVersion: version.version,
    definition: version.definition,
    definitionFingerprint: snapshot.definitionFingerprint,
    resolvedParameterSet: resolved,
    runtimeConfig: snapshot.runtimeConfig,
    universe: snapshot.universe,
    datasetReference: snapshot.datasetReference,
    seed: snapshot.seed,
    engineVersion: snapshot.engineVersion,
    codeVersion: snapshot.codeVersion,
  };
}
