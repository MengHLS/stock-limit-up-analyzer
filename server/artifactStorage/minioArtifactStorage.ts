/**
 * RESEARCH-EXPERIMENT-004 — MinIO 适配器（规格 §7）。
 *
 * ## 为什么用 `@aws-sdk/client-s3` 而不是 `minio` npm 包
 *
 * MinIO 对外就是 **S3 兼容协议**，而本仓库 `package.json` 里**已经有**
 * `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner`（已安装）。
 * 项目规则禁止为单个任务引入新依赖 ⇒ 用既有 SDK + `forcePathStyle: true`
 * （MinIO 的路径风格寻址）即可，零新依赖、零 `pnpm add`。
 *
 * ## 这个类只做「协议翻译」
 *
 * ```
 * ArtifactStorage 语义  →  S3 API 语义
 * put                  →  PutObject
 * get                  →  GetObject
 * exists / getMetadata →  HeadObject
 * delete               →  DeleteObject
 * list                 →  ListObjectsV2
 * ```
 *
 * 它**不做**任何业务判断（不判断 Run 状态、不拼 Key、不决定要不要 COMPLETED）——
 * 那些全在服务层。这里只负责「把协议错误翻译成 `ArtifactStorageError`」。
 *
 * ## 错误翻译（判据不依赖驱动文案）
 *
 * | 情形 | 判据 | 结果 |
 * | --- | --- | --- |
 * | 对象不存在 | `$metadata.httpStatusCode === 404` 或 `name ∈ {NoSuchKey, NotFound}` | `null` / `false`（查存在语义**不抛**） |
 * | 取不存在对象 | 同上 | `ARTIFACT_STORAGE_NOT_FOUND`（**抛** —— `get()` 如实失败） |
 * | 连不上 / 凭据被拒 | `$metadata.httpStatusCode ∈ {401,403,5xx}` / `code ∈ {ECONNREFUSED,ETIMEDOUT,ENOTFOUND,EAI_AGAIN}` | `ARTIFACT_STORAGE_UNAVAILABLE` |
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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

/** MinIO 连接配置（**全部来自 env**，绝不在代码里写死 —— 规格 §8）。 */
export interface MinioStorageConfig {
  endpoint: string;
  port: number;
  useSsl: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

/**
 * 最小 S3 客户端面（结构化类型）。
 *
 * 🔴 刻意只依赖 `send(command)`：单测可以注入一个假客户端，**不必**连真实 MinIO
 *    就能覆盖「键传递 / 错误翻译 / 元数据映射」这些真正容易写错的地方。
 */
export interface S3ClientLike {
  send(command: never): Promise<unknown>;
}

/** 把配置变成 S3 客户端要的 endpoint（MinIO 默认 9000，非标准端口必须显式带上）。 */
export function minioEndpointUrl(config: Pick<MinioStorageConfig, "endpoint" | "port" | "useSsl">): string {
  const scheme = config.useSsl ? "https" : "http";
  const host = config.endpoint.replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
  // 已带端口时不再叠一次（用户可能在 MINIO_ENDPOINT 里就写全了）。
  const hasPort = /:\d+$/u.test(host);
  return `${scheme}://${host}${hasPort ? "" : `:${config.port}`}`;
}

/** 从任意抛出物里判断「对象不存在」。 */
function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  if (!e) return false;
  if (e.$metadata?.httpStatusCode === 404) return true;
  return e.name === "NotFound" || e.name === "NoSuchKey";
}

/**
 * 从任意抛出物里判断「存储不可达 / 未授权 / 桶不存在 / 服务端错」。
 *
 * 🔴 `NoSuchBucket` **必须**算「不可用」而不是「上传失败」：
 *    桶缺失是**部署/配置问题**（不是这次请求写错了），而且它是唯一一个
 *    「只要桶建好、同一请求就能成功」的失败形态。若把它归到 `PUT_FAILED`，
 *    调用方只会看到「上传失败」而永远看不到「请确认桶已存在」这条自救提示。
 *    （2026-09-20 实踩：`put()` 里写了「若错误提到 NoSuchBucket，请确认桶已存在」
 *    的分支，但判据漏了 `NoSuchBucket` ⇒ 该分支对真正的 NoSuchBucket 不可达。）
 */
