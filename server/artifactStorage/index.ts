/**
 * RESEARCH-EXPERIMENT-004 — Artifact 存储层（统一出口）。
 *
 * 组成：
 *   - `./types`                 ArtifactStorage 端口 + 存储层错误码（**引擎只认这一层**）
 *   - `./objectKey`             Object Key 规范的**唯一产生点**（规格 §9）
 *   - `./minioArtifactStorage`   MinIO（S3 兼容）适配器（规格 §7）
 *   - `./factory`               env 装配（**唯一读 MINIO_* 的地方**；未配置即抛）
 *   - `./inMemoryArtifactStorage` 测试替身（同契约；**只用于单测**，不是生产降级路径）
 *
 * 🔴 依赖方向：实验引擎 → `ArtifactStorage`（本模块）。引擎**不得** import
 *    `@aws-sdk/client-s3`，也不得 import `MinioArtifactStorage` 具体类。
 */

export {
  ARTIFACT_STORAGE_ERROR,
  ArtifactStorageError,
  type ArtifactGetResult,
  type ArtifactObjectEntry,
  type ArtifactObjectMetadata,
  type ArtifactPutOptions,
  type ArtifactPutResult,
  type ArtifactStorage,
  type ArtifactStorageErrorCode,
} from "./types";

export {
  EXPERIMENT_KEY_ROLES,
  artifactObjectKey,
  assertExperimentIdForObjectKey,
  assertRunIdForObjectKey,
  assertSafeObjectKey,
  assertSafeRelativeName,
  chartObjectKey,
  describeObjectKeyRule,
  experimentRunKeyPrefix,
  isObjectKeyUnderRun,
  logObjectKey,
  manifestObjectKey,
  resultObjectKey,
  roleObjectKey,
  tableObjectKey,
  type ExperimentKeyRole,
} from "./objectKey";

export {
  MinioArtifactStorage,
  minioEndpointUrl,
  type MinioArtifactStorageDeps,
  type MinioStorageConfig,
  type S3ClientLike,
} from "./minioArtifactStorage";

export {
  artifactStorageFromEnv,
  createMinioArtifactStorage,
  defaultArtifactStorage,
  describeArtifactStorage,
  readMinioConfigFromEnv,
  resetArtifactStorageCacheForTests,
  type MinioConfigReadResult,
} from "./factory";

export {
  InMemoryArtifactStorage,
  type InMemoryArtifactStorageOptions,
} from "./inMemoryArtifactStorage";
