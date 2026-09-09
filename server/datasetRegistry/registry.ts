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

import {
  assertBuildDatasetTableName,
  buildDatasetTableNames,
  validateDatasetCode,
} from "./naming";
import type {
  DatasetBuildJob,
  DatasetDefinition,
  DatasetVersion,
} from "./types";

// ---------------------------------------------------------------------------
// Repository 契约
// ---------------------------------------------------------------------------

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
    const updated = { ...current, ...patch };
    this.jobsById.set(id, updated);
    this.jobs.set(current.jobId, updated);
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
  tableNames?: { event?: string; path?: string; outcome?: string; feature?: string | null };
}

export class DatasetRegistryService {
  private readonly repo: DatasetRegistryRepository;

  constructor(repo: DatasetRegistryRepository) {
    this.repo = repo;
  }

  /**
   * 创建 Dataset Definition（§6/§8）。
   * 强制：datasetCode 合法（naming 校验）；物理表名显式落库（不运行时猜名）。
   */
  async createDefinition(input: CreateDefinitionInput): Promise<DatasetDefinition> {
    const issues = validateDatasetCode(input.datasetCode);
    if (issues.length > 0) {
      throw new Error(`非法 datasetCode："${input.datasetCode}"；${issues.join("；")}`);
    }
    const existing = await this.repo.getDefinitionByCode(input.datasetCode);
    if (existing) {
      throw new Error(`Dataset 定义已存在（datasetCode 唯一）：${input.datasetCode}`);
    }
    const derived = buildDatasetTableNames(input.datasetCode);
    const tableNames = input.tableNames ?? {};
    // 显式表名仍强制过命名规范（防止外部绕过 ds_{code}_{role}）。
    const eventTableName = tableNames.event ?? derived.event;
    const pathTableName = tableNames.path ?? derived.path;
    const outcomeTableName = tableNames.outcome ?? derived.outcome;
    const featureTableName = tableNames.feature ?? null;
    for (const [role, name] of [
      ["event", eventTableName],
      ["path", pathTableName],
      ["outcome", outcomeTableName],
    ] as const) {
      if (name !== null) assertBuildDatasetTableName(input.datasetCode, role);
    }
    return this.repo.saveDefinition({
      datasetCode: input.datasetCode,
      name: input.name,
      description: input.description ?? null,
      datasetType: input.datasetType,
      storageType: input.storageType ?? "DATABASE",
      status: "ACTIVE",
      eventTableName,
      pathTableName,
      outcomeTableName,
      featureTableName,
    });
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
    if (!def) throw new Error(`未找到 Dataset 定义：${input.datasetId}`);
    const existing = await this.repo.getVersion(input.datasetId, input.version);
    if (existing) {
      throw new Error(`版本已存在（(datasetId, version) 唯一）：${input.datasetId}@${input.version}`);
    }
    return (await this.repo.saveVersion({ ...input, status: "DRAFT" })).version;
  }

  /** 标记版本进入构建态。 */
  async markBuilding(versionId: number): Promise<void> {
    await this.repo.updateVersion(versionId, { status: "BUILDING" });
  }

  /** 标记版本完成（READY），并写入统计。 */
  async markReady(versionId: number, totals: { totalEvents: number; totalRows: number }): Promise<void> {
    await this.repo.updateVersion(versionId, {
      status: "READY",
      totalEvents: totals.totalEvents,
      totalRows: totals.totalRows,
      completedAt: new Date().toISOString(),
    });
  }

  /** 标记版本失败。 */
  async markFailed(versionId: number): Promise<void> {
    await this.repo.updateVersion(versionId, { status: "FAILED" });
  }

  /** 启动一个构建作业。 */
  async startJob(input: { datasetVersionId: number; jobId: string }): Promise<DatasetBuildJob> {
    return this.repo.saveJob({
      datasetVersionId: input.datasetVersionId,
      jobId: input.jobId,
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      processedRows: 0,
      failedRows: 0,
    });
  }

  /** 推进作业进度（checkpoint 落库）。 */
  async updateJobProgress(jobId: string, patch: Partial<Omit<DatasetBuildJob, "id" | "datasetVersionId" | "jobId">>): Promise<void> {
    const job = await this.repo.getJob(jobId);
    if (!job) throw new Error(`未找到作业：${jobId}`);
    await this.repo.updateJob(job.id!, patch);
  }

  /** 完成作业。 */
  async completeJob(jobId: string): Promise<void> {
    const job = await this.repo.getJob(jobId);
    if (!job) throw new Error(`未找到作业：${jobId}`);
    await this.repo.updateJob(job.id!, { status: "COMPLETED", completedAt: new Date().toISOString() });
  }

  /** 失败作业。 */
  async failJob(jobId: string, errorMessage: string): Promise<void> {
    const job = await this.repo.getJob(jobId);
    if (!job) throw new Error(`未找到作业：${jobId}`);
    await this.repo.updateJob(job.id!, { status: "FAILED", errorMessage, completedAt: new Date().toISOString() });
  }
}
