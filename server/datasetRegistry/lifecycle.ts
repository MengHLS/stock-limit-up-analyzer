/**
 * STEP DATASET-002.4A — Dataset Registry Build Lifecycle & State Machine（纯函数层）。
 *
 * 本文件是 Version / Build Job 状态机的「唯一转换规则来源」，不含 IO / SQL / tRPC：
 *   - 状态机转换表 + 合法性断言（非法转换抛稳定错误码）；
 *   - 稳定错误码（DatasetLifecycleError.code），router 据此映射为 TRPCError；
 *   - 构建进度计算（completedChunks / totalChunks → 0..100 或 null，不臆造）。
 *
 * 状态口径（与 drizzle/schema.ts / shared/datasetRegistryContracts.ts 一致，唯一来源）：
 *   - Version：DRAFT / BUILDING / READY / FAILED（schema 未定义 CANCELLED/ACTIVE/ARCHIVED，
 *     故不臆造；取消语义落在 Build Job 层）。
 *   - Build Job：PENDING / RUNNING / COMPLETED / FAILED / CANCELLED。
 */

import type {
  DatasetBoard,
  DatasetBuildConfigRecord,
  DatasetBuildJob,
  DatasetEventKind,
  DatasetEventSpec,
  DatasetVersion,
} from "./types";
import { BUILD_FILTER_DEFAULTS, BUILD_FILTER_LIMITS, eventSpecKey } from "./filter";

export type VersionStatus = DatasetVersion["status"];
export type JobStatus = DatasetBuildJob["status"];

// ---------------------------------------------------------------------------
// 稳定错误码（router 依据 code 映射为稳定 HTTP/tRPC 语义）
// ---------------------------------------------------------------------------

export const DATASET_LIFECYCLE_ERROR = {
  /** 作业不存在。 */
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  /** 版本不存在。 */
  VERSION_NOT_FOUND: "VERSION_NOT_FOUND",
  /** Dataset 定义不存在。 */
  DEFINITION_NOT_FOUND: "DEFINITION_NOT_FOUND",
  /** Dataset 定义已归档（ARCHIVED），不可新建版本。 */
  DEFINITION_ARCHIVED: "DEFINITION_ARCHIVED",
  /** 版本已存在（(datasetId, version) 唯一）。 */
  VERSION_ALREADY_EXISTS: "VERSION_ALREADY_EXISTS",
  /** 版本标签非法（形态不合法）。 */
  INVALID_VERSION_LABEL: "INVALID_VERSION_LABEL",
  /** datasetCode 非法（命名规范不符）。 */
  INVALID_DATASET_CODE: "INVALID_DATASET_CODE",
  /** Dataset 定义已存在（datasetCode 唯一）。 */
  DEFINITION_ALREADY_EXISTS: "DEFINITION_ALREADY_EXISTS",
  /** 作业状态非法转换（含重复 start/cancel/complete/fail）。 */
  INVALID_JOB_TRANSITION: "INVALID_JOB_TRANSITION",
  /** 版本状态非法转换。 */
  INVALID_VERSION_TRANSITION: "INVALID_VERSION_TRANSITION",
  /** 版本已存在另一个 RUNNING 作业（并发构建保护）。 */
  JOB_ALREADY_RUNNING: "JOB_ALREADY_RUNNING",
  /** 版本当前状态不可开始构建（如 BUILDING 中）。 */
  VERSION_NOT_BUILDABLE: "VERSION_NOT_BUILDABLE",
  /** 该 datasetCode 没有已注册的构建插件（无物理表结构 / 无构建器），不可构建。 */
  BUILDER_NOT_REGISTERED: "BUILDER_NOT_REGISTERED",
  /** 版本存在 RUNNING 作业，删除前必须先取消 / 等待结束。 */
  VERSION_HAS_RUNNING_JOB: "VERSION_HAS_RUNNING_JOB",
  /** Dataset 定义下属任一版本存在 RUNNING 作业，删除前必须先取消 / 等待结束。 */
  DEFINITION_HAS_RUNNING_JOB: "DEFINITION_HAS_RUNNING_JOB",
  /** 构建筛选配置非法（板块 / 事件维度 / 窗口越界等）。 */
  INVALID_BUILD_FILTER: "INVALID_BUILD_FILTER",
  /** checkpoint 结构版本不兼容（如旧版无 limitUpDays，无法精确回看锚点日涨停状态）。 */
  CHECKPOINT_INCOMPATIBLE: "CHECKPOINT_INCOMPATIBLE",
} as const;

