/**
 * STRATEGY-ARCH-002 — Strategy Run Record（**运行留档的唯一组装点**）。
 *
 * ## 存在理由（对照审计 P0）
 *
 * 审计实测：`closed_loop_backtest_run` 的 6 行留档里，`resultJson` 对
 * `parameterSet` / `codeVersion` / `engineVersion` / `seed` 的命中数**都是 0**
 * ⇒ 「参数换过的那一次回测」**无法复现**。
 *
 * 本模块把「这一次运行到底按什么跑的」组装成**稳定结构**，由 `researchRunRouter#loopRun`
 * 写进既有的 `resultJson` JSON 列 ⇒ **零 schema 变更**（规格 §7/§18：优先复用现有字段）。
 *
 * ## 落库位置（**不新建表**，理由见实施报告 §4）
 *
 * ```
 * closed_loop_backtest_run.resultJson
 *   └── strategyRun
 *         ├── strategyRunSnapshot   一次执行的可复现坐标（Core `StrategyRunSnapshot`）
 *         ├── strategyDecision      行为面摘要 + 有界样本（Core `StrategyDecisionDigest`）
 *         └── executionMetadata     引擎 / 代码版本 / 接线事实 / 锚定策略 / 未接线事项
 * ```
 *
 * 之所以**不新建表**：生命周期（一次运行一行、跟随运行删除）、查询模式（只在详情页按
 * `runId` 读一次）、并发模型（与运行同事务边界）、领域职责（「这次运行用了什么」）
 * 与 `closed_loop_backtest_run` **完全一致**；`resultJson` 本就是「本次运行的完整留档」。
 * 新建表只会制造第二套 SoT（`StrategyRun` 到底以哪张表为准？）—— 这正是审计点名的反模式。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random。
 */

import type { CoreValue, RelativeDay } from "../types";
import {
  buildStrategyRunSnapshot,
  type DatasetReference,
  type RuntimeConfigSnapshot,
  type StrategyRunSnapshot,
} from "../runSnapshot";
import type { ParameterSet } from "../parameterResolver";
import type { StrategyVersion } from "../version";
import type { StrategyDecisionDigest } from "./coreDecision";
import type { EventAnchorPolicy } from "./barWindow";

/** 引擎版本（进快照；「本项目并存多套回测引擎」⇒ 不记录等于不可复现）。 */
export const STRATEGY_CORE_ENGINE_VERSION = "strategy-core/1.0.0";

/** 执行元数据（**不进**快照指纹 —— 它描述「谁跑的」，不是「按什么跑的」）。 */
export interface StrategyRunExecutionMetadata {
  readonly decisionSource: "strategy-core";
  readonly engineVersion: string;
  readonly codeVersion: string;
  readonly anchorPolicy: EventAnchorPolicy;
  /** 接线事实（含未映射项 / 锚定边界），**逐条如实**。 */
  readonly notes: readonly string[];
  /** 未能映射进 Core RuleGraph 的 legacy 出场规则 id（阈值型出场，见规格 §13.4）。 */
  readonly unmappedExitRuleIds: readonly string[];
}

/** 深可变化（把 Core 的冻结只读对象映射为可序列化 DTO 的形态）。 */
type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;

/**
 * 写进 `resultJson.strategyRun` 的完整结构。
 *
 * 🔴 为什么用 `Mutable<>`：Core 的产物是**深冻结**的（`Object.freeze`），而它要进
 * `ClosedLoopRunResult`（zod 推导出的 DTO 形态，数组为可变）。直接赋值会在
 * `readonly string[]` → `string[]` 上编译失败；用 `as` 硬转会**掩盖真实的不一致**。
 * ⇒ 用显式深拷贝（`structuredClone`）产生真可变副本，类型由 `Mutable<>` 如实表达。
 */
export interface StrategyRunRecord {
  readonly strategyRunSnapshot: Mutable<StrategyRunSnapshot>;
  readonly strategyDecision: Mutable<StrategyDecisionDigest>;
  readonly executionMetadata: Mutable<StrategyRunExecutionMetadata>;
}

