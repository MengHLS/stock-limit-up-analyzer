/**
 * RESEARCH-EXPERIMENT-004 — Run 元数据仓储（DB / InMemory **同语义**双实现）。
 *
 * 纪律对齐 `server/research/strategyCandidate/provenance.ts`：同一批不变量、同一批错误码，
 * 差异只在存储介质；JSON 列走既有 `server/research/jsonCodec` 的原子编解码（不新造第二套）。
 *
 * ## 这个仓储守的三条不变量（规格 §12 / §13 / §19）
 *
 * 1. **状态迁移受控**：只允许 `PENDING→RUNNING→{COMPLETED|FAILED}` 与 `PENDING→FAILED`
 *    （表 = `EXPERIMENT_RUN_ALLOWED_TRANSITIONS`）。非法迁移**抛领域错误**，
 *    不静默改写 —— 静默改写会让「DB 说 COMPLETED 但其实没跑完」成为可能；
 * 2. **`COMPLETED` 必须带 Manifest Key**：没有 Manifest 就置 `COMPLETED` 是**结构性**拒绝
 *    （这正是规格 §13 情况 A 的守门点：对象没上传成功 ⇒ 进不了 COMPLETED）；
 * 3. **finalize 幂等**：对同一个 Run 重复 finalize，若 Manifest Key 一致 ⇒ **no-op 返回既有行**
 *    （不产生第二行、不改状态、不刷时间戳）；若 Key 不一致 ⇒ 抛
 *    `EXPERIMENT_RUN_STATE_INVALID`（那说明这是**另一次**终态写入，绝不能悄悄覆盖）。
 *
 * ## 为什么 `stale` 是**读时计算**而不是落库字段
 *
 * 「卡在 RUNNING」是一个**关于现在**的判断，不是历史事实。落库意味着需要后台任务去刷它
 * （本任务明确不引入调度器）；读时计算则永远与当下一致，且**完全不改写数据**。
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { researchExperimentRun } from "../../../drizzle/schema";
import { encodeJson, decodeJson, toDate, toIso } from "../../research/jsonCodec";
import {
  EXPERIMENT_RUN_ALLOWED_TRANSITIONS,
  type ExperimentConfirmatoryGate,
  type ExperimentDatasetBinding,
  type ExperimentEvaluationWindow,
  type ExperimentParameterValues,
  type ExperimentResearchPhase,
  type ExperimentRunLifecycleStatus,
  type ExperimentRunRecord,
  type ExperimentRunSummary,
} from "@shared/researchExperimentsContracts";
import { ExperimentError } from "../errors";
// 跨境只读的有界瞬时错误重试（通用工具，见 `server/readRetry.ts` 头注释）。
// 🔴 为什么 Run 的**读**路径必须挂上它（2026-09-20 真踩）：
//    `server/db.ts` 的池配置注释已写明「取出死连接 / 新建连超时 ⇒ Drizzle 包成
//    `Failed query: …`」，全站既有兜底是 `withReadRetry`。004 新增的 Run 读路径一开始
//    直连池 ⇒ 冷启动时前端实测拿到 500（19.2s 后失败，与 `connectTimeout: 20_000` 同量级），
//    实验列表页因此显示「运行历史暂时取不到」；紧接着重试同一请求 1.6s 成功。
//    ⇒ 这不是「新缺陷」，而是**新代码没有继承既有的兜底约定**。
//    写路径**不重试**（重试写可能造成重复写入，语义由上层负责）。
import { withReadRetry } from "../../readRetry";

/** 「卡在 RUNNING」的判定阈值（读时计算；不改数据）。 */
export const EXPERIMENT_RUN_STALE_AFTER_MS = 30 * 60 * 1000;

