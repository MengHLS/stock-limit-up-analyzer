/**
 * STEP DATASET-001 — Dataset Registry（定义 / 版本 / 构建作业）领域层 + 契约。
 *
 * 职责边界：
 *   - 只做 Dataset 定义、逻辑版本、构建作业的「生命周期」编排与存取；
 *   - 命名规范（ds_{dataset_code}_{role}）与「物理表名显式落库」在此强制（§8）；
 *   - Version 是逻辑版本（dataset_version_id 隔离），绝不创建独立物理表；
 *   - 不承载事件检测 / 路径 / outcome 计算（见 detection.ts / path.ts / builder.ts）。
 *
 * Repository 契约与具体存储解耦（内存 / DB），Service 通过接口依赖。
 */

import { randomUUID } from "node:crypto";
import {
  assertBuildDatasetTableName,
  buildDatasetTableNames,
  validateDatasetCode,
  validateVersionLabel,
} from "./naming";
import {
  assertJobTransition,
  assertVersionTransition,
  DATASET_LIFECYCLE_ERROR,
  DatasetLifecycleError,
  isVersionBuildable,
  normalizeBuildFilter,
  resolveBuildConfig,
  type JobStatus,
  type ResolvedBuildConfig,
} from "./lifecycle";
import { BUILD_FILTER_DEFAULTS } from "./filter";
import type { DatasetPhysicalStore, PhysicalDropResult, PhysicalTablePurgeResult } from "./physicalTables";
import type { DatasetPlugin, DatasetPluginRegistry } from "./plugins";
import type {
  DatasetBuildConfigRecord,
  DatasetBuildJob,
  DatasetDefinition,
  DatasetVersion,
} from "./types";

// ---------------------------------------------------------------------------
// Repository 契约
// ---------------------------------------------------------------------------

/** 作业状态转换时允许附加写入的字段（startedAt / completedAt / errorMessage）。 */
export interface JobTransitionPatch {
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
}

export interface DatasetRegistryRepository {
  // ---- Dataset Definition ----
  saveDefinition(input: DatasetDefinition): Promise<DatasetDefinition>;
  getDefinitionByCode(code: string): Promise<DatasetDefinition | undefined>;
  getDefinitionById(id: number): Promise<DatasetDefinition | undefined>;
  listDefinitions(): Promise<DatasetDefinition[]>;

  // ---- Dataset Version ----
  /** 幂等写入版本：(datasetId, version) 唯一；同 version 同内容跳过，不同内容拒绝。 */
  saveVersion(input: DatasetVersion): Promise<{ outcome: "inserted" | "idempotent-skip" | "conflict"; version: DatasetVersion }>;
  getVersion(datasetId: number, version: string): Promise<DatasetVersion | undefined>;
  getVersionById(id: number): Promise<DatasetVersion | undefined>;
  listVersions(datasetId: number): Promise<DatasetVersion[]>;
  updateVersion(id: number, patch: Partial<Pick<DatasetVersion, "status" | "totalEvents" | "totalRows" | "completedAt">>): Promise<void>;

  // ---- Dataset Build Job ----
  saveJob(input: DatasetBuildJob): Promise<DatasetBuildJob>;
  getJob(jobId: string): Promise<DatasetBuildJob | undefined>;
  getJobById(id: number): Promise<DatasetBuildJob | undefined>;
  listJobs(datasetVersionId: number): Promise<DatasetBuildJob[]>;
  /** 仅允许更新作业的进度 / 状态字段（不触碰 datasetVersionId / jobId）。 */
  updateJob(id: number, patch: Partial<Omit<DatasetBuildJob, "id" | "datasetVersionId" | "jobId">>): Promise<void>;
  /** 返回该版本当前 RUNNING 的作业（用于并发构建保护，最多一个）。 */
  getRunningJobForVersion(datasetVersionId: number): Promise<DatasetBuildJob | undefined>;
  /**
   * 列出**全库** RUNNING 的构建作业（跨数据集 / 跨版本）。
   * 用途：孤儿作业回收（`reclaimStaleJobs`）——运行态是进程内内存 map，
   * 进程退出后 DB 里的 RUNNING 作业无人接管、永不终态，会把版本永久卡在 BUILDING。
   */
  listRunningJobs(): Promise<DatasetBuildJob[]>;
  /**
   * 原子状态转换：仅当作业当前 status === from 时置为 to，并附加 patch 字段。
   * 返回是否真正发生转换（false = 已被并发请求抢先转换）。
   */
  transitionJob(id: number, from: JobStatus, to: JobStatus, patch?: JobTransitionPatch): Promise<boolean>;

  // ---- Deletion（DATASET-003A：删除版本 / 删除数据集）----
  /** 删除 Dataset 定义记录（硬删；物理表与版本的清理由 service 编排）。 */
  deleteDefinition(id: number): Promise<void>;
  /** 删除版本记录（硬删）。 */
  deleteVersion(id: number): Promise<void>;
  /** 删除某版本的全部构建作业，返回删除条数（审计记录随版本一并移除）。 */
  deleteJobsByVersion(datasetVersionId: number): Promise<number>;
  /** 该 Dataset 名下是否存在 RUNNING 作业（跨版本；删除守卫）。 */
  getRunningJobForDefinition(datasetId: number): Promise<DatasetBuildJob | undefined>;

  // ---- Build / Filter Config（DATASET-003B：筛选口径持久化，与版本 1:1）----
  /**
   * 幂等写入构建 / 筛选配置（同 datasetVersionId 重复写入 → 覆盖主表并整体替换子表）。
   * 返回落库后的完整记录（含 id）。
   */
  saveBuildConfig(input: DatasetBuildConfigRecord): Promise<DatasetBuildConfigRecord>;
  /** 读取某版本的构建 / 筛选配置；历史版本（无配置行）→ undefined（不臆造）。 */
  getBuildConfig(datasetVersionId: number): Promise<DatasetBuildConfigRecord | undefined>;
  /** 删除某版本的配置（主表 + 子表），返回删除的主表行数。 */
  deleteBuildConfigsByVersion(datasetVersionId: number): Promise<number>;
}

// ---------------------------------------------------------------------------
// 内存实现（测试 / 短生命周期）
// ---------------------------------------------------------------------------

