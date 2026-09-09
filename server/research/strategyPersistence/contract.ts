/**
 * STEP STRATEGY-002 — Strategy Persistence 契约（Repository 接口）。
 *
 * 职责边界：
 *   - StrategyRepository 只负责策略实体（strategies）与不可变版本（strategy_versions）的存取，
 *     绝不提供「修改已存在版本内容」的入口——版本一旦落库即 immutable（§18）；
 *   - 幂等 / 指纹冲突判定在 Repository 层实现（依赖 DB 唯一约束兜底，§19）；
 *   - Service 通过接口依赖，与具体存储（内存 / DB）解耦，本契约不含任何 ViewModel 概念（§8）。
 *
 * fingerprint 语义（§6/§7/§18/§19）：
 *   - saveVersion 的幂等判定键 = StrategyDocument.fingerprint（内容指纹，稳定）；
 *   - 同 (strategyId, version) + 同 fingerprint → 幂等跳过；
 *   - 同 (strategyId, version) + 不同 fingerprint → 拒绝（conflict）；
 *   - 并发创建同一版本由 DB 唯一约束 (strategyId, version) 兜底。
 */

import type { StrategyDocument, StrategyVersionRecord } from "../strategySchema/types";

/** 策略实体摘要（列表展示，不含版本内容）。 */
export interface StrategySummary {
  readonly strategyId: string;
  readonly name: string;
  readonly latestVersion: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 版本摘要（列表展示，不含完整文档）。 */
export interface StrategyVersionSummary {
  readonly strategyId: string;
  readonly version: string;
  readonly fingerprint: string;
  readonly datasetVersion: string;
  readonly universeId: string;
  readonly codeVersion: string;
  readonly createdAt: string;
}

/** saveVersion 的结果（幂等三态）。 */
export type SaveVersionOutcome = "inserted" | "idempotent-skip" | "conflict";

export interface SaveVersionResult {
  readonly outcome: SaveVersionOutcome;
  readonly version: string;
  /** 本次写入/命中的内容指纹。 */
  readonly fingerprint: string;
  /** outcome=conflict 时，提供已存在版本的内容指纹。 */
  readonly existingFingerprint?: string;
}

/** 策略实体 upsert 输入。 */
export interface StrategyEntityInput {
  readonly strategyId: string;
  readonly name: string;
  readonly latestVersion: string;
  readonly status: string;
}

/** 版本写入输入。 */
export interface StrategyVersionInput {
  readonly strategyId: string;
  /** 已通过 validateStrategyDocument 的策略本体（含内容指纹）。 */
  readonly document: StrategyDocument;
  /** 已通过 validateStrategyVersionRecord 的 §17 追溯记录（含 createdAt/codeVersion）。 */
  readonly versionRecord: StrategyVersionRecord;
}

export interface StrategyRepository {
  // ---- 策略实体 ----
  /** upsert 策略实体（幂等：strategyId 已存在则更新 name/latestVersion/status）。 */
  saveStrategy(input: StrategyEntityInput): Promise<void>;
  getStrategy(strategyId: string): Promise<StrategySummary | undefined>;
  listStrategies(): Promise<StrategySummary[]>;
  /** 删除策略实体 + 其全部版本（级联）。删除不存在的 strategyId 抛错。 */
  deleteStrategy(strategyId: string): Promise<void>;

  // ---- 不可变版本 ----
  /** 幂等写入版本（同 fingerprint 跳过；同 version 不同 fingerprint 拒绝）。 */
  saveVersion(input: StrategyVersionInput): Promise<SaveVersionResult>;
  /** 按 (strategyId, version) 读取完整 §17 追溯记录（含 document 快照）。 */
  getVersion(strategyId: string, version: string): Promise<StrategyVersionRecord | undefined>;
  /** 列出某策略的全部版本摘要（按版本号降序）。 */
  listVersions(strategyId: string): Promise<StrategyVersionSummary[]>;
  /** 读取某策略的最新版本（按版本号语义比较，非 createdAt）。 */
  getLatestVersion(strategyId: string): Promise<StrategyVersionRecord | undefined>;
}
