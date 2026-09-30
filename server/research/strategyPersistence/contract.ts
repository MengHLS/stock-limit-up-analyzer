/**
 * STEP STRATEGY-002 / STRATEGY-003 — Strategy Persistence 契约（Repository 接口）。
 *
 * 职责边界：
 *   - StrategyRepository 只负责策略实体（strategies）与不可变版本（strategy_versions）
 *     及其**查询投影**（5 张表）的存取，绝不提供「修改已存在版本内容」的入口 ——
 *     版本一旦落库即 immutable（§18）；允许的 UPDATE 仅限于生命周期 `status`、星标元数据
 *     与谱系元数据 `parentVersionId`，版本内容 / 指纹 / 追溯记录始终不可变；
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

import type {
  StrategyParameterProjectionRow,
  StrategyProjections,
} from "../strategySchema/projection";
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
  /**
   * 版本行主键（`strategy_versions.id`）；与 `parentVersionId` 同一坐标空间，
   * 供目录投影把父版本 id 解析成可读版本号，不参与内容指纹。
   */
  readonly versionRowId: number;
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
  /**
   * 用户标记的有价值版本（展示元数据，不参与内容指纹）。
   *
   * 权威存储是 `strategy_version_star`（`(strategyId, version)` 唯一键）；版本行是版本
   * 存在的唯一来源，星标只允许绑定正式 `strategy_versions` 坐标。
   */
  readonly isStarred: boolean;
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

// ---------------------------------------------------------------------------
// FRONTEND-FINAL-001（P1-1）— loadBundle 的**只读**参数引用面扩展
// ---------------------------------------------------------------------------

/**
 * `loadBundle` 的参数投影行 = 持久化投影行 + 规则图**引用面**只读判定。
 *
 * 🔴 为什么单独开一个类型而不是改 `StrategyParameterProjectionRow`：
 *   后者与 `strategy_parameters` 表**逐列一一对应**（见 `strategySchema/projection.ts` 头注），
 *   而 `strategy_parameters` **没有** `referenced` 列 —— 直接加字段会让「投影行 == DB 行」的
 *   契约失真，并迫使 db.ts / inMemory.ts 去伪造一个落库值。
 *   ⇒ 本扩展只在 `StrategyService.loadBundle` 读取时按 canonical 文档即时判定，**不落库**。
 */
export interface StrategyParameterBundleRow extends StrategyParameterProjectionRow {
  /**
   * 该参数 code 是否被该版本规则图引用（= 执行链会不会读它）。
   *
   * ⚠️ 当 `ParameterReferenceCheckSummary.applied === false`（不可判定）时，本字段恒为 `false`，
   *   **不代表「未被引用」** —— 读取方必须先看 `applied` 再解释本字段。
   */
  readonly referenced: boolean;
}

/** `loadBundle` 的投影集合：除参数行多一个 `referenced` 外，与 `StrategyProjections` 逐字段一致。 */
export interface StrategyBundleProjections extends Omit<StrategyProjections, "parameters"> {
  readonly parameters: readonly StrategyParameterBundleRow[];
}

/**
 * 参数引用面检查的**可信度说明**（与 `referenced` 配套，二者缺一不可）。
 *
 * 🔴 存在的理由（FRONTEND-FINAL-001 规格 §六）：引用面只在「Core 版本可构造」时可判定。
 *   不可判定时**不得**把 `referenced` 默认成 `true` 或 `false` 冒充结论，
 *   必须由 `applied = false` + `note` 显性说明，前端据此显示「不可判定」而不是「未被引用」。
 */
export interface ParameterReferenceCheckSummary {
  /** 是否真的完成了引用面判定；`false` = 不可判定（此时 `referencedCodes` 与每行 `referenced` 均无意义）。 */
  readonly applied: boolean;
  /** 判定成功时：被规则图（入口 + 出场 + 声明式出场规则）引用的参数 code（去重、稳定升序）。 */
  readonly referencedCodes: readonly string[];
  /** 人读的判定口径 / 降级说明（必定非空）。 */
  readonly note: string;
}

/** `loadBundle` 的读取结果 = 既有版本包 + 参数引用面（只读派生，不落库、不改变既有字段语义）。 */
export type StrategyVersionBundleWithReferences = Omit<StrategyVersionBundle, "projections"> & {
  readonly projections: StrategyBundleProjections;
  readonly parameterReferenceCheck: ParameterReferenceCheckSummary;
};

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
  /** 读取版本的轻量状态（不反序列化文档；供实体状态同步用）。 */
  getVersionStatus(strategyId: string, version: string): Promise<string | undefined>;
  /** 判断指定版本是否为策略实体的权威当前版本（不反序列化文档）。 */
  isCurrentStrategyVersion(strategyId: string, version: string): Promise<boolean>;
  /** 读取完整版本包（canonical + 追溯记录 + 5 类投影）。 */
  getVersionBundle(strategyId: string, version: string): Promise<StrategyVersionBundle | undefined>;
  /** 迁移版本生命周期状态（唯一允许的 UPDATE；内容仍不可变）。 */
  updateVersionStatus(strategyId: string, version: string, status: string): Promise<void>;
  /**
   * 写入版本演进父链（仅更新谱系元数据 `parentVersionId`，不改版本内容与 `updatedAt`）。
   *
   * 父版本必须已存在、属于同一策略且不能是子版本自身；`null` 表示显式清空父链。
   */
  updateVersionParent(
    strategyId: string,
    version: string,
    parentVersionId: number | null,
  ): Promise<void>;
  /**
   * 读取某策略的全部已加星版本号（顺序无契约，调用方自行排序）。
   *
   * 🔴 星标是 `(strategyId, version)` 维度的**独立元数据**（`strategy_version_star`），
   * 不从 `strategy_versions.isStarred` 读取 —— 后者是 0052 的历史口径，0053 起以本方法为准。
   */
  listVersionStars(strategyId: string): Promise<string[]>;
  /**
   * 用户星标（展示元数据；内容仍不可变）。
   *
   * 🔴 只允许正式 `strategy_versions` 已存在的 `(strategyId, version)`：
   * 回测留档不是版本来源，保存留档时必须先物化正式版本。实现层在版本不存在时
   * 抛错，避免产生「正式版本目录查不到、星标却存在」的孤儿元数据。
   */
  updateVersionStarred(strategyId: string, version: string, isStarred: boolean): Promise<void>;
}