export class InMemoryDatasetRegistry implements DatasetRegistryRepository {
  private readonly definitions = new Map<number, DatasetDefinition>();
  private readonly definitionsByCode = new Map<string, number>();
  private readonly versions = new Map<string, DatasetVersion>(); // key = datasetId:version
  private readonly versionsById = new Map<number, DatasetVersion>();
  private readonly jobs = new Map<string, DatasetBuildJob>();
  private readonly jobsById = new Map<number, DatasetBuildJob>();
  private readonly buildConfigs = new Map<number, DatasetBuildConfigRecord>();
  private nextId = 1;

  private allocateId(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  async saveDefinition(input: DatasetDefinition): Promise<DatasetDefinition> {
    const existing = this.definitionsByCode.get(input.datasetCode);
    if (existing !== undefined) {
      const current = this.definitions.get(existing)!;
      const updated: DatasetDefinition = { ...current, ...input, id: current.id };
      this.definitions.set(current.id!, updated);
      return updated;
    }
    const id = this.allocateId();
    const record: DatasetDefinition = { ...input, id };
    this.definitions.set(id, record);
    this.definitionsByCode.set(input.datasetCode, id);
    return record;
  }

  async getDefinitionByCode(code: string): Promise<DatasetDefinition | undefined> {
    const id = this.definitionsByCode.get(code);
    return id === undefined ? undefined : this.definitions.get(id);
  }

  async getDefinitionById(id: number): Promise<DatasetDefinition | undefined> {
    return this.definitions.get(id);
  }

  async listDefinitions(): Promise<DatasetDefinition[]> {
    return Array.from(this.definitions.values()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }

  async saveVersion(input: DatasetVersion): Promise<{ outcome: "inserted" | "idempotent-skip" | "conflict"; version: DatasetVersion }> {
    const key = `${input.datasetId}:${input.version}`;
    const existing = this.versions.get(key);
    if (existing) {
      // 同 (datasetId, version)：内容指纹由调用方决定是否冲突；此处简单判定（同 version 已存在 → 幂等或冲突交由上层）。
      return { outcome: "idempotent-skip", version: existing };
    }
    const id = this.allocateId();
    const record: DatasetVersion = { ...input, id };
    this.versions.set(key, record);
    this.versionsById.set(id, record);
    return { outcome: "inserted", version: record };
  }

  async getVersion(datasetId: number, version: string): Promise<DatasetVersion | undefined> {
    return this.versions.get(`${datasetId}:${version}`);
  }

  async getVersionById(id: number): Promise<DatasetVersion | undefined> {
    return this.versionsById.get(id);
  }

  async listVersions(datasetId: number): Promise<DatasetVersion[]> {
    return Array.from(this.versions.values())
      .filter((v) => v.datasetId === datasetId)
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }

  async updateVersion(id: number, patch: Partial<Pick<DatasetVersion, "status" | "totalEvents" | "totalRows" | "completedAt">>): Promise<void> {
    const current = this.versionsById.get(id);
    if (!current) throw new Error(`未找到版本：${id}`);
    this.versionsById.set(id, { ...current, ...patch });
    const key = `${current.datasetId}:${current.version}`;
    this.versions.set(key, { ...current, ...patch });
  }

  async saveJob(input: DatasetBuildJob): Promise<DatasetBuildJob> {
    const existing = this.jobs.get(input.jobId);
    if (existing) return existing;
    const id = this.allocateId();
    const record: DatasetBuildJob = { ...input, id };
    this.jobs.set(input.jobId, record);
    this.jobsById.set(id, record);
    return record;
  }

  async getJob(jobId: string): Promise<DatasetBuildJob | undefined> {
    return this.jobs.get(jobId);
  }

  async getJobById(id: number): Promise<DatasetBuildJob | undefined> {
    return this.jobsById.get(id);
  }

  async listJobs(datasetVersionId: number): Promise<DatasetBuildJob[]> {
    return Array.from(this.jobs.values())
      .filter((j) => j.datasetVersionId === datasetVersionId)
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }

  async updateJob(id: number, patch: Partial<Omit<DatasetBuildJob, "id" | "datasetVersionId" | "jobId">>): Promise<void> {
    const current = this.jobsById.get(id);
    if (!current) throw new Error(`未找到作业：${id}`);
    // updatedAt 由存储层自动刷新（与真实 DB 的 ON UPDATE CURRENT_TIMESTAMP 同语义）——
    // 孤儿作业回收以它为「是否仍在推进」的判据，故内存实现必须同样维护。
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.jobsById.set(id, updated);
    this.jobs.set(current.jobId, updated);
  }

  async getRunningJobForVersion(datasetVersionId: number): Promise<DatasetBuildJob | undefined> {
    for (const job of this.jobs.values()) {
      if (job.datasetVersionId === datasetVersionId && job.status === "RUNNING") return job;
    }
    return undefined;
  }

  async listRunningJobs(): Promise<DatasetBuildJob[]> {
    return Array.from(this.jobs.values())
      .filter((j) => j.status === "RUNNING")
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }

  async transitionJob(id: number, from: JobStatus, to: JobStatus, patch: JobTransitionPatch = {}): Promise<boolean> {
    const current = this.jobsById.get(id);
    if (!current || current.status !== from) return false;
    const updated: DatasetBuildJob = { ...current, ...patch, status: to, updatedAt: new Date().toISOString() };
    this.jobsById.set(id, updated);
    this.jobs.set(current.jobId, updated);
    return true;
  }

  async deleteDefinition(id: number): Promise<void> {
    const def = this.definitions.get(id);
    if (!def) return;
    this.definitions.delete(id);
    this.definitionsByCode.delete(def.datasetCode);
  }

  async deleteVersion(id: number): Promise<void> {
    const version = this.versionsById.get(id);
    if (!version) return;
    this.versionsById.delete(id);
    this.versions.delete(`${version.datasetId}:${version.version}`);
  }

  async deleteJobsByVersion(datasetVersionId: number): Promise<number> {
    let deleted = 0;
    for (const [jobId, job] of Array.from(this.jobs.entries())) {
      if (job.datasetVersionId !== datasetVersionId) continue;
      this.jobs.delete(jobId);
      this.jobsById.delete(job.id!);
      deleted += 1;
    }
    return deleted;
  }

  async getRunningJobForDefinition(datasetId: number): Promise<DatasetBuildJob | undefined> {
    const versionIds = new Set(
      Array.from(this.versionsById.values())
        .filter((v) => v.datasetId === datasetId)
        .map((v) => v.id!),
    );
    for (const job of this.jobs.values()) {
      if (job.status === "RUNNING" && versionIds.has(job.datasetVersionId)) return job;
    }
    return undefined;
  }

  async saveBuildConfig(input: DatasetBuildConfigRecord): Promise<DatasetBuildConfigRecord> {
    const existing = this.buildConfigs.get(input.datasetVersionId);
    const record: DatasetBuildConfigRecord = {
      ...input,
      id: existing?.id ?? this.allocateId(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.buildConfigs.set(input.datasetVersionId, record);
    return record;
  }

  async getBuildConfig(datasetVersionId: number): Promise<DatasetBuildConfigRecord | undefined> {
    return this.buildConfigs.get(datasetVersionId);
  }

  async deleteBuildConfigsByVersion(datasetVersionId: number): Promise<number> {
    return this.buildConfigs.delete(datasetVersionId) ? 1 : 0;
  }
}

// ---------------------------------------------------------------------------
// Registry Service（编排）
// ---------------------------------------------------------------------------

export interface CreateDefinitionInput {
  datasetCode: string;
  name: string;
  description?: string | null;
  datasetType: "EVENT" | "FACTOR" | "ML" | "RESEARCH";
  storageType?: "DATABASE";
  /** 显式覆盖物理表名；缺省按 ds_{dataset_code}_{role} 派生。 */
  tableNames?: { event?: string; prefix?: string; post?: string; path?: string; outcome?: string; feature?: string | null };
}

/** 生成稳定格式的构建作业 id（与既有 ds001-<version>-<ts> 约定一致，附加随机后缀防碰撞）。 */
function generateJobId(version: DatasetVersion): string {
  return `ds001-${version.version}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export interface DatasetRegistryServiceOptions {
  /**
   * 构建插件注册表（多数据集架构）。
   * 提供时：`createDefinition` 在插件已注册的情况下**即时建立物理表**；
   *        `createJob` / `startJob` 会前置校验「该 datasetCode 有构建插件」，否则抛 `BUILDER_NOT_REGISTERED`。
   */
  plugins?: DatasetPluginRegistry;
  /**
   * 物理表存储（建表 / 清版本数据 / 删表）。
   * 提供时：`deleteVersion` / `deleteDefinition` 会真实清理物理数据；
   *        未提供时（纯状态机测试）删除类方法抛错，不静默跳过（防止「以为删了其实没删」）。
   */
  physicalStore?: DatasetPhysicalStore;
}

/**
 * 孤儿构建作业的默认停更阈值（分钟）。
 * 构建器每个 chunk 都会刷新 `dataset_build_job.updatedAt`，正常间隔为秒级；
 * 超过该阈值仍无更新 ⇒ 执行者进程已不存在。
 */
export const DEFAULT_STALE_BUILD_MINUTES = 10;

/** 「清空某版本数据行」的结果（诚实回报实际清理量）。 */
export interface VersionRollbackResult {
  datasetVersionId: number;
  /** 删除的物理表数据行合计。 */
  purgedRows: number;
  /** 各物理表删除明细（表不存在时 deleted=0 / tableMissing=true）。 */
  tables: PhysicalTablePurgeResult[];
}

/** 「取消并回滚」的结果。 */
export interface CancelJobRollbackResult {
  /** 取消后的作业（终态 CANCELLED）。 */
  job: DatasetBuildJob;
  /**
   * 回滚明细；`null` = 按语义**不应清空**（见 `rollbackSkippedReason`），不是「清理了 0 行」。
   */
  rollback: VersionRollbackResult | null;
  /** 未回滚的原因；未跳过时为 null（诚实说明，不静默）。 */
  rollbackSkippedReason: string | null;
  /** true = 本次调用时作业已是 CANCELLED，仅补做回滚（幂等重试）。 */
  alreadyCancelled: boolean;
}

/** 单个孤儿作业的回收结果。 */
export interface ReclaimStaleJobResult {
  jobId: string;
  datasetVersionId: number;
  /** 回收时已停更的分钟数。 */
  staleMinutes: number;
  /** 一并清空的该版本数据行数。 */
  purgedRows: number;
  /** true = 未回滚（版本仍是 READY，本轮未接管 ⇒ 原数据保持有效）。 */
  rollbackSkipped: boolean;
}

/** 删除版本的结果（诚实回报实际清理的数据量）。 */
export interface DeleteVersionResult {
  datasetVersionId: number;
  datasetId: number;
  version: string;
  /** 删除的物理表数据行合计。 */
  purgedRows: number;
  /** 各物理表删除明细（表不存在时 deleted=0 / tableMissing=true）。 */
  tables: PhysicalTablePurgeResult[];
  /** 删除的构建作业条数。 */
  jobsDeleted: number;
  /** 删除的构建 / 筛选配置行数（DATASET-003B；0 = 该版本无配置行）。 */
  configsDeleted: number;
}

/** 删除 Dataset 的结果（级联统计）。 */
export interface DeleteDefinitionResult {
  definitionId: number;
  datasetCode: string;
  versionsDeleted: number;
  purgedRows: number;
  jobsDeleted: number;
  /** 删除的构建 / 筛选配置行数（DATASET-003B）。 */
  configsDeleted: number;
  /** DROP 掉的物理表清单（表结构随数据集一并删除）。 */
  droppedTables: PhysicalDropResult[];
}

export class DatasetRegistryService {
  private readonly repo: DatasetRegistryRepository;
  private readonly plugins: DatasetPluginRegistry | null;
  private readonly physicalStore: DatasetPhysicalStore | null;

  constructor(repo: DatasetRegistryRepository, options: DatasetRegistryServiceOptions = {}) {
    this.repo = repo;
    this.plugins = options.plugins ?? null;
    this.physicalStore = options.physicalStore ?? null;
  }

  /** 该 datasetCode 是否具备构建能力（已注册插件）。 */
  isBuildable(datasetCode: string): boolean {
    return this.plugins?.has(datasetCode) ?? false;
  }

  /** 取构建插件；未注册 → 稳定错误码（不静默回退到别的构建器）。 */
  private requirePlugin(datasetCode: string): DatasetPlugin {
    const plugin = this.plugins?.get(datasetCode);
    if (!plugin) {
      throw new DatasetLifecycleError(
        DATASET_LIFECYCLE_ERROR.BUILDER_NOT_REGISTERED,
        `数据集 "${datasetCode}" 没有已注册的构建插件（无物理表结构与构建器），无法构建`,
      );
    }
    return plugin;
  }

  private requirePhysicalStore(): DatasetPhysicalStore {
    if (!this.physicalStore) {
      throw new Error("未注入 DatasetPhysicalStore，无法执行物理数据清理（生产必须注入 DbDatasetPhysicalStore）");
    }
    return this.physicalStore;
  }

  /**
   * 创建 Dataset Definition（§6/§8）。
   * 强制：datasetCode 合法（naming 校验）；物理表名显式落库（不运行时猜名）。
   *
   * 多数据集（DATASET-003A）：若该 datasetCode 已注册构建插件且注入了物理表存储，
   * 则在落库前**幂等建立该数据集的物理表**（先建表后落库，建表失败不留下「有定义无表」的脏定义）。
   * 未注册插件时仅登记定义（状态 ACTIVE、buildable=false），构建入口会被明确拒绝。
   */
  async createDefinition(input: CreateDefinitionInput): Promise<DatasetDefinition> {
    const issues = validateDatasetCode(input.datasetCode);
    if (issues.length > 0) {
      throw new DatasetLifecycleError(
        DATASET_LIFECYCLE_ERROR.INVALID_DATASET_CODE,
        `非法 datasetCode："${input.datasetCode}"；${issues.join("；")}`,
      );
    }
    const existing = await this.repo.getDefinitionByCode(input.datasetCode);
    if (existing) {
      throw new DatasetLifecycleError(
        DATASET_LIFECYCLE_ERROR.DEFINITION_ALREADY_EXISTS,
        `Dataset 定义已存在（datasetCode 唯一）：${input.datasetCode}`,
      );
    }
    const derived = buildDatasetTableNames(input.datasetCode);
    const tableNames = input.tableNames ?? {};
    // 显式表名仍强制等于命名规范派生值（禁止外部绕过 ds_{code}_{role}）。
    const eventTableName = tableNames.event ?? derived.event;
    const prefixTableName = tableNames.prefix ?? derived.prefix;
    const postTableName = tableNames.post ?? derived.post;
    const pathTableName = tableNames.path ?? derived.path;
    const outcomeTableName = tableNames.outcome ?? derived.outcome;
    const featureTableName = tableNames.feature ?? null;
    for (const [role, explicit, expected] of [
      ["event", tableNames.event, derived.event],
      ["prefix", tableNames.prefix, derived.prefix],
      ["post", tableNames.post, derived.post],
      ["path", tableNames.path, derived.path],
      ["outcome", tableNames.outcome, derived.outcome],
    ] as const) {
      if (explicit !== undefined && explicit !== expected) {
        throw new DatasetLifecycleError(
          DATASET_LIFECYCLE_ERROR.INVALID_DATASET_CODE,
          `显式表名非法（必须为 ${expected}）：role=${role} 实际=${explicit}`,
        );
      }
    }

    const draft: DatasetDefinition = {
      datasetCode: input.datasetCode,
      name: input.name,
      description: input.description ?? null,
      datasetType: input.datasetType,
      storageType: input.storageType ?? "DATABASE",
      status: "ACTIVE",
      eventTableName,
      prefixTableName,
      postTableName,
      pathTableName,
      outcomeTableName,
      featureTableName,
    };

    // 先建表（若插件已注册），再落库——避免「定义已落库但物理表建立失败」的半成品状态。
    const plugin = this.plugins?.get(input.datasetCode);
    if (plugin && this.physicalStore) {
      await this.physicalStore.ensureTables(draft, plugin);
    }

    return this.repo.saveDefinition(draft);
  }

  /**
   * 更新 Definition 的可变字段（name / description）。
   * datasetCode 与物理表名不可变（命名规范铁律），故不接受入参覆盖。
   */
  async updateDefinition(input: { definitionId: number; name?: string; description?: string | null }): Promise<DatasetDefinition> {
    const def = await this.repo.getDefinitionById(input.definitionId);
    if (!def) throw new Error(`未找到 Dataset 定义：${input.definitionId}`);
    const patch: Partial<DatasetDefinition> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    return this.repo.saveDefinition({ ...def, ...patch });
  }

  /** 归档 Definition（status → ARCHIVED；datasetCode 与表名不变）。 */
  async archiveDefinition(definitionId: number): Promise<DatasetDefinition> {
    const def = await this.repo.getDefinitionById(definitionId);
    if (!def) throw new Error(`未找到 Dataset 定义：${definitionId}`);
    return this.repo.saveDefinition({ ...def, status: "ARCHIVED" });
  }

  /** 创建逻辑版本（§9/§10）：(datasetId, version) 唯一，版本不是物理表。 */
  async createVersion(input: Omit<DatasetVersion, "id" | "status">): Promise<DatasetVersion> {
    const def = await this.repo.getDefinitionById(input.datasetId);
    if (!def) {
      throw new DatasetLifecycleError(
        DATASET_LIFECYCLE_ERROR.DEFINITION_NOT_FOUND,
        `未找到 Dataset 定义：${input.datasetId}`,
      );
    }
    const labelIssues = validateVersionLabel(input.version);
    if (labelIssues.length > 0) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.INVALID_VERSION_LABEL, labelIssues.join("；"));
    }
    const existing = await this.repo.getVersion(input.datasetId, input.version);
    if (existing) {
      throw new DatasetLifecycleError(
        DATASET_LIFECYCLE_ERROR.VERSION_ALREADY_EXISTS,
        `版本已存在（(datasetId, version) 唯一）：${input.datasetId}@${input.version}`,
      );
    }
    return (await this.repo.saveVersion({ ...input, status: "DRAFT" })).version;
  }

  /**
   * 创建逻辑版本并**固化构建配置**（供「构建新版本」入口使用）。
   *
   * 与 `createVersion` 的区别：入参是面向业务的构建窗口 + 构建参数，本方法负责
   * 组装 `universeDefinition` / `filterDefinition`（构建执行器 `runner.ts` 据此运行），
   * 不让 router / 前端拼装领域 JSON。
   *
   * 校验：定义存在且未归档 → 版本标签形态 → (datasetId, version) 唯一。
   */
  async createVersionWithBuildConfig(input: {
    datasetId: number;
    version: string;
    startDate: string;
    endDate: string;
    /** 筛选 + 执行参数（未完成筛选配置不得建版本；由 normalizeBuildFilter 权威校验）。 */
    filter: unknown;
  }): Promise<DatasetVersion> {
    const def = await this.repo.getDefinitionById(input.datasetId);
    if (!def) {
      throw new DatasetLifecycleError(
        DATASET_LIFECYCLE_ERROR.DEFINITION_NOT_FOUND,
        `未找到 Dataset 定义：${input.datasetId}`,
      );
    }
    if (def.status === "ARCHIVED") {
      throw new DatasetLifecycleError(
        DATASET_LIFECYCLE_ERROR.DEFINITION_ARCHIVED,
        `Dataset 定义已归档（${def.datasetCode}），不可新建版本`,
      );
    }

    // 1) 权威规范化（非法即抛 INVALID_BUILD_FILTER，不静默夹取）。
    const normalized = normalizeBuildFilter(input.filter);

    // 2) 建逻辑版本 DRAFT；同时写 legacy 镜像（universeDefinition / filterDefinition），
    //    供审计与「配置行缺失时」的解析回退。真实权威来源是 dataset_build_config。
    const version = await this.createVersion({
      datasetId: input.datasetId,
      version: input.version,
      startDate: input.startDate,
      endDate: input.endDate,
      universeDefinition: {
        universe: "all-a-shares",
        source: "stock_daily_prices",
        boards: normalized.boards,
        excludeSt: normalized.excludeSt,
      },
      filterDefinition: {
        kind: "build-config",
        builder: def.datasetCode,
        configVersion: normalized.configVersion,
        events: normalized.events,
        preWindowDays: normalized.preWindowDays,
        postWindowDays: normalized.postWindowDays,
        pathHorizon: normalized.postWindowDays,
        outcomeHorizons: normalized.outcomeHorizons,
        batchSize: normalized.batchSize,
      },
      featureVersion: null,
      sourceVersion: null,
      totalEvents: null,
      totalRows: null,
    });

    // 3) 固化筛选配置行（与版本 1:1）。版本 id 必须已分配，否则不静默跳过。
    if (version.id === undefined) {
      throw new DatasetLifecycleError(
        DATASET_LIFECYCLE_ERROR.VERSION_NOT_FOUND,
        `版本已创建但未返回 id（${input.datasetId}/${input.version}），无法固化筛选配置`,
      );
    }
    await this.repo.saveBuildConfig({ ...normalized, datasetVersionId: version.id });
    return version;
  }

  /** 读取某版本已固化的筛选配置（无配置行 → undefined，不臆造）。 */
  async getBuildConfig(datasetVersionId: number): Promise<DatasetBuildConfigRecord | undefined> {
    return this.repo.getBuildConfig(datasetVersionId);
  }

  /** 解析某版本的构建配置（配置行 → legacy 镜像 → 权威默认；构建执行前调用）。 */
  async resolveBuildConfigForVersion(datasetVersionId: number): Promise<ResolvedBuildConfig> {
    const version = await this.repo.getVersionById(datasetVersionId);
    if (!version) {
      throw new DatasetLifecycleError(
        DATASET_LIFECYCLE_ERROR.VERSION_NOT_FOUND,
        `未找到 Dataset 版本：${datasetVersionId}`,
      );
    }
    const configRow = await this.repo.getBuildConfig(datasetVersionId);
    return resolveBuildConfig(version, configRow ?? null);
  }

  /** 标记版本进入构建态（DRAFT / FAILED / READY → BUILDING，非法转换拒绝）。 */
  async markBuilding(versionId: number): Promise<void> {
    const v = await this.repo.getVersionById(versionId);
    if (!v) throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.VERSION_NOT_FOUND, `未找到 Dataset 版本：${versionId}`);
    assertVersionTransition(v.status!, "BUILDING");
    await this.repo.updateVersion(versionId, { status: "BUILDING" });
  }

  /** 标记版本完成（BUILDING → READY），并写入统计。 */
  async markReady(versionId: number, totals: { totalEvents: number; totalRows: number }): Promise<void> {
    const v = await this.repo.getVersionById(versionId);
    if (!v) throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.VERSION_NOT_FOUND, `未找到 Dataset 版本：${versionId}`);
    assertVersionTransition(v.status!, "READY");
    await this.repo.updateVersion(versionId, {
      status: "READY",
      totalEvents: totals.totalEvents,
      totalRows: totals.totalRows,
      completedAt: new Date().toISOString(),
    });
  }

  /** 标记版本失败（BUILDING → FAILED）。 */
  async markFailed(versionId: number): Promise<void> {
    const v = await this.repo.getVersionById(versionId);
    if (!v) throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.VERSION_NOT_FOUND, `未找到 Dataset 版本：${versionId}`);
    assertVersionTransition(v.status!, "FAILED");
    await this.repo.updateVersion(versionId, { status: "FAILED" });
  }

  /**
   * 创建一个 PENDING 构建作业（不启动）。
   * 校验：版本存在 + 可构建（DRAFT/FAILED/READY，BUILDING 拒绝）。
   */
  async createJob(versionId: number): Promise<DatasetBuildJob> {
    const v = await this.repo.getVersionById(versionId);
    if (!v) throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.VERSION_NOT_FOUND, `未找到 Dataset 版本：${versionId}`);
    if (!isVersionBuildable(v.status!)) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.VERSION_NOT_BUILDABLE, `版本 ${v.version} 当前状态 ${v.status} 不可创建构建作业`);
    }
    // 前置「构建能力」校验：未注册插件的数据集不允许建作业（避免建了永远跑不起来的作业）。
    const definition = await this.repo.getDefinitionById(v.datasetId);
    if (!definition) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.DEFINITION_NOT_FOUND, `未找到 Dataset 定义：${v.datasetId}`);
    }
    this.requirePlugin(definition.datasetCode);
    return this.repo.saveJob({
      datasetVersionId: versionId,
      jobId: generateJobId(v),
      status: "PENDING",
      processedRows: 0,
      failedRows: 0,
    });
  }

  /**
   * 启动一个 PENDING 构建作业（PENDING → RUNNING）。
   * 校验（§六，禁止直接 UPDATE status=RUNNING）：
   *   1. 作业存在；2. 版本存在；3. 作业状态为 PENDING；4. 版本可构建（非 BUILDING）；
   *   5. 版本不存在另一个 RUNNING 作业。
   * 原子性：作业状态转换走 repo.transitionJob（条件 UPDATE，防并发重复 start）。
   * 注意：版本 → BUILDING 由构建服务显式调用 markBuilding（与作业状态机解耦，见 runDataset001Build.mts）。
   */
  async startJob(jobId: string): Promise<DatasetBuildJob> {
    const job = await this.repo.getJob(jobId);
    if (!job) throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.JOB_NOT_FOUND, `未找到构建作业：${jobId}`);
    const version = await this.repo.getVersionById(job.datasetVersionId);
    if (!version) throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.VERSION_NOT_FOUND, `未找到 Dataset 版本：${job.datasetVersionId}`);
    assertJobTransition(job.status!, "RUNNING");
    if (!isVersionBuildable(version.status!)) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.VERSION_NOT_BUILDABLE, `版本 ${version.version} 当前状态 ${version.status} 不可开始构建`);
    }
    // 构建能力前置校验（未注册插件 → BUILDER_NOT_REGISTERED，不置 RUNNING 假象）。
    const definition = await this.repo.getDefinitionById(version.datasetId);
    if (!definition) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.DEFINITION_NOT_FOUND, `未找到 Dataset 定义：${version.datasetId}`);
    }
    this.requirePlugin(definition.datasetCode);
    const running = await this.repo.getRunningJobForVersion(job.datasetVersionId);
    if (running && running.id !== job.id) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.JOB_ALREADY_RUNNING, `版本已存在运行中的作业：${running.jobId}`);
    }
    const transitioned = await this.repo.transitionJob(job.id!, "PENDING", "RUNNING", { startedAt: new Date().toISOString() });
    if (!transitioned) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.INVALID_JOB_TRANSITION, `作业 ${jobId} 已被并发启动或状态已变更，无法启动`);
    }
    return (await this.repo.getJob(jobId))!;
  }

  /**
   * 取消构建作业（PENDING / RUNNING → CANCELLED；terminal 拒绝）。
   * RUNNING 作业被取消时，联动把版本 BUILDING → FAILED（schema 无 CANCELLED 版本态，
   * 取消后版本落点用 FAILED，可再 FAILED → BUILDING 重试）。
   */
  async cancelJob(jobId: string): Promise<DatasetBuildJob> {
    const job = await this.repo.getJob(jobId);
    if (!job) throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.JOB_NOT_FOUND, `未找到构建作业：${jobId}`);
    assertJobTransition(job.status!, "CANCELLED");
    const wasRunning = job.status === "RUNNING";
    const transitioned = await this.repo.transitionJob(job.id!, job.status!, "CANCELLED", {
      completedAt: new Date().toISOString(),
      errorMessage: "cancelled by user",
    });
    if (!transitioned) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.INVALID_JOB_TRANSITION, `作业 ${jobId} 状态已变更，无法取消`);
    }
    if (wasRunning) {
      const version = await this.repo.getVersionById(job.datasetVersionId);
      if (version && version.status === "BUILDING") {
        await this.repo.updateVersion(version.id!, { status: "FAILED" });
      }
    }
    return (await this.repo.getJob(jobId))!;
  }

  // -------------------------------------------------------------------------
  // 取消即回滚（DATASET-LIFECYCLE-001 根治）
  // -------------------------------------------------------------------------

  /**
   * 清空某版本的**全部物理表数据行**（保留表结构，其它版本不受影响）。
   *
   * 未注入 `physicalStore` → 抛错（**不静默跳过**，防止「以为删了其实没删」）。
   * 幂等：可重复调用，已空则返回 0。
   */
  async purgeVersionRows(datasetVersionId: number): Promise<VersionRollbackResult> {
    const version = await this.repo.getVersionById(datasetVersionId);
    if (!version) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.VERSION_NOT_FOUND, `未找到 Dataset 版本：${datasetVersionId}`);
    }
    const definition = await this.repo.getDefinitionById(version.datasetId);
    if (!definition) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.DEFINITION_NOT_FOUND, `未找到 Dataset 定义：${version.datasetId}`);
    }
    const store = this.requirePhysicalStore();
    const tables = await store.purgeVersionRows(definition, datasetVersionId);
    return {
      datasetVersionId,
      purgedRows: tables.reduce((sum, t) => sum + t.deleted, 0),
      tables,
    };
  }

  /**
   * **取消构建并回滚该版本已落库的数据**（唯一权威的用户可见取消入口）。
   *
   * 语义：取消**不是暂停，而是回滚** ——
   *   1. 作业 PENDING / RUNNING → CANCELLED；
   *   2. 版本 BUILDING → FAILED（FAILED 可再 → BUILDING，故取消后可直接重建）；
   *   3. 该版本 `ds_*` 全部数据行清空（表结构保留），使「取消后重建」不可能出现新旧混合数据。
   *
   * **例外（不让「回滚」变成数据销毁）**：若版本仍为 READY，说明本轮构建**尚未接管**
   * （清场在 `markBuilding` 之后，见下方注释）⇒ 原数据保持有效、**不回滚**，
   * 并以 `rollback=null` + `rollbackSkippedReason` 诚实回报。
   *
   * 幂等：作业已是 CANCELLED 时**不再抛错**，只重做回滚 —— 供「首次回滚失败 / 执行体未及时停止」
   * 后重试取消使用（否则用户会卡在「作业已取消但数据还在，也无法再次取消」）。
   * 守卫：COMPLETED / FAILED 作业仍拒绝（INVALID_JOB_TRANSITION），不冒充可取消。
   *
   * ⚠️ **调用前置**：必须确保构建执行体已停止（`runner.waitForStop` 返回 true），
   * 否则在途 INSERT 会在回滚之后落库，留下残余数据。
   */
  async cancelJobAndRollback(jobId: string): Promise<CancelJobRollbackResult> {
    const existing = await this.repo.getJob(jobId);
    if (!existing) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.JOB_NOT_FOUND, `未找到构建作业：${jobId}`);
    }
    const alreadyCancelled = existing.status === "CANCELLED";
    const job = alreadyCancelled ? existing : await this.cancelJob(jobId);

    // 版本态兜底修复（幂等）：取消的落点必须是 FAILED，否则版本会卡在 BUILDING
    //   → 既不能重建（VERSION_NOT_BUILDABLE）也不能删除（VERSION_HAS_RUNNING_JOB）。
    const version = await this.repo.getVersionById(existing.datasetVersionId);
    const takeover = version?.status === "BUILDING";
    if (takeover && version) {
      await this.repo.updateVersion(version.id!, { status: "FAILED" });
    }

    // 🔴 为什么 READY 版本**不能**回滚：
    //   `runner.execute` 的执行顺序是
    //     markBuilding(版本 → BUILDING) → 解析插件/配置 → **purgeVersionRows** → build
    //   清场发生在 markBuilding **之后** ⇒ 「版本仍是 READY」必然意味着本轮既未清场、也未写入任何行
    //   ⇒ 该版本既有数据仍然完整有效。此时清空会制造「status=READY 但 0 行」的**谎报态**
    //   （有效数据集被静默销毁，下游读到一个「空但可用」的版本）。
    //   DRAFT / FAILED / BUILDING 三态都可能带本轮或上轮残留行 ⇒ 必须清。
    //   （用户视角：点了重建又立刻取消 = 本轮还没开始，原版本继续可用，符合直觉。）
    if (!takeover && version?.status === "READY") {
      return {
        job: (await this.repo.getJob(jobId))!,
        rollback: null,
        rollbackSkippedReason:
          "本轮构建尚未接管该版本（版本仍为 READY，构建前清场尚未执行），原有数据保持有效、未做回滚。",
        alreadyCancelled,
      };
    }

    const rollback = await this.purgeVersionRows(existing.datasetVersionId);
    return { job: (await this.repo.getJob(jobId))!, rollback, rollbackSkippedReason: null, alreadyCancelled };
  }

  /**
   * **回收孤儿构建作业**（进程重启/热重载后 RUNNING 但无人执行的作业）。
   *
   * 运行态与取消标志是**进程内内存 map**：进程退出后 DB 里状态仍为 RUNNING 的作业
   * 无人接管、永不终态 ⇒ 版本永久卡 BUILDING（`createJob` 报 VERSION_NOT_BUILDABLE、
   * `deleteVersion` 报 VERSION_HAS_RUNNING_JOB）= **死锁**。
   *
   * 判据（保守，宁可不回收也不误杀）：
   *   - 作业状态 RUNNING；
   *   - 且 `updatedAt ?? startedAt` 早于 `now - staleMinutes`（构建器每个 chunk 都会刷新进度，
   *     长时间停更即「无写入者」的充分证据）；
   *   - 无时间基准（两者皆空）→ **跳过**，不敢回收。
   *
   * 动作：作业 → CANCELLED（条件转换，防与真实执行者竞争）→ 版本 BUILDING → FAILED →
   *       清空该版本数据行（与「取消即回滚」同语义）。
   *
   * @param options.staleMinutes 停更阈值（分钟）；`<= 0` → 整体跳过（返回空数组）。
   * @param options.now 注入时钟（测试用，缺省取当前时间）。
   */
  async reclaimStaleJobs(options: { staleMinutes?: number; now?: Date } = {}): Promise<ReclaimStaleJobResult[]> {
    const staleMinutes = options.staleMinutes ?? DEFAULT_STALE_BUILD_MINUTES;
    if (staleMinutes <= 0) return [];
    const now = options.now ?? new Date();
    const cutoff = now.getTime() - staleMinutes * 60_000;
    const running = await this.repo.listRunningJobs();
    const results: ReclaimStaleJobResult[] = [];
    for (const job of running) {
      const reference = job.updatedAt ?? job.startedAt ?? null;
      const at = reference ? Date.parse(reference) : Number.NaN;
      if (!Number.isFinite(at)) continue; // 无时间基准 → 不回收（诚实）
      if (at > cutoff) continue; // 仍在刷新进度 → 视为存活
      const transitioned = await this.repo.transitionJob(job.id!, "RUNNING", "CANCELLED", {
        completedAt: now.toISOString(),
        errorMessage: `orphan reclaimed：停更 ${Math.round((now.getTime() - at) / 60_000)} 分钟无进度更新`,
      });
      if (!transitioned) continue; // 已被真实执行者 / 并发请求改变状态 → 不重复处理
      const version = await this.repo.getVersionById(job.datasetVersionId);
      const takeover = version?.status === "BUILDING";
      if (takeover && version) {
        await this.repo.updateVersion(version.id!, { status: "FAILED" });
      }
      // 与 `cancelJobAndRollback` 同一判据：版本仍是 READY ⇒ 本轮未接管 ⇒ 原数据有效，不回滚。
      if (!takeover && version?.status === "READY") {
        results.push({
          jobId: job.jobId,
          datasetVersionId: job.datasetVersionId,
          staleMinutes: Math.round((now.getTime() - at) / 60_000),
          purgedRows: 0,
          rollbackSkipped: true,
        });
        continue;
      }
      const rollback = await this.purgeVersionRows(job.datasetVersionId);
      results.push({
        jobId: job.jobId,
        datasetVersionId: job.datasetVersionId,
        staleMinutes: Math.round((now.getTime() - at) / 60_000),
        purgedRows: rollback.purgedRows,
        rollbackSkipped: false,
      });
    }
    return results;
  }

  /** 推进作业进度（checkpoint 落库；不改变状态机，仅进度字段）。 */
  async updateJobProgress(jobId: string, patch: Partial<Omit<DatasetBuildJob, "id" | "datasetVersionId" | "jobId">>): Promise<void> {
    const job = await this.repo.getJob(jobId);
    if (!job) throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.JOB_NOT_FOUND, `未找到构建作业：${jobId}`);
    await this.repo.updateJob(job.id!, patch);
  }

  /** 完成作业（RUNNING → COMPLETED；非 RUNNING 拒绝）。 */
  async completeJob(jobId: string): Promise<void> {
    const job = await this.repo.getJob(jobId);
    if (!job) throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.JOB_NOT_FOUND, `未找到构建作业：${jobId}`);
    assertJobTransition(job.status!, "COMPLETED");
    const transitioned = await this.repo.transitionJob(job.id!, "RUNNING", "COMPLETED", { completedAt: new Date().toISOString() });
    if (!transitioned) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.INVALID_JOB_TRANSITION, `作业 ${jobId} 状态已变更，无法完成`);
    }
  }

  /** 失败作业（RUNNING → FAILED；非 RUNNING 拒绝）。 */
  async failJob(jobId: string, errorMessage: string): Promise<void> {
    const job = await this.repo.getJob(jobId);
    if (!job) throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.JOB_NOT_FOUND, `未找到构建作业：${jobId}`);
    assertJobTransition(job.status!, "FAILED");
    const transitioned = await this.repo.transitionJob(job.id!, "RUNNING", "FAILED", {
      errorMessage,
      completedAt: new Date().toISOString(),
    });
    if (!transitioned) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.INVALID_JOB_TRANSITION, `作业 ${jobId} 状态已变更，无法置为失败`);
    }
  }

  /**
   * 重试一个 FAILED / CANCELLED 作业：新建一个 PENDING 作业（新 jobId），历史作业保留不覆盖。
   * 版本需处于可构建态（FAILED/READY/DRAFT）。
   */
  async retryJob(jobId: string): Promise<DatasetBuildJob> {
    const job = await this.repo.getJob(jobId);
    if (!job) throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.JOB_NOT_FOUND, `未找到构建作业：${jobId}`);
    if (job.status !== "FAILED" && job.status !== "CANCELLED") {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.INVALID_JOB_TRANSITION, `仅 FAILED / CANCELLED 作业可重试（当前 ${job.status}）`);
    }
    const version = await this.repo.getVersionById(job.datasetVersionId);
    if (!version) throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.VERSION_NOT_FOUND, `未找到 Dataset 版本：${job.datasetVersionId}`);
    if (!isVersionBuildable(version.status!)) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.VERSION_NOT_BUILDABLE, `版本 ${version.version} 当前状态 ${version.status} 不可重试构建`);
    }
    return this.repo.saveJob({
      datasetVersionId: job.datasetVersionId,
      jobId: generateJobId(version),
      status: "PENDING",
      processedRows: 0,
      failedRows: 0,
    });
  }

  // -------------------------------------------------------------------------
  // 删除能力（DATASET-003A）
  // -------------------------------------------------------------------------

  /**
   * 删除一个 Dataset 版本（**保留表结构**，只删数据）。
   *
   * 顺序（先守卫 → 再清数据 → 最后删记录，保证中途失败不产生「记录已删但数据残留」）：
   *   1. 版本存在（否则 VERSION_NOT_FOUND）；
   *   2. 不存在 RUNNING 作业（否则 VERSION_HAS_RUNNING_JOB，先取消或等待结束）；
   *   3. 物理表按 datasetVersionId 分批删除数据行（表结构保留，其它版本不受影响）；
   *   4. 删除该版本全部构建作业（审计记录随版本移除）；
   *   5. 删除版本记录。
   */
  async deleteVersion(datasetVersionId: number): Promise<DeleteVersionResult> {
    const version = await this.repo.getVersionById(datasetVersionId);
    if (!version) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.VERSION_NOT_FOUND, `未找到 Dataset 版本：${datasetVersionId}`);
    }
    const running = await this.repo.getRunningJobForVersion(datasetVersionId);
    if (running) {
      throw new DatasetLifecycleError(
        DATASET_LIFECYCLE_ERROR.VERSION_HAS_RUNNING_JOB,
        `版本存在运行中的构建作业（${running.jobId}），请先取消或等待结束后再删除`,
      );
    }
    const definition = await this.repo.getDefinitionById(version.datasetId);
    if (!definition) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.DEFINITION_NOT_FOUND, `未找到 Dataset 定义：${version.datasetId}`);
    }
    const store = this.requirePhysicalStore();
    const tables = await store.purgeVersionRows(definition, datasetVersionId);
    const jobsDeleted = await this.repo.deleteJobsByVersion(datasetVersionId);
    const configsDeleted = await this.repo.deleteBuildConfigsByVersion(datasetVersionId);
    await this.repo.deleteVersion(datasetVersionId);
    return {
      datasetVersionId,
      datasetId: version.datasetId,
      version: version.version,
      purgedRows: tables.reduce((sum, t) => sum + t.deleted, 0),
      tables,
      jobsDeleted,
      configsDeleted,
    };
  }

  /**
   * 删除整个 Dataset（级联：所有版本数据 + 所有作业 + **DROP 物理表结构** + 定义记录）。
   *
   * 顺序（守卫 → 逐版本清数据 → 删表 → 删定义）：
   *   1. 定义存在（否则 DEFINITION_NOT_FOUND）；
   *   2. 该 Dataset 名下不存在 RUNNING 作业（否则 DEFINITION_HAS_RUNNING_JOB）；
   *   3. 逐版本：清物理数据行 + 删作业 + 删版本记录；
   *   4. DROP 该数据集的全部物理表（表结构一并删除，符合「删数据集连表结构一起删」语义）；
   *   5. 删除定义记录（datasetCode 释放，可用同 code 重建，重建时由插件重新建表）。
   */
  async deleteDefinition(definitionId: number): Promise<DeleteDefinitionResult> {
    const definition = await this.repo.getDefinitionById(definitionId);
    if (!definition) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.DEFINITION_NOT_FOUND, `未找到 Dataset 定义：${definitionId}`);
    }
    const running = await this.repo.getRunningJobForDefinition(definitionId);
    if (running) {
      throw new DatasetLifecycleError(
        DATASET_LIFECYCLE_ERROR.DEFINITION_HAS_RUNNING_JOB,
        `数据集存在运行中的构建作业（${running.jobId}），请先取消或等待结束后再删除`,
      );
    }
    const store = this.requirePhysicalStore();
    const versions = await this.repo.listVersions(definitionId);
    let purgedRows = 0;
    let jobsDeleted = 0;
    let configsDeleted = 0;
    for (const v of versions) {
      const tables = await store.purgeVersionRows(definition, v.id!);
      purgedRows += tables.reduce((sum, t) => sum + t.deleted, 0);
      jobsDeleted += await this.repo.deleteJobsByVersion(v.id!);
      configsDeleted += await this.repo.deleteBuildConfigsByVersion(v.id!);
      await this.repo.deleteVersion(v.id!);
    }
    const droppedTables = await store.dropTables(definition);
    await this.repo.deleteDefinition(definitionId);
    return {
      definitionId,
      datasetCode: definition.datasetCode,
      versionsDeleted: versions.length,
      purgedRows,
      jobsDeleted,
      configsDeleted,
      droppedTables,
    };
  }
}