export interface BuildStrategyRunRecordInput {
  readonly runId: string;
  readonly version: StrategyVersion;
  /** 本次实际使用的参数集（**装配层解析结果**，含覆写与 defaultValue）。 */
  readonly parameterSet: ParameterSet;
  readonly resolvedParameterSet: Readonly<Record<string, CoreValue>>;
  readonly engineVersion?: string;
  readonly codeVersion: string;
  readonly universe: { readonly universeId: string; readonly members?: readonly string[] | null };
  readonly datasetReference: DatasetReference | null;
  readonly seed?: number | null;
  readonly runtimeConfig: RuntimeConfigSnapshot;
  readonly createdAt: string;
  readonly digest: StrategyDecisionDigest;
  readonly anchorPolicy: EventAnchorPolicy;
  readonly notes: readonly string[];
  readonly unmappedExitRuleIds?: readonly string[];
}

/** 组装 Run Record（唯一入口）。 */
export function buildStrategyRunRecord(input: BuildStrategyRunRecordInput): StrategyRunRecord {
  const engineVersion = input.engineVersion ?? STRATEGY_CORE_ENGINE_VERSION;
  const snapshot = buildStrategyRunSnapshot({
    runId: input.runId,
    version: input.version,
    parameterSet: input.parameterSet,
    engineVersion,
    codeVersion: input.codeVersion,
    universe: {
      universeId: input.universe.universeId,
      members: input.universe.members ?? null,
    },
    datasetReference: input.datasetReference,
    seed: input.seed ?? null,
    runtimeConfig: input.runtimeConfig,
    createdAt: input.createdAt,
  });

  // 🔴 快照的 `resolvedParameterSet` 由 `buildStrategyRunSnapshot` 自己解析得到；
  // 但生产链路的参数集**另有来源**（装配层的 `resolveParameters`）⇒ 必须逐键比对，
  // 不一致即抛错：两套解析结果不一致时静默采用其一，等于制造「复现出来是另一个策略」。
  for (const [code, value] of Object.entries(input.resolvedParameterSet)) {
    const snapshotValue = snapshot.resolvedParameterSet[code];
    if (JSON.stringify(snapshotValue) !== JSON.stringify(value)) {
      throw new Error(
        "Run Record：解析后参数与快照重算结果不一致（" + code + "：装配 " +
          JSON.stringify(value) + " vs 快照 " + JSON.stringify(snapshotValue) + "）" +
          "—— 拒绝留档一份「复现出来是另一个策略」的记录",
      );
    }
  }

  return {
    strategyRunSnapshot: toMutable(snapshot),
    strategyDecision: toMutable(input.digest),
    executionMetadata: toMutable<StrategyRunExecutionMetadata>({
      decisionSource: "strategy-core",
      engineVersion,
      codeVersion: input.codeVersion,
      anchorPolicy: input.anchorPolicy,
      notes: [...input.notes],
      unmappedExitRuleIds: [...(input.unmappedExitRuleIds ?? [])],
    }),
  };
}

/**
 * 深拷贝为可变副本（运行时：`structuredClone` 产出真副本、不再是冻结对象；
 * 类型：由 `Mutable<>` 如实标注）。断言只在此处一处，语义已被上方注释登记。
 */
function toMutable<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

/** 运行级运行时配置（**由调用方按本次运行的真实观测填**，不猜）。 */
export function runtimeConfigSnapshot(input: {
  readonly startDate: string;
  readonly point: "open" | "close";
  readonly maxRelativeDayObserved: RelativeDay;
  readonly horizonRelativeDay: RelativeDay;
}): RuntimeConfigSnapshot {
  return {
    evaluationDate: input.startDate,
    evaluationPoint: input.point,
    // ⚠️ Core 的 `RuntimeConfigSnapshot.currentRelativeDay` 是**逐决策**的量，而快照是
    // **逐运行**的 ⇒ 这里记「本次观测到的最远相对日」（= 真实 horizon），逐决策的相对日
    // 记在 `strategyDecision.samples[].currentRelativeDay`。已登记为遗留项 N-05。
    currentRelativeDay: input.maxRelativeDayObserved,
    maxRelativeDay: Math.max(input.horizonRelativeDay, input.maxRelativeDayObserved),
  };
}

/** 类型守卫：`resultJson` 解析结果里是否存在 `strategyRun`（供详情页与测试判定）。 */
export function hasStrategyRunRecord(value: unknown): value is { strategyRun: StrategyRunRecord } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = (value as { strategyRun?: unknown }).strategyRun;
  return record !== null && record !== undefined && typeof record === "object" && !Array.isArray(record);
}
