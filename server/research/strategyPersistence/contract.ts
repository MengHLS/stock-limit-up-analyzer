/**
 * STEP STRATEGY-002 / STRATEGY-003 — Strategy Persistence 契约（Repository 接口）。
 *
 * 职责边界：
 *   - StrategyRepository 只负责策略实体（strategies）与不可变版本（strategy_versions）
 *     及其**查询投影**（5 张表）的存取，绝不提供「修改已存在版本内容」的入口 ——
 *     版本一旦落库即 immutable（§18）；唯一允许的 UPDATE 是 `status`（+ `updatedAt`）；
 *   - 幂等 / 指纹冲突判定在 Repository 层实现（依赖 DB 唯一约束兜底，§19）；
 *   - Service 通过接口依赖，与具体存储（内存 / DB）解耦，本契约不含任何 ViewModel 概念（§8）。
 *
 * 🔴 Source of Truth（STRATEGY-003 §46）：
 *   `strategy_versions.strategyDocumentJson` 是**唯一**完整 StrategyDefinition。
 *   5 张辅助表是「由 canonical Definition 单向派生」的**查询投影**：
 *   写入时同事务派生并落库；读取时只用于「按参数 / 规则 / 角色查询」。
 *   **禁止**用投影拼出第二套 Definition；需要权威语义时必须回到 canonical JSON。
 *
 * fingerprint 语义（§6/§7/§18/§19）：
 *   - saveVersion 的幂等判定键 = StrategyDocument.fingerprint（内容指纹，稳定）；
 *   - 同 (strategyId, version) + 同 fingerprint → 幂等跳过；
 *   - 同 (strategyId, version) + 不同 fingerprint → 拒绝（conflict）；
 *   - 并发创建同一版本由 DB 唯一约束 (strategyId, version) 兜底。
 */

import type { StrategyProjections } from "../strategySchema/projection";
import type { StrategyDocument, StrategyVersionRecord } from "../strategySchema/types";

/** 策略实体摘要（列表展示，不含版本内容）。 */
export interface StrategySummary {
  readonly strategyId: string;
  readonly name: string;
  /** 兼容性冗余列（= 权威当前版本指针所指版本的 version）。 */
  readonly latestVersion: string;
  readonly status: string;
  /** STEP STRATEGY-003：策略描述。 */
  readonly description: string | null;
  /** STEP STRATEGY-003：策略类型标签。 */
  readonly strategyType: string | null;
  /** STEP STRATEGY-003：**权威当前版本指针** → strategy_versions.id（软引用）。 */
  readonly currentVersionId: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 版本摘要（列表展示，不含完整文档）。 */
export interface StrategyVersionSummary {
  readonly strategyId: string;
  readonly version: string;
  readonly fingerprint: string;
  /**
   * Dataset Version 的 label / 快照（`v2`；legacy 绑定为 `rd-…`）。
   * 权威跨模块引用是 `datasetVersionId`，本字段只用于显示与快照（SPEC §2.1 A）。
   */
  readonly datasetVersion: string;
  /** 🔴 STEP STRATEGY-004：Dataset Registry 权威坐标（`dataset_version.id`）；legacy 绑定为 null。 */
  readonly datasetVersionId: number | null;
  readonly universeId: string;
  readonly codeVersion: string;
  /** STEP STRATEGY-003：版本生命周期状态（复用 C-21.1 八态）。 */
  readonly status: string;
  /** STEP STRATEGY-003：父版本（版本演进链；null = 无父）。 */
  readonly parentVersionId: number | null;
  readonly description: string | null;
  readonly createdAt: string;
}

/** 一个版本的完整读取结果（SPEC §32：调用方一次拿全，不需要手工拼装）。 */
export interface StrategyVersionBundle {
  readonly strategyId: string;
  readonly version: string;
  /** 版本行主键（软引用锚点，parentVersionId 指向它）。 */
  readonly versionRowId: number;
  readonly status: string;
  readonly parentVersionId: number | null;
  readonly description: string | null;
  readonly fingerprint: string;
  /** Canonical 策略本体（含富 `definition`；权威来源）。 */
  readonly document: StrategyDocument;
  /** §17 九项追溯记录。 */
  readonly versionRecord: StrategyVersionRecord;
  /**
   * 由 canonical Definition 单向派生的查询投影。
   * ⚠ 当 `document.definition` 缺省（历史 v1 文档）时，这里全部为空数组 / 空执行行，
   * 读取方必须回 canonical JSON 取权威语义 —— 不是「该版本没有参数」。
   */
  readonly projections: StrategyProjections;
  /** 是否存在 Canonical 富定义（= 投影是否有意义）。 */
  readonly hasDefinition: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
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
  /** outcome=inserted 时，写入的版本行主键。 */
  readonly versionRowId?: number;
  /** 本次实际写入的投影行数（inserted 且存在 Canonical definition 时 > 0）。 */
  readonly projectionRowCount?: number;
}

/** 策略实体 upsert 输入。 */
export interface StrategyEntityInput {
  readonly strategyId: string;
  readonly name: string;
  readonly latestVersion: string;
  readonly status: string;
  readonly description?: string | null;
  readonly strategyType?: string | null;
  readonly currentVersionId?: number | null;
}

/** 版本写入输入。 */
export interface StrategyVersionInput {
  readonly strategyId: string;
  /** 已通过 validateStrategyDocument 的策略本体（含内容指纹与可选富定义）。 */
  readonly document: StrategyDocument;
  /** 已通过 validateStrategyVersionRecord 的 §17 追溯记录（含 createdAt/codeVersion）。 */
  readonly versionRecord: StrategyVersionRecord;
  /** 版本生命周期状态（缺省 `Draft`，复用 C-21.1 八态）。 */
  readonly status?: string;
  /** 父版本行 id（clone 时指向源版本；缺省 null）。 */
  readonly parentVersionId?: number | null;
  /** 该版本变更说明。 */
  readonly description?: string | null;
}

export interface StrategyRepository {
  // ---- 策略实体 ----
  /** upsert 策略实体（幂等：strategyId 已存在则更新 name/latestVersion/status/description/strategyType/currentVersionId）。 */
  saveStrategy(input: StrategyEntityInput): Promise<void>;
  getStrategy(strategyId: string): Promise<StrategySummary | undefined>;
  listStrategies(): Promise<StrategySummary[]>;
  /** 删除策略实体 + 其全部版本 + 全部投影（级联）。删除不存在的 strategyId 抛错。 */
  deleteStrategy(strategyId: string): Promise<void>;