/** 一条 Run 的落库内容（`EXPERIMENT_RESULT_SCHEMA_VERSION` 由上层给）。 */
export interface ExperimentRunCreateInput {
  runId: string;
  experimentId: string;
  experimentName: string;
  experimentVersion: string;
  experimentCodeDigest: string;
  researchPhase?: ExperimentResearchPhase;
  protocolId?: string | null;
  protocolVersion?: string | null;
  protocolFingerprint?: string | null;
  parentRunId?: string | null;
  evaluationWindow?: ExperimentEvaluationWindow | null;
  datasetVersionId: number;
  datasetCode: string;
  datasetVersionLabel: string;
  datasetBindings?: ExperimentDatasetBinding[];
  /** **已归并默认值**的参数快照。 */
  parameters: ExperimentParameterValues;
  /** 可注入创建时间（测试用：让 `createdAt` 确定）。 */
  createdAt?: string;
}

export interface ExperimentRunCompleteInput {
  /** Manifest 对象 Key（**必填**；为空即结构错误）。 */
  manifestKey: string;
  resultSchemaVersion: string;
  summary: ExperimentRunSummary | null;
  confirmatoryGate?: ExperimentConfirmatoryGate | null;
  durationMs: number;
  completedAt?: string;
}

export interface ExperimentRunFailInput {
  errorCode: string;
  errorMessage: string;
  durationMs: number | null;
  completedAt?: string;
}

export interface ExperimentRunListFilter {
  experimentId?: string;
  limit?: number;
  offset?: number;
  protocolFingerprint?: string;
  researchPhase?: ExperimentResearchPhase;
}

/** Run 元数据仓储端口。 */
export interface ExperimentRunRepository {
  createRun(input: ExperimentRunCreateInput): Promise<ExperimentRunRecord>;
  /** `PENDING → RUNNING`。 */
  markRunning(runId: string, startedAt?: string): Promise<ExperimentRunRecord>;
  /** `RUNNING → COMPLETED`（**必须**带 Manifest Key）。 */
  markCompleted(runId: string, input: ExperimentRunCompleteInput): Promise<ExperimentRunRecord>;
  /** `PENDING|RUNNING → FAILED`。 */
  markFailed(runId: string, input: ExperimentRunFailInput): Promise<ExperimentRunRecord>;
  getRun(runId: string): Promise<ExperimentRunRecord | null>;
  listRuns(filter?: ExperimentRunListFilter): Promise<ExperimentRunRecord[]>;
  countRunsByExperiment(experimentId: string): Promise<number>;
  /** 每个实验的**最近**一条 Run（列表页 N+1 的替代：一次查询）。 */
  latestRunByExperiment(): Promise<Map<string, ExperimentRunRecord>>;
  listRunsByProtocolFingerprint(protocolFingerprint: string): Promise<ExperimentRunRecord[]>;
}

/** 默认列表上限（页面一次只显示最近这么多条）。 */
export const DEFAULT_RUN_LIST_LIMIT = 50;

// ---------------------------------------------------------------------------
// 共享：stale 计算 + 迁移断言
// ---------------------------------------------------------------------------

/**
 * `stale` 判定：`RUNNING` 且已超过阈值仍未收敛。
 *
 * 🔴 只做**标注**，不做修正 —— 把一条 RUNNING 改成 FAILED 是**人为判定**，
 *    必须走 `reconcileRun`（带 `reason`，留痕）。读路径静默改写历史是禁止的。
 */
export function computeStale(
  status: ExperimentRunLifecycleStatus,
  startedAt: string | null,
  nowIso: string,
  thresholdMs: number = EXPERIMENT_RUN_STALE_AFTER_MS,
): boolean {
  if (status !== "RUNNING" || startedAt === null) return false;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return false;
  return new Date(nowIso).getTime() - started > thresholdMs;
}

/** 迁移断言（唯一权威表在 shared 契约里）。 */
export function assertRunTransition(
  runId: string,
  from: ExperimentRunLifecycleStatus,
  to: ExperimentRunLifecycleStatus,
  detail?: unknown,
): void {
  const allowed = EXPERIMENT_RUN_ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new ExperimentError(
      "EXPERIMENT_RUN_STATE_INVALID",
      `Run "${runId}" 不允许从 ${from} 迁移到 ${to}` +
        `（允许：${allowed.length === 0 ? "无（终态）" : allowed.join(" / ")}）`,
      { runId, from, to, ...(detail !== undefined ? { detail } : {}) },
    );
  }
}

