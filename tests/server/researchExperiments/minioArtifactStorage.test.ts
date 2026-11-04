/**
 * RESEARCH-EXPERIMENT-004 · MinIO 适配器单测（规格 §7 / §19 Unit）。
 *
 * ## 为什么必须注入假 S3 客户端
 *
 * 适配器真正容易写错的地方不是「连得上」，而是：
 *   - 命令参数有没有带对（Bucket / Key / ContentType / Prefix）；
 *   - **错误翻译**：404 到底是「不存在」（查存在性返回 `null`）还是「读取失败」（抛 `NOT_FOUND`）；
 *     403/5xx/ECONNREFUSED 必须翻译成 `UNAVAILABLE`，而不是混进 `PUT_FAILED`；
 *   - 元数据映射（`ETag` 去引号、`LastModified` → ISO、`ContentLength` 缺省）；
 *   - **凭据绝不出现在 `describe()` 里**（规格 §18）。
 *
 * 这些全部可以在**不连真 MinIO** 的前提下确定性覆盖。真连通的验证由
 * `docs/evidence/_probe_9ch_minio_connectivity.mts`（实测 put/head/get/delete 往返）负责。
 */

import { describe, expect, it } from "vitest";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { MinioArtifactStorage, minioEndpointUrl, type S3ClientLike } from "../../../server/artifactStorage";
import { ARTIFACT_STORAGE_ERROR, ArtifactStorageError } from "../../../server/artifactStorage/types";

const CONFIG = {
  endpoint: "minio.example.internal",
  port: 9000,
  useSsl: false,
  accessKey: "AKIA-TEST-ACCESS",
  secretKey: "SECRET-TEST-KEY",
  bucket: "research",
};

/** 构造一个记录调用的假 S3 客户端。 */
function fakeClient(handler: (command: unknown) => Promise<unknown>): {
  client: S3ClientLike;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      send: (command: never) => {
        calls.push(command);
        return handler(command);
      },
    },
  };
}

/** 伪造一个 S3 服务端错误（带 `$metadata.httpStatusCode` 与 `name`）。 */
function s3Error(name: string, httpStatusCode?: number, code?: string): Error {
  const error = new Error(`fake ${name}`);
  Object.assign(error, {
    name,
    ...(code !== undefined ? { code } : {}),
    $metadata: httpStatusCode === undefined ? {} : { httpStatusCode },
  });
  return error;
}

/**
 * 取 `ArtifactStorageError.code`（断言**领域码**而不是消息文案）。
 *
 * 🔴 为什么不直接 `rejects.toThrowError("ARTIFACT_STORAGE_KEY_INVALID")`：
 *    `toThrowError(string)` 匹配的是**消息**，而领域码在 `error.code` 上。
 *    用字符串断言会得到「消息里恰好没写码 ⇒ 恒失败」（本会话第一版就是这么写错的），
 *    反而逼着实现把领域码塞进文案 —— 那是把错误码当成展示文案用。
 */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "(没有抛错)";
  } catch (error) {
    return error instanceof ArtifactStorageError
      ? error.code
      : `(不是 ArtifactStorageError：${String(error)})`;
  }
}

function storageWith(handler: (command: unknown) => Promise<unknown>) {
  const { client, calls } = fakeClient(handler);
  return { storage: new MinioArtifactStorage({ config: CONFIG, client }), calls };
}

const KEY = "experiments/demo/persist/runs/RUN-1/result.json";

