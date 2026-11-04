import type { DatasetVersionCounts } from "../query";

/** Stable error codes for local snapshot inspection and export failures. */
export type DatasetSnapshotErrorCode =
  | "SNAPSHOT_NOT_SUPPORTED"
  | "SNAPSHOT_NOT_FOUND"
  | "SNAPSHOT_INVALID"
  | "SNAPSHOT_MANIFEST_INVALID"
  | "SNAPSHOT_SCHEMA_INVALID"
  | "SNAPSHOT_CHECKSUM_MISMATCH"
  | "SNAPSHOT_COUNT_MISMATCH"
  | "SNAPSHOT_VERSION_MISMATCH"
  | "SNAPSHOT_IDENTITY_MISSING"
  | "SNAPSHOT_EXPORT_FAILED"
  | "SNAPSHOT_PUBLISH_FAILED";

/**
 * Snapshot failures deliberately do not extend RegistryDatasetBridgeError.
 *
 * A corrupt local snapshot is an explicit failure, not a reason to silently rebuild the
 * dataset from TiDB. Keeping the error outside the bridge hierarchy lets `assemble.ts`
 * propagate it without changing its existing fallback rules.
 */
export class DatasetSnapshotError extends Error {
  readonly code: DatasetSnapshotErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: DatasetSnapshotErrorCode,
    message: string,
    options: { cause?: unknown; details?: Record<string, unknown> } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DatasetSnapshotError";
    this.code = code;
    this.details = options.details;
  }
}

export interface SnapshotValidationResult {
  counts: DatasetVersionCounts;
  identityCount: number;
  pathRelativeDayRange: { min: number; max: number } | null;
  postRelativeDayRange: { min: number; max: number } | null;
}