/** `markCompleted` 的输入校验：没有 Manifest Key 就不许 COMPLETED。 */
export function assertManifestKeyPresent(runId: string, manifestKey: string): void {
  if (typeof manifestKey !== "string" || manifestKey.trim().length === 0) {
    throw new ExperimentError(
      "EXPERIMENT_RUN_STATE_INVALID",
      `Run "${runId}" 不能在没有 Manifest 对象 Key 的情况下置为 COMPLETED` +
        `（规格 §13 情况 A：对象没落存储 ⇒ 不许声称完成）`,
      { runId },
    );
  }
}

function normalizeListLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_RUN_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ExperimentError(
      "EXPERIMENT_RUN_STATE_INVALID",
      `listRuns 的 limit 必须是正整数，实际 ${String(limit)}`,
      { limit },
    );
  }
  return Math.min(limit, 200);
}

function normalizeListOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ExperimentError(
      "EXPERIMENT_RUN_STATE_INVALID",
      `listRuns 的 offset 必须是非负整数，实际 ${String(offset)}`,
      { offset },
    );
  }
  return offset;
}

/** DB DATE / Date → `YYYY-MM-DD`；按本地日历字段格式化，避免 UTC 截断漂移一天。 */
export function formatExperimentBusinessDate(value: Date | string): string {
  if (!(value instanceof Date)) return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// InMemory 实现（测试替身；与 DB 实现同语义）
// ---------------------------------------------------------------------------

export interface InMemoryRunRepositoryOptions {
  now?: () => Date;
  staleAfterMs?: number;
}

interface InMemoryRunState {
  record: ExperimentRunRecord;
  createdAt: string;
  updatedAt: string;
}

/**
 * 内存实现。
 *
 * 刻意与 DB 实现共用同一批断言函数（`assertRunTransition` / `assertManifestKeyPresent`）——
 * 「内存里能过、真库上过不了」这类漂移是本仓库历史上踩过的坑，
 * 修法就是让**不变量只有一份实现**。
 */
export class InMemoryExperimentRunRepository implements ExperimentRunRepository {
  private readonly runs = new Map<string, InMemoryRunState>();
  private readonly now: () => Date;
  private readonly staleAfterMs: number;

  constructor(options: InMemoryRunRepositoryOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.staleAfterMs = options.staleAfterMs ?? EXPERIMENT_RUN_STALE_AFTER_MS;
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private decorate(record: ExperimentRunRecord): ExperimentRunRecord {
    return {
      ...record,
      stale: computeStale(record.status, record.startedAt, this.nowIso(), this.staleAfterMs),
    };
  }

  async createRun(input: ExperimentRunCreateInput): Promise<ExperimentRunRecord> {
    if (this.runs.has(input.runId)) {
      throw new ExperimentError(
        "EXPERIMENT_RUN_ID_CONFLICT",
        `Run id "${input.runId}" 已存在（一个 Run 一行；**不覆盖历史 Run**）`,
        { runId: input.runId },
      );
    }
    const createdAt = input.createdAt ?? this.nowIso();
    const record: ExperimentRunRecord = {
      runId: input.runId,
      experimentId: input.experimentId,
      experimentName: input.experimentName,
      experimentVersion: input.experimentVersion,
      experimentCodeDigest: input.experimentCodeDigest,
      researchPhase: input.researchPhase ?? "EXPLORATORY",
      protocolId: input.protocolId ?? null,
      protocolVersion: input.protocolVersion ?? null,
      protocolFingerprint: input.protocolFingerprint ?? null,
      parentRunId: input.parentRunId ?? null,
      evaluationWindow: input.evaluationWindow ?? null,
      datasetVersionId: input.datasetVersionId,
      datasetCode: input.datasetCode,
      datasetVersionLabel: input.datasetVersionLabel,
      datasetBindings:
        input.datasetBindings ?? [
          {
            alias: "primary",
            datasetVersionId: input.datasetVersionId,
            datasetCode: input.datasetCode,
            datasetVersionLabel: input.datasetVersionLabel,
          },
        ],
      parameters: input.parameters,
      status: "PENDING",
      startedAt: null,
      completedAt: null,
      durationMs: null,
      errorCode: null,
      errorMessage: null,
      resultManifestKey: null,
      resultSchemaVersion: null,
      confirmatoryGate: null,
      summary: null,
      stale: false,
      createdAt,
      updatedAt: createdAt,
    };
    this.runs.set(input.runId, { record, createdAt, updatedAt: createdAt });
    return this.decorate(record);
  }

  private require(runId: string): InMemoryRunState {
    const state = this.runs.get(runId);
    if (state === undefined) {
      throw new ExperimentError("EXPERIMENT_RUN_NOT_FOUND", `Run "${runId}" 不存在`, { runId });
    }
    return state;
  }

  private update(runId: string, mutate: (record: ExperimentRunRecord) => void): ExperimentRunRecord {
    const state = this.require(runId);
    mutate(state.record);
    state.updatedAt = this.nowIso();
    state.record.updatedAt = state.updatedAt;
    return this.decorate(state.record);
  }

  async markRunning(runId: string, startedAt?: string): Promise<ExperimentRunRecord> {
    const state = this.require(runId);
    assertRunTransition(runId, state.record.status, "RUNNING");
    return this.update(runId, (record) => {
      record.status = "RUNNING";
      record.startedAt = startedAt ?? state.record.startedAt ?? this.nowIso();
    });
  }

  async markCompleted(runId: string, input: ExperimentRunCompleteInput): Promise<ExperimentRunRecord> {
    const state = this.require(runId);
    assertManifestKeyPresent(runId, input.manifestKey);
    // 幂等：重复 finalize 同一个 Run ⇒ 返回既有行（不新增、不改状态）。
    if (state.record.status === "COMPLETED") {
      if (state.record.resultManifestKey !== input.manifestKey) {
        throw new ExperimentError(
          "EXPERIMENT_RUN_STATE_INVALID",
          `Run "${runId}" 已 COMPLETED 且 Manifest Key 为 "${state.record.resultManifestKey}"，` +
            `本次却说 "${input.manifestKey}" —— 这是**另一次**终态写入，拒绝覆盖`,
          { runId, existing: state.record.resultManifestKey, incoming: input.manifestKey },
        );
      }
      return this.decorate(state.record);
    }
    assertRunTransition(runId, state.record.status, "COMPLETED");
    return this.update(runId, (record) => {
      record.status = "COMPLETED";
      record.resultManifestKey = input.manifestKey;
      record.resultSchemaVersion = input.resultSchemaVersion;
      record.confirmatoryGate = input.confirmatoryGate ?? null;
      record.summary = input.summary;
      record.durationMs = input.durationMs;
      record.completedAt = input.completedAt ?? this.nowIso();
      record.errorCode = null;
      record.errorMessage = null;
    });
  }

  async markFailed(runId: string, input: ExperimentRunFailInput): Promise<ExperimentRunRecord> {
    const state = this.require(runId);
    if (state.record.status === "FAILED") {
      // 幂等：已经是 FAILED ⇒ 返回既有行（不刷时间戳、不换错误码）。
      return this.decorate(state.record);
    }
    assertRunTransition(runId, state.record.status, "FAILED");
    return this.update(runId, (record) => {
      record.status = "FAILED";
      record.errorCode = input.errorCode;
      record.errorMessage = input.errorMessage;
      record.durationMs = input.durationMs;
      record.completedAt = input.completedAt ?? this.nowIso();
    });
  }

  async getRun(runId: string): Promise<ExperimentRunRecord | null> {
    const state = this.runs.get(runId);
    return state === undefined ? null : this.decorate(state.record);
  }

  async listRuns(filter?: ExperimentRunListFilter): Promise<ExperimentRunRecord[]> {
    const limit = normalizeListLimit(filter?.limit);
    const offset = normalizeListOffset(filter?.offset);
    const all = [...this.runs.values()].map((state) => this.decorate(state.record));
    const filtered = all.filter((record) => {
      if (filter?.experimentId !== undefined && record.experimentId !== filter.experimentId) {
        return false;
      }
      if (
        filter?.protocolFingerprint !== undefined &&
        record.protocolFingerprint !== filter.protocolFingerprint
      ) {
        return false;
      }
      if (filter?.researchPhase !== undefined && record.researchPhase !== filter.researchPhase) {
        return false;
      }
      return true;
    });
    // 与 DB 实现同序：创建时间降序（同刻则 runId 降序，保证确定性）。
    return filtered
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? b.runId.localeCompare(a.runId)
          : b.createdAt.localeCompare(a.createdAt),
      )
      .slice(offset, offset + limit);
  }

  async countRunsByExperiment(experimentId: string): Promise<number> {
    return [...this.runs.values()].filter((state) => state.record.experimentId === experimentId).length;
  }

  async latestRunByExperiment(): Promise<Map<string, ExperimentRunRecord>> {
    const map = new Map<string, ExperimentRunRecord>();
    for (const state of [...this.runs.values()].sort((a, b) =>
      a.createdAt === b.createdAt ? a.record.runId.localeCompare(b.record.runId) : a.createdAt.localeCompare(b.createdAt),
    )) {
      // 升序遍历 ⇒ 后写覆盖 ⇒ 留下的是最新的。
      map.set(state.record.experimentId, this.decorate(state.record));
    }
    return map;
  }

  async listRunsByProtocolFingerprint(protocolFingerprint: string): Promise<ExperimentRunRecord[]> {
    return this.listRuns({ protocolFingerprint, limit: 200 });
  }
}

// ---------------------------------------------------------------------------
// DB 实现（TiDB）
// ---------------------------------------------------------------------------

type RunRow = typeof researchExperimentRun.$inferSelect;

/** DB 行 → 领域记录（JSON 列解码失败会抛 —— 不静默吞）。 */
export function mapRunRow(row: RunRow, nowIso: string): ExperimentRunRecord {
  return {
    runId: row.runId,
    experimentId: row.experimentId,
    experimentName: row.experimentName,
    experimentVersion: row.experimentVersion,
    experimentCodeDigest: row.experimentCodeDigest ?? null,
    researchPhase: (row.researchPhase as ExperimentResearchPhase | null) ?? "EXPLORATORY",
    protocolId: row.protocolId ?? null,
    protocolVersion: row.protocolVersion ?? null,
    protocolFingerprint: row.protocolFingerprint ?? null,
    parentRunId: row.parentRunId ?? null,
    evaluationWindow:
      row.evaluationStartDate === null || row.evaluationEndDate === null
        ? null
        : {
            startDate: formatExperimentBusinessDate(row.evaluationStartDate),
            endDate: formatExperimentBusinessDate(row.evaluationEndDate),
          },
    datasetVersionId: Number(row.datasetVersionId),
    datasetCode: row.datasetCode,
    datasetVersionLabel: row.datasetVersionLabel,
    datasetBindings:
      decodeJson<ExperimentDatasetBinding[]>(
        row.datasetBindingsJson,
        "research_experiment_run.datasetBindingsJson",
      ) ?? [
        {
          alias: "primary",
          datasetVersionId: Number(row.datasetVersionId),
          datasetCode: row.datasetCode,
          datasetVersionLabel: row.datasetVersionLabel,
        },
      ],
    parameters: decodeJson<ExperimentParameterValues>(
      row.parametersJson,
      "research_experiment_run.parametersJson",
    ) ?? {},
    status: row.status as ExperimentRunLifecycleStatus,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    durationMs: row.durationMs ?? null,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    resultManifestKey: row.resultManifestKey ?? null,
    resultSchemaVersion: row.resultSchemaVersion ?? null,
    confirmatoryGate:
      decodeJson<ExperimentConfirmatoryGate>(
        row.confirmatoryGateJson,
        "research_experiment_run.confirmatoryGateJson",
      ) ?? null,
    summary: decodeJson<ExperimentRunSummary>(row.summaryJson, "research_experiment_run.summaryJson") ?? null,
    stale: computeStale(row.status as ExperimentRunLifecycleStatus, toIso(row.startedAt), nowIso),
    createdAt: toIso(row.createdAt) ?? nowIso,
    updatedAt: toIso(row.updatedAt) ?? nowIso,
  };
}

/** MySQL / TiDB 唯一键冲突判定（第二道防线；不依赖驱动文案）。 */
function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: string; errno?: number } | null;
  return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
}