export type DatasetLifecycleErrorCode =
  (typeof DATASET_LIFECYCLE_ERROR)[keyof typeof DATASET_LIFECYCLE_ERROR];

export class DatasetLifecycleError extends Error {
  readonly code: DatasetLifecycleErrorCode;

  constructor(code: DatasetLifecycleErrorCode, message: string) {
    super(message);
    this.name = "DatasetLifecycleError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 状态机转换表
// ---------------------------------------------------------------------------

/**
 * Version 状态机（基于现有 schema 语义，不臆造 CANCELLED/ACTIVE/ARCHIVED）：
 *   DRAFT   → BUILDING（首次构建）
 *   FAILED  → BUILDING（失败后重试）
 *   READY   → BUILDING（重建/刷新）
 *   BUILDING→ READY（构建成功）
 *   BUILDING→ FAILED（构建失败 / 取消的落点，见 cancelJob）
 */
const VERSION_TRANSITIONS: Readonly<Record<VersionStatus, ReadonlySet<VersionStatus>>> = {
  DRAFT: new Set<VersionStatus>(["BUILDING"]),
  BUILDING: new Set<VersionStatus>(["READY", "FAILED"]),
  READY: new Set<VersionStatus>(["BUILDING"]),
  FAILED: new Set<VersionStatus>(["BUILDING"]),
};

/**
 * Build Job 状态机（5 态，terminal 无出边）：
 *   PENDING  → RUNNING / CANCELLED
 *   RUNNING  → COMPLETED / FAILED / CANCELLED
 *   COMPLETED / FAILED / CANCELLED → （terminal，禁止重复完成/失败/取消）
 */
const JOB_TRANSITIONS: Readonly<Record<JobStatus, ReadonlySet<JobStatus>>> = {
  PENDING: new Set<JobStatus>(["RUNNING", "CANCELLED"]),
  RUNNING: new Set<JobStatus>(["COMPLETED", "FAILED", "CANCELLED"]),
  COMPLETED: new Set<JobStatus>(),
  FAILED: new Set<JobStatus>(),
  CANCELLED: new Set<JobStatus>(),
};

export function canTransitionVersion(from: VersionStatus, to: VersionStatus): boolean {
  return VERSION_TRANSITIONS[from]?.has(to) ?? false;
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertVersionTransition(from: VersionStatus, to: VersionStatus): void {
  if (!canTransitionVersion(from, to)) {
    throw new DatasetLifecycleError(
      DATASET_LIFECYCLE_ERROR.INVALID_VERSION_TRANSITION,
      `非法版本状态转换：${from} → ${to}`,
    );
  }
}

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new DatasetLifecycleError(
      DATASET_LIFECYCLE_ERROR.INVALID_JOB_TRANSITION,
      `非法作业状态转换：${from} → ${to}`,
    );
  }
}

/** 版本是否允许开始构建（可进入 BUILDING）。 */
export function isVersionBuildable(status: VersionStatus): boolean {
  return status === "DRAFT" || status === "FAILED" || status === "READY";
}

/** 作业是否为 terminal（不可再转换 / 不可重试之外的操作）。 */
export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

// ---------------------------------------------------------------------------
// 构建筛选配置：规范化 + 解析（纯函数，无 IO）
// ---------------------------------------------------------------------------
//
// 两级职责：
//   1) `normalizeBuildFilter` —— 把任意来源（tRPC / CLI / 脚本）的筛选入参**权威规范化**：
//      校验取值范围 + 去重 + 排序，非法即抛 `INVALID_BUILD_FILTER`（不静默夹取，防「以为筛了其实没筛」）。
//   2) `resolveBuildConfig` —— 构建执行前把「版本 + 落库配置」解析成 ResolvedBuildConfig，
//      回退链：dataset_build_config 行 → 版本 filterDefinition（历史镜像）→ 权威默认值。

/** 构建执行所需的配置（解析后形态；筛选 + 窗口 + 执行参数）。 */
export interface ResolvedBuildConfig {
  startDate: string;
  endDate: string;
  /** 板块（空 = 全板块含 unknown）。 */
  boards: DatasetBoard[];
  /** 排除 ST/*ST。 */
  excludeSt: boolean;
  /** 事件维度（至少 1 条；OR 语义）。 */
  events: DatasetEventSpec[];
  /** t 日之前的数据天数。 */
  preWindowDays: number;
  /** t 日之后的数据天数（等价旧 pathHorizon）。 */
  postWindowDays: number;
  outcomeHorizons: number[];
  batchSize: number;
}

/** 合法的板块取值（与 server/data/boardRules.classifyBoard 输出一致）。 */
const VALID_BOARDS: readonly DatasetBoard[] = ["main", "chinext", "star", "bse"];
/** 合法的事件类型。 */
const VALID_EVENT_KINDS: readonly DatasetEventKind[] = ["firstBoard", "limitUp", "consecutiveBoard"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function horizonList(value: unknown): number[] {
  if (!Array.isArray(value)) return [...BUILD_FILTER_DEFAULTS.outcomeHorizons];
  const list = value
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    .map((v) => Math.floor(v));
  return list.length > 0
    ? Array.from(new Set(list)).sort((a, b) => a - b)
    : [...BUILD_FILTER_DEFAULTS.outcomeHorizons];
}

function fail(message: string): never {
  throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.INVALID_BUILD_FILTER, message);
}

function intInRange(label: string, value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(`${label} 必须是整数（收到 ${JSON.stringify(value)}）`);
  }
  if (value < min || value > max) fail(`${label} 必须在 ${min}..${max} 之间（收到 ${value}）`);
  return value;
}