  // ---- 不可变版本 ----
  /**
   * 幂等写入版本（同 fingerprint 跳过；同 version 不同 fingerprint 拒绝）。
   *
   * STRATEGY-003：canonical 本体 + §17 追溯记录 + **由 definition 派生的 5 类投影**
   * 必须在**同一个数据库事务**内完成；任一步失败整体回滚，不允许出现
   * 「Canonical 已写入、Projection 没写入」的中间态。
   *
   * 🔴 STRATEGY-004：写入前必须在**同一事务内**执行 Dataset Binding 引用完整性校验
   * （`assertStrategyDatasetBindings`）—— 不通过即抛错回滚，不允许出现
   * 「Strategy 保存成功但 Dataset Binding 实际无效」。
   */
  saveVersion(input: StrategyVersionInput): Promise<SaveVersionResult>;
  /** 按 (strategyId, version) 读取完整 §17 追溯记录（含 document 快照）。 */
  getVersion(strategyId: string, version: string): Promise<StrategyVersionRecord | undefined>;
  /** 列出某策略的全部版本摘要（按版本号降序）。 */
  listVersions(strategyId: string): Promise<StrategyVersionSummary[]>;
  /** 读取某策略的最新版本（按版本号语义比较，非 createdAt）。 */
  getLatestVersion(strategyId: string): Promise<StrategyVersionRecord | undefined>;

  // ---- STRATEGY-003 新增 ----
  /** 读取版本行主键（软引用锚点；供 clone 写 parentVersionId 用）。 */
  getVersionRowId(strategyId: string, version: string): Promise<number | undefined>;
  /** 读取完整版本包（canonical + 追溯记录 + 5 类投影）。 */
  getVersionBundle(strategyId: string, version: string): Promise<StrategyVersionBundle | undefined>;
  /** 迁移版本生命周期状态（唯一允许的 UPDATE；内容仍不可变）。 */
  updateVersionStatus(strategyId: string, version: string, status: string): Promise<void>;
}
