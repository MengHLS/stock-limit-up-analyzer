/**
 * RESEARCH-EXPERIMENT-004 — Artifact 存储抽象（规格 §6）。
 *
 * ## 为什么要这层抽象
 *
 * 实验引擎**不允许**直接依赖 MinIO SDK（规格 §7）。链路必须是：
 *
 * ```
 * Experiment Engine
 *         ↓
 *   ArtifactStorage            ← 唯一依赖面（本文件）
 *         ↓
 *   MinIOArtifactStorage       ← 唯一实现里的一个（可用 S3 / 本地 / Blob 替换）
 *         ↓
 *        MinIO
 * ```
 *
 * 只要引擎只认 `ArtifactStorage`，未来把介质换成 `S3ArtifactStorage` /
 * `PostgresBlobStorage` 就**不需要改实验引擎一行代码**。
 *
 * ## 三条纪律
 *
 *   1. **键由调用方给全**（不在这里拼）—— 拼装规则唯一落在 `objectKey.ts`，
 *      这样「同一个 Run 的产物一定在同一个前缀下」是可断言事实，而不是约定；
 *   2. **方法语义一律「如实失败」**：`get()` 对不存在的对象**抛领域错误**，
 *      不返回空字符串/空 Buffer（静默的空值会把「对象丢了」伪装成「结果是空的」）；
 *   3. **元数据里绝不放凭据**（规格 §18）—— 只有 key / size / contentType / 时间 / etag。
 */

/** 对象元数据（不含内容，不含凭据）。 */
export interface ArtifactObjectMetadata {
  /** 完整 Object Key。 */
  key: string;
  sizeBytes: number;
  contentType: string | null;
  /** ISO 8601；存储层不提供时为 null（不编造）。 */
  lastModified: string | null;
  etag: string | null;
}

/** `list()` 的条目（比 `getMetadata()` 轻，但语义一致）。 */
export interface ArtifactObjectEntry {
  key: string;
  sizeBytes: number;
  lastModified: string | null;
}

/** 写入可选项。 */
export interface ArtifactPutOptions {
  /** MIME 类型；缺省 `application/octet-stream`。 */
  contentType?: string;
}

/** 写入结果（= 写入后的真实元数据，由存储层回报，**不是**调用方自己猜的）。 */
export interface ArtifactPutResult {
  metadata: ArtifactObjectMetadata;
  /** `true` = 覆盖了同 Key 的既有对象（WriteOnce 语义下应当是 false —— 由调用方判定）。 */
  overwritten: boolean;
}

/** 取回结果：内容 + 元数据。 */
export interface ArtifactGetResult {
  body: Buffer;
  metadata: ArtifactObjectMetadata;
}

/**
 * 研究实验的 Artifact 存储端口。
 *
 * 方法集按规格 §6 给足：`put` / `get` / `exists` / `delete` / `list` / `getMetadata`。
 */
export interface ArtifactStorage {
  /** 实现标识（诊断用；不上前端）。例：`minio` / `memory`。 */
  readonly kind: string;
  /** 人读描述（诊断用；**不含凭据**）。 */
  describe(): string;
  put(key: string, body: Uint8Array | string, options?: ArtifactPutOptions): Promise<ArtifactPutResult>;
  get(key: string): Promise<ArtifactGetResult>;
  exists(key: string): Promise<boolean>;
  /** 返回 `true` = 确实删掉了一个对象；`false` = 本来就不存在（**不是错误**）。 */
  delete(key: string): Promise<boolean>;
  list(prefix: string, options?: { maxKeys?: number }): Promise<ArtifactObjectEntry[]>;
  /** 不存在返回 `null`（**不抛** —— 这是「查一下在不在」的语义）。 */
  getMetadata(key: string): Promise<ArtifactObjectMetadata | null>;
}

/** 存储层错误码（**不被当成实验领域码**，由上层翻译成 `EXPERIMENT_ARTIFACT_*`）。 */
export const ARTIFACT_STORAGE_ERROR = {
  /** 未配置（缺 env）。 */
  NOT_CONFIGURED: "ARTIFACT_STORAGE_NOT_CONFIGURED",
  /** 配置了但连不上 / 拒答（网络 / 凭据 / 桶不存在）。 */
  UNAVAILABLE: "ARTIFACT_STORAGE_UNAVAILABLE",
  /** 上传失败。 */
  PUT_FAILED: "ARTIFACT_STORAGE_PUT_FAILED",
  /** 对象不存在。 */
  NOT_FOUND: "ARTIFACT_STORAGE_NOT_FOUND",
  /** 取回失败（非「不存在」）。 */
  GET_FAILED: "ARTIFACT_STORAGE_GET_FAILED",
  /** 键非法。 */
  KEY_INVALID: "ARTIFACT_STORAGE_KEY_INVALID",
} as const;
export type ArtifactStorageErrorCode =
  (typeof ARTIFACT_STORAGE_ERROR)[keyof typeof ARTIFACT_STORAGE_ERROR];

/** 存储层错误。上层按 `code` 决定翻成哪个 `EXPERIMENT_*` 领域码。 */
export class ArtifactStorageError extends Error {
  readonly code: ArtifactStorageErrorCode;
  readonly detail: unknown;

  constructor(code: ArtifactStorageErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = "ArtifactStorageError";
    this.code = code;
    this.detail = detail;
  }
}
