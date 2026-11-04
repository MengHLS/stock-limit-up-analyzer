/**
 * RESEARCH-EXPERIMENT-004 — 内存版 Artifact 存储（**测试替身**，与 MinIO 适配器同契约）。
 *
 * ## 它是什么 / 不是什么
 *
 * - **是**：与 `ArtifactStorage` 同契约的内存实现。让单测与「集成测试」可以在
 *   **没有真实 MinIO 实例**的环境里，把 `Experiment → Run → Result → 上传 → Manifest
 *   → 写 DB → 读回` 这条链**完整**跑一遍（规格 §19 的 Integration / Failure / Idempotency）。
 * - **不是**：生产降级路径。生产装配（`factory.ts`）里**没有**它会出现的分支 ——
 *   未配置 MinIO 就是抛错，绝不悄悄改写到内存/本地磁盘。
 *
 * 先例：`server/researchRuntime/datasetReader.ts` 的 `InMemoryResearchDatasetReader`
 * 同样把「同语义内存替身」放在服务端源码里，供单测注入而不连真库。
 *
 * ## 故障注入
 *
 * `options.unavailable` / `options.failPut` 让「存储不可用 / 上传失败」这类分支
 * 可以被**确定性地**测到（否则只能靠拔网线，无法进 CI）。
 */

import { assertSafeObjectKey } from "./objectKey";
import {
  ARTIFACT_STORAGE_ERROR,
  ArtifactStorageError,
  type ArtifactGetResult,
  type ArtifactObjectEntry,
  type ArtifactObjectMetadata,
  type ArtifactPutOptions,
  type ArtifactPutResult,
  type ArtifactStorage,
} from "./types";

export interface InMemoryArtifactStorageOptions {
  /** 所有操作都抛 `UNAVAILABLE`（模拟 MinIO 连不上）。 */
  unavailable?: boolean;
  /** 所有 `put` 都抛 `PUT_FAILED`（模拟上传失败）。 */
  failPut?: boolean;
  /** 预置对象（key → 内容）。 */
  seed?: Record<string, { body: string | Uint8Array; contentType?: string }>;
  /** 可注入时钟（让 lastModified 可预测）。 */
  now?: () => Date;
  /** 记录调用轨迹（断言「有没有真的去读对象」用）。 */
  trace?: string[];
}

interface StoredObject {
  body: Buffer;
  contentType: string | null;
  lastModified: string | null;
  etag: string;
}

/** 简单内容指纹（只用于 etag 展示，不参与任何判定）。 */
function fingerprint(body: Buffer): string {
  let hash = 0;
  for (const byte of body) hash = (hash * 31 + byte) % 0xffffffff;
  return hash.toString(16).padStart(8, "0");
}

export class InMemoryArtifactStorage implements ArtifactStorage {
  readonly kind = "memory";
  private readonly objects = new Map<string, StoredObject>();
  private readonly options: InMemoryArtifactStorageOptions;

  constructor(options: InMemoryArtifactStorageOptions = {}) {
    this.options = options;
    for (const [key, entry] of Object.entries(options.seed ?? {})) {
      const body = typeof entry.body === "string" ? Buffer.from(entry.body, "utf8") : Buffer.from(entry.body);
      this.objects.set(key, {
        body,
        contentType: entry.contentType ?? null,
        lastModified: this.nowIso(),
        etag: fingerprint(body),
      });
    }
  }

  private nowIso(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }

  private note(operation: string, key: string): void {
    this.options.trace?.push(`${operation}:${key}`);
  }

  private assertAvailable(operation: string, key: string): void {
    if (this.options.unavailable === true) {
      throw new ArtifactStorageError(
        ARTIFACT_STORAGE_ERROR.UNAVAILABLE,
        `（测试替身）对象存储不可用，${operation} "${key}" 失败`,
        { key, operation },
      );
    }
  }

  describe(): string {
    return `memory(测试替身) objects=${this.objects.size}${this.options.unavailable ? " [unavailable]" : ""}`;
  }

  async put(
    key: string,
    body: Uint8Array | string,
    options?: ArtifactPutOptions,
  ): Promise<ArtifactPutResult> {
    const safeKey = assertSafeObjectKey(key);
    this.note("put", safeKey);
    this.assertAvailable("put", safeKey);
    if (this.options.failPut === true) {
      throw new ArtifactStorageError(
        ARTIFACT_STORAGE_ERROR.PUT_FAILED,
        `（测试替身）上传 "${safeKey}" 失败`,
        { key: safeKey },
      );
    }
    const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
    const existed = this.objects.has(safeKey);
    const contentType = options?.contentType ?? "application/octet-stream";
    this.objects.set(safeKey, {
      body: bytes,
      contentType,
      lastModified: this.nowIso(),
      etag: fingerprint(bytes),
    });
    return {
      metadata: {
        key: safeKey,
        sizeBytes: bytes.byteLength,
        contentType,
        lastModified: this.nowIso(),
        etag: fingerprint(bytes),
      },
      overwritten: existed,
    };
  }

  async get(key: string): Promise<ArtifactGetResult> {
    const safeKey = assertSafeObjectKey(key);
    this.note("get", safeKey);
    this.assertAvailable("get", safeKey);
    const found = this.objects.get(safeKey);
    if (found === undefined) {
      throw new ArtifactStorageError(
        ARTIFACT_STORAGE_ERROR.NOT_FOUND,
        `（测试替身）对象 "${safeKey}" 不存在`,
        { key: safeKey },
      );
    }
    return {
      body: Buffer.from(found.body),
      metadata: {
        key: safeKey,
        sizeBytes: found.body.byteLength,
        contentType: found.contentType,
        lastModified: found.lastModified,
        etag: found.etag,
      },
    };
  }

  async exists(key: string): Promise<boolean> {
    return (await this.getMetadata(key)) !== null;
  }

  async getMetadata(key: string): Promise<ArtifactObjectMetadata | null> {
    const safeKey = assertSafeObjectKey(key);
    this.note("head", safeKey);
    this.assertAvailable("head", safeKey);
    const found = this.objects.get(safeKey);
    if (found === undefined) return null;
    return {
      key: safeKey,
      sizeBytes: found.body.byteLength,
      contentType: found.contentType,
      lastModified: found.lastModified,
      etag: found.etag,
    };
  }

  async delete(key: string): Promise<boolean> {
    const safeKey = assertSafeObjectKey(key);
    this.note("delete", safeKey);
    this.assertAvailable("delete", safeKey);
    return this.objects.delete(safeKey);
  }

  async list(prefix: string, options?: { maxKeys?: number }): Promise<ArtifactObjectEntry[]> {
    this.note("list", prefix);
    this.assertAvailable("list", prefix);
    const entries = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(0, options?.maxKeys ?? 1000)
      .map(([key, value]) => ({
        key,
        sizeBytes: value.body.byteLength,
        lastModified: value.lastModified,
      }));
    return entries;
  }

  /** 测试便利：直接读原始文本（不参与生产路径）。 */
  peekText(key: string): string | null {
    const found = this.objects.get(key);
    return found === undefined ? null : found.body.toString("utf8");
  }

  /** 测试便利：当前对象数。 */
  get size(): number {
    return this.objects.size;
  }

  /** 测试便利：模拟外部把对象删掉（验证「DB=COMPLETED 但对象不在」的检测）。 */
  removeForTests(key: string): void {
    this.objects.delete(key);
  }
}