function affectedRows(result: unknown): number {
  const rows = result as Array<{ affectedRows?: number }> | { affectedRows?: number };
  if (Array.isArray(rows)) return Number(rows[0]?.affectedRows ?? 0);
  return Number(rows?.affectedRows ?? 0);
}

export class DbExperimentRunRepository implements ExperimentRunRepository {
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private async requireDb() {
    const db = await getDb();
    if (!db) {
      throw new Error("数据库不可用（DATABASE_URL 未配置或连接失败），无法访问实验 Run 元数据");
    }
    return db;
  }

  async createRun(input: ExperimentRunCreateInput): Promise<ExperimentRunRecord> {
    const db = await this.requireDb();
    const values: typeof researchExperimentRun.$inferInsert = {
      runId: input.runId,
      experimentId: input.experimentId,
      experimentName: input.experimentName,
      experimentVersion: input.experimentVersion,
      experimentCodeDigest: input.experimentCodeDigest,
      researchPhase: input.researchPhase ?? "EXPLORATORY",
      protocolId: input.protocolId ?? null,
      protocolVersion: input.protocolVersion ?? null,
      protocolFingerprint: input.protocolFingerprint ?? null,
      parentRunId: input.parentRunId ?? null,
      evaluationStartDate:
        input.evaluationWindow === undefined || input.evaluationWindow === null
          ? null
          : (toDate(input.evaluationWindow.startDate) ?? null),
      evaluationEndDate:
        input.evaluationWindow === undefined || input.evaluationWindow === null
          ? null
          : (toDate(input.evaluationWindow.endDate) ?? null),
      datasetVersionId: input.datasetVersionId,
      datasetCode: input.datasetCode,
      datasetVersionLabel: input.datasetVersionLabel,
      datasetBindingsJson: encodeJson(
        input.datasetBindings ?? [
          {
            alias: "primary",
            datasetVersionId: input.datasetVersionId,
            datasetCode: input.datasetCode,
            datasetVersionLabel: input.datasetVersionLabel,
          },
        ],
        "datasetBindingsJson",
      ),
      parametersJson: encodeJson(input.parameters, "parametersJson") ?? "{}",
      status: "PENDING",
      ...(input.createdAt !== undefined ? { createdAt: toDate(input.createdAt) ?? undefined } : {}),
    };
    try {
      await db.insert(researchExperimentRun).values(values);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ExperimentError(
          "EXPERIMENT_RUN_ID_CONFLICT",
          `Run id "${input.runId}" 已存在（唯一约束 uq_research_experiment_run_id；**不覆盖历史 Run**）`,
          { runId: input.runId },
        );
      }
      throw err;
    }
    const created = await this.getRun(input.runId);
    if (!created) throw new Error(`Run 创建后读取失败：runId=${input.runId}`);
    return created;
  }

  private async requireRow(runId: string): Promise<RunRow> {
    const db = await this.requireDb();
    const rows = await withReadRetry("experimentRuns.requireRow", () =>
      db
        .select()
        .from(researchExperimentRun)
        .where(eq(researchExperimentRun.runId, runId))
        .limit(1),
    );
    const row = rows[0];
    if (!row) {
      throw new ExperimentError("EXPERIMENT_RUN_NOT_FOUND", `Run "${runId}" 不存在`, { runId });
    }
    return row;
  }

  async markRunning(runId: string, startedAt?: string): Promise<ExperimentRunRecord> {
    const row = await this.requireRow(runId);
    const current = row.status as ExperimentRunLifecycleStatus;
    if (current === "RUNNING") return (await this.getRun(runId))!;
    assertRunTransition(runId, current, "RUNNING");
    const db = await this.requireDb();
    const result = await db
      .update(researchExperimentRun)
      .set({
        status: "RUNNING",
        startedAt: toDate(startedAt ?? toIso(row.startedAt) ?? this.nowIso()),
      })
      .where(
        and(
          eq(researchExperimentRun.runId, runId),
          eq(researchExperimentRun.status, "PENDING"),
        ),
      );
    if (affectedRows(result) !== 1) {
      const latest = await this.requireRow(runId);
      if ((latest.status as ExperimentRunLifecycleStatus) === "RUNNING") {
        return (await this.getRun(runId))!;
      }
      assertRunTransition(runId, latest.status as ExperimentRunLifecycleStatus, "RUNNING");
      throw new ExperimentError(
        "EXPERIMENT_RUN_STATE_INVALID",
        `Run "${runId}" 竞争迁移 PENDING→RUNNING 失败，当前状态 ${latest.status}`,
        { runId, status: latest.status },
      );
    }
    return (await this.getRun(runId))!;
  }

  async markCompleted(runId: string, input: ExperimentRunCompleteInput): Promise<ExperimentRunRecord> {
    const row = await this.requireRow(runId);
    assertManifestKeyPresent(runId, input.manifestKey);
    const current = row.status as ExperimentRunLifecycleStatus;
    if (current === "COMPLETED") {
      if (row.resultManifestKey !== input.manifestKey) {
        throw new ExperimentError(
          "EXPERIMENT_RUN_STATE_INVALID",
          `Run "${runId}" 已 COMPLETED 且 Manifest Key 为 "${row.resultManifestKey}"，` +
            `本次却说 "${input.manifestKey}" —— 这是**另一次**终态写入，拒绝覆盖`,
          { runId, existing: row.resultManifestKey, incoming: input.manifestKey },
        );
      }
      return (await this.getRun(runId))!;
    }
    assertRunTransition(runId, current, "COMPLETED");
    const db = await this.requireDb();
    const result = await db
      .update(researchExperimentRun)
      .set({
        status: "COMPLETED",
        resultManifestKey: input.manifestKey,
        resultSchemaVersion: input.resultSchemaVersion,
        confirmatoryGateJson: encodeJson(input.confirmatoryGate, "confirmatoryGateJson"),
        summaryJson: encodeJson(input.summary, "summaryJson"),
        durationMs: input.durationMs,
        completedAt: toDate(input.completedAt ?? this.nowIso()),
        errorCode: null,
        errorMessage: null,
      })
      .where(
        and(
          eq(researchExperimentRun.runId, runId),
          eq(researchExperimentRun.status, "RUNNING"),
        ),
      );
    if (affectedRows(result) !== 1) {
      const latest = await this.requireRow(runId);
      if ((latest.status as ExperimentRunLifecycleStatus) === "COMPLETED") {
        if (latest.resultManifestKey === input.manifestKey) return (await this.getRun(runId))!;
        throw new ExperimentError(
          "EXPERIMENT_RUN_STATE_INVALID",
          `Run "${runId}" 已 COMPLETED 且 Manifest Key 为 "${latest.resultManifestKey}"，` +
            `本次却说 "${input.manifestKey}" —— 这是另一次终态写入，拒绝覆盖`,
          { runId, existing: latest.resultManifestKey, incoming: input.manifestKey },
        );
      }
      assertRunTransition(runId, latest.status as ExperimentRunLifecycleStatus, "COMPLETED");
      throw new ExperimentError(
        "EXPERIMENT_RUN_STATE_INVALID",
        `Run "${runId}" 竞争迁移 RUNNING→COMPLETED 失败，当前状态 ${latest.status}`,
        { runId, status: latest.status },
      );
    }
    return (await this.getRun(runId))!;
  }

  async markFailed(runId: string, input: ExperimentRunFailInput): Promise<ExperimentRunRecord> {
    const row = await this.requireRow(runId);
    const current = row.status as ExperimentRunLifecycleStatus;
    if (current === "FAILED") return (await this.getRun(runId))!;
    assertRunTransition(runId, current, "FAILED");
    const db = await this.requireDb();
    const result = await db
      .update(researchExperimentRun)
      .set({
        status: "FAILED",
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        durationMs: input.durationMs,
        completedAt: toDate(input.completedAt ?? this.nowIso()),
      })
      .where(
        and(
          eq(researchExperimentRun.runId, runId),
          inArray(researchExperimentRun.status, ["PENDING", "RUNNING"]),
        ),
      );
    if (affectedRows(result) !== 1) {
      const latest = await this.requireRow(runId);
      if ((latest.status as ExperimentRunLifecycleStatus) === "FAILED") {
        return (await this.getRun(runId))!;
      }
      assertRunTransition(runId, latest.status as ExperimentRunLifecycleStatus, "FAILED");
      throw new ExperimentError(
        "EXPERIMENT_RUN_STATE_INVALID",
        `Run "${runId}" 竞争迁移→FAILED 失败，当前状态 ${latest.status}`,
        { runId, status: latest.status },
      );
    }
    return (await this.getRun(runId))!;
  }

  async getRun(runId: string): Promise<ExperimentRunRecord | null> {
    const db = await this.requireDb();
    const rows = await withReadRetry("experimentRuns.getRun", () =>
      db
        .select()
        .from(researchExperimentRun)
        .where(eq(researchExperimentRun.runId, runId))
        .limit(1),
    );
    const row = rows[0];
    return row ? mapRunRow(row, this.nowIso()) : null;
  }

  async listRuns(filter?: ExperimentRunListFilter): Promise<ExperimentRunRecord[]> {
    const limit = normalizeListLimit(filter?.limit);
    const offset = normalizeListOffset(filter?.offset);
    const db = await this.requireDb();
    const conditions = [];
    if (filter?.experimentId !== undefined) {
      conditions.push(eq(researchExperimentRun.experimentId, filter.experimentId));
    }
    if (filter?.protocolFingerprint !== undefined) {
      conditions.push(eq(researchExperimentRun.protocolFingerprint, filter.protocolFingerprint));
    }
    if (filter?.researchPhase !== undefined) {
      conditions.push(eq(researchExperimentRun.researchPhase, filter.researchPhase));
    }
    const base = db.select().from(researchExperimentRun);
    const filtered = conditions.length === 0 ? base : base.where(and(...conditions));
    const ordered = filtered.orderBy(desc(researchExperimentRun.id));
    const paginated = offset > 0 ? ordered.offset(offset) : ordered;
    const rows = await withReadRetry("experimentRuns.listRuns", () => paginated.limit(limit));
    const nowIso = this.nowIso();
    return rows.map((row) => mapRunRow(row, nowIso));
  }

  async countRunsByExperiment(experimentId: string): Promise<number> {
    const db = await this.requireDb();
    const rows = await withReadRetry("experimentRuns.countByExperiment", () =>
      db
        .select({ n: sql<number>`count(*)` })
        .from(researchExperimentRun)
        .where(eq(researchExperimentRun.experimentId, experimentId)),
    );
    return Number(rows[0]?.n ?? 0);
  }

  async latestRunByExperiment(): Promise<Map<string, ExperimentRunRecord>> {
    const db = await this.requireDb();
    const nowIso = this.nowIso();
    return withReadRetry("experimentRuns.latestByExperiment", async () => {
      // 两步查询（分组取 maxId → 按 id 取行）：比自连接更容易读，也不依赖 SQL 别名解析。
      const grouped = await db
        .select({
          experimentId: researchExperimentRun.experimentId,
          maxId: sql<number>`max(${researchExperimentRun.id})`,
        })
        .from(researchExperimentRun)
        .groupBy(researchExperimentRun.experimentId);
      const ids = grouped.map((item) => Number(item.maxId)).filter((value) => Number.isFinite(value));
      const map = new Map<string, ExperimentRunRecord>();
      if (ids.length === 0) return map;
      const rows = await db
        .select()
        .from(researchExperimentRun)
        .where(inArray(researchExperimentRun.id, ids));
      for (const row of rows) {
        map.set(row.experimentId, mapRunRow(row, nowIso));
      }
      return map;
    });
  }

  async listRunsByProtocolFingerprint(protocolFingerprint: string): Promise<ExperimentRunRecord[]> {
    return this.listRuns({ protocolFingerprint, limit: 200 });
  }
}