function normalizeBoards(value: unknown): DatasetBoard[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("boards 必须是数组");
  const out: DatasetBoard[] = [];
  for (const b of value) {
    if (typeof b !== "string" || !(VALID_BOARDS as readonly string[]).includes(b)) {
      fail(`boards 含非法板块：${JSON.stringify(b)}（合法值 ${VALID_BOARDS.join("/")}）`);
    }
    if (!out.includes(b as DatasetBoard)) out.push(b as DatasetBoard);
  }
  return out;
}

function normalizeEvents(value: unknown): DatasetEventSpec[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail("events 至少需要 1 条事件维度（未完成筛选配置不得构建）");
  }
  if (value.length > BUILD_FILTER_LIMITS.maxEvents) {
    fail(`events 最多 ${BUILD_FILTER_LIMITS.maxEvents} 条（收到 ${value.length}）`);
  }
  const out: DatasetEventSpec[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) fail("events 每项必须是 { relativeDay, kind } 对象");
    const relativeDay = intInRange(
      "events[].relativeDay",
      raw.relativeDay,
      BUILD_FILTER_LIMITS.relativeDay.min,
      BUILD_FILTER_LIMITS.relativeDay.max,
    );
    const kind = raw.kind;
    if (typeof kind !== "string" || !(VALID_EVENT_KINDS as readonly string[]).includes(kind)) {
      fail(`events[].kind 非法：${JSON.stringify(kind)}（合法值 ${VALID_EVENT_KINDS.join("/")}）`);
    }
    const spec: DatasetEventSpec = { relativeDay, kind: kind as DatasetEventKind };
    const key = eventSpecKey(spec);
    if (seen.has(key)) fail(`events 存在重复项：${key}`);
    seen.add(key);
    out.push(spec);
  }
  return out;
}

/**
 * 筛选入参权威规范化（去重 / 排序 / 边界校验）。
 * 非法输入**抛错**而非回退默认 —— 构建筛选宁可失败，不可静默改变口径。
 */
