/**
 * RESEARCH-EXPERIMENT-004 — Artifact 存储的默认装配（**唯一读 env 的地方**）。
 *
 * ## 环境变量（规格 §8）
 *
 * | 变量 | 必需 | 说明 |
 * | --- | --- | --- |
 * | `MINIO_ENDPOINT` | ✅ | 主机名或 `host:port`（**不要写凭据**）；**兼容既有命名** `MINIO_SERVER` |
 * | `MINIO_PORT` | ⭕ | 缺省 `9000`（MinIO 默认）；`MINIO_ENDPOINT` 已带端口则忽略 |
 * | `MINIO_USE_SSL` | ⭕ | 缺省 `false`；`true`/`1`/`yes` 视为 https |
 * | `MINIO_BUCKET` | ✅ | 研究实验桶（规格 §9 建议 `research`） |
 * | `MINIO_ACCESS_KEY` | ✅ | 访问键；**兼容既有命名** `MINIO_USERNAME` |
 * | `MINIO_SECRET_KEY` | ✅ | 密钥；**兼容既有命名** `MINIO_PASSWORD` |
 *
 * 🔴 关于命名：本仓库 `.env` 里早已存在 `MINIO_SERVER` / `MINIO_USERNAME` / `MINIO_PASSWORD`
 *    （历史遗留、此前从未被任何代码引用）。规格 §8 的示例名为
 *    `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`。两者都收 ——
 *    优先规格名，回落既有名，这样既不破坏既有 `.env`，也符合规格推荐命名
 *    （规格 §8 明确「具体命名遵循项目现有规范」）。
 *
 * ## 未配置时的行为（**绝不静默降级**）
 *
 * 未配置 ⇒ 抛 `ARTIFACT_STORAGE_NOT_CONFIGURED`，并把**缺失的变量名**列出来。
 * 不做「悄悄写本地磁盘」的兜底：那会让「生产上其实没接对象存储」变成一个
 * 直到用户翻对象存储才发现的问题。本任务按用户要求**只交付真实 MinIO 实现**。
 */

import { MinioArtifactStorage, type MinioStorageConfig } from "./minioArtifactStorage";
import { ARTIFACT_STORAGE_ERROR, ArtifactStorageError, type ArtifactStorage } from "./types";

/** 读取结果：配置（可能为 null）+ 缺失项清单。 */
export interface MinioConfigReadResult {
  config: MinioStorageConfig | null;
  missing: string[];
}

function readString(source: NodeJS.ProcessEnv, ...names: string[]): string | null {
  for (const name of names) {
    const raw = source[name];
    if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  }
  return null;
}

function readBoolean(source: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = source[name];
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/**
 * 从环境变量读出 MinIO 配置。
 *
 * 不抛错：缺失项以 `missing` 数组回报 ⇒ 调用方（或诊断端点）可以如实展示
 * 「还差哪几个变量」，而不是只看到一句「存储不可用」。
 */
export function readMinioConfigFromEnv(source: NodeJS.ProcessEnv = process.env): MinioConfigReadResult {
  const endpoint = readString(source, "MINIO_ENDPOINT", "MINIO_SERVER");
  const bucket = readString(source, "MINIO_BUCKET");
  const accessKey = readString(source, "MINIO_ACCESS_KEY", "MINIO_USERNAME");
  const secretKey = readString(source, "MINIO_SECRET_KEY", "MINIO_PASSWORD");
  const portRaw = readString(source, "MINIO_PORT");

  const missing: string[] = [];
  if (endpoint === null) missing.push("MINIO_ENDPOINT（或 MINIO_SERVER）");
  if (bucket === null) missing.push("MINIO_BUCKET");
  if (accessKey === null) missing.push("MINIO_ACCESS_KEY（或 MINIO_USERNAME）");
  if (secretKey === null) missing.push("MINIO_SECRET_KEY（或 MINIO_PASSWORD）");

  let port = 9000;
  if (portRaw !== null) {
    const parsed = Number.parseInt(portRaw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
      missing.push(`MINIO_PORT（当前值 "${portRaw}" 不是合法端口）`);
    } else {
      port = parsed;
    }
  }

  if (missing.length > 0) return { config: null, missing };

  return {
    config: {
      endpoint: endpoint!,
      port,
      useSsl: readBoolean(source, "MINIO_USE_SSL", false),
      accessKey: accessKey!,
      secretKey: secretKey!,
      bucket: bucket!,
    },
    missing: [],
  };
}

/** 按配置构造 MinIO 存储（测试可注入假 S3 客户端）。 */
export function createMinioArtifactStorage(config: MinioStorageConfig): ArtifactStorage {
  return new MinioArtifactStorage({ config });
}

/**
 * 按 env 构造存储；未配置即抛（**不静默降级**）。
 *
 * 抛出物是 `ArtifactStorageError(NOT_CONFIGURED)`，由服务层翻译成
 * `EXPERIMENT_ARTIFACT_STORAGE_UNAVAILABLE` 领域码 —— 页面能直接看到「缺哪个变量」。
 */
export function artifactStorageFromEnv(source: NodeJS.ProcessEnv = process.env): ArtifactStorage {
  const { config, missing } = readMinioConfigFromEnv(source);
  if (config === null) {
    throw new ArtifactStorageError(
      ARTIFACT_STORAGE_ERROR.NOT_CONFIGURED,
      `对象存储未配置，缺少环境变量：${missing.join(" / ")}。` +
        `实验 Run 的 Result / Manifest 必须落到对象存储，因此拒绝在未配置时继续` +
        `（不做静默降级 —— 否则「其实没接存储」会被误当成「跑成功了」）`,
      { missing },
    );
  }
  return createMinioArtifactStorage(config);
}

let cached: ArtifactStorage | null = null;
let cachedError: Error | null = null;

/** 默认实例（惰性单例；**失败也缓存**以免每次请求都重试一遍网络）。 */
export function defaultArtifactStorage(): ArtifactStorage {
  if (cached !== null) return cached;
  if (cachedError !== null) throw cachedError;
  try {
    cached = artifactStorageFromEnv();
    return cached;
  } catch (error) {
    cachedError = error instanceof Error ? error : new Error(String(error));
    throw cachedError;
  }
}

/** 仅测试用：清掉单例缓存。 */
export function resetArtifactStorageCacheForTests(): void {
  cached = null;
  cachedError = null;
}

/**
 * 诊断信息（**不含凭据**）：页面 / 探针用它如实说明「存储到底配没配」。
 */
export function describeArtifactStorage(source: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  missing: string[];
  target: string | null;
  kind: string;
} {
  const { config, missing } = readMinioConfigFromEnv(source);
  if (config === null) {
    return { configured: false, missing, target: null, kind: "minio" };
  }
  return {
    configured: true,
    missing: [],
    target: `endpoint=${config.useSsl ? "https" : "http"}://${config.endpoint}${
      /:\d+$/u.test(config.endpoint) ? "" : `:${config.port}`
    } bucket=${config.bucket}`,
    kind: "minio",
  };
}