function isUnavailable(error: unknown): boolean {
  const e = error as
    | { name?: string; code?: string; $metadata?: { httpStatusCode?: number } }
    | null;
  if (!e) return false;
  const status = e.$metadata?.httpStatusCode;
  if (status === 401 || status === 403) return true;
  if (typeof status === "number" && status >= 500) return true;
  const code = e.code ?? e.name ?? "";
  return [
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNRESET",
    "TimeoutError",
    "NetworkingError",
    "NoSuchBucket",
  ].includes(code);
}

function toMetadata(
  key: string,
  sizeBytes: number,
  contentType: string | null,
  lastModified: Date | string | null | undefined,
  etag: string | null | undefined,
): ArtifactObjectMetadata {
  let iso: string | null = null;
  if (lastModified instanceof Date) {
    iso = Number.isNaN(lastModified.getTime()) ? null : lastModified.toISOString();
  } else if (typeof lastModified === "string" && lastModified.length > 0) {
    const parsed = new Date(lastModified);
    iso = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return {
    key,
    sizeBytes,
    contentType: contentType ?? null,
    lastModified: iso,
    etag: etag ? etag.replace(/^"|"$/gu, "") : null,
  };
}

export interface MinioArtifactStorageDeps {
  config: MinioStorageConfig;
  /** 注入点：默认用真实 `S3Client`；单测注入假客户端。 */
  client?: S3ClientLike;
}

/**
 * MinIO（S3 兼容）Artifact 存储。
 *
 * ⚠️ 桶**不在这里创建**（规格 §20 明确禁止由本任务去部署/管理 MinIO 集群）。
 *    桶不存在时 `put` 会抛 `ARTIFACT_STORAGE_UNAVAILABLE`，
 *    且错误信息里会点明「请确认桶已存在」，而不是让调用方去猜。
 */
export class MinioArtifactStorage implements ArtifactStorage {
  readonly kind = "minio";

  private readonly config: MinioStorageConfig;
  private readonly client: S3ClientLike;

  constructor(deps: MinioArtifactStorageDeps) {
    this.config = deps.config;
    this.client =
      deps.client ??
      new S3Client({
        endpoint: minioEndpointUrl(deps.config),
        // MinIO 不校验 region，但 S3 SDK 必填 ⇒ 用固定值（不猜用户的 region）。
        region: "us-east-1",
        // 🔴 MinIO 的寻址方式是路径风格（`host/bucket/key`），不是虚拟主机风格。
        forcePathStyle: true,
        credentials: {
          accessKeyId: deps.config.accessKey,
          secretAccessKey: deps.config.secretKey,
        },
      });
  }

  describe(): string {
    const url = minioEndpointUrl(this.config);
    // 🔴 只报端点与桶；**绝不**回显 accessKey / secretKey。
    return `minio endpoint=${url} bucket=${this.config.bucket} (forcePathStyle=true)`;
  }

  async put(
    key: string,
    body: Uint8Array | string,
    options?: ArtifactPutOptions,
  ): Promise<ArtifactPutResult> {
    const safeKey = assertSafeObjectKey(key);
    const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
    const contentType = options?.contentType ?? "application/octet-stream";
    // 先查存在性只为如实回报 `overwritten`（不是控制流依据）。
    const existed = await this.getMetadata(safeKey);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: safeKey,
          Body: bytes,
          ContentType: contentType,
        }) as never,
      );
    } catch (error) {
      if (isUnavailable(error)) {
        throw new ArtifactStorageError(
          ARTIFACT_STORAGE_ERROR.UNAVAILABLE,
          `上传对象失败：对象存储不可用（${this.describe()}）。若错误提到 NoSuchBucket，请确认桶 "${this.config.bucket}" 已存在`,
          { key: safeKey, cause: (error as Error)?.message },
        );
      }
      throw new ArtifactStorageError(
        ARTIFACT_STORAGE_ERROR.PUT_FAILED,
        `上传对象 "${safeKey}" 失败：${(error as Error)?.message ?? String(error)}`,
        { key: safeKey },
      );
    }
    return {
      metadata: toMetadata(safeKey, bytes.byteLength, contentType, new Date(), null),
      overwritten: existed !== null,
    };
  }

  async get(key: string): Promise<ArtifactGetResult> {
    const safeKey = assertSafeObjectKey(key);
    try {
      const out = (await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: safeKey }) as never,
      )) as {
        Body?: { transformToByteArray?: () => Promise<Uint8Array> };
        ContentType?: string;
        ContentLength?: number;
        LastModified?: Date;
        ETag?: string;
      };
      const body = out.Body?.transformToByteArray
        ? Buffer.from(await out.Body.transformToByteArray())
        : Buffer.alloc(0);
      return {
        body,
        metadata: toMetadata(
          safeKey,
          out.ContentLength ?? body.byteLength,
          out.ContentType ?? null,
          out.LastModified ?? null,
          out.ETag ?? null,
        ),
      };
    } catch (error) {
      if (isNotFound(error)) {
        throw new ArtifactStorageError(
          ARTIFACT_STORAGE_ERROR.NOT_FOUND,
          `对象 "${safeKey}" 不存在`,
          { key: safeKey },
        );
      }
      if (isUnavailable(error)) {
        throw new ArtifactStorageError(
          ARTIFACT_STORAGE_ERROR.UNAVAILABLE,
          `读取对象失败：对象存储不可用（${this.describe()}）`,
          { key: safeKey, cause: (error as Error)?.message },
        );
      }
      throw new ArtifactStorageError(
        ARTIFACT_STORAGE_ERROR.GET_FAILED,
        `读取对象 "${safeKey}" 失败：${(error as Error)?.message ?? String(error)}`,
        { key: safeKey },
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.getMetadata(key)) !== null;
  }

  async getMetadata(key: string): Promise<ArtifactObjectMetadata | null> {
    const safeKey = assertSafeObjectKey(key);
    try {
      const out = (await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: safeKey }) as never,
      )) as {
        ContentLength?: number;
        ContentType?: string;
        LastModified?: Date;
        ETag?: string;
      };
      return toMetadata(
        safeKey,
        out.ContentLength ?? 0,
        out.ContentType ?? null,
        out.LastModified ?? null,
        out.ETag ?? null,
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      if (isUnavailable(error)) {
        throw new ArtifactStorageError(
          ARTIFACT_STORAGE_ERROR.UNAVAILABLE,
          `查询对象元数据失败：对象存储不可用（${this.describe()}）`,
          { key: safeKey, cause: (error as Error)?.message },
        );
      }
      throw new ArtifactStorageError(
        ARTIFACT_STORAGE_ERROR.GET_FAILED,
        `查询对象元数据 "${safeKey}" 失败：${(error as Error)?.message ?? String(error)}`,
        { key: safeKey },
      );
    }
  }

  async delete(key: string): Promise<boolean> {
    const safeKey = assertSafeObjectKey(key);
    // S3 的 DeleteObject 对不存在的键**也返回成功** ⇒ 自己先查一次，好如实回报 `false`。
    const existed = (await this.getMetadata(safeKey)) !== null;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.bucket, Key: safeKey }) as never,
      );
    } catch (error) {
      if (isUnavailable(error)) {
        throw new ArtifactStorageError(
          ARTIFACT_STORAGE_ERROR.UNAVAILABLE,
          `删除对象失败：对象存储不可用（${this.describe()}）`,
          { key: safeKey, cause: (error as Error)?.message },
        );
      }
      throw new ArtifactStorageError(
        ARTIFACT_STORAGE_ERROR.PUT_FAILED,
        `删除对象 "${safeKey}" 失败：${(error as Error)?.message ?? String(error)}`,
        { key: safeKey },
      );
    }
    return existed;
  }

  async list(prefix: string, options?: { maxKeys?: number }): Promise<ArtifactObjectEntry[]> {
    const safePrefix = prefix.replace(/^\/+/u, "");
    if (safePrefix.split("/").some((segment) => segment === "..")) {
      throw new ArtifactStorageError(
        ARTIFACT_STORAGE_ERROR.KEY_INVALID,
        `列举前缀 "${prefix}" 含越界段`,
        { prefix },
      );
    }
    const out = (await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: safePrefix,
        MaxKeys: options?.maxKeys ?? 1000,
      }) as never,
    )) as {
      Contents?: Array<{ Key?: string; Size?: number; LastModified?: Date }>;
    };
    return (out.Contents ?? [])
      .filter((item): item is { Key: string; Size?: number; LastModified?: Date } =>
        typeof item.Key === "string",
      )
      .map((item) => ({
        key: item.Key,
        sizeBytes: item.Size ?? 0,
        lastModified: item.LastModified instanceof Date ? item.LastModified.toISOString() : null,
      }));
  }
}