describe("MinioArtifactStorage · 命令与元数据映射", () => {
  it("put：带上 Bucket/Key/ContentType/Body；首次写入回报 overwritten=false", async () => {
    const { storage, calls } = storageWith(async (command) => {
      if (command instanceof HeadObjectCommand) throw s3Error("NotFound", 404);
      return {};
    });

    const result = await storage.put(KEY, "hello", { contentType: "application/json" });
    expect(result.metadata.sizeBytes).toBe(5);
    expect(result.metadata.contentType).toBe("application/json");
    expect(result.overwritten).toBe(false);

    const put = calls.find((c): c is PutObjectCommand => c instanceof PutObjectCommand);
    expect(put).toBeDefined();
    expect(put!.input.Bucket).toBe("research");
    expect(put!.input.Key).toBe(KEY);
    expect(put!.input.ContentType).toBe("application/json");
    expect(Buffer.from(put!.input.Body as unknown as Uint8Array).toString("utf8")).toBe("hello");
  });

  it("put：已存在同一 Key ⇒ overwritten=true（如实回报，不当成错误）", async () => {
    const { storage } = storageWith(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return { ContentLength: 3, ContentType: "text/plain", LastModified: new Date(0), ETag: '"abc"' };
      }
      return {};
    });
    const result = await storage.put(KEY, "abc");
    expect(result.overwritten).toBe(true);
  });

  it("get：Body → Buffer，ETag 去引号，LastModified → ISO", async () => {
    const { storage } = storageWith(async (command) => {
      if (command instanceof GetObjectCommand) {
        return {
          Body: { transformToByteArray: async () => Buffer.from("payload", "utf8") },
          ContentType: "text/csv",
          ContentLength: 7,
          LastModified: new Date("2026-09-20T03:04:05.000Z"),
          ETag: '"deadbeef"',
        };
      }
      return {};
    });

    const got = await storage.get(KEY);
    expect(got.body.toString("utf8")).toBe("payload");
    expect(got.metadata.sizeBytes).toBe(7);
    expect(got.metadata.contentType).toBe("text/csv");
    expect(got.metadata.etag).toBe("deadbeef");
    expect(got.metadata.lastModified).toBe("2026-09-20T03:04:05.000Z");
  });

  it("getMetadata / exists：404 ⇒ null / false（查存在性语义**不抛**）", async () => {
    const { storage } = storageWith(async () => {
      throw s3Error("NotFound", 404);
    });
    expect(await storage.getMetadata(KEY)).toBeNull();
    expect(await storage.exists(KEY)).toBe(false);
  });

  it("get 一个不存在的对象 ⇒ 抛 NOT_FOUND（如实失败，不返回空 Buffer）", async () => {
    const { storage } = storageWith(async () => {
      throw s3Error("NoSuchKey", 404);
    });
    const error = await storage.get(KEY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArtifactStorageError);
    expect((error as ArtifactStorageError).code).toBe(ARTIFACT_STORAGE_ERROR.NOT_FOUND);
  });

  it("delete：S3 对不存在的键也返回成功 ⇒ 自己先 HEAD，返回 false 才如实", async () => {
    let deleted = 0;
    const missing = storageWith(async (command) => {
      if (command instanceof HeadObjectCommand) throw s3Error("NotFound", 404);
      if (command instanceof DeleteObjectCommand) deleted += 1;
      return {};
    });
    expect(await missing.storage.delete(KEY)).toBe(false);
    expect(deleted).toBe(1);

    const present = storageWith(async (command) => {
      if (command instanceof HeadObjectCommand) return { ContentLength: 1 };
      return {};
    });
    expect(await present.storage.delete(KEY)).toBe(true);
  });

  it("list：映射 Contents，并透传 Prefix / MaxKeys", async () => {
    const { storage, calls } = storageWith(async (command) => {
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: [
            { Key: `${KEY}`, Size: 11, LastModified: new Date("2026-09-20T00:00:00.000Z") },
            { Key: "experiments/demo/persist/runs/RUN-1/manifest.json", Size: 22 },
            { Size: 33 }, // 没有 Key 的条目必须被过滤掉（不产出半成品）
          ],
        };
      }
      return {};
    });

    const entries = await storage.list("experiments/demo/persist/runs/RUN-1", { maxKeys: 7 });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.key).toBe(KEY);
    expect(entries[0]!.lastModified).toBe("2026-09-20T00:00:00.000Z");
    expect(entries[1]!.lastModified).toBeNull();
    const command = calls[0] as ListObjectsV2Command;
    expect(command.input.Prefix).toBe("experiments/demo/persist/runs/RUN-1");
    expect(command.input.MaxKeys).toBe(7);
  });

  it("list：前缀含越界段 ⇒ 结构级拒绝（不发请求）", async () => {
    const { storage, calls } = storageWith(async () => ({ Contents: [] }));
    expect(await codeOf(storage.list("experiments/../etc"))).toBe(
      ARTIFACT_STORAGE_ERROR.KEY_INVALID,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("MinioArtifactStorage · 错误翻译（判据不依赖驱动文案）", () => {
  const cases: Array<{ label: string; error: Error; expected: string }> = [
    { label: "401", error: s3Error("AccessDenied", 401), expected: ARTIFACT_STORAGE_ERROR.UNAVAILABLE },
    { label: "403", error: s3Error("Forbidden", 403), expected: ARTIFACT_STORAGE_ERROR.UNAVAILABLE },
    { label: "500", error: s3Error("InternalError", 500), expected: ARTIFACT_STORAGE_ERROR.UNAVAILABLE },
    {
      label: "ECONNREFUSED",
      error: s3Error("Error", undefined, "ECONNREFUSED"),
      expected: ARTIFACT_STORAGE_ERROR.UNAVAILABLE,
    },
    {
      label: "ETIMEDOUT",
      error: s3Error("Error", undefined, "ETIMEDOUT"),
      expected: ARTIFACT_STORAGE_ERROR.UNAVAILABLE,
    },
    {
      label: "NetworkingError",
      error: s3Error("NetworkingError", undefined, "NetworkingError"),
      expected: ARTIFACT_STORAGE_ERROR.UNAVAILABLE,
    },
  ];

  for (const item of cases) {
    it(`${item.label} 在 put / get / getMetadata 上一律翻译为 UNAVAILABLE`, async () => {
      const { storage } = storageWith(async (command) => {
        // put 里会先 HEAD 探 overwritten ⇒ 两条路径都抛同一个错误。
        if (command instanceof HeadObjectCommand) throw s3Error("NotFound", 404);
        throw item.error;
      });
      const putError = await storage.put(KEY, "x").catch((e: unknown) => e);
      expect((putError as ArtifactStorageError).code).toBe(item.expected);

      const { storage: downStorage } = storageWith(async () => {
        throw item.error;
      });
      const getError = await downStorage.get(KEY).catch((e: unknown) => e);
      expect((getError as ArtifactStorageError).code).toBe(item.expected);
      const headError = await downStorage.getMetadata(KEY).catch((e: unknown) => e);
      expect((headError as ArtifactStorageError).code).toBe(item.expected);
    });
  }

  it("非「不可用」的其它错误在 put 上翻译为 PUT_FAILED（不冒充不可用）", async () => {
    const { storage } = storageWith(async (command) => {
      if (command instanceof HeadObjectCommand) throw s3Error("NotFound", 404);
      throw s3Error("InvalidArgument", 400);
    });
    const error = await storage.put(KEY, "x").catch((e: unknown) => e);
    expect((error as ArtifactStorageError).code).toBe(ARTIFACT_STORAGE_ERROR.PUT_FAILED);
  });

  it("桶不存在（NoSuchBucket）⇒ UNAVAILABLE 且文案点明「确认桶已存在」", async () => {
    const { storage } = storageWith(async (command) => {
      if (command instanceof HeadObjectCommand) throw s3Error("NotFound", 404);
      throw s3Error("NoSuchBucket", 404);
    });
    const error = (await storage.put(KEY, "x").catch((e: unknown) => e)) as ArtifactStorageError;
    expect(error.code).toBe(ARTIFACT_STORAGE_ERROR.UNAVAILABLE);
    expect(error.message).toContain('确认桶 "research" 已存在');
  });
});

describe("MinioArtifactStorage · 安全与 key 注入", () => {
  it("describe() 只报端点与桶，**绝不**回显 accessKey / secretKey", () => {
    const { storage } = storageWith(async () => ({}));
    const text = storage.describe();
    expect(text).toContain("bucket=research");
    expect(text).toContain("http://minio.example.internal:9000");
    expect(text).not.toContain(CONFIG.accessKey);
    expect(text).not.toContain(CONFIG.secretKey);
    expect(storage.kind).toBe("minio");
  });

  it("非法 Object Key ⇒ 在任何网络调用**之前**就被拒", async () => {
    const { storage, calls } = storageWith(async () => ({}));
    expect(await codeOf(storage.put("../escape.json", "x"))).toBe(ARTIFACT_STORAGE_ERROR.KEY_INVALID);
    expect(await codeOf(storage.get("/absolute"))).toBe(ARTIFACT_STORAGE_ERROR.KEY_INVALID);
    expect(await codeOf(storage.getMetadata("a//b"))).toBe(ARTIFACT_STORAGE_ERROR.KEY_INVALID);
    expect(await codeOf(storage.delete("a\\b"))).toBe(ARTIFACT_STORAGE_ERROR.KEY_INVALID);
    expect(calls).toHaveLength(0);
  });

  it("未注入 client 时使用真实 S3Client（构造不抛、describe 不泄漏）", () => {
    const storage = new MinioArtifactStorage({ config: CONFIG });
    expect(storage.describe()).not.toContain(CONFIG.secretKey);
  });
});

describe("minioEndpointUrl", () => {
  it("按 useSsl 选协议、补默认端口、去掉尾部斜杠", () => {
    expect(minioEndpointUrl({ endpoint: "minio.example.internal", port: 9000, useSsl: false })).toBe(
      "http://minio.example.internal:9000",
    );
    expect(minioEndpointUrl({ endpoint: "minio.example.internal", port: 9000, useSsl: true })).toBe(
      "https://minio.example.internal:9000",
    );
    expect(minioEndpointUrl({ endpoint: "http://47.94.112.21:9000", port: 9000, useSsl: false })).toBe(
      "http://47.94.112.21:9000",
    );
    // 已经写全端点的 endpoint 不会被叠加成 `:9000:9000`。
    expect(minioEndpointUrl({ endpoint: "https://s3.example.com/", port: 443, useSsl: true })).toBe(
      "https://s3.example.com:443",
    );
    expect(minioEndpointUrl({ endpoint: "s3.example.com:9443", port: 9000, useSsl: false })).toBe(
      "http://s3.example.com:9443",
    );
  });
});
