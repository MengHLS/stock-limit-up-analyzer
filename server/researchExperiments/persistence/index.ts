/**
 * RESEARCH-EXPERIMENT-004 — Experiment Run 持久化（统一出口）。
 *
 * 组成：
 *   - `./runId`               Run id 生成（`RUN-YYYYMMDD-XXXXXXXX`）
 *   - `./runRepository`       Run 元数据仓储（DB / InMemory 同语义；状态迁移唯一权威）
 *   - `./runManifest`         Manifest 构造 / 校验 / 存在性验证
 *   - `./artifactPublisher`   Result + 文件产物 → 对象存储 → Manifest（存储错误翻译唯一落点）
 *   - `./runService`          生命周期编排（规格 §12 顺序 + §13 一致性不变量）
 */

export { EXPERIMENT_RUN_ID_PREFIX, generateExperimentRunId } from "./runId";

export {
  DEFAULT_RUN_LIST_LIMIT,
  DbExperimentRunRepository,
  EXPERIMENT_RUN_STALE_AFTER_MS,
  InMemoryExperimentRunRepository,
  assertManifestKeyPresent,
  assertRunTransition,
  computeStale,
  formatExperimentBusinessDate,
  mapRunRow,
  type ExperimentRunCompleteInput,
  type ExperimentRunCreateInput,
  type ExperimentRunFailInput,
  type ExperimentRunListFilter,
  type ExperimentRunRepository,
  type InMemoryRunRepositoryOptions,
} from "./runRepository";

export {
  artifactRefFromMetadata,
  buildRunManifest,
  extensionOf,
  findManifestArtifact,
  inferArtifactDescriptor,
  manifestArtifactKeys,
  manifestArtifactRefs,
  parseRunManifest,
  validateRunManifest,
  verifyManifestArtifacts,
  type ArtifactRole,
  type BuildRunManifestInput,
  type ManifestVerificationResult,
} from "./runManifest";

export {
  DEFAULT_EXPERIMENT_PUBLISH_LIMITS,
  DEFAULT_RUN_LOG_NAME,
  publishRunArtifacts,
  translateArtifactStorageError,
  validatePublishLimits,
  type ExperimentPublishLimits,
  type PublishRunArtifactsInput,
  type PublishRunArtifactsResult,
} from "./artifactPublisher";

export {
  EXPERIMENT_RUN_RECONCILED_CODE,
  INLINE_VIEW_MAX_BYTES,
  createExperimentRunService,
  isInlineViewable,
  summarizeOutcome,
  type ExperimentRunService,
  type ExperimentRunServiceDeps,
} from "./runService";