export function normalizeBuildFilter(raw: unknown): Omit<DatasetBuildConfigRecord, "datasetVersionId" | "id"> {
  if (!isRecord(raw)) {
    fail("filter 必须是对象（board / excludeSt / events / pre-postWindowDays 等）");
  }
  const events = normalizeEvents(raw.events);
  const preWindowDays = intInRange(
    "preWindowDays",
    raw.preWindowDays ?? BUILD_FILTER_DEFAULTS.preWindowDays,
    BUILD_FILTER_LIMITS.preWindowDays.min,
    BUILD_FILTER_LIMITS.preWindowDays.max,
  );
  const postWindowDays = intInRange(
    "postWindowDays",
    raw.postWindowDays ?? BUILD_FILTER_DEFAULTS.postWindowDays,
    BUILD_FILTER_LIMITS.postWindowDays.min,
    BUILD_FILTER_LIMITS.postWindowDays.max,
  );
  const excludeSt = raw.excludeSt ?? BUILD_FILTER_DEFAULTS.excludeSt;
  if (typeof excludeSt !== "boolean") fail("excludeSt 必须是布尔值");
  const horizons = horizonList(raw.outcomeHorizons);
  for (const h of horizons) {
    if (h < 1 || h > 120) fail(`outcomeHorizons 单个视界必须在 1..120（收到 ${h}）`);
  }
  if (horizons.length > 8) fail(`outcomeHorizons 最多 8 个（收到 ${horizons.length}）`);
  const batchSize = intInRange("batchSize", raw.batchSize ?? BUILD_FILTER_DEFAULTS.batchSize, 1, 10000);
  return {
    boards: normalizeBoards(raw.boards),
    excludeSt,
    events,
    preWindowDays,
    postWindowDays,
    outcomeHorizons: horizons,
    batchSize,
    configVersion: 1,
  };
}

/**
 * 从版本还原构建配置。
 *
 * 回退链（**优先真实配置行，其次历史镜像，最后权威默认**）：
 *   1. `configRow`（dataset_build_config，DATASET-003B 起的权威来源）；
 *   2. `version.filterDefinition`（历史镜像 / DATASET-001/002 旧版本）；
 *   3. `BUILD_FILTER_DEFAULTS`（= 事件日首板 / 无前置窗口 / t 后 20 日，与旧口径一致）。
 *
 * 日期窗口缺失（null）→ 抛错（构建必须有明确窗口，不猜）。
 */
export function resolveBuildConfig(
  version: Pick<DatasetVersion, "startDate" | "endDate" | "filterDefinition">,
  configRow?: DatasetBuildConfigRecord | null,
): ResolvedBuildConfig {
  if (!version.startDate || !version.endDate) {
    throw new DatasetLifecycleError(
      DATASET_LIFECYCLE_ERROR.VERSION_NOT_BUILDABLE,
      "版本缺少构建窗口（startDate / endDate 为 null），无法执行构建",
    );
  }
  const legacy = isRecord(version.filterDefinition) ? version.filterDefinition : {};

  // 板块 / 排除 ST / 事件维度：新配置行优先；旧版本（无配置行）回退为「不过滤 + 事件日首板」。
  const boards = configRow?.boards ?? [];
  const excludeSt = configRow?.excludeSt ?? false;
  const events = configRow?.events ?? [...BUILD_FILTER_DEFAULTS.events];
  const preWindowDays = configRow?.preWindowDays ?? 0;
  const postWindowDays = configRow?.postWindowDays ?? positiveInt(legacy.pathHorizon, BUILD_FILTER_DEFAULTS.postWindowDays);
  const outcomeHorizons = configRow?.outcomeHorizons ?? horizonList(legacy.outcomeHorizons);
  const batchSize = configRow?.batchSize ?? positiveInt(legacy.batchSize, BUILD_FILTER_DEFAULTS.batchSize);

  return {
    startDate: version.startDate,
    endDate: version.endDate,
    boards: [...boards],
    excludeSt,
    events: [...events],
    preWindowDays,
    postWindowDays,
    outcomeHorizons: [...outcomeHorizons].sort((a, b) => a - b),
    batchSize,
  };
}

// ---------------------------------------------------------------------------
// Build Progress（completedChunks / totalChunks）
// ---------------------------------------------------------------------------

/**
 * 构建进度（0..100 或 null）：
 *   - COMPLETED → 100（无论 chunk 字段如何）；
 *   - totalChunks > 0 且有 completedChunks → round(completedChunks / totalChunks * 100)，夹取 0..100；
 *   - 信息不足（totalChunks 缺失/<=0 或 completedChunks 缺失）→ null（不臆造百分比）。
 */
export function computeBuildProgress(
  job: Pick<DatasetBuildJob, "status" | "totalChunks" | "completedChunks">,
): number | null {
  if (job.status === "COMPLETED") return 100;
  const total = job.totalChunks;
  const completed = job.completedChunks;
  if (typeof total !== "number" || total <= 0) return null;
  if (typeof completed !== "number") return null;
  const pct = (completed / total) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
